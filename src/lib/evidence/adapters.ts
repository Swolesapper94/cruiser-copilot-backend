import { createHash } from "node:crypto";

import type { ExtractionPayload } from "./schemas";

/**
 * Source adapters.
 *
 * The PARSER establishes structure — post boundaries, authorship, timestamps,
 * quotes, locators. Only once that is reliable does a model get to interpret
 * automotive meaning. An LLM is never asked "which post is which".
 *
 * Nothing here fetches anything until a human has recorded a terms review for
 * the source AND ingestion is explicitly enabled.
 */

export type TermsReviewStatus = "pending" | "approved" | "restricted" | "prohibited";

export interface SourcePolicy {
  name: string;
  baseUrl: string;
  sourceKind: ExtractionPayload["source"]["source_kind"];
  authorityTier: number;
  termsReviewStatus: TermsReviewStatus;
  robotsReviewedAt?: string;
  /** Minimum delay between requests to this host. */
  requestDelayMs: number;
  active: boolean;
}

export interface RawSnapshot {
  canonicalUrl: string;
  retrievedUrl: string;
  retrievedAt: string;
  httpStatus: number;
  contentType: string;
  contentHash: string;
  body: string;
}

/** Everything an adapter can establish without a model. */
export type ParsedDocument = Pick<
  ExtractionPayload,
  "source" | "snapshot" | "document" | "content_units" | "media"
> & {
  parserDiagnostics: {
    expectedUnitCount: number;
    unitsWithLocatedBody: number;
    minimumTextCoverage: number;
  };
};

export interface SourceAdapter {
  id: string;
  canHandle(url: URL): boolean;
  parse(snapshot: RawSnapshot, policy: SourcePolicy): ParsedDocument;
}

export class IngestionNotPermittedError extends Error {}

/**
 * The single gate in front of every network fetch.
 *
 * @throws IngestionNotPermittedError when the source has not been cleared.
 */
export function assertFetchAllowed(policy: SourcePolicy, enabled: boolean): void {
  if (!enabled) {
    throw new IngestionNotPermittedError(
      "Forum ingestion is disabled. Set ENABLE_FORUM_INGESTION=true to enable it.",
    );
  }
  if (!policy.active) {
    throw new IngestionNotPermittedError(`Source "${policy.name}" is not active.`);
  }
  if (policy.termsReviewStatus !== "approved") {
    throw new IngestionNotPermittedError(
      `Source "${policy.name}" has terms review status "${policy.termsReviewStatus}". Only "approved" may be fetched.`,
    );
  }
  if (!policy.robotsReviewedAt) {
    throw new IngestionNotPermittedError(
      `Source "${policy.name}" has no recorded robots/terms review date.`,
    );
  }
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/* ------------------------------------------------------------------ */
/* HTML helpers                                                        */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function stripTags(html: string): string {
  const withoutNonContent = html
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return decodeEntities(withoutNonContent.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* XenForo                                                             */
/* ------------------------------------------------------------------ */

const POST_PATTERN =
  /<article\b(?<attrs>[^>]*data-content="post-(?<postId>[^"]+)"[^>]*)>(?<body>[\s\S]*?)<\/article>/gi;
const AUTHOR_PATTERN = /data-author="(?<author>[^"]*)"/i;
const TIME_PATTERN = /<time\b[^>]*datetime="(?<datetime>[^"]+)"/i;
const POST_NUMBER_PATTERN = /#(?<number>\d+)\s*<\/a>/i;
const MESSAGE_BODY_OPEN_PATTERN =
  /<div\b[^>]*class="[^"]*bbWrapper[^"]*"[^>]*>/i;
const BLOCKQUOTE_PATTERN = /<blockquote\b[\s\S]*?<\/blockquote>/gi;
const IMAGE_PATTERN = /<img\b[^>]*src="(?<src>[^"]+)"[^>]*>/gi;
const LIST_PATTERN = /<(ul|ol)\b[\s\S]*?<\/\1>/i;
const TABLE_PATTERN = /<table\b[\s\S]*?<\/table>/i;
const CODE_PATTERN = /<(pre|code)\b[\s\S]*?<\/\1>/i;

