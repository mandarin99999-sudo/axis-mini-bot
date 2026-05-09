import type { Context } from "grammy";
import { db, incomingReportsTable, incomingReportFilesTable, cashierReportsTable, cashierReportFilesTable, risksTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { analyzeReportImages } from "./ai_analyzer";
import { closeMissingCashierReportRisk } from "./cashier_risk_checker";
import { storeFinanceEventsFromReport } from "./finance_memory";
import { bot } from "./bot";

const OWNER_CHAT_ID = process.env["REPORT_CHAT_ID"];

const KNOWN_LOCATIONS: { pattern: RegExp; name: string }[] = [
  { pattern: /алдан|aldan/i, name: "Алдан" },
  { pattern: /нерюнгри|нерюнгр|нрг|neryungri|nrg/i, name: "Нерюнгри" },
  { pattern: /куранах|kuranakh/i, name: "Куранах" },
];

function detectLocationInText(text: string): string | null {
  for (const loc of KNOWN_LOCATIONS) {
    if (loc.pattern.test(text)) return loc.name;
  }
  return null;
}

function senderDisplayName(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
  id: number;
}): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : (user.username ?? `user_${user.id}`);
}

async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  try {
    const file = await bot.api.getFile(fileId);
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    if (!file.file_path || !token) return null;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch (err) {
    logger.error({ err, fileId }, "Failed to get Telegram file URL");
    return null;
  }
}

async function findRecentReport(
  senderTelegramId: number,
  withinSeconds: number,
): Promise<(typeof incomingReportsTable.$inferSelect) | null> {
  const since = new Date(Date.now() - withinSeconds * 1000);
  const [row] = await db
    .select()
    .from(incomingReportsTable)
    .where(
      and(
        eq(incomingReportsTable.senderTelegramId, senderTelegramId),
        gte(incomingReportsTable.createdAt, since),
      ),
    )
    .orderBy(desc(incomingReportsTable.createdAt))
    .limit(1);
  return row ?? null;
}

