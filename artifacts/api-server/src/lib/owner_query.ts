import { db } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { sql } from "drizzle-orm";
import {
  fetchFinanceEventsForOwnerMemory,
  formatFinanceEventsForPrompt,
  type FinanceMemoryEvent,
} from "./finance_memory";
import {
  fetchAccountingSummaryForOwnerMemory,
  formatAccountingSummaryForPrompt,
} from "./finance_accounting";
import { fetchBusinessSkills, formatBusinessSkillsForPrompt } from "./business_skills";
import {
  fetchOwnerBusinessProfile,
  formatBusinessProfileForPrompt,
} from "./owner_onboarding";
import { languageInstruction } from "./i18n";
import { logger } from "./logger";

type MemoryMessage = {
  id: number;
  chatId: number;
  chatTitle: string;
  author: string;
  text: string;
  receivedAt: Date;
};

type MemoryRisk = {
  severity: string;
  description: string;
  originalText: string | null;
  detectedAt: Date;
  chatTitle: string;
};

type MemoryTask = {
  description: string;
  originalText: string | null;
  assignedToUsername: string | null;
  deadline: Date | null;
  status: string;
  extractedAt: Date;
  chatTitle: string;
};

const OWNER_QUERY_SYSTEM_PROMPT = `Ты — AXIS Mini, живой AI-секретарь владельца бизнеса.

Ты отвечаешь владельцу по памяти рабочих Telegram-чатов. Не веди себя как технический бот.

Правила ответа:
- отвечай обычным человеческим языком;
- если вопрос "что важного" — дай управленческую сводку, а не статистику;
- если вопрос про историю — найди дату, чат, автора и суть;
- не выдумывай факты, которых нет в контексте;
- если данных не хватает, прямо скажи, что в памяти не найдено;
- выделяй риски, задачи, обещания, сроки и незакрытые вопросы;
- учитывай финансовую память как управленческий учет: доходы, расходы, обязательства, переводы, возвраты, центры затрат, проекты/объекты, контрагентов и документы. Конкретные товары в чеке — это детали, не основа ответа;
- отвечай на языке владельца из профиля бизнеса; если профиль не заполнен, отвечай на языке вопроса владельца;
- кратко объясняй, почему это важно владельцу.`;

const STOP_WORDS = new Set([
  "что", "как", "когда", "где", "кто", "кого", "кому", "чем", "по", "про", "или", "для",
  "это", "было", "были", "был", "была", "сегодня", "вчера", "завтра", "мне", "нам", "там",
  "все", "всё", "есть", "нет", "и", "а", "в", "на", "с", "у", "от", "до", "за",
]);

function isTodayQuestion(question: string): boolean {
  return /что\s+важн|важное\s+сегодня|сегодня|итог|сводк|доклад/i.test(question);
}

function extractKeywords(question: string): string[] {
  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ");

  const words = normalized
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));

  return [...new Set(words)].slice(0, 12);
}

function formatDate(value: Date | string | null): string {
  if (!value) return "без даты";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "без даты";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env["AXIS_TIMEZONE"] ?? "Asia/Yakutsk",
  });
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function authorFromRow(row: Record<string, unknown>): string {
  const username = typeof row["from_username"] === "string" ? row["from_username"] : null;
  const firstName = typeof row["from_first_name"] === "string" ? row["from_first_name"] : null;
  const lastName = typeof row["from_last_name"] === "string" ? row["from_last_name"] : null;
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || (username ? `@${username}` : "неизвестен");
}

async function fetchRecentMessages(days: number, limit: number): Promise<MemoryMessage[]> {
  const result = await db.execute(sql`
    SELECT
      m.id,
      m.chat_id,
      COALESCE(c.title, 'чат ' || m.chat_id::text) AS chat_title,
      m.from_username,
      m.from_first_name,
      m.from_last_name,
      m.text,
      m.received_at
    FROM messages m
    LEFT JOIN chats c ON c.id = m.chat_id
    WHERE m.text IS NOT NULL
      AND m.received_at >= NOW() - (${days}::text || ' days')::interval
    ORDER BY m.received_at DESC
    LIMIT ${limit}
  `);

  return result.rows
    .map(row => row as Record<string, unknown>)
    .filter(row => typeof row["text"] === "string")
    .map(row => ({
      id: Number(row["id"]),
      chatId: Number(row["chat_id"]),
      chatTitle: String(row["chat_title"] ?? "чат"),
      author: authorFromRow(row),
      text: String(row["text"]),
      receivedAt: new Date(String(row["received_at"])),
    }));
}

