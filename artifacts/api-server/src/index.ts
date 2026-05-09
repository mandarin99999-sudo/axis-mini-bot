import app from "./app";
import { logger } from "./lib/logger";
import { bot } from "./lib/bot";
import { startScheduler } from "./lib/scheduler";
import { configureTelegramMiniAppMenu } from "./lib/mini_app";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const rawWebhookBase =
    process.env["WEBHOOK_BASE_URL"] ||
    (process.env["REPLIT_DOMAINS"]
      ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0].trim()}`
      : null) ||
    (process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : null);

  const webhookBase = rawWebhookBase?.replace(/\/+$/, "");

  if (webhookBase) {
    const webhookUrl = `${webhookBase}/api/webhook/telegram`;
    try {
      await bot.api.setWebhook(webhookUrl);
      logger.info({ webhookUrl }, "Telegram webhook registered");
    } catch (err) {
      logger.error({ err }, "Failed to set Telegram webhook");
    }
  } else {
    logger.warn("No domain env var found (WEBHOOK_BASE_URL / REPLIT_DOMAINS / REPLIT_DEV_DOMAIN) — webhook not registered");
  }

  await configureTelegramMiniAppMenu(bot);

  startScheduler(bot);
});
