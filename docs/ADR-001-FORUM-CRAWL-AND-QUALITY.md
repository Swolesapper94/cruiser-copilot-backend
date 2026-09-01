# ADR-001: Forum crawl and evidence-quality architecture

**Status:** Accepted for MVP  
**Date:** 2026-07-26  
**Decision owners:** Cruiser Copilot

## Context

Forum pages mix useful repair evidence with quotes, signatures, guesses, jokes,
arguments, vendor promotion, unrelated discussion, and sometimes a confirmed
outcome. Flattening the page into arbitrary embedding chunks makes all of those
look equally authoritative. At scale, the crawler must also avoid duplicate
URLs, accidental cross-host traversal, private/account areas, excess traffic,
and re-downloading unchanged pages.

## Decision

Use a five-stage, source-preserving pipeline:

1. **Crawl control** — an operator-approved source record, explicit host and
   path allow-list, robots evaluation, identifiable user agent, per-host delay,
   response-size limit, run budget, deduplicated frontier, retry state, and
   content hashes.
2. **Deterministic parsing** — adapters establish thread, post, author, time,
   quote, block, media-reference, and citation locations without a language
   model.
3. **Forum assessment** — a semantic extractor assesses the thread and each post
   for automotive relevance, topic relevance, discourse role, constructiveness,
   helpfulness, evidence strength, sentiment, systems, components, symptoms,
   and retrieval disposition.
4. **Atomic evidence extraction** — vehicle mentions, observations, claims,
   relations, repair cases, outcomes, and procedure fragments cite exact source
   blocks.
5. **Retrieval and review** — excluded posts do not become active source chunks;
   low-value posts are down-ranked; exact community specifications,
   safety-critical instructions, contradictions, and claimed resolutions enter
   human review. OEM and community evidence remain separate result channels.

Sentiment is never a truth score. A hostile correction with a measurement may
be highly useful; a friendly unsupported suggestion may be excluded.

## Data boundaries

- Store immutable HTML snapshots according to the recorded source policy.
- Store media by source URL unless reuse rights are recorded.
- Treat usernames as provenance, not reputation scores.
- Do not infer author expertise from post count, badges, writing style, or tone.
- Do not promote community claims into canonical specifications without the
  append-only human promotion workflow.

## Scale-out topology

```text
Sitemap / curated seeds
          |
    crawl frontier
          |
  polite fetch workers
          |
 immutable snapshots
          |
 deterministic adapters
          |
 semantic assessment + extraction
          |
 validation / review queue
          |
 hybrid retrieval index
```

The Postgres `crawl_frontier` supports workers claiming work with
`FOR UPDATE SKIP LOCKED`. Start with one worker per host. Add workers across
different hosts before increasing concurrency against any single forum.

## Alternatives considered

- **Embed whole pages:** rejected because quotes, arguments, signatures, and
  outcomes lose their roles and citations become vague.
- **Use sentiment as quality:** rejected because tone and evidentiary value are
  independent.
- **Let an LLM discover post boundaries:** rejected because a structural error
  makes every later citation unreliable.
- **Crawl from browser sessions:** rejected because it risks private content,
  unstable authentication behavior, and poor reproducibility.
- **Community/OEM authority averaging:** rejected because many forum repetitions
  must not outweigh one applicable factory source.

## Consequences

The pipeline costs more per thread than naive chunking and requires model
evaluation plus a review queue. In return, it can explain why a post was
included, down-ranked, excluded, or held; it can cite the exact post; and it
does not silently turn forum consensus into a factory specification.
