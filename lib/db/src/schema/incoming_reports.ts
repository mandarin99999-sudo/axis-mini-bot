import { pgTable, text, bigint, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const incomingReportsTable = pgTable("incoming_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  senderTelegramId: bigint("sender_telegram_id", { mode: "number" }).notNull(),
  senderName: text("sender_name"),
  mediaGroupId: text("media_group_id"),
  rawJson: text("raw_json").notNull(),

  aiAnalysisJson: text("ai_analysis_json"),
  reportType: text("report_type").notNull().default("unknown"),
  detectedLocation: text("detected_location"),
  detectedDate: text("detected_date"),
  summary: text("summary"),
  detectedAmountsJson: text("detected_amounts_json"),
  detectedRisksJson: text("detected_risks_json"),
  confidence: text("confidence"),
  needsClarification: boolean("needs_clarification").notNull().default(false),
  clarificationQuestion: text("clarification_question"),

  needsOwnerReview: boolean("needs_owner_review").notNull().default(false),
  ownerReviewStatus: text("owner_review_status").notNull().default("pending"),
  ownerCorrectionJson: text("owner_correction_json"),
  aiErrorNotes: text("ai_error_notes"),

  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIncomingReportSchema = createInsertSchema(incomingReportsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertIncomingReport = z.infer<typeof insertIncomingReportSchema>;
export type IncomingReport = typeof incomingReportsTable.$inferSelect;
