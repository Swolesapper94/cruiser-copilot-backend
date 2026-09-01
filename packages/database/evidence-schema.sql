-- ---------------------------------------------------------------------------
-- Cruiser Copilot — evidence store and RAG schema
--
-- Companion to schema.sql. schema.sql persists sessions and a curated passage
-- library. THIS file persists the four-layer evidence pipeline:
--
--     raw source -> document structure -> automotive knowledge -> retrieval
--
-- Hard boundary enforced by this schema:
--   * Forum ingestion writes to the EVIDENCE store (claims, cases, fragments).
--   * It never writes source_passage / specification values in schema.sql.
--     Promotion into canonical knowledge is a separate, reviewed, versioned
--     action (see canonical_promotion below).
--
-- IMPORTANT: structure only. No Toyota data, no specification values, no
-- procedures and no seed rows are contained in this file.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ===========================================================================
-- Layer 1 — raw source
-- ===========================================================================

create type source_kind as enum (
  'service_bulletin', 'oem_manual', 'oem_technical', 'verified_case',
  'technician', 'forum', 'article', 'general'
);

create type terms_review_status as enum (
  'pending',     -- never fetch
  'approved',    -- fetching permitted within the recorded limits
  'restricted',  -- metadata + link only, no content storage
  'prohibited'
);

create table sources (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  base_url             text not null unique,
  source_kind          source_kind not null,
  -- 1 = highest. Mirrors src/lib/retrieval/authority.ts.
  authority_tier       smallint not null check (authority_tier between 1 and 7),
  terms_review_status  terms_review_status not null default 'pending',
  robots_reviewed_at   timestamptz,
  license_notes        text,
  request_delay_ms     integer not null default 5000 check (request_delay_ms >= 0),
  active               boolean not null default false,
  created_at           timestamptz not null default now(),

  -- A source may only be active once a human has reviewed its terms.
  constraint active_requires_approval check (
    active = false or (terms_review_status = 'approved' and robots_reviewed_at is not null)
  )
);

create type ingestion_job_kind as enum ('curated_url', 'crawl', 'file_upload', 'reprocess');

create type ingestion_job_status as enum (
  'queued', 'fetching', 'extracting', 'review', 'complete', 'failed'
);

create table ingestion_jobs (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references sources(id) on delete cascade,
  job_kind          ingestion_job_kind not null,
  status            ingestion_job_status not null default 'queued',
  requested_urls    jsonb not null default '[]'::jsonb,
  extractor_version text not null,
  schema_version    text not null,
  model_provider    text,
  model_name        text,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  error_code        text,
  error_detail      text
);

create index ingestion_jobs_source_idx on ingestion_jobs (source_id, started_at desc);

-- Immutable. A changed page produces a NEW row, never an update.
create table source_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  source_id             uuid not null references sources(id) on delete cascade,
  ingestion_job_id      uuid not null references ingestion_jobs(id) on delete cascade,
  canonical_url         text not null,
  retrieved_url         text not null,
  retrieved_at          timestamptz not null default now(),
  http_status           integer not null,
  content_type          text,
  content_hash          text not null,
  raw_storage_key       text,
  rendered_storage_key  text,
  language              text,
  published_at          timestamptz,
  modified_at           timestamptz,
  is_current            boolean not null default true
);

create unique index source_snapshots_current_idx
  on source_snapshots (canonical_url) where is_current;
create index source_snapshots_hash_idx on source_snapshots (content_hash);

create type crawl_frontier_status as enum (
  'queued', 'fetching', 'parsed', 'unchanged', 'retry', 'failed', 'excluded'
);

-- Durable, deduplicated crawl frontier. Workers claim rows with
-- FOR UPDATE SKIP LOCKED; a URL is never discovered into an unapproved source.
create table crawl_frontier (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references sources(id) on delete cascade,
  canonical_url      text not null,
  discovered_from    text,
  status             crawl_frontier_status not null default 'queued',
  priority           integer not null default 0,
  attempt_count      integer not null default 0,
  next_attempt_at    timestamptz not null default now(),
  last_http_status   integer,
  last_content_hash  text,
  etag               text,
  last_modified      text,
  error_code         text,
  error_detail       text,
  claimed_by         text,
  claimed_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source_id, canonical_url)
);

create index crawl_frontier_claim_idx
  on crawl_frontier (source_id, priority desc, next_attempt_at)
  where status in ('queued', 'retry');