async function fetchTodayRisks(): Promise<MemoryRisk[]> {
  const result = await db.execute(sql`
    SELECT
      r.severity,
      r.description,
      r.original_text,
      r.detected_at,
      COALESCE(c.title, CASE WHEN r.chat_id = 0 THEN 'системный контроль' ELSE 'чат ' || r.chat_id::text END) AS chat_title
    FROM risks r
    LEFT JOIN chats c ON c.id = r.chat_id
    WHERE r.status = 'open'
      AND r.detected_at >= CURRENT_DATE
    ORDER BY
      CASE r.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      r.detected_at DESC
    LIMIT 40
  `);

  return result.rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      severity: String(r["severity"] ?? "medium"),
      description: String(r["description"] ?? ""),
      originalText: typeof r["original_text"] === "string" ? r["original_text"] : null,
      detectedAt: new Date(String(r["detected_at"])),
      chatTitle: String(r["chat_title"] ?? "чат"),
    };
  });
}

async function fetchTodayTasks(): Promise<MemoryTask[]> {
  const result = await db.execute(sql`
    SELECT
      t.description,
      t.original_text,
      t.assigned_to_username,
      t.deadline,
      t.status,
      t.extracted_at,
      COALESCE(c.title, 'чат ' || t.chat_id::text) AS chat_title
    FROM tasks t
    LEFT JOIN chats c ON c.id = t.chat_id
    WHERE t.status IN ('open', 'deadline_open', 'waiting_confirmation')
      AND t.extracted_at >= CURRENT_DATE
    ORDER BY t.deadline NULLS LAST, t.extracted_at DESC
    LIMIT 40
  `);

  return result.rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      description: String(r["description"] ?? ""),
      originalText: typeof r["original_text"] === "string" ? r["original_text"] : null,
      assignedToUsername: typeof r["assigned_to_username"] === "string" ? r["assigned_to_username"] : null,
      deadline: r["deadline"] ? new Date(String(r["deadline"])) : null,
      status: String(r["status"] ?? "open"),
      extractedAt: new Date(String(r["extracted_at"])),
      chatTitle: String(r["chat_title"] ?? "чат"),
    };
  });
}

function selectRelevantMessages(question: string, messages: MemoryMessage[]): MemoryMessage[] {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return messages.slice(0, 80);

  const scored = messages.map(message => {
    const haystack = `${message.chatTitle} ${message.author} ${message.text}`.toLowerCase();
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    return { message, score };
  });

  const matched = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.receivedAt.getTime() - a.message.receivedAt.getTime())
    .map(item => item.message);

  return (matched.length > 0 ? matched : messages).slice(0, 100);
}

function selectRelevantFinanceEvents(question: string, events: FinanceMemoryEvent[]): FinanceMemoryEvent[] {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return events.slice(0, 80);

  const scored = events.map(event => {
    const haystack = [
      event.eventType,
      event.flowType,
      event.location,
      event.amount,
      event.currency,
      event.category,
      event.managementCategory,
      event.costCenter,
      event.project,
      event.itemName,
      event.counterparty,
      event.paymentMethod,
      event.documentType,
      event.documentNumber,
      event.lineItems.map(item => item.name).join(" "),
      event.tags.join(" "),
      event.description,
      event.chatTitle,
    ].filter(Boolean).join(" ").toLowerCase();
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    return { event, score };
  });

  const matched = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.event.createdAt.getTime() - a.event.createdAt.getTime())
    .map(item => item.event);

  return (matched.length > 0 ? matched : events).slice(0, 80);
}

function formatMessagesForPrompt(messages: MemoryMessage[]): string {
  if (messages.length === 0) return "Сообщения не найдены.";

  return messages
    .map(message => [
      `Дата: ${formatDate(message.receivedAt)}`,
      `Чат: ${message.chatTitle}`,
      `Автор: ${message.author}`,
      `Текст: ${truncate(message.text)}`,
    ].join("\n"))
    .join("\n\n---\n\n");
}