async function runAiAndProcess(reportId: number, senderName: string, ctx: Context["api"]): Promise<void> {
  try {
    const [report] = await db
      .select()
      .from(incomingReportsTable)
      .where(eq(incomingReportsTable.id, reportId))
      .limit(1);
    if (!report) return;

    await db
      .update(incomingReportsTable)
      .set({ status: "analyzing", updatedAt: new Date() })
      .where(eq(incomingReportsTable.id, reportId));

    const files = await db
      .select()
      .from(incomingReportFilesTable)
      .where(eq(incomingReportFilesTable.incomingReportId, reportId))
      .orderBy(incomingReportFilesTable.id);

    const imageUrls: string[] = [];
    for (const f of files) {
      if (f.telegramFileUrl) {
        imageUrls.push(f.telegramFileUrl);
      } else {
        const url = await getTelegramFileUrl(f.fileId);
        if (url) {
          imageUrls.push(url);
          await db
            .update(incomingReportFilesTable)
            .set({ telegramFileUrl: url })
            .where(eq(incomingReportFilesTable.id, f.id));
        }
      }
    }

    if (imageUrls.length === 0) {
      logger.warn({ reportId }, "No image URLs resolved for AI analysis");
      await db
        .update(incomingReportsTable)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(incomingReportsTable.id, reportId));
      return;
    }

    logger.info({ reportId, imageCount: imageUrls.length }, "Sending images to AI for analysis");
    const result = await analyzeReportImages(imageUrls);
    logger.info({ reportId, result }, "AI analysis complete");

    const now = new Date();
    const resolvedLocation = result.location !== "unknown" ? result.location : null;
    const newStatus = result.needs_clarification ? "needs_clarification" : "received";

    const hasHighCriticalRisk = result.detected_risks.some(
      r => r.severity === "critical" || r.severity === "high",
    );
    const needsOwnerReview =
      result.confidence === "low" ||
      result.report_type === "unknown_report" ||
      result.location === "unknown" ||
      hasHighCriticalRisk;

    const reviewReasons: string[] = [];
    if (result.confidence === "low") reviewReasons.push("низкая уверенность AI");
    if (result.report_type === "unknown_report") reviewReasons.push("неизвестный тип отчёта");
    if (result.location === "unknown") reviewReasons.push("точка не определена");
    if (hasHighCriticalRisk) reviewReasons.push("выявлены high/critical риски");

    await db
      .update(incomingReportsTable)
      .set({
        aiAnalysisJson: JSON.stringify(result),
        reportType: result.report_type,
        detectedLocation: resolvedLocation,
        detectedDate: result.date,
        summary: result.summary,
        detectedAmountsJson: JSON.stringify(result.detected_amounts),
        detectedRisksJson: JSON.stringify(result.detected_risks),
        confidence: result.confidence,
        needsClarification: result.needs_clarification,
        clarificationQuestion: result.clarification_question,
        needsOwnerReview,
        ownerReviewStatus: needsOwnerReview ? "pending" : "not_required",
        aiErrorNotes: reviewReasons.length > 0 ? reviewReasons.join("; ") : null,
        status: newStatus,
        updatedAt: now,
      })
      .where(eq(incomingReportsTable.id, reportId));

    if (result.detected_risks.length > 0) {
      const sourceChatId = getSourceChatId(report);
      for (const risk of result.detected_risks) {
        await db.insert(risksTable).values({
          chatId: sourceChatId,
          ruleName: `ai_${result.report_type}`,
          description: risk.description,
          severity: risk.severity,
          status: "open",
          originalText: result.summary,
        });
      }
      logger.info({ reportId, count: result.detected_risks.length }, "AI risks created");
    }

    const financeSourceChatId = getSourceChatId(report);
    const financeEventCount = await storeFinanceEventsFromReport({
      incomingReportId: reportId,
      chatId: financeSourceChatId === 0 ? null : financeSourceChatId,
      result,
    });
    if (financeEventCount > 0) {
      logger.info({ reportId, financeEventCount }, "Finance events created from incoming report");
    }

    if (result.report_type === "cashier_report" && resolvedLocation) {
      await syncToCashierReports(reportId, report, resolvedLocation, files, senderName);
      void closeMissingCashierReportRisk(resolvedLocation).catch(err =>
        logger.error({ err, location: resolvedLocation }, "Failed to close missing cashier risk"),
      );
    }

    if (result.needs_clarification && result.clarification_question) {
      await ctx.sendMessage(getReplyChatId(report), result.clarification_question);
    } else {
      await notifyEmployee(ctx, getReplyChatId(report), result);
    }

    await notifyOwner(ctx, {
      reportId,
      senderName,
      result,
      fileCount: files.length,
      needsOwnerReview,
      reviewReasons,
    });
  } catch (err) {
    logger.error({ err, reportId }, "AI analysis failed");
    await db
      .update(incomingReportsTable)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(incomingReportsTable.id, reportId));
    try {
      const [rep] = await db
        .select()
        .from(incomingReportsTable)
        .where(eq(incomingReportsTable.id, reportId))
        .limit(1);
      if (rep) {
        await ctx.sendMessage(
          getReplyChatId(rep),
          "Не удалось автоматически распознать отчёт. Файл сохранён. Укажи точку: Алдан, Нерюнгри или Куранах.",
        );
      }
    } catch (_) {}
  }
}

function getSourceChatId(report: typeof incomingReportsTable.$inferSelect): number {
  try {
    const raw = JSON.parse(report.rawJson) as { chat?: { id?: number; type?: string } };
    if (raw.chat?.id && raw.chat.type !== "private") return raw.chat.id;
  } catch (err) {
    logger.warn({ err, reportId: report.id }, "Failed to parse report rawJson chat id");
  }
  return 0;
}

