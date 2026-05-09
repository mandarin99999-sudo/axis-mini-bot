# AXIS Mini Monetization Readiness v1

## Offer

AXIS Mini is an AI secretary for business owners in Telegram.

It connects to working chats, remembers the business flow, tracks tasks and deadlines, reads reports and financial documents, keeps management finance records, and answers the owner in plain language.

## What We Sell

Not a chatbot.
Not a rule bot.
Not a calculator.

We sell owner control:

- fewer missed tasks;
- fewer unread work chats;
- visible risks;
- daily management brief;
- financial movements under control;
- business memory searchable by natural language;
- no-code adaptation to different businesses.

## First Buyer

Owner or operator of a small/medium business with 3-20 active employees and daily Telegram work chats.

Best early segments:

- restaurant or cafe network;
- retail point network;
- delivery/service business;
- construction/repair crew;
- warehouse or small production;
- local service company.

## Pilot Promise

For 30 days AXIS should show:

- what important things happened today;
- which tasks are open or overdue;
- which risks require attention;
- what reports/documents came in;
- what money moved through cash, bank, card, or expenses;
- what AXIS learned about this business.

## Minimum Owner Cabinet

The cabinet is not the main interface. Telegram is.

The cabinet exists for:

- connected chats;
- tasks and deadlines;
- risks;
- reports needing review;
- finance summary;
- no-code business skills;
- pilot readiness;
- future billing.

## Billing Core

AXIS billing should be provider-neutral.

The owner chooses a tariff in the Mini App, AXIS creates a payment link, the bank confirms payment by webhook, and AXIS extends the subscription.

Billing entities:

- plans;
- subscriptions;
- payments;
- trial status;
- paid until date;
- access status.

The first implementation can use a mock payment link. Real bank acquiring is connected later through the same billing layer.

## Owner Onboarding

The first commercial onboarding path must happen in Telegram, not in Replit.

AXIS asks the owner:

1. Business name.
2. Business type.
3. Critical areas not to miss.
4. Daily report preference.
5. Confirmation that AXIS was added to working chats.

After that AXIS starts a 30-day pilot and the owner cabinet shows pilot readiness.

## Pricing Hypothesis

Pilot:
- 30 days manually supported;
- fixed low entry price or free for first trusted testers;
- goal is proof of daily value, not revenue maximization.

Early paid plans:
- Solo: 1 owner, few chats, basic memory and tasks.
- Business: more chats, finance ledger, reports, no-code skills.
- Operations: multi-location control, advanced finance, roles, exports.

Do not sell legal accounting yet. Sell management finance control and owner assistant.

## Multilingual Requirement

AXIS must be multilingual before it is positioned as a scalable product.

The service should:

- understand work chats and documents in different languages;
- answer the owner in the language selected in the business profile;
- keep source facts exact: names, amounts, dates, document numbers and counterparties;
- localize onboarding, Mini App, tariff screens, reports and reminders.

Multilingual support is part of monetization, because AXIS is intended for any business, not only one Russian-speaking company.

## Stop Conditions

Pause monetization if:

- owner still needs Replit or code to adapt AXIS;
- Telegram answers are duplicated or unstable;
- finance records cannot be reviewed;
- AXIS cannot answer "what important happened today?";
- onboarding still requires developer involvement for every business.

## Next Build Order

1. Owner dashboard API and screen.
2. Onboarding questions in Telegram.
3. Pilot script and demo flow.
4. Exportable finance/tasks report.
5. Billing Core with mock payment link and webhook.
6. Real bank acquiring only after pilot value is proven.
