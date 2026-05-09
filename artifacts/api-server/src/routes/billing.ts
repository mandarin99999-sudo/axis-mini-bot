import { Router, type IRouter, type Request, type Response } from "express";
import {
  createBillingCheckout,
  fetchBillingPlans,
  getBillingStatus,
  markBillingPaymentPaid,
} from "../lib/billing";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireBillingAuth(req: Request, res: Response): boolean {
  const token = process.env["OWNER_DASHBOARD_TOKEN"] ?? process.env["DASHBOARD_TOKEN"] ?? process.env["BILLING_TOKEN"];
  if (!token) return true;

  const auth = req.get("authorization") ?? "";
  const queryToken = typeof req.query["token"] === "string" ? req.query["token"] : "";
  if (auth === `Bearer ${token}` || queryToken === token) return true;

  res.status(401).json({ error: "billing_auth_required" });
  return false;
}

function ownerIdFromRequest(req: Request): number | null {
  const raw = req.body?.ownerTelegramId ?? req.query["ownerTelegramId"];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

router.get("/billing/plans", async (_req: Request, res: Response): Promise<void> => {
  const plans = await fetchBillingPlans();
  res.json({ plans });
});

router.get("/billing/status", async (req: Request, res: Response): Promise<void> => {
  if (!requireBillingAuth(req, res)) return;

  try {
    const status = await getBillingStatus(ownerIdFromRequest(req));
    res.json(status);
  } catch (err) {
    logger.error({ err }, "Failed to get billing status");
    res.status(500).json({ error: "billing_status_failed" });
  }
});

router.post("/billing/checkout", async (req: Request, res: Response): Promise<void> => {
  if (!requireBillingAuth(req, res)) return;

  const planCode = typeof req.body?.planCode === "string" ? req.body.planCode : "solo";

  try {
    const checkout = await createBillingCheckout({
      ownerTelegramId: ownerIdFromRequest(req),
      planCode,
    });
    res.json(checkout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, planCode }, "Failed to create billing checkout");
    res.status(message === "owner_telegram_id_required" ? 400 : 500).json({ error: message });
  }
});

router.post("/billing/webhook/mock-paid", async (req: Request, res: Response): Promise<void> => {
  if (!requireBillingAuth(req, res)) return;

  const paymentId = Number(req.body?.paymentId ?? req.query["paymentId"]);
  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    res.status(400).json({ error: "payment_id_required" });
    return;
  }

  try {
    const status = await markBillingPaymentPaid({
      paymentId,
      providerPaymentId: typeof req.body?.providerPaymentId === "string" ? req.body.providerPaymentId : null,
      rawPayload: req.body,
    });
    res.json({ ok: true, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, paymentId }, "Failed to mark mock billing payment paid");
    res.status(500).json({ error: message });
  }
});

export default router;
