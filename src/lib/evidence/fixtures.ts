import { EXTRACTION_SCHEMA_VERSION } from "./schemas";

/**
 * Structural test fixture.
 *
 * The vehicle details, values and quotes here are INVENTED for testing the
 * pipeline's plumbing. They are not Toyota data and must never be seeded into a
 * corpus. See README "no fabricated Toyota data".
 */
export function sampleExtraction(): Record<string, unknown> {
  return {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    extractor_version: "test-fixture.1",
    source: {
      name: "Example Land Cruiser Forum",
      base_url: "https://forum.example.test",
      source_kind: "forum",
      authority_tier: 6,
    },
    snapshot: {
      canonical_url: "https://forum.example.test/threads/example-thread.1",
      retrieved_url: "https://forum.example.test/threads/example-thread.1",
      retrieved_at: "2026-07-25T12:00:00.000Z",
      http_status: 200,
      content_hash: "fixture-hash",
    },
    document: {
      title: "Placeholder hard-start thread",
      document_kind: "forum_thread",
      canonical_url: "https://forum.example.test/threads/example-thread.1",
      created_at_source: "2026-07-01T09:00:00.000Z",
      language: "en",
    },
    content_units: [
      {
        local_id: "p1",
        unit_kind: "forum_post",
        external_id: "1001",
        sequence_number: 1,
        author_display_name: "owner",
        created_at_source: "2026-07-01T09:00:00.000Z",
        is_primary: true,
        blocks: [
          {
            local_id: "b1",
            block_kind: "paragraph",
            text: "Placeholder vehicle, model code TESTX1, engine code 1HZ. Hard start when cold, fine once warm.",
            raw_locator: { selector: "article[data-content='post-1001']", blockIndex: 0 },
          },
        ],
      },
      {
        local_id: "p2",
        unit_kind: "forum_post",
        external_id: "1002",
        sequence_number: 2,
        author_display_name: "helper",
        created_at_source: "2026-07-02T09:00:00.000Z",
        blocks: [
          {
            local_id: "b2",
            block_kind: "paragraph",
            text: "Measured placeholder pressure at 100 placeholder-units on the test rig, which is below the placeholder limit.",
            raw_locator: { selector: "article[data-content='post-1002']", blockIndex: 0 },
          },
        ],
      },
      {
        local_id: "p3",
        unit_kind: "forum_post",
        external_id: "1003",
        sequence_number: 3,
        author_display_name: "owner",
        created_at_source: "2026-07-20T09:00:00.000Z",
        blocks: [
          {
            local_id: "b3",
            block_kind: "paragraph",
            text: "Replaced the placeholder component and it has started cleanly every morning since.",
            raw_locator: { selector: "article[data-content='post-1003']", blockIndex: 0 },
          },
        ],
      },
    ],
    applicability: [
      {
        local_id: "a1",
        series: ["70"],
        model_codes: ["TESTX1"],
        engine_codes: ["1HZ"],
        markets: ["placeholder-market"],
        year_start: 1995,
        year_end: 2000,
        completeness: "sufficient",
      },
    ],
    vehicle_mentions: [
      {
        local_id: "v1",
        series: "70",
        model_code: "TESTX1",
        production_year: 1997,
        market: "placeholder-market",
        engine_code: "1HZ",
        acsd_configuration: "absent",
        identification_method: "explicit",
        confidence: 0.8,
        source_block_local_ids: ["b1"],
      },
    ],
    repair_cases: [
      {
        local_id: "c1",
        vehicle_local_id: "v1",
        case_title: "Placeholder cold hard start",
        case_status: "resolved",
        complaint_summary: "Hard start when cold, fine once warm.",
        root_cause_summary: "Placeholder component out of tolerance.",
        repair_summary: "Replaced the placeholder component.",
        outcome_summary: "Starts cleanly every morning since.",
        resolution_confidence: 0.7,
        resolution_basis: "author_confirmed",
        opened_unit_local_id: "p1",
        resolution_unit_local_id: "p3",
        followup_days: 18,
      },
    ],
    observations: [
      {
        local_id: "o1",
        repair_case_local_id: "c1",
        observation_kind: "symptom",
        label: "hard start when cold",
        polarity: "present",
        temporality: "before_repair",
        source_block_local_ids: ["b1"],
        extraction_confidence: 0.9,
      },
      {
        local_id: "o2",
        repair_case_local_id: "c1",
        observation_kind: "measurement",
        label: "placeholder pressure",
        value_numeric: 100,
        unit: "placeholder-units",
        polarity: "present",
        temporality: "unknown",
        source_block_local_ids: ["b2"],
        extraction_confidence: 0.8,
      },
    ],
    claims: [
      {
        local_id: "cl1",
        repair_case_local_id: "c1",
        claim_kind: "measurement",
        subject: "placeholder pressure",
        predicate: "measured_at",
        object_text: "100 placeholder-units",
        value_numeric: 100,
        unit: "placeholder-units",
        applicability_local_id: "a1",
        claim_basis: "measured_by_author",
        assertion_strength: "measured",
        source_block_local_ids: ["b2"],
        source_quote: "Measured placeholder pressure at 100 placeholder-units",
        extraction_confidence: 0.85,
      },
      {
        local_id: "cl2",
        repair_case_local_id: "c1",
        claim_kind: "root_cause",
        subject: "placeholder component",
        predicate: "caused",
        object_text: "hard start when cold",
        claim_basis: "outcome_confirmed",
        assertion_strength: "reported",
        source_block_local_ids: ["b3"],
        source_quote: "Replaced the placeholder component",
        extraction_confidence: 0.6,
      },
    ],
    claim_relations: [
      {
        from_claim_local_id: "cl1",
        to_claim_local_id: "cl2",
        relation_kind: "supports",
        source_block_local_ids: ["b2"],
        confidence: 0.6,
      },
    ],
    procedure_fragments: [
      {
        local_id: "pf1",
        repair_case_local_id: "c1",
        title: "Placeholder pressure check",
        procedure_kind: "diagnostic_test",
        applicability_local_id: "a1",
        steps: [
          {
            step_order: 1,
            instruction: "Fit the placeholder test rig.",
            source_block_local_ids: ["b2"],
          },
          {
            step_order: 2,
            instruction: "Record the placeholder pressure reading.",
            expected_result: "A stable reading.",
            specification_claim_local_ids: ["cl1"],
            source_block_local_ids: ["b2"],
          },
        ],
      },
    ],
  };
}

