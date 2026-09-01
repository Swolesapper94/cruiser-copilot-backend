import type { ExtractionPayload, ReviewFlagKind } from "./schemas";

/**
 * Deterministic review triggers.
 *
 * These are computed from the payload, not asked of the model. An extractor
 * that "forgets" to raise a flag cannot get material past this gate.
 */

export interface ReviewFlag {
  kind: ReviewFlagKind;
  /** 1 = blocks publication, 2 = must be reviewed, 3 = informational. */
  severity: 1 | 2 | 3;
  message: string;
  relatedLocalIds: string[];
}

export interface ClaimConflict {
  subject: string;
  claimLocalIds: string[];
  distinctValues: string[];
  /** Applicability fields nobody in the group has pinned down. */
  missingApplicabilityFields: string[];
}

/** Subjects where an exact number is a safety- or engine-critical figure. */
const EXACT_VALUE_SUBJECT_PATTERN =
  /\b(torque|timing|clearance|tolerance|pressure|preload|lash|gap|shim|end ?float|backlash)\b/i;

const APPLICABILITY_FIELDS = [
  "market",
  "productionYear",
  "pumpModel",
  "acsdConfiguration",
] as const;

const COMMUNITY_AUTHORITY_TIER = 4;

function isCommunity(payload: ExtractionPayload): boolean {
  return payload.source.authority_tier >= COMMUNITY_AUTHORITY_TIER;
}

/** Groups claims that state different values for the same subject. */
export function detectClaimConflicts(payload: ExtractionPayload): ClaimConflict[] {
  const bySubject = new Map<string, typeof payload.claims>();

  for (const claim of payload.claims) {
    const hasScalar = claim.value_numeric !== null && claim.value_numeric !== undefined;
    const hasRange =
      claim.value_numeric_min !== null &&
      claim.value_numeric_min !== undefined &&
      claim.value_numeric_max !== null &&
      claim.value_numeric_max !== undefined;
    if (!hasScalar && !hasRange) continue;
    // Different values with explicitly different applicability are variants,
    // not contradictions (for example ACSD present versus absent).
    const key = `${claim.subject.trim().toLowerCase()}::${
      claim.applicability_local_id ?? "unscoped"
    }`;
    const bucket = bySubject.get(key);
    if (bucket) bucket.push(claim);
    else bySubject.set(key, [claim]);
  }

  const conflicts: ClaimConflict[] = [];

  for (const [groupKey, claims] of bySubject) {
    const subject = groupKey.split("::", 1)[0];
    const values = new Set(
      claims.map((claim) => {
        const value =
          claim.value_numeric !== null && claim.value_numeric !== undefined
            ? String(claim.value_numeric)
            : `${claim.value_numeric_min}-${claim.value_numeric_max}`;
        return `${value} ${claim.unit}`;
      }),
    );
    if (values.size < 2) continue;

    const missing = new Set<string>();
    for (const claim of claims) {
      const applicability = payload.applicability.find(
        (entry) => entry.local_id === claim.applicability_local_id,
      );
      if (!applicability) {
        for (const field of APPLICABILITY_FIELDS) missing.add(field);
        continue;
      }
      if (applicability.markets.length === 0) missing.add("market");
      if (applicability.year_start === null || applicability.year_start === undefined) {
        missing.add("productionYear");
      }
      if (applicability.pump_models.length === 0) missing.add("pumpModel");
      if (applicability.acsd_states.length === 0) missing.add("acsdConfiguration");
    }

    conflicts.push({
      subject,
      claimLocalIds: claims.map((claim) => claim.local_id).sort(),
      distinctValues: [...values].sort(),
      missingApplicabilityFields: [...missing].sort(),
    });
  }

  return conflicts.sort((a, b) => a.subject.localeCompare(b.subject));
}

