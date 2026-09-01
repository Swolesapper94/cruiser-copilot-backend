# Forum Ingestion and Evidence RAG

How community threads become citable evidence, and what the system refuses to do
with them. Implementation lives in `src/lib/evidence/`, the durable model in
`packages/database/evidence-schema.sql`.

## The problem this solves

A forum thread is not a fact. It is a conversation containing symptoms, guesses,
measurements, corrections and one or two things that actually turned out to be
true. Naive RAG flattens all of that into similar-looking text and then quotes a
guess as if it were a specification. This pipeline keeps the distinctions the
conversation already contained.

## Four layers

1. **Raw source** — `sources`, `ingestion_jobs`, `source_snapshots`. Immutable
   captures with a content hash, so every later claim can be re-verified against
   the bytes it came from.
2. **Document structure** — `documents`, `document_blocks`, `forum_posts`,
   `media_assets`. Post boundaries, authorship, ordering, quote blocks. Every
   block is individually addressable; citations point at blocks, never at whole
   pages.
3. **Automotive knowledge** — `applicability_constraints`, `vehicle_mentions`,
   `repair_cases`, `observations`, `claims`, `claim_relations`,
   `procedure_fragments`. This is where a sentence becomes a typed assertion with
   an author, a strength, and a vehicle it applies to.
4. **Retrieval** — `retrieval_chunks`, `chunk_embeddings`, `review_queue`,
   `canonical_promotions`. Chunks are built *from* the knowledge layer, so a
   chunk always carries its authority tier, applicability and quality score.

## The extraction contract

`evidence-extraction.v2`, defined in `src/lib/evidence/schemas.ts`. It is
source-neutral: `content_units` may be forum posts, manual pages, manual
sections, article sections or case events. Manuals are no longer represented as
synthetic forum posts. Snake_case JSON is produced by whatever extractor you use
(model, human, or both), then validated before anything is stored.

Local IDs (`unit-1`, `b3`, `cl2`, …) wire the payload together. Ingestion converts
them to content-addressed stable IDs, so re-ingesting the same snapshot is
idempotent rather than duplicative.

## Validation rules that reject a payload

Enforced in `src/lib/evidence/validate.ts`:

| Code | Meaning |
| --- | --- |
| `schema` | Failed the zod contract |
| `missing_citation` | A claim with no source block |
| `orphan_block_ref` / `orphan_ref` | A local ID that points at nothing |
| `numeric_without_unit` | A number with no unit is not a measurement |
| `normalization_overwrites_original` | Normalised values may accompany the original, never replace it |
| `specification_without_applicability` | A spec that does not say what it applies to |
| `quote_not_in_source` | A quoted string that is not present in the cited block |
| `unsupported_confirmed_root_cause` | `author_confirmed` resolution with no confirming post |
| `reflexive_relation` | A claim related to itself |
| `duplicate_step_order` | Two step 3s |
| `resolution_without_post` / `resolution_without_basis` | A resolved case with no evidence of resolution |
| `summary_without_claim` | A summary that nothing supports |
| `incomplete_numeric_range` | Only one end of a published range was captured |
| `invalid_numeric_range` | Minimum is greater than maximum |

Warnings (`unit_normalization`, `case_without_vehicle`, `nothing_extracted`) do
not block ingestion but do reach the review queue.

## Human review gate

`src/lib/evidence/review.ts` raises flags; severity-1 flags hold the whole
document out of retrieval until a human calls `approveDocument`. The severity-1
set exists because these are the cases where a wrong answer damages an engine:

- `exact_specification_from_community` — a torque, clearance, timing, pressure or
  tolerance figure sourced from a tier ≥ 4 post
- `safety_critical_procedure`
- `unverifiable_oem_quote`
- `confirmed_root_cause` promotion
- `speculative_claim` when an exact specification is merely guessed, hearsay or
  an unattributed quote

The rest (`conflicting_claims`, `missing_applicability`, `ocr_derived_value`,
`unit_normalization`) are queued but do not block.

## Retrieval

`retrieveEvidence()` returns **two separate channels** — `oem` (authority tier
≤ 3) and `community` (tier ≥ 4) — plus a `conflicts` list. They are never merged
and never averaged. Community evidence cannot override an applicable factory
specification; the answer layer is expected to present them as what they are.

Ranking combines exact keyword/subject match, applicability strength, authority
tier, resolution quality and an optional semantic component, minus a penalty for
participating in an unresolved conflict. A conflict is only reported `resolved`
when applicability is fully settled, a single value survives at the top tier, and
that tier is OEM.

## Adapters and politeness

