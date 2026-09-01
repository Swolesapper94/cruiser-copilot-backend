import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import {
  adapterFor,
  assertFetchAllowed,
  hashBody,
  type ParsedDocument,
  type ParseVerification,
  type RawSnapshot,
  type SourcePolicy,
  verifyParse,
} from "./adapters";

const MAX_ROBOTS_BYTES = 512 * 1024;
const TRACKING_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

export const crawlSourceSchema = z.object({
  name: z.string().min(1),
  base_url: z.string().url(),
  source_kind: z.literal("forum").default("forum"),
  authority_tier: z.number().int().min(4).max(7).default(6),
  terms_review_status: z.enum(["pending", "approved", "restricted", "prohibited"]),
  robots_reviewed_at: z.string().datetime().optional(),
  request_delay_ms: z.number().int().min(1000).default(5000),
  max_pages_per_run: z.number().int().min(1).max(250).default(25),
  max_response_bytes: z.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
  allowed_path_prefixes: z.array(z.string().startsWith("/")).min(1).default(["/threads/"]),
  active: z.boolean(),
});

export type CrawlSource = z.infer<typeof crawlSourceSchema>;

export interface CrawlPageResult {
  url: string;
  snapshot?: RawSnapshot;
  parsed?: ParsedDocument;
  verification?: ParseVerification;
  discoveredUrls: string[];
  status: "parsed" | "unchanged" | "skipped" | "failed";
  reason?: string;
}

export interface CrawlRunResult {
  source: string;
  startedAt: string;
  completedAt: string;
  pagesAttempted: number;
  pagesParsed: number;
  pagesFailed: number;
  results: CrawlPageResult[];
}

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface FetchDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<unknown>;
  now?: () => number;
}

export function canonicalizeCrawlUrl(input: string, source: CrawlSource): string {
  const url = new URL(input, source.base_url);
  const base = new URL(source.base_url);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP(S) crawl targets are supported.");
  }
  if (url.username || url.password) throw new Error("Credentialed URLs are not permitted.");
  if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
    throw new Error(`Cross-host crawl target rejected: ${url.hostname}`);
  }
  if (!source.allowed_path_prefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new Error(`Path is outside this source's allow-list: ${url.pathname}`);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

function parseRobots(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let seenRule = false;

  for (const rawLine of body.slice(0, MAX_ROBOTS_BYTES).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || seenRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        seenRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      seenRule = true;
      if (value || field === "allow") {
        current.rules.push({ allow: field === "allow", pattern: value });
      }
    }
  }
  return groups;
}

