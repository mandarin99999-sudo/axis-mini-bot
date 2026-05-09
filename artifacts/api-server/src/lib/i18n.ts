export type SupportedLanguage = "ru" | "en" | "es" | "de" | "fr" | "pt" | "tr" | "kk" | "uz";

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  ru: "ru",
  rus: "ru",
  russian: "ru",
  русский: "ru",
  en: "en",
  eng: "en",
  english: "en",
  es: "es",
  spa: "es",
  spanish: "es",
  de: "de",
  deu: "de",
  german: "de",
  fr: "fr",
  fre: "fr",
  french: "fr",
  pt: "pt",
  por: "pt",
  portuguese: "pt",
  tr: "tr",
  turkish: "tr",
  kk: "kk",
  kazakh: "kk",
  uz: "uz",
  uzbek: "uz",
};

export const SUPPORTED_LANGUAGES: Array<{ code: SupportedLanguage; label: string; nativeLabel: string }> = [
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe" },
  { code: "kk", label: "Kazakh", nativeLabel: "Қазақша" },
  { code: "uz", label: "Uzbek", nativeLabel: "O'zbekcha" },
];

export function normalizeLanguageCode(input: string | null | undefined): SupportedLanguage {
  const raw = String(input ?? "").trim().toLowerCase().replace("_", "-");
  if (!raw) return "ru";

  const exact = LANGUAGE_ALIASES[raw];
  if (exact) return exact;

  const base = raw.split("-")[0] ?? "";
  return LANGUAGE_ALIASES[base] ?? "ru";
}

export function languageNativeLabel(language: string | null | undefined): string {
  const code = normalizeLanguageCode(language);
  return SUPPORTED_LANGUAGES.find(item => item.code === code)?.nativeLabel ?? "Русский";
}

export function languageInstruction(language: string | null | undefined): string {
  const code = normalizeLanguageCode(language);
  const label = languageNativeLabel(code);
  return `Preferred owner language: ${label} (${code}). Answer owner-facing messages in this language unless the owner explicitly asks for another language. Understand messages and documents in any language and preserve names, amounts, dates, chats and source facts exactly.`;
}

export function supportedLanguageListForTelegram(): string {
  return SUPPORTED_LANGUAGES.map(item => `${item.code} — ${item.nativeLabel}`).join("\n");
}
