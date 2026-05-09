import { db, risksTable, cashierReportsTable } from "@workspace/db";
import { eq, and, gte, inArray, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

export const KNOWN_LOCATIONS = ["Алдан", "Нерюнгри", "Куранах"];
const RULE_NAME = "missing_cashier_report";
// chatId = 0 is a sentinel for system-generated risks not tied to any chat
const SYSTEM_CHAT_ID = 0;

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function getLocationsWithReportsToday(since: Date): Promise<Set<string>> {
  const rows = await db
    .select({ detectedLocation: cashierReportsTable.detectedLocation })
    .from(cashierReportsTable)
    .where(
      and(
        gte(cashierReportsTable.createdAt, since),
        inArray(cashierReportsTable.status, ["received", "processed"]),
        isNotNull(cashierReportsTable.detectedLocation),
      ),
    );
  return new Set(rows.map(r => r.detectedLocation!).filter(Boolean));
}

/**
 * Run on every report generation.
 * - Locations missing a cashier report → create/keep a high risk open.
 * - Locations that now have a report → resolve any open risk.
 */
export async function checkMissingCashierReports(): Promise<void> {
  const since = todayStart();
  const date = fmtDateRu(new Date());
  const locationsWithReports = await getLocationsWithReportsToday(since);

  for (const location of KNOWN_LOCATIONS) {
    const hasReport = locationsWithReports.has(location);

    const [existing] = await db
      .select()
      .from(risksTable)
      .where(
        and(
          eq(risksTable.ruleName, RULE_NAME),
          eq(risksTable.originalText, location),
          gte(risksTable.detectedAt, since),
        ),
      )
      .limit(1);

    if (hasReport) {
      if (existing && existing.status === "open") {
        await db
          .update(risksTable)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            description: `По точке ${location} кассовый отчёт поступил позже — закрыт автоматически.`,
          })
          .where(eq(risksTable.id, existing.id));
        logger.info({ location, riskId: existing.id }, "Missing cashier report risk resolved");
      }
    } else {
      if (!existing) {
        await db.insert(risksTable).values({
          chatId: SYSTEM_CHAT_ID,
          ruleName: RULE_NAME,
          originalText: location,
          description: `По точке ${location} не найден кассовый отчёт за ${date}`,
          severity: "high",
          status: "open",
        });
        logger.info({ location }, "Missing cashier report risk created");
      }
      // if existing and still open — leave it, already flagged
    }
  }
}

/**
 * Call immediately when a cashier report with a known location is received or confirmed.
 * Closes any open missing_cashier_report risk for that location today.
 */
export async function closeMissingCashierReportRisk(location: string): Promise<void> {
  const since = todayStart();

  const [existing] = await db
    .select()
    .from(risksTable)
    .where(
      and(
        eq(risksTable.ruleName, RULE_NAME),
        eq(risksTable.originalText, location),
        eq(risksTable.status, "open"),
        gte(risksTable.detectedAt, since),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(risksTable)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        description: `По точке ${location} кассовый отчёт получен — риск закрыт.`,
      })
      .where(eq(risksTable.id, existing.id));
    logger.info({ location, riskId: existing.id }, "Missing cashier report risk closed on report receipt");
  }
}
