import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billingSubscriptionsTable = pgTable("billing_subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerTelegramId: bigint("owner_telegram_id", { mode: "number" }).notNull().unique(),
  businessProfileId: integer("business_profile_id"),
  planCode: text("plan_code").notNull().default("solo"),
  status: text("status").notNull().default("trial"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStartedAt: timestamp("current_period_started_at", { withTimezone: true }),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  paidUntil: timestamp("paid_until", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastPaymentId: integer("last_payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBillingSubscriptionSchema = createInsertSchema(billingSubscriptionsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBillingSubscription = z.infer<typeof insertBillingSubscriptionSchema>;
export type BillingSubscription = typeof billingSubscriptionsTable.$inferSelect;
