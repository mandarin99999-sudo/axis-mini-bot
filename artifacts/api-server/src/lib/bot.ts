import { Bot, type Context } from "grammy";
import { db } from "@workspace/db";
import { chatsTable, messagesTable, rulesTable, incomingReportsTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
import { logger } from "./logger";
import { scanMessage } from "./scanner";
import { handleIncomingReport, handleClarificationReply } from "./incoming_handler";
import { analyzeAndStoreMessage, formatMessageAiOwnerAlert } from "./message_ai_analyzer";
import { aiBusinessRuleCategory } from "./business_rules";
import { fetchBusinessSkills, tryHandleBusinessSkillInstruction } from "./business_skills";
import { answerOwnerQuestion } from "./owner_query";
import {
  handleOwnerOnboardingReply,
  maybePromptOwnerOnboarding,
  setOwnerPreferredLanguage,
  startOwnerOnboarding,
} from "./owner_onboarding";
import { handleTaskConfirmationReply, handleTaskDoneCommand } from "./task_followup";
import { miniAppDebugInfo, miniAppReplyMarkup, sendMiniAppButton } from "./mini_app";

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

export const bot = new Bot(token);

const OWNER_CHAT_ID = process.env["REPORT_CHAT_ID"];
const OWNER_QUESTION_TTL_MS = 10 * 60 * 1000;
const ownerQuestionLocks = new Map<string, ReturnType<typeof setTimeout>>();

function isOwner(ctx: Context): boolean {
  return !OWNER_CHAT_ID || String(ctx.from?.id) === OWNER_CHAT_ID;
}

async function requireOwner(ctx: Context): Promise<boolean> {
  if (isOwner(ctx)) return true;
  await ctx.reply("Эта команда доступна только владельцу.");
  return false;
}

function claimOwnerQuestion(chatId: number, messageId: number): boolean {
  const key = `${chatId}:${messageId}`;
  if (ownerQuestionLocks.has(key)) return false;

  const timer = setTimeout(() => {
    ownerQuestionLocks.delete(key);
  }, OWNER_QUESTION_TTL_MS);
  ownerQuestionLocks.set(key, timer);
  return true;
}

function answerOwnerQuestionInBackground(chatId: number, question: string, ownerTelegramId?: number | null): void {
  void (async () => {
    try {
      const answer = await answerOwnerQuestion(question, ownerTelegramId);
      await bot.api.sendMessage(chatId, answer);
    } catch (err) {
      logger.error({ err, chatId }, "Failed to answer owner question in background");
      await bot.api.sendMessage(chatId, "Не смог ответить по памяти из-за ошибки анализа. Проверь логи Replit.");
    }
  })();
}

function senderDisplayName(msg: NonNullable<Context["message"]>): string | null {
  const from = msg.from;
  if (!from) return null;
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return fullName || from.username || String(from.id);
}

function buildRuleName(text: string): string {
  const named = text.match(/^([a-z0-9_-]{3,64})\s*[:=-]\s+(.+)$/i);
  if (named?.[1]) return named[1].toLowerCase();

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `teach_${stamp}_${suffix}`;
}

function extractRuleDescription(text: string): string {
  const named = text.match(/^([a-z0-9_-]{3,64})\s*[:=-]\s+(.+)$/i);
  return (named?.[2] ?? text).trim();
}

bot.on("message", async (ctx, next) => {
  const msg = ctx.message;
  const chat = ctx.chat;

  if (msg.text?.startsWith("/")) {
    return next();
  }

  if (chat.type === "private") {
    const hasFile = !!(msg.photo || msg.document);

    if (hasFile) {
      try {
        await handleIncomingReport(ctx);
      } catch (err) {
        logger.error({ err, userId: msg.from?.id }, "Failed to handle incoming report");
        await ctx.reply("Произошла ошибка при сохранении отчёта. Попробуйте ещё раз.");
      }
      return;
    }

    if (msg.text && !msg.text.startsWith("/")) {
      try {
        const handled = await handleClarificationReply(ctx);
        if (handled) return;
      } catch (err) {
        logger.error({ err, userId: msg.from?.id }, "Failed to handle clarification reply");
      }

      if (isOwner(ctx)) {
        if (!claimOwnerQuestion(chat.id, msg.message_id)) return;
        const onboardingHandled = await handleOwnerOnboardingReply(ctx);
        if (onboardingHandled) return;

        const skillHandled = await tryHandleBusinessSkillInstruction(ctx);
        if (skillHandled) return;

        await ctx.reply("Думаю по памяти рабочих чатов...");
        answerOwnerQuestionInBackground(chat.id, msg.text, ctx.from?.id);
        return;
      }
    }

    return;
  }

  try {
    await db
      .insert(chatsTable)
      .values({
        id: chat.id,
        title: "title" in chat ? chat.title : undefined,
        type: chat.type,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: chatsTable.id,
        set: {
          title: "title" in chat ? chat.title : sql`${chatsTable.title}`,
          type: chat.type,
          updatedAt: new Date(),
        },
      });

    const messageText = msg.text ?? msg.caption ?? null;
    const chatTitle = "title" in chat ? chat.title : null;

    const [saved] = await db.insert(messagesTable).values({
      telegramMessageId: msg.message_id,
      chatId: chat.id,
      fromUserId: msg.from?.id ?? null,
      fromUsername: msg.from?.username ?? null,
      fromFirstName: msg.from?.first_name ?? null,
      fromLastName: msg.from?.last_name ?? null,
      text: messageText,
      rawJson: JSON.stringify(msg),
    }).returning({ id: messagesTable.id });

    logger.debug({ chatId: chat.id, messageId: msg.message_id }, "Message saved");

    if ((msg.photo || msg.document) && saved) {
      try {
        await handleIncomingReport(ctx);
      } catch (err) {
        logger.error({ err, chatId: chat.id, messageId: msg.message_id }, "Failed to handle group report");
        await ctx.reply("Произошла ошибка при сохранении отчёта. Попробуйте ещё раз.");
      }
    }

    if (messageText && saved) {
      const taskConfirmationHandled = await handleTaskConfirmationReply(ctx);
      if (taskConfirmationHandled) return;

      const matches = await scanMessage({
        messageId: saved.id,
        chatId: chat.id,
        text: messageText,
      });

      if (matches.length > 0) {
        logger.info(
          { chatId: chat.id, messageId: saved.id, matchCount: matches.length, rules: matches.map(m => m.ruleName) },
          "Scanner found matches",
        );
      }

      const aiResult = await analyzeAndStoreMessage({
        messageId: saved.id,
        chatId: chat.id,
        chatTitle,
        fromUserId: msg.from?.id ?? null,
        fromUsername: msg.from?.username ?? null,
        senderName: senderDisplayName(msg),
        text: messageText,
      });

      if (aiResult?.owner_alert && OWNER_CHAT_ID) {
        await bot.api.sendMessage(
          Number(OWNER_CHAT_ID),
          formatMessageAiOwnerAlert({
            chatTitle,
            senderName: senderDisplayName(msg),
            text: messageText,
            analysis: aiResult,
          }),
        );
      }
    }
  } catch (err) {
    logger.error({ err, chatId: chat.id }, "Failed to process message");
  }
});

bot.command("start", async (ctx) => {
  const isPrivate = ctx.chat.type === "private";

  if (isPrivate) {
    await ctx.reply(
      "Привет! Я Ось-бот (AXIS Mini) — AI-секретарь Шеф Бургер.\n\n" +
      "📥 *Приём отчётов*\n" +
      "Отправь мне фото или документ любого отчёта — кассового, менеджерского, курьерского и т.д.\n" +
      "AI автоматически определит тип, точку и извлечёт ключевые данные.\n\n" +
      "Можно отправить несколько фото сразу — все страницы будут объединены.\n\n" +
      "Можно обучать меня обычным языком: «AXIS, если ... то ...».\n\n" +
      "/onboard — подключить бизнес и включить пилот\n" +
      "/app — открыть кабинет AXIS\n" +
      "/app_debug — диагностика Mini App\n" +
      "/language <код> — язык AXIS\n" +
      "/pilot — отчёт ценности пилота\n" +
      "/billing — тариф и подписка\n" +
      "/status — статус бота",
      { parse_mode: "Markdown", reply_markup: miniAppReplyMarkup() },
    );
    if (isOwner(ctx)) {
      await maybePromptOwnerOnboarding(ctx);
    }
    return;
  }

  await ctx.reply(
    "Привет! Я Ось-бот (axis-mini-bot) — секретарь Шеф Бургер.\n\n" +
    "Слежу за чатами, фиксирую задачи, дедлайны и риски. Каждый день в 16:00 МСК отправляю доклад.\n\n" +
    "Команды:\n" +
    "/today — доклад за сегодня\n" +
    "/risks — открытые риски за сегодня\n" +
    "/ask <вопрос> — спросить AXIS по памяти рабочих чатов\n" +
    "/done <id> — закрыть задачу\n" +
    "/onboard — подключить бизнес и включить пилот\n" +
    "/app — открыть кабинет AXIS\n" +
    "/app_debug — диагностика Mini App\n" +
    "/language <код> — язык AXIS\n" +
    "/pilot — отчёт ценности пилота\n" +
    "/billing — тариф и подписка\n" +
    "Можно обучать без команды: «AXIS, если ... то ...»\n" +
    "/teach <правило> — научить бота правилу бизнеса\n" +
    "/memory — активные AI-правила\n" +
    "/rules — список всех правил\n" +
    "/rule\\_on <название> — включить правило\n" +
    "/rule\\_off <название> — выключить правило\n" +
    "/rule\\_update <название> <новый текст> — изменить правило\n" +
    "/rule\\_delete <название> — выключить правило\n" +
    "/rule\\_show <название> — подробности правила\n" +
    "/status — статус бота",
    { parse_mode: "Markdown" },
  );
});

bot.command("onboard", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await startOwnerOnboarding(ctx);
});

