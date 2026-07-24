# Cruiser Copilot — backend

Express + TypeScript API for Cruiser Copilot, the evidence-driven diagnostic assistant for Toyota Land Cruiser 70/80 Series 1HZ / 1HD-T diesel engines.

This service owns everything that decides what the frontend shows: applicability, source authority, conflict detection, hypothesis scoring, next-best-test selection, safety gates, and the guarded AI explanation layer. The frontend (`cruiser-copilot-frontend`, a separate repository) never makes any of these decisions itself — it only renders what this API returns.

## Non-negotiables

1. **No fabricated Toyota data.** Every seed source in `src/lib/retrieval/seed-sources.ts` is `isPlaceholder: true`. No torque figure, tolerance, tool number or procedure is invented.
2. **Applicability before specification.** A value is only ever selected once series, model code, production year, market, engine and pump/ACSD configuration are known and consistent with it.
3. **OEM and community content are never blended**, and community content may never override an applicable factory specification.
4. **Media is described, never diagnosed**, and never moves a hypothesis ranking.
5. **`confirmed` is never emitted** by this MVP.

See [docs/SOURCE_POLICY.md](docs/SOURCE_POLICY.md), [docs/DIAGNOSTIC_RULES.md](docs/DIAGNOSTIC_RULES.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md) and [docs/MVP_ACCEPTANCE_TESTS.md](docs/MVP_ACCEPTANCE_TESTS.md).

## Quick start

```bash
npm install
cp .env.example .env   # defaults to scripted mode, no credentials needed
npm run dev             # listens on http://localhost:4000
```

Pair it with `cruiser-copilot-frontend` running on `http://localhost:3000` (its default `NEXT_PUBLIC_API_BASE_URL`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API with `tsx watch` |
| `npm start` | Runs the API with `tsx` (no separate build step) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest — retrieval, diagnostic policy and AI guard suites |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sessions` | Create a session |
| GET | `/api/sessions/:id` | Fetch a session + the current deterministic update |
| DELETE | `/api/sessions/:id` | Delete a session |
| PATCH | `/api/sessions/:id/vehicle` | Update vehicle identification fields |
| POST | `/api/sessions/:id/answers` | Record an interview answer |
| POST | `/api/sessions/:id/evidence` | Record evidence (media or a measurement) |
| POST | `/api/sessions/:id/analyze` | Re-evaluate and attach a plain-language explanation |
| POST | `/api/sessions/:id/steps` | Toggle a repair-procedure step |
| POST | `/api/sessions/:id/outcome` | Record the outcome |
| GET | `/api/procedures/:id` | Fetch a guided procedure, optionally scoped to a session |

All state is server-derived — the client never sets `stage`, hypothesis scores, or which specification applies.

## Layout

```
src/
  lib/validation/     zod schemas — the single source of truth for shapes
  lib/retrieval/       applicability, authority ranking, conflict detection
  lib/diagnostic-policy/  questions, scoring rules, test selection, engine
  lib/procedures/       guided repair procedures
  lib/ai/               model adapter, prompts, output guards
  lib/api/handlers.ts   framework-agnostic request/response helpers
  routes/                Express routers
  server.ts              Express bootstrap
data/evaluation/         labelled fixtures used to regression-check the rules
packages/database/       optional Postgres + pgvector schema
services/ingestion/      CLI for importing sources you are licensed to use
docs/                    policy, data model, rules and acceptance tests
```

## Storage

Sessions live in memory (`src/lib/store/index.ts`) by design — no diagnostic content or media is persisted or sent to a third party unless you explicitly enable a live model. `packages/database/schema.sql` is available if you want to persist sessions and a real source library.