-- ===========================================================================
-- Layer 2 — document structure (who said what, and where)
-- ===========================================================================

create type document_kind as enum (
  'forum_thread', 'forum_post', 'manual', 'manual_section', 'article'
);

create type document_status as enum ('active', 'deleted_at_source', 'unavailable');

create table documents (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid not null references sources(id) on delete cascade,
  document_kind       document_kind not null,
  canonical_url       text not null,
  title               text not null,
  external_id         text,
  manufacturer        text,
  document_number     text,
  edition             text,
  publication_date    date,
  parent_document_id  uuid references documents(id) on delete cascade,
  created_at_source   timestamptz,
  updated_at_source   timestamptz,
  status              document_status not null default 'active'
);

create unique index documents_external_idx
  on documents (source_id, document_kind, external_id) where external_id is not null;
create index documents_parent_idx on documents (parent_document_id);

create type block_kind as enum (
  'paragraph', 'heading', 'quote', 'list', 'table', 'code', 'caption'
);

-- Source-preserving text. Cleaned, never summarised. This is what a citation
-- resolves to, so it must remain byte-stable for a given snapshot.
create table document_blocks (
  id                   uuid primary key default gen_random_uuid(),
  document_id          uuid not null references documents(id) on delete cascade,
  snapshot_id          uuid not null references source_snapshots(id) on delete cascade,
  block_order          integer not null,
  block_kind           block_kind not null,
  text                 text not null,
  raw_locator          jsonb not null default '{}'::jsonb,
  quoted_document_id   uuid references documents(id) on delete set null,
  content_hash         text not null,

  unique (document_id, snapshot_id, block_order)
);

create index document_blocks_document_idx on document_blocks (document_id, block_order);
create index document_blocks_text_idx
  on document_blocks using gin (to_tsvector('english', text));

create table forum_posts (
  document_id          uuid primary key references documents(id) on delete cascade,
  thread_document_id   uuid not null references documents(id) on delete cascade,
  external_post_id     text not null,
  post_number          integer,
  author_external_id   text,
  author_display_name  text,
  posted_at            timestamptz,
  edited_at            timestamptz,
  is_original_post     boolean not null default false,
  is_moderator         boolean,
  reaction_count       integer
);

create index forum_posts_thread_idx on forum_posts (thread_document_id, post_number);

create type forum_thread_kind as enum (
  'repair_case', 'diagnostic_question', 'how_to', 'technical_discussion',
  'build_thread', 'parts_discussion', 'general_discussion', 'classified',
  'site_meta', 'unknown'
);
create type forum_disposition as enum ('include', 'downrank', 'exclude', 'human_review');
create type forum_evidence_strength as enum (
  'none', 'anecdotal', 'reasoned', 'measured', 'documented', 'outcome_confirmed'
);
create type forum_sentiment as enum (
  'negative', 'frustrated', 'neutral', 'constructive', 'positive', 'mixed'
);

create table forum_thread_assessments (
  thread_document_id       uuid primary key references documents(id) on delete cascade,
  thread_kind              forum_thread_kind not null,
  automotive_relevance     numeric(4, 3) not null check (automotive_relevance between 0 and 1),
  target_vehicle_confidence numeric(4, 3) not null check (target_vehicle_confidence between 0 and 1),
  off_topic_ratio          numeric(4, 3) not null check (off_topic_ratio between 0 and 1),
  argument_ratio           numeric(4, 3) not null check (argument_ratio between 0 and 1),
  constructive_ratio       numeric(4, 3) not null check (constructive_ratio between 0 and 1),
  evidence_density         numeric(4, 3) not null check (evidence_density between 0 and 1),
  outcome_signal           text not null,
  systems                  text[] not null default '{}',
  components               text[] not null default '{}',
  symptoms                 text[] not null default '{}',
  retrieval_disposition    forum_disposition not null,
  disposition_reasons      text[] not null default '{}',
  assessed_unit_count      integer not null check (assessed_unit_count > 0),
  extraction_confidence    numeric(4, 3) not null check (extraction_confidence between 0 and 1),
  extractor_version        text not null,
  assessed_at              timestamptz not null default now()
);

