import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messagesTable = pgTable("messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }).notNull(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  fromUserId: bigint("from_user_id", { mode: "number" }),
  fromUsername: text("from_username"),
  fromFirstName: text("from_first_name"),
  fromLastName: text("from_last_name"),
  text: text("text"),
  rawJson: text("raw_json").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ receivedAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
