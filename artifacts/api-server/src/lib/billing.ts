import {
  billingPaymentsTable,
  billingPlansTable,
  billingSubscriptionsTable,
  db,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchPrimaryBusinessProfile } from "./owner_onboarding";
import { logger } from "./logger";

const DEFAULT_TRIAL_DAYS = 30;
const DEFAULT_BILLING_PROVIDER = "manual_bank";

type BillingStatus = {
  ownerTelegramId: number | null;
  plan: {
    code: string;
    name: string;
    monthlyPrice: string;
    currency: string;
    trialDays: number;
    maxChats: number;
    maxUsers: number;
    features: string[];
  } | null;
  subscription: {
    status: string;
    trialEndsAt: string | null;
    paidUntil: string | null;
    currentPeriodEndsAt: string | null;
  } | null;
  access: {
    allowed: boolean;
    reason: "trial" | "paid" | "expired" | "not_configured";
    daysLeft: number | null;
  };
  nextPayment: {
    planCode: string;
    amount: string;
    currency: string;
  } | null;
};

const DEFAULT_PLANS = [
  {
    code: "solo",
    name: "Solo",
    description: "Для владельца и нескольких рабочих чатов.",
    monthlyPrice: "4900",
    currency: "RUB",
    trialDays: DEFAULT_TRIAL_DAYS,
    maxChats: 3,
    maxUsers: 1,
    sortOrder: 10,
    features: ["Память рабочих чатов", "Задачи и дедлайны", "Доклад владельцу", "30 дней бесплатно"],
  },
  {
    code: "business",
    name: "Business",
    description: "Для бизнеса с несколькими точками, отчётами и финансами.",
    monthlyPrice: "12900",
    currency: "RUB",
    trialDays: DEFAULT_TRIAL_DAYS,
    maxChats: 12,
    maxUsers: 5,
    sortOrder: 20,
    features: ["Все из Solo", "Финансовый журнал", "AI-анализ отчётов", "No-code навыки бизнеса"],
  },
  {
    code: "operations",
    name: "Operations",
    description: "Для операционного контроля сети, ролей и расширенных отчётов.",
    monthlyPrice: "29900",
    currency: "RUB",
    trialDays: DEFAULT_TRIAL_DAYS,
    maxChats: 50,
    maxUsers: 20,
    sortOrder: 30,
    features: ["Все из Business", "Много точек/объектов", "Расширенный контроль", "Приоритетная поддержка"],
  },
];

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysLeft(date: Date | null | undefined): number | null {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function parseFeatures(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function formatPlan(plan: typeof billingPlansTable.$inferSelect): BillingStatus["plan"] {
  return {
    code: plan.code,
    name: plan.name,
    monthlyPrice: String(plan.monthlyPrice),
    currency: plan.currency,
    trialDays: plan.trialDays,
    maxChats: plan.maxChats,
    maxUsers: plan.maxUsers,
    features: parseFeatures(plan.featuresJson),
  };
}

async function resolveOwnerTelegramId(ownerTelegramId?: number | null): Promise<number | null> {
  if (ownerTelegramId) return ownerTelegramId;
  const profile = await fetchPrimaryBusinessProfile();
  return profile?.ownerTelegramId ?? null;
}

export async function ensureDefaultBillingPlans(): Promise<void> {
  try {
    for (const plan of DEFAULT_PLANS) {
      await db
        .insert(billingPlansTable)
        .values({
          code: plan.code,
          name: plan.name,
          description: plan.description,
          monthlyPrice: plan.monthlyPrice,
          currency: plan.currency,
          trialDays: plan.trialDays,
          maxChats: plan.maxChats,
          maxUsers: plan.maxUsers,
          featuresJson: JSON.stringify(plan.features),
          isActive: true,
          sortOrder: plan.sortOrder,
        })
        .onConflictDoUpdate({
          target: billingPlansTable.code,
          set: {
            name: plan.name,
            description: plan.description,
            monthlyPrice: plan.monthlyPrice,
            currency: plan.currency,
            trialDays: plan.trialDays,
            maxChats: plan.maxChats,
            maxUsers: plan.maxUsers,
            featuresJson: JSON.stringify(plan.features),
            isActive: true,
            sortOrder: plan.sortOrder,
            updatedAt: new Date(),
          },
        });
    }
  } catch (err) {
    logger.warn({ err }, "Billing plans table is not available yet");
  }
}

export async function fetchBillingPlans(): Promise<NonNullable<BillingStatus["plan"]>[]> {
  await ensureDefaultBillingPlans();
  try {
    const plans = await db
      .select()
      .from(billingPlansTable)
      .where(eq(billingPlansTable.isActive, true))
      .orderBy(billingPlansTable.sortOrder);
    return plans.map(plan => formatPlan(plan)!);
  } catch (err) {
    logger.warn({ err }, "Failed to fetch billing plans");
    return DEFAULT_PLANS.map(plan => ({
      code: plan.code,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      currency: plan.currency,
      trialDays: plan.trialDays,
      maxChats: plan.maxChats,
      maxUsers: plan.maxUsers,
      features: plan.features,
    }));
  }
}

async function findPlan(planCode: string): Promise<typeof billingPlansTable.$inferSelect | null> {
  await ensureDefaultBillingPlans();
  const [plan] = await db
    .select()
    .from(billingPlansTable)
    .where(eq(billingPlansTable.code, planCode))
    .limit(1);
  return plan ?? null;
}

async function getOrCreateSubscription(ownerTelegramId: number, planCode = "solo"): Promise<typeof billingSubscriptionsTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.ownerTelegramId, ownerTelegramId))
    .limit(1);

  if (existing) return existing;

  const profile = await fetchPrimaryBusinessProfile();
  const now = new Date();
  const trialEnds = addDays(now, DEFAULT_TRIAL_DAYS);
  const [created] = await db
    .insert(billingSubscriptionsTable)
    .values({
      ownerTelegramId,
      businessProfileId: profile?.ownerTelegramId === ownerTelegramId ? profile.id : undefined,
      planCode,
      status: "trial",
      trialStartedAt: now,
      trialEndsAt: trialEnds,
      currentPeriodStartedAt: now,
      currentPeriodEndsAt: trialEnds,
      updatedAt: now,
    })
    .returning();

  if (!created) throw new Error("Failed to create billing subscription");
  return created;
}

