import { describe, expect, it } from "vitest";

import {
  canonicalizeCrawlUrl,
  crawlSourceSchema,
  discoverThreadUrls,
  robotsAllows,
} from "./crawler";

const source = crawlSourceSchema.parse({
  name: "Example forum",
  base_url: "https://forum.example.test",
  terms_review_status: "approved",
  robots_reviewed_at: "2026-07-26T00:00:00.000Z",
  active: true,
});

describe("forum crawler controls", () => {
  it("canonicalizes in-scope URLs and strips tracking", () => {
    expect(
      canonicalizeCrawlUrl(
        "https://forum.example.test/threads/pump.123/?utm_source=x&page=2#post-4",
        source,
      ),
    ).toBe("https://forum.example.test/threads/pump.123/?page=2");
  });

  it("rejects cross-host and out-of-scope targets", () => {
    expect(() =>
      canonicalizeCrawlUrl("https://other.example/threads/x.1", source),
    ).toThrow(/Cross-host/);
    expect(() =>
      canonicalizeCrawlUrl("https://forum.example.test/account/", source),
    ).toThrow(/allow-list/);
  });

  it("uses longest robots match and lets allow win a tie", () => {
    const body = `
      User-agent: *
      Disallow: /threads/private/
      Allow: /threads/private/public$
    `;
    expect(
      robotsAllows(body, "CruiserCopilotBot/0.1", "https://forum.example.test/threads/private/x"),
    ).toBe(false);
    expect(
      robotsAllows(
        body,
        "CruiserCopilotBot/0.1",
        "https://forum.example.test/threads/private/public",
      ),
    ).toBe(true);
  });

  it("discovers only allowed same-host thread links", () => {
    const html = `
      <a href="/threads/one.1/?utm_medium=email">one</a>
      <a href="https://other.example/threads/two.2">two</a>
      <a href="/account/">account</a>
    `;
    expect(discoverThreadUrls(html, source.base_url, source)).toEqual([
      "https://forum.example.test/threads/one.1/",
    ]);
  });
});
