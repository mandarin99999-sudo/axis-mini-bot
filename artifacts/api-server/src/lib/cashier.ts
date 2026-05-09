import type { Context } from "grammy";
import { db, cashierReportsTable, cashierReportFilesTable } from "@workspace/db";
import { eq, and, gte, desc, count } from "drizzle-orm";
import { logger } from "./logger";
import { closeMissingCashierReportRisk } from "./cashier_risk_checker";

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

async function getFileCount(cashierReportId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(cashierReportFilesTable)
    .where(eq(cashierReportFilesTable.cashierReportId, cashierReportId));
  return row?.total ?? 0;
}

async function notifyOwner(
  api: Context["api"],
  opts: {
    reportId: number;
    senderName: string;
    location: string | null;
    caption: string | null;
    detectionSource: string;
    fileCount: number;
  },
): Promise<void> {
  if (!OWNER_CHAT_ID) return;

  const locationLine =
    opts.location
      ? `📍 Точка: *${opts.location}* (${
          opts.detectionSource === "caption" ? "по подписи"
          : opts.detectionSource === "manual_reply" ? "по ответу"
          : opts.detectionSource
        })`
      : "📍 Точка: не определена — ожидаем ответа";

  const lines = [
    "🧾 *Кассовый отчёт получен*",
    "",
    `👤 Сотрудник: ${opts.senderName}`,
    locationLine,
    `📎 Файлов: *${opts.fileCount}*`,
  ];
  if (opts.caption) lines.push(`💬 Подпись: _${opts.caption}_`);
  lines.push(`🆔 ID записи: ${opts.reportId}`);

  try {
    await api.sendMessage(Number(OWNER_CHAT_ID), lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err, reportId: opts.reportId }, "Failed to notify owner about cashier report");
  }
}

// In-process debounce for owner notifications (keyed by report id).
// Timer fires 2.5 s after the last file in the batch arrives.
const notificationTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleOwnerNotification(
  reportId: number,
  api: Context["api"],
  senderName: string,
  caption: string | null,
): void {
  const existing = notificationTimers.get(reportId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    notificationTimers.delete(reportId);
    try {
      const [report] = await db
        .select()
        .from(cashierReportsTable)
        .where(eq(cashierReportsTable.id, reportId))
        .limit(1);
      if (!report) return;

      const fileCount = await getFileCount(reportId);
      await notifyOwner(api, {
        reportId,
        senderName,
        location: report.detectedLocation,
        caption,
        detectionSource: report.detectionSource,
        fileCount,
      });
    } catch (err) {
      logger.error({ err, reportId }, "Deferred owner notification failed");
    }
  }, 2500);

  notificationTimers.set(reportId, timer);
}

// Find the most recent active report for a sender within `withinSeconds`.
async function findRecentReport(
  senderTelegramId: number,
  withinSeconds: number,
): Promise<(typeof cashierReportsTable.$inferSelect) | null> {
  const since = new Date(Date.now() - withinSeconds * 1000);
  const [row] = await db
    .select()
    .from(cashierReportsTable)
    .where(
      and(
        eq(cashierReportsTable.senderTelegramId, senderTelegramId),
        gte(cashierReportsTable.createdAt, since),
      ),
    )
    .orderBy(desc(cashierReportsTable.createdAt))
    .limit(1);
  return row ?? null;
}

