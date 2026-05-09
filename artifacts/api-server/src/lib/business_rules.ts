import { db, rulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchBusinessSkills } from "./business_skills";
import { logger } from "./logger";

export type AiBusinessRule = {
  name: string;
  description: string;
  category: string;
};

const AI_RULE_CATEGORY = "ai_business";

export async function fetchAiBusinessRules(limit = 30): Promise<AiBusinessRule[]> {
  try {
    const rules = await db
      .select({
        name: rulesTable.name,
        description: rulesTable.description,
        category: rulesTable.category,
        createdAt: rulesTable.createdAt,
      })
      .from(rulesTable)
      .where(eq(rulesTable.isActive, true))
      .orderBy(rulesTable.createdAt);

    const aiRules = rules
      .filter(rule => rule.category === AI_RULE_CATEGORY)
      .slice(-limit)
      .map(rule => ({
        name: rule.name,
        description: rule.description,
        category: rule.category,
      }));

    const skills = await fetchBusinessSkills(limit);
    const skillRules: AiBusinessRule[] = skills.map(skill => ({
      name: `skill_${skill.name}`,
      description: [
        skill.title,
        `Когда: ${skill.triggerSummary}`,
        `Действие: ${skill.actionSummary}`,
        `Инструкция: ${skill.instructionText}`,
      ].join("\n"),
      category: "business_skill",
    }));

    return [...aiRules, ...skillRules].slice(-limit);
  } catch (err) {
    logger.error({ err }, "Failed to load AI business rules");
    return [];
  }
}

export function formatAiBusinessRulesForPrompt(rules: AiBusinessRule[]): string {
  if (rules.length === 0) {
    return "Активных правил владельца пока нет.";
  }

  return rules
    .map((rule, idx) => `${idx + 1}. [${rule.category}] ${rule.name}:\n${rule.description}`)
    .join("\n\n");
}

export function aiBusinessRuleCategory(): string {
  return AI_RULE_CATEGORY;
}
