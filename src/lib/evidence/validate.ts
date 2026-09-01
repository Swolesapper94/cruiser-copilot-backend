import { extractionPayloadSchema, type ExtractionPayload } from "./schemas";

/**
 * Deterministic validation of an extraction payload.
 *
 * Nothing is persisted until this passes. The rules here are the ones that a
 * schema alone cannot express: reference integrity, "cite your source", unit
 * preservation, and the applicability rules that stop a forum number from
 * looking like a Toyota specification.
 */

export type EvidenceIssueSeverity = "error" | "warning";

export interface EvidenceIssue {
  severity: EvidenceIssueSeverity;
  code: string;
  message: string;
  /** local_id values (or JSON paths) the issue refers to. */
  path: string[];
}

export interface ExtractionValidationResult {
  ok: boolean;
  payload?: ExtractionPayload;
  errors: EvidenceIssue[];
  warnings: EvidenceIssue[];
}

function error(code: string, message: string, path: string[]): EvidenceIssue {
  return { severity: "error", code, message, path };
}

function warning(code: string, message: string, path: string[]): EvidenceIssue {
  return { severity: "warning", code, message, path };
}

/** Numeric claim kinds that are dangerous without settled applicability. */
const EXACT_VALUE_CLAIM_KINDS = new Set(["specification", "measurement"]);

function collectDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return [...duplicates].sort();
}

