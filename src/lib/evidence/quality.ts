import type { ExtractionPayload } from "./schemas";
import { detectClaimConflicts } from "./review";

/**
 * Repair-case quality scoring.
 *
 * The score is a RETRIEVAL FEATURE, not a truth guarantee. A thread can score
 * 1.0 and still be wrong; it just means the thread contains everything needed
 * for a human to judge it.
 */

export interface CaseQualityFeatures {
  vehicleSufficientlyIdentified: boolean;
  initialSymptomsDocumented: boolean;
  testsOrMeasurementsReported: boolean;
  repairActionStated: boolean;
  originalAuthorConfirmedOutcome: boolean;
  followupDurationProvided: boolean;
  sourceCitationsAvailable: boolean;
  noUnresolvedContradictions: boolean;
  noSpeculativeCoreClaims: boolean;
}

export interface CaseQuality {
  caseLocalId: string;
  score: number;
  features: CaseQualityFeatures;
  /** Human-readable reasons the score is not 1. */
  gaps: string[];
}

const WEIGHTS: Record<keyof CaseQualityFeatures, number> = {
  vehicleSufficientlyIdentified: 3,
  initialSymptomsDocumented: 2,
  testsOrMeasurementsReported: 2,
  repairActionStated: 2,
  originalAuthorConfirmedOutcome: 3,
  followupDurationProvided: 1,
  sourceCitationsAvailable: 1,
  noUnresolvedContradictions: 2,
  noSpeculativeCoreClaims: 2,
};

const GAP_TEXT: Record<keyof CaseQualityFeatures, string> = {
  vehicleSufficientlyIdentified: "the vehicle is not identified well enough to apply a specification",
  initialSymptomsDocumented: "the initial symptoms were never written down",
  testsOrMeasurementsReported: "no test or measurement was reported",
  repairActionStated: "no repair action was stated",
  originalAuthorConfirmedOutcome: "the original poster never confirmed the outcome",
  followupDurationProvided: "no follow-up period was reported",
  sourceCitationsAvailable: "nothing in the case cites a source block",
  noUnresolvedContradictions: "the thread contains an unresolved contradiction",
  noSpeculativeCoreClaims:
    "a core diagnosis, repair or outcome is only a suggestion, hearsay or speculation",
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

export function scoreRepairCases(payload: ExtractionPayload): CaseQuality[] {
  const conflictedClaimIds = new Set(
    detectClaimConflicts(payload).flatMap((conflict) => conflict.claimLocalIds),
  );

  return payload.repair_cases.map((repairCase) => {
    const observations = payload.observations.filter(
      (entry) => entry.repair_case_local_id === repairCase.local_id,
    );
    const claims = payload.claims.filter(
      (entry) => entry.repair_case_local_id === repairCase.local_id,
    );
    const vehicle = payload.vehicle_mentions.find(
      (entry) => entry.local_id === repairCase.vehicle_local_id,
    );

    const features: CaseQualityFeatures = {
      vehicleSufficientlyIdentified: Boolean(
        vehicle &&
          vehicle.engine_code &&
          (vehicle.model_code || vehicle.chassis_code) &&
          vehicle.production_year !== null &&
          vehicle.production_year !== undefined &&
          vehicle.market,
      ),
      initialSymptomsDocumented: observations.some(
        (entry) =>
          (entry.observation_kind === "symptom" ||
            entry.observation_kind === "condition") &&
          entry.temporality !== "after_repair",
      ),
      testsOrMeasurementsReported:
        observations.some(
          (entry) =>
            entry.observation_kind === "measurement" ||
            entry.observation_kind === "inspection_result",
        ) ||
        claims.some(
          (entry) =>
            entry.claim_kind === "measurement" || entry.claim_kind === "test_result",
        ),
      repairActionStated: claims.some(
        (entry) =>
          entry.claim_kind === "repair_action" &&
          (entry.claim_basis === "performed_by_author" ||
            entry.claim_basis === "outcome_confirmed"),
      ),
      originalAuthorConfirmedOutcome:
        repairCase.resolution_basis === "author_confirmed" &&
        Boolean(repairCase.resolution_unit_local_id),
      followupDurationProvided:
        repairCase.followup_days !== null && repairCase.followup_days !== undefined,
      sourceCitationsAvailable:
        observations.some((entry) => entry.source_block_local_ids.length > 0) ||
        claims.some((entry) => entry.source_block_local_ids.length > 0),
      noUnresolvedContradictions: !claims.some((entry) =>
        conflictedClaimIds.has(entry.local_id),
      ),
      noSpeculativeCoreClaims: !claims.some(
        (entry) =>
          ["diagnostic_hypothesis", "root_cause", "repair_action", "repair_outcome"].includes(
            entry.claim_kind,
          ) &&
          ["suggestion_only", "hearsay", "speculation", "unattributed_quote"].includes(
            entry.claim_basis,
          ),
      ),
    };

    let earned = 0;
    const gaps: string[] = [];
    for (const key of Object.keys(WEIGHTS) as Array<keyof CaseQualityFeatures>) {
      if (features[key]) earned += WEIGHTS[key];
      else gaps.push(GAP_TEXT[key]);
    }

    return {
      caseLocalId: repairCase.local_id,
      score: Number((earned / TOTAL_WEIGHT).toFixed(3)),
      features,
      gaps,
    };
  });
}
