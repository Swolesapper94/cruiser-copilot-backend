#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import {
  hashBody,
  adapterFor,
  verifyParse,
  type RawSnapshot,
  type SourcePolicy,
} from "@/lib/evidence/adapters";
import { EvidenceStore } from "@/lib/evidence/store";

/**
 * Offline evidence CLI. Reads local files only — it never fetches anything.
 *
 *   npm run evidence -- validate ./extraction.json
 *   npm run evidence -- parse ./snapshot.html https://forum.example/threads/x.1
 */

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function validateCommand(path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const store = new EvidenceStore();
  const result = store.ingest(JSON.parse(raw));

  for (const issue of result.errors) {
    process.stdout.write(`ERROR  [${issue.code}] ${issue.message}\n`);
  }
  for (const issue of result.warnings) {
    process.stdout.write(`WARN   [${issue.code}] ${issue.message}\n`);
  }
  for (const flag of result.reviewFlags) {
    process.stdout.write(`REVIEW (sev ${flag.severity}) ${flag.kind}: ${flag.message}\n`);
  }
  for (const entry of result.quality) {
    process.stdout.write(
      `QUALITY ${entry.caseLocalId} score=${entry.score}${entry.gaps.length ? ` gaps: ${entry.gaps.join("; ")}` : ""}\n`,
    );
  }

  if (!result.ok) fail("\nExtraction rejected. Nothing was stored.");

  process.stdout.write(
    `\nOK. ${result.chunks.length} retrieval chunks. ${
      result.heldForReview
        ? "HELD for human review — not retrievable until approved."
        : "Publishable."
    }\n`,
  );
}

async function parseCommand(path: string, url: string): Promise<void> {
  const body = await readFile(path, "utf8");
  const adapter = adapterFor(new URL(url));
  if (!adapter) fail(`No adapter handles ${url}`);

  const snapshot: RawSnapshot = {
    canonicalUrl: url,
    retrievedUrl: url,
    retrievedAt: new Date().toISOString(),
    httpStatus: 200,
    contentType: "text/html",
    contentHash: hashBody(body),
    body,
  };

  const policy: SourcePolicy = {
    name: new URL(url).hostname,
    baseUrl: new URL(url).origin,
    sourceKind: "forum",
    authorityTier: 6,
    termsReviewStatus: "pending",
    requestDelayMs: 5000,
    active: false,
  };

  const parsed = adapter.parse(snapshot, policy);
  const verification = verifyParse(parsed);

  process.stdout.write(
    `adapter=${adapter.id} units=${verification.postCount} blocks=${verification.blockCount} min_text_coverage=${Math.round(
      parsed.parserDiagnostics.minimumTextCoverage * 100,
    )}%\n`,
  );
  for (const problem of verification.problems) {
    process.stdout.write(`PROBLEM ${problem}\n`);
  }
  if (!verification.ok) fail("\nParse verification failed. Do not trust citations.");
  process.stdout.write("\nParse verified.\n");
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "validate":
    if (!args[0]) fail("usage: evidence validate <extraction.json>");
    await validateCommand(args[0]);
    break;
  case "parse":
    if (!args[0] || !args[1]) fail("usage: evidence parse <snapshot.html> <canonical-url>");
    await parseCommand(args[0], args[1]);
    break;
  default:
    fail("usage: evidence <validate|parse> ...");
}
