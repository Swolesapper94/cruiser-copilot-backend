import "dotenv/config";
import { pathToFileURL } from "node:url";

import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { env } from "@/lib/config/env";
import { ingestionRouter } from "@/routes/ingestion";
import { proceduresRouter } from "@/routes/procedures";
import { sessionsRouter } from "@/routes/sessions";

const explicitOrigins = env.CORS_ORIGIN?.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === "test" ? 10_000 : 240,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (explicitOrigins) return callback(null, explicitOrigins.includes(origin));
        if (env.NODE_ENV !== "production") {
          return callback(null, LOCALHOST_ORIGIN.test(origin));
        }
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/procedures", proceduresRouter);
  app.use("/api/ingestion", ingestionRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found" } });
  });

  // Deliberately generic: never echo request bodies, headers or stack traces.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[cruiser-copilot] unhandled error", err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: "internal_error" } });
  });

  return app;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  createApp().listen(env.PORT, () => {
    console.log(`Cruiser Copilot backend listening on http://localhost:${env.PORT}`);
  });
}