export async function handleCashierReport(ctx: Context): Promise<void> {
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

  const caption = msg.caption ?? null;
  const now = new Date();

  // --- Try to find existing report to attach this file to ---

  let existingReport: (typeof cashierReportsTable.$inferSelect) | null = null;

  if (mediaGroupId) {
    // Primary match: same media_group_id
    const [found] = await db
      .select()
      .from(cashierReportsTable)
      .where(eq(cashierReportsTable.mediaGroupId, mediaGroupId))
      .limit(1);
    existingReport = found ?? null;
  }

  if (!existingReport) {
    // Fallback: same sender had a report in the last 90 s
    const recent = await findRecentReport(user.id, 90);
    if (recent) existingReport = recent;
  }

  if (existingReport) {
    // Add file to existing report
    await db.insert(cashierReportFilesTable).values({
      cashierReportId: existingReport.id,
      fileId,
      fileType,
      telegramMessageId: msg.message_id,
    });

    await db
      .update(cashierReportsTable)
      .set({ lastFileAt: now, updatedAt: now })
      .where(eq(cashierReportsTable.id, existingReport.id));

    logger.debug(
      { reportId: existingReport.id, mediaGroupId, fileId, fallback: !mediaGroupId },
      "File appended to existing report",
    );

    // If the report has location (received), reschedule owner notification
    // so we wait for all files before notifying.
    if (existingReport.status === "received" || existingReport.detectedLocation) {
      scheduleOwnerNotification(existingReport.id, ctx.api, existingReport.senderName ?? senderName, existingReport.caption);
    }

    // No user reply needed — already handled when report was created
    return;
  }

  // --- Create new report ---

  let detectedLocation: string | null = null;
  let detectionSource = "unknown";

  if (caption) {
    const found = detectLocationInText(caption);
    if (found) {
      detectedLocation = found;
      detectionSource = "caption";
    }
  }

  const status = detectedLocation ? "received" : "needs_location";

  const [record] = await db
    .insert(cashierReportsTable)
    .values({
      senderTelegramId: user.id,
      senderName,
      fileId,
      hasPhoto: fileType === "photo",
      hasDocument: fileType === "document",
      caption,
      detectedLocation,
      detectionSource,
      status,
      mediaGroupId,
      locationPromptSent: status === "needs_location",
      lastFileAt: now,
      reportType: "cashier_report",
      rawJson: JSON.stringify(msg),
    })
    .returning();

  if (!record) {
    logger.error({ senderTelegramId: user.id }, "Failed to insert cashier report");
    return;
  }

  await db.insert(cashierReportFilesTable).values({
    cashierReportId: record.id,
    fileId,
    fileType,
    telegramMessageId: msg.message_id,
  });

  logger.info(
    { reportId: record.id, senderTelegramId: user.id, senderName, detectedLocation, status, mediaGroupId },
    "Cashier report created",
  );

  if (status === "needs_location") {
    // Ask for location — owner is notified later, when location is confirmed
    await ctx.reply(
      "Отчёт получил. Не смог определить точку.\n\nНапиши одним сообщением: *Алдан*, *Нерюнгри* или *Куранах*.",
      { parse_mode: "Markdown" },
    );
  } else {
    // Location known — close missing-report risk immediately, then notify owner
    void closeMissingCashierReportRisk(detectedLocation!).catch(err =>
      logger.error({ err, location: detectedLocation }, "Failed to close missing cashier risk"),
    );
    await ctx.reply(
      `✅ Отчёт принят. Точка: *${detectedLocation}*. Спасибо!`,
      { parse_mode: "Markdown" },
    );
    scheduleOwnerNotification(record.id, ctx.api, senderName, caption);
  }
}

export async function handleLocationReply(ctx: Context): Promise<boolean> {
  const msg = ctx.message!;
  const user = msg.from!;
  const text = msg.text ?? "";

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pending] = await db
    .select()
    .from(cashierReportsTable)
    .where(
      and(
        eq(cashierReportsTable.senderTelegramId, user.id),
        eq(cashierReportsTable.status, "needs_location"),
        gte(cashierReportsTable.createdAt, since),
      ),
    )
    .orderBy(desc(cashierReportsTable.createdAt))
    .limit(1);

  if (!pending) return false;

  const found = detectLocationInText(text);
  if (!found) {
    await ctx.reply(
      "Не распознал точку. Напиши одним словом: *Алдан*, *Нерюнгри* или *Куранах*.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  await db
    .update(cashierReportsTable)
    .set({
      detectedLocation: found,
      detectionSource: "manual_reply",
      status: "received",
      updatedAt: new Date(),
    })
    .where(eq(cashierReportsTable.id, pending.id));

  logger.info({ reportId: pending.id, location: found }, "Cashier report location set via manual reply");

  const senderName = pending.senderName ?? senderDisplayName(user);
  const [fileCount] = await Promise.all([
    getFileCount(pending.id),
    closeMissingCashierReportRisk(found).catch(err =>
      logger.error({ err, location: found }, "Failed to close missing cashier risk"),
    ),
  ]);

  await ctx.reply(`✅ Принято! Точка: *${found}*. Спасибо!`, { parse_mode: "Markdown" });

  // Now we have all files — notify owner with actual file count
  await notifyOwner(ctx.api, {
    reportId: pending.id,
    senderName,
    location: found,
    caption: pending.caption,
    detectionSource: "manual_reply",
    fileCount,
  });

  return true;
}
