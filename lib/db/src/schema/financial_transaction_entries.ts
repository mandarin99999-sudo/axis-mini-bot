import { pgTable, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialTransactionEntriesTable = pgTable("financial_transaction_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  transactionId: integer("transaction_id").notNull(),
  accountId: integer("account_id").notNull(),
  accountName: text("account_name").notNull(),
  entrySide: text("entry_side").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("RUB"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFinancialTransactionEntrySchema = createInsertSchema(financialTransactionEntriesTable).omit({
  createdAt: true,
});
export type InsertFinancialTransactionEntry = z.infer<typeof insertFinancialTransactionEntrySchema>;
export type FinancialTransactionEntry = typeof financialTransactionEntriesTable.$inferSelect;
