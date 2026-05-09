import { db, financialEventsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { postAccountingTransactionFromFinanceEvent } from "./finance_accounting";
import { logger } from "./logger";

export type FinanceEventConfidence = "low" | "medium" | "high";

export type FinanceEventInput = {
  event_type: string | null;
  flow_type: string | null;
  amount: string | null;
  currency: string | null;
  category: string | null;
  management_category: string | null;
  cost_center: string | null;
  project: string | null;
  item_name: string | null;
  counterparty: string | null;
  payment_method: string | null;
  document_type: string | null;
  document_number: string | null;
  money_account: string | null;
  source_account: string | null;
  destination_account: string | null;
  balance_after: string | null;
  line_items: Array<{ name: string; amount?: string | null; quantity?: string | null; category?: string | null }>;
  tags: string[];
  location: string | null;
  description: string;
  confidence: FinanceEventConfidence;
  occurred_at?: string | null;
};

export type FinanceMemoryEvent = {
  id: number;
  sourceType: string;
  sourceId: number;
  chatTitle: string | null;
  eventType: string;
  flowType: string;
  location: string | null;
  amount: string | null;
  currency: string;
  category: string | null;
  managementCategory: string | null;
  costCenter: string | null;
  project: string | null;
  itemName: string | null;
  counterparty: string | null;
  paymentMethod: string | null;
  documentType: string | null;
  documentNumber: string | null;
  moneyAccount: string | null;
  sourceAccount: string | null;
  destinationAccount: string | null;
  balanceAfter: string | null;
  lineItems: Array<{ name: string; amount?: string | null; quantity?: string | null; category?: string | null }>;
  tags: string[];
  description: string;
  status: string;
  confidence: string;
  occurredAt: Date | null;
  createdAt: Date;
};

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeConfidence(value: unknown): FinanceEventConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function normalizeEventType(value: string | null): string {
  if (!value) return "unknown";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "unknown";
}

function normalizeFlowType(value: string | null): string {
  const normalized = normalizeEventType(value);
  if (["income", "expense", "transfer", "obligation", "planned", "refund"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function inferFlowType(eventType: string, explicitFlowType: string | null): string {
  const explicit = normalizeFlowType(explicitFlowType);
  if (explicit !== "unknown") return explicit;

  if (/income|revenue|выруч|приход/i.test(eventType)) return "income";
  if (/transfer|перевод/i.test(eventType)) return "transfer";
  if (/invoice|debt|obligation|счет|счёт|долг/i.test(eventType)) return "obligation";
  if (/purchase_request|planned|закуп/i.test(eventType)) return "planned";
  if (/refund|возврат/i.test(eventType)) return "refund";
  if (/expense|receipt|advance|bank|cash|invoice|document|чек|расход/i.test(eventType)) return "expense";
  return "unknown";
}

function normalizeLineItems(raw: unknown): FinanceEventInput["line_items"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({
      name: safeText(item["name"]) ?? safeText(item["item_name"]) ?? "",
      amount: safeText(item["amount"]),
      quantity: safeText(item["quantity"]),
      category: safeText(item["category"]),
    }))
    .filter(item => item.name.length > 0)
    .slice(0, 30);
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(tag => safeText(tag))
    .filter((tag): tag is string => !!tag)
    .slice(0, 20);
}

export function normalizeFinanceEventInputs(raw: unknown): FinanceEventInput[] {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map(item => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({
      event_type: safeText(item["event_type"]),
      flow_type: safeText(item["flow_type"]),
      amount: safeText(item["amount"]),
      currency: safeText(item["currency"]) ?? "RUB",
      category: safeText(item["category"]),
      management_category: safeText(item["management_category"]) ?? safeText(item["category"]),
      cost_center: safeText(item["cost_center"]),
      project: safeText(item["project"]),
      item_name: safeText(item["item_name"]),
      counterparty: safeText(item["counterparty"]),
      payment_method: safeText(item["payment_method"]),
      document_type: safeText(item["document_type"]),
      document_number: safeText(item["document_number"]),
      money_account: safeText(item["money_account"]),
      source_account: safeText(item["source_account"]),
      destination_account: safeText(item["destination_account"]),
      balance_after: safeText(item["balance_after"]),
      line_items: normalizeLineItems(item["line_items"]),
      tags: normalizeTags(item["tags"]),
      location: safeText(item["location"]),
      description: safeText(item["description"]) ?? "",
      confidence: safeConfidence(item["confidence"]),
      occurred_at: safeText(item["occurred_at"]),
    }))
    .filter(item => item.description.length > 0 || !!item.item_name || !!item.amount)
    .map(item => ({
      ...item,
      event_type: normalizeEventType(item.event_type),
      flow_type: inferFlowType(normalizeEventType(item.event_type), item.flow_type),
      description: item.description || [item.item_name, item.amount].filter(Boolean).join(", "),
    }));
}

function parseOccurredAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function insertFinanceEvent(params: {
  sourceType: "message" | "report";
  sourceId: number;
  chatId: number | null;
  messageId?: number | null;
  incomingReportId?: number | null;
  event: FinanceEventInput;
  rawJson?: string | null;
}): Promise<number | null> {
  const existing = await db
    .select({ id: financialEventsTable.id })
    .from(financialEventsTable)
    .where(
      and(
        eq(financialEventsTable.sourceType, params.sourceType),
        eq(financialEventsTable.sourceId, params.sourceId),
        eq(financialEventsTable.description, params.event.description),
      ),
    )
    .limit(1);

  if (existing.length > 0) return null;

  const [inserted] = await db.insert(financialEventsTable).values({
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    chatId: params.chatId ?? undefined,
    messageId: params.messageId ?? undefined,
    incomingReportId: params.incomingReportId ?? undefined,
    eventType: normalizeEventType(params.event.event_type),
    flowType: inferFlowType(normalizeEventType(params.event.event_type), params.event.flow_type),
    location: params.event.location ?? undefined,
    amount: params.event.amount ?? undefined,
    currency: params.event.currency ?? "RUB",
    category: params.event.category ?? undefined,
    managementCategory: params.event.management_category ?? params.event.category ?? undefined,
    costCenter: params.event.cost_center ?? undefined,
    projectName: params.event.project ?? undefined,
    itemName: params.event.item_name ?? undefined,
    counterparty: params.event.counterparty ?? undefined,
    paymentMethod: params.event.payment_method ?? undefined,
    documentType: params.event.document_type ?? undefined,
    documentNumber: params.event.document_number ?? undefined,
    moneyAccount: params.event.money_account ?? undefined,
    sourceAccount: params.event.source_account ?? undefined,
    destinationAccount: params.event.destination_account ?? undefined,
    balanceAfter: params.event.balance_after ?? undefined,
    lineItemsJson: params.event.line_items.length > 0 ? JSON.stringify(params.event.line_items) : undefined,
    tagsJson: params.event.tags.length > 0 ? JSON.stringify(params.event.tags) : undefined,
    description: params.event.description,
    confidence: params.event.confidence,
    rawJson: params.rawJson ?? JSON.stringify(params.event),
    occurredAt: parseOccurredAt(params.event.occurred_at) ?? undefined,
  }).returning({ id: financialEventsTable.id });

  if (!inserted) return null;

  await postAccountingTransactionFromFinanceEvent({
    financialEventId: inserted.id,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    chatId: params.chatId,
    messageId: params.messageId,
    incomingReportId: params.incomingReportId,
    event: params.event,
    rawJson: params.rawJson ?? JSON.stringify(params.event),
  });

  return inserted.id;
}

export async function storeFinanceEventsFromMessage(params: {
  chatId: number;
  messageId: number;
  events: FinanceEventInput[];
  rawText: string;
}): Promise<number> {
  if (params.events.length === 0) return 0;

  let inserted = 0;
  try {
    for (const event of params.events) {
      const insertedId = await insertFinanceEvent({
        sourceType: "message",
        sourceId: params.messageId,
        chatId: params.chatId,
        messageId: params.messageId,
        event,
        rawJson: JSON.stringify({ text: params.rawText, event }),
      });
      if (insertedId) inserted += 1;
    }
  } catch (err) {
    logger.error({ err, messageId: params.messageId }, "Failed to store finance events from message");
  }

  return inserted;
}

export async function storeFinanceEventsFromReport(params: {
  incomingReportId: number;
  chatId: number | null;
  result: {
    report_type?: string;
    location?: string | null;
    date?: string | null;
    summary?: string | null;
    detected_amounts?: Array<{ label: string; value: string }>;
    finance_events?: FinanceEventInput[];
  };
}): Promise<number> {
  const explicit = normalizeFinanceEventInputs(params.result.finance_events);
  const fallback = explicit.length > 0
    ? []
    : (params.result.detected_amounts ?? []).map(amount => ({
        event_type: params.result.report_type === "delivery_cash_report" ? "income" : "document_amount",
        flow_type: params.result.report_type === "delivery_cash_report" ? "income" : "expense",
        amount: amount.value,
        currency: "RUB",
        category: params.result.report_type ?? "document",
        management_category: "не классифицировано",
        cost_center: null,
        project: null,
        item_name: amount.label,
        counterparty: null,
        payment_method: null,
        document_type: params.result.report_type ?? "document",
        document_number: null,
        money_account: null,
        source_account: null,
        destination_account: null,
        balance_after: null,
        line_items: amount.label ? [{ name: amount.label, amount: amount.value }] : [],
        tags: [],
        location: params.result.location && params.result.location !== "unknown" ? params.result.location : null,
        description: `${amount.label}: ${amount.value}${params.result.summary ? ` — ${params.result.summary}` : ""}`,
        confidence: "medium" as const,
        occurred_at: null,
      }));

  const events = [...explicit, ...fallback];
  if (events.length === 0) return 0;

  let inserted = 0;
  try {
    for (const event of events) {
      const insertedId = await insertFinanceEvent({
        sourceType: "report",
        sourceId: params.incomingReportId,
        chatId: params.chatId,
        incomingReportId: params.incomingReportId,
        event,
        rawJson: JSON.stringify({ result: params.result, event }),
      });
      if (insertedId) inserted += 1;
    }
  } catch (err) {
    logger.error({ err, incomingReportId: params.incomingReportId }, "Failed to store finance events from report");
  }

  return inserted;
}

export async function fetchFinanceEventsForOwnerMemory(days: number, limit: number): Promise<FinanceMemoryEvent[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        fe.id,
        fe.source_type,
        fe.source_id,
        COALESCE(c.title, CASE WHEN fe.chat_id IS NULL THEN NULL ELSE 'чат ' || fe.chat_id::text END) AS chat_title,
        fe.event_type,
        fe.flow_type,
        fe.location,
        fe.amount,
        fe.currency,
        fe.category,
        fe.management_category,
        fe.cost_center,
        fe.project_name,
        fe.item_name,
        fe.counterparty,
        fe.payment_method,
        fe.document_type,
        fe.document_number,
        fe.money_account,
        fe.source_account,
        fe.destination_account,
        fe.balance_after,
        fe.line_items_json,
        fe.tags_json,
        fe.description,
        fe.status,
        fe.confidence,
        fe.occurred_at,
        fe.created_at
      FROM financial_events fe
      LEFT JOIN chats c ON c.id = fe.chat_id
      WHERE fe.created_at >= NOW() - (${days}::text || ' days')::interval
      ORDER BY COALESCE(fe.occurred_at, fe.created_at) DESC
      LIMIT ${limit}
    `);

    return result.rows.map(row => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r["id"]),
        sourceType: String(r["source_type"] ?? "unknown"),
        sourceId: Number(r["source_id"]),
        chatTitle: typeof r["chat_title"] === "string" ? r["chat_title"] : null,
        eventType: String(r["event_type"] ?? "unknown"),
        flowType: String(r["flow_type"] ?? "unknown"),
        location: typeof r["location"] === "string" ? r["location"] : null,
        amount: typeof r["amount"] === "string" ? r["amount"] : null,
        currency: String(r["currency"] ?? "RUB"),
        category: typeof r["category"] === "string" ? r["category"] : null,
        managementCategory: typeof r["management_category"] === "string" ? r["management_category"] : null,
        costCenter: typeof r["cost_center"] === "string" ? r["cost_center"] : null,
        project: typeof r["project_name"] === "string" ? r["project_name"] : null,
        itemName: typeof r["item_name"] === "string" ? r["item_name"] : null,
        counterparty: typeof r["counterparty"] === "string" ? r["counterparty"] : null,
        paymentMethod: typeof r["payment_method"] === "string" ? r["payment_method"] : null,
        documentType: typeof r["document_type"] === "string" ? r["document_type"] : null,
        documentNumber: typeof r["document_number"] === "string" ? r["document_number"] : null,
        moneyAccount: typeof r["money_account"] === "string" ? r["money_account"] : null,
        sourceAccount: typeof r["source_account"] === "string" ? r["source_account"] : null,
        destinationAccount: typeof r["destination_account"] === "string" ? r["destination_account"] : null,
        balanceAfter: typeof r["balance_after"] === "string" ? r["balance_after"] : null,
        lineItems: parseJsonArray(r["line_items_json"]),
        tags: parseJsonArray(r["tags_json"]).map(tag => String(tag)),
        description: String(r["description"] ?? ""),
        status: String(r["status"] ?? "observed"),
        confidence: String(r["confidence"] ?? "medium"),
        occurredAt: r["occurred_at"] ? new Date(String(r["occurred_at"])) : null,
        createdAt: new Date(String(r["created_at"])),
      };
    });
  } catch (err) {
    logger.warn({ err }, "Finance events table is not available yet");
    return [];
  }
}

function parseJsonArray(value: unknown): any[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(value: Date | null): string {
  if (!value) return "без даты";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env["AXIS_TIMEZONE"] ?? "Asia/Yakutsk",
  });
}

export function formatFinanceEventsForPrompt(events: FinanceMemoryEvent[]): string {
  if (events.length === 0) return "Финансовые события не найдены.";

  return events
    .map(event => [
      `Дата: ${formatDate(event.occurredAt ?? event.createdAt)}`,
      event.chatTitle ? `Чат: ${event.chatTitle}` : null,
      `Тип: ${event.eventType}`,
      `Денежный поток: ${event.flowType}`,
      event.location ? `Точка/объект: ${event.location}` : null,
      event.costCenter ? `Центр затрат: ${event.costCenter}` : null,
      event.project ? `Проект/объект: ${event.project}` : null,
      event.managementCategory ? `Упр. категория: ${event.managementCategory}` : null,
      event.documentType ? `Документ: ${event.documentType}${event.documentNumber ? ` #${event.documentNumber}` : ""}` : null,
      event.moneyAccount ? `Денежный счёт: ${event.moneyAccount}` : null,
      event.sourceAccount ? `Счёт списания: ${event.sourceAccount}` : null,
      event.destinationAccount ? `Счёт поступления: ${event.destinationAccount}` : null,
      event.balanceAfter ? `Остаток после операции: ${event.balanceAfter}` : null,
      event.paymentMethod ? `Способ оплаты: ${event.paymentMethod}` : null,
      event.itemName ? `Деталь/позиция: ${event.itemName}` : null,
      event.lineItems.length > 0 ? `Строки документа: ${event.lineItems.map(item => [item.name, item.amount].filter(Boolean).join(" ")).join("; ")}` : null,
      event.amount ? `Сумма: ${event.amount} ${event.currency}` : null,
      event.counterparty ? `Контрагент: ${event.counterparty}` : null,
      event.tags.length > 0 ? `Теги: ${event.tags.join(", ")}` : null,
      `Смысл: ${event.description}`,
      `Уверенность: ${event.confidence}`,
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");
}