function ruleRegex(pattern: string): RegExp {
  const exact = pattern.endsWith("$");
  const raw = exact ? pattern.slice(0, -1) : pattern;
  const escaped = raw
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${exact ? "$" : ""}`);
}

export function robotsAllows(body: string, userAgent: string, targetUrl: string): boolean {
  const token = userAgent.split(/[/\s;]/, 1)[0].toLowerCase();
  const groups = parseRobots(body);
  const exact = groups.filter((group) => group.agents.includes(token));
  const selected = exact.length > 0
    ? exact
    : groups.filter((group) => group.agents.includes("*"));
  const path = `${new URL(targetUrl).pathname}${new URL(targetUrl).search}`;
  const matches = selected
    .flatMap((group) => group.rules)
    .filter((rule) => rule.pattern && ruleRegex(rule.pattern).test(path))
    .sort((a, b) => b.pattern.length - a.pattern.length);
  if (matches.length === 0) return true;
  const longest = matches[0].pattern.length;
  return matches.filter((rule) => rule.pattern.length === longest).some((rule) => rule.allow);
}

export function discoverThreadUrls(html: string, pageUrl: string, source: CrawlSource): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["'](?<href>[^"'#]+)["'][^>]*>/gi)) {
    const href = match.groups?.href;
    if (!href || !href.includes("/threads/")) continue;
    try {
      urls.add(canonicalizeCrawlUrl(new URL(href, pageUrl).toString(), source));
    } catch {
      // Cross-host and out-of-policy links are deliberately ignored.
    }
  }
  return [...urls].sort();
}

class CrawlFrontier {
  private readonly queued: string[] = [];
  private readonly seen = new Set<string>();

  enqueue(url: string): void {
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.queued.push(url);
  }

  take(): string | undefined {
    return this.queued.shift();
  }
}

export class ForumCrawler {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<unknown>;
  private readonly now: () => number;
  private lastRequestAt = 0;
  private robotsBody?: string;
  private robotsFetchedAt = 0;
  private readonly knownHashes = new Map<string, string>();

  constructor(
    private readonly source: CrawlSource,
    private readonly userAgent: string,
    dependencies: FetchDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.sleep = dependencies.sleep ?? ((milliseconds) => delay(milliseconds));
    this.now = dependencies.now ?? Date.now;
  }

  private policy(): SourcePolicy {
    return {
      name: this.source.name,
      baseUrl: this.source.base_url,
      sourceKind: this.source.source_kind,
      authorityTier: this.source.authority_tier,
      termsReviewStatus: this.source.terms_review_status,
      robotsReviewedAt: this.source.robots_reviewed_at,
      requestDelayMs: this.source.request_delay_ms,
      active: this.source.active,
    };
  }

  private async politeFetch(url: string): Promise<Response> {
    const wait = Math.max(
      0,
      this.lastRequestAt + this.source.request_delay_ms - this.now(),
    );
    if (wait > 0) await this.sleep(wait);
    const response = await this.fetchImpl(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    this.lastRequestAt = this.now();
    return response;
  }

  private async robots(): Promise<string> {
    if (this.robotsBody && this.now() - this.robotsFetchedAt < 24 * 60 * 60 * 1000) {
      return this.robotsBody;
    }
    const robotsUrl = new URL("/robots.txt", this.source.base_url).toString();
    const response = await this.politeFetch(robotsUrl);
    if (response.status >= 500) {
      throw new Error(`robots.txt unreachable (${response.status}); crawl is fail-closed.`);
    }
    this.robotsBody = response.status >= 400 ? "" : (await response.text()).slice(0, MAX_ROBOTS_BYTES);
    this.robotsFetchedAt = this.now();
    return this.robotsBody;
  }

  private async fetchPage(url: string): Promise<RawSnapshot> {
    assertFetchAllowed(this.policy(), true);
    const robotsBody = await this.robots();
    if (!robotsAllows(robotsBody, this.userAgent, url)) {
      throw new Error("robots.txt disallows this URL for the configured crawler.");
    }
    const response = await this.politeFetch(url);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }
    const statedLength = Number(response.headers.get("content-length") ?? 0);
    if (statedLength > this.source.max_response_bytes) {
      throw new Error(`Response exceeds ${this.source.max_response_bytes} bytes.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.source.max_response_bytes) {
      throw new Error(`Response exceeds ${this.source.max_response_bytes} bytes.`);
    }
    const body = new TextDecoder().decode(bytes);
    return {
      canonicalUrl: url,
      retrievedUrl: response.url || url,
      retrievedAt: new Date(this.now()).toISOString(),
      httpStatus: response.status,
      contentType,
      contentHash: hashBody(body),
      body,
    };
  }

  async run(seedUrls: readonly string[]): Promise<CrawlRunResult> {
    const startedAt = new Date(this.now()).toISOString();
    const frontier = new CrawlFrontier();
    for (const seed of seedUrls) {
      frontier.enqueue(canonicalizeCrawlUrl(seed, this.source));
    }
    const results: CrawlPageResult[] = [];

    while (results.length < this.source.max_pages_per_run) {
      const url = frontier.take();
      if (!url) break;
      try {
        const snapshot = await this.fetchPage(url);
        const discoveredUrls = discoverThreadUrls(snapshot.body, url, this.source);
        for (const discovered of discoveredUrls) frontier.enqueue(discovered);
        if (this.knownHashes.get(url) === snapshot.contentHash) {
          results.push({ url, snapshot, discoveredUrls, status: "unchanged" });
          continue;
        }
        const adapter = adapterFor(new URL(url));
        if (!adapter) {
          results.push({ url, snapshot, discoveredUrls, status: "skipped", reason: "No source adapter." });
          continue;
        }
        const parsed = adapter.parse(snapshot, this.policy());
        const verification = verifyParse(parsed);
        this.knownHashes.set(url, snapshot.contentHash);
        results.push({
          url,
          snapshot,
          parsed,
          verification,
          discoveredUrls,
          status: verification.ok ? "parsed" : "failed",
          reason: verification.ok ? undefined : verification.problems.join(" "),
        });
      } catch (error) {
        results.push({
          url,
          discoveredUrls: [],
          status: "failed",
          reason: error instanceof Error ? error.message : "Unknown crawl failure.",
        });
      }
    }

    return {
      source: this.source.name,
      startedAt,
      completedAt: new Date(this.now()).toISOString(),
      pagesAttempted: results.length,
      pagesParsed: results.filter((entry) => entry.status === "parsed").length,
      pagesFailed: results.filter((entry) => entry.status === "failed").length,
      results,
    };
  }
}
