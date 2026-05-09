import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { rulesTable, tasksTable, risksTable } from "@workspace/db";
import { logger } from "./logger";

type Severity = "low" | "medium" | "high" | "critical";

const RULE_SEVERITY: Record<string, Severity> = {
  cash_refund: "critical",
  cash_mismatch: "high",
  missing_report: "high",
  hours_fraud_risk: "high",
  unclear_expense_or_invoice: "high",
  courier_payment: "medium",
  bank_card_expense: "medium",
  shift_issue: "medium",
};

export type ScanResult = {
  ruleName: string;
  category: string;
  recordType: "task" | "risk";
  skipped: boolean;
};

export async function scanMessage(params: {
  messageId: number;
  chatId: number;
  text: string;
}): Promise<ScanResult[]> {
  const { messageId, chatId, text } = params;
  const results: ScanResult[] = [];

  const activeRules = await db
    .select()
    .from(rulesTable)
    .where(eq(rulesTable.isActive, true));

  for (const rule of activeRules) {
    if (!rule.pattern) continue;

    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "i");
    } catch {
      logger.warn({ ruleName: rule.name, pattern: rule.pattern }, "Invalid regex pattern in rule");
      continue;
    }

    if (!regex.test(text)) continue;

    logger.info(
      { ruleName: rule.name, category: rule.category, messageId, chatId },
      "Rule matched",
    );

    const isTaskCategory = rule.category === "tasks" || rule.category === "deadline";
    const isRiskCategory = rule.category === "risks" || rule.category === "reports";

    if (isTaskCategory) {
      const existing = await db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.messageId, messageId),
            eq(tasksTable.ruleId, rule.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        results.push({ ruleName: rule.name, category: rule.category, recordType: "task", skipped: true });
        continue;
      }

      const status = rule.category === "deadline" ? "deadline_open" : "open";

      await db.insert(tasksTable).values({
        chatId,
        messageId,
        ruleId: rule.id,
        ruleName: rule.name,
        originalText: text,
        description: text.length > 200 ? text.slice(0, 200) + "…" : text,
        status,
      });

      results.push({ ruleName: rule.name, category: rule.category, recordType: "task", skipped: false });

    } else if (isRiskCategory) {
      const existing = await db
        .select({ id: risksTable.id })
        .from(risksTable)
        .where(
          and(
            eq(risksTable.messageId, messageId),
            eq(risksTable.ruleId, rule.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        results.push({ ruleName: rule.name, category: rule.category, recordType: "risk", skipped: true });
        continue;
      }

      const severity: Severity = RULE_SEVERITY[rule.name] ?? "medium";

      await db.insert(risksTable).values({
        chatId,
        messageId,
        ruleId: rule.id,
        ruleName: rule.name,
        originalText: text,
        description: text.length > 200 ? text.slice(0, 200) + "…" : text,
        severity,
        status: "open",
      });

      results.push({ ruleName: rule.name, category: rule.category, recordType: "risk", skipped: false });
    }
  }

  return results;
}
