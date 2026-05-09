import { pgTable, text, bigint, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessSkillsTable = pgTable("business_skills", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  title: text("title").notNull(),
  instructionText: text("instruction_text").notNull(),
  triggerSummary: text("trigger_summary").notNull(),
  actionSummary: text("action_summary").notNull(),
  scope: text("scope").notNull().default("general"),
  appliesToJson: text("applies_to_json").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  confidence: text("confidence").notNull().default("medium"),
  confirmationRequired: boolean("confirmation_required").notNull().default(false),
  sourceChatId: bigint("source_chat_id", { mode: "number" }),
  sourceMessageId: bigint("source_message_id", { mode: "number" }),
  createdByUserId: bigint("created_by_user_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBusinessSkillSchema = createInsertSchema(businessSkillsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessSkill = z.infer<typeof insertBusinessSkillSchema>;
export type BusinessSkill = typeof businessSkillsTable.$inferSelect;