create table forum_post_assessments (
  post_document_id         uuid primary key references forum_posts(document_id) on delete cascade,
  source_block_ids         uuid[] not null,
  author_role              text not null,
  discourse_roles          text[] not null,
  automotive_relevance     numeric(4, 3) not null check (automotive_relevance between 0 and 1),
  thread_topic_relevance   numeric(4, 3) not null check (thread_topic_relevance between 0 and 1),
  constructiveness         numeric(4, 3) not null check (constructiveness between 0 and 1),
  helpfulness              numeric(4, 3) not null check (helpfulness between 0 and 1),
  evidence_strength        forum_evidence_strength not null,
  sentiment                forum_sentiment not null,
  systems                  text[] not null default '{}',
  components               text[] not null default '{}',
  symptoms                 text[] not null default '{}',
  diagnostic_codes         text[] not null default '{}',
  retrieval_disposition    forum_disposition not null,
  disposition_reasons      text[] not null default '{}',
  extraction_confidence    numeric(4, 3) not null check (extraction_confidence between 0 and 1),
  extractor_version        text not null,
  assessed_at              timestamptz not null default now(),

  constraint forum_assessment_cites_source check (array_length(source_block_ids, 1) >= 1)
);

create index forum_post_assessment_retrieval_idx
  on forum_post_assessments (retrieval_disposition, helpfulness desc);
create index forum_post_assessment_components_idx
  on forum_post_assessments using gin (components);

create type media_asset_kind as enum ('image', 'diagram', 'video', 'audio', 'file');
create type media_rights_status as enum ('unknown', 'permitted', 'restricted');

create table media_assets (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents(id) on delete cascade,
  snapshot_id    uuid not null references source_snapshots(id) on delete cascade,
  asset_kind     media_asset_kind not null,
  source_url     text not null,
  storage_key    text,
  content_hash   text,
  caption        text,
  alt_text       text,
  ocr_text       text,
  rights_status  media_rights_status not null default 'unknown',

  -- Never copy bytes we do not have the right to hold.
  constraint stored_media_requires_rights check (
    storage_key is null or rights_status = 'permitted'
  )
);

create index media_assets_document_idx on media_assets (document_id);

-- ===========================================================================
-- Layer 3 — automotive knowledge
-- ===========================================================================

create type applicability_completeness as enum ('unknown', 'partial', 'sufficient');

-- Reusable applicability rule. EMPTY ARRAYS MEAN "NOT SPECIFIED", never "all".
create table applicability_constraints (
  id                      uuid primary key default gen_random_uuid(),
  manufacturers           text[] not null default '{}',
  model_names             text[] not null default '{}',
  submodels               text[] not null default '{}',
  series                  text[] not null default '{}',
  model_codes             text[] not null default '{}',
  chassis_codes           text[] not null default '{}',
  year_start              integer,
  year_end                integer,
  production_date_start   date,
  production_date_end     date,
  markets                 text[] not null default '{}',
  engine_codes            text[] not null default '{}',
  transmission_codes      text[] not null default '{}',
  pump_models             text[] not null default '{}',
  emissions_configurations text[] not null default '{}',
  acsd_states             text[] not null default '{}',
  required_modifications  jsonb not null default '[]'::jsonb,
  excluded_modifications  jsonb not null default '[]'::jsonb,
  completeness            applicability_completeness not null default 'unknown',
  fingerprint             text not null unique,

  constraint applicability_year_range check (
    year_start is null or year_end is null or year_start <= year_end
  ),
  constraint applicability_production_date_range check (
    production_date_start is null or production_date_end is null
    or production_date_start <= production_date_end
  )
);

create type identification_method as enum (
  'explicit', 'decoded', 'visual_inference', 'thread_context'
);

create type acsd_configuration as enum ('present', 'absent', 'unknown');

-- A vehicle AS DESCRIBED IN A SOURCE. Not a canonical vehicle record.
create table vehicle_mentions (
  id                     uuid primary key default gen_random_uuid(),
  document_id            uuid not null references documents(id) on delete cascade,
  manufacturer           text,
  model_name             text,
  submodel                text,
  vin                     text,
  series                 text,
  model_code             text,
  chassis_code           text,
  production_year        integer,
  production_date        date,
  market                 text,
  engine_code            text,
  transmission_code      text,
  pump_model             text,
  emissions_configuration text,
  acsd_configuration     acsd_configuration not null default 'unknown',
  modifications          jsonb not null default '[]'::jsonb,
  identification_method  identification_method not null,
  confidence             numeric(4, 3) not null check (confidence between 0 and 1),
  source_block_ids       uuid[] not null,

  constraint vehicle_mention_cites_source check (array_length(source_block_ids, 1) >= 1)
);

create index vehicle_mentions_document_idx on vehicle_mentions (document_id);

