import { pgTable, text, bigint, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billingPaymentsTable = pgTable("billing_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerTelegramId: bigint("owner_telegram_id", { mode: "number" }).notNull(),
  subscriptionId: integer("subscription_id"),
  planCode: text("plan_code").notNull(),
  provider: text("provider").notNull().default("manual_bank"),
  providerPaymentId: text("provider_payment_id"),
  status: text("status").notNull().default("pending"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("RUB"),
  paymentUrl: text("payment_url"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rawPayloadJson: text("raw_payload_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBillingPaymentSchema = createInsertSchema(billingPaymentsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBillingPayment = z.infer<typeof insertBillingPaymentSchema>;
export type BillingPayment = typeof billingPaymentsTable.$inferSelect;
