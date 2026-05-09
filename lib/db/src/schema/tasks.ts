import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  messageId: bigint("message_id", { mode: "number" }),
  ruleId: bigint("rule_id", { mode: "number" }),
  ruleName: text("rule_name"),
  originalText: text("original_text"),
  assignedToUserId: bigint("assigned_to_user_id", { mode: "number" }),
  assignedToUsername: text("assigned_to_username"),
  description: text("description").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ extractedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
