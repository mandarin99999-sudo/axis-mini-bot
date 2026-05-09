import { Router, type IRouter, type Request, type Response } from "express";
import { scanMessage } from "../lib/scanner";

const router: IRouter = Router();

router.post("/scan-test", async (req: Request, res: Response): Promise<void> => {
  const { text, chatId = -1, messageId = Date.now() } = req.body as {
    text?: string;
    chatId?: number;
    messageId?: number;
  };

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const results = await scanMessage({ messageId, chatId, text });
  res.json({ text, messageId, chatId, matches: results });
});

export default router;
