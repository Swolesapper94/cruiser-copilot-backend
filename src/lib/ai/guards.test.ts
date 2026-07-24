import { describe, expect, it } from "vitest";
import {
  claimsConfirmation,
  findInventedCitations,
  findUnsourcedMeasurements,
  guardExplanation,
} from "./guards";
import {
  mediaObservationOutputSchema,
  modelExplanationSchema,
} from "@/lib/validation/schemas";

const SOURCE_TEXT =
  "Placeholder passage. Torque the union nut to 25 Nm as printed in the imported source page.";

describe("findUnsourcedMeasurements", () => {
  it("flags a numeric value that does not appear in the sources", () => {
    expect(
      findUnsourcedMeasurements("Set the plunger stroke to 0.98 mm.", SOURCE_TEXT),
    ).toContain("0.98 mm");
  });

  it("allows a value that appears verbatim in the sources", () => {
    expect(
      findUnsourcedMeasurements("Torque the union nut to 25 Nm.", SOURCE_TEXT),
    ).toEqual([]);
  });

  it("ignores prose with no measurements at all", () => {
    expect(
      findUnsourcedMeasurements(
        "Air ingress is the leading explanation because priming changed the behaviour.",
        SOURCE_TEXT,
      ),
    ).toEqual([]);
  });
});

describe("findInventedCitations", () => {
  it("flags citation ids that were never supplied", () => {
    expect(findInventedCitations(["cit-a", "cit-zz"], ["cit-a", "cit-b"])).toEqual([
      "cit-zz",
    ]);
  });

  it("accepts the supplied ids", () => {
    expect(findInventedCitations(["cit-a"], ["cit-a", "cit-b"])).toEqual([]);
  });
});

describe("claimsConfirmation", () => {
  it("rejects prose that claims a confirmed root cause", () => {
    expect(claimsConfirmation("This confirms the fault is the injection pump.")).toBe(
      true,
    );
    expect(claimsConfirmation("The root cause is air ingress.")).toBe(true);
  });

  it("accepts hedged, evidence-linked prose", () => {
    expect(
      claimsConfirmation(
        "Air ingress currently ranks highest, but nothing has been confirmed yet.",
      ),
    ).toBe(false);
  });
});

describe("guardExplanation", () => {
  it("passes a well-behaved explanation", () => {
    const result = guardExplanation({
      explanation:
        "Priming improved starting, which is why air ingress ranks above injection timing right now.",
      citedCitationIds: ["cit-a"],
      allowedCitationIds: ["cit-a", "cit-b"],
      sourceText: SOURCE_TEXT,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("reports every violation at once", () => {
    const result = guardExplanation({
      explanation: "The root cause is timing. Set the pump to 1.15 mm of plunger stroke.",
      citedCitationIds: ["cit-made-up"],
      allowedCitationIds: ["cit-a"],
      sourceText: SOURCE_TEXT,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});

describe("model output schemas", () => {
  it("rejects malformed explanation output", () => {
    expect(
      modelExplanationSchema.safeParse({ explanation: "", citedCitationIds: [] }).success,
    ).toBe(false);
    expect(
      modelExplanationSchema.safeParse({
        explanation: "Ranked by evidence, nothing confirmed.",
        citedCitationIds: ["cit-a"],
        observations: [],
        reportedConflicts: [],
        missingApplicabilityFields: [],
      }).success,
    ).toBe(true);
  });

  it("rejects media output that claims to be a diagnosis", () => {
    expect(
      mediaObservationOutputSchema.safeParse({
        observations: ["White vapour visible at the tailpipe."],
        observationLimit: "Video only shows the exhaust; the fuel system is not visible.",
        isDiagnosis: true,
      }).success,
    ).toBe(false);
  });

  it("accepts bounded, non-diagnostic media observations", () => {
    expect(
      mediaObservationOutputSchema.safeParse({
        observations: ["White vapour visible at the tailpipe."],
        observationLimit: "Video only shows the exhaust; the fuel system is not visible.",
        isDiagnosis: false,
      }).success,
    ).toBe(true);
  });
});
