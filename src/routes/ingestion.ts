import { Router } from "express";
import { z } from "zod";

import {
  env,
  forumIngestionEnabled,
  ingestionAdminAuthorized,
} from "@/lib/config/env";
import {
  EXTRACTION_SCHEMA_VERSION,
  ForumCrawler,
  crawlSourceSchema,
} from "@/lib/evidence";

const crawlRequestSchema = z.object({
  source: crawlSourceSchema,
  seed_urls: z.array(z.string().url()).min(1).max(25),
});

export const ingestionRouter = Router();

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
    const source = {
      ...parsed.data.source,
      request_delay_ms: Math.max(
        parsed.data.source.request_delay_ms,
        env.INGESTION_REQUEST_DELAY_MS,
      ),
      max_pages_per_run: Math.min(
        parsed.data.source.max_pages_per_run,
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
