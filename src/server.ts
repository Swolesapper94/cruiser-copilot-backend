import "dotenv/config";
import cors from "cors";
import express from "express";
import { proceduresRouter } from "@/routes/procedures";
import { sessionsRouter } from "@/routes/sessions";

const PORT = Number(process.env.PORT ?? 4000);

// If CORS_ORIGIN is set, it's a comma-separated allow-list (exact match).
// Otherwise, in dev, allow any localhost/127.0.0.1 port — Next.js picks the
// next free port when its default is taken, so pinning to one exact origin
// breaks the moment something else is already running on 3000.
const explicitOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // non-browser clients (curl, tests)
      if (explicitOrigins) return callback(null, explicitOrigins.includes(origin));
      callback(null, LOCALHOST_ORIGIN.test(origin));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sessions", sessionsRouter);
app.use("/api/procedures", proceduresRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "not_found" } });
});

// Deliberately generic: never echo request bodies, headers or stack traces.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[cruiser-copilot] unhandled error", err instanceof Error ? err.message : err);
  res.status(500).json({ error: { code: "internal_error" } });
});

app.listen(PORT, () => {
  console.log(`Cruiser Copilot backend listening on http://localhost:${PORT}`);
});
