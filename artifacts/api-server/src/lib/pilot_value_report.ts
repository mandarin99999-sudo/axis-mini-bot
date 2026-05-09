import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { fetchPrimaryBusinessProfile, parseJsonStringArray } from "./owner_onboarding";

type PilotMetric = {
  key: string;
  label: string;
  value: number;
  impact: string;
};

export type PilotValueReport = {
  business: {
    name: string | null;
    type: string | null;
    criticalAreas: string[];
    pilotStatus: string;
    pilotStartedAt: string | null;
    pilotEndsAt: string | null;
  };
  period: {
    days: number;
    from: string;
    to: string;
  };
  metrics: {
    activeChats: number;
    messagesProcessed: number;
    tasksFound: number;
    overdueTasks: number;
    remindersWaiting: number;
    risksFound: number;
    highRisks: number;
    reportsReceived: number;
    reportsNeedReview: number;
    financeEvents: number;
    financeNeedsReview: number;
    businessSkills: number;
  };
  finance: Array<{
    currency: string;
    income: string;
    expense: string;
    obligations: string;
    planned: string;
    refunds: string;
    needsReview: number;
  }>;
  valueMetrics: PilotMetric[];
  salesReadiness: {
    score: number;
    total: number;
    verdict: "not_ready" | "pilot_ready" | "payment_ready";
    reasons: string[];
  };
  ownerSummary: string;
};

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

async function safeExecute(name: string, query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }> {
  try {
    return await db.execute(query) as { rows: unknown[] };
  } catch (err) {
    logger.warn({ err, name }, "Pilot value query failed");
    return { rows: [] };
  }
}

