import { pgTable, text, bigint, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cashierReportsTable = pgTable("cashier_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  senderTelegramId: bigint("sender_telegram_id", { mode: "number" }).notNull(),
  senderName: text("sender_name"),
  fileId: text("file_id"),
  hasPhoto: boolean("has_photo").notNull().default(false),
  hasDocument: boolean("has_document").notNull().default(false),
  caption: text("caption"),
  detectedLocation: text("detected_location"),
  detectionSource: text("detection_source").notNull().default("unknown"),
  status: text("status").notNull().default("received"),
  mediaGroupId: text("media_group_id"),
  locationPromptSent: boolean("location_prompt_sent").notNull().default(false),
  lastFileAt: timestamp("last_file_at", { withTimezone: true }),
  reportType: text("report_type").notNull().default("cashier_report"),
  rawJson: text("raw_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCashierReportSchema = createInsertSchema(cashierReportsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCashierReport = z.infer<typeof insertCashierReportSchema>;
export type CashierReport = typeof cashierReportsTable.$inferSelect;
