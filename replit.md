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

## Первый деплой (разовая процедура)

Бот должен работать непрерывно (Always On / VM), чтобы принимать Telegram-вебхуки и
запускать cron 16:00 МСК. `artifact.toml` уже содержит `deploymentTarget = "vm"`.

### Шаги

1. **Убедись, что secrets выставлены в Replit**
   - `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather
   - `REPORT_CHAT_ID` — числовой ID чата для вечернего доклада
   - `DATABASE_URL` — подключается автоматически из Replit Postgres

2. **Нажми Publish в Replit**
   - В шапке редактора: **Publish** → тип **Always On (VM)**
   - Дождись успешного билда (зелёный статус)
   - Production URL будет вида `https://<имя>.replit.app`

3. **Вебхук регистрируется автоматически при старте**
   Сервер выбирает URL в следующем порядке:
   - `WEBHOOK_BASE_URL` (явный secret, если задан) — рекомендуется для production
   - `REPLIT_DOMAINS` (первый домен — обычно `.replit.app` в production VM)
   - `REPLIT_DEV_DOMAIN` (dev-домен, fallback)

   **Рекомендуется**: задать secret `WEBHOOK_BASE_URL=https://<имя>.replit.app` в Replit Secrets перед деплоем — это гарантирует правильный домен.

   Проверить после старта:
   ```
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
   ```
   В ответе `url` должен быть `https://<имя>.replit.app/api/webhook/telegram`,
   а `pending_update_count` = 0.

4. **Дымовой тест**
   - Отправь любое сообщение боту в рабочем чат — оно должно сохраниться в БД
   - Проверь production логи в Replit (вкладка Deployments → Logs)

5. **Проверь вечерний доклад**
   В 16:00 МСК бот отправит доклад в `REPORT_CHAT_ID`.
   Для ручной проверки можно временно выставить `REPORT_CHAT_ID` в свой личный чат.

### Последующие деплои

После настройки GitHub → Replit Auto-Deploy (см. ниже) каждый `git push origin main`
будет деплоиться автоматически без ручного Publish.

---

## GitHub → Replit Auto-Deploy

Файл: `.github/workflows/deploy.yml`

Push в ветку `main` на GitHub автоматически триггерит деплой в Replit через Replit API.

### Что нужно настроить в GitHub репозитории

1. **Secret** `REPLIT_API_TOKEN` — API-токен Replit.
   - Получить: https://replit.com/account → API tokens → Generate token
   - Добавить: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

2. **Variable** `REPLIT_REPL_ID` — ID репла в Replit.
   - Текущее значение: `a1137e07-215b-46d6-aaaa-223364ed3313`
   - Добавить: GitHub repo → Settings → Secrets and variables → Actions → Variables → New repository variable

После этого каждый `git push origin main` будет запускать деплой, а его статус будет виден на вкладке Actions в GitHub.

## Gotchas

- После изменений в `lib/db/src/schema/` всегда запускать `pnpm run typecheck:libs` перед `typecheck`.
- При первом запуске нужен рабочий TELEGRAM_BOT_TOKEN — создать через @BotFather командой `/newbot`.
- Webhook регистрируется автоматически при старте. Домен выбирается по приоритету: WEBHOOK_BASE_URL → REPLIT_DOMAINS → REPLIT_DEV_DOMAIN. Для production VM рекомендуется задать secret WEBHOOK_BASE_URL=https://&lt;имя&gt;.replit.app. Токен должен быть настоящим (не тестовым).
- REPORT_CHAT_ID — это числовой ID чата (можно узнать через @userinfobot или добавив бота и отправив сообщение).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
