import { db, risksTable, tasksTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { fetchAiBusinessRules, formatAiBusinessRulesForPrompt } from "./business_rules";
import {
  normalizeFinanceEventInputs,
  storeFinanceEventsFromMessage,
  type FinanceEventInput,
} from "./finance_memory";
import { logger } from "./logger";
import { fetchPrimaryBusinessProfile, formatBusinessProfileForPrompt } from "./owner_onboarding";
import { inferTaskDeadline } from "./task_followup";

type Severity = "low" | "medium" | "high" | "critical";
type Priority = "low" | "normal" | "high" | "urgent";

export type MessageAiTask = {
  description: string;
  assignee_username: string | null;
  assignee_name: string | null;
  deadline_iso: string | null;
  priority: Priority;
};

export type MessageAiRisk = {
  description: string;
  severity: Severity;
};

export type MessageAiAnalysis = {
  has_work_signal: boolean;
  summary: string | null;
  tasks: MessageAiTask[];
  risks: MessageAiRisk[];
  finance_events: FinanceEventInput[];
  owner_alert: boolean;
  owner_alert_reason: string | null;
  confidence: "low" | "medium" | "high";
};

export type StoredMessageAiAnalysis = MessageAiAnalysis & {
  insertedTasks: number;
  insertedRisks: number;
  insertedFinanceEvents: number;
};

const MESSAGE_SYSTEM_PROMPT = `Ты — AI-секретарь и операционный контролер бизнеса владельца.

Ты анализируешь одно сообщение из рабочего Telegram-чата. Твоя задача — понять смысл, а не искать только ключевые слова.
Ты должен понимать живую рабочую речь на разных языках и с разной манерой общения. Не переводи имена, суммы, даты, чаты, точки, контрагентов и исходные факты; сохраняй их точно в структурированных полях.

Контекст бизнеса:
- Используй профиль бизнеса, если он передан ниже: сфера, критичные зоны, язык владельца и инструкции.
- Если профиль не заполнен, используй универсальную логику малого/среднего бизнеса.
- Для ресторанной сети учитывай точки вроде Алдан, Нерюнгри, Куранах, если они встречаются в сообщении.
- Важные зоны контроля: касса, возвраты, delivery, курьеры, отчеты смены, счета, поставщики, расходы, табель, пробег авто, ТО авто, дисциплина сотрудников, клиенты, документы, обязательства.
- Возврат за наличные — критический риск.
- Кассовое расхождение, подозрительная выплата, отсутствие отчета, проблема с поставкой или нарушенный дедлайн — риск.
- Если утренний пробег автомобиля больше вечернего пробега предыдущей смены — это high/critical риск ночного или личного использования машины.
- Если в сообщении есть поручение, обещание, срок или просьба что-то сделать — создай задачу.
- Если в сообщении есть покупка, закупка, чек, счет, оплата, банковский скрин, авансовый отчет, расход, приход денег, долг или перевод — создай finance_events.
- Финансовый блок не привязан к конкретным товарам. Главная цель — управленческий учет: денежный поток, категория, центр затрат/объект, контрагент, способ оплаты и документ. Конкретные товары из чека сохраняй только как line_items/детали.
- Если поручили что-то купить, например "закупить молоко", это одновременно задача и финансовое событие planned/purchase_request, где товар — только деталь, а не основа учета.
- Если сообщение бытовое, короткое подтверждение или не несет рабочей нагрузки — верни has_work_signal=false.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "has_work_signal": true,
  "summary": "краткий смысл сообщения или null",
  "tasks": [
    {
      "description": "что нужно сделать",
      "assignee_username": "username без @ или null",
      "assignee_name": "имя ответственного текстом или null",
      "deadline_iso": "ISO 8601 дата/время с часовым поясом или null",
      "priority": "low|normal|high|urgent"
    }
  ],
  "risks": [
    {
      "description": "описание риска",
      "severity": "low|medium|high|critical"
    }
  ],
  "finance_events": [
    {
      "event_type": "purchase_request|receipt|advance_report|bank_expense|invoice|cash_expense|income|unknown",
      "flow_type": "income|expense|transfer|obligation|planned|refund|unknown",
      "amount": "сумма строкой или null",
      "currency": "RUB или другая валюта",
      "category": "старое поле категории или null",
      "management_category": "универсальная категория управленческого учета: выручка|продукты/материалы|хознужды|транспорт|зарплата|аренда|налоги|маркетинг|поставщики|прочее|unknown",
      "cost_center": "точка/отдел/направление затрат или null",
      "project": "проект/объект/заказ или null",
      "item_name": "только основная деталь/позиция, если явно есть, или null",
      "counterparty": "поставщик/магазин/контрагент или null",
      "payment_method": "cash|card|bank_transfer|mixed|unknown|null",
      "document_type": "receipt|invoice|advance_report|bank_screenshot|act|waybill|unknown|null",
      "document_number": "номер документа или null",
      "money_account": "касса/банк/карта, где прошли деньги, или null",
      "source_account": "откуда списали деньги для transfer/expense или null",
      "destination_account": "куда поступили деньги для income/transfer или null",
      "balance_after": "остаток на счёте/в кассе после операции, если виден, или null",
      "line_items": [{"name": "строка документа", "amount": "сумма или null", "quantity": "кол-во или null", "category": "категория строки или null"}],
      "tags": ["короткие теги"],
      "location": "точка/объект или null",
      "description": "человеческое описание финансового события",
      "confidence": "low|medium|high",
      "occurred_at": "ISO 8601 или null"
    }
  ],
  "owner_alert": true,
  "owner_alert_reason": "почему владельцу нужно увидеть это сейчас или null",
  "confidence": "low|medium|high"
}`;

const WORK_SIGNAL_RE =
  /нужно|надо|срочно|сегодня|завтра|дедлайн|до\s+\d|отчет|отчёт|касс|возврат|расхожд|долг|сч[её]т|оплат|банк|банковск|чек|аванс|налич|хознужд|постав|курьер|доставк|пробег|то\b|слом|проблем|закуп|купить|докупить|заказ|проверь|проверить|сделай|подготов|табел|штраф|объяснительн/i;

function shouldAnalyzeText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 12) return false;
  if (normalized.startsWith("/")) return false;
  return normalized.length >= 80 || WORK_SIGNAL_RE.test(normalized);
}

