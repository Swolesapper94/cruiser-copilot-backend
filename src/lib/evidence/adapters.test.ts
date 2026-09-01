import { describe, expect, it } from "vitest";

import {
  adapterFor,
  assertFetchAllowed,
  hashBody,
  IngestionNotPermittedError,
  verifyParse,
  xenforoAdapter,
  type RawSnapshot,
  type SourcePolicy,
} from "./adapters";

const policy: SourcePolicy = {
  name: "Example Forum",
  baseUrl: "https://forum.example.test",
  sourceKind: "forum",
  authorityTier: 6,
  termsReviewStatus: "approved",
  robotsReviewedAt: "2026-07-01T00:00:00.000Z",
  requestDelayMs: 5000,
  active: true,
};

const html = `
<html><head><title>Placeholder thread title</title></head><body>
<article class="message" data-author="owner" data-content="post-1001">
  <time datetime="2026-07-01T09:00:00Z"></time>
  <a href="#post-1001">#1</a>
  <div class="bbWrapper">First paragraph here.<br><br>Second paragraph here.</div>
</article>
<article class="message" data-author="helper" data-content="post-1002">
  <time datetime="2026-07-02T09:00:00Z"></time>
  <a href="#post-1002">#2</a>
  <div class="bbWrapper"><blockquote>owner said: First paragraph here.</blockquote>Try the placeholder test. <img src="/img/a.jpg"></div>
</article>
</body></html>`;

const snapshot: RawSnapshot = {
  canonicalUrl: "https://forum.example.test/threads/example.1",
  retrievedUrl: "https://forum.example.test/threads/example.1",
  retrievedAt: "2026-07-25T12:00:00.000Z",
  httpStatus: 200,
  contentType: "text/html",
  contentHash: hashBody(html),
  body: html,
};

describe("assertFetchAllowed", () => {
  it("blocks fetching when ingestion is disabled", () => {
    expect(() => assertFetchAllowed(policy, false)).toThrow(IngestionNotPermittedError);
  });

  it("blocks fetching a source whose terms have not been approved", () => {
    expect(() =>
      assertFetchAllowed({ ...policy, termsReviewStatus: "pending" }, true),
    ).toThrow(IngestionNotPermittedError);
  });

  it("blocks fetching a source with no recorded robots review", () => {
    expect(() =>
      assertFetchAllowed({ ...policy, robotsReviewedAt: undefined }, true),
    ).toThrow(IngestionNotPermittedError);
  });

  it("allows an approved, reviewed, active source", () => {
    expect(() => assertFetchAllowed(policy, true)).not.toThrow();
  });
});

describe("xenforoAdapter", () => {
  it("is selected for thread urls", () => {
    expect(adapterFor(new URL(snapshot.canonicalUrl))).toBe(xenforoAdapter);
  });

  it("establishes post boundaries, authors and timestamps without a model", () => {
    const parsed = xenforoAdapter.parse(snapshot, policy);

    expect(parsed.content_units).toHaveLength(2);
    expect(parsed.content_units[0].author_display_name).toBe("owner");
    expect(parsed.content_units[0].is_primary).toBe(true);
    expect(parsed.content_units[1].is_primary).toBe(false);
    expect(parsed.content_units[0].created_at_source).toBe("2026-07-01T09:00:00Z");
    expect(parsed.document.title).toBe("Placeholder thread title");
  });

  it("keeps a quoted passage as its own block", () => {
    const parsed = xenforoAdapter.parse(snapshot, policy);
    const kinds = parsed.content_units[1].blocks.map((block) => block.block_kind);
    expect(kinds).toContain("quote");
    expect(
      parsed.content_units[1].blocks.some((block) =>
        block.text.includes("Try the placeholder test"),
      ),
    ).toBe(true);
  });

  it("records media by reference only", () => {
    const parsed = xenforoAdapter.parse(snapshot, policy);
    expect(parsed.media).toHaveLength(1);
    expect(parsed.media[0].source_url).toBe("https://forum.example.test/img/a.jpg");
    expect(parsed.media[0].rights_status).toBe("unknown");
  });

  it("passes structural verification", () => {
    expect(verifyParse(xenforoAdapter.parse(snapshot, policy))).toMatchObject({
      ok: true,
      postCount: 2,
    });
  });

  it("reports a failed parse instead of returning silent garbage", () => {
    const empty = verifyParse(
      xenforoAdapter.parse({ ...snapshot, body: "<html><body>nope</body></html>" }, policy),
    );
    expect(empty.ok).toBe(false);
    expect(empty.problems.length).toBeGreaterThan(0);
  });

  it("fails completeness verification when source text was silently dropped", () => {
    const parsed = xenforoAdapter.parse(snapshot, policy);
    parsed.parserDiagnostics.minimumTextCoverage = 0.5;
    const verification = verifyParse(parsed);
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(" ")).toContain("50%");
  });
});
