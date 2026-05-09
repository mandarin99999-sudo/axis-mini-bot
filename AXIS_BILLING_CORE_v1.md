# AXIS Billing Core v1

Billing Core v1 is the first monetization layer for AXIS.

It is intentionally provider-neutral: today it can return a mock bank payment link, later it can connect to a real bank acquiring API without changing the product architecture.

## What Exists

Database tables:

- `billing_plans`
- `billing_subscriptions`
- `billing_payments`

Default plans:

- `solo`
- `business`
- `operations`

Trial:

- 30 days by default

## API

Plans:

```text
GET /api/billing/plans
```

Billing status:

```text
GET /api/billing/status
```

Create checkout:

```text
POST /api/billing/checkout
{
  "planCode": "business"
}
```

Mock paid webhook:

```text
POST /api/billing/webhook/mock-paid
{
  "paymentId": 1,
  "providerPaymentId": "bank_payment_id"
}
```

## Environment

Optional:

```text
BILLING_PAYMENT_BASE_URL=https://bank.example.com/pay
BILLING_PROVIDER=manual_bank
BILLING_TOKEN=...
```

If `BILLING_PAYMENT_BASE_URL` is not set, AXIS returns a placeholder payment URL.

## Next Step

When the bank contract is ready:

1. Replace the placeholder payment URL creation with the bank API.
2. Add bank webhook signature verification.
3. Map bank payment statuses to AXIS statuses.
4. Keep `billing_subscriptions` as the source of access control.
