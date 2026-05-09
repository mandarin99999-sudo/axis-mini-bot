import { pgTable, text, bigint, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialAccountsTable = pgTable("financial_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull().default("unknown"),
  currency: text("currency").notNull().default("RUB"),
  location: text("location"),
  institutionName: text("institution_name"),
  externalAccountMask: text("external_account_mask"),
  isActive: boolean("is_active").notNull().default(true),
  openingBalance: numeric("opening_balance", { precision: 16, scale: 2 }).notNull().default("0"),
  lastKnownBalance: numeric("last_known_balance", { precision: 16, scale: 2 }),
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFinancialAccountSchema = createInsertSchema(financialAccountsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFinancialAccount = z.infer<typeof insertFinancialAccountSchema>;
export type FinancialAccount = typeof financialAccountsTable.$inferSelect;
