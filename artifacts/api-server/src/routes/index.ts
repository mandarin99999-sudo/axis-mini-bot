import { Router, type IRouter } from "express";
import healthRouter from "./health";
import webhookRouter from "./webhook";
import scanTestRouter from "./scan-test";
import reportTestRouter from "./report-test";
import dailySummaryRouter from "./daily-summary";
import ownerDashboardRouter from "./owner-dashboard";
import pilotReportRouter from "./pilot-report";
import billingRouter from "./billing";
import miniAppRouter from "./mini-app";

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhookRouter);
router.use(scanTestRouter);
router.use(reportTestRouter);
router.use(dailySummaryRouter);
router.use(ownerDashboardRouter);
router.use(pilotReportRouter);
router.use(billingRouter);
router.use(miniAppRouter);

export default router;