function extractMileageRisk(text: string): MessageAiRisk | null {
  if (!/пробег|километраж|одометр/i.test(text)) return null;

  const morning = text.match(/утр\w*[^\d]{0,30}(\d{4,8})/i);
  const evening = text.match(/вечер\w*(?:\s+вчера)?[^\d]{0,40}(?:было\s*)?(\d{4,8})/i);
  if (!morning?.[1] || !evening?.[1]) return null;

  const morningKm = Number(morning[1]);
  const eveningKm = Number(evening[1]);
  if (!Number.isFinite(morningKm) || !Number.isFinite(eveningKm)) return null;

  const diff = morningKm - eveningKm;
  if (diff <= 0) return null;

  const severity: Severity = diff >= 20 ? "high" : "medium";
  return {
    severity,
    description: `Утренний пробег больше вечернего на ${diff} км (${morningKm} против ${eveningKm}). Проверить, использовалась ли машина ночью или в личных целях.`,
  };
}

function extractSimpleFinanceEvent(text: string): FinanceEventInput | null {
  const purchaseMatch = text.match(/(?:закуп(?:ить|и|ка)?|купить|докупить|заказать|оплатить)\s+([^.,;!?]{2,80})/i);
  const docMatch = text.match(/(?:чек|авансов(?:ый|ого)?\s+отч[её]т|банковск\w+\s+скрин|накладн|сч[её]т)/i);
  if (!purchaseMatch && !docMatch) return null;

  const amountMatch = text.match(/(\d[\d\s.,]*)\s*(?:руб|р\.?|₽)/i);
  const locationMatch = text.match(/алдан|нерюнгри|куранах/i);
  const itemName = purchaseMatch?.[1]
    ?.replace(/\s+(для|в|на|по)\s+(алдан|нерюнгри|куранах).*/i, "")
    .trim() ?? null;

  return {
    event_type: purchaseMatch ? "purchase_request" : "financial_document",
    flow_type: purchaseMatch ? "planned" : "expense",
    amount: amountMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null,
    currency: "RUB",
    category: itemName ? "закупка" : "документ",
    management_category: itemName ? "закупка/материалы" : "финансовый документ",
    cost_center: locationMatch?.[0] ?? null,
    project: null,
    item_name: itemName,
    counterparty: null,
    payment_method: null,
    document_type: docMatch ? "financial_document" : null,
    document_number: null,
    money_account: null,
    source_account: null,
    destination_account: null,
    balance_after: null,
    line_items: itemName ? [{ name: itemName }] : [],
    tags: purchaseMatch ? ["планируемый расход"] : ["финансовый документ"],
    location: locationMatch?.[0] ?? null,
    description: itemName
      ? "Планируемый расход/закупка по рабочему поручению"
      : "Финансовый документ или подтверждение расхода",
    confidence: "medium",
    occurred_at: null,
  };
}

