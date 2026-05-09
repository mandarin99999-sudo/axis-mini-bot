import type { Context } from "grammy";
import { db, businessProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  languageInstruction,
  languageNativeLabel,
  normalizeLanguageCode,
  supportedLanguageListForTelegram,
} from "./i18n";

type Profile = typeof businessProfilesTable.$inferSelect;

const PILOT_DAYS = 30;

function ownerId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

function telegramLanguage(ctx: Context): string {
  return normalizeLanguageCode(ctx.from?.language_code);
}

function parseAreas(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function fmtDate(date: Date | null): string {
  if (!date) return "не задано";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: process.env["AXIS_TIMEZONE"] ?? "Asia/Yakutsk",
  });
}

export async function fetchOwnerBusinessProfile(ownerTelegramId: number): Promise<Profile | null> {
  try {
    const [profile] = await db
      .select()
      .from(businessProfilesTable)
      .where(eq(businessProfilesTable.ownerTelegramId, ownerTelegramId))
      .limit(1);
    return profile ?? null;
  } catch (err) {
    logger.warn({ err, ownerTelegramId }, "Business profile table is not available yet");
    return null;
  }
}

export async function fetchPrimaryBusinessProfile(): Promise<Profile | null> {
  try {
    const [profile] = await db
      .select()
      .from(businessProfilesTable)
      .orderBy(businessProfilesTable.createdAt)
      .limit(1);
    return profile ?? null;
  } catch (err) {
    logger.warn({ err }, "Business profile table is not available yet");
    return null;
  }
}

export async function startOwnerOnboarding(ctx: Context): Promise<void> {
  const id = ownerId(ctx);
  if (!id) return;

  try {
    await db
      .insert(businessProfilesTable)
      .values({
        ownerTelegramId: id,
        reportChatId: ctx.chat?.id,
        preferredLanguage: telegramLanguage(ctx),
        onboardingStep: "business_name",
        onboardingCompleted: false,
        pilotStatus: "onboarding",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: businessProfilesTable.ownerTelegramId,
        set: {
          reportChatId: ctx.chat?.id,
          preferredLanguage: telegramLanguage(ctx),
          onboardingStep: "business_name",
          onboardingCompleted: false,
          pilotStatus: "onboarding",
          updatedAt: new Date(),
        },
      });

    await ctx.reply(
      [
        "Начинаем подключение AXIS.",
        `Язык интерфейса: ${languageNativeLabel(telegramLanguage(ctx))}. Изменить можно командой /language <код>.`,
        "",
        "1/5 Как называется бизнес?",
        "Например: Шеф Бургер, СтройБригада Север, Склад №1.",
      ].join("\n"),
    );
  } catch (err) {
    logger.error({ err, ownerTelegramId: id }, "Failed to start owner onboarding");
    await ctx.reply("Не смог начать подключение. Проверь, применена ли схема базы данных.");
  }
}

export async function maybePromptOwnerOnboarding(ctx: Context): Promise<void> {
  const id = ownerId(ctx);
  if (!id) return;

  const profile = await fetchOwnerBusinessProfile(id);
  if (profile?.onboardingCompleted) return;

  await ctx.reply(
    [
      "AXIS ещё не знает профиль бизнеса.",
      "Чтобы включить пилот, напиши /onboard — я задам 5 коротких вопросов.",
      "Язык можно изменить командой /language <код>, например /language en.",
    ].join("\n"),
  );
}

export async function setOwnerPreferredLanguage(ctx: Context, rawLanguage?: string | null): Promise<void> {
  const id = ownerId(ctx);
  if (!id) return;

  const language = normalizeLanguageCode(rawLanguage || ctx.from?.language_code || "ru");

  try {
    await db
      .insert(businessProfilesTable)
      .values({
        ownerTelegramId: id,
        reportChatId: ctx.chat?.id,
        preferredLanguage: language,
        onboardingStep: "business_name",
        onboardingCompleted: false,
        pilotStatus: "onboarding",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: businessProfilesTable.ownerTelegramId,
        set: {
          preferredLanguage: language,
          updatedAt: new Date(),
        },
      });

    await ctx.reply(
      [
        `Язык AXIS сохранён: ${languageNativeLabel(language)} (${language}).`,
        "",
        "Доступные языки:",
        supportedLanguageListForTelegram(),
      ].join("\n"),
    );
  } catch (err) {
    logger.error({ err, ownerTelegramId: id, language }, "Failed to set owner language");
    await ctx.reply("Не смог сохранить язык. Проверь, применена ли схема базы данных.");
  }
}