function accessForSubscription(subscription: typeof billingSubscriptionsTable.$inferSelect | null): BillingStatus["access"] {
  if (!subscription) {
    return { allowed: false, reason: "not_configured", daysLeft: null };
  }

  const now = Date.now();
  if (subscription.status === "active" && subscription.paidUntil && subscription.paidUntil.getTime() >= now) {
    return { allowed: true, reason: "paid", daysLeft: daysLeft(subscription.paidUntil) };
  }

  if (subscription.status === "trial" && subscription.trialEndsAt && subscription.trialEndsAt.getTime() >= now) {
    return { allowed: true, reason: "trial", daysLeft: daysLeft(subscription.trialEndsAt) };
  }

  return { allowed: false, reason: "expired", daysLeft: 0 };
}

export async function getBillingStatus(ownerTelegramId?: number | null): Promise<BillingStatus> {
  await ensureDefaultBillingPlans();
  const resolvedOwnerId = await resolveOwnerTelegramId(ownerTelegramId);

  if (!resolvedOwnerId) {
    return {
      ownerTelegramId: null,
      plan: null,
      subscription: null,
      access: { allowed: false, reason: "not_configured", daysLeft: null },
      nextPayment: null,
    };
  }

  const subscription = await getOrCreateSubscription(resolvedOwnerId);
  const plan = await findPlan(subscription.planCode);
  const formattedPlan = plan ? formatPlan(plan) : null;

  return {
    ownerTelegramId: resolvedOwnerId,
    plan: formattedPlan,
    subscription: {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      paidUntil: subscription.paidUntil?.toISOString() ?? null,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
    },
    access: accessForSubscription(subscription),
    nextPayment: formattedPlan ? {
      planCode: formattedPlan.code,
      amount: formattedPlan.monthlyPrice,
      currency: formattedPlan.currency,
    } : null,
  };
}

