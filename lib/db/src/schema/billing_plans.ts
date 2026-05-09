import { pgTable, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billingPlansTable = pgTable("billing_plans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("RUB"),
  trialDays: integer("trial_days").notNull().default(30),
  maxChats: integer("max_chats").notNull().default(3),
  maxUsers: integer("max_users").notNull().default(1),
  featuresJson: text("features_json").notNull().default("[]"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBillingPlanSchema = createInsertSchema(billingPlansTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBillingPlan = z.infer<typeof insertBillingPlanSchema>;
export type BillingPlan = typeof billingPlansTable.$inferSelect;