create type repair_case_status as enum (
  'open', 'diagnosing', 'resolved', 'partially_resolved', 'unresolved', 'abandoned'
);

create type resolution_basis as enum (
  'author_confirmed', 'followup_improvement', 'community_consensus',
  'extractor_inference', 'none'
);

create table repair_cases (
  id                    uuid primary key default gen_random_uuid(),
  thread_document_id    uuid not null references documents(id) on delete cascade,
  vehicle_mention_id    uuid references vehicle_mentions(id) on delete set null,
  case_title            text not null,
  case_status           repair_case_status not null default 'open',
  complaint_summary     text not null,
  root_cause_summary    text,
  repair_summary        text,
  outcome_summary       text,
  resolution_confidence numeric(4, 3) not null default 0
                          check (resolution_confidence between 0 and 1),
  resolution_basis      resolution_basis not null default 'none',
  opened_unit_id        uuid not null references documents(id) on delete cascade,
  resolution_unit_id    uuid references documents(id) on delete set null,
  quality_score         numeric(4, 3) not null default 0
                          check (quality_score between 0 and 1),

  -- "resolved" is a claim about the world; it needs a post to point at.
  constraint resolved_needs_evidence check (
    case_status not in ('resolved', 'partially_resolved')
    or (resolution_unit_id is not null and resolution_basis <> 'none')
  ),
  -- The last post containing a suggestion is not a resolution.
  constraint author_confirmed_needs_post check (
    resolution_basis <> 'author_confirmed' or resolution_unit_id is not null
  )
);

create index repair_cases_thread_idx on repair_cases (thread_document_id);

create type observation_kind as enum (
  'symptom', 'condition', 'measurement', 'diagnostic_code',
  'visual', 'audio', 'inspection_result'
);

create type observation_polarity as enum ('present', 'absent', 'uncertain');

create type observation_temporality as enum (
  'before_repair', 'during_test', 'after_repair', 'unknown'
);

create table observations (
  id                    uuid primary key default gen_random_uuid(),
  repair_case_id        uuid references repair_cases(id) on delete cascade,
  document_id           uuid not null references documents(id) on delete cascade,
  observation_kind      observation_kind not null,
  concept_code          text,
  label                 text not null,
  value_text            text,
  value_numeric         double precision,
  unit                  text,
  qualifiers            jsonb not null default '{}'::jsonb,
  polarity              observation_polarity not null default 'present',
  temporality           observation_temporality not null default 'unknown',
  source_block_ids      uuid[] not null,
  extraction_confidence numeric(4, 3) not null check (extraction_confidence between 0 and 1),

  constraint observation_cites_source check (array_length(source_block_ids, 1) >= 1),
  -- A number without its unit is not evidence.
  constraint observation_numeric_has_unit check (value_numeric is null or unit is not null)
);

create index observations_case_idx on observations (repair_case_id);
create index observations_concept_idx on observations (concept_code);

create type claim_kind as enum (
  'diagnostic_hypothesis',
  'specification',
  'measurement',
  'test_result',
  'root_cause',
  'repair_action',
  'repair_outcome',
  'tool_requirement',
  'tool_substitution',
  'part_reference',
  'safety_warning',
  'practical_tip',
  'applicability_statement'
);

create type assertion_strength as enum (
  'reported', 'suggested', 'measured', 'observed', 'confirmed', 'quoted'
);

create type claim_basis as enum (
  'oem_published', 'measured_by_author', 'performed_by_author',
  'outcome_confirmed', 'community_corroborated', 'suggestion_only',
  'hearsay', 'unattributed_quote', 'speculation'
);

create type review_status as enum ('unreviewed', 'accepted', 'rejected', 'needs_review');