bot.command("app", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await sendMiniAppButton(ctx);
});

bot.command("app_debug", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.reply(miniAppDebugInfo(), { reply_markup: miniAppReplyMarkup() });
});

bot.command("language", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await setOwnerPreferredLanguage(ctx, ctx.match?.trim());
});

bot.command("pilot", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  await ctx.reply("Собираю отчёт ценности пилота...");

  try {
    const { buildPilotValueReport, formatPilotValueReportForTelegram } = await import("./pilot_value_report");
    const report = await buildPilotValueReport(30);
    await ctx.reply(formatPilotValueReportForTelegram(report));
  } catch (err) {
    logger.error({ err }, "Failed to build pilot value report");
    await ctx.reply("Не смог собрать отчёт пилота. Проверь логи Replit.");
  }
});

bot.command("billing", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  try {
    const { formatBillingStatusForTelegram, getBillingStatus } = await import("./billing");
    const status = await getBillingStatus(ctx.from?.id);
    await ctx.reply(formatBillingStatusForTelegram(status));
  } catch (err) {
    logger.error({ err }, "Failed to get billing status");
    await ctx.reply("Не смог получить статус подписки. Проверь логи Replit.");
  }
});

bot.command("status", async (ctx) => {
  try {
    const now = new Date();

    const nextReport = new Date();
    nextReport.setUTCHours(13, 0, 0, 0);
    if (nextReport <= now) nextReport.setUTCDate(nextReport.getUTCDate() + 1);
    const diffMs = nextReport.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor((diffMs % 3600000) / 60000);
    const nextReportStr = `${String(diffH).padStart(2, "0")}:${String(diffM).padStart(2, "0")}`;

    const row = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM chats WHERE is_active = true)::int AS active_chats,
        (SELECT COUNT(*) FROM messages WHERE received_at >= CURRENT_DATE)::int AS messages_today,
        (SELECT COUNT(*) FROM risks WHERE status = 'open' AND detected_at >= CURRENT_DATE)::int AS risks_today,
        (SELECT COUNT(*) FROM tasks WHERE status IN ('open','deadline_open','waiting_confirmation') AND extracted_at >= CURRENT_DATE)::int AS tasks_today,
        (SELECT COUNT(*) FROM risks WHERE status = 'open' AND detected_at >= CURRENT_DATE AND severity IN ('critical','high'))::int AS high_risks_today,
        (SELECT COUNT(*) FROM cashier_reports WHERE created_at >= CURRENT_DATE)::int AS cashier_reports_today,
        (SELECT COUNT(*) FROM cashier_reports WHERE status = 'needs_location' AND created_at >= CURRENT_DATE)::int AS needs_location_today,
        (SELECT COUNT(*) FROM cashier_report_files crf JOIN cashier_reports cr ON cr.id = crf.cashier_report_id WHERE cr.created_at >= CURRENT_DATE)::int AS cashier_files_today,
        (SELECT COUNT(*) FROM risks WHERE rule_name = 'missing_cashier_report' AND status = 'open' AND detected_at >= CURRENT_DATE)::int AS missing_cashier_today
    `);

    const s = (row.rows[0] ?? {}) as Record<string, number>;

    const cashierLine = s["cashier_reports_today"]
      ? `🧾 Кассовых отчётов: *${s["cashier_reports_today"]}* (файлов: ${s["cashier_files_today"] ?? 0}${s["needs_location_today"] ? `, ⚠️ без точки: ${s["needs_location_today"]}` : ""})`
      : `🧾 Кассовых отчётов: *0*`;

    const missingLine = (s["missing_cashier_today"] ?? 0) > 0
      ? `❌ Нет отчёта по *${s["missing_cashier_today"]}* точкам`
      : null;

    const lines = [
      "✅ *AXIS Mini Bot — статус*",
      "",
      `📡 Активных чатов: *${s["active_chats"] ?? 0}*`,
      `💬 Сообщений за сегодня: *${s["messages_today"] ?? 0}*`,
      `⚠️ Рисков за сегодня: *${s["risks_today"] ?? 0}* (critical/high: ${s["high_risks_today"] ?? 0})`,
      `📌 Открытых задач: *${s["tasks_today"] ?? 0}*`,
      cashierLine,
      ...(missingLine ? [missingLine] : []),
      "",
      `⏰ Следующий доклад через: *${nextReportStr}* (16:00 МСК)`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err }, "Failed to get status");
    await ctx.reply("Ошибка при получении статуса.");
  }
});

bot.command("today", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const targetId = OWNER_CHAT_ID ? Number(OWNER_CHAT_ID) : ctx.chat.id;

  await ctx.reply("⏳ Формирую доклад за сегодня...");

  try {
    const { generateReport } = await import("./reporter");
    const report = await generateReport();
    await bot.api.sendMessage(targetId, report, { parse_mode: "MarkdownV2" });

    if (targetId !== ctx.chat.id) {
      await ctx.reply("✅ Доклад отправлен владельцу.");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send /today report");
    await ctx.reply("Ошибка при формировании доклада. Проверьте логи.");
  }
});

bot.command("risks", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  try {
    const { generateRisksMessage } = await import("./reporter");
    const msg = await generateRisksMessage();
    await ctx.reply(msg, { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error({ err }, "Failed to send /risks");
    await ctx.reply("Ошибка при получении рисков.");
  }
});

bot.command("done", async (ctx) => {
  await handleTaskDoneCommand(ctx);
});

bot.command("ask", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const question = ctx.match?.trim();
  if (!question) {
    await ctx.reply(
      [
        "Формат: /ask <вопрос>",
        "",
        "Примеры:",
        "/ask Что важного сегодня?",
        "/ask Когда поставили чизкейк в стоп?",
        "/ask Кто обещал отправить счёт?",
      ].join("\n"),
    );
    return;
  }

  if (!claimOwnerQuestion(ctx.chat.id, ctx.message?.message_id ?? Date.now())) return;
  await ctx.reply("Ищу по памяти рабочих чатов...");
  answerOwnerQuestionInBackground(ctx.chat.id, question, ctx.from?.id);
});

bot.command("teach", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const raw = ctx.match?.trim();
  if (!raw) {
    await ctx.reply(
      [
        "Формат:",
        "/teach <правило обычным языком>",
        "",
        "Можно задать имя:",
        "/teach bank_expense_check: Банковский скрин по хознуждам должен совпадать с авансовым отчётом. Если авансового отчёта нет — риск high.",
      ].join("\n"),
    );
    return;
  }

  const name = buildRuleName(raw);
  const description = extractRuleDescription(raw);

  try {
    const [rule] = await db
      .insert(rulesTable)
      .values({
        name,
        description,
        category: aiBusinessRuleCategory(),
        isActive: true,
      })
      .onConflictDoUpdate({
        target: rulesTable.name,
        set: {
          description,
          category: aiBusinessRuleCategory(),
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    await ctx.reply(
      [
        "✅ Правило сохранено.",
        `Название: ${rule?.name ?? name}`,
        "",
        description,
        "",
        "Теперь AI будет учитывать его при анализе сообщений и отчётов.",
      ].join("\n"),
    );
  } catch (err) {
    logger.error({ err, name }, "Failed to teach AI business rule");
    await ctx.reply("Ошибка при сохранении правила.");
  }
});

bot.command("memory", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  try {
    const [rules, skills] = await Promise.all([
      db
        .select()
        .from(rulesTable)
        .where(eq(rulesTable.isActive, true))
        .orderBy(rulesTable.createdAt),
      fetchBusinessSkills(50),
    ]);

    const aiRules = rules.filter(rule => rule.category === aiBusinessRuleCategory());
    if (aiRules.length === 0 && skills.length === 0) {
      await ctx.reply("Память навыков пока пустая. Напиши, например: AXIS, если задача просрочена — напомни ответственному и сообщи мне.");
      return;
    }

    const lines = ["Активная память AXIS:", ""];
    if (skills.length > 0) {
      lines.push("No-code навыки:");
      for (const skill of skills.slice(-30)) {
        lines.push(`- ${skill.title}: ${skill.actionSummary}`);
      }
      lines.push("");
    }

    if (aiRules.length > 0) {
      lines.push("AI-правила:");
      for (const rule of aiRules.slice(-30)) {
        lines.push(`${rule.name}: ${rule.description}`);
      }
    }
    await ctx.reply(lines.join("\n"));
  } catch (err) {
    logger.error({ err }, "Failed to show AI business memory");
    await ctx.reply("Ошибка при получении AI-правил.");
  }
});

bot.command("rules", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  try {
    const rules = await db.select().from(rulesTable).orderBy(rulesTable.category, rulesTable.name);

    if (rules.length === 0) {
      await ctx.reply("Правил пока нет.");
      return;
    }

    const lines: string[] = ["📋 *Список правил:*", ""];

    let currentCategory = "";
    for (const rule of rules) {
      if (rule.category !== currentCategory) {
        currentCategory = rule.category;
        lines.push(`*${categoryLabel(currentCategory)}*`);
      }
      const status = rule.isActive ? "🟢" : "🔴";
      lines.push(`${status} \`${rule.name}\` — ${rule.description}`);
    }

    lines.push("");
    lines.push("_/rule\\_on <название> — включить_");
    lines.push("_/rule\\_off <название> — выключить_");

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err }, "Failed to list rules");
    await ctx.reply("Ошибка при получении правил.");
  }
});

