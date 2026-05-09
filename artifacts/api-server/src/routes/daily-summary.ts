import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { KNOWN_LOCATIONS } from "../lib/cashier_risk_checker";

const router: IRouter = Router();

router.get("/daily-summary", async (req: Request, res: Response): Promise<void> => {
  const tz = "Europe/Moscow";
  const dateParam = req.query["date"] as string | undefined;

  const targetDate = dateParam
    ? new Date(dateParam)
    : new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const dayStart = `${dateStr} 00:00:00 Europe/Moscow`;
  const dayEnd   = `${dateStr} 23:59:59 Europe/Moscow`;

  const [
    messagesRow,
    risksRows,
    tasksRow,
    cashierRows,
    missingRisksRows,
    closedRisksRows,
    topRulesRows,
    dupCashierRows,
    incomingReportsRow,
  ] = await Promise.all([

    // 1. Сообщений за день
    db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM messages
      WHERE received_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
    `),

    // 2+6. Риски за день (все)
    db.execute(sql`
      SELECT severity, rule_name, status, description, detected_at, resolved_at
      FROM risks
      WHERE detected_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
      ORDER BY detected_at
    `),

    // 3. Задачи за день
    db.execute(sql`
      SELECT COUNT(*) AS cnt, rule_name
      FROM tasks
      WHERE extracted_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
      GROUP BY rule_name
      ORDER BY COUNT(*) DESC
    `),

    // 4+5. Кассовые отчёты за день
    db.execute(sql`
      SELECT detected_location, sender_name, status,
             COUNT(*) AS reports,
             SUM(CASE WHEN has_photo OR has_document THEN 1 ELSE 0 END) AS with_files
      FROM cashier_reports
      WHERE created_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
        AND detected_location IS NOT NULL
      GROUP BY detected_location, sender_name, status
      ORDER BY detected_location
    `),

    // 6. missing_cashier_report риски открытые за день
    db.execute(sql`
      SELECT description, severity, status, detected_at, resolved_at
      FROM risks
      WHERE rule_name = 'missing_cashier_report'
        AND detected_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
      ORDER BY detected_at
    `),

    // 7. missing_cashier_report риски закрытые за день
    db.execute(sql`
      SELECT description, detected_at, resolved_at
      FROM risks
      WHERE rule_name = 'missing_cashier_report'
        AND status = 'closed'
        AND resolved_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
      ORDER BY resolved_at
    `),

    // 8. Топ правил (риски + задачи)
    db.execute(sql`
      SELECT source, rule_name, COUNT(*) AS cnt
      FROM (
        SELECT 'risk' AS source, COALESCE(rule_name, 'unknown') AS rule_name FROM risks
          WHERE detected_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
        UNION ALL
        SELECT 'task' AS source, COALESCE(rule_name, 'unknown') AS rule_name FROM tasks
          WHERE extracted_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
      ) combined
      GROUP BY source, rule_name
      ORDER BY cnt DESC
      LIMIT 15
    `),

    // 10. Дубли кассовых отчётов (один отправитель + одна точка, несколько записей)
    db.execute(sql`
      SELECT sender_telegram_id, sender_name, detected_location,
             COUNT(*) AS dup_count,
             MIN(created_at) AS first_at, MAX(created_at) AS last_at
      FROM cashier_reports
      WHERE created_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
        AND detected_location IS NOT NULL
      GROUP BY sender_telegram_id, sender_name, detected_location
      HAVING COUNT(*) > 1
    `),

    // 11. Входящие отчёты AI за день
    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN needs_owner_review = true THEN 1 ELSE 0 END) AS need_review,
        SUM(CASE WHEN confidence = 'high' THEN 1 ELSE 0 END) AS high_conf,
        SUM(CASE WHEN confidence = 'medium' THEN 1 ELSE 0 END) AS medium_conf,
        SUM(CASE WHEN confidence = 'low' THEN 1 ELSE 0 END) AS low_conf
      FROM incoming_reports
      WHERE created_at BETWEEN ${dayStart}::timestamptz AND ${dayEnd}::timestamptz
        AND status != 'error'
    `),
  ]);

  const fmt = (d: unknown): string => {
    if (!d) return "—";
    const dt = new Date(d as string);
    return dt.toLocaleTimeString("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  };

  const msgCount = Number((messagesRow.rows[0] as { cnt: string }).cnt);

  const risks = risksRows.rows as Array<{
    severity: string; rule_name: string | null; status: string;
    description: string; detected_at: string; resolved_at: string | null;
  }>;

  const taskRows = tasksRow.rows as Array<{ cnt: string; rule_name: string | null }>;
  const taskCount = taskRows.reduce((s, r) => s + Number(r.cnt), 0);

  const cashier = cashierRows.rows as Array<{
    detected_location: string; sender_name: string | null;
    status: string; reports: string; with_files: string;
  }>;

  const missingRisks = missingRisksRows.rows as Array<{
    description: string; severity: string; status: string;
    detected_at: string; resolved_at: string | null;
  }>;

  const closedRisks = closedRisksRows.rows as Array<{
    description: string; detected_at: string; resolved_at: string;
  }>;

  const topRules = topRulesRows.rows as Array<{ source: string; rule_name: string; cnt: string }>;

  const dups = dupCashierRows.rows as Array<{
    sender_telegram_id: string; sender_name: string | null;
    detected_location: string; dup_count: string;
    first_at: string; last_at: string;
  }>;

  const incomingAiRow = (incomingReportsRow.rows[0] ?? {}) as {
    total: string; need_review: string;
    high_conf: string; medium_conf: string; low_conf: string;
  };

  const receivedLocations = new Set(cashier.map(r => r.detected_location));
  const missingLocations = KNOWN_LOCATIONS.filter(l => !receivedLocations.has(l));

  const risksBySeverity = risks.reduce<Record<string, number>>((acc, r) => {
    acc[r.severity] = (acc[r.severity] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    date: dateStr,
    generated_at: new Date().toLocaleString("ru-RU", { timeZone: tz }),

    "1_messages_processed": msgCount,

    "2_risks_created": {
      total: risks.length,
      by_severity: risksBySeverity,
      list: risks.map(r => ({
        rule: r.rule_name,
        severity: r.severity,
        status: r.status,
        description: r.description,
        at: fmt(r.detected_at),
      })),
    },

    "3_tasks_created": {
      total: taskCount,
      by_rule: taskRows.map(r => ({ rule: r.rule_name, count: Number(r.cnt) })),
    },

    "4_cashier_reports_received": {
      total: cashier.length,
      by_location: cashier.map(r => ({
        location: r.detected_location,
        sender: r.sender_name,
        reports: Number(r.reports),
        with_files: Number(r.with_files),
        status: r.status,
      })),
    },

    "5_missing_locations": missingLocations,

    "6_missing_cashier_risks_opened": missingRisks.map(r => ({
      description: r.description,
      severity: r.severity,
      status: r.status,
      opened_at: fmt(r.detected_at),
      closed_at: r.resolved_at ? fmt(r.resolved_at) : null,
    })),

    "7_missing_cashier_risks_closed": closedRisks.map(r => ({
      description: r.description,
      opened_at: fmt(r.detected_at),
      closed_at: fmt(r.resolved_at),
    })),

    "8_top_rules": topRules.map(r => ({
      source: r.source,
      rule: r.rule_name,
      count: Number(r.cnt),
    })),

    "9_errors_in_logs": {
      note: "Проверить через workflow-логи сервера (grep ERROR/error в консоли Replit)",
      hint: "GET /api/daily-summary не имеет доступа к файловым логам — смотри панель Replit или stdout сервера",
    },

    "10_duplicate_notifications": dups.length === 0
      ? { ok: true, message: "Дублей кассовых отчётов не обнаружено" }
      : {
          ok: false,
          duplicates: dups.map(d => ({
            sender: d.sender_name ?? d.sender_telegram_id,
            location: d.detected_location,
            count: Number(d.dup_count),
            first_at: fmt(d.first_at),
            last_at: fmt(d.last_at),
          })),
        },

    "11_incoming_reports_ai": {
      incoming_reports_total: Number(incomingAiRow.total ?? 0),
      incoming_reports_need_review: Number(incomingAiRow.need_review ?? 0),
      ai_high_confidence_count: Number(incomingAiRow.high_conf ?? 0),
      ai_medium_confidence_count: Number(incomingAiRow.medium_conf ?? 0),
      ai_low_confidence_count: Number(incomingAiRow.low_conf ?? 0),
    },
  };

  res.json(summary);
});

export default router;
