import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { incomingReportsTable } from "./incoming_reports";

export const incomingReportFilesTable = pgTable("incoming_report_files", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  incomingReportId: integer("incoming_report_id")
    .notNull()
    .references(() => incomingReportsTable.id),
  fileId: text("file_id").notNull(),
  fileType: text("file_type").notNull(),
  telegramFileUrl: text("telegram_file_url"),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIncomingReportFileSchema = createInsertSchema(incomingReportFilesTable).omit({
  createdAt: true,
});
export type InsertIncomingReportFile = z.infer<typeof insertIncomingReportFileSchema>;
export type IncomingReportFile = typeof incomingReportFilesTable.$inferSelect;