bot.command("rule_on", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const name = ctx.match?.trim();
  if (!name) {
    await ctx.reply("Укажите название правила: /rule\\_on <название>", { parse_mode: "Markdown" });
    return;
  }
  try {
    const [rule] = await db
      .update(rulesTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(ilike(rulesTable.name, name))
      .returning();
    if (!rule) {
      await ctx.reply(`Правило \`${name}\` не найдено.`, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply(`✅ Правило \`${rule.name}\` включено.`, { parse_mode: "Markdown" });
    logger.info({ ruleName: rule.name }, "Rule enabled");
  } catch (err) {
    logger.error({ err, name }, "Failed to enable rule");
    await ctx.reply("Ошибка при включении правила.");
  }
});

bot.command("rule_off", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const name = ctx.match?.trim();
  if (!name) {
    await ctx.reply("Укажите название правила: /rule\\_off <название>", { parse_mode: "Markdown" });
    return;
  }
  try {
    const [rule] = await db
      .update(rulesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(ilike(rulesTable.name, name))
      .returning();
    if (!rule) {
      await ctx.reply(`Правило \`${name}\` не найдено.`, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply(`🔴 Правило \`${rule.name}\` выключено.`, { parse_mode: "Markdown" });
    logger.info({ ruleName: rule.name }, "Rule disabled");
  } catch (err) {
    logger.error({ err, name }, "Failed to disable rule");
    await ctx.reply("Ошибка при выключении правила.");
  }
});

bot.command("rule_show", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const name = ctx.match?.trim();
  if (!name) {
    await ctx.reply("Укажите название правила: /rule\\_show <название>", { parse_mode: "Markdown" });
    return;
  }
  try {
    const [rule] = await db
      .select()
      .from(rulesTable)
      .where(ilike(rulesTable.name, name))
      .limit(1);
    if (!rule) {
      await ctx.reply(`Правило \`${name}\` не найдено.`, { parse_mode: "Markdown" });
      return;
    }
    const status = rule.isActive ? "🟢 Активно" : "🔴 Выключено";
    const lines = [
      `📌 *${rule.name}*`,
      "",
      `Статус: ${status}`,
      `Категория: ${categoryLabel(rule.category)}`,
      `Описание: ${rule.description}`,
    ];
    if (rule.pattern) lines.push(`Паттерн: \`${rule.pattern}\``);
    lines.push(`Создано: ${rule.createdAt.toLocaleDateString("ru-RU")}`);
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err, name }, "Failed to show rule");
    await ctx.reply("Ошибка при получении правила.");
  }
});

bot.command("rule_update", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const raw = ctx.match?.trim() ?? "";
  const spaceIdx = raw.indexOf(" ");
  if (spaceIdx === -1) {
    await ctx.reply("Формат: /rule_update <название> <новый текст правила>");
    return;
  }

  const name = raw.slice(0, spaceIdx).trim();
  const description = raw.slice(spaceIdx + 1).trim();
  if (!name || !description) {
    await ctx.reply("Формат: /rule_update <название> <новый текст правила>");
    return;
  }

  try {
    const [rule] = await db
      .update(rulesTable)
      .set({
        description,
        category: aiBusinessRuleCategory(),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(ilike(rulesTable.name, name))
      .returning();

    if (!rule) {
      await ctx.reply(`Правило ${name} не найдено.`);
      return;
    }

    await ctx.reply(`✅ Правило ${rule.name} обновлено.`);
  } catch (err) {
    logger.error({ err, name }, "Failed to update AI business rule");
    await ctx.reply("Ошибка при обновлении правила.");
  }
});

bot.command("rule_delete", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const name = ctx.match?.trim();
  if (!name) {
    await ctx.reply("Формат: /rule_delete <название>");
    return;
  }

  try {
    const [rule] = await db
      .update(rulesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(ilike(rulesTable.name, name))
      .returning();

    if (!rule) {
      await ctx.reply(`Правило ${name} не найдено.`);
      return;
    }

    await ctx.reply(`🗑 Правило ${rule.name} выключено.`);
  } catch (err) {
    logger.error({ err, name }, "Failed to delete AI business rule");
    await ctx.reply("Ошибка при выключении правила.");
  }
});

const REPORT_TYPE_LABEL: Record<string, string> = {
  cashier_report: "🧾 Кассовый",
  manager_shift_report: "📋 Менеджерский",
  courier_report: "🛵 Курьерский",
  vehicle_mileage_report: "🚗 Транспорт",
  invoice_or_expense: "🧾 Накладная",
  delivery_cash_report: "💰 Доставка (нал)",
  unknown_report: "❓ Неизвестный",
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: "⏳ ожидает проверки",
  confirmed: "✅ подтверждён",
  corrected: "✏️ исправлен",
  ignored: "🚫 проигнорирован",
  not_required: "➖ не требуется",
};

bot.command("report_show", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const idStr = ctx.match?.trim();
  if (!idStr || !/^\d+$/.test(idStr)) {
    await ctx.reply("Укажите ID отчёта: /report\\_show <id>", { parse_mode: "Markdown" });
    return;
  }
  const id = Number(idStr);
  try {
    const [report] = await db
      .select()
      .from(incomingReportsTable)
      .where(eq(incomingReportsTable.id, id))
      .limit(1);
    if (!report) {
      await ctx.reply(`Отчёт #${id} не найден.`);
      return;
    }

    const typeLabel = REPORT_TYPE_LABEL[report.reportType] ?? report.reportType;
    const locStr = report.detectedLocation ?? "не определена";
    const confEmoji = report.confidence === "high" ? "🟢" : report.confidence === "medium" ? "🟡" : report.confidence === "low" ? "🔴" : "⚪";
    const reviewLabel = REVIEW_STATUS_LABEL[report.ownerReviewStatus] ?? report.ownerReviewStatus;
    const senderName = report.senderName ?? `user_${report.senderTelegramId}`;

    const lines = [
      `📄 *Отчёт #${id}*`,
      "",
      `👤 Сотрудник: ${senderName}`,
      `📑 Тип: ${typeLabel}`,
      `📍 Точка: ${locStr}`,
      `📅 Дата отчёта: ${report.detectedDate ?? "не распознана"}`,
      `${confEmoji} Уверенность AI: ${report.confidence ?? "—"}`,
      `🔎 Статус проверки: ${reviewLabel}`,
      `📌 Статус: ${report.status}`,
      `🕐 Получен: ${report.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`,
    ];

    if (report.aiErrorNotes) {
      lines.push("", `⚠️ Причина проверки: ${report.aiErrorNotes}`);
    }

    if (report.summary) {
      lines.push("", `📝 Краткое содержание:`, report.summary);
    }

    const amounts = report.detectedAmountsJson
      ? (JSON.parse(report.detectedAmountsJson) as Array<{ label: string; value: string }>)
      : [];
    if (amounts.length > 0) {
      lines.push("", "*Суммы:*");
      for (const a of amounts) lines.push(`• ${a.label}: ${a.value}`);
    }

    const risks = report.detectedRisksJson
      ? (JSON.parse(report.detectedRisksJson) as Array<{ severity: string; description: string }>)
      : [];
    if (risks.length > 0) {
      lines.push("", "*⚠️ Риски AI:*");
      for (const r of risks) {
        const emoji = r.severity === "critical" ? "🔴" : r.severity === "high" ? "🟠" : "🟡";
        lines.push(`${emoji} ${r.description}`);
      }
    }

    if (report.ownerCorrectionJson) {
      const corr = JSON.parse(report.ownerCorrectionJson) as { text: string; at: string };
      lines.push("", `✏️ Исправление владельца:`, corr.text, `_${corr.at}_`);
    }

    if (report.needsOwnerReview && report.ownerReviewStatus === "pending") {
      lines.push("", `/report\\_confirm ${id} — подтвердить`, `/report\\_correct ${id} <текст> — исправить`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logger.error({ err, id }, "Failed to show report");
    await ctx.reply("Ошибка при получении отчёта.");
  }
});

bot.command("report_confirm", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const idStr = ctx.match?.trim();
  if (!idStr || !/^\d+$/.test(idStr)) {
    await ctx.reply("Укажите ID отчёта: /report\\_confirm <id>", { parse_mode: "Markdown" });
    return;
  }
  const id = Number(idStr);
  try {
    const [report] = await db
      .select()
      .from(incomingReportsTable)
      .where(eq(incomingReportsTable.id, id))
      .limit(1);
    if (!report) {
      await ctx.reply(`Отчёт #${id} не найден.`);
      return;
    }
    await db
      .update(incomingReportsTable)
      .set({ ownerReviewStatus: "confirmed", updatedAt: new Date() })
      .where(eq(incomingReportsTable.id, id));
    logger.info({ id }, "Report confirmed by owner");
    await ctx.reply(`✅ Отчёт #${id} подтверждён — AI распознал правильно.`);
  } catch (err) {
    logger.error({ err, id }, "Failed to confirm report");
    await ctx.reply("Ошибка при подтверждении отчёта.");
  }
});

bot.command("report_correct", async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const match = ctx.match?.trim() ?? "";
  const spaceIdx = match.indexOf(" ");
  if (spaceIdx === -1) {
    await ctx.reply("Формат: /report\\_correct <id> <текст исправления>", { parse_mode: "Markdown" });
    return;
  }
  const idStr = match.slice(0, spaceIdx).trim();
  const correctionText = match.slice(spaceIdx + 1).trim();
  if (!idStr || !/^\d+$/.test(idStr) || !correctionText) {
    await ctx.reply("Формат: /report\\_correct <id> <текст исправления>", { parse_mode: "Markdown" });
    return;
  }
  const id = Number(idStr);
  try {
    const [report] = await db
      .select()
      .from(incomingReportsTable)
      .where(eq(incomingReportsTable.id, id))
      .limit(1);
    if (!report) {
      await ctx.reply(`Отчёт #${id} не найден.`);
      return;
    }
    const correctionJson = JSON.stringify({
      text: correctionText,
      at: new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
    });
    await db
      .update(incomingReportsTable)
      .set({
        ownerReviewStatus: "corrected",
        ownerCorrectionJson: correctionJson,
        updatedAt: new Date(),
      })
      .where(eq(incomingReportsTable.id, id));
    logger.info({ id, correctionText }, "Report corrected by owner");
    await ctx.reply(`✏️ Исправление к отчёту #${id} сохранено:\n"${correctionText}"`);
  } catch (err) {
    logger.error({ err, id }, "Failed to correct report");
    await ctx.reply("Ошибка при сохранении исправления.");
  }
});

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    task: "Задачи", tasks: "Задачи",
    risk: "Риски", risks: "Риски",
    deadline: "Дедлайны",
    report: "Отчёты", reports: "Отчёты",
    ai_business: "AI-правила бизнеса",
    business_skill: "No-code навыки бизнеса",
    finance: "Финансы",
    general: "Общие",
  };
  return labels[category] ?? category;
}
