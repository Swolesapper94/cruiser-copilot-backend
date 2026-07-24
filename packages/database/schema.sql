-- ---------------------------------------------------------------------------
-- Cruiser Copilot — optional Postgres schema
--
-- The MVP runs entirely in memory. This schema exists for when you want the
-- session store and your own licensed source library to persist.
--
-- IMPORTANT: this file creates structure only. It contains no Toyota data, no
-- specification values and no procedures.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- --------------------------------------------------------------------------
-- Sources
-- --------------------------------------------------------------------------

create type source_type as enum (
  'service_bulletin',
  'oem_manual',
  'oem_technical',
  'verified_case',
  'technician',
  'forum',
  'general'
);

create type license_status as enum ('licensed', 'user-supplied', 'public', 'unknown');

create table source_document (
  id                text primary key,
  title             text        not null,
  source_type       source_type not null,
  publisher         text,
  edition           text,
  url               text,
  license_status    license_status not null default 'unknown',
  -- 1 = highest authority. Derived from source_type; stored for query speed.
  authority_level   smallint    not null check (authority_level between 1 and 7),
  -- True until a licensed, verified document replaces the scaffold record.
  is_placeholder    boolean     not null default true,
  imported_at       timestamptz not null default now()
);

create table source_passage (
  id                     text primary key,
  source_document_id     text not null references source_document(id) on delete cascade,
  text                   text not null,
  section                text,
  page_number            integer,
  post_number            text,

  -- Applicability. A passage with no constraints applies to nothing specific
  -- and can never resolve a conflict.
  model_codes            text[] not null default '{}',
  engine_codes           text[] not null default '{}',
  markets                text[] not null default '{}',
  pump_models            text[] not null default '{}',
  year_start             integer,
  year_end               integer,

  keywords               text[] not null default '{}',
  specification_subject  text,
  specification_value    text,

  -- Optional. Embeddings only ever ADD candidates; exact matching stays
  -- mandatory for codes, tool numbers, torque values and specifications.
  embedding              vector(1536),

  constraint year_range_valid check (
    year_start is null or year_end is null or year_start <= year_end
  ),
  constraint specification_pair check (
    (specification_subject is null and specification_value is null)
    or (specification_subject is not null and specification_value is not null)
  )
);

create index source_passage_document_idx  on source_passage (source_document_id);
create index source_passage_subject_idx   on source_passage (specification_subject);
create index source_passage_model_idx     on source_passage using gin (model_codes);
create index source_passage_engine_idx    on source_passage using gin (engine_codes);
create index source_passage_keywords_idx  on source_passage using gin (keywords);
create index source_passage_text_idx      on source_passage using gin (to_tsvector('english', text));
-- Build the ANN index only once you have imported real content.
-- create index source_passage_embedding_idx on source_passage
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- --------------------------------------------------------------------------
-- Sessions
-- --------------------------------------------------------------------------

create type session_stage as enum (
  'vehicle', 'symptoms', 'evidence', 'testing', 'repair', 'complete'
);

create table diagnostic_session (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  -- The full Vehicle object, validated by zod before it is written.
  vehicle            jsonb         not null,
  complaint          text          not null default '',
  stage              session_stage not null default 'vehicle',
  completed_step_ids text[]        not null default '{}',
  outcome            jsonb,
  mode               text          not null default 'scripted'
                       check (mode in ('scripted', 'live'))
);

create table session_answer (
  session_id  uuid  not null references diagnostic_session(id) on delete cascade,
  question_id text  not null,
  value       text  not null,
  free_text   text,
  answered_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

create type evidence_type as enum (
  'photo', 'video', 'audio', 'measurement', 'code', 'observation'
);

create table session_evidence (
  id                  text  primary key,
  session_id          uuid  not null references diagnostic_session(id) on delete cascade,
  type                evidence_type not null,
  -- What the user said versus what a model said. Never merged.
  user_description    text,
  machine_observation text,
  observation_limit   text,
  provenance          text  not null check (provenance in ('user', 'model')),
  capture_conditions  jsonb,
  file_name           text,
  mime_type           text,
  size_bytes          bigint check (size_bytes >= 0),
  measurement_key     text,
  measurement_value   double precision,
  measurement_unit    text,
  created_at          timestamptz not null default now(),

  constraint measurement_complete check (
    (measurement_key is null and measurement_value is null and measurement_unit is null)
    or (measurement_key is not null and measurement_value is not null and measurement_unit is not null)
  ),
  -- A model observation must always state what it could not show.
  constraint machine_observation_bounded check (
    machine_observation is null or observation_limit is not null
  )
);

create index session_evidence_session_idx on session_evidence (session_id);

-- --------------------------------------------------------------------------
-- Outcome ledger — negative outcomes matter as much as fixes.
-- --------------------------------------------------------------------------

create table session_outcome_log (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references diagnostic_session(id) on delete cascade,
  resolved           text not null check (resolved in ('yes', 'no', 'partially', 'unknown')),
  performed_test_ids text[] not null default '{}',
  notes              text,
  recorded_at        timestamptz not null default now()
);