export async function buildPilotValueReport(days = 30): Promise<PilotValueReport> {
  const boundedDays = Math.max(1, Math.min(365, Math.floor(days)));
  const now = new Date();
  const profile = await fetchPrimaryBusinessProfile();
  const fallbackFrom = new Date(now.getTime() - boundedDays * 24 * 60 * 60 * 1000);
  const from = profile?.pilotStartedAt ?? fallbackFrom;
  const actualDays = Math.max(1, Math.ceil((now.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));

  const [
    countsResult,
    financeResult,
  ] = await Promise.all([
    safeExecute("pilot_counts", sql`
      SELECT
        (SELECT COUNT(*) FROM chats WHERE is_active = true)::int AS active_chats,
        (SELECT COUNT(*) FROM messages WHERE received_at >= ${from})::int AS messages_processed,
        (SELECT COUNT(*) FROM tasks WHERE extracted_at >= ${from})::int AS tasks_found,
        (SELECT COUNT(*) FROM tasks WHERE status IN ('open','deadline_open','waiting_confirmation') AND deadline IS NOT NULL AND deadline < NOW())::int AS overdue_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'waiting_confirmation')::int AS reminders_waiting,
        (SELECT COUNT(*) FROM risks WHERE detected_at >= ${from})::int AS risks_found,
        (SELECT COUNT(*) FROM risks WHERE detected_at >= ${from} AND severity IN ('critical','high'))::int AS high_risks,
        (SELECT COUNT(*) FROM incoming_reports WHERE created_at >= ${from} AND status <> 'error')::int AS reports_received,
        (SELECT COUNT(*) FROM incoming_reports WHERE created_at >= ${from} AND needs_owner_review = true AND owner_review_status = 'pending')::int AS reports_need_review,
        (SELECT COUNT(*) FROM financial_events WHERE created_at >= ${from})::int AS finance_events,
        (SELECT COUNT(*) FROM financial_transactions WHERE created_at >= ${from} AND needs_review = true)::int AS finance_needs_review,
        (SELECT COUNT(*) FROM business_skills WHERE status = 'active')::int AS business_skills
    `),
    safeExecute("pilot_finance", sql`
      SELECT
        currency,
        COALESCE(SUM(CASE WHEN flow_type = 'income' THEN amount ELSE 0 END), 0)::text AS income,
        COALESCE(SUM(CASE WHEN flow_type = 'expense' THEN amount ELSE 0 END), 0)::text AS expense,
        COALESCE(SUM(CASE WHEN flow_type = 'obligation' THEN amount ELSE 0 END), 0)::text AS obligations,
        COALESCE(SUM(CASE WHEN flow_type = 'planned' THEN amount ELSE 0 END), 0)::text AS planned,
        COALESCE(SUM(CASE WHEN flow_type = 'refund' THEN amount ELSE 0 END), 0)::text AS refunds,
        COUNT(*) FILTER (WHERE needs_review = true)::int AS needs_review
      FROM financial_transactions
      WHERE created_at >= ${from}
        AND status <> 'ignored'
      GROUP BY currency
      ORDER BY currency
    `),
  ]);

  const row = (countsResult.rows[0] ?? {}) as Record<string, unknown>;
  const metrics = {
    activeChats: asNumber(row["active_chats"]),
    messagesProcessed: asNumber(row["messages_processed"]),
    tasksFound: asNumber(row["tasks_found"]),
    overdueTasks: asNumber(row["overdue_tasks"]),
    remindersWaiting: asNumber(row["reminders_waiting"]),
    risksFound: asNumber(row["risks_found"]),
    highRisks: asNumber(row["high_risks"]),
    reportsReceived: asNumber(row["reports_received"]),
    reportsNeedReview: asNumber(row["reports_need_review"]),
    financeEvents: asNumber(row["finance_events"]),
    financeNeedsReview: asNumber(row["finance_needs_review"]),
    businessSkills: asNumber(row["business_skills"]),
  };

  const valueMetrics: PilotMetric[] = [
    {
      key: "messages",
      label: "Сообщений обработано",
      value: metrics.messagesProcessed,
      impact: "AXIS держал рабочий поток в памяти, чтобы владелец не перечитывал всё вручную.",
    },
    {
      key: "tasks",
      label: "Задач найдено",
      value: metrics.tasksFound,
      impact: "Поручения и сроки превращались в контролируемые задачи.",
    },
    {
      key: "risks",
      label: "Рисков найдено",
      value: metrics.risksFound,
      impact: "Важные сигналы отделялись от шума рабочих чатов.",
    },
    {
      key: "reports",
      label: "Отчётов принято",
      value: metrics.reportsReceived,
      impact: "Документы и фото попадали в единую память бизнеса.",
    },
    {
      key: "finance",
      label: "Финансовых событий",
      value: metrics.financeEvents,
      impact: "Движения денег начали попадать в управленческий финансовый журнал.",
    },
    {
      key: "skills",
      label: "Навыков бизнеса",
      value: metrics.businessSkills,
      impact: "AXIS адаптировался к бизнесу без кода и Replit.",
    },
  ];

  const reasons: string[] = [];
  if (metrics.activeChats > 0) reasons.push("рабочие чаты подключены");
  if (metrics.messagesProcessed > 0) reasons.push("есть реальный поток сообщений");
  if (metrics.tasksFound > 0) reasons.push("AXIS нашёл задачи");
  if (metrics.risksFound > 0 || metrics.highRisks > 0) reasons.push("AXIS нашёл риски");
  if (metrics.financeEvents > 0) reasons.push("финансовый журнал начал наполняться");
  if (metrics.businessSkills > 0) reasons.push("владелец обучил AXIS под бизнес");
  if (profile?.onboardingCompleted) reasons.push("профиль бизнеса заполнен");

  const score = reasons.length;
  const total = 7;
  const verdict: PilotValueReport["salesReadiness"]["verdict"] =
    score >= 6 ? "payment_ready" : score >= 4 ? "pilot_ready" : "not_ready";

  const ownerSummary = buildOwnerSummary(metrics, actualDays, verdict);

  return {
    business: {
      name: profile?.businessName ?? null,
      type: profile?.businessType ?? null,
      criticalAreas: profile ? parseJsonStringArray(profile.criticalAreasJson) : [],
      pilotStatus: profile?.pilotStatus ?? "not_started",
      pilotStartedAt: isoDate(profile?.pilotStartedAt),
      pilotEndsAt: isoDate(profile?.pilotEndsAt),
    },
    period: {
      days: actualDays,
      from: from.toISOString(),
      to: now.toISOString(),
    },
    metrics,
    finance: financeResult.rows.map(item => {
      const f = item as Record<string, unknown>;
      return {
        currency: String(f["currency"] ?? "RUB"),
        income: String(f["income"] ?? "0"),
        expense: String(f["expense"] ?? "0"),
        obligations: String(f["obligations"] ?? "0"),
        planned: String(f["planned"] ?? "0"),
        refunds: String(f["refunds"] ?? "0"),
        needsReview: asNumber(f["needs_review"]),
      };
    }),
    valueMetrics,
    salesReadiness: {
      score,
      total,
      verdict,
      reasons,
    },
    ownerSummary,
  };
}

function buildOwnerSummary(
  metrics: PilotValueReport["metrics"],
  days: number,
  verdict: PilotValueReport["salesReadiness"]["verdict"],
): string {
  const lines = [
    `За ${days} дней AXIS обработал ${metrics.messagesProcessed} сообщений.`,
    `Нашёл ${metrics.tasksFound} задач, ${metrics.risksFound} рисков и принял ${metrics.reportsReceived} отчётов.`,
  ];

  if (metrics.financeEvents > 0) {
    lines.push(`В финансовый журнал попало ${metrics.financeEvents} событий, из них ${metrics.financeNeedsReview} требуют проверки.`);
  }

  if (metrics.overdueTasks > 0) {
    lines.push(`Есть ${metrics.overdueTasks} просроченных задач — это зона внимания владельца.`);
  }

  if (metrics.businessSkills > 0) {
    lines.push(`AXIS уже обучен ${metrics.businessSkills} no-code навыкам бизнеса.`);
  }

  if (verdict === "payment_ready") {
    lines.push("Пилот выглядит готовым к разговору об оплате: ценность уже видна на реальных данных.");
  } else if (verdict === "pilot_ready") {
    lines.push("Пилот рабочий, но перед продажей нужно накопить больше финансовых событий, навыков или отчётов.");
  } else {
    lines.push("Пока рано продавать: нужно больше реального потока и завершённый onboarding.");
  }

  return lines.join("\n");
}

export function formatPilotValueReportForTelegram(report: PilotValueReport): string {
  const verdictLabel: Record<PilotValueReport["salesReadiness"]["verdict"], string> = {
    payment_ready: "готов к разговору об оплате",
    pilot_ready: "пилот уже имеет ценность",
    not_ready: "нужно больше данных",
  };

  const lines = [
    "AXIS Mini · ценность пилота",
    "",
    report.business.name ? `Бизнес: ${report.business.name}` : null,
    `Период: ${report.period.days} дней`,
    "",
    report.ownerSummary,
    "",
    "Цифры:",
    `• Активных чатов: ${report.metrics.activeChats}`,
    `• Сообщений: ${report.metrics.messagesProcessed}`,
    `• Задач: ${report.metrics.tasksFound} (просрочено: ${report.metrics.overdueTasks})`,
    `• Рисков: ${report.metrics.risksFound} (high/critical: ${report.metrics.highRisks})`,
    `• Отчётов: ${report.metrics.reportsReceived} (на проверке: ${report.metrics.reportsNeedReview})`,
    `• Финансовых событий: ${report.metrics.financeEvents} (на проверке: ${report.metrics.financeNeedsReview})`,
    `• No-code навыков: ${report.metrics.businessSkills}`,
  ].filter(Boolean);

  if (report.finance.length > 0) {
    lines.push("", "Финансы:");
    for (const f of report.finance) {
      lines.push(`• ${f.currency}: поступления ${f.income}, расходы ${f.expense}, обязательства ${f.obligations}, возвраты ${f.refunds}`);
    }
  }

  lines.push(
    "",
    `Готовность: ${report.salesReadiness.score}/${report.salesReadiness.total} — ${verdictLabel[report.salesReadiness.verdict]}`,
  );

  return lines.join("\n");
}