function getReplyChatId(report: typeof incomingReportsTable.$inferSelect): number {
  try {
    const raw = JSON.parse(report.rawJson) as { chat?: { id?: number } };
    if (raw.chat?.id) return raw.chat.id;
  } catch (err) {
    logger.warn({ err, reportId: report.id }, "Failed to parse report rawJson reply chat id");
  }
  return report.senderTelegramId;
}

async function syncToCashierReports(
  incomingId: number,
  report: typeof incomingReportsTable.$inferSelect,
  location: string,
  files: Array<typeof incomingReportFilesTable.$inferSelect>,
  senderName: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(cashierReportsTable)
    .where(eq(cashierReportsTable.mediaGroupId, `incoming_${incomingId}`))
    .limit(1);
  if (existing.length > 0) return;

  const hasPhoto = files.some(f => f.fileType === "photo");
  const hasDocument = files.some(f => f.fileType === "document");
  const firstFile = files[0];

  const [cashierRecord] = await db
    .insert(cashierReportsTable)
    .values({
      senderTelegramId: report.senderTelegramId,
      senderName: senderName,
      fileId: firstFile?.fileId ?? "",
      hasPhoto,
      hasDocument,
      caption: null,
      detectedLocation: location,
      detectionSource: "ai",
      status: "received",
      mediaGroupId: `incoming_${incomingId}`,
      locationPromptSent: false,
      lastFileAt: new Date(),
      reportType: "cashier_report",
      rawJson: report.rawJson,
    })
    .returning();

  if (!cashierRecord) return;

  for (const f of files) {
    await db.insert(cashierReportFilesTable).values({
      cashierReportId: cashierRecord.id,
      fileId: f.fileId,
      fileType: f.fileType as "photo" | "document",
      telegramMessageId: f.telegramMessageId ?? 0,
    });
  }

  logger.info({ incomingId, cashierReportId: cashierRecord.id, location }, "Synced to cashier_reports");
}

async function notifyEmployee(
  api: Context["api"],
  chatId: number,
  result: Awaited<ReturnType<typeof analyzeReportImages>>,
): Promise<void> {
  const typeLabels: Record<string, string> = {
    cashier_report: "🧾 Кассовый отчёт",
    manager_shift_report: "📋 Отчёт менеджера",
    courier_report: "🛵 Отчёт курьера",
    vehicle_mileage_report: "🚗 Отчёт по транспорту",
    invoice_or_expense: "🧾 Накладная/расход",
    delivery_cash_report: "💰 Отчёт по доставке",
    unknown_report: "📄 Неизвестный тип",
  };

  const typeLabel = typeLabels[result.report_type] ?? result.report_type;
  const locationStr = result.location !== "unknown" ? `Точка: *${result.location}*` : "Точка: не определена";
  const dateStr = result.date ? `Дата: ${result.date}` : "";

  const lines = [
    `✅ Отчёт принят и распознан`,
    "",
    `Тип: ${typeLabel}`,
    locationStr,
  ];
  if (dateStr) lines.push(dateStr);
  if (result.summary) lines.push(``, result.summary);
  if (result.detected_risks.length > 0) {
    lines.push("", "⚠️ Выявлены риски — передано руководству.");
  }

  try {
    await api.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err, chatId }, "Failed to notify employee");
  }
}

