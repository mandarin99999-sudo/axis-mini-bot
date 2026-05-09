import { db } from "@workspace/db";
import {
  messagesTable,
  tasksTable,
  risksTable,
  reportsTable,
  chatsTable,
  cashierReportsTable,
  cashierReportFilesTable,
  incomingReportsTable,
} from "@workspace/db";
import { gte, eq, and, or, sql, ne } from "drizzle-orm";
import { logger } from "./logger";
import { bot } from "./bot";
import { checkMissingCashierReports, KNOWN_LOCATIONS } from "./cashier_risk_checker";
import { fetchFinanceEventsForOwnerMemory, type FinanceMemoryEvent } from "./finance_memory";
import { fetchAccountingSummaryForOwnerMemory } from "./finance_accounting";

type Risk = typeof risksTable.$inferSelect;
type Task = typeof tasksTable.$inferSelect;

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL: Record<string, string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  low: "🟢 LOW",
};

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

type CashierReportRow = {
  id: number;
  senderName: string | null;
  detectedLocation: string | null;
  status: string;
  caption: string | null;
  createdAt: Date;
  fileCount: number;
};

type IncomingReportRow = {
  id: number;
  senderName: string | null;
  reportType: string;
  detectedLocation: string | null;
  detectedDate: string | null;
  summary: string | null;
  confidence: string | null;
  detectedRisksJson: string | null;
  detectedAmountsJson: string | null;
  needsClarification: boolean;
  needsOwnerReview: boolean;
  ownerReviewStatus: string;
  aiErrorNotes: string | null;
  status: string;
  createdAt: Date;
};

async function fetchCashierReports(since: Date): Promise<CashierReportRow[]> {
  return db
    .select({
      id: cashierReportsTable.id,
      senderName: cashierReportsTable.senderName,
      detectedLocation: cashierReportsTable.detectedLocation,
      status: cashierReportsTable.status,
      caption: cashierReportsTable.caption,
      createdAt: cashierReportsTable.createdAt,
      fileCount: sql<number>`count(${cashierReportFilesTable.id})::int`,
    })
    .from(cashierReportsTable)
    .leftJoin(
      cashierReportFilesTable,
      eq(cashierReportFilesTable.cashierReportId, cashierReportsTable.id),
    )
    .where(gte(cashierReportsTable.createdAt, since))
    .groupBy(cashierReportsTable.id)
    .orderBy(cashierReportsTable.createdAt);
}

async function fetchIncomingReports(since: Date): Promise<IncomingReportRow[]> {
  return db
    .select({
      id: incomingReportsTable.id,
      senderName: incomingReportsTable.senderName,
      reportType: incomingReportsTable.reportType,
      detectedLocation: incomingReportsTable.detectedLocation,
      detectedDate: incomingReportsTable.detectedDate,
      summary: incomingReportsTable.summary,
      confidence: incomingReportsTable.confidence,
      detectedRisksJson: incomingReportsTable.detectedRisksJson,
      detectedAmountsJson: incomingReportsTable.detectedAmountsJson,
      needsClarification: incomingReportsTable.needsClarification,
      needsOwnerReview: incomingReportsTable.needsOwnerReview,
      ownerReviewStatus: incomingReportsTable.ownerReviewStatus,
      aiErrorNotes: incomingReportsTable.aiErrorNotes,
      status: incomingReportsTable.status,
      createdAt: incomingReportsTable.createdAt,
    })
    .from(incomingReportsTable)
    .where(
      and(
        gte(incomingReportsTable.createdAt, since),
        ne(incomingReportsTable.status, "error"),
      ),
    )
    .orderBy(incomingReportsTable.createdAt);
}

function buildCashierBlock(reports: CashierReportRow[]): {
  lines: string[];
  attentionLines: string[];
} {
  const byLocation = new Map<string, CashierReportRow[]>();
  const noLocation: CashierReportRow[] = [];

  for (const r of reports) {
    if (r.detectedLocation) {
      const arr = byLocation.get(r.detectedLocation) ?? [];
      arr.push(r);
      byLocation.set(r.detectedLocation, arr);
    } else {
      noLocation.push(r);
    }
  }

  const lines: string[] = [`*ОТЧЁТЫ КАССИРА:*`];

  for (const loc of KNOWN_LOCATIONS) {
    const group = byLocation.get(loc);
    if (!group || group.length === 0) {
      lines.push(`• ${escMd(loc)}: ❌ не найден`);
    } else {
      const totalFiles = group.reduce((sum, r) => sum + r.fileCount, 0);
      const senders = [...new Set(group.map(r => r.senderName).filter(Boolean))];
      const senderStr = senders.length > 0 ? `, сотрудник: ${escMd(senders.join(", "))}` : "";
      if (group.length === 1) {
        lines.push(`• ${escMd(loc)}: ✅ получен, файлов: ${totalFiles}${senderStr}`);
      } else {
        lines.push(`• ${escMd(loc)}: ✅ получено ${group.length} отчёта, файлов: ${totalFiles}${senderStr}`);
      }
    }
  }

  for (const [loc, group] of byLocation.entries()) {
    if (!KNOWN_LOCATIONS.includes(loc)) {
      const totalFiles = group.reduce((sum, r) => sum + r.fileCount, 0);
      lines.push(`• ${escMd(loc)}: ✅ получен, файлов: ${totalFiles}`);
    }
  }

  const attentionLines: string[] = [];
  for (const r of noLocation) {
    const who = r.senderName ? escMd(r.senderName) : "неизвестен";
    const statusLabel = r.status === "needs_location" ? "нужна точка" : r.status;
    attentionLines.push(
      `• ⚠️ Отчёт без точки: ID ${r.id}, сотрудник: ${who}, файлов: ${r.fileCount} \\(${escMd(statusLabel)}\\)`,
    );
  }

  return { lines, attentionLines };
}