function blockKindFor(fragment: string): ExtractionPayload["content_units"][number]["blocks"][number]["block_kind"] {
  if (TABLE_PATTERN.test(fragment)) return "table";
  if (LIST_PATTERN.test(fragment)) return "list";
  if (CODE_PATTERN.test(fragment)) return "code";
  if (/<h[1-6]\b/i.test(fragment)) return "heading";
  return "paragraph";
}

/** Returns the inside of a possibly nested div without stopping at its first child. */
function extractBalancedMessageBody(html: string): string | undefined {
  const open = MESSAGE_BODY_OPEN_PATTERN.exec(html);
  if (!open || open.index === undefined) return undefined;
  const contentStart = open.index + open[0].length;
  const divToken = /<\/?div\b[^>]*>/gi;
  divToken.lastIndex = contentStart;
  let depth = 1;
  for (const token of html.matchAll(divToken)) {
    if ((token.index ?? 0) < contentStart) continue;
    if (/^<div\b/i.test(token[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(contentStart, token.index);
  }
  return undefined;
}

/** Splits a message body into ordered blocks, keeping quotes separate. */
function splitBlocks(content: string): Array<{ kind: string; html: string }> {
  const segments: Array<{ kind: string; html: string }> = [];
  let cursor = 0;

  for (const match of content.matchAll(BLOCKQUOTE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: "body", html: content.slice(cursor, start) });
    }
    segments.push({ kind: "quote", html: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "body", html: content.slice(cursor) });
  }

  const blocks: Array<{ kind: string; html: string }> = [];
  for (const segment of segments) {
    if (segment.kind === "quote") {
      blocks.push(segment);
      continue;
    }
    const pieces = segment.html
      .split(/<br\s*\/?>\s*<br\s*\/?>|<\/p>|<\/div>/i)
      .map((piece) => piece.trim())
      .filter((piece) => stripTags(piece).length > 0);
    for (const piece of pieces) blocks.push({ kind: "body", html: piece });
  }

  return blocks;
}

/**
 * Best-effort XenForo thread parser (IH8MUD and most Land Cruiser forums run
 * XenForo). Markup changes between versions and themes: always run
 * `verifyParse` on a new site before trusting a citation from it.
 */
export const xenforoAdapter: SourceAdapter = {
  id: "xenforo",

  canHandle(url: URL): boolean {
    return /\/threads\//.test(url.pathname);
  },

  parse(snapshot: RawSnapshot, policy: SourcePolicy): ParsedDocument {
    const titleMatch = snapshot.body.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : snapshot.canonicalUrl;

    const contentUnits: ExtractionPayload["content_units"] = [];
    const media: ExtractionPayload["media"] = [];
    let postIndex = 0;
    let unitsWithLocatedBody = 0;
    let minimumTextCoverage = 1;
    const expectedUnitCount = [...snapshot.body.matchAll(POST_PATTERN)].length;

    for (const match of snapshot.body.matchAll(POST_PATTERN)) {
      const postId = match.groups?.postId ?? String(postIndex + 1);
      const attrs = match.groups?.attrs ?? "";
      const body = match.groups?.body ?? "";
      const localId = `post-${postId}`;
      postIndex += 1;

      const locatedContent = extractBalancedMessageBody(body);
      if (locatedContent !== undefined) unitsWithLocatedBody += 1;
      const content = locatedContent ?? body;

      const blocks = splitBlocks(content)
        .map((block, index) => ({
          local_id: `${localId}-block-${index}`,
          block_kind: block.kind === "quote" ? ("quote" as const) : blockKindFor(block.html),
          text: stripTags(block.html),
          raw_locator: {
            selector: `article[data-content="post-${postId}"]`,
            blockIndex: index,
          } as Record<string, unknown>,
          quoted_unit_local_id: null,
          ocr_derived: false,
        }))
        .filter((block) => block.text.length > 0);

      if (blocks.length === 0) continue;
      const sourceTextLength = stripTags(content).length;
      const parsedTextLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
      if (sourceTextLength > 0) {
        minimumTextCoverage = Math.min(
          minimumTextCoverage,
          parsedTextLength / sourceTextLength,
        );
      }

      const numberMatch = body.match(POST_NUMBER_PATTERN);
      const postNumber = numberMatch ? Number(numberMatch.groups?.number) : postIndex;

      const author = attrs.match(AUTHOR_PATTERN)?.groups?.author;

      contentUnits.push({
        local_id: localId,
        unit_kind: "forum_post",
        external_id: postId,
        sequence_number: postNumber,
        parent_unit_local_id: null,
        title: null,
        author_external_id: null,
        author_display_name: author ? decodeEntities(author) : null,
        created_at_source: body.match(TIME_PATTERN)?.groups?.datetime ?? null,
        edited_at_source: null,
        is_primary: postNumber === 1,
        is_moderator: null,
        reaction_count: null,
        blocks,
      });

      for (const image of content.matchAll(IMAGE_PATTERN)) {
        const src = image.groups?.src;
        if (!src || src.startsWith("data:")) continue;
        media.push({
          local_id: `media-${postId}-${media.length}`,
          content_unit_local_id: localId,
          asset_kind: "image",
          source_url: new URL(src, snapshot.canonicalUrl).toString(),
          caption: null,
          alt_text: null,
          ocr_text: null,
          // Never copy bytes. A URL reference is enough until rights are cleared.
          rights_status: "unknown",
        });
      }
    }

    return {
      source: {
        name: policy.name,
        base_url: policy.baseUrl,
        source_kind: policy.sourceKind,
        authority_tier: policy.authorityTier,
      },
      snapshot: {
        canonical_url: snapshot.canonicalUrl,
        retrieved_url: snapshot.retrievedUrl,
        retrieved_at: snapshot.retrievedAt,
        http_status: snapshot.httpStatus,
        content_hash: snapshot.contentHash,
      },
      document: {
        title,
        document_kind: "forum_thread",
        canonical_url: snapshot.canonicalUrl,
        external_id: null,
        created_at_source: contentUnits[0]?.created_at_source ?? null,
        updated_at_source:
          contentUnits[contentUnits.length - 1]?.created_at_source ?? null,
        language: "en",
      },
      content_units: contentUnits,
      media,
      parserDiagnostics: {
        expectedUnitCount,
        unitsWithLocatedBody,
        minimumTextCoverage,
      },
    };
  },
};

const ADAPTERS: SourceAdapter[] = [xenforoAdapter];

export function adapterFor(url: URL): SourceAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.canHandle(url));
}

