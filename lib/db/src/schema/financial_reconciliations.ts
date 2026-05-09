import { pgTable, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialReconciliationsTable = pgTable("financial_reconciliations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull(),
  accountName: text("account_name").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  statementBalance: numeric("statement_balance", { precision: 16, scale: 2 }).notNull(),
  ledgerBalance: numeric("ledger_balance", { precision: 16, scale: 2 }),
  discrepancyAmount: numeric("discrepancy_amount", { precision: 16, scale: 2 }),
  currency: text("currency").notNull().default("RUB"),
  status: text("status").notNull().default("observed"),
  notes: text("notes"),
  rawJson: text("raw_json"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFinancialReconciliationSchema = createInsertSchema(financialReconciliationsTable).omit({
  createdAt: true,
});
export type InsertFinancialReconciliation = z.infer<typeof insertFinancialReconciliationSchema>;
export type FinancialReconciliation = typeof financialReconciliationsTable.$inferSelect;