export function reviewTriggers(payload: ExtractionPayload): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const community = isCommunity(payload);

  if (
    payload.claims.length === 0 &&
    payload.observations.length === 0 &&
    payload.procedure_fragments.length === 0
  ) {
    flags.push({
      kind: "parse_incomplete",
      severity: 1,
      message:
        "Document structure was captured, but no semantic evidence cites it yet. Hold it out of retrieval until applicability and atomic claims or procedures are reviewed.",
      relatedLocalIds: payload.content_units.map((unit) => unit.local_id),
    });
  }

  const blockById = new Map(
    payload.content_units.flatMap((unit) => unit.blocks.map((block) => [block.local_id, block])),
  );

  for (const claim of payload.claims) {
    const hasNumber =
      (claim.value_numeric !== null && claim.value_numeric !== undefined) ||
      (claim.value_numeric_min !== null &&
        claim.value_numeric_min !== undefined &&
        claim.value_numeric_max !== null &&
        claim.value_numeric_max !== undefined);
    const renderedValue =
      claim.value_numeric !== null && claim.value_numeric !== undefined
        ? String(claim.value_numeric)
        : `${claim.value_numeric_min}-${claim.value_numeric_max}`;

    if (
      hasNumber &&
      community &&
      (claim.claim_kind === "specification" ||
        EXACT_VALUE_SUBJECT_PATTERN.test(claim.subject) ||
        EXACT_VALUE_SUBJECT_PATTERN.test(claim.object_text))
    ) {
      flags.push({
        kind: "exact_specification_from_community",
        severity: 1,
        message: `"${claim.subject}" carries an exact value (${renderedValue} ${claim.unit}) from a tier-${payload.source.authority_tier} source. It may not be presented as a specification without an OEM cross-check.`,
        relatedLocalIds: [claim.local_id],
      });
    }

    if (hasNumber) {
      const fromOcr = claim.source_block_local_ids.some(
        (id) => blockById.get(id)?.ocr_derived === true,
      );
      if (fromOcr) {
        flags.push({
          kind: "ocr_derived_value",
          severity: 1,
          message: `Claim ${claim.local_id} takes a number from OCR text. A misread digit is worse than no value.`,
          relatedLocalIds: [claim.local_id],
        });
      }
    }

    if (claim.quotes_external_authority) {
      flags.push({
        kind: "unverifiable_oem_quote",
        severity: 1,
        message: `Claim ${claim.local_id} quotes an authority document that is not independently available here. Treat it as a forum report until the document is obtained.`,
        relatedLocalIds: [claim.local_id],
      });
    }

    if (
      claim.claim_basis === "speculation" ||
      claim.claim_basis === "hearsay" ||
      claim.claim_basis === "unattributed_quote" ||
      claim.claim_basis === "suggestion_only"
    ) {
      flags.push({
        kind: "speculative_claim",
        severity: claim.claim_kind === "specification" ? 1 : 2,
        message: `Claim ${claim.local_id} is based on ${claim.claim_basis.replace(/_/g, " ")} and may not be presented as an established result.`,
        relatedLocalIds: [claim.local_id],
      });
    }

    if (claim.assertion_strength === "confirmed") {
      flags.push({
        kind: "confirmed_root_cause",
        severity: 2,
        message: `Claim ${claim.local_id} is marked "confirmed". Confirmation must come from the original author's follow-up, not from consensus.`,
        relatedLocalIds: [claim.local_id],
      });
    }

    if (claim.safety_critical || claim.claim_kind === "safety_warning") {
      flags.push({
        kind: "safety_critical_procedure",
        severity: 1,
        message: `Claim ${claim.local_id} is safety critical and must be human-reviewed before it can be surfaced.`,
        relatedLocalIds: [claim.local_id],
      });
    }

    const normalized =
      claim.normalized_value !== null && claim.normalized_value !== undefined;
    if (normalized && claim.normalized_unit !== claim.unit) {
      flags.push({
        kind: "unit_normalization",
        severity: 2,
        message: `Claim ${claim.local_id} was normalised from "${claim.unit}" to "${claim.normalized_unit}".`,
        relatedLocalIds: [claim.local_id],
      });
    }
  }

  for (const fragment of payload.procedure_fragments) {
    const safetySteps = fragment.steps.filter((step) => step.is_safety_critical);
    if (safetySteps.length > 0 || fragment.safety_notes.length > 0) {
      flags.push({
        kind: "safety_critical_procedure",
        severity: 1,
        message: `Procedure "${fragment.title}" contains ${safetySteps.length} safety-critical step(s) and must be reviewed before publication.`,
        relatedLocalIds: [fragment.local_id],
      });
    }
  }

  for (const mention of payload.vehicle_mentions) {
    const missing: string[] = [];
    if (!mention.market) missing.push("market");
    if (mention.production_year === null || mention.production_year === undefined) {
      missing.push("productionYear");
    }
    if (!mention.pump_model) missing.push("pumpModel");
    if (mention.acsd_configuration === "unknown") missing.push("acsdConfiguration");

    if (missing.length > 0) {
      flags.push({
        kind: "missing_applicability",
        severity: 2,
        message: `Vehicle ${mention.local_id} is missing ${missing.join(", ")}. Nothing derived from it may resolve a specification.`,
        relatedLocalIds: [mention.local_id],
      });
    }
  }

  for (const conflict of detectClaimConflicts(payload)) {
    flags.push({
      kind: "conflicting_claims",
      severity: 1,
      message: `"${conflict.subject}" has ${conflict.distinctValues.length} incompatible values (${conflict.distinctValues.join(" vs ")}). Cruiser Copilot will surface the disagreement rather than pick one.`,
      relatedLocalIds: conflict.claimLocalIds,
    });
  }

  // Flags the extractor raised itself are kept — they may describe things the
  // deterministic rules cannot see.
  for (const flag of payload.review_flags) {
    flags.push({
      kind: flag.kind,
      severity: flag.severity as 1 | 2 | 3,
      message: flag.message,
      relatedLocalIds: flag.related_local_ids,
    });
  }

  return dedupe(flags);
}

/** True when nothing from this payload may be published without a human. */
export function blocksPublication(flags: readonly ReviewFlag[]): boolean {
  return flags.some((flag) => flag.severity === 1);
}

function dedupe(flags: readonly ReviewFlag[]): ReviewFlag[] {
  const seen = new Map<string, ReviewFlag>();
  for (const flag of flags) {
    const key = `${flag.kind}::${flag.relatedLocalIds.join(",")}`;
    const existing = seen.get(key);
    if (!existing || flag.severity < existing.severity) seen.set(key, flag);
  }
  return [...seen.values()].sort(
    (a, b) => a.severity - b.severity || a.kind.localeCompare(b.kind),
  );
}
