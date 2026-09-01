import { describe, expect, it } from "vitest";

import { sampleExtraction } from "./fixtures";
import { validateExtraction } from "./validate";

/** Loose view of the fixture so tests can break one rule at a time. */
interface MutableFixture {
  claims: Array<Record<string, unknown>>;
  repair_cases: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function withPayload(mutate: (payload: MutableFixture) => void): Record<string, unknown> {
  const payload = sampleExtraction() as unknown as MutableFixture;
  mutate(payload);
  return payload as unknown as Record<string, unknown>;
}

const codes = (issues: Array<{ code: string }>): string[] =>
  issues.map((issue) => issue.code);

describe("validateExtraction", () => {
  it("accepts a structurally complete extraction", () => {
    const result = validateExtraction(sampleExtraction());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a claim whose quote is not in the cited block", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].source_quote = "a sentence nobody in this thread wrote";
      }),
    );
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain("quote_not_in_source");
  });

  it("rejects a numeric value with no unit", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].unit = null;
      }),
    );
    expect(codes(result.errors)).toContain("numeric_without_unit");
  });

  it("rejects a range with only one endpoint", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].value_numeric = null;
        payload.claims[0].value_numeric_min = 10;
      }),
    );
    expect(codes(result.errors)).toContain("incomplete_numeric_range");
  });

  it("rejects an exact value with no usable applicability", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].applicability_local_id = null;
      }),
    );
    expect(codes(result.errors)).toContain("specification_without_applicability");
  });

  it("allows a missing applicability when it is explicitly flagged for review", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].applicability_local_id = null;
        payload.review_flags = [
          {
            kind: "missing_applicability",
            message: "No applicability stated for the measurement.",
            related_local_ids: ["cl1"],
            severity: 2,
          },
        ];
      }),
    );
    expect(codes(result.errors)).not.toContain("specification_without_applicability");
  });

  it("rejects normalisation that discards the original value", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].value_numeric = null;
        payload.claims[0].unit = null;
        payload.claims[0].normalized_value = 7;
        payload.claims[0].normalized_unit = "placeholder-si";
      }),
    );
    expect(codes(result.errors)).toContain("normalization_overwrites_original");
  });

  it("rejects a resolution that points at no post", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.repair_cases[0].resolution_unit_local_id = null;
      }),
    );
    expect(codes(result.errors)).toContain("resolution_without_post");
  });

  it("rejects a confirmed root cause with no author confirmation", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[1].assertion_strength = "confirmed";
        payload.repair_cases[0].resolution_basis = "community_consensus";
        payload.repair_cases[0].case_status = "unresolved";
      }),
    );
    expect(codes(result.errors)).toContain("unsupported_confirmed_root_cause");
  });

  it("rejects an orphaned block reference", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.claims[0].source_block_local_ids = ["does-not-exist"];
      }),
    );
    expect(codes(result.errors)).toContain("orphan_block_ref");
  });

  it("rejects a forum assessment that cites the wrong structure", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.forum_unit_assessments = [
          {
            content_unit_local_id: "does-not-exist",
            source_block_local_ids: ["b1"],
            discourse_roles: ["problem_report"],
            automotive_relevance: 1,
            thread_topic_relevance: 1,
            constructiveness: 0.8,
            helpfulness: 0.8,
            evidence_strength: "anecdotal",
            sentiment: "neutral",
            retrieval_disposition: "include",
            extraction_confidence: 0.9,
          },
        ];
      }),
    );
    expect(codes(result.errors)).toContain("orphan_ref");
  });

  it("requires thread assessment counts to match assessed posts", () => {
    const result = validateExtraction(
      withPayload((payload) => {
        payload.forum_unit_assessments = [];
        payload.forum_thread_assessment = {
          thread_kind: "repair_case",
          automotive_relevance: 1,
          target_vehicle_confidence: 0.8,
          off_topic_ratio: 0,
          argument_ratio: 0,
          constructive_ratio: 1,
          evidence_density: 0.8,
          outcome_signal: "confirmed_resolution",
          retrieval_disposition: "include",
          assessed_unit_count: 3,
          extraction_confidence: 0.9,
        };
      }),
    );
    expect(codes(result.errors)).toContain("forum_assessment_count_mismatch");
  });
});
