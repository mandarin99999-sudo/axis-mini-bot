import {
  db,
  financialAccountsTable,
  financialReconciliationsTable,
  financialTransactionEntriesTable,
  financialTransactionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import type { FinanceEventInput } from "./finance_memory";

type AccountType =
  | "cash"
  | "bank"
  | "card"
  | "income"
  | "expense"
  | "payable"
  | "receivable"
  | "transfer"
  | "clearing"
  | "unknown";

type AccountingSummary = {
  currency: string;
  income: string;
  expense: string;
  planned: string;
  obligation: string;
  transfer: string;
  refund: string;
  needsReview: number;
};

function parseMoney(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");

  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(2);
}

function accountName(parts: Array<string | null | undefined>): string {
  return parts
    .map(part => part?.trim())
    .filter((part): part is string => !!part)
    .join(":")
    .replace(/\s+/g, " ")
    .slice(0, 160) || "unknown";
}

function inferMoneyAccount(event: FinanceEventInput): { name: string; type: AccountType } {
  const explicit = event.money_account ?? event.source_account ?? event.destination_account;
  if (explicit) {
    return {
      name: accountName(["money", event.location ?? event.cost_center, explicit]),
      type: inferAccountTypeFromText(explicit, event.payment_method),
    };
  }

  const payment = event.payment_method?.toLowerCase() ?? "";
  if (payment.includes("cash") || payment.includes("нал")) {
    return { name: accountName(["cash", event.location ?? event.cost_center ?? "unknown"]), type: "cash" };
  }
  if (payment.includes("card") || payment.includes("карт")) {
    return { name: accountName(["card", event.location ?? event.cost_center ?? "unknown"]), type: "card" };
  }
  if (payment.includes("bank") || payment.includes("банк") || payment.includes("transfer")) {
    return { name: accountName(["bank", event.location ?? event.cost_center ?? "unknown"]), type: "bank" };
  }

  return { name: accountName(["money", event.location ?? event.cost_center ?? "unknown"]), type: "unknown" };
}

function inferAccountTypeFromText(text: string, paymentMethod: string | null): AccountType {
  const haystack = `${text} ${paymentMethod ?? ""}`.toLowerCase();
  if (/cash|нал|касс/.test(haystack)) return "cash";
  if (/card|карт/.test(haystack)) return "card";
  if (/bank|банк|р\/с|счет|счёт|transfer/.test(haystack)) return "bank";
  return "unknown";
}

function expenseAccount(event: FinanceEventInput): { name: string; type: AccountType } {
  return {
    name: accountName(["expense", event.management_category ?? event.category ?? "uncategorized", event.cost_center ?? event.location]),
    type: "expense",
  };
}

function incomeAccount(event: FinanceEventInput): { name: string; type: AccountType } {
  return {
    name: accountName(["income", event.management_category ?? event.category ?? "uncategorized", event.cost_center ?? event.location]),
    type: "income",
  };
}

function payableAccount(event: FinanceEventInput): { name: string; type: AccountType } {
  return {
    name: accountName(["payable", event.counterparty ?? "unknown"]),
    type: "payable",
  };
}

async function ensureAccount(params: {
  name: string;
  type: AccountType;
  currency: string;
  location: string | null;
}): Promise<{ id: number; name: string }> {
  const [existing] = await db
    .select({ id: financialAccountsTable.id, name: financialAccountsTable.name })
    .from(financialAccountsTable)
    .where(
      and(
        eq(financialAccountsTable.name, params.name),
        eq(financialAccountsTable.currency, params.currency),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(financialAccountsTable)
    .values({
      name: params.name,
      accountType: params.type,
      currency: params.currency,
      location: params.location ?? undefined,
    })
    .returning({ id: financialAccountsTable.id, name: financialAccountsTable.name });

  return created ?? { id: 0, name: params.name };
}

function transactionStatus(event: FinanceEventInput, amount: string | null): {
  status: string;
  needsReview: boolean;
  reviewReason: string | null;
} {
  const reasons: string[] = [];
  if (!amount && event.flow_type !== "planned") reasons.push("не распознана сумма");
  if (!event.flow_type || event.flow_type === "unknown") reasons.push("не определён тип денежного потока");
  if (!event.money_account && !event.source_account && !event.destination_account && event.flow_type !== "obligation") {
    reasons.push("не определён счёт/касса/банк");
  }
  if (event.confidence === "low") reasons.push("низкая уверенность AI");

  if (event.flow_type === "planned") {
    return {
      status: amount ? "planned" : "planned_no_amount",
      needsReview: reasons.length > 0,
      reviewReason: reasons.join("; ") || null,
    };
  }

  return {
    status: reasons.length > 0 ? "needs_review" : "posted",
    needsReview: reasons.length > 0,
    reviewReason: reasons.join("; ") || null,
  };
}

export async function postAccountingTransactionFromFinanceEvent(params: {
  financialEventId: number;
  sourceType: "message" | "report";
  sourceId: number;
  chatId: number | null;
  messageId?: number | null;
  incomingReportId?: number | null;
  event: FinanceEventInput;
  rawJson?: string | null;
}): Promise<void> {
  const amount = parseMoney(params.event.amount);
  const currency = params.event.currency ?? "RUB";
  const status = transactionStatus(params.event, amount);

  try {
    const [transaction] = await db
      .insert(financialTransactionsTable)
      .values({
        financialEventId: params.financialEventId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        chatId: params.chatId ?? undefined,
        messageId: params.messageId ?? undefined,
        incomingReportId: params.incomingReportId ?? undefined,
        flowType: params.event.flow_type ?? "unknown",
        amount: amount ?? undefined,
        currency,
        location: params.event.location ?? undefined,
        managementCategory: params.event.management_category ?? params.event.category ?? undefined,
        costCenter: params.event.cost_center ?? undefined,
        projectName: params.event.project ?? undefined,
        counterparty: params.event.counterparty ?? undefined,
        paymentMethod: params.event.payment_method ?? undefined,
        documentType: params.event.document_type ?? undefined,
        documentNumber: params.event.document_number ?? undefined,
        description: params.event.description,
        status: status.status,
        confidence: params.event.confidence,
        needsReview: status.needsReview,
        reviewReason: status.reviewReason ?? undefined,
        rawJson: params.rawJson ?? JSON.stringify(params.event),
      })
      .returning({ id: financialTransactionsTable.id });

    if (!transaction || !amount) {
      await maybeStoreBalanceSnapshot(params, currency);
      return;
    }

    await createLedgerEntries({
      transactionId: transaction.id,
      event: params.event,
      amount,
      currency,
    });

    await maybeStoreBalanceSnapshot(params, currency);
  } catch (err) {
    logger.error({ err, financialEventId: params.financialEventId }, "Failed to post accounting transaction");
  }
}

async function createLedgerEntries(params: {
  transactionId: number;
  event: FinanceEventInput;
  amount: string;
  currency: string;
}): Promise<void> {
  const flow = params.event.flow_type ?? "unknown";
  const money = inferMoneyAccount(params.event);

  let debit = money;
  let credit = expenseAccount(params.event);

  if (flow === "expense" || flow === "refund") {
    debit = flow === "refund" ? { name: "expense:refunds", type: "expense" } : expenseAccount(params.event);
    credit = money;
  } else if (flow === "income") {
    debit = money;
    credit = incomeAccount(params.event);
  } else if (flow === "obligation") {
    debit = expenseAccount(params.event);
    credit = payableAccount(params.event);
  } else if (flow === "transfer") {
    debit = {
      name: accountName(["money", params.event.destination_account ?? "destination_unknown"]),
      type: inferAccountTypeFromText(params.event.destination_account ?? "", params.event.payment_method),
    };
    credit = {
      name: accountName(["money", params.event.source_account ?? "source_unknown"]),
      type: inferAccountTypeFromText(params.event.source_account ?? "", params.event.payment_method),
    };
  } else if (flow === "planned") {
    debit = expenseAccount(params.event);
    credit = { name: "clearing:planned", type: "clearing" };
  } else {
    debit = expenseAccount(params.event);
    credit = { name: "clearing:unknown_money", type: "clearing" };
  }

  const debitAccount = await ensureAccount({
    name: debit.name,
    type: debit.type,
    currency: params.currency,
    location: params.event.location ?? params.event.cost_center,
  });
  const creditAccount = await ensureAccount({
    name: credit.name,
    type: credit.type,
    currency: params.currency,
    location: params.event.location ?? params.event.cost_center,
  });

  await db.insert(financialTransactionEntriesTable).values([
    {
      transactionId: params.transactionId,
      accountId: debitAccount.id,
      accountName: debitAccount.name,
      entrySide: "debit",
      amount: params.amount,
      currency: params.currency,
      description: params.event.description,
    },
    {
      transactionId: params.transactionId,
      accountId: creditAccount.id,
      accountName: creditAccount.name,
      entrySide: "credit",
      amount: params.amount,
      currency: params.currency,
      description: params.event.description,
    },
  ]);
}

async function maybeStoreBalanceSnapshot(params: {
  sourceType: "message" | "report";
  sourceId: number;
  event: FinanceEventInput;
  rawJson?: string | null;
}, currency: string): Promise<void> {
  const balance = parseMoney(params.event.balance_after);
  if (!balance) return;

  const money = inferMoneyAccount(params.event);
  const account = await ensureAccount({
    name: money.name,
    type: money.type,
    currency,
    location: params.event.location ?? params.event.cost_center,
  });

  await db
    .update(financialAccountsTable)
    .set({
      lastKnownBalance: balance,
      lastReconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(financialAccountsTable.id, account.id));

  await db.insert(financialReconciliationsTable).values({
    accountId: account.id,
    accountName: account.name,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    statementBalance: balance,
    currency,
    status: "observed",
    notes: "Остаток распознан из сообщения/документа. Для точной сверки нужна полная выписка или ввод остатка.",
    rawJson: params.rawJson ?? JSON.stringify(params.event),
  });
}

export async function fetchAccountingSummaryForOwnerMemory(days: number): Promise<AccountingSummary[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        currency,
        COALESCE(SUM(CASE WHEN flow_type = 'income' THEN amount ELSE 0 END), 0)::text AS income,
        COALESCE(SUM(CASE WHEN flow_type = 'expense' THEN amount ELSE 0 END), 0)::text AS expense,
        COALESCE(SUM(CASE WHEN flow_type = 'planned' THEN amount ELSE 0 END), 0)::text AS planned,
        COALESCE(SUM(CASE WHEN flow_type = 'obligation' THEN amount ELSE 0 END), 0)::text AS obligation,
        COALESCE(SUM(CASE WHEN flow_type = 'transfer' THEN amount ELSE 0 END), 0)::text AS transfer,
        COALESCE(SUM(CASE WHEN flow_type = 'refund' THEN amount ELSE 0 END), 0)::text AS refund,
        COUNT(*) FILTER (WHERE needs_review = true)::int AS needs_review
      FROM financial_transactions
      WHERE created_at >= NOW() - (${days}::text || ' days')::interval
        AND status <> 'ignored'
      GROUP BY currency
      ORDER BY currency
    `);

    return result.rows.map(row => {
      const r = row as Record<string, unknown>;
      return {
        currency: String(r["currency"] ?? "RUB"),
        income: String(r["income"] ?? "0"),
        expense: String(r["expense"] ?? "0"),
        planned: String(r["planned"] ?? "0"),
        obligation: String(r["obligation"] ?? "0"),
        transfer: String(r["transfer"] ?? "0"),
        refund: String(r["refund"] ?? "0"),
        needsReview: Number(r["needs_review"] ?? 0),
      };
    });
  } catch (err) {
    logger.warn({ err }, "Accounting summary is not available yet");
    return [];
  }
}

export function formatAccountingSummaryForPrompt(summary: AccountingSummary[]): string {
  if (summary.length === 0) return "Бухгалтерская сводка пока недоступна или пуста.";

  return summary
    .map(row => [
      `Валюта: ${row.currency}`,
      `Поступления: ${row.income}`,
      `Расходы: ${row.expense}`,
      `Планируемые расходы: ${row.planned}`,
      `Обязательства/счета к оплате: ${row.obligation}`,
      `Переводы: ${row.transfer}`,
      `Возвраты: ${row.refund}`,
      `Требуют проверки: ${row.needsReview}`,
    ].join("\n"))
    .join("\n\n---\n\n");
}
