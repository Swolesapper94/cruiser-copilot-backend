# Source ingestion

A deliberately unglamorous CLI for importing documents **you are licensed to
use** into a local passage store.

> **Licensing.** Toyota manuals, bulletins and diagrams are copyrighted. This
> repository ships none of them and this tool downloads nothing. It reads a file
> you already have, on your machine, and writes to a path you choose. Whether you
> may use a given document is your call, and `.gitignore` is set up so imported
> material does not end up in version control by accident.

## Install

```bash
cd services/ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # only needed for PDF input
```

## Three steps, on purpose

### 1. Plan

```bash
python ingest.py plan --input ~/Documents/my-manual.pdf --out plan.json
```

Chunks the document paragraph-first and writes a reviewable `plan.json` where
every passage has empty applicability fields.

### 2. Review — the part that matters

Open `plan.json` and, for each passage you intend to rely on, fill in:

| Field | Example | Why |
| --- | --- | --- |
| `modelCodes` | `["HDJ80"]` | The system will not apply a passage to a vehicle it does not cover |
| `engineCodes` | `["1HD-T"]` | Same |
| `markets` | `["EU"]` | Destination market changes published values |
| `pumpModels` | `[]` | Leave empty if the passage is pump-agnostic |
| `yearStart` / `yearEnd` | `1990` / `1993` | Production-range scoping |
| `keywords` | `["plunger", "stroke", "TDC"]` | Exact keyword matching |
| `specificationSubject` | `"injection-pump-plunger-stroke-at-tdc"` | Only if the passage carries a specification |
| `specificationValue` | verbatim from the source | Only if you read it directly |

Rules the importer enforces:

- `specificationSubject` and `specificationValue` must be set together.
- A passage carrying a specification **must** have applicability metadata. The
  import fails otherwise — a specification with no applicability is worse than
  no specification.
- Passages with no applicability are still stored, as context. They can never
  resolve a conflict.

### 3. Import

Write a document metadata file:

```json
{
  "id": "doc-my-manual",
  "title": "…",
  "sourceType": "oem_manual",
  "publisher": "…",
  "edition": "…",
  "licenseStatus": "user-supplied",
  "isPlaceholder": false
}
```

`sourceType` must be one of `service_bulletin`, `oem_manual`, `oem_technical`,
`verified_case`, `technician`, `forum`, `general`. The authority level is derived
from it, not chosen by you. OEM material with `licenseStatus: "unknown"` is
refused.

```bash
python ingest.py import --plan plan.json --metadata doc.json --out ../../data/sources/store.json
```

Re-importing the same document id replaces its passages rather than duplicating
them.

## Verify

```bash
python ingest.py verify --store ../../data/sources/store.json
```

Reports document and passage counts, how many passages are context-only, and any
`specificationSubject` that now has more than one distinct value. Conflicts are
**not** an error — the application surfaces them and keeps the specification
locked until applicability separates them.

## Wiring it into the app

The app currently reads the placeholder library in
`src/lib/retrieval/seed-sources.ts`. To use your store, replace the
`SOURCE_DOCUMENTS` / `SOURCE_PASSAGES` exports with a loader that reads your
JSON (or the Postgres schema in `packages/database/schema.sql`) and set
`SOURCE_LIBRARY_IS_PLACEHOLDER` to `false`. That single flag clears the
placeholder caution gate, so do not flip it until real content is actually
loaded.