create table claims (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references documents(id) on delete cascade,
  repair_case_id        uuid references repair_cases(id) on delete set null,
  claim_kind            claim_kind not null,
  claim_basis           claim_basis not null,
  subject               text not null,
  predicate             text not null,
  object_text           text not null,
  value_numeric         numeric,
  value_numeric_min     numeric,
  value_numeric_max     numeric,
  -- Verbatim unit as written in the source. NEVER overwritten by normalisation.
  unit                  text,
  normalized_value      numeric,
  normalized_unit       text,
  applicability_id      uuid references applicability_constraints(id) on delete set null,
  assertion_strength    assertion_strength not null,
  source_authority_tier smallint not null check (source_authority_tier between 1 and 7),
  source_block_ids      uuid[] not null,
  source_quote          text not null,
  extraction_confidence numeric(4, 3) not null check (extraction_confidence between 0 and 1),
  review_status         review_status not null default 'unreviewed',
  created_at            timestamptz not null default now(),

  constraint claim_cites_source check (array_length(source_block_ids, 1) >= 1),
  constraint claim_numeric_has_unit check (value_numeric is null or unit is not null),
  constraint claim_numeric_range_complete check (
    (value_numeric_min is null and value_numeric_max is null)
    or (
      value_numeric_min is not null and value_numeric_max is not null
      and value_numeric_min <= value_numeric_max and unit is not null
    )
  ),
  constraint claim_normalization_keeps_original check (
    normalized_value is null or (value_numeric is not null and normalized_unit is not null)
  ),
  -- An exact specification without applicability is unusable and dangerous.
  constraint specification_needs_applicability check (
    claim_kind <> 'specification'
    or value_numeric is null
    or applicability_id is not null
    or review_status = 'needs_review'
  ),
  -- Community content may never enter the store already blessed.
  constraint community_claims_are_reviewed check (
    source_authority_tier < 4
    or assertion_strength <> 'confirmed'
    or review_status in ('needs_review', 'accepted')
  )
);

create index claims_subject_idx on claims (subject);
create index claims_kind_idx on claims (claim_kind);
create index claims_case_idx on claims (repair_case_id);
create index claims_review_idx on claims (review_status) where review_status <> 'accepted';
create index claims_text_idx on claims using gin (to_tsvector('english', subject || ' ' || object_text));

create type claim_relation_kind as enum (
  'supports', 'contradicts', 'corrects', 'refines', 'duplicates',
  'caused_by', 'resolved_by'
);

create table claim_relations (
  id               uuid primary key default gen_random_uuid(),
  from_claim_id    uuid not null references claims(id) on delete cascade,
  to_claim_id      uuid not null references claims(id) on delete cascade,
  relation_kind    claim_relation_kind not null,
  document_id      uuid not null references documents(id) on delete cascade,
  source_block_ids uuid[] not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),

  constraint relation_is_not_reflexive check (from_claim_id <> to_claim_id),
  unique (from_claim_id, to_claim_id, relation_kind)
);

create index claim_relations_to_idx on claim_relations (to_claim_id);

create type conflict_status as enum ('unresolved', 'resolved', 'not_a_conflict');

-- Groups incompatible claims WITHOUT forcing a premature winner.
create table conflict_sets (
  id                uuid primary key default gen_random_uuid(),
  subject           text not null,
  applicability_id  uuid references applicability_constraints(id) on delete set null,
  status            conflict_status not null default 'unresolved',
  resolution_note   text,
  resolved_claim_id uuid references claims(id) on delete set null,
  requires_fields   text[] not null default '{}',
  review_status     review_status not null default 'unreviewed',
  created_at        timestamptz not null default now(),

  constraint resolved_conflict_needs_claim check (
    status <> 'resolved' or (resolved_claim_id is not null and resolution_note is not null)
  )
);

create table conflict_set_members (
  conflict_set_id uuid not null references conflict_sets(id) on delete cascade,
  claim_id        uuid not null references claims(id) on delete cascade,
  primary key (conflict_set_id, claim_id)
);

create type procedure_kind as enum (
  'diagnostic_test', 'inspection', 'repair', 'adjustment', 'validation'
);

-- A useful partial procedure from a post. NOT a canonical repair procedure.
create table procedure_fragments (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references documents(id) on delete cascade,
  repair_case_id        uuid references repair_cases(id) on delete set null,
  title                 text not null,
  procedure_kind        procedure_kind not null,
  applicability_id      uuid references applicability_constraints(id) on delete set null,
  prerequisites         jsonb not null default '[]'::jsonb,
  safety_notes          jsonb not null default '[]'::jsonb,
  source_authority_tier smallint not null check (source_authority_tier between 1 and 7),
  review_status         review_status not null default 'unreviewed'
);

create table procedure_steps (
  id                       uuid primary key default gen_random_uuid(),
  procedure_fragment_id    uuid not null references procedure_fragments(id) on delete cascade,
  step_order               integer not null,
  instruction              text not null,
  expected_result          text,
  tool_claim_ids           uuid[] not null default '{}',
  specification_claim_ids  uuid[] not null default '{}',
  media_asset_ids          uuid[] not null default '{}',
  source_block_ids         uuid[] not null,
  is_safety_critical       boolean not null default false,

  unique (procedure_fragment_id, step_order),
  constraint step_cites_source check (array_length(source_block_ids, 1) >= 1)
);

