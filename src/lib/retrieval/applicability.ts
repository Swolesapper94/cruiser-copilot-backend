import type { Vehicle } from "@/types";

export type ApplicabilityVerdict = "applicable" | "not-applicable" | "unresolved";

export interface ApplicabilityResult {
  verdict: ApplicabilityVerdict;
  /** Vehicle fields that must be answered before the verdict can be settled. */
  unresolvedFields: string[];
  /** Vehicle fields that positively contradict the passage. */
  conflictingFields: string[];
  /** How many dimensions matched exactly. Used for reranking. */
  matchStrength: number;
}

export interface ApplicabilityCandidate {
  completeness?: "unknown" | "partial" | "sufficient";
  manufacturers?: string[];
  modelNames?: string[];
  submodels?: string[];
  modelCodes: string[];
  engineCodes: string[];
  markets: string[];
  pumpModels: string[];
  acsdStates?: Array<"present" | "absent" | "unknown">;
  emissionsConfigurations?: string[];
  yearStart?: number;
  yearEnd?: number;
}

/** Generic identity shape used by source ingestion before product scoping. */
export interface ApplicabilityVehicle {
  id?: string;
  manufacturer?: string;
  modelName?: string;
  submodel?: string;
  series: string;
  modelCode?: string;
  chassisCode?: string;
  productionYear?: number;
  market?: string;
  engineCode: string;
  pumpModel?: string;
  emissionsConfiguration?: string;
  acsdConfiguration?: "present" | "absent" | "unknown";
  modifications?: string[];
  identificationConfidence?: "user-confirmed" | "inferred" | "unknown";
}

const SERIES_BY_MODEL_PREFIX: Record<string, Vehicle["series"]> = {
  HZJ7: "70",
  HDJ7: "70",
  PZJ7: "70",
  BJ7: "70",
  FZJ7: "70",
  LJ7: "70",
  HDJ8: "80",
  HZJ8: "80",
  FZJ8: "80",
  FJ80: "80",
};

/** Best-effort series inference from a model/chassis code. Never authoritative. */
export function seriesForModelCode(modelCode?: string): Vehicle["series"] {
  if (!modelCode) return "unknown";
  const normalized = modelCode.trim().toUpperCase();
  for (const [prefix, series] of Object.entries(SERIES_BY_MODEL_PREFIX)) {
    if (normalized.startsWith(prefix)) return series;
  }
  return "unknown";
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function compareList(
  constraint: readonly string[],
  known: string | undefined,
  fieldName: string,
  result: { unresolved: string[]; conflicting: string[]; matches: number },
): void {
  if (constraint.length === 0) return;
  if (!known || normalize(known) === "UNKNOWN") {
    result.unresolved.push(fieldName);
    return;
  }
  const normalizedKnown = normalize(known);
  if (constraint.some((entry) => normalize(entry) === normalizedKnown)) {
    result.matches += 1;
  } else {
    result.conflicting.push(fieldName);
  }
}

/**
 * Decides whether a passage may be shown for a vehicle.
 *
 * "unresolved" is deliberately distinct from "applicable": the workflow is not
 * allowed to treat an unresolved passage as a confirmed specification.
 */
export function evaluateApplicability(
  passage: ApplicabilityCandidate,
  vehicle: ApplicabilityVehicle,
): ApplicabilityResult {
  const acc = { unresolved: [] as string[], conflicting: [] as string[], matches: 0 };

  if (passage.completeness && passage.completeness !== "sufficient") {
    acc.unresolved.push("documentApplicability");
  }

  const knownModelCode = vehicle.modelCode ?? vehicle.chassisCode;
  compareList(passage.manufacturers ?? [], vehicle.manufacturer, "manufacturer", acc);
  compareList(passage.modelNames ?? [], vehicle.modelName, "modelName", acc);
  compareList(passage.submodels ?? [], vehicle.submodel, "submodel", acc);
  compareList(passage.modelCodes, knownModelCode, "modelCode", acc);
  compareList(
    passage.engineCodes,
    vehicle.engineCode === "unknown" ? undefined : vehicle.engineCode,
    "engineCode",
    acc,
  );
  compareList(passage.markets, vehicle.market, "market", acc);
  compareList(passage.pumpModels, vehicle.pumpModel, "pumpModel", acc);
  compareList(
    passage.emissionsConfigurations ?? [],
    vehicle.emissionsConfiguration,
    "emissionsConfiguration",
    acc,
  );
  compareList(
    passage.acsdStates ?? [],
    vehicle.acsdConfiguration,
    "acsdConfiguration",
    acc,
  );

  const hasYearConstraint =
    passage.yearStart !== undefined || passage.yearEnd !== undefined;
  if (hasYearConstraint) {
    if (vehicle.productionYear === undefined) {
      acc.unresolved.push("productionYear");
    } else if (
      (passage.yearStart !== undefined && vehicle.productionYear < passage.yearStart) ||
      (passage.yearEnd !== undefined && vehicle.productionYear > passage.yearEnd)
    ) {
      acc.conflicting.push("productionYear");
    } else {
      acc.matches += 1;
    }
  }

  // Series is a coarse guard rail derived from the model codes on the passage.
  if (vehicle.series !== "unknown" && passage.modelCodes.length > 0) {
    const passageSeries = new Set<string>(
      passage.modelCodes.map((code) => seriesForModelCode(code)),
    );
    passageSeries.delete("unknown");
    if (passageSeries.size > 0 && !passageSeries.has(vehicle.series)) {
      if (!acc.conflicting.includes("series")) acc.conflicting.push("series");
    }
  }

  let verdict: ApplicabilityVerdict = "applicable";
  if (acc.conflicting.length > 0) verdict = "not-applicable";
  else if (acc.unresolved.length > 0) verdict = "unresolved";

  return {
    verdict,
    unresolvedFields: acc.unresolved,
    conflictingFields: acc.conflicting,
    matchStrength: acc.matches,
  };
}

/** Applicability fields still missing from the vehicle record. */
export function missingVehicleFields(vehicle: Vehicle): string[] {
  const missing: string[] = [];
  if (!vehicle.manufacturer) missing.push("manufacturer");
  if (!vehicle.modelName) missing.push("modelName");
  if (vehicle.series === "unknown") missing.push("series");
  if (!vehicle.modelCode && !vehicle.chassisCode) missing.push("modelCode");
  if (vehicle.productionYear === undefined) missing.push("productionYear");
  if (!vehicle.market) missing.push("market");
  if (vehicle.engineCode === "unknown") missing.push("engineCode");
  if (!vehicle.pumpModel) missing.push("pumpModel");
  if (!vehicle.acsdConfiguration || vehicle.acsdConfiguration === "unknown") {
    missing.push("acsdConfiguration");
  }
  return missing;
}

/** The vehicle is "identified enough" to continue the interview, not to spec. */
export function isVehicleIdentified(vehicle: Vehicle): boolean {
  return vehicle.series !== "unknown" && vehicle.engineCode !== "unknown";
}
