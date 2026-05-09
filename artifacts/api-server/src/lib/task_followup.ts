import type { Bot, Context } from "grammy";
import { db, tasksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

type DueTask = {
  id: number;
  chatId: number;
  description: string;
  assignedToUsername: string | null;
  deadline: Date | null;
};

const DONE_RE = /^(да|готово|сделано|выполнено|закрыто|ок|done)\b/i;
const NOT_DONE_RE = /^(нет|не\s+готово|не\s+сделано|не\s+выполнено|пока\s+нет)\b/i;

function formatDate(value: Date | null): string {
  if (!value) return "без срока";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env["AXIS_TIMEZONE"] ?? "Asia/Yakutsk",
  });
}

function tomorrowAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function todayAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

export function inferTaskDeadline(sourceText: string, deadlineIso: string | null): Date | null {
  if (deadlineIso) {
    const parsed = new Date(deadlineIso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const text = sourceText.toLowerCase();
  const now = new Date();

  const relative = text.match(/через\s+(\d+)\s*(минут|мин|час|часа|часов|день|дня|дней)/i);
  if (relative?.[1] && relative[2]) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const d = new Date(now);
    if (unit.startsWith("мин")) d.setMinutes(d.getMinutes() + amount);
    else if (unit.startsWith("час")) d.setHours(d.getHours() + amount);
    else d.setDate(d.getDate() + amount);
    return d;
  }

  const time = text.match(/(?:до|к|в)\s+([01]?\d|2[0-3])[:.](\d{2})/i);
  if (time?.[1] && time[2]) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    if (/завтра/i.test(text)) return tomorrowAt(hour, minute);
    return todayAt(hour, minute);
  }

  if (/сейчас|срочно|прямо\s+сейчас|как\s+можно\s+скорее/i.test(text)) {
    const d = new Date(now);
    d.setHours(d.getHours() + 1);
    return d;
  }

  if (/сегодня/i.test(text)) return todayAt(18, 0);
  if (/завтра/i.test(text)) return tomorrowAt(10, 0);

  return null;
}

async function fetchDueTasks(): Promise<DueTask[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      chat_id,
      description,
      assigned_to_username,
      deadline
    FROM tasks
    WHERE deadline IS NOT NULL
      AND deadline <= NOW()
      AND status IN ('open', 'deadline_open')
    ORDER BY deadline ASC
    LIMIT 20
  `);

  return result.rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r["id"]),
      chatId: Number(r["chat_id"]),
      description: String(r["description"] ?? ""),
      assignedToUsername: typeof r["assigned_to_username"] === "string" ? r["assigned_to_username"] : null,
      deadline: r["deadline"] ? new Date(String(r["deadline"])) : null,
    };
  });
}

export async function sendDueTaskFollowups(bot: Bot): Promise<void> {
  const tasks = await fetchDueTasks();
  if (tasks.length === 0) return;

  for (const task of tasks) {
    const assignee = task.assignedToUsername ? `@${task.assignedToUsername}, ` : "";
    const lines = [
      `Контроль задачи #${task.id}`,
      "",
      `${assignee}срок наступил: ${formatDate(task.deadline)}`,
      task.description,
      "",
      "Выполнено?",
      `Если да — ответьте на это сообщение "готово" или напишите /done ${task.id}`,
    ];

    try {
      await bot.api.sendMessage(task.chatId, lines.join("\n"));
      await db
        .update(tasksTable)
        .set({ status: "waiting_confirmation" })
        .where(eq(tasksTable.id, task.id));
      logger.info({ taskId: task.id, chatId: task.chatId }, "Task follow-up sent");
    } catch (err) {
      logger.error({ err, taskId: task.id, chatId: task.chatId }, "Failed to send task follow-up");
    }
  }
}

export async function handleTaskDoneCommand(ctx: Context): Promise<void> {
  const raw = (typeof ctx.match === "string" ? ctx.match : String(ctx.match ?? "")).trim();
  if (!raw || !/^\d+$/.test(raw)) {
    await ctx.reply("Формат: /done <id задачи>");
    return;
  }

  const taskId = Number(raw);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);

  if (!task) {
    await ctx.reply(`Задача #${taskId} не найдена.`);
    return;
  }

  if (ctx.chat?.type !== "private" && task.chatId !== ctx.chat?.id) {
    await ctx.reply(`Задача #${taskId} относится к другому чату.`);
    return;
  }

  await db
    .update(tasksTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(tasksTable.id, taskId));

  await ctx.reply(`Готово. Задача #${taskId} закрыта.`);
}

export async function handleTaskConfirmationReply(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text?.trim();
  const replyText = ctx.message?.reply_to_message?.text;
  if (!text || !replyText) return false;

  const taskIdMatch = replyText.match(/задач[аи]\s+#(\d+)/i);
  if (!taskIdMatch?.[1]) return false;

  const taskId = Number(taskIdMatch[1]);
  if (DONE_RE.test(text)) {
    await db
      .update(tasksTable)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await ctx.reply(`Отлично. Задача #${taskId} закрыта.`);
    return true;
  }

  if (NOT_DONE_RE.test(text)) {
    const nextCheck = new Date();
    nextCheck.setHours(nextCheck.getHours() + 1);
    await db
      .update(tasksTable)
      .set({ status: "deadline_open", deadline: nextCheck })
      .where(eq(tasksTable.id, taskId));
    await ctx.reply(`Понял. Задача #${taskId} остается открытой, напомню через час.`);
    return true;
  }

  return false;
}
