import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rulesTable = pgTable("rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  pattern: text("pattern"),
  category: text("category").notNull().default("general"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRuleSchema = createInsertSchema(rulesTable).omit({ createdAt: true, updatedAt: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rulesTable.$inferSelect;
