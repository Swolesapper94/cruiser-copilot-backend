import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceCatalog } from "./catalog";
import { sampleExtraction } from "./fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("EvidenceCatalog", () => {
  it("restores reviewed evidence after a restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cruiser-evidence-store-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "evidence.json");
    const first = new EvidenceCatalog(filePath);

    const ingested = await first.ingest(sampleExtraction());
    expect(ingested.ok).toBe(true);
    expect(first.store.activeChunks()).toEqual([]);
    expect(await first.approve(ingested.normalized!.documentId, "test-reviewer")).toBe(
      true,
    );
    expect(first.store.activeChunks().length).toBeGreaterThan(0);

    const restarted = new EvidenceCatalog(filePath);
    expect(restarted.store.activeChunks().length).toBeGreaterThan(0);
    expect(restarted.store.openReviewFlags()).toEqual([]);
  });
});
