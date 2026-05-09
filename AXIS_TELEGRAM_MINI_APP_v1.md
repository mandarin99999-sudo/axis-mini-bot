# AXIS Telegram Mini App v1

AXIS Mini App is the owner cabinet inside Telegram.

It opens the web dashboard from the bot:

```text
/app
```

The bot also tries to set the Telegram menu button named `AXIS` on server startup.

## Required URL

Set this secret in Replit:

```text
AXIS_MINI_APP_URL=https://your-domain/mini-app
```

If it is not set, AXIS tries to build a URL from:

- `REPLIT_DEV_DOMAIN`
- `REPLIT_DEPLOYMENT_DOMAIN`
- `REPLIT_DOMAINS`

## Bot Commands

Owner commands:

```text
/app
/onboard
/pilot
/billing
/language ru
```

## BotFather

For production, configure the Mini App URL in BotFather:

```text
/mybots
Bot Settings
Menu Button
Configure menu button
```

Use:

```text
https://your-domain/mini-app
```

## Product Flow

1. Owner opens Telegram bot.
2. Owner taps `Open AXIS` or menu button.
3. Mini App shows:
   - trial/tariff
   - connected chats
   - pilot value
   - billing
   - tasks/risks/finance summary
4. Payment button creates `/api/billing/checkout`.
