import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";

export const cashierReportFilesTable = pgTable("cashier_report_files", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cashierReportId: integer("cashier_report_id").notNull(),
  fileId: text("file_id").notNull(),
  fileType: text("file_type").notNull(),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CashierReportFile = typeof cashierReportFilesTable.$inferSelect;
