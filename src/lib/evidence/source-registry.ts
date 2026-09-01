import type { CrawlSource } from "./crawler";

export interface RegisteredForumSource {
  id: string;
  priority: 1 | 2 | 3;
  adapter: "xenforo" | "unsupported";
  rationale: string;
  policySummary: string;
  termsUrl?: string;
  robotsUrl: string;
  crawl: CrawlSource;
}

/**
 * Candidate registry, not a crawl authorization list.
 *
 * Every entry is inactive by default. A source may only be activated in a
 * reviewed change that records approved terms and a current robots review.
 */
export const FORUM_SOURCE_REGISTRY: RegisteredForumSource[] = [
  {
    id: "ih8mud",
    priority: 1,
    adapter: "xenforo",
    rationale:
      "Largest Land Cruiser-specific technical community; strong 70/80-series coverage, with diesel content mixed into a largely North American corpus.",
    policySummary:
      "Terms prohibit gathering data or commercial use without express written consent. Keep disabled unless Tie Rod Media grants that consent.",
    termsUrl: "https://www.ih8mud.com/privacy-terms-conditions/",
    robotsUrl: "https://forum.ih8mud.com/robots.txt",
    crawl: {
      name: "IH8MUD Forum",
      base_url: "https://forum.ih8mud.com",
      source_kind: "forum",
      authority_tier: 6,
      terms_review_status: "prohibited",
      robots_reviewed_at: "2026-09-01T00:00:00.000Z",
      request_delay_ms: 10_000,
      max_pages_per_run: 10,
      max_response_bytes: 5 * 1024 * 1024,
      allowed_path_prefixes: ["/threads/"],
      active: false,
    },
  },
  {
    id: "landcruiserclub",
    priority: 1,
    adapter: "xenforo",
    rationale:
      "Land Cruiser-only community with visible 70/80-series and 1HZ/1HD-T discussions from markets where diesel vehicles are common.",
    policySummary:
      "Thread paths are allowed by robots.txt, but the published forum terms do not establish third-party RAG reuse rights. Operator review or permission is still required.",
    termsUrl: "https://www.landcruiserclub.net/community/help/terms/",
    robotsUrl: "https://www.landcruiserclub.net/robots.txt",
    crawl: {
      name: "Land Cruiser Club",
      base_url: "https://www.landcruiserclub.net",
      source_kind: "forum",
      authority_tier: 6,
      terms_review_status: "pending",
      robots_reviewed_at: "2026-09-01T00:00:00.000Z",
      request_delay_ms: 10_000,
      max_pages_per_run: 10,
      max_response_bytes: 5 * 1024 * 1024,
      allowed_path_prefixes: ["/community/threads/"],
      active: false,
    },
  },
  {
    id: "expedition-portal",
    priority: 2,
    adapter: "xenforo",
    rationale:
      "Large overland community with a dedicated Land Cruiser section; useful for repair outcomes, but broader and less diesel-specific.",
    policySummary:
      "Thread paths are allowed by robots.txt. Authors retain copyright under the published terms, so a storage and excerpt policy needs operator/legal approval before crawling.",
    termsUrl: "https://forum.expeditionportal.com/help/terms/",
    robotsUrl: "https://forum.expeditionportal.com/robots.txt",
    crawl: {
      name: "Expedition Portal",
      base_url: "https://forum.expeditionportal.com",
      source_kind: "forum",
      authority_tier: 6,
      terms_review_status: "pending",
      robots_reviewed_at: "2026-09-01T00:00:00.000Z",
      request_delay_ms: 12_000,
      max_pages_per_run: 8,
      max_response_bytes: 5 * 1024 * 1024,
      allowed_path_prefixes: ["/threads/"],
      active: false,
    },
  },
  {
    id: "toyota-owners-club-au",
    priority: 2,
    adapter: "unsupported",
    rationale:
      "Australian Toyota community with directly relevant 1HD-T cases; it needs a dedicated Invision adapter before any ingestion pilot.",
    policySummary:
      "Robots content signals permit search/reference use and prohibit AI training, but named AI bots are blocked and the forum terms do not grant broad reuse. Treat as restricted.",
    termsUrl: "https://au.toyotaownersclub.com/terms-conditions/",
    robotsUrl: "https://au.toyotaownersclub.com/robots.txt",
    crawl: {
      name: "Toyota Owners Club Australia",
      base_url: "https://au.toyotaownersclub.com",
      source_kind: "forum",
      authority_tier: 6,
      terms_review_status: "restricted",
      robots_reviewed_at: "2026-09-01T00:00:00.000Z",
      request_delay_ms: 12_000,
      max_pages_per_run: 8,
      max_response_bytes: 5 * 1024 * 1024,
      allowed_path_prefixes: ["/forums/topic/"],
      active: false,
    },
  },
];

export function registeredForumSource(id: string): RegisteredForumSource | undefined {
  return FORUM_SOURCE_REGISTRY.find((source) => source.id === id);
}