function formatRisksForPrompt(risks: MemoryRisk[]): string {
  if (risks.length === 0) return "Открытых рисков за сегодня не найдено.";

  return risks
    .map(risk => [
      `Дата: ${formatDate(risk.detectedAt)}`,
      `Чат: ${risk.chatTitle}`,
      `Важность: ${risk.severity}`,
      `Риск: ${risk.description}`,
      risk.originalText ? `Источник: ${truncate(risk.originalText, 240)}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");
}

function formatTasksForPrompt(tasks: MemoryTask[]): string {
  if (tasks.length === 0) return "Открытых задач за сегодня не найдено.";

  return tasks
    .map(task => [
      `Дата: ${formatDate(task.extractedAt)}`,
      `Чат: ${task.chatTitle}`,
      `Задача: ${task.description}`,
      task.assignedToUsername ? `Ответственный: @${task.assignedToUsername}` : null,
      task.deadline ? `Срок: ${formatDate(task.deadline)}` : null,
      `Статус: ${task.status}`,
      task.originalText ? `Источник: ${truncate(task.originalText, 240)}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");
}

export async function answerOwnerQuestion(question: string, ownerTelegramId?: number | null): Promise<string> {
  const model = process.env["OPENAI_TEXT_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-5.4";
  const todayQuestion = isTodayQuestion(question);

  try {
    const [messages, risks, tasks, financeEventsRaw, accountingSummary, businessSkills, businessProfile] = await Promise.all([
      fetchRecentMessages(todayQuestion ? 2 : 60, todayQuestion ? 140 : 700),
      todayQuestion ? fetchTodayRisks() : Promise.resolve([]),
      todayQuestion ? fetchTodayTasks() : Promise.resolve([]),
      fetchFinanceEventsForOwnerMemory(todayQuestion ? 2 : 365, todayQuestion ? 80 : 500),
      fetchAccountingSummaryForOwnerMemory(todayQuestion ? 2 : 365),
      fetchBusinessSkills(50),
      ownerTelegramId ? fetchOwnerBusinessProfile(ownerTelegramId) : Promise.resolve(null),
    ]);

    const relevantMessages = todayQuestion ? messages.slice(0, 120) : selectRelevantMessages(question, messages);
    const relevantFinanceEvents = todayQuestion
      ? financeEventsRaw.slice(0, 80)
      : selectRelevantFinanceEvents(question, financeEventsRaw);

    const userContent = [
      `Вопрос владельца: ${question}`,
      "",
      "Профиль бизнеса:",
      formatBusinessProfileForPrompt(businessProfile),
      "",
      "Язык ответа владельцу:",
      languageInstruction(businessProfile?.preferredLanguage),
      "",
      "Активные no-code навыки и инструкции владельца:",
      formatBusinessSkillsForPrompt(businessSkills),
      "",
      todayQuestion ? "Открытые риски за сегодня:" : "Риски за сегодня не запрашивались явно:",
      todayQuestion ? formatRisksForPrompt(risks) : "Не включены в этот запрос.",
      "",
      todayQuestion ? "Открытые задачи за сегодня:" : "Задачи за сегодня не запрашивались явно:",
      todayQuestion ? formatTasksForPrompt(tasks) : "Не включены в этот запрос.",
      "",
      todayQuestion ? "Финансовая память за сегодня:" : "Релевантная финансовая память:",
      formatFinanceEventsForPrompt(relevantFinanceEvents),
      "",
      todayQuestion ? "Бухгалтерская сводка за сегодня:" : "Бухгалтерская сводка за период в памяти:",
      formatAccountingSummaryForPrompt(accountingSummary),
      "",
      "Релевантные сообщения из памяти рабочих чатов:",
      formatMessagesForPrompt(relevantMessages),
    ].join("\n");

    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 2500,
      messages: [
        { role: "system", content: OWNER_QUERY_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || "Не смог сформировать ответ по памяти.";
  } catch (err) {
    logger.error({ err, question }, "Failed to answer owner question");
    return "Не смог ответить по памяти из-за ошибки анализа. Проверь логи Replit.";
  }
}