async function fetchTodayData() {
  const since = todayStart();

  const [messages, risksRaw, tasks, chatList, cashierReports, incomingReports, financeEvents] = await Promise.all([
    db.select({ id: messagesTable.id })
      .from(messagesTable)
      .where(gte(messagesTable.receivedAt, since)),
    db.select()
      .from(risksTable)
      .where(and(eq(risksTable.status, "open"), gte(risksTable.detectedAt, since))),
    db.select()
      .from(tasksTable)
      .where(and(
        or(
          eq(tasksTable.status, "open"),
          eq(tasksTable.status, "deadline_open"),
          eq(tasksTable.status, "waiting_confirmation"),
        ),
        gte(tasksTable.extractedAt, since),
      )),
    db.select({ id: chatsTable.id, title: chatsTable.title }).from(chatsTable),
    fetchCashierReports(since),
    fetchIncomingReports(since),
    fetchFinanceEventsForOwnerMemory(1, 40),
  ]);

  const chatMap = new Map(chatList.map(c => [c.id, c.title ?? `chat_${c.id}`]));
  const risks = risksRaw.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return { messages, risks, tasks, chatMap, cashierReports, incomingReports, financeEvents };
}

const REPORT_TYPE_LABEL: Record<string, string> = {
  cashier_report: "🧾 Кассовый",
  manager_shift_report: "📋 Менеджерский",
  courier_report: "🛵 Курьерский",
  vehicle_mileage_report: "🚗 Транспорт",
  invoice_or_expense: "🧾 Накладная",
  delivery_cash_report: "💰 Доставка \\(нал\\)",
  unknown_report: "❓ Неизвестный",
};

function buildReviewBlock(reports: IncomingReportRow[]): string[] {
  const pending = reports.filter(r => r.needsOwnerReview && r.ownerReviewStatus === "pending");
  if (pending.length === 0) return [];

  const lines: string[] = [`*ТРЕБУЕТ ПРОВЕРКИ AI \\(${pending.length}\\):*`];
  for (const r of pending) {
    const who = r.senderName ? escMd(r.senderName) : "неизвестен";
    const typeLabel = REPORT_TYPE_LABEL[r.reportType] ?? escMd(r.reportType);
    const locStr = r.detectedLocation ? escMd(r.detectedLocation) : "точка не определена";
    const reason = r.aiErrorNotes ? escMd(r.aiErrorNotes) : "?";
    lines.push(`• ID ${r.id} · ${who} · ${typeLabel} · ${locStr}`);
    lines.push(`  _Причина: ${reason}_`);
    lines.push(`  /report\\_show ${r.id} · /report\\_confirm ${r.id}`);
  }
  return lines;
}

