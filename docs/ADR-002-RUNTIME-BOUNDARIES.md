# ADR-002: Runtime security and durable MVP boundaries

**Status:** Accepted
**Date:** 2026-09-01
**Decision owners:** Cruiser Copilot

## Context

The original MVP kept sessions and reviewed evidence only in process memory,
used guessable session identifiers as the sole access boundary, accepted
arbitrary crawl-source definitions, and let the UI request media analysis even
though no media transport existed. Those shortcuts made a restart destructive,
made session URLs act like credentials, and made the crawler's governance
controls too easy to misunderstand.

## Decision

- Create session IDs with UUIDs and issue a separate 256-bit bearer token once.
  Store only its SHA-256 hash and require the token for every session-scoped
  read or mutation.
- Support an atomic, mode-0600 JSON store for single-process deployments while
  retaining memory mode for tests. Use Postgres for multiple processes or
  larger deployments.
- Persist validated evidence extractions and human approvals separately. Only
  reviewed chunks enter diagnostic retrieval; editorial approval never changes
  the underlying source's licence status.
- Admit crawl requests by registry ID, never by caller-supplied host/config.
  Keep every source inactive unless its terms and robots decisions are recorded.
- Treat browser media as metadata plus a human observation. Reject model
  analysis until a real consented binary transport and analysis service exist.
- Version session/procedure payloads and make the frontend reject incompatible
  contract versions.

## Alternatives considered

- **Session ID as bearer secret:** rejected because IDs appear in routes,
  history, screenshots, and logs.
- **Database required for all local use:** rejected because it raises the setup
  floor; the file store gives the single-process MVP restart durability.
- **Automatic forum activation after robots review:** rejected because robots
  is an access instruction, not a reuse licence.
- **Pretend media analysis from filenames/notes:** rejected because it would
  imply the model observed bytes it never received.

## Consequences

The browser retains a session token in local storage, so clearing site data
removes access to that session. File storage remains single-process and must not
be shared by multiple server instances. Scaling requires Postgres and a real
identity/authorization layer. Forum onboarding now requires an explicit policy
change, which is slower but auditable and safe by default.
