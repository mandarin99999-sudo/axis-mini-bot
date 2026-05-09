# axis-mini-bot — Шеф Бургер

Telegram-бот, личный секретарь для рабочих чатов Шеф Бургер: читает сообщения, сохраняет их в БД, фиксирует задачи и риски, отправляет вечерний доклад в 16:00 МСК.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запустить API сервер (порт 8080)
- `pnpm run typecheck` — полная проверка типов по всем пакетам
- `pnpm run typecheck:libs` — пересборка composite libs (нужно после изменений в lib/db)
- `pnpm run build` — typecheck + сборка всех пакетов
- `pnpm --filter @workspace/db run push` — применить изменения схемы DB (только dev)
- Required env: `DATABASE_URL` — строка подключения к Postgres (автоматически из Replit)
- Required secret: `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather
- Optional env: `REPORT_CHAT_ID` — Telegram chat_id куда отправлять вечерний доклад

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: grammY (Telegram Bot API, webhook mode)
- Scheduler: node-cron (вечерний доклад в 16:00 МСК)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (ESM bundle), grammy/undici/node-cron externalized

## Where things live

- `lib/db/src/schema/` — SQL-схемы: chats, messages, tasks, risks, reports
- `artifacts/api-server/src/lib/bot.ts` — grammY бот, обработчики сообщений
- `artifacts/api-server/src/lib/reporter.ts` — генерация и отправка вечернего доклада
- `artifacts/api-server/src/lib/scheduler.ts` — cron-расписание (16:00 МСК)
- `artifacts/api-server/src/routes/webhook.ts` — POST /api/webhook/telegram

## Architecture decisions

- Webhook mode (не polling): бот получает обновления через HTTPS endpoint `/api/webhook/telegram`, который регистрируется при старте сервера.
- grammy, undici, node-cron вынесены в esbuild `external` — у них native зависимости, которые нельзя бандлить.
- Все сообщения сохраняются целиком (rawJson) для аудита, и отдельно распарсенные поля для запросов.
- После изменений в `lib/db` обязательно запускать `pnpm run typecheck:libs` для пересборки деклараций.

## Product

- Бот добавляется в рабочие Telegram-чаты Шеф Бургер
- Все входящие сообщения сохраняются в PostgreSQL
- Задачи и риски можно записывать через таблицы tasks/risks
- Каждый день в 16:00 МСК бот отправляет вечерний доклад в указанный чат (REPORT_CHAT_ID)

## User preferences

- Язык: русский
- Проект: axis-mini-bot / Шеф Бургер

## Gotchas

- После изменений в `lib/db/src/schema/` всегда запускать `pnpm run typecheck:libs` перед `typecheck`.
- При первом запуске нужен рабочий TELEGRAM_BOT_TOKEN — создать через @BotFather командой `/newbot`.
- Webhook регистрируется автоматически при старте через REPLIT_DEV_DOMAIN. В dev-окружении токен должен быть настоящим (не тестовым).
- REPORT_CHAT_ID — это числовой ID чата (можно узнать через @userinfobot или добавив бота и отправив сообщение).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
