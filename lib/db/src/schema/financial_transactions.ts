import { pgTable, text, bigint, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialTransactionsTable = pgTable("financial_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  financialEventId: integer("financial_event_id"),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  chatId: bigint("chat_id", { mode: "number" }),
  messageId: integer("message_id"),
  incomingReportId: integer("incoming_report_id"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull().defaultNow(),
  flowType: text("flow_type").notNull().default("unknown"),
  amount: numeric("amount", { precision: 16, scale: 2 }),
  currency: text("currency").notNull().default("RUB"),
  location: text("location"),
  managementCategory: text("management_category"),
  costCenter: text("cost_center"),
  projectName: text("project_name"),
  counterparty: text("counterparty"),
  paymentMethod: text("payment_method"),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  description: text("description").notNull(),
  status: text("status").notNull().default("needs_review"),
  confidence: text("confidence").notNull().default("medium"),
  needsReview: boolean("needs_review").notNull().default(true),
  reviewReason: text("review_reason"),
  rawJson: text("raw_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFinancialTransactionSchema = createInsertSchema(financialTransactionsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFinancialTransaction = z.infer<typeof insertFinancialTransactionSchema>;
export type FinancialTransaction = typeof financialTransactionsTable.$inferSelect;
