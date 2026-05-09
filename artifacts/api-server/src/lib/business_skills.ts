import type { Context } from "grammy";
import { db, businessSkillsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export type BusinessSkillMemory = {
  name: string;
  title: string;
  instructionText: string;
  triggerSummary: string;
  actionSummary: string;
  scope: string;
  appliesTo: string[];
  confidence: string;
};

type SkillDraft = {
  should_save: boolean;
  name: string | null;
  title: string | null;
  instruction_text: string | null;
  trigger_summary: string | null;
  action_summary: string | null;
  scope: string | null;
  applies_to: string[];
  confidence: "low" | "medium" | "high";
  confirmation_required: boolean;
  confirmation_question: string | null;
};

const BUSINESS_SKILL_SYSTEM_PROMPT = `Ты — конструктор no-code навыков AXIS.

Владелец бизнеса пишет обычным языком, как секретарю. Твоя задача — понять, является ли текст инструкцией, которую AXIS должен запомнить и применять в рабочих чатах.

Сохраняй только рабочие инструкции вида:
- если в чате происходит X, делай Y;
- следи/контролируй/напоминай/считай/заноси;
- для моего бизнеса важно не пропускать X;
- вот как у нас устроены задачи, отчёты, деньги, клиенты, документы.

Не сохраняй обычные вопросы владельца по истории, например "что важного сегодня?".

Ответь только валидным JSON:
{
  "should_save": true,
  "name": "короткий_slug_латиницей",
  "title": "короткое название по-русски",
  "instruction_text": "полная инструкция обычным языком",
  "trigger_summary": "когда применять",
  "action_summary": "что должен сделать AXIS",
  "scope": "tasks|finance|reports|risks|clients|people|documents|general",
  "applies_to": ["tasks", "finance"],
  "confidence": "low|medium|high",
  "confirmation_required": false,
  "confirmation_question": null
}`;

const SKILL_HINT_RE =
  /^(axis[,\s:!-]*)?(запомни|научи|следи|контролируй|отслеживай|напоминай|считай|заноси|создавай|фиксируй|для моего бизнеса|у нас|в нашем бизнесе|если\b)/i;

const ACTION_RE =
  /если[\s\S]{3,}(то|напомни|сообщи|создай|создавай|занеси|заноси|считай|отмечай|закрывай|спроси)/i;

function looksLikeBusinessSkillInstruction(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 20) return false;
  if (normalized.endsWith("?") && !/запомни|научи|следи|контролируй|если/i.test(normalized)) return false;
  return SKILL_HINT_RE.test(normalized) || ACTION_RE.test(normalized);
}