function buildIncomingReportsBlock(reports: IncomingReportRow[]): {
  lines: string[];
  attentionLines: string[];
} {
  if (reports.length === 0) {
    return { lines: [`*ВХОДЯЩИЕ ОТЧЁТЫ \\(AI\\):*`, "Отчётов не поступало"], attentionLines: [] };
  }

  const lines: string[] = [`*ВХОДЯЩИЕ ОТЧЁТЫ \\(AI\\):*`];
  const attentionLines: string[] = [];

  for (const r of reports) {
    const who = r.senderName ? escMd(r.senderName) : "неизвестен";
    const typeLabel = REPORT_TYPE_LABEL[r.reportType] ?? escMd(r.reportType);
    const locStr = r.detectedLocation ? `📍 ${escMd(r.detectedLocation)}` : "📍 точка не определена";
    const dateStr = r.detectedDate ? ` · ${escMd(r.detectedDate)}` : "";
    const confEmoji = r.confidence === "high" ? "🟢" : r.confidence === "medium" ? "🟡" : r.confidence === "low" ? "🔴" : "⚪";
    const statusStr = r.needsClarification ? " ⚠️ ожидает уточнения" : (r.status === "received" ? "" : ` \\(${escMd(r.status)}\\)`);

    lines.push(`• ${typeLabel} · ${who} · ${locStr}${dateStr} ${confEmoji}${statusStr}`);

    if (r.summary) {
      lines.push(`  _${escMd(truncate(r.summary, 120))}_`);
    }

    const aiRisks = r.detectedRisksJson
      ? (JSON.parse(r.detectedRisksJson) as Array<{ severity: string; description: string }>)
      : [];

    if (aiRisks.length > 0) {
      for (const risk of aiRisks) {
        const emoji = risk.severity === "critical" ? "🔴" : risk.severity === "high" ? "🟠" : "🟡";
        attentionLines.push(`• ${emoji} AI\\-риск \\[${escMd(r.senderName ?? "?")}\\]: ${escMd(truncate(risk.description))}`);
      }
    }

    if (r.needsClarification) {
      attentionLines.push(`• ⚠️ Отчёт ID ${r.id} от ${who} ожидает уточнения точки`);
    }
  }

  return { lines, attentionLines };
}

function buildFinanceBlock(events: FinanceMemoryEvent[]): string[] {
  if (events.length === 0) return [];

  const lines: string[] = [`*ФИНАНСОВАЯ ПАМЯТЬ:*`];
  for (const event of events.slice(0, 12)) {
    const parts = [
      event.flowType !== "unknown" ? event.flowType : event.eventType,
      event.managementCategory,
      event.location ?? event.costCenter ?? event.project,
      event.amount ? `${event.amount} ${event.currency}` : null,
      event.counterparty,
    ].filter(Boolean).map(part => escMd(String(part)));

    lines.push(`• ${parts.join(" · ")} — ${escMd(truncate(event.description, 100))}`);
  }

  if (events.length > 12) lines.push(`_\\.\\.\\.и ещё ${events.length - 12}_`);
  return lines;
}

function buildAccountingSummaryBlock(summary: Awaited<ReturnType<typeof fetchAccountingSummaryForOwnerMemory>>): string[] {
  if (summary.length === 0) return [];

  const lines: string[] = [`*УЧЁТ ДЕНЕГ:*`];
  for (const row of summary) {
    lines.push(
      `• ${escMd(row.currency)}: поступления ${escMd(row.income)}, расходы ${escMd(row.expense)}, обязательства ${escMd(row.obligation)}, требует проверки ${row.needsReview}`,
    );
  }
  return lines;
}

function formatRiskLine(r: Risk, chatMap: Map<number, string>): string {
  const time = fmtTime(r.detectedAt);
  // chatId = 0 → system risk, display description directly
  if (r.chatId === 0) {
    return `${escMd(r.description)} \\(${time}\\)`;
  }
  const chatTitle = chatMap.get(r.chatId) ?? `чат ${r.chatId}`;
  return `${escMd(chatTitle)} / ${time}: ${escMd(truncate(r.originalText ?? r.description))}`;
}

