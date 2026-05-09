import type { Bot, Context } from "grammy";
import { logger } from "./logger";

type MiniAppInlineButton =
  | { text: string; web_app: { url: string } }
  | { text: string; url: string };

type MiniAppReplyMarkup = {
  inline_keyboard: MiniAppInlineButton[][];
};

function cleanDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

function explicitMiniAppUrl(): string | null {
  const explicit =
    process.env["AXIS_MINI_APP_URL"] ??
    process.env["MINI_APP_URL"] ??
    process.env["OWNER_DASHBOARD_URL"];

  if (!explicit?.trim()) return null;
  return explicit.trim().replace(/\/$/, "");
}

function originFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function cleanPath(value: string): string {
  const path = value.trim();
  if (!path || path === "/") return "";
  return `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function resolveMiniAppPath(): string {
  const explicitPath = process.env["AXIS_MINI_APP_PATH"] ?? process.env["MINI_APP_PATH"];
  if (explicitPath?.trim()) return cleanPath(explicitPath);

  const basePath = process.env["BASE_PATH"];
  if (basePath?.trim() && basePath.trim() !== "/") {
    return `${cleanPath(basePath)}/mini-app`;
  }

  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return "/__mockup/mini-app";
  }

  return "/api/mini-app";
}

export function resolvePublicBaseUrl(): string | null {
  const explicit = explicitMiniAppUrl();

  if (explicit?.trim()) {
    const origin = originFromUrl(explicit);
    if (origin) return origin;
    return explicit.replace(/\/(?:__mockup\/|api\/)?mini-app\/?$/i, "").replace(/\/$/, "");
  }

  const domain =
    process.env["REPLIT_DEV_DOMAIN"] ??
    process.env["REPLIT_DEPLOYMENT_DOMAIN"] ??
    process.env["REPLIT_DOMAINS"]?.split(",")[0];

  if (!domain?.trim()) return null;
  return `https://${cleanDomain(domain)}`;
}

export function resolveMiniAppUrl(): string | null {
  const explicit = explicitMiniAppUrl();
  if (explicit) {
    const origin = originFromUrl(explicit);
    if (origin) {
      const path = new URL(explicit).pathname;
      if (path && path !== "/") return explicit;
      return `${explicit}${resolveMiniAppPath()}`;
    }

    if (explicit.includes("/mini-app")) return explicit;
  }

  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}${resolveMiniAppPath()}`;
}

export function resolveMiniAppRootUrl(): string | null {
  return resolvePublicBaseUrl();
}

export function miniAppReplyMarkup(): MiniAppReplyMarkup | undefined {
  const url = resolveMiniAppUrl();
  const rootUrl = resolveMiniAppRootUrl();
  if (!url) return undefined;

  return {
    inline_keyboard: [
      [
        {
          text: "Открыть AXIS Mini App",
          web_app: { url },
        },
      ],
      [
        {
          text: "Открыть в браузере",
          url,
        },
      ],
      [
        {
          text: "Проверить API",
          url: `${rootUrl ?? url}/api/healthz`,
        },
      ],
    ],
  };
}

export function miniAppDebugInfo(): string {
  const url = resolveMiniAppUrl();
  const domain =
    process.env["REPLIT_DEV_DOMAIN"] ??
    process.env["REPLIT_DEPLOYMENT_DOMAIN"] ??
    process.env["REPLIT_DOMAINS"]?.split(",")[0] ??
    "not_set";

  return [
    "AXIS Mini App debug",
    "",
    `Resolved URL: ${url ?? "not_configured"}`,
    `Root URL: ${resolveMiniAppRootUrl() ?? "not_configured"}`,
    `Health URL: ${resolveMiniAppRootUrl() ? `${resolveMiniAppRootUrl()}/api/healthz` : "not_configured"}`,
    `AXIS_MINI_APP_URL: ${process.env["AXIS_MINI_APP_URL"] ? "set" : "not_set"}`,
    `REPLIT domain: ${domain}`,
    "",
    "Проверь сначала обычную ссылку и /api/healthz в браузере.",
    "Если браузер открывает, а Mini App нет — нужно настроить URL в BotFather/Menu Button или сменить домен на стабильный.",
  ].join("\n");
}

export async function sendMiniAppButton(ctx: Context): Promise<void> {
  const replyMarkup = miniAppReplyMarkup();
  const url = resolveMiniAppUrl();

  if (!replyMarkup || !url) {
    await ctx.reply(
      [
        "Mini App URL ещё не настроен.",
        "",
        "Добавь в Secrets:",
        "AXIS_MINI_APP_URL=https://твой-домен/mini-app",
      ].join("\n"),
    );
    return;
  }

  await ctx.reply(
    [
      "AXIS Mini App",
      "",
      "Здесь кабинет владельца: тариф, trial, подключённые чаты, задачи, финансы и ценность пилота.",
    ].join("\n"),
    { reply_markup: replyMarkup },
  );
}

export async function configureTelegramMiniAppMenu(bot: Bot): Promise<void> {
  const url = resolveMiniAppUrl();
  if (!url) {
    logger.warn("AXIS Mini App URL is not configured; Telegram menu button was not set");
    return;
  }

  try {
    const api = bot.api as unknown as {
      setChatMenuButton(args: {
        menu_button: {
          type: "web_app";
          text: string;
          web_app: { url: string };
        };
      }): Promise<unknown>;
    };

    await api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "AXIS",
        web_app: { url },
      },
    });

    logger.info({ url }, "Telegram Mini App menu button configured");
  } catch (err) {
    logger.error({ err, url }, "Failed to configure Telegram Mini App menu button");
  }
}
