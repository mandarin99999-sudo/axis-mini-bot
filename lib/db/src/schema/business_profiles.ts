import { pgTable, text, bigint, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessProfilesTable = pgTable("business_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerTelegramId: bigint("owner_telegram_id", { mode: "number" }).notNull().unique(),
  businessName: text("business_name"),
  businessType: text("business_type"),
  businessDescription: text("business_description"),
  criticalAreasJson: text("critical_areas_json").notNull().default("[]"),
  dailyReportPreference: text("daily_report_preference"),
  reportChatId: bigint("report_chat_id", { mode: "number" }),
  preferredLanguage: text("preferred_language").notNull().default("ru"),
  timezone: text("timezone").notNull().default("Asia/Yakutsk"),
  onboardingStep: text("onboarding_step"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  pilotStatus: text("pilot_status").notNull().default("not_started"),
  pilotStartedAt: timestamp("pilot_started_at", { withTimezone: true }),
  pilotEndsAt: timestamp("pilot_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBusinessProfileSchema = createInsertSchema(businessProfilesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessProfile = z.infer<typeof insertBusinessProfileSchema>;
export type BusinessProfile = typeof businessProfilesTable.$inferSelect;