export async function generateReport(): Promise<string> {
  await checkMissingCashierReports();

  const { messages, risks, tasks, chatMap, cashierReports, incomingReports, financeEvents } = await fetchTodayData();
  const accountingSummary = await fetchAccountingSummaryForOwnerMemory(1);
  const date = fmtDate(new Date());

  const criticalAndHigh = risks.filter(r => r.severity === "critical" || r.severity === "high");
  const bySeverity = new Map<string, Risk[]>();
  for (const r of risks) {
    const bucket = bySeverity.get(r.severity) ?? [];
    bucket.push(r);
    bySeverity.set(r.severity, bucket);
  }

  const { lines: cashierLines, attentionLines: cashierAttentionLines } = buildCashierBlock(cashierReports);
  const { lines: incomingLines, attentionLines: incomingAttentionLines } = buildIncomingReportsBlock(incomingReports);
  const financeLines = buildFinanceBlock(financeEvents);
  const accountingLines = buildAccountingSummaryBlock(accountingSummary);
  const reviewLines = buildReviewBlock(incomingReports);

  const allAttentionLines = [...cashierAttentionLines, ...incomingAttentionLines];

  const lines: string[] = [];

  lines.push(`*AXIS Mini · вечерний доклад*`);
  lines.push(`Дата: ${date}`);
  lines.push("");

  lines.push(`*ТРЕБУЕТ ВНИМАНИЯ:*`);
  const hasAttention = criticalAndHigh.length > 0 || allAttentionLines.length > 0;
  if (!hasAttention) {
    lines.push("Критичных событий не найдено");
  } else {
    criticalAndHigh.slice(0, 10).forEach((r, i) => {
      lines.push(`${i + 1}\\. \\[${r.severity}\\] ${formatRiskLine(r, chatMap)}`);
    });
    if (criticalAndHigh.length > 10) {
      lines.push(`_\\.\\.\\.и ещё ${criticalAndHigh.length - 10}_`);
    }
    for (const al of allAttentionLines) lines.push(al);
  }
  lines.push("");

  if (reviewLines.length > 0) {
    for (const l of reviewLines) lines.push(l);
    lines.push("");
  }

  for (const l of incomingLines) lines.push(l);
  lines.push("");

  for (const l of cashierLines) lines.push(l);
  lines.push("");

  if (accountingLines.length > 0) {
    for (const l of accountingLines) lines.push(l);
    lines.push("");
  }

  if (financeLines.length > 0) {
    for (const l of financeLines) lines.push(l);
    lines.push("");
  }

  lines.push(`*РИСКИ ЗА ДЕНЬ:*`);
  const countBySev = (s: string) => (bySeverity.get(s) ?? []).length;
  lines.push(`Critical: ${countBySev("critical")}`);
  lines.push(`High: ${countBySev("high")}`);
  lines.push(`Medium: ${countBySev("medium")}`);
  lines.push("");

  const orderedSeverities = ["critical", "high", "medium", "low"];
  for (const sev of orderedSeverities) {
    const group = bySeverity.get(sev);
    if (!group || group.length === 0) continue;
    lines.push(`${SEVERITY_LABEL[sev] ?? sev} \\(${group.length}\\):`);
    for (const r of group) {
      const rule = r.ruleName ? ` \\[${escMd(r.ruleName)}\\]` : "";
      lines.push(`• ${formatRiskLine(r, chatMap)}${rule}`);
    }
    lines.push("");
  }

  lines.push(`*ЗАДАЧИ:*`);
  if (tasks.length === 0) {
    lines.push("Открытых задач не найдено");
  } else {
    for (const t of tasks.slice(0, 15)) {
      const chatTitle = chatMap.get(t.chatId) ?? `чат ${t.chatId}`;
      const rule = t.ruleName ? ` \\[${escMd(t.ruleName)}\\]` : "";
      lines.push(`• ${escMd(chatTitle)}${rule}: ${escMd(truncate(t.originalText ?? t.description))}`);
    }
    if (tasks.length > 15) lines.push(`_\\.\\.\\.и ещё ${tasks.length - 15}_`);
  }
  lines.push("");

  lines.push(`*СТАТИСТИКА:*`);
  lines.push(`Сообщений обработано: ${messages.length}`);
  lines.push(`Рисков найдено: ${risks.length}`);
  lines.push(`Открытых задач: ${tasks.length}`);
  lines.push(`Critical/High рисков: ${criticalAndHigh.length}`);
  lines.push(`Входящих отчётов \\(AI\\): ${incomingReports.length}`);
  lines.push(`Кассовых отчётов: ${cashierReports.length}`);
  lines.push(`Финансовых событий: ${financeEvents.length}`);
  lines.push("");
  lines.push(`_axis\\-mini\\-bot_`);

  return lines.join("\n");
}

export async function generateRisksMessage(): Promise<string> {
  const since = todayStart();
  const [risksRaw, chatList] = await Promise.all([
    db.select().from(risksTable)
      .where(and(eq(risksTable.status, "open"), gte(risksTable.detectedAt, since))),
    db.select({ id: chatsTable.id, title: chatsTable.title }).from(chatsTable),
  ]);

  const chatMap = new Map(chatList.map(c => [c.id, c.title ?? `chat_${c.id}`]));
  const risks = risksRaw.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  if (risks.length === 0) {
    return "✅ Открытых рисков за сегодня нет\\.";
  }

  const date = fmtDate(new Date());
  const lines: string[] = [`*Открытые риски за ${date}:*`, ""];

  for (const r of risks) {
    const sevEmoji = r.severity === "critical" ? "🔴" : r.severity === "high" ? "🟠" : r.severity === "medium" ? "🟡" : "🟢";
    const rule = r.ruleName ? ` \\[${escMd(r.ruleName)}\\]` : "";
    lines.push(`${sevEmoji} ${formatRiskLine(r, chatMap)}${rule}`);
    if (r.chatId !== 0) {
      lines.push(`  ${escMd(truncate(r.description))}`);
    }
  }

  return lines.join("\n");
}

export async function sendEveningReport(targetChatId: string | number): Promise<void> {
  try {
    const report = await generateReport();

    await db.insert(reportsTable).values({
      reportDate: new Date(),
      content: report,
      sentToUserId: String(targetChatId),
    });

    await bot.api.sendMessage(Number(targetChatId), report, { parse_mode: "MarkdownV2" });

    logger.info({ targetChatId }, "Evening report sent");
  } catch (err) {
    logger.error({ err, targetChatId }, "Failed to send evening report");
    throw err;
  }
}

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
