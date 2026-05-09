import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bot,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  ListChecks,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

const AXIS_LOGO = "/axis-logo-telegram.jpg";

type DashboardData = {
  product: {
    name: string;
    stage: string;
    offer: string;
    primary_interface: string;
    dashboard_role: string;
  };
  period: { days: number; generated_at: string };
  business_profile: {
    business_name: string | null;
    business_type: string | null;
    business_description: string | null;
    critical_areas: string[];
    daily_report_preference: string | null;
    preferred_language: string;
    onboarding_completed: boolean;
    onboarding_step: string | null;
    pilot_status: string;
    pilot_started_at: string | null;
    pilot_ends_at: string | null;
    timezone: string;
  };
  supported_languages?: Array<{ code: string; label: string; nativeLabel: string }>;
  billing?: {
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
  kpi: {
    active_chats: number;
    messages_today: number;
    messages_period: number;
    open_tasks: number;
    overdue_tasks: number;
    open_risks: number;
    high_risks: number;
    reports_need_review: number;
    finance_needs_review: number;
    business_skills: number;
  };
  finance_summary: Array<{
    currency: string;
    income: string;
    expense: string;
    obligations: string;
    planned: string;
    refunds: string;
    needs_review: number;
  }>;
  pilot_readiness: {
    score: number;
    total: number;
    checks: Array<{ key: string; label: string; ok: boolean }>;
  };
  pilot_value?: {
    period: { days: number; from: string; to: string };
    metrics: {
      activeChats: number;
      messagesProcessed: number;
      tasksFound: number;
      overdueTasks: number;
      risksFound: number;
      highRisks: number;
      reportsReceived: number;
      reportsNeedReview: number;
      financeEvents: number;
      financeNeedsReview: number;
      businessSkills: number;
    };
    valueMetrics: Array<{ key: string; label: string; value: number; impact: string }>;
    salesReadiness: {
      score: number;
      total: number;
      verdict: "not_ready" | "pilot_ready" | "payment_ready";
      reasons: string[];
    };
    ownerSummary: string;
  };
  lists: {
    tasks: Array<Record<string, unknown>>;
    risks: Array<Record<string, unknown>>;
    reports_need_review: Array<Record<string, unknown>>;
    finance_needs_review: Array<Record<string, unknown>>;
    finance_events: Array<Record<string, unknown>>;
    business_skills: Array<Record<string, unknown>>;
  };
};

const fallbackData: DashboardData = {
  product: {
    name: "AXIS Mini",
    stage: "pilot_readiness",
    offer: "AI-секретарь для владельца бизнеса",
    primary_interface: "Telegram",
    dashboard_role: "кабинет владельца",
  },
  business_profile: {
    business_name: "Шеф Бургер",
    business_type: "Ресторанная сеть",
    business_description: "Точки общепита с кассой, доставкой, отчётами и закупками",
    critical_areas: ["касса", "задачи", "финансы", "отчёты", "сроки"],
    daily_report_preference: "Вечером кратко: задачи, риски, деньги, отчёты и что требует внимания.",
    preferred_language: "ru",
    onboarding_completed: true,
    onboarding_step: null,
    pilot_status: "active",
    pilot_started_at: new Date().toISOString(),
    pilot_ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    timezone: "Asia/Yakutsk",
  },
  supported_languages: [
    { code: "ru", label: "Russian", nativeLabel: "Русский" },
    { code: "en", label: "English", nativeLabel: "English" },
    { code: "es", label: "Spanish", nativeLabel: "Español" },
  ],
  billing: {
    plan: {
      code: "business",
      name: "Business",
      monthlyPrice: "12900",
      currency: "RUB",
      trialDays: 30,
      maxChats: 12,
      maxUsers: 5,
      features: ["Финансовый журнал", "AI-анализ отчётов", "No-code навыки"],
    },
    subscription: {
      status: "trial",
      trialEndsAt: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000).toISOString(),
      paidUntil: null,
      currentPeriodEndsAt: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000).toISOString(),
    },
    access: {
      allowed: true,
      reason: "trial",
      daysLeft: 24,
    },
    nextPayment: {
      planCode: "business",
      amount: "12900",
      currency: "RUB",
    },
  },
  period: { days: 7, generated_at: new Date().toISOString() },
  kpi: {
    active_chats: 3,
    messages_today: 84,
    messages_period: 612,
    open_tasks: 9,
    overdue_tasks: 2,
    open_risks: 5,
    high_risks: 2,
    reports_need_review: 3,
    finance_needs_review: 4,
    business_skills: 6,
  },
  finance_summary: [
    {
      currency: "RUB",
      income: "184500.00",
      expense: "67240.00",
      obligations: "31500.00",
      planned: "12000.00",
      refunds: "3500.00",
      needs_review: 4,
    },
  ],
  pilot_readiness: {
    score: 5,
    total: 6,
    checks: [
      { key: "business_profile", label: "Профиль бизнеса заполнен", ok: true },
      { key: "telegram_intake", label: "Рабочие чаты подключены", ok: true },
      { key: "memory", label: "Память сообщений наполняется", ok: true },
      { key: "tasks", label: "Задачи и дедлайны видны", ok: true },
      { key: "finance", label: "Финансовый журнал работает", ok: true },
      { key: "skills", label: "No-code навыки владельца есть", ok: false },
    ],
  },
  pilot_value: {
    period: {
      days: 30,
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
    },
    metrics: {
      activeChats: 3,
      messagesProcessed: 612,
      tasksFound: 18,
      overdueTasks: 2,
      risksFound: 7,
      highRisks: 2,
      reportsReceived: 11,
      reportsNeedReview: 3,
      financeEvents: 24,
      financeNeedsReview: 4,
      businessSkills: 6,
    },
    valueMetrics: [
      { key: "messages", label: "Сообщений обработано", value: 612, impact: "Рабочий поток попал в память AXIS." },
      { key: "tasks", label: "Задач найдено", value: 18, impact: "Поручения и сроки стали контролируемыми." },
      { key: "finance", label: "Финансовых событий", value: 24, impact: "Деньги начали попадать в управленческий журнал." },
    ],
    salesReadiness: {
      score: 6,
      total: 7,
      verdict: "payment_ready",
      reasons: ["рабочие чаты подключены", "есть реальный поток сообщений", "финансовый журнал начал наполняться"],
    },
    ownerSummary: "За 30 дней AXIS обработал 612 сообщений, нашёл 18 задач, 7 рисков и принял 11 отчётов. Пилот выглядит готовым к разговору об оплате: ценность уже видна на реальных данных.",
  },
  lists: {
    tasks: [
      { id: 41, chat_title: "Axis test", description: "Проверить кассовый отчёт по Алдану", status: "deadline_open" },
      { id: 42, chat_title: "Снабжение", description: "Закрыть счёт поставщика", status: "waiting_confirmation" },
    ],
    risks: [
      { id: 8, severity: "critical", chat_title: "Axis test", description: "Возврат наличными требует проверки" },
      { id: 9, severity: "high", chat_title: "Касса", description: "Нет отчёта по точке" },
    ],
    reports_need_review: [
      { id: 15, sender_name: "Ксюша", report_type: "invoice_or_expense", detected_location: "Алдан" },
    ],
    finance_needs_review: [
      { id: 5, flow_type: "expense", amount: "3200.00", currency: "RUB", description: "Расход по карте без авансового отчёта" },
    ],
    finance_events: [
      { id: 11, flow_type: "income", amount: "68400", currency: "RUB", description: "Поступление на банк по точке" },
      { id: 12, flow_type: "expense", amount: "18500", currency: "RUB", description: "Оплата поставщику" },
    ],
    business_skills: [
      { id: 1, title: "Просроченные срочные задачи", scope: "tasks", action_summary: "Напоминать ответственному и сообщать владельцу" },
    ],
  },
};