async function notifyOwner(
  api: Context["api"],
  opts: {
    reportId: number;
    senderName: string;
    result: Awaited<ReturnType<typeof analyzeReportImages>>;
    fileCount: number;
    needsOwnerReview: boolean;
    reviewReasons: string[];
  },
): Promise<void> {
  if (!OWNER_CHAT_ID) return;

  const typeLabels: Record<string, string> = {
    cashier_report: "🧾 Кассовый",
    manager_shift_report: "📋 Менеджерский",
    courier_report: "🛵 Курьерский",
    vehicle_mileage_report: "🚗 Транспорт",
    invoice_or_expense: "🧾 Накладная",
    delivery_cash_report: "💰 Доставка (нал)",
    unknown_report: "❓ Неизвестный",
  };

  const { result, senderName, reportId, fileCount, needsOwnerReview, reviewReasons } = opts;
  const typeLabel = typeLabels[result.report_type] ?? result.report_type;
  const locStr = result.location !== "unknown" ? result.location : "не определена";
  const confEmoji = result.confidence === "high" ? "🟢" : result.confidence === "medium" ? "🟡" : "🔴";
  const reviewLine = needsOwnerReview
    ? `🔎 Проверка владельца: *нужна* (${reviewReasons.join(", ")})`
    : `✅ Проверка владельца: не нужна`;

  const lines = [
    `📥 *Новый отчёт получен*`,
    "",
    `👤 Сотрудник: ${senderName}`,
    `📑 Тип: ${typeLabel}`,
    `📍 Точка: *${locStr}*`,
    `📅 Дата: ${result.date ?? "не распознана"}`,
    `📎 Файлов: ${fileCount}`,
    `${confEmoji} Уверенность AI: ${result.confidence}`,
    reviewLine,
    `🆔 ID: ${reportId}`,
  ];

  if (result.summary) {
    lines.push("", `📝 ${result.summary}`);
  }

  if (result.detected_amounts.length > 0) {
    lines.push("", "*Суммы:*");
    for (const a of result.detected_amounts) {
      lines.push(`• ${a.label}: ${a.value}`);
    }
  }

  if (result.detected_risks.length > 0) {
    lines.push("", "*⚠️ Риски:*");
    for (const r of result.detected_risks) {
      const emoji = r.severity === "critical" ? "🔴" : r.severity === "high" ? "🟠" : "🟡";
      lines.push(`${emoji} ${r.description}`);
    }
  }

  if (result.needs_clarification) {
    lines.push("", `❓ Ожидаем уточнения от сотрудника.`);
  }

  if (needsOwnerReview) {
    lines.push("", `_/report\\_confirm ${reportId} — подтвердить · /report\\_show ${reportId} — детали_`);
  }

  try {
    await api.sendMessage(Number(OWNER_CHAT_ID), lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err, reportId }, "Failed to notify owner about incoming report");
  }
}

const analysisTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleAnalysis(reportId: number, senderName: string, api: Context["api"]): void {
  const existing = analysisTimers.get(reportId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    analysisTimers.delete(reportId);
    void runAiAndProcess(reportId, senderName, api);
  }, 2500);

  analysisTimers.set(reportId, timer);
}

export async function handleIncomingReport(ctx: Context): Promise<void> {
  const msg = ctx.message!;
  const user = msg.from!;
  const senderName = senderDisplayName(user);
  const mediaGroupId: string | null = msg.media_group_id ?? null;

  let fileId: string;
  let fileType: "photo" | "document";

  if (msg.photo && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1]!.file_id;
    fileType = "photo";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = "document";
  } else {
    return;
  }

  const now = new Date();

  let existingReport: (typeof incomingReportsTable.$inferSelect) | null = null;

  if (mediaGroupId) {
    const [found] = await db
      .select()
      .from(incomingReportsTable)
      .where(eq(incomingReportsTable.mediaGroupId, mediaGroupId))
      .limit(1);
    existingReport = found ?? null;
  }

  if (!existingReport) {
    const recent = await findRecentReport(user.id, 90);
    if (recent && ["pending", "analyzing"].includes(recent.status)) {
      existingReport = recent;
    }
  }

  if (existingReport) {
    const fileUrl = await getTelegramFileUrl(fileId);
    await db.insert(incomingReportFilesTable).values({
      incomingReportId: existingReport.id,
      fileId,
      fileType,
      telegramFileUrl: fileUrl ?? undefined,
      telegramMessageId: msg.message_id,
    });

    await db
      .update(incomingReportsTable)
      .set({ updatedAt: now })
      .where(eq(incomingReportsTable.id, existingReport.id));

    scheduleAnalysis(existingReport.id, existingReport.senderName ?? senderName, ctx.api);

    logger.debug({ reportId: existingReport.id, fileId }, "File appended to existing incoming report");
    return;
  }

  const fileUrl = await getTelegramFileUrl(fileId);

  const [record] = await db
    .insert(incomingReportsTable)
    .values({
      senderTelegramId: user.id,
      senderName,
      mediaGroupId,
      rawJson: JSON.stringify(msg),
      status: "pending",
    })
    .returning();

  if (!record) {
    logger.error({ senderTelegramId: user.id }, "Failed to create incoming report");
    return;
  }

  await db.insert(incomingReportFilesTable).values({
    incomingReportId: record.id,
    fileId,
    fileType,
    telegramFileUrl: fileUrl ?? undefined,
    telegramMessageId: msg.message_id,
  });

  logger.info({ reportId: record.id, senderTelegramId: user.id, senderName, mediaGroupId }, "Incoming report created");

  await ctx.reply(
    "📥 Отчёт получен. Анализирую...",
  );

  scheduleAnalysis(record.id, senderName, ctx.api);
}

