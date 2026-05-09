import { Router, type IRouter, type Request, type Response } from "express";
import { webhookCallback } from "grammy";
import { bot } from "../lib/bot";

const router: IRouter = Router();

const handleUpdate = webhookCallback(bot, "express");

router.post("/webhook/telegram", async (req: Request, res: Response): Promise<void> => {
  await handleUpdate(req, res);
});

export default router;
