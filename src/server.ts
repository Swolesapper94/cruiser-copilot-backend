import "dotenv/config";
import cors from "cors";
import express from "express";
import { proceduresRouter } from "@/routes/procedures";
import { sessionsRouter } from "@/routes/sessions";

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
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