function buildPaymentUrl(paymentId: number, ownerTelegramId: number, planCode: string): string {
  const base = process.env["BILLING_PAYMENT_BASE_URL"];
  if (!base) {
    return `https://payment.example.com/axis-mini?payment_id=${paymentId}&owner=${ownerTelegramId}&plan=${planCode}`;
  }

  try {
    const url = new URL(base);
    url.searchParams.set("payment_id", String(paymentId));
    url.searchParams.set("owner", String(ownerTelegramId));
    url.searchParams.set("plan", planCode);
    return url.toString();
  } catch {
    return `${base}?payment_id=${paymentId}&owner=${ownerTelegramId}&plan=${planCode}`;
  }
}

export async function createBillingCheckout(params: {
  ownerTelegramId?: number | null;
  planCode: string;
}): Promise<{
  paymentId: number;
  paymentUrl: string;
  status: BillingStatus;
}> {
  const ownerTelegramId = await resolveOwnerTelegramId(params.ownerTelegramId);
  if (!ownerTelegramId) throw new Error("owner_telegram_id_required");

  const plan = await findPlan(params.planCode);
  if (!plan) throw new Error("billing_plan_not_found");

  const subscription = await getOrCreateSubscription(ownerTelegramId, plan.code);
  const [payment] = await db
    .insert(billingPaymentsTable)
    .values({
      ownerTelegramId,
      subscriptionId: subscription.id,
      planCode: plan.code,
      provider: process.env["BILLING_PROVIDER"] ?? DEFAULT_BILLING_PROVIDER,
      status: "pending",
      amount: String(plan.monthlyPrice),
      currency: plan.currency,
      rawPayloadJson: JSON.stringify({ source: "axis_checkout_v1" }),
      updatedAt: new Date(),
    })
    .returning();

  if (!payment) throw new Error("failed_to_create_payment");

  const paymentUrl = buildPaymentUrl(payment.id, ownerTelegramId, plan.code);
  await db
    .update(billingPaymentsTable)
    .set({ paymentUrl, updatedAt: new Date() })
    .where(eq(billingPaymentsTable.id, payment.id));

  return {
    paymentId: payment.id,
    paymentUrl,
    status: await getBillingStatus(ownerTelegramId),
  };
}

export async function markBillingPaymentPaid(params: {
  paymentId: number;
  providerPaymentId?: string | null;
  rawPayload?: unknown;
}): Promise<BillingStatus> {
  const [payment] = await db
    .select()
    .from(billingPaymentsTable)
    .where(eq(billingPaymentsTable.id, params.paymentId))
    .limit(1);

  if (!payment) throw new Error("billing_payment_not_found");

  const now = new Date();
  const paidUntil = addDays(now, 30);

  await db
    .update(billingPaymentsTable)
    .set({
      status: "paid",
      providerPaymentId: params.providerPaymentId ?? payment.providerPaymentId,
      paidAt: now,
      rawPayloadJson: JSON.stringify(params.rawPayload ?? {}),
      updatedAt: now,
    })
    .where(eq(billingPaymentsTable.id, payment.id));

  await db
    .update(billingSubscriptionsTable)
    .set({
      planCode: payment.planCode,
      status: "active",
      currentPeriodStartedAt: now,
      currentPeriodEndsAt: paidUntil,
      paidUntil,
      lastPaymentId: payment.id,
      updatedAt: now,
    })
    .where(eq(billingSubscriptionsTable.ownerTelegramId, payment.ownerTelegramId));

  return getBillingStatus(payment.ownerTelegramId);
}

export function formatBillingStatusForTelegram(status: BillingStatus): string {
  if (!status.ownerTelegramId || !status.plan || !status.subscription) {
    return "Billing ещё не настроен. Сначала пройди /onboard.";
  }

  const accessLabel = status.access.reason === "paid"
    ? "оплачено"
    : status.access.reason === "trial"
      ? "бесплатный период"
      : "доступ истёк";

  return [
    "AXIS Mini · подписка",
    "",
    `Тариф: ${status.plan.name}`,
    `Статус: ${status.subscription.status} (${accessLabel})`,
    `Дней осталось: ${status.access.daysLeft ?? "—"}`,
    `Оплачено до: ${status.subscription.paidUntil ?? "—"}`,
    `Trial до: ${status.subscription.trialEndsAt ?? "—"}`,
    "",
    `Следующий платёж: ${status.nextPayment?.amount ?? status.plan.monthlyPrice} ${status.nextPayment?.currency ?? status.plan.currency}/мес`,
  ].join("\n");
}
