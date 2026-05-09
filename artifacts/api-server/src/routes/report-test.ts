import { Router, type IRouter, type Request, type Response } from "express";
import { generateReport, generateRisksMessage } from "../lib/reporter";

const router: IRouter = Router();

router.get("/report-test", async (_req: Request, res: Response): Promise<void> => {
  const report = await generateReport();
  res.json({ report });
});

router.get("/risks-test", async (_req: Request, res: Response): Promise<void> => {
  const msg = await generateRisksMessage();
  res.json({ msg });
});

export default router;