function slugify(text: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const out = text
    .toLowerCase()
    .split("")
    .map(ch => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return out || `skill_${Date.now()}`;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAppliesTo(value: unknown): string[] {
  if (!Array.isArray(value)) return ["general"];
  return value
    .map(item => safeString(item))
    .filter((item): item is string => !!item)
    .map(item => item.toLowerCase().replace(/[^a-z0-9_-]+/g, "_"))
    .slice(0, 12);
}

function normalizeDraft(raw: unknown, fallbackText: string): SkillDraft {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const title = safeString(obj["title"]) ?? fallbackText.slice(0, 80);
  const instruction = safeString(obj["instruction_text"]) ?? fallbackText;
  const confidenceRaw = obj["confidence"];

  return {
    should_save: obj["should_save"] === true,
    name: safeString(obj["name"]) ?? slugify(title),
    title,
    instruction_text: instruction,
    trigger_summary: safeString(obj["trigger_summary"]) ?? instruction,
    action_summary: safeString(obj["action_summary"]) ?? "Применять как рабочую инструкцию владельца.",
    scope: safeString(obj["scope"]) ?? "general",
    applies_to: normalizeAppliesTo(obj["applies_to"]),
    confidence: confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium",
    confirmation_required: obj["confirmation_required"] === true,
    confirmation_question: safeString(obj["confirmation_question"]),
  };
}

async function interpretBusinessSkillInstruction(text: string): Promise<SkillDraft> {
  const model = process.env["OPENAI_TEXT_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-5.4";
  try {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: BUSINESS_SKILL_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return normalizeDraft(JSON.parse(cleaned) as unknown, text);
  } catch (err) {
    logger.error({ err }, "Failed to interpret business skill instruction");
    return {
      should_save: looksLikeBusinessSkillInstruction(text),
      name: slugify(text.slice(0, 60)),
      title: text.slice(0, 80),
      instruction_text: text,
      trigger_summary: text,
      action_summary: "Применять как рабочую инструкцию владельца.",
      scope: "general",
      applies_to: ["general"],
      confidence: "medium",
      confirmation_required: false,
      confirmation_question: null,
    };
  }
}

export async function fetchBusinessSkills(limit = 50): Promise<BusinessSkillMemory[]> {
  try {
    const rows = await db
      .select()
      .from(businessSkillsTable)
      .where(eq(businessSkillsTable.status, "active"))
      .orderBy(businessSkillsTable.createdAt);

    return rows.slice(-limit).map(row => ({
      name: row.name,
      title: row.title,
      instructionText: row.instructionText,
      triggerSummary: row.triggerSummary,
      actionSummary: row.actionSummary,
      scope: row.scope,
      appliesTo: parseJsonStringArray(row.appliesToJson),
      confidence: row.confidence,
    }));
  } catch (err) {
    logger.warn({ err }, "Business skills table is not available yet");
    return [];
  }
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export function formatBusinessSkillsForPrompt(skills: BusinessSkillMemory[]): string {
  if (skills.length === 0) return "No-code навыков владельца пока нет.";

  return skills
    .map((skill, idx) => [
      `${idx + 1}. ${skill.title} (${skill.name})`,
      `   Область: ${skill.scope}; применимо к: ${skill.appliesTo.join(", ") || "general"}`,
      `   Когда: ${skill.triggerSummary}`,
      `   Действие: ${skill.actionSummary}`,
      `   Инструкция владельца: ${skill.instructionText}`,
    ].join("\n"))
    .join("\n");
}

export async function tryHandleBusinessSkillInstruction(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text?.trim();
  if (!text || !looksLikeBusinessSkillInstruction(text)) return false;

  const draft = await interpretBusinessSkillInstruction(text);
  if (!draft.should_save || !draft.name || !draft.title || !draft.instruction_text) return false;

  const name = slugify(draft.name);
  const [saved] = await db
    .insert(businessSkillsTable)
    .values({
      name,
      title: draft.title,
      instructionText: draft.instruction_text,
      triggerSummary: draft.trigger_summary ?? draft.instruction_text,
      actionSummary: draft.action_summary ?? "Применять как рабочую инструкцию владельца.",
      scope: draft.scope ?? "general",
      appliesToJson: JSON.stringify(draft.applies_to.length > 0 ? draft.applies_to : ["general"]),
      status: "active",
      confidence: draft.confidence,
      confirmationRequired: draft.confirmation_required,
      sourceChatId: ctx.chat?.id,
      sourceMessageId: ctx.message?.message_id,
      createdByUserId: ctx.from?.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: businessSkillsTable.name,
      set: {
        title: draft.title,
        instructionText: draft.instruction_text,
        triggerSummary: draft.trigger_summary ?? draft.instruction_text,
        actionSummary: draft.action_summary ?? "Применять как рабочую инструкцию владельца.",
        scope: draft.scope ?? "general",
        appliesToJson: JSON.stringify(draft.applies_to.length > 0 ? draft.applies_to : ["general"]),
        status: "active",
        confidence: draft.confidence,
        confirmationRequired: draft.confirmation_required,
        updatedAt: new Date(),
      },
    })
    .returning();

  const lines = [
    "Понял. Я сохранил это как навык AXIS.",
    "",
    `Навык: ${saved?.title ?? draft.title}`,
    `Когда применять: ${draft.trigger_summary}`,
    `Что делать: ${draft.action_summary}`,
    "",
    "Теперь буду учитывать это при анализе рабочих чатов, задач, отчётов и финансов.",
  ];

  if (draft.confirmation_required && draft.confirmation_question) {
    lines.push("", `Нужно уточнение: ${draft.confirmation_question}`);
  }

  await ctx.reply(lines.join("\n"));
  return true;
}