export function registerAdapter(adapter: SourceAdapter): void {
  ADAPTERS.unshift(adapter);
}

export interface ParseVerification {
  ok: boolean;
  problems: string[];
  postCount: number;
  blockCount: number;
}

/**
 * Structural sanity check to run before trusting a new site's markup.
 * A citation that opens the wrong post is worse than no citation.
 */
export function verifyParse(parsed: ParsedDocument): ParseVerification {
  const problems: string[] = [];
  const postCount = parsed.content_units.length;
  const blockCount = parsed.content_units.reduce(
    (sum, unit) => sum + unit.blocks.length,
    0,
  );

  if (postCount === 0) problems.push("No posts were parsed — the selector is wrong.");
  if (postCount !== parsed.parserDiagnostics.expectedUnitCount) {
    problems.push(
      `Parsed ${postCount} of ${parsed.parserDiagnostics.expectedUnitCount} source posts.`,
    );
  }
  if (parsed.parserDiagnostics.unitsWithLocatedBody !== postCount) {
    problems.push("At least one post body could not be located reliably.");
  }
  if (parsed.parserDiagnostics.minimumTextCoverage < 0.9) {
    problems.push(
      `At least one post retained only ${Math.round(
        parsed.parserDiagnostics.minimumTextCoverage * 100,
      )}% of its source text.`,
    );
  }
  if (parsed.content_units.filter((unit) => unit.is_primary).length !== 1) {
    problems.push("Exactly one post must be the original post.");
  }
  if (parsed.content_units.some((unit) => !unit.created_at_source)) {
    problems.push("At least one post has no timestamp.");
  }
  if (parsed.content_units.some((unit) => !unit.author_display_name)) {
    problems.push("At least one post has no author.");
  }
  const numbers = parsed.content_units.map((unit) => unit.sequence_number);
  if (new Set(numbers).size !== numbers.length) {
    problems.push("Post numbers are not unique.");
  }

  return { ok: problems.length === 0, problems, postCount, blockCount };
}