const money = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

function num(value: string | number | undefined): number {
  const n = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(value: string | number | undefined, currency = "RUB"): string {
  return `${money.format(num(value))} ${currency}`;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function pilotVerdictLabel(value: NonNullable<DashboardData["pilot_value"]>["salesReadiness"]["verdict"] | undefined): string {
  if (value === "payment_ready") return "готов к оплате";
  if (value === "pilot_ready") return "есть ценность";
  return "нужны данные";
}

function languageLabel(data: DashboardData): string {
  const code = data.business_profile.preferred_language || "ru";
  return data.supported_languages?.find(item => item.code === code)?.nativeLabel ?? code.toUpperCase();
}

function billingStatusLabel(reason: NonNullable<DashboardData["billing"]>["access"]["reason"] | undefined): string {
  if (reason === "paid") return "оплачено";
  if (reason === "trial") return "бесплатный период";
  if (reason === "expired") return "доступ истёк";
  return "не настроено";
}

function text(row: Record<string, unknown>, key: string, fallback = "—"): string {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  const toneClass = {
    neutral: "border-[#D7DCE2] bg-white text-[#1B2430]",
    good: "border-[#B7C0CA] bg-white text-[#1B2430]",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-rose-200 bg-rose-50 text-rose-950",
  }[tone];

  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[#344150]">{label}</span>
        <Icon className="h-4 w-4 text-[#8C96A3]" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal [font-family:'Space_Grotesk',Inter,sans-serif]">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 py-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-normal text-[#344150]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CompactList({
  rows,
  render,
  empty,
}: {
  rows: Array<Record<string, unknown>>;
  render: (row: Record<string, unknown>) => ReactNode;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">{empty}</div>;
  }

  return <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">{rows.slice(0, 6).map(render)}</div>;
}

export default function OwnerDashboard() {
  const [data, setData] = useState<DashboardData>(fallbackData);
  const [status, setStatus] = useState<"demo" | "live" | "error">("demo");
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/owner-dashboard?days=7&fast=1")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<DashboardData>;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setStatus("live");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("demo");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createCheckout(): Promise<void> {
    setCheckoutState("loading");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: data.billing?.plan?.code ?? "business" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const checkout = await res.json() as { paymentUrl?: string };
      if (checkout.paymentUrl) {
        window.location.href = checkout.paymentUrl;
      }
      setCheckoutState("idle");
    } catch {
      setCheckoutState("error");
    }
  }

  const finance = data.finance_summary[0];
  const readinessPercent = useMemo(() => {
    if (!data.pilot_readiness.total) return 0;
    return Math.round((data.pilot_readiness.score / data.pilot_readiness.total) * 100);
  }, [data.pilot_readiness.score, data.pilot_readiness.total]);
  const pilotValuePercent = useMemo(() => {
    const value = data.pilot_value?.salesReadiness;
    if (!value?.total) return 0;
    return Math.round((value.score / value.total) * 100);
  }, [data.pilot_value?.salesReadiness?.score, data.pilot_value?.salesReadiness?.total]);

  return (
    <main className="min-h-screen bg-[#F3F4F6] text-[#1B2430] [font-family:Inter,sans-serif]">
      <div className="mx-auto max-w-7xl px-5 py-5">
        <header className="flex flex-col gap-4 border-b border-[#D7DCE2] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#D7DCE2] bg-white">
              <img src={AXIS_LOGO} alt="AXIS" className="h-full w-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-[#8C96A3]">
                <Bot className="h-4 w-4" />
                <span>{data.product.name}</span>
                <span className="rounded-sm border border-[#D7DCE2] bg-white px-2 py-0.5 text-xs text-[#344150]">Mini App</span>
                <span className="rounded-sm border border-[#D7DCE2] bg-white px-2 py-0.5 text-xs text-[#344150]">{data.product.stage}</span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[#1B2430] [font-family:'Space_Grotesk',Inter,sans-serif]">
                Центр управления AXIS
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-[#D7DCE2] bg-white px-3 py-2 text-sm text-[#344150]">
              {status === "live" ? "Live API" : "Demo data"}
            </span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D7DCE2] bg-white px-3 text-sm font-medium text-[#344150] hover:bg-[#F3F4F6]">
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1B2430] px-3 text-sm font-medium text-white hover:bg-[#344150]">
              <CreditCard className="h-4 w-4" />
              Оплатить
            </button>
          </div>
        </header>

        <section className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile icon={MessageSquare} label="Чаты" value={data.kpi.active_chats} tone="good" />
          <MetricTile icon={Activity} label="Сообщения сегодня" value={data.kpi.messages_today} />
          <MetricTile icon={ListChecks} label="Открытые задачи" value={data.kpi.open_tasks} tone={data.kpi.overdue_tasks > 0 ? "warn" : "neutral"} />
          <MetricTile icon={AlertTriangle} label="High/Critical риски" value={data.kpi.high_risks} tone={data.kpi.high_risks > 0 ? "danger" : "good"} />
          <MetricTile icon={Zap} label="Навыки AXIS" value={data.kpi.business_skills} tone="good" />
        </section>

        <section className="grid gap-4 pb-5 lg:grid-cols-3">
          <div className="rounded-md border border-[#D7DCE2] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-[#344150]">Тариф</h2>
              <CreditCard className="h-5 w-5 text-[#8C96A3]" />
            </div>
            <div className="text-xl font-semibold text-[#1B2430] [font-family:'Space_Grotesk',Inter,sans-serif]">
              {data.billing?.plan?.name ?? "30 дней бесплатно"}
            </div>
            <p className="mt-2 text-sm leading-6 text-[#344150]">
              {billingStatusLabel(data.billing?.access.reason)}
              {data.billing?.access.daysLeft !== null && data.billing?.access.daysLeft !== undefined
                ? ` · осталось ${data.billing.access.daysLeft} дн.`
                : ""}
            </p>
            <div className="mt-3 text-sm font-medium text-[#1B2430]">
              {data.billing?.nextPayment
                ? `${fmtMoney(data.billing.nextPayment.amount, data.billing.nextPayment.currency)} / мес.`
                : "Тариф будет выбран после пилота"}
            </div>
          </div>

          <div className="rounded-md border border-[#D7DCE2] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-[#344150]">Подключение групп</h2>
              <Users className="h-5 w-5 text-[#8C96A3]" />
            </div>
            <div className="text-xl font-semibold text-[#1B2430] [font-family:'Space_Grotesk',Inter,sans-serif]">{data.kpi.active_chats} активных чатов</div>
            <button className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-[#D7DCE2] bg-white px-3 text-sm font-medium text-[#344150] hover:bg-[#F3F4F6]">
              <Users className="h-4 w-4" />
              Добавить AXIS в группу
            </button>
          </div>

          <div className="rounded-md border border-[#D7DCE2] bg-[#1B2430] p-4 text-white">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-white/80">Оплата</h2>
              <ShieldCheck className="h-5 w-5 text-white/60" />
            </div>
            <div className="text-xl font-semibold [font-family:'Space_Grotesk',Inter,sans-serif]">Банковская страница</div>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Кнопка оплаты ведёт на страницу банка, webhook подтверждает оплату и продлевает доступ.
            </p>
            <button
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-[#2F6BFF] px-3 text-sm font-medium text-white hover:bg-[#2558d6] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={checkoutState === "loading"}
              onClick={() => void createCheckout()}
            >
              <CreditCard className="h-4 w-4" />
              {checkoutState === "loading" ? "Создаю ссылку" : "Оплатить тариф"}
            </button>
            {checkoutState === "error" ? (
              <div className="mt-2 text-xs text-white/60">Платёжная ссылка пока недоступна</div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Финансы за 7 дней</h2>
                <p className="mt-1 text-sm text-slate-500">Управленческий журнал и сверка требуют проверки владельца.</p>
              </div>
              <Banknote className="h-5 w-5 text-slate-500" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricTile icon={Banknote} label="Поступления" value={fmtMoney(finance?.income, finance?.currency)} tone="good" />
              <MetricTile icon={Banknote} label="Расходы" value={fmtMoney(finance?.expense, finance?.currency)} />
              <MetricTile icon={Clock} label="К проверке" value={finance?.needs_review ?? data.kpi.finance_needs_review} tone={(finance?.needs_review ?? 0) > 0 ? "warn" : "good"} />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Готовность к пилоту</h2>
              <ShieldCheck className="h-5 w-5 text-slate-500" />
            </div>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{readinessPercent}%</span>
              <span className="text-sm text-slate-500">{data.pilot_readiness.score} из {data.pilot_readiness.total}</span>
            </div>
            <div className="space-y-2">
              {(data.pilot_readiness.checks ?? []).map((check) => (
                <div key={check.key} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className={`h-4 w-4 ${check.ok ? "text-emerald-600" : "text-slate-300"}`} />
                  <span className={check.ok ? "text-slate-700" : "text-slate-400"}>{check.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {data.pilot_value ? (
          <section className="grid gap-4 py-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Ценность пилота</h2>
                  <p className="mt-1 text-sm text-slate-500">Что AXIS уже сделал за период и чем это можно доказать владельцу.</p>
                </div>
                <TrendingUp className="h-5 w-5 text-slate-500" />
              </div>
              <p className="text-sm leading-6 text-slate-700">{data.pilot_value.ownerSummary ?? ""}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(data.pilot_value.valueMetrics ?? []).slice(0, 3).map((item) => (
                  <div key={item.key} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-2xl font-semibold text-slate-950">{item.value}</div>
                    <div className="mt-1 text-sm font-medium text-slate-700">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.impact}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Готовность к оплате</h2>
                <ShieldCheck className="h-5 w-5 text-slate-500" />
              </div>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold">{pilotValuePercent}%</span>
                <span className="text-sm text-slate-500">
                  {data.pilot_value.salesReadiness?.score ?? 0} из {data.pilot_value.salesReadiness?.total ?? 0}
                </span>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-950">
                {pilotVerdictLabel(data.pilot_value.salesReadiness?.verdict)}
              </div>
              <div className="mt-3 space-y-2">
                {(data.pilot_value.salesReadiness?.reasons ?? []).slice(0, 5).map((reason) => (
                  <div key={reason} className="flex items-center gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 py-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Профиль бизнеса</h2>
              <Bot className="h-5 w-5 text-slate-500" />
            </div>
            <div className="text-lg font-semibold text-slate-950">
              {data.business_profile.business_name ?? "Не заполнен"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {data.business_profile.business_type ?? "Сфера бизнеса не указана"}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-sm border border-[#D7DCE2] bg-[#F3F4F6] px-2 py-1 text-xs font-medium text-[#344150]">
              <MessageSquare className="h-3.5 w-3.5 text-[#8C96A3]" />
              Язык: {languageLabel(data)}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.business_profile.critical_areas.length > 0 ? data.business_profile.critical_areas.map((area) => (
                <span key={area} className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  {area}
                </span>
              )) : (
                <span className="text-sm text-slate-400">Критичные зоны ещё не заданы</span>
              )}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-700">Пилот</h2>
              <ShieldCheck className="h-5 w-5 text-slate-500" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricTile icon={CheckCircle2} label="Onboarding" value={data.business_profile.onboarding_completed ? "готов" : "не начат"} tone={data.business_profile.onboarding_completed ? "good" : "warn"} />
              <MetricTile icon={Activity} label="Статус" value={data.business_profile.pilot_status} tone={data.business_profile.pilot_status === "active" ? "good" : "neutral"} />
              <MetricTile icon={Clock} label="Пилот до" value={fmtDate(data.business_profile.pilot_ends_at)} />
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Задачи и дедлайны">
            <CompactList
              rows={data.lists.tasks}
              empty="Открытых задач нет."
              render={(row) => (
                <div key={String(row.id)} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{text(row, "description")}</div>
                      <div className="mt-1 text-xs text-slate-500">{text(row, "chat_title")} · {text(row, "status")}</div>
                    </div>
                    <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                  </div>
                </div>
              )}
            />
          </Section>

          <Section title="Риски">
            <CompactList
              rows={data.lists.risks}
              empty="Открытых рисков нет."
              render={(row) => (
                <div key={String(row.id)} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{text(row, "description")}</div>
                      <div className="mt-1 text-xs text-slate-500">{text(row, "chat_title")} · {text(row, "severity")}</div>
                    </div>
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  </div>
                </div>
              )}
            />
          </Section>

          <Section title="Финансовые события">
            <CompactList
              rows={data.lists.finance_events}
              empty="Финансовых событий за период нет."
              render={(row) => (
                <div key={String(row.id)} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{text(row, "description")}</div>
                      <div className="mt-1 text-xs text-slate-500">{text(row, "flow_type")} · {fmtMoney(text(row, "amount", "0"), text(row, "currency", "RUB"))}</div>
                    </div>
                    <Banknote className="h-4 w-4 shrink-0 text-emerald-600" />
                  </div>
                </div>
              )}
            />
          </Section>

          <Section title="Отчёты и навыки">
            <CompactList
              rows={[...(data.lists.reports_need_review ?? []), ...(data.lists.business_skills ?? [])]}
              empty="Нет отчётов на проверку и новых навыков."
              render={(row) => (
                <div key={`${String(row.id)}-${text(row, "title", text(row, "report_type"))}`} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{text(row, "title", text(row, "report_type"))}</div>
                      <div className="mt-1 text-xs text-slate-500">{text(row, "action_summary", text(row, "sender_name", "на проверке"))}</div>
                    </div>
                    <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                  </div>
                </div>
              )}
            />
          </Section>
        </div>
      </div>
    </main>
  );
}