/** Fictional manual fixture proving that one block can support atomic variants. */
export function sampleManualExtraction(): Record<string, unknown> {
  return {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    extractor_version: "manual-test-fixture.2",
    source: {
      name: "Example OEM Technical Manual",
      base_url: "https://manual.example.test",
      source_kind: "oem_technical",
      authority_tier: 3,
    },
    snapshot: {
      canonical_url: "https://manual.example.test/test-procedure.pdf",
      retrieved_url: "https://manual.example.test/test-procedure.pdf",
      retrieved_at: "2026-07-25T12:00:00.000Z",
      http_status: 200,
      content_hash: "manual-fixture-hash",
    },
    document: {
      title: "Example Technical Manual",
      document_kind: "manual",
      canonical_url: "https://manual.example.test/test-procedure.pdf",
      manufacturer: "Example Manufacturer",
      document_number: "TEST-MANUAL-1",
      language: "en",
    },
    content_units: [
      {
        local_id: "page-2",
        unit_kind: "manual_page",
        external_id: "2",
        sequence_number: 2,
        title: "Adjustment specifications",
        is_primary: true,
        blocks: [
          {
            local_id: "manual-block-1",
            block_kind: "specification",
            text: "TEST-ENGINE with CONFIG-A: 0.65-0.71 test-mm. TEST-ENGINE without CONFIG-A: 0.85-0.91 test-mm.",
            raw_locator: { pageNumber: 2, blockIndex: 0 },
          },
        ],
      },
    ],
    applicability: [
      {
        local_id: "app-config-a",
        manufacturers: ["Example Manufacturer"],
        model_names: ["Example Vehicle"],
        engine_codes: ["TEST-ENGINE"],
        acsd_states: ["present"],
        completeness: "partial",
      },
      {
        local_id: "app-no-config-a",
        manufacturers: ["Example Manufacturer"],
        model_names: ["Example Vehicle"],
        engine_codes: ["TEST-ENGINE"],
        acsd_states: ["absent"],
        completeness: "partial",
      },
    ],
    claims: [
      {
        local_id: "manual-claim-present",
        claim_kind: "specification",
        claim_basis: "oem_published",
        subject: "fictional adjustment stroke",
        predicate: "specified_range",
        object_text: "0.65-0.71 test-mm with CONFIG-A",
        value_numeric_min: 0.65,
        value_numeric_max: 0.71,
        unit: "test-mm",
        applicability_local_id: "app-config-a",
        assertion_strength: "quoted",
        source_block_local_ids: ["manual-block-1"],
        source_quote: "TEST-ENGINE with CONFIG-A: 0.65-0.71 test-mm",
        extraction_confidence: 1,
      },
      {
        local_id: "manual-claim-absent",
        claim_kind: "specification",
        claim_basis: "oem_published",
        subject: "fictional adjustment stroke",
        predicate: "specified_range",
        object_text: "0.85-0.91 test-mm without CONFIG-A",
        value_numeric_min: 0.85,
        value_numeric_max: 0.91,
        unit: "test-mm",
        applicability_local_id: "app-no-config-a",
        assertion_strength: "quoted",
        source_block_local_ids: ["manual-block-1"],
        source_quote: "TEST-ENGINE without CONFIG-A: 0.85-0.91 test-mm",
        extraction_confidence: 1,
      },
    ],
  };
}