export async function handleOwnerOnboardingReply(ctx: Context): Promise<boolean> {
  const id = ownerId(ctx);
  const text = ctx.message?.text?.trim();
  if (!id || !text || text.startsWith("/")) return false;

  const profile = await fetchOwnerBusinessProfile(id);
  if (!profile?.onboardingStep || profile.onboardingCompleted) return false;

  try {
    if (profile.onboardingStep === "business_name") {
      await db
        .update(businessProfilesTable)
        .set({
          businessName: text.slice(0, 160),
          onboardingStep: "business_type",
          updatedAt: new Date(),
        })
        .where(eq(businessProfilesTable.ownerTelegramId, id));

      await ctx.reply(
        [
          "2/5 Чем занимается бизнес?",
          "Например: ресторанная сеть, стройка, доставка, магазин, сервисный центр.",
        ].join("\n"),
      );
      return true;
    }

    if (profile.onboardingStep === "business_type") {
      await db
        .update(businessProfilesTable)
        .set({
          businessType: text.slice(0, 160),
          businessDescription: text.slice(0, 500),
          onboardingStep: "critical_areas",
          updatedAt: new Date(),
        })
        .where(eq(businessProfilesTable.ownerTelegramId, id));

      await ctx.reply(
        [
          "3/5 Что критично не пропускать?",
          "Перечисли через запятую: задачи, деньги, касса, отчёты, клиенты, сроки, поставщики, жалобы, документы.",
        ].join("\n"),
      );
      return true;
    }

    if (profile.onboardingStep === "critical_areas") {
      await db
        .update(businessProfilesTable)
        .set({
          criticalAreasJson: JSON.stringify(parseAreas(text)),
          onboardingStep: "daily_report",
          updatedAt: new Date(),
        })
        .where(eq(businessProfilesTable.ownerTelegramId, id));

      await ctx.reply(
        [
          "4/5 Какой ежедневный доклад тебе нужен?",
          "Например: каждый день вечером кратко: задачи, риски, деньги, отчёты, что требует моего внимания.",
        ].join("\n"),
      );
      return true;
    }

    if (profile.onboardingStep === "daily_report") {
      await db
        .update(businessProfilesTable)
        .set({
          dailyReportPreference: text.slice(0, 700),
          onboardingStep: "finish",
          updatedAt: new Date(),
        })
        .where(eq(businessProfilesTable.ownerTelegramId, id));

      await ctx.reply(
        [
          "5/5 Осталось добавить AXIS в рабочие чаты.",
          "Когда добавишь, напиши сюда: готово.",
        ].join("\n"),
      );
      return true;
    }

    if (profile.onboardingStep === "finish") {
      const now = new Date();
      const pilotEnds = new Date(now.getTime() + PILOT_DAYS * 24 * 60 * 60 * 1000);
      await db
        .update(businessProfilesTable)
        .set({
          onboardingStep: null,
          onboardingCompleted: true,
          pilotStatus: "active",
          pilotStartedAt: now,
          pilotEndsAt: pilotEnds,
          updatedAt: now,
        })
        .where(eq(businessProfilesTable.ownerTelegramId, id));

      await ctx.reply(
        [
          `Профиль бизнеса готов. Пилот AXIS включён на ${PILOT_DAYS} дней.`,
          "",
          `Пилот до: ${fmtDate(pilotEnds)}`,
          "",
          "Теперь добавь меня в рабочие чаты и пиши вопросы обычным языком:",
          "Что важного сегодня?",
          "Какие задачи просрочены?",
          "Что по деньгам за неделю?",
        ].join("\n"),
      );
      return true;
    }
  } catch (err) {
    logger.error({ err, ownerTelegramId: id, step: profile.onboardingStep }, "Failed to handle onboarding reply");
    await ctx.reply("Не смог сохранить ответ onboarding. Проверь логи Replit.");
    return true;
  }

  return false;
}

export function formatBusinessProfileForPrompt(profile: Profile | null): string {
  if (!profile) return "Профиль бизнеса ещё не заполнен.";

  const areas = parseJsonStringArray(profile.criticalAreasJson);
  return [
    `Название: ${profile.businessName ?? "не указано"}`,
    `Сфера: ${profile.businessType ?? "не указано"}`,
    `Описание: ${profile.businessDescription ?? "не указано"}`,
    `Предпочтительный язык владельца: ${languageNativeLabel(profile.preferredLanguage)} (${profile.preferredLanguage})`,
    `Инструкция языка: ${languageInstruction(profile.preferredLanguage)}`,
    `Критичные зоны контроля: ${areas.length > 0 ? areas.join(", ") : "не указано"}`,
    `Пожелание к ежедневному докладу: ${profile.dailyReportPreference ?? "не указано"}`,
    `Пилот: ${profile.pilotStatus}, до ${fmtDate(profile.pilotEndsAt)}`,
  ].join("\n");
}

export function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}
