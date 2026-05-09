import { Router, type IRouter } from "express";
import { renderMiniAppHtml } from "../lib/mini_app_html";

const router: IRouter = Router();

router.get("/mini-app", (_req, res) => {
  res.type("html").send(renderMiniAppHtml());
});

export default router;
