import cron from "node-cron";
import type { Bot } from "grammy";
import { logger } from "./logger";
import { sendEveningReport } from "./reporter";
import { sendDueTaskFollowups } from "./task_followup";

const REPORT_CHAT_ID = process.env["REPORT_CHAT_ID"];

export function startScheduler(bot?: Bot): void {
  if (!REPORT_CHAT_ID) {
    logger.warn("REPORT_CHAT_ID not set — evening reports will not be sent automatically");
  } else {
    cron.schedule(
      "0 16 * * *",
      async () => {
        logger.info("Running scheduled evening report");
        await sendEveningReport(REPORT_CHAT_ID);
      },
      { timezone: "Europe/Moscow" },
    );

    logger.info({ chatId: REPORT_CHAT_ID }, "Scheduler started — evening report at 16:00 MSK");
  }

  cron.schedule(
    "*/5 * * * *",
    async () => {
      if (!bot) return;
      await sendDueTaskFollowups(bot);
    },
  );
  logger.info("Task follow-up scheduler started — every 5 minutes");
}
