import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { renderMiniAppHtml } from "./lib/mini_app_html";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const mockupPublicPath = path.resolve(process.cwd(), "../mockup-sandbox/public");
const mockupDistPath = path.resolve(process.cwd(), "../mockup-sandbox/dist");
const mockupDistIndexPath = path.join(mockupDistPath, "index.html");

if (existsSync(mockupPublicPath)) {
  app.use(express.static(mockupPublicPath, { index: false }));
}

if (existsSync(mockupDistPath)) {
  app.use(express.static(mockupDistPath, { index: false }));
}

app.get(["/", "/mini-app", "/__mockup", "/__mockup/mini-app"], (_req, res) => {
  res.type("html").send(renderMiniAppHtml());
});

app.get(/^(?!\/api).*/, (_req, res) => {
  if (existsSync(mockupDistIndexPath)) {
    res.sendFile(mockupDistIndexPath);
    return;
  }

  res.type("html").send(renderMiniAppHtml());
});

export default app;
