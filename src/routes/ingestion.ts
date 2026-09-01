import { Router } from "express";
import { z } from "zod";

import {
  env,
  forumIngestionEnabled,
  ingestionAdminAuthorized,
} from "@/lib/config/env";
import {
  EXTRACTION_SCHEMA_VERSION,
  FORUM_SOURCE_REGISTRY,
  ForumCrawler,
  evidenceCatalog,
  registeredForumSource,
} from "@/lib/evidence";

const crawlRequestSchema = z.object({
  source_id: z.string().min(1),
  seed_urls: z.array(z.string().url()).min(1).max(25),
});

const approvalSchema = z.object({ reviewer: z.string().min(2).max(120) });

export const ingestionRouter = Router();

ingestionRouter.get("/forum/sources", (_req, res) => {
  res.json({
    sources: FORUM_SOURCE_REGISTRY.map((source) => ({
      id: source.id,
      name: source.crawl.name,
      priority: source.priority,
      adapter: source.adapter,
      rationale: source.rationale,
      policy_summary: source.policySummary,
      base_url: source.crawl.base_url,
      terms_url: source.termsUrl,
      robots_url: source.robotsUrl,
      terms_review_status: source.crawl.terms_review_status,
      robots_reviewed_at: source.crawl.robots_reviewed_at,
      active: source.crawl.active,
    })),
  });
});

ingestionRouter.get("/forum/schema", (_req, res) => {
  res.json({
    schema_version: EXTRACTION_SCHEMA_VERSION,
    assessment_layers: {
      thread: [
        "thread_kind",
        "automotive_relevance",
        "target_vehicle_confidence",
        "off_topic_ratio",
        "argument_ratio",
        "constructive_ratio",
        "evidence_density",
        "outcome_signal",
        "systems",
        "components",
        "symptoms",
        "retrieval_disposition",
      ],
      post: [
        "author_role",
        "discourse_roles",
        "automotive_relevance",
        "thread_topic_relevance",
        "constructiveness",
        "helpfulness",
        "evidence_strength",
        "sentiment",
        "systems",
        "components",
        "symptoms",
        "diagnostic_codes",
        "retrieval_disposition",
        "disposition_reasons",
      ],
      evidence: [
        "vehicle_mentions",
        "repair_cases",
        "observations",
        "claims",
        "claim_relations",
        "procedure_fragments",
        "review_flags",
      ],
    },
    rule:
      "Sentiment never determines truth or retrieval eligibility; citations, relevance, evidence strength and confirmed outcomes do.",
  });
});

ingestionRouter.post("/forum/crawl", async (req, res, next) => {
  if (!ingestionAdminAuthorized(req.header("authorization"))) {
    res.status(401).json({ error: { code: "ingestion_admin_required" } });
    return;
  }
  if (!forumIngestionEnabled()) {
    res.status(409).json({ error: { code: "forum_ingestion_disabled" } });
    return;
  }
  const parsed = crawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: "invalid_crawl_request", issues: parsed.error.issues },
    });
    return;
  }

  try {
    const registered = registeredForumSource(parsed.data.source_id);
    if (!registered) {
      res.status(404).json({ error: { code: "forum_source_not_registered" } });
      return;
    }
    if (registered.adapter === "unsupported") {
      res.status(409).json({ error: { code: "forum_adapter_not_available" } });
      return;
    }
    const source = {
      ...registered.crawl,
      request_delay_ms: Math.max(
        registered.crawl.request_delay_ms,
        env.INGESTION_REQUEST_DELAY_MS,
      ),
      max_pages_per_run: Math.min(
        registered.crawl.max_pages_per_run,
        env.INGESTION_MAX_PAGES_PER_RUN,
      ),
    };
    const crawler = new ForumCrawler(source, env.INGESTION_USER_AGENT);
    const result = await crawler.run(parsed.data.seed_urls);
    res.json({
      ...result,
      results: result.results.map((entry) => ({
        url: entry.url,
        status: entry.status,
        reason: entry.reason,
        discovered_urls: entry.discoveredUrls,
        snapshot: entry.snapshot
          ? {
              canonical_url: entry.snapshot.canonicalUrl,
              retrieved_url: entry.snapshot.retrievedUrl,
              retrieved_at: entry.snapshot.retrievedAt,
              http_status: entry.snapshot.httpStatus,
              content_type: entry.snapshot.contentType,
              content_hash: entry.snapshot.contentHash,
            }
          : undefined,
        verification: entry.verification,
        parsed: entry.parsed,
      })),
    });
  } catch (error) {
    next(error);
  }
});

ingestionRouter.post("/extractions", async (req, res, next) => {
  if (!ingestionAdminAuthorized(req.header("authorization"))) {
    res.status(401).json({ error: { code: "ingestion_admin_required" } });
    return;
  }
  try {
    const result = await evidenceCatalog.ingest(req.body);
    res.status(result.ok ? 201 : 422).json({
      ok: result.ok,
      document_id: result.normalized?.documentId,
      errors: result.errors,
      warnings: result.warnings,
      review_flags: result.reviewFlags,
      held_for_review: result.heldForReview,
      chunks: result.chunks.length,
    });
  } catch (error) {
    next(error);
  }
});

ingestionRouter.post("/documents/:id/approve", async (req, res, next) => {
  if (!ingestionAdminAuthorized(req.header("authorization"))) {
    res.status(401).json({ error: { code: "ingestion_admin_required" } });
    return;
  }
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "invalid_approval" } });
    return;
  }
  try {
    const approved = await evidenceCatalog.approve(req.params.id, parsed.data.reviewer);
    if (!approved) {
      res.status(404).json({ error: { code: "evidence_document_not_found" } });
      return;
    }
    res.json({ approved: true, document_id: req.params.id });
  } catch (error) {
    next(error);
  }
});

ingestionRouter.get("/status", (req, res) => {
  if (!ingestionAdminAuthorized(req.header("authorization"))) {
    res.status(401).json({ error: { code: "ingestion_admin_required" } });
    return;
  }
  res.json({
    documents: evidenceCatalog.store.summaries(),
    open_review_flags: evidenceCatalog.store.openReviewFlags(),
  });
});