export function validateExtraction(input: unknown): ExtractionValidationResult {
  const parsed = extractionPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        error("schema", issue.message, issue.path.map(String)),
      ),
      warnings: [],
    };
  }

  const payload = parsed.data;
  const errors: EvidenceIssue[] = [];
  const warnings: EvidenceIssue[] = [];

  /* ---------------- identifier uniqueness ---------------- */

  const unitIds = payload.content_units.map((unit) => unit.local_id);
  const blockIds = payload.content_units.flatMap((unit) =>
    unit.blocks.map((block) => block.local_id),
  );
  const applicabilityIds = payload.applicability.map((entry) => entry.local_id);
  const vehicleIds = payload.vehicle_mentions.map((entry) => entry.local_id);
  const caseIds = payload.repair_cases.map((entry) => entry.local_id);
  const claimIds = payload.claims.map((entry) => entry.local_id);
  const mediaIds = payload.media.map((entry) => entry.local_id);

  const uniquenessChecks: Array<[string, string[]]> = [
    ["content_units", unitIds],
    ["blocks", blockIds],
    ["applicability", applicabilityIds],
    ["vehicle_mentions", vehicleIds],
    ["repair_cases", caseIds],
    ["claims", claimIds],
    ["media", mediaIds],
    ["observations", payload.observations.map((entry) => entry.local_id)],
    ["procedure_fragments", payload.procedure_fragments.map((entry) => entry.local_id)],
  ];

  for (const [collection, ids] of uniquenessChecks) {
    const duplicates = collectDuplicates(ids);
    if (duplicates.length > 0) {
      errors.push(
        error(
          "duplicate_local_id",
          `${collection} contains duplicate local_id values: ${duplicates.join(", ")}`,
          duplicates,
        ),
      );
    }
  }

  const blockSet = new Set(blockIds);
  const unitSet = new Set(unitIds);
  const applicabilitySet = new Set(applicabilityIds);
  const vehicleSet = new Set(vehicleIds);
  const caseSet = new Set(caseIds);
  const claimSet = new Set(claimIds);
  const mediaSet = new Set(mediaIds);

  const blockById = new Map(
    payload.content_units.flatMap((unit) =>
      unit.blocks.map((block) => [block.local_id, { unit, block }] as const),
    ),
  );

  /* ---------------- reference integrity ---------------- */

  const requireBlocks = (ids: readonly string[], owner: string): void => {
    if (ids.length === 0) {
      errors.push(
        error("missing_citation", `${owner} does not cite any source block.`, [owner]),
      );
      return;
    }
    for (const id of ids) {
      if (!blockSet.has(id)) {
        errors.push(
          error("orphan_block_ref", `${owner} cites unknown block ${id}.`, [owner, id]),
        );
      }
    }
  };

  const requireRef = (
    id: string | null | undefined,
    set: ReadonlySet<string>,
    owner: string,
    label: string,
  ): void => {
    if (id === null || id === undefined) return;
    if (!set.has(id)) {
      errors.push(
        error("orphan_ref", `${owner} references unknown ${label} ${id}.`, [owner, id]),
      );
    }
  };

  for (const unit of payload.content_units) {
    requireRef(unit.parent_unit_local_id, unitSet, unit.local_id, "parent unit");
    for (const block of unit.blocks) {
      requireRef(block.quoted_unit_local_id, unitSet, block.local_id, "unit");
    }
  }

  for (const asset of payload.media) {
    requireRef(asset.content_unit_local_id, unitSet, asset.local_id, "unit");
  }

  for (const mention of payload.vehicle_mentions) {
    requireBlocks(mention.source_block_local_ids, mention.local_id);
  }

  for (const repairCase of payload.repair_cases) {
    requireRef(repairCase.vehicle_local_id, vehicleSet, repairCase.local_id, "vehicle");
    requireRef(repairCase.opened_unit_local_id, unitSet, repairCase.local_id, "unit");
    requireRef(
      repairCase.resolution_unit_local_id,
      unitSet,
      repairCase.local_id,
      "resolution unit",
    );
  }

  for (const observation of payload.observations) {
    requireBlocks(observation.source_block_local_ids, observation.local_id);
    requireRef(
      observation.repair_case_local_id,
      caseSet,
      observation.local_id,
      "repair case",
    );
    if (observation.value_numeric !== null && observation.value_numeric !== undefined) {
      if (!observation.unit) {
        errors.push(
          error(
            "numeric_without_unit",
            `Observation ${observation.local_id} has a numeric value but no unit. A number without its unit is not evidence.`,
            [observation.local_id],
          ),
        );
      }
    }
  }

  for (const claim of payload.claims) {
    requireBlocks(claim.source_block_local_ids, claim.local_id);
    requireRef(claim.repair_case_local_id, caseSet, claim.local_id, "repair case");
    requireRef(
      claim.applicability_local_id,
      applicabilitySet,
      claim.local_id,
      "applicability",
    );

    if (
      payload.source.authority_tier >= 4 &&
      claim.claim_basis === "oem_published"
    ) {
      errors.push(
        error(
          "invalid_claim_basis",
          `Community claim ${claim.local_id} cannot declare itself OEM-published. Use unattributed_quote unless the OEM document is ingested independently.`,
          [claim.local_id],
        ),
      );
    }

    if (claim.claim_basis === "outcome_confirmed") {
      const owningCase = payload.repair_cases.find(
        (entry) => entry.local_id === claim.repair_case_local_id,
      );
      if (
        !owningCase ||
        owningCase.resolution_basis !== "author_confirmed" ||
        !owningCase.resolution_unit_local_id
      ) {
        errors.push(
          error(
            "unsupported_outcome_confirmation",
            `Claim ${claim.local_id} says the outcome was confirmed but has no author-confirmed case resolution.`,
            [claim.local_id],
          ),
        );
      }
    }

    const hasNumber =
      claim.value_numeric !== null && claim.value_numeric !== undefined;
    const hasRange =
      claim.value_numeric_min !== null &&
      claim.value_numeric_min !== undefined &&
      claim.value_numeric_max !== null &&
      claim.value_numeric_max !== undefined;
    const hasAnyRangeEndpoint =
      (claim.value_numeric_min !== null && claim.value_numeric_min !== undefined) ||
      (claim.value_numeric_max !== null && claim.value_numeric_max !== undefined);

    if (hasAnyRangeEndpoint && !hasRange) {
      errors.push(
        error(
          "incomplete_numeric_range",
          `Claim ${claim.local_id} must preserve both ends of a numeric range.`,
          [claim.local_id],
        ),
      );
    }
    if (
      hasRange &&
      (claim.value_numeric_min as number) > (claim.value_numeric_max as number)
    ) {
      errors.push(
        error(
          "invalid_numeric_range",
          `Claim ${claim.local_id} has a minimum greater than its maximum.`,
          [claim.local_id],
        ),
      );
    }

    if ((hasNumber || hasRange) && !claim.unit) {
      errors.push(
        error(
          "numeric_without_unit",
          `Claim ${claim.local_id} has a numeric value but no verbatim unit.`,
          [claim.local_id],
        ),
      );
    }

    const hasNormalized =
      claim.normalized_value !== null && claim.normalized_value !== undefined;
    if (hasNormalized && (!hasNumber || !claim.normalized_unit)) {
      errors.push(
        error(
          "normalization_overwrites_original",
          `Claim ${claim.local_id} carries a normalized value without preserving the original value and unit.`,
          [claim.local_id],
        ),
      );
    }
    if (hasNormalized && claim.normalized_unit !== claim.unit) {
      warnings.push(
        warning(
          "unit_normalization",
          `Claim ${claim.local_id} was normalised from "${claim.unit}" to "${claim.normalized_unit}". A human must confirm the scale did not change.`,
          [claim.local_id],
        ),
      );
    }

    // An exact value with no applicability is unusable and dangerous.
    if ((hasNumber || hasRange) && EXACT_VALUE_CLAIM_KINDS.has(claim.claim_kind)) {
      const applicability = payload.applicability.find(
        (entry) => entry.local_id === claim.applicability_local_id,
      );
      if (!applicability || applicability.completeness === "unknown") {
        const flagged = payload.review_flags.some(
          (flag) =>
            flag.kind === "missing_applicability" &&
            flag.related_local_ids.includes(claim.local_id),
        );
        if (!flagged) {
          errors.push(
            error(
              "specification_without_applicability",
              `Claim ${claim.local_id} states an exact value but has no usable applicability record and no missing_applicability review flag.`,
              [claim.local_id],
            ),
          );
        }
      }
    }

    // The source quote must actually appear in one of the cited blocks.
    const quoteFound = claim.source_block_local_ids.some((id) => {
      const entry = blockById.get(id);
      if (!entry) return false;
      return normalizeForCompare(entry.block.text).includes(
        normalizeForCompare(claim.source_quote),
      );
    });
    if (!quoteFound) {
      errors.push(
        error(
          "quote_not_in_source",
          `Claim ${claim.local_id}: source_quote does not appear in any cited block. Summaries may not introduce text that is not in the source.`,
          [claim.local_id],
        ),
      );
    }

    if (claim.claim_kind === "root_cause" && claim.assertion_strength === "confirmed") {
      const owningCase = payload.repair_cases.find(
        (entry) => entry.local_id === claim.repair_case_local_id,
      );
      if (
        !owningCase ||
        owningCase.resolution_basis !== "author_confirmed" ||
        !owningCase.resolution_unit_local_id
      ) {
        errors.push(
          error(
            "unsupported_confirmed_root_cause",
            `Claim ${claim.local_id} is a confirmed root cause but its case has no author-confirmed resolution unit.`,
            [claim.local_id],
          ),
        );
      }
    }
  }

  for (const relation of payload.claim_relations) {
    requireBlocks(relation.source_block_local_ids, "claim_relation");
    requireRef(relation.from_claim_local_id, claimSet, "claim_relation", "claim");
    requireRef(relation.to_claim_local_id, claimSet, "claim_relation", "claim");
    if (relation.from_claim_local_id === relation.to_claim_local_id) {
      errors.push(
        error("reflexive_relation", "A claim cannot relate to itself.", [
          relation.from_claim_local_id,
        ]),
      );
    }
  }

  for (const fragment of payload.procedure_fragments) {
    requireRef(fragment.repair_case_local_id, caseSet, fragment.local_id, "repair case");
    requireRef(
      fragment.applicability_local_id,
      applicabilitySet,
      fragment.local_id,
      "applicability",
    );

    const orders = fragment.steps.map((step) => step.step_order);
    if (collectDuplicates(orders.map(String)).length > 0) {
      errors.push(
        error(
          "duplicate_step_order",
          `Procedure ${fragment.local_id} has duplicate step_order values.`,
          [fragment.local_id],
        ),
      );
    }

    for (const step of fragment.steps) {
      const owner = `${fragment.local_id}#${step.step_order}`;
      requireBlocks(step.source_block_local_ids, owner);
      for (const id of step.tool_claim_local_ids) requireRef(id, claimSet, owner, "claim");
      for (const id of step.specification_claim_local_ids) {
        requireRef(id, claimSet, owner, "claim");
      }
      for (const id of step.media_local_ids) requireRef(id, mediaSet, owner, "media");
    }
  }

  for (const assessment of payload.forum_unit_assessments) {
    requireRef(
      assessment.content_unit_local_id,
      unitSet,
      "forum_unit_assessment",
      "content unit",
    );
    requireBlocks(assessment.source_block_local_ids, "forum_unit_assessment");
    for (const id of assessment.vehicle_local_ids) {
      requireRef(id, vehicleSet, "forum_unit_assessment", "vehicle");
    }
    for (const id of assessment.claim_local_ids) {
      requireRef(id, claimSet, "forum_unit_assessment", "claim");
    }
  }

  if (
    payload.forum_thread_assessment &&
    payload.forum_thread_assessment.assessed_unit_count !==
      payload.forum_unit_assessments.length
  ) {
    errors.push(
      error(
        "forum_assessment_count_mismatch",
        "Thread assessed_unit_count must match the number of forum unit assessments.",
        ["forum_thread_assessment", "assessed_unit_count"],
      ),
    );
  }

  /* ---------------- case-level integrity ---------------- */

  for (const repairCase of payload.repair_cases) {
    const resolvedStatus =
      repairCase.case_status === "resolved" ||
      repairCase.case_status === "partially_resolved";

    if (resolvedStatus && !repairCase.resolution_unit_local_id) {
      errors.push(
        error(
          "resolution_without_post",
          `Case ${repairCase.local_id} claims a resolution but points at no unit. The last unit containing a suggestion is not a resolution.`,
          [repairCase.local_id],
        ),
      );
    }
    if (resolvedStatus && repairCase.resolution_basis === "none") {
      errors.push(
        error(
          "resolution_without_basis",
          `Case ${repairCase.local_id} claims a resolution with resolution_basis "none".`,
          [repairCase.local_id],
        ),
      );
    }
    if (repairCase.root_cause_summary) {
      const hasRootCauseClaim = payload.claims.some(
        (claim) =>
          claim.claim_kind === "root_cause" &&
          claim.repair_case_local_id === repairCase.local_id,
      );
      if (!hasRootCauseClaim) {
        errors.push(
          error(
            "summary_without_claim",
            `Case ${repairCase.local_id} has a root_cause_summary but no root_cause claim citing a source block.`,
            [repairCase.local_id],
          ),
        );
      }
    }
    if (!repairCase.vehicle_local_id) {
      warnings.push(
        warning(
          "case_without_vehicle",
          `Case ${repairCase.local_id} has no vehicle mention. It can be retrieved as context only.`,
          [repairCase.local_id],
        ),
      );
    }
  }

  /* ---------------- unused structure ---------------- */

  const citedBlocks = new Set<string>([
    ...payload.vehicle_mentions.flatMap((entry) => entry.source_block_local_ids),
    ...payload.observations.flatMap((entry) => entry.source_block_local_ids),
    ...payload.claims.flatMap((entry) => entry.source_block_local_ids),
  ]);
  const uncited = blockIds.filter((id) => !citedBlocks.has(id));
  if (uncited.length === blockIds.length && blockIds.length > 0) {
    warnings.push(
      warning(
        "nothing_extracted",
        "No block in this document is cited by any extracted record.",
        [],
      ),
    );
  }

  return {
    ok: errors.length === 0,
    payload: errors.length === 0 ? payload : undefined,
    errors,
    warnings,
  };
}

/** Whitespace- and case-insensitive comparison. Punctuation is preserved. */
function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
