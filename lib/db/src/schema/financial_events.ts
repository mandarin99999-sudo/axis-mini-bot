import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialEventsTable = pgTable("financial_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  chatId: bigint("chat_id", { mode: "number" }),
  messageId: integer("message_id"),
  incomingReportId: integer("incoming_report_id"),
  eventType: text("event_type").notNull().default("unknown"),
  flowType: text("flow_type").notNull().default("unknown"),
  location: text("location"),
  amount: text("amount"),
  currency: text("currency").notNull().default("RUB"),
  category: text("category"),
  managementCategory: text("management_category"),
  costCenter: text("cost_center"),
  projectName: text("project_name"),
  itemName: text("item_name"),
  counterparty: text("counterparty"),
  paymentMethod: text("payment_method"),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  moneyAccount: text("money_account"),
  sourceAccount: text("source_account"),
  destinationAccount: text("destination_account"),
  balanceAfter: text("balance_after"),
  lineItemsJson: text("line_items_json"),
  tagsJson: text("tags_json"),
  description: text("description").notNull(),
  status: text("status").notNull().default("observed"),
  confidence: text("confidence").notNull().default("medium"),
  rawJson: text("raw_json"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFinancialEventSchema = createInsertSchema(financialEventsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFinancialEvent = z.infer<typeof insertFinancialEventSchema>;
export type FinancialEvent = typeof financialEventsTable.$inferSelect;