-- ===========================================================================
-- Layer 4 — retrieval
-- ===========================================================================

create type chunk_kind as enum (
  'source_passage', 'case_summary', 'claim_bundle', 'procedure_fragment', 'specification'
);

create table retrieval_chunks (
  id                uuid primary key default gen_random_uuid(),
  chunk_kind        chunk_kind not null,
  document_id       uuid not null references documents(id) on delete cascade,
  repair_case_id    uuid references repair_cases(id) on delete set null,
  applicability_id  uuid references applicability_constraints(id) on delete set null,
  text              text not null,
  source_block_ids  uuid[] not null,
  claim_ids         uuid[] not null default '{}',
  specification_value_key text,
  authority_tier    smallint not null check (authority_tier between 1 and 7),
  quality_score     numeric(4, 3) not null default 0 check (quality_score between 0 and 1),
  credibility_score numeric(4, 3) not null default 0
                      check (credibility_score between 0 and 1),
  -- Denormalised for the exact-match stage.
  keywords          text[] not null default '{}',
  content_hash      text not null,
  schema_version    text not null,
  extractor_version text not null,
  active            boolean not null default true,

  constraint chunk_cites_source check (array_length(source_block_ids, 1) >= 1)
);

create index retrieval_chunks_active_idx on retrieval_chunks (chunk_kind) where active;
create index retrieval_chunks_authority_idx on retrieval_chunks (authority_tier) where active;
create index retrieval_chunks_keywords_idx on retrieval_chunks using gin (keywords);
create index retrieval_chunks_text_idx
  on retrieval_chunks using gin (to_tsvector('english', text));

-- Embeddings live apart from the knowledge record so the embedding model can
-- be swapped without rewriting anything above.
create table chunk_embeddings (
  chunk_id            uuid not null references retrieval_chunks(id) on delete cascade,
  embedding_model     text not null,
  embedding_dimensions integer not null check (embedding_dimensions > 0),
  embedding           vector(1536) not null,
  embedded_at         timestamptz not null default now(),
  primary key (chunk_id, embedding_model)
);

-- Build the ANN index only after real content has been imported.
-- create index chunk_embeddings_ann_idx on chunk_embeddings
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ===========================================================================
-- Review + promotion
-- ===========================================================================

create type review_flag_kind as enum (
  'exact_specification_from_community',
  'conflicting_claims',
  'missing_applicability',
  'safety_critical_procedure',
  'confirmed_root_cause',
  'ocr_derived_value',
  'unverifiable_oem_quote',
  'unit_normalization',
  'speculative_claim',
  'parse_incomplete'
);

create table review_queue (
  id                uuid primary key default gen_random_uuid(),
  ingestion_job_id  uuid references ingestion_jobs(id) on delete set null,
  flag_kind         review_flag_kind not null,
  severity          smallint not null default 2 check (severity between 1 and 3),
  message           text not null,
  claim_id          uuid references claims(id) on delete cascade,
  repair_case_id    uuid references repair_cases(id) on delete cascade,
  document_id       uuid references documents(id) on delete cascade,
  conflict_set_id   uuid references conflict_sets(id) on delete cascade,
  status            review_status not null default 'unreviewed',
  reviewer          text,
  reviewed_at       timestamptz,
  reviewer_note     text,
  created_at        timestamptz not null default now(),

  constraint review_flag_targets_something check (
    claim_id is not null or repair_case_id is not null
    or document_id is not null or conflict_set_id is not null
  )
);

create index review_queue_open_idx on review_queue (flag_kind) where status = 'unreviewed';

-- The ONLY sanctioned path from evidence into canonical knowledge
-- (source_document / source_passage in schema.sql). Append-only ledger.
create table canonical_promotions (
  id                     uuid primary key default gen_random_uuid(),
  claim_id               uuid not null references claims(id) on delete restrict,
  applicability_id       uuid not null references applicability_constraints(id) on delete restrict,
  -- source_passage.id in schema.sql (text primary key).
  target_passage_id      text not null,
  approved_by            text not null,
  approved_at            timestamptz not null default now(),
  conflict_check_passed  boolean not null,
  safety_critical        boolean not null default false,
  change_note            text not null,
  revision               integer not null default 1,

  constraint promotion_requires_clean_conflicts check (conflict_check_passed),
  unique (claim_id, revision)
);