function normalizeUsername(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeSeverity(value: unknown): Severity {
  return value === "critical" || value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function safePriority(value: unknown): Priority {
  return value === "urgent" || value === "high" || value === "normal" || value === "low"
    ? value
    : "normal";
}

function normalizeAnalysis(raw: unknown): MessageAiAnalysis {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const tasksRaw = Array.isArray(obj["tasks"]) ? obj["tasks"] : [];
  const risksRaw = Array.isArray(obj["risks"]) ? obj["risks"] : [];
  const financeEvents = normalizeFinanceEventInputs(obj["finance_events"]);

  const tasks: MessageAiTask[] = tasksRaw
    .map(item => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({
      description: safeString(item["description"]) ?? "",
      assignee_username: normalizeUsername(safeString(item["assignee_username"])),
      assignee_name: safeString(item["assignee_name"]),
      deadline_iso: safeString(item["deadline_iso"]),
      priority: safePriority(item["priority"]),
    }))
    .filter(task => task.description.length > 0);

  const risks: MessageAiRisk[] = risksRaw
    .map(item => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({
      description: safeString(item["description"]) ?? "",
      severity: safeSeverity(item["severity"]),
    }))
    .filter(risk => risk.description.length > 0);

  const confidenceRaw = obj["confidence"];
  const confidence = confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
    ? confidenceRaw
    : "medium";
  const importantRisk = risks.some(risk => risk.severity === "critical" || risk.severity === "high");
  const urgentTask = tasks.some(task => task.priority === "urgent");

  return {
    has_work_signal: obj["has_work_signal"] === true || tasks.length > 0 || risks.length > 0 || financeEvents.length > 0,
    summary: safeString(obj["summary"]),
    tasks,
    risks,
    finance_events: financeEvents,
    owner_alert: obj["owner_alert"] === true || importantRisk || urgentTask,
    owner_alert_reason: safeString(obj["owner_alert_reason"]),
    confidence,
  };
}

async function analyzeMessageText(params: {
  chatTitle: string | null;
  senderName: string | null;
  text: string;
}): Promise<MessageAiAnalysis> {
  const model = process.env["OPENAI_TEXT_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-5.4";
  const [businessRules, businessProfile] = await Promise.all([
    fetchAiBusinessRules(),
    fetchPrimaryBusinessProfile(),
  ]);
  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: MESSAGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Чат: ${params.chatTitle ?? "без названия"}`,
          `Автор: ${params.senderName ?? "неизвестен"}`,
          `Текущее время: ${new Date().toISOString()}`,
          "",
          "Профиль бизнеса:",
          formatBusinessProfileForPrompt(businessProfile),
          "",
          "Активные правила владельца:",
          formatAiBusinessRulesForPrompt(businessRules),
          "",
          "Сообщение:",
          params.text,
        ].join("\n"),
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return normalizeAnalysis(JSON.parse(cleaned) as unknown);
}

export async function analyzeAndStoreMessage(params: {
  messageId: number;
  chatId: number;
  chatTitle: string | null;
  fromUserId: number | null;
  fromUsername: string | null;
  senderName: string | null;
  text: string;
}): Promise<StoredMessageAiAnalysis | null> {
  if (!shouldAnalyzeText(params.text)) return null;

  const mileageRisk = extractMileageRisk(params.text);
  const simpleFinanceEvent = extractSimpleFinanceEvent(params.text);

  let analysis: MessageAiAnalysis;
  try {
    analysis = await analyzeMessageText({
      chatTitle: params.chatTitle,
      senderName: params.senderName,
      text: params.text,
    });
  } catch (err) {
    logger.error({ err, messageId: params.messageId, chatId: params.chatId }, "Message AI analysis failed");
    if (!mileageRisk && !simpleFinanceEvent) return null;
    analysis = {
      has_work_signal: true,
      summary: mileageRisk?.description ?? simpleFinanceEvent?.description ?? null,
      tasks: [],
      risks: mileageRisk ? [mileageRisk] : [],
      finance_events: simpleFinanceEvent ? [simpleFinanceEvent] : [],
      owner_alert: !!mileageRisk,
      owner_alert_reason: mileageRisk ? "Обнаружено расхождение пробега автомобиля между вечером и утром." : null,
      confidence: mileageRisk ? "high" : "medium",
    };
  }

  if (mileageRisk && !analysis.risks.some(risk => risk.description.includes("пробег") || risk.description.includes("машин"))) {
    analysis.risks.push(mileageRisk);
    analysis.has_work_signal = true;
    analysis.owner_alert = true;
    analysis.owner_alert_reason ??= "Обнаружено расхождение пробега автомобиля между вечером и утром.";
  }

  if (simpleFinanceEvent && !analysis.finance_events.some(event => event.description === simpleFinanceEvent.description)) {
    analysis.finance_events.push(simpleFinanceEvent);
    analysis.has_work_signal = true;
  }

  if (!analysis.has_work_signal && analysis.tasks.length === 0 && analysis.risks.length === 0 && analysis.finance_events.length === 0) {
    return { ...analysis, insertedTasks: 0, insertedRisks: 0, insertedFinanceEvents: 0 };
  }

  let insertedTasks = 0;
  for (const task of analysis.tasks) {
    const deadline = inferTaskDeadline(`${params.text}\n${task.description}`, task.deadline_iso);
    await db.insert(tasksTable).values({
      chatId: params.chatId,
      messageId: params.messageId,
      ruleName: "ai_message_task",
      originalText: params.text,
      assignedToUserId: null,
      assignedToUsername: task.assignee_username,
      description: task.description,
      deadline,
      status: deadline ? "deadline_open" : "open",
    });
    insertedTasks += 1;
  }

  let insertedRisks = 0;
  for (const risk of analysis.risks) {
    await db.insert(risksTable).values({
      chatId: params.chatId,
      messageId: params.messageId,
      ruleName: "ai_message_risk",
      originalText: params.text,
      description: risk.description,
      severity: risk.severity,
      status: "open",
    });
    insertedRisks += 1;
  }

  const insertedFinanceEvents = await storeFinanceEventsFromMessage({
    chatId: params.chatId,
    messageId: params.messageId,
    events: analysis.finance_events,
    rawText: params.text,
  });

  logger.info(
    {
      chatId: params.chatId,
      messageId: params.messageId,
      insertedTasks,
      insertedRisks,
      insertedFinanceEvents,
      ownerAlert: analysis.owner_alert,
    },
    "Message AI analysis stored",
  );

  return { ...analysis, insertedTasks, insertedRisks, insertedFinanceEvents };
}

export function formatMessageAiOwnerAlert(params: {
  chatTitle: string | null;
  senderName: string | null;
  text: string;
  analysis: StoredMessageAiAnalysis;
}): string {
  const lines = [
    "AXIS Mini: важный сигнал из рабочего чата",
    "",
    `Чат: ${params.chatTitle ?? "без названия"}`,
    `Автор: ${params.senderName ?? "неизвестен"}`,
  ];

  if (params.analysis.owner_alert_reason) {
    lines.push(`Причина: ${params.analysis.owner_alert_reason}`);
  }

  if (params.analysis.summary) {
    lines.push("", `Смысл: ${params.analysis.summary}`);
  }

  if (params.analysis.tasks.length > 0) {
    lines.push("", "Задачи:");
    for (const task of params.analysis.tasks) {
      const assignee = task.assignee_username ? ` (@${task.assignee_username})` : task.assignee_name ? ` (${task.assignee_name})` : "";
      const deadline = task.deadline_iso ? `, срок: ${task.deadline_iso}` : "";
      lines.push(`- ${task.description}${assignee}${deadline}`);
    }
  }

  if (params.analysis.risks.length > 0) {
    lines.push("", "Риски:");
    for (const risk of params.analysis.risks) {
      lines.push(`- [${risk.severity}] ${risk.description}`);
    }
  }

  if (params.analysis.finance_events.length > 0) {
    lines.push("", "Финансы:");
    for (const event of params.analysis.finance_events) {
      const amount = event.amount ? `, сумма: ${event.amount} ${event.currency ?? "RUB"}` : "";
      const category = event.management_category ? `, категория: ${event.management_category}` : "";
      const flow = event.flow_type ? `, поток: ${event.flow_type}` : "";
      lines.push(`- [${event.event_type ?? "finance"}] ${event.description}${flow}${category}${amount}`);
    }
  }

  lines.push("", "Исходное сообщение:", params.text);
  return lines.join("\n");
}
