import { Router, type IRouter, type Request, type Response } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { SUPPORTED_LANGUAGES } from "../lib/i18n";
import { getBillingStatus } from "../lib/billing";
import { buildPilotValueReport } from "../lib/pilot_value_report";

const router: IRouter = Router();

type QueryResult = { rows: unknown[] };

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function periodDays(req: Request): number {
  const raw = Number(req.query["days"] ?? 7);
  if (!Number.isFinite(raw)) return 7;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

function requireDashboardAuth(req: Request, res: Response): boolean {
  const token = process.env["OWNER_DASHBOARD_TOKEN"] ?? process.env["DASHBOARD_TOKEN"];
  if (!token) return true;

  const auth = req.get("authorization") ?? "";
  const queryToken = typeof req.query["token"] === "string" ? req.query["token"] : "";
  if (auth === `Bearer ${token}` || queryToken === token) return true;

  res.status(401).json({ error: "owner_dashboard_auth_required" });
  return false;
}

async function safeExecute(name: string, query: SQL): Promise<QueryResult> {
  try {
    return await db.execute(query) as QueryResult;
  } catch (err) {
    logger.warn({ err, name }, "Owner dashboard query failed");
    return { rows: [] };
  }
}

async function safeBillingStatus(): Promise<unknown> {
  try {
    return await getBillingStatus();
  } catch (err) {
    logger.warn({ err }, "Billing status is not available yet");
    return {
      ownerTelegramId: null,
      plan: null,
      subscription: null,
      access: { allowed: false, reason: "not_configured", daysLeft: null },
      nextPayment: null,
    };
  }
}

router.get("/owner-dashboard", async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAuth(req, res)) return;

  const days = periodDays(req);
  const fastMode = req.query["fast"] === "1" || req.query["lite"] === "1";

  const [
    baseStats,
    financeSummary,
    financeNeedsReview,
    tasks,
    risks,
    reports,
    skills,
    financeEvents,
    businessProfile,
    pilotValue,
    billingStatus,
  ] = await Promise.all([
    safeExecute("base_stats", sql`
      SELECT
        (SELECT COUNT(*) FROM chats WHERE is_active = true)::int AS active_chats,
        (SELECT COUNT(*) FROM messages WHERE received_at >= CURRENT_DATE)::int AS messages_today,
        (SELECT COUNT(*) FROM messages WHERE received_at >= NOW() - (${days}::text || ' days')::interval)::int AS messages_period,
        (SELECT COUNT(*) FROM tasks WHERE status IN ('open','deadline_open','waiting_confirmation'))::int AS open_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status IN ('open','deadline_open','waiting_confirmation') AND deadline IS NOT NULL AND deadline < NOW())::int AS overdue_tasks,
        (SELECT COUNT(*) FROM risks WHERE status = 'open')::int AS open_risks,
        (SELECT COUNT(*) FROM risks WHERE status = 'open' AND severity IN ('critical','high'))::int AS high_risks,
        (SELECT COUNT(*) FROM incoming_reports WHERE needs_owner_review = true AND owner_review_status = 'pending')::int AS reports_need_review
    `),
    safeExecute("finance_summary", sql`
      SELECT
        currency,
        COALESCE(SUM(CASE WHEN flow_type = 'income' THEN amount ELSE 0 END), 0)::text AS income,
        COALESCE(SUM(CASE WHEN flow_type = 'expense' THEN amount ELSE 0 END), 0)::text AS expense,
        COALESCE(SUM(CASE WHEN flow_type = 'obligation' THEN amount ELSE 0 END), 0)::text AS obligations,
        COALESCE(SUM(CASE WHEN flow_type = 'planned' THEN amount ELSE 0 END), 0)::text AS planned,
        COALESCE(SUM(CASE WHEN flow_type = 'refund' THEN amount ELSE 0 END), 0)::text AS refunds,
        COUNT(*) FILTER (WHERE needs_review = true)::int AS needs_review
      FROM financial_transactions
      WHERE created_at >= NOW() - (${days}::text || ' days')::interval
        AND status <> 'ignored'
      GROUP BY currency
      ORDER BY currency
    `),
    safeExecute("finance_needs_review", sql`
      SELECT
        id,
        flow_type,
        amount::text AS amount,
        currency,
        management_category,
        counterparty,
        location,
        description,
        review_reason,
        created_at
      FROM financial_transactions
      WHERE needs_review = true
      ORDER BY created_at DESC
      LIMIT 12
    `),
    safeExecute("tasks", sql`
      SELECT
        t.id,
        COALESCE(c.title, 'чат ' || t.chat_id::text) AS chat_title,
        t.description,
        t.assigned_to_username,
        t.deadline,
        t.status,
        t.extracted_at
      FROM tasks t
      LEFT JOIN chats c ON c.id = t.chat_id
      WHERE t.status IN ('open','deadline_open','waiting_confirmation')
      ORDER BY t.deadline NULLS LAST, t.extracted_at DESC
      LIMIT 12
    `),
    safeExecute("risks", sql`
      SELECT
        r.id,
        COALESCE(c.title, CASE WHEN r.chat_id = 0 THEN 'системный контроль' ELSE 'чат ' || r.chat_id::text END) AS chat_title,
        r.severity,
        r.description,
        r.detected_at
      FROM risks r
      LEFT JOIN chats c ON c.id = r.chat_id
      WHERE r.status = 'open'
      ORDER BY
        CASE r.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        r.detected_at DESC
      LIMIT 12
    `),
    safeExecute("reports", sql`
      SELECT
        id,
        sender_name,
        report_type,
        detected_location,
        confidence,
        ai_error_notes,
        created_at
      FROM incoming_reports
      WHERE needs_owner_review = true
        AND owner_review_status = 'pending'
      ORDER BY created_at DESC
      LIMIT 12
    `),
    safeExecute("skills", sql`
      SELECT
        id,
        title,
        scope,
        action_summary,
        confidence,
        created_at
      FROM business_skills
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 12
    `),
    safeExecute("finance_events", sql`
      SELECT
        id,
        flow_type,
        amount,
        currency,
        management_category,
        counterparty,
        location,
        description,
        confidence,
        created_at
      FROM financial_events
      WHERE created_at >= NOW() - (${days}::text || ' days')::interval
      ORDER BY created_at DESC
      LIMIT 12
    `),
    safeExecute("business_profile", sql`
      SELECT
        id,
        business_name,
        business_type,
        business_description,
        critical_areas_json,
        daily_report_preference,
        preferred_language,
        onboarding_completed,
        onboarding_step,
        pilot_status,
        pilot_started_at,
        pilot_ends_at,
        timezone
      FROM business_profiles
      ORDER BY created_at
      LIMIT 1
    `),
    fastMode
      ? Promise.resolve({
        ownerSummary: "AXIS загрузил быстрые live-данные. Полный отчёт ценности доступен через /pilot.",
        valueMetrics: [
          { key: "fast_dashboard", label: "Кабинет", value: "live", description: "Быстрая загрузка Mini App" },
          { key: "trial", label: "Пилот", value: "30 дней", description: "Бесплатный период для проверки ценности" },
        ],
        salesReadiness: { score: 0, total: 7, verdict: "fast_mode" },
      })
      : buildPilotValueReport(30),
    safeBillingStatus(),
  ]);

  const stats = (baseStats.rows[0] ?? {}) as Record<string, unknown>;
  const profile = (businessProfile.rows[0] ?? null) as Record<string, unknown> | null;
  const skillCount = skills.rows.length;
  const financeReviewRows = financeNeedsReview.rows as Record<string, unknown>[];
  const financeSummaryRows = financeSummary.rows as Record<string, unknown>[];

  const readinessChecks = [
    { key: "business_profile", label: "Профиль бизнеса заполнен", ok: !!profile && profile["onboarding_completed"] === true },
    { key: "telegram_intake", label: "Рабочие чаты подключены", ok: asNumber(stats["active_chats"]) > 0 },
    { key: "memory", label: "Память сообщений наполняется", ok: asNumber(stats["messages_period"]) > 0 },
    { key: "tasks", label: "Задачи и дедлайны видны", ok: asNumber(stats["open_tasks"]) > 0 },
    { key: "finance", label: "Финансовый журнал работает", ok: financeSummaryRows.length > 0 || financeEvents.rows.length > 0 },
    { key: "skills", label: "No-code навыки владельца есть", ok: skillCount > 0 },
  ];

  const data = {
    product: {
      name: "AXIS Mini",
      stage: "pilot_readiness",
      offer: "AI-секретарь для владельца бизнеса: память рабочих чатов, задачи, дедлайны, финансы и ежедневный контроль.",
      primary_interface: "Telegram",
      dashboard_role: "кабинет владельца для контроля, пилотов и продажи",
    },
    period: {
      days,
      generated_at: new Date().toISOString(),
    },
    business_profile: profile ? {
      business_name: profile["business_name"] ?? null,
      business_type: profile["business_type"] ?? null,
      business_description: profile["business_description"] ?? null,
      critical_areas: parseJsonArray(profile["critical_areas_json"]),
      daily_report_preference: profile["daily_report_preference"] ?? null,
      preferred_language: profile["preferred_language"] ?? "ru",
      onboarding_completed: profile["onboarding_completed"] === true,
      onboarding_step: profile["onboarding_step"] ?? null,
      pilot_status: profile["pilot_status"] ?? "not_started",
      pilot_started_at: profile["pilot_started_at"] ?? null,
      pilot_ends_at: profile["pilot_ends_at"] ?? null,
      timezone: profile["timezone"] ?? "Asia/Yakutsk",
    } : {
      business_name: null,
      business_type: null,
      business_description: null,
      critical_areas: [],
      daily_report_preference: null,
      preferred_language: "ru",
      onboarding_completed: false,
      onboarding_step: null,
      pilot_status: "not_started",
      pilot_started_at: null,
      pilot_ends_at: null,
      timezone: "Asia/Yakutsk",
    },
    supported_languages: SUPPORTED_LANGUAGES,
    billing: billingStatus,
    kpi: {
      active_chats: asNumber(stats["active_chats"]),
      messages_today: asNumber(stats["messages_today"]),
      messages_period: asNumber(stats["messages_period"]),
      open_tasks: asNumber(stats["open_tasks"]),
      overdue_tasks: asNumber(stats["overdue_tasks"]),
      open_risks: asNumber(stats["open_risks"]),
      high_risks: asNumber(stats["high_risks"]),
      reports_need_review: asNumber(stats["reports_need_review"]),
      finance_needs_review: financeReviewRows.length,
      business_skills: skillCount,
    },
    finance_summary: financeSummaryRows.map(row => ({
      currency: String(row["currency"] ?? "RUB"),
      income: String(row["income"] ?? "0"),
      expense: String(row["expense"] ?? "0"),
      obligations: String(row["obligations"] ?? "0"),
      planned: String(row["planned"] ?? "0"),
      refunds: String(row["refunds"] ?? "0"),
      needs_review: asNumber(row["needs_review"]),
    })),
    pilot_readiness: {
      score: readinessChecks.filter(item => item.ok).length,
      total: readinessChecks.length,
      checks: readinessChecks,
    },
    pilot_value: pilotValue,
    lists: {
      tasks: tasks.rows,
      risks: risks.rows,
      reports_need_review: reports.rows,
      finance_needs_review: financeReviewRows,
      finance_events: financeEvents.rows,
      business_skills: skills.rows,
    },
    next_monetization_steps: [
      "Провести 1-3 пилота с владельцами бизнеса.",
      "Показать владельцу ежедневную ценность: сколько задач, рисков, денег и документов AXIS удержал под контролем.",
      "После пилота подключить тарифы и оплату.",
    ],
  };

  res.json(data);
});

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export default router;
