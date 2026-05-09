import { Router, type IRouter, type Request, type Response } from "express";
import { buildPilotValueReport } from "../lib/pilot_value_report";

const router: IRouter = Router();

function periodDays(req: Request): number {
  const raw = Number(req.query["days"] ?? 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

function requireDashboardAuth(req: Request, res: Response): boolean {
  const token = process.env["OWNER_DASHBOARD_TOKEN"] ?? process.env["DASHBOARD_TOKEN"];
  if (!token) return true;

  const auth = req.get("authorization") ?? "";
  const queryToken = typeof req.query["token"] === "string" ? req.query["token"] : "";
  if (auth === `Bearer ${token}` || queryToken === token) return true;

  res.status(401).json({ error: "owner_dashboard_auth_required" });
  return false;
}

router.get("/pilot-report", async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAuth(req, res)) return;

  const report = await buildPilotValueReport(periodDays(req));
  res.json(report);
});

export default router;
