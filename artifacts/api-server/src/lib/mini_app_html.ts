export function renderMiniAppHtml(): string {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta name="theme-color" content="#1B2430" />
    <title>AXIS Mini App</title>
    <link rel="icon" href="/axis-logo-telegram.jpg" />
    <style>
      :root {
        --graphite: #1B2430;
        --steel: #344150;
        --silver: #8C96A3;
        --mist: #F3F4F6;
        --white: #FFFFFF;
        --blue: #2F6BFF;
        --border: #D7DCE2;
        --soft: #E8EBEF;
      }
      * { box-sizing: border-box; }
      html { background: var(--mist); }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--mist);
        color: var(--graphite);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Arial, sans-serif;
      }
      .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 20px 0 36px; }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--border);
      }
      .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .logo {
        width: 58px;
        height: 58px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--white);
        overflow: hidden;
        flex: 0 0 auto;
      }
      .logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .eyebrow { color: var(--silver); font-size: 13px; display: flex; gap: 8px; flex-wrap: wrap; }
      h1 {
        margin: 5px 0 0;
        font-size: clamp(27px, 5vw, 42px);
        letter-spacing: 0;
        line-height: 1.04;
      }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      button, .button {
        min-height: 40px;
        border-radius: 8px;
        border: 1px solid var(--border);
        padding: 0 14px;
        background: var(--white);
        color: var(--steel);
        font-weight: 700;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      button:disabled { opacity: .65; cursor: wait; }
      .primary { background: var(--graphite); color: var(--white); border-color: var(--graphite); }
      .grid { display: grid; gap: 14px; margin-top: 18px; }
      .kpi { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      .two { grid-template-columns: 1.2fr .8fr; }
      .three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .card {
        background: var(--white);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 17px;
      }
      .dark { background: var(--graphite); color: var(--white); border-color: var(--graphite); }
      .label { color: var(--steel); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .dark .label { color: rgba(255,255,255,.72); }
      .value {
        margin-top: 11px;
        font-size: 27px;
        font-weight: 800;
        line-height: 1;
      }
      .muted { color: var(--silver); font-size: 14px; line-height: 1.55; }
      .dark .muted { color: rgba(255,255,255,.68); }
      .summary { font-size: 15px; line-height: 1.65; color: var(--steel); }
      .pill { display: inline-flex; align-items: center; padding: 6px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--mist); font-size: 12px; font-weight: 700; color: var(--steel); }
      .list { display: grid; gap: 8px; margin-top: 14px; }
      .item { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); color: var(--steel); font-size: 14px; }
      .item strong { color: var(--graphite); white-space: nowrap; }
      .status-live { color: #18794E; }
      .status-warmup { color: #8A5A00; }
      @media (max-width: 820px) {
        .topbar { align-items: flex-start; flex-direction: column; }
        .actions { justify-content: flex-start; width: 100%; }
        .actions button { flex: 1 1 auto; }
        .kpi, .two, .three { grid-template-columns: 1fr; }
        .shell { width: min(100% - 24px, 1120px); padding-top: 14px; }
        .logo { width: 52px; height: 52px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo"><img src="/axis-logo-telegram.jpg" alt="AXIS" loading="eager" decoding="async" /></div>
          <div>
            <div class="eyebrow"><span>AXIS Mini</span><span>Mini App</span><span id="stage" class="status-warmup">opening</span></div>
            <h1>Центр управления AXIS</h1>
          </div>
        </div>
        <div class="actions">
          <button id="refresh">Обновить</button>
          <button class="primary" id="pay">Оплатить</button>
        </div>
      </header>

      <section class="grid kpi">
        <div class="card"><div class="label">Чаты</div><div class="value" id="activeChats">—</div></div>
        <div class="card"><div class="label">Сообщения сегодня</div><div class="value" id="messagesToday">—</div></div>
        <div class="card"><div class="label">Открытые задачи</div><div class="value" id="openTasks">—</div></div>
        <div class="card"><div class="label">High/Critical риски</div><div class="value" id="highRisks">—</div></div>
        <div class="card"><div class="label">Навыки AXIS</div><div class="value" id="skills">—</div></div>
      </section>

      <section class="grid three">
        <div class="card">
          <div class="label">Тариф</div>
          <div class="value" id="planName">30 дней бесплатно</div>
          <p class="muted" id="billingStatus">Доступ открыт на период пилота</p>
        </div>
        <div class="card">
          <div class="label">Подключение групп</div>
          <div class="value" id="connectedChats">—</div>
          <p class="muted">Добавьте AXIS в рабочие Telegram-группы, чтобы он видел поток бизнеса.</p>
        </div>
        <div class="card dark">
          <div class="label">Оплата</div>
          <div class="value">Банк</div>
          <p class="muted">Кнопка создаёт платёжную ссылку. После webhook подписка продлевается автоматически.</p>
        </div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="label">Ценность пилота</div>
          <p class="summary" id="pilotSummary">Кабинет открыт. Загружаю live-данные AXIS...</p>
          <div class="list" id="valueMetrics"></div>
        </div>
        <div class="card">
          <div class="label">Профиль бизнеса</div>
          <div class="value" id="businessName">—</div>
          <p class="muted" id="businessType">—</p>
          <div id="language" class="pill">Язык: ru</div>
        </div>
      </section>
    </main>

    <script>
      const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
      const el = (id) => document.getElementById(id);
      const setText = (id, value) => {
        const node = el(id);
        if (node) node.textContent = value == null || value === "" ? "—" : String(value);
      };

      function setStage(value, live) {
        const node = el("stage");
        if (!node) return;
        node.textContent = value;
        node.className = live ? "status-live" : "status-warmup";
      }

      function fmtMoney(value, currency) {
        const n = Number(String(value || 0).replace(",", "."));
        return money.format(Number.isFinite(n) ? n : 0) + " " + (currency || "RUB");
      }

      function renderFallback(reason) {
        setStage(reason || "warmup", false);
        setText("pilotSummary", "Кабинет открыт. Live-данные не успели загрузиться, сервер может прогреваться. Нажмите «Обновить» через несколько секунд.");
        el("valueMetrics").innerHTML = [
          "<div class='item'><span>Статус Mini App</span><strong>открыт</strong></div>",
          "<div class='item'><span>Период пилота</span><strong>30 дней</strong></div>",
          "<div class='item'><span>Источник данных</span><strong>ожидает API</strong></div>"
        ].join("");
      }

      function fetchJsonWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...(options || {}), signal: controller.signal })
          .finally(() => clearTimeout(timer))
          .then((res) => {
            if (!res.ok) throw new Error(String(res.status));
            return res.json();
          });
      }

      function renderDashboard(data) {
        setStage(data.product?.stage || "live", true);
        setText("activeChats", data.kpi?.active_chats);
        setText("messagesToday", data.kpi?.messages_today);
        setText("openTasks", data.kpi?.open_tasks);
        setText("highRisks", data.kpi?.high_risks);
        setText("skills", data.kpi?.business_skills);
        setText("connectedChats", (data.kpi?.active_chats ?? "—") + " чатов");
        setText("businessName", data.business_profile?.business_name || "Профиль не заполнен");
        setText("businessType", data.business_profile?.business_type || "Сфера бизнеса не указана");
        const languages = data.supported_languages || [];
        const lang = languages.find((item) => item.code === data.business_profile?.preferred_language);
        setText("language", "Язык: " + (lang?.nativeLabel || data.business_profile?.preferred_language || "ru"));
        setText("pilotSummary", data.pilot_value?.ownerSummary || "Данных пилота пока недостаточно.");
        setText("planName", data.billing?.plan?.name || "30 дней бесплатно");

        const billing = data.billing;
        if (billing?.access) {
          const reason = billing.access.reason;
          const label = reason === "paid" ? "оплачено" : reason === "trial" ? "бесплатный период" : reason === "expired" ? "доступ истёк" : "не настроено";
          const next = billing.nextPayment ? " · " + fmtMoney(billing.nextPayment.amount, billing.nextPayment.currency) + " / мес." : "";
          const days = billing.access.daysLeft != null ? " · осталось " + billing.access.daysLeft + " дн." : "";
          setText("billingStatus", label + days + next);
        }

        const metrics = data.pilot_value?.valueMetrics || [];
        el("valueMetrics").innerHTML = metrics.slice(0, 4).map((item) => (
          "<div class='item'><span>" + item.label + "</span><strong>" + item.value + "</strong></div>"
        )).join("");
      }

      async function loadDashboard() {
        setStage("loading", false);
        try {
          const data = await fetchJsonWithTimeout("/api/owner-dashboard?days=7&fast=1", undefined, 4500);
          renderDashboard(data);
        } catch (err) {
          console.error(err);
          renderFallback("warmup");
        }
      }

      async function checkout() {
        const button = el("pay");
        button.disabled = true;
        button.textContent = "Создаю ссылку";
        try {
          const data = await fetchJsonWithTimeout("/api/billing/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planCode: "business" })
          }, 6000);
          if (data.paymentUrl) {
            window.location.href = data.paymentUrl;
            return;
          }
          alert("Платёжная ссылка пока не настроена.");
        } catch (err) {
          console.error(err);
          alert("Платёжная ссылка пока недоступна. Попробуйте позже.");
        } finally {
          button.disabled = false;
          button.textContent = "Оплатить";
        }
      }

      try {
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();
      } catch (err) {
        console.error(err);
      }

      renderFallback("opening");
      el("refresh").addEventListener("click", loadDashboard);
      el("pay").addEventListener("click", checkout);
      window.setTimeout(loadDashboard, 50);
    </script>
  </body>
</html>`;
}
