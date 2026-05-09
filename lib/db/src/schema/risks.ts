import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const risksTable = pgTable("risks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  messageId: bigint("message_id", { mode: "number" }),
  ruleId: bigint("rule_id", { mode: "number" }),
  ruleName: text("rule_name"),
  originalText: text("original_text"),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertRiskSchema = createInsertSchema(risksTable).omit({ detectedAt: true });
export type InsertRisk = z.infer<typeof insertRiskSchema>;
export type Risk = typeof risksTable.$inferSelect;
