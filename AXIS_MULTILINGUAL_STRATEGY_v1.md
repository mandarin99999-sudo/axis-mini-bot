# AXIS Multilingual Strategy v1

AXIS must be a multilingual business service, not a Russian-only Telegram bot.

## Product Rule

AXIS should understand working chats and documents in different languages and answer the owner in the language selected in the business profile.

The first language layer is:
- Russian
- English
- Spanish
- German
- French
- Portuguese
- Turkish
- Kazakh
- Uzbek

More languages can be added without changing product architecture.

## What Must Be Multilingual

- owner onboarding
- owner questions and answers
- AI memory responses
- daily and pilot reports
- Mini App interface
- tariff and billing screens
- task reminders
- document/report analysis
- no-code business skills

## AI Rules

AXIS can analyze source messages in any language.

AXIS must not translate source facts that need exactness:
- names
- dates
- amounts
- document numbers
- chat names
- business locations
- counterparties
- original quotes where precision matters

Owner-facing output should use the owner preferred language, unless the owner explicitly asks for another language.

## Data Rule

Business profile stores `preferred_language`.

This should later expand into:
- owner language
- Mini App locale
- report language
- team language per chat
- default currency and region

## Monetization Rule

Multilingual support is a monetization feature. AXIS should be sellable not only to one Russian-speaking business, but to any small or medium business that works in Telegram.