export async function handleClarificationReply(ctx: Context): Promise<boolean> {
  const msg = ctx.message!;
  const user = msg.from!;
  const text = msg.text ?? "";

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pending] = await db
    .select()
    .from(incomingReportsTable)
    .where(
      and(
        eq(incomingReportsTable.senderTelegramId, user.id),
        eq(incomingReportsTable.status, "needs_clarification"),
        gte(incomingReportsTable.createdAt, since),
      ),
    )
    .orderBy(desc(incomingReportsTable.createdAt))
    .limit(1);

  if (!pending) return false;

  const detectedLocation = detectLocationInText(text);
  const now = new Date();

  if (!detectedLocation) {
    await ctx.reply(
      "Не распознал точку. Напиши одним словом: *Алдан*, *Нерюнгри* или *Куранах*.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  const files = await db
    .select()
    .from(incomingReportFilesTable)
    .where(eq(incomingReportFilesTable.incomingReportId, pending.id));

  const existingAnalysis = pending.aiAnalysisJson
    ? (JSON.parse(pending.aiAnalysisJson) as Record<string, unknown>)
    : {};

  await db
    .update(incomingReportsTable)
    .set({
      detectedLocation,
      needsClarification: false,
      clarificationQuestion: null,
      status: "received",
      updatedAt: now,
    })
    .where(eq(incomingReportsTable.id, pending.id));

  logger.info({ reportId: pending.id, location: detectedLocation }, "Location set via clarification reply");

  const reportType = (existingAnalysis["report_type"] as string) ?? "unknown_report";
  const senderName = pending.senderName ?? senderDisplayName(user);

  if (reportType === "cashier_report" || reportType === "unknown_report") {
    await syncToCashierReports(pending.id, { ...pending, senderName }, detectedLocation, files, senderName);
    void closeMissingCashierReportRisk(detectedLocation).catch(err =>
      logger.error({ err, location: detectedLocation }, "Failed to close missing cashier risk"),
    );
  }

  await ctx.reply(`✅ Принято! Точка: *${detectedLocation}*. Спасибо!`, { parse_mode: "Markdown" });

  if (OWNER_CHAT_ID) {
    const lines = [
      `✅ *Точка уточнена*`,
      `👤 Сотрудник: ${senderName}`,
      `📍 Точка: *${detectedLocation}*`,
      `🆔 ID отчёта: ${pending.id}`,
    ];
    try {
      await ctx.api.sendMessage(Number(OWNER_CHAT_ID), lines.join("\n"), { parse_mode: "Markdown" });
    } catch (err) {
      logger.error({ err }, "Failed to notify owner about clarification");
    }
  }

  return true;
}
