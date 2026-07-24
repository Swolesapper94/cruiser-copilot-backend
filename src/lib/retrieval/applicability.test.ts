import { describe, expect, it } from "vitest";
import {
  evaluateApplicability,
  isVehicleIdentified,
  missingVehicleFields,
  seriesForModelCode,
} from "./applicability";
import type { Vehicle } from "@/types";

const baseVehicle: Vehicle = {
  id: "veh-test",
  series: "80",
  engineCode: "1HD-T",
  modifications: [],
  identificationConfidence: "user-confirmed",
};

const passage = {
  modelCodes: ["HDJ80"],
  engineCodes: ["1HD-T"],
  markets: ["EU"],
  pumpModels: [] as string[],
  yearStart: 1994,
  yearEnd: 1997,
};

describe("seriesForModelCode", () => {
  it("infers series from a known prefix", () => {
    expect(seriesForModelCode("HDJ80")).toBe("80");
    expect(seriesForModelCode("hzj75")).toBe("70");
  });

  it("returns unknown rather than guessing", () => {
    expect(seriesForModelCode("XYZ99")).toBe("unknown");
    expect(seriesForModelCode(undefined)).toBe("unknown");
  });
});

describe("evaluateApplicability", () => {
  it("is unresolved when the vehicle is missing a constrained field", () => {
    const result = evaluateApplicability(passage, baseVehicle);
    expect(result.verdict).toBe("unresolved");
    expect(result.unresolvedFields).toContain("modelCode");
    expect(result.unresolvedFields).toContain("market");
    expect(result.unresolvedFields).toContain("productionYear");
  });

  it("is applicable only when every constrained field matches", () => {
    const result = evaluateApplicability(passage, {
      ...baseVehicle,
      modelCode: "HDJ80",
      market: "EU",
      productionYear: 1995,
    });
    expect(result.verdict).toBe("applicable");
    expect(result.unresolvedFields).toHaveLength(0);
    expect(result.matchStrength).toBeGreaterThan(0);
  });

  it("is not applicable when a known field contradicts the passage", () => {
    const result = evaluateApplicability(passage, {
      ...baseVehicle,
      modelCode: "HDJ80",
      market: "EU",
      productionYear: 1991,
    });
    expect(result.verdict).toBe("not-applicable");
    expect(result.conflictingFields).toContain("productionYear");
  });

  it("never treats an unresolved passage as applicable", () => {
    const result = evaluateApplicability(passage, {
      ...baseVehicle,
      modelCode: "HDJ80",
      market: "EU",
    });
    expect(result.verdict).not.toBe("applicable");
  });
});

describe("missingVehicleFields", () => {
  it("lists every applicability field that is still unknown", () => {
    expect(missingVehicleFields(baseVehicle)).toEqual([
      "modelCode",
      "productionYear",
      "market",
      "pumpModel",
      "acsdConfiguration",
    ]);
  });

  it("is empty once the full record is known", () => {
    expect(
      missingVehicleFields({
        ...baseVehicle,
        modelCode: "HDJ80",
        productionYear: 1995,
        market: "EU",
        pumpModel: "PUMP-TAG",
        acsdConfiguration: "present",
      }),
    ).toEqual([]);
  });
});

describe("isVehicleIdentified", () => {
  it("requires both series and engine", () => {
    expect(isVehicleIdentified(baseVehicle)).toBe(true);
    expect(isVehicleIdentified({ ...baseVehicle, engineCode: "unknown" })).toBe(false);
    expect(isVehicleIdentified({ ...baseVehicle, series: "unknown" })).toBe(false);
  });
});
