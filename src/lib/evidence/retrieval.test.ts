import { describe, expect, it } from "vitest";

import type { Vehicle } from "@/types";

import { sampleExtraction, sampleManualExtraction } from "./fixtures";
import { retrieveEvidence } from "./retrieval";
import { EvidenceStore } from "./store";

const matchingVehicle: Vehicle = {
  id: "veh-test",
  series: "70",
  modelCode: "TESTX1",
  productionYear: 1997,
  market: "placeholder-market",
  engineCode: "1HZ",
  acsdConfiguration: "absent",
  modifications: [],
  identificationConfidence: "user-confirmed",
};

const otherVehicle: Vehicle = {
  ...matchingVehicle,
  id: "veh-other",
  modelCode: "OTHERX9",
  engineCode: "1HD-T",
};

const unknownVehicle: Vehicle = {
  id: "veh-unknown",
  series: "unknown",
  engineCode: "unknown",
  modifications: [],
  identificationConfidence: "unknown",
};

/** Ingests the fixture and clears the review hold, as a human reviewer would. */
function seededStore(): EvidenceStore {
  const store = new EvidenceStore();
  const result = store.ingest(sampleExtraction());
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  store.approveDocument(result.normalized!.documentId, "test-reviewer");
  return store;
}

describe("EvidenceStore.ingest", () => {
  it("produces normalised records, chunks and a quality score", () => {
    const store = new EvidenceStore();
    const result = store.ingest(sampleExtraction());

    expect(result.normalized?.claims).toHaveLength(2);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.quality[0].score).toBeGreaterThan(0);
    expect(result.chunks.every((chunk) => chunk.sourceBlockIds.length > 0)).toBe(true);
  });

  it("is idempotent — the same snapshot yields the same ids", () => {
    const first = new EvidenceStore().ingest(sampleExtraction());
    const second = new EvidenceStore().ingest(sampleExtraction());
    expect(second.chunks.map((chunk) => chunk.id)).toEqual(
      first.chunks.map((chunk) => chunk.id),
    );
  });

  it("holds an exact community value back from retrieval until a human clears it", () => {
    const store = new EvidenceStore();
    const result = store.ingest(sampleExtraction());

    expect(result.heldForReview).toBe(true);
    expect(result.reviewFlags.map((flag) => flag.kind)).toContain(
      "exact_specification_from_community",
    );
    expect(store.activeChunks()).toEqual([]);

    store.approveDocument(result.normalized!.documentId, "test-reviewer");
    expect(store.activeChunks().length).toBeGreaterThan(0);
  });

  it("refuses to store an invalid extraction", () => {
    const broken = sampleExtraction() as Record<string, unknown>;
    broken.content_units = [];
    const store = new EvidenceStore();
    const result = store.ingest(broken);
    expect(result.ok).toBe(false);
    expect(store.activeChunks()).toEqual([]);
  });

  it("keeps excluded forum posts out of active source passages", () => {
    const payload = sampleExtraction() as Record<string, unknown>;
    payload.forum_unit_assessments = [
      {
        content_unit_local_id: "p1",
        source_block_local_ids: ["b1"],
        author_role: "original_poster",
        discourse_roles: ["argument"],
        automotive_relevance: 0.2,
        thread_topic_relevance: 0.1,
        constructiveness: 0,
        helpfulness: 0,
        evidence_strength: "none",
        sentiment: "negative",
        retrieval_disposition: "exclude",
        disposition_reasons: ["argument_without_evidence"],
        extraction_confidence: 0.9,
      },
    ];
    const result = new EvidenceStore().ingest(payload);
    expect(result.ok).toBe(true);
    const unitId = result.normalized?.contentUnits.find(
      (entry) => entry.externalId === "1001",
    )?.id;
    expect(
      result.chunks.find(
        (entry) => entry.chunkKind === "source_passage" && entry.contentUnitId === unitId,
      )?.active,
    ).toBe(false);
  });

  it("keeps independently applicable manual ranges as atomic claims", () => {
    const result = new EvidenceStore().ingest(sampleManualExtraction());
    expect(result.ok).toBe(true);
    expect(result.normalized?.claims).toHaveLength(2);
    expect(result.normalized?.claims.map((claim) => claim.applicabilityId)).toHaveLength(
      2,
    );
    expect(new Set(result.normalized?.claims.map((claim) => claim.applicabilityId)).size)
      .toBe(2);
    expect(result.heldForReview).toBe(false);
  });
});

describe("retrieveEvidence", () => {
  it("puts applicable manual evidence in the OEM channel", () => {
    const store = new EvidenceStore();
    const ingested = store.ingest(sampleManualExtraction());
    expect(ingested.ok).toBe(true);
    const result = retrieveEvidence(
      {
        vehicle: {
          id: "manual-vehicle",
          manufacturer: "Example Manufacturer",
          modelName: "Example Vehicle",
          series: "TEST",
          engineCode: "TEST-ENGINE",
          acsdConfiguration: "present",
          modifications: [],
          identificationConfidence: "user-confirmed",
        },
        keywords: ["adjustment stroke"],
      },
      store,
    );
    expect(result.oem.length).toBeGreaterThan(0);
    expect(result.community).toEqual([]);
  });

  it("keeps community material out of the OEM channel", () => {
    const store = seededStore();
    const result = retrieveEvidence(
      { vehicle: matchingVehicle, keywords: ["placeholder pressure"] },
      store,
    );

    expect(result.oem).toEqual([]);
    expect(result.community.length).toBeGreaterThan(0);
    expect(result.community.every((entry) => entry.chunk.authorityTier > 3)).toBe(true);
  });

  it("excludes evidence that contradicts the vehicle", () => {
    const store = seededStore();
    const result = retrieveEvidence(
      { vehicle: otherVehicle, keywords: ["placeholder pressure"] },
      store,
    );
    expect(
      result.community.some((entry) => entry.chunk.chunkKind === "specification"),
    ).toBe(false);
  });

  it("marks applicability as unresolved when the vehicle is not identified", () => {
    const store = seededStore();
    const result = retrieveEvidence(
      { vehicle: unknownVehicle, keywords: ["placeholder pressure"] },
      store,
    );
    const spec = result.community.find(
      (entry) => entry.chunk.chunkKind === "specification",
    );
    expect(spec?.applicability.verdict).toBe("unresolved");
    expect(spec?.applicability.unresolvedFields.length).toBeGreaterThan(0);
  });

  it("returns nothing when no keyword matches", () => {
    const store = seededStore();
    const result = retrieveEvidence(
      { vehicle: matchingVehicle, keywords: ["completely-unrelated-term"] },
      store,
    );
    expect(result.empty).toBe(true);
  });

  it("carries a citation url and label on every result", () => {
    const store = seededStore();
    const result = retrieveEvidence(
      { vehicle: matchingVehicle, keywords: ["placeholder"] },
      store,
    );
    expect(result.community.length).toBeGreaterThan(0);
    for (const entry of result.community) {
      expect(entry.chunk.citationUrl).toMatch(/^https:\/\//);
      expect(entry.chunk.citationLabel.length).toBeGreaterThan(0);
    }
  });
});