`src/lib/evidence/adapters.ts`. `assertFetchAllowed` throws unless **all** of the
following hold:

- `ENABLE_FORUM_INGESTION=true`
- the source row is `active`
- `terms_review_status = 'approved'` for that specific source
- `robots_reviewed_at` is set

Flipping the env flag is deliberately not sufficient. Per-source terms review is
a separate, recorded human decision. Request delay defaults to 5 s
(`INGESTION_REQUEST_DELAY_MS`) and runs are capped by
`INGESTION_MAX_PAGES_PER_RUN`. Set `INGESTION_USER_AGENT` to something that
identifies you and gives forum operators a way to reach you.

Media is stored **by reference** with `rights_status: 'unknown'` — images are
described, never rehosted and never diagnosed from.

Parser verification compares the raw number of source posts, located message
bodies and per-post text coverage. Finding authors and timestamps is not enough
if the parser silently dropped the reply after a quote.

`terms_review_status = 'approved'` records an internal source-policy decision;
it does **not** necessarily mean the forum supplied written permission. The
review determines what the published terms, robots rules, access method, storage
purpose, and risk posture allow. If those conditions prohibit or restrict the
planned use, the source must remain inactive. Asking an operator for an API or
feed is a reliability and relationship option at scale, not a universal
prerequisite for reading a public page.

## Forum assessment schema

Assessment happens after deterministic post parsing and before retrieval chunks
are activated.

### Thread assessment

| Field | Purpose |
| --- | --- |
| `thread_kind` | Repair case, diagnostic question, how-to, technical discussion, build, parts, general, classified, or site meta |
| `automotive_relevance` | Is the thread actually about a vehicle? |
| `target_vehicle_confidence` | How confidently can the vehicle be identified? |
| `off_topic_ratio` | Portion of assessed posts unrelated to the thread problem |
| `argument_ratio` | Portion dominated by interpersonal argument rather than evidence |
| `constructive_ratio` | Portion that advances diagnosis or repair |
| `evidence_density` | Portion containing observations, measurements, tests, actions, references, or outcomes |
| `outcome_signal` | Confirmed resolution, improvement, unresolved, contradictory, not applicable, or unknown |
| `systems/components/symptoms` | Controlled retrieval tags, kept separately |
| `retrieval_disposition` | Include, down-rank, exclude, or send to human review |

### Per-post assessment

| Field | Purpose |
| --- | --- |
| `author_role` | Original poster, participant, moderator, vendor, or unknown |
| `discourse_roles` | Problem, question, hypothesis, test, measurement, repair, outcome, correction, corroboration, reference, opinion, banter, argument, moderation, signature, or spam |
| `automotive_relevance` | Relevance to any vehicle topic |
| `thread_topic_relevance` | Relevance to this thread's actual problem |
| `constructiveness` | Whether it moves diagnosis or repair forward |
| `helpfulness` | Expected utility to a technician facing the same case |
| `evidence_strength` | None, anecdotal, reasoned, measured, documented, or outcome-confirmed |
| `sentiment` | Descriptive tone only; never a truth or eligibility score |
| `systems/components/symptoms/codes` | Search filters and retrieval features |
| `retrieval_disposition` | Include, down-rank, exclude, or human review |
| `disposition_reasons` | Auditable explanation such as `off_topic`, `signature_only`, `unsupported_speculation`, `argument_without_evidence`, or `confirmed_outcome` |

The assessment can exclude a raw post passage while still retaining the
immutable snapshot for audit. Atomic claims have their own basis and citation,
so a useful measurement inside an otherwise argumentative post can still be
retained and reviewed.

## Running a controlled crawl

`POST /api/ingestion/forum/crawl` requires:

- `ENABLE_FORUM_INGESTION=true`
- a bearer token matching `INGESTION_ADMIN_TOKEN`
- an active source with recorded policy and robots review
- same-host seed URLs inside `allowed_path_prefixes`

The runtime applies the stricter of the source and environment request delays
and the smaller of their page budgets. Responses return parsed structure and
verification results but never echo raw page bodies through the API.

## CLI

Offline only; it reads local files and fetches nothing.

```bash
npm run evidence -- validate ./extraction.json
npm run evidence -- parse ./snapshot.html https://forum.example/threads/x.1
```

## Storage

The in-memory `EvidenceStore` runs the complete pipeline and is enough for a
curated corpus. Move to `packages/database/evidence-schema.sql` (Supabase or any
Postgres with `pgvector`) when you need durable snapshots, indexes at scale, real
embeddings, or a review queue that survives a restart. The store interface mirrors
the SQL model one-for-one so callers do not change.
