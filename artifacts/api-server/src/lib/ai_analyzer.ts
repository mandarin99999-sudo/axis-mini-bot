import { openai } from "@workspace/integrations-openai-ai-server";
import { fetchAiBusinessRules, formatAiBusinessRulesForPrompt } from "./business_rules";
import { normalizeFinanceEventInputs, type FinanceEventInput } from "./finance_memory";
import { fetchPrimaryBusinessProfile, formatBusinessProfileForPrompt } from "./owner_onboarding";
import { logger } from "./logger";

export type ReportType =
  | "cashier_report"
  | "manager_shift_report"
  | "courier_report"
  | "vehicle_mileage_report"
  | "invoice_or_expense"
  | "delivery_cash_report"
  | "unknown_report";

export type KnownLocation = "Алдан" | "Нерюнгри" | "Куранах" | "unknown";

export interface AiAnalysisResult {
  report_type: ReportType;
  location: KnownLocation;
  date: string | null;
  summary: string;
  detected_amounts: Array<{ label: string; value: string }>;
  detected_risks: Array<{ severity: "critical" | "high" | "medium" | "low"; description: string }>;
  finance_events: FinanceEventInput[];
  confidence: "high" | "medium" | "low";
  needs_clarification: boolean;
  clarification_question: string | null;
}

const SYSTEM_PROMPT = `Ты — аналитик документооборота бизнеса владельца.

Тебе присылают фото или скан отчёта. Твоя задача — прочитать документ и вернуть структурированный JSON.
Также учитывай активные правила владельца, если они переданы вместе с изображением.
Ты должен понимать документы на разных языках. Не переводи имена, суммы, даты, номера документов, названия чатов, точек и контрагентов; сохраняй факты точно. Поля JSON всегда возвращай с указанными ключами.

Если профиль бизнеса не заполнен, используй общую логику малого/среднего бизнеса. Если профиль заполнен, приоритет у его сферы, критичных зон и языка.

Если бизнес похож на сеть с точками, ищи точку по:
- Алдан
- Нерюнгри  
- Куранах

Типы отчётов/документов (выбери один, наиболее подходящий):
- cashier_report — кассовый отчёт, Z-отчёт, отчёт по выручке, итог смены по кассе
- manager_shift_report — отчёт менеджера/управляющего за смену
- courier_report — отчёт курьера по доставкам
- vehicle_mileage_report — отчёт по пробегу/топливу транспорта
- invoice_or_expense — накладная, счёт, расходный документ, чек
- delivery_cash_report — отчёт по наличным от доставки
- unknown_report — не удалось определить тип

Ищи точку по:
- Названию города на бланке
- Адресу точки
- Тексту в шапке документа
- Штампу или реквизитам

Риски создавай если:
- Возврат за наличные → critical
- Кассовое расхождение / несоответствие сумм → high или critical
- Отсутствуют обязательные поля (дата, сумма, подпись) → medium
- Подозрительные суммы или аномалии → high

Финансовые события создавай в finance_events, если документ похож на чек, авансовый отчёт, банковский скрин, счёт, накладную, расход, приход денег, перевод, возврат или отчёт по наличным.
Финансовый блок нужен для универсального управленческого учета любого бизнеса, а не для учета конкретных товаров. Главная сущность: денежный поток, сумма, управленческая категория, центр затрат/объект, контрагент, способ оплаты и документ. Товары/услуги из чека сохраняй только как line_items/детали, если они видны.

Отвечай ТОЛЬКО валидным JSON без markdown-обёрток:
{
  "report_type": "<тип из списка>",
  "location": "<Алдан|Нерюнгри|Куранах|unknown>",
  "date": "<дата в формате DD.MM.YYYY или null>",
  "summary": "<краткое описание отчёта 1-2 предложения>",
  "detected_amounts": [{"label": "<название>", "value": "<сумма>"}],
  "detected_risks": [{"severity": "<critical|high|medium|low>", "description": "<описание>"}],
  "finance_events": [
    {
      "event_type": "receipt|advance_report|bank_expense|invoice|cash_expense|income|purchase_request|unknown",
      "flow_type": "income|expense|transfer|obligation|planned|refund|unknown",
      "amount": "сумма строкой или null",
      "currency": "RUB или другая валюта",
      "category": "старое поле категории или null",
      "management_category": "универсальная категория управленческого учета: выручка|материалы/товары|хознужды|транспорт|зарплата|аренда|налоги|маркетинг|поставщики|прочее|unknown",
      "cost_center": "точка/отдел/направление затрат или null",
      "project": "проект/объект/заказ или null",
      "item_name": "основная деталь/позиция, если явно видна, или null",
      "counterparty": "магазин/поставщик/получатель или null",
      "payment_method": "cash|card|bank_transfer|mixed|unknown|null",
      "document_type": "receipt|invoice|advance_report|bank_screenshot|act|waybill|unknown|null",
      "document_number": "номер документа или null",
      "money_account": "касса/банк/карта, где прошли деньги, или null",
      "source_account": "откуда списали деньги для transfer/expense или null",
      "destination_account": "куда поступили деньги для income/transfer или null",
      "balance_after": "остаток на счёте/в кассе после операции, если виден на скрине/документе, или null",
      "line_items": [{"name": "строка документа", "amount": "сумма или null", "quantity": "кол-во или null", "category": "категория строки или null"}],
      "tags": ["короткие теги"],
      "location": "<Алдан|Нерюнгри|Куранах|unknown|null>",
      "description": "человеческое описание финансового события",
      "confidence": "low|medium|high",
      "occurred_at": "ISO 8601 или null"
    }
  ],
  "confidence": "<high|medium|low>",
  "needs_clarification": <true|false>,
  "clarification_question": "<вопрос сотруднику или null>"
}`;

export async function analyzeReportImages(
  imageUrls: string[],
): Promise<AiAnalysisResult> {
  const [businessRules, businessProfile] = await Promise.all([
    fetchAiBusinessRules(),
    fetchPrimaryBusinessProfile(),
  ]);
  const content = [
    {
      type: "text" as const,
      text: [
        imageUrls.length === 1
          ? "Проанализируй отчёт на изображении."
          : `Проанализируй отчёт. Это ${imageUrls.length} страниц одного документа.`,
        "",
        "Профиль бизнеса:",
        formatBusinessProfileForPrompt(businessProfile),
        "",
        "Активные правила владельца:",
        formatAiBusinessRulesForPrompt(businessRules),
      ].join("\n"),
    },
    ...imageUrls.map(url => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";

  let parsed: AiAnalysisResult;
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    parsed = JSON.parse(cleaned) as AiAnalysisResult;
    parsed.finance_events = normalizeFinanceEventInputs((parsed as unknown as Record<string, unknown>)["finance_events"]);
  } catch (err) {
    logger.error({ err, raw }, "Failed to parse AI analysis JSON");
    parsed = {
      report_type: "unknown_report",
      location: "unknown",
      date: null,
      summary: "Не удалось распознать документ автоматически.",
      detected_amounts: [],
      detected_risks: [],
      finance_events: [],
      confidence: "low",
      needs_clarification: true,
      clarification_question: "Не смог распознать тип и точку отчёта. Укажи: это отчёт за какую точку? (Алдан, Нерюнгри или Куранах)",
    };
  }

  return parsed;
}
