import { describe, expect, it } from "vitest";
import { evaluateSession, nextQuestionFor } from "./engine";
import type { DiagnosticSession, EvidenceItem, Vehicle } from "@/types";

const NOW = "2024-01-01T00:00:00.000Z";

const identifiedVehicle: Vehicle = {
  id: "veh-1",
  series: "80",
  engineCode: "1HD-T",
  modifications: [],
  identificationConfidence: "user-confirmed",
};

function session(overrides: Partial<DiagnosticSession> = {}): DiagnosticSession {
  return {
    id: "ses-1",
    createdAt: NOW,
    updatedAt: NOW,
    vehicle: identifiedVehicle,
    complaint: "Hard to start when cold, white smoke",
    stage: "symptoms",
    answers: [],
    evidence: [],
    completedStepIds: [],
    mode: "scripted",
    ...overrides,
  };
}

function answer(questionId: string, value: string) {
  return { questionId, value, answeredAt: NOW };
}

const measurementEvidence: EvidenceItem = {
  id: "ev-measure-1",
  type: "measurement",
  provenance: "user",
  createdAt: NOW,
  userDescription: "Plunger stroke read with a dial indicator",
  measurement: { key: "plunger-stroke", value: 0.9, unit: "mm" },
};

const photoEvidence: EvidenceItem = {
  id: "ev-photo-1",
  type: "photo",
  provenance: "user",
  createdAt: NOW,
  userDescription: "Exhaust at cold start",
};

describe("nextQuestionFor", () => {
  it("asks one question at a time, starting with the complaint category", () => {
    const question = nextQuestionFor(session());
    expect(question?.id).toBe("complaint-category");
    expect(question?.rationale.length).toBeGreaterThan(0);
  });

  it("skips branch questions that do not apply", () => {
    const next = nextQuestionFor(
      session({ answers: [answer("complaint-category", "leak")] }),
    );
    expect(next?.id).not.toBe("cranking-speed");
  });

  it("returns null once every applicable question is answered", () => {
    // Every remaining question in the bank is gated behind a starting complaint.
    const remaining = nextQuestionFor(
      session({ answers: [answer("complaint-category", "leak")] }),
    );
    expect(remaining).toBeNull();
  });
});

describe("evaluateSession", () => {
  it("emits a schema-valid update for an empty session", () => {
    const update = evaluateSession(session({ vehicle: { ...identifiedVehicle, series: "unknown", engineCode: "unknown" } }));
    expect(update.stage).toBe("vehicle");
    expect(update.vehicleStatus.identified).toBe(false);
    expect(update.recommendedTest).toBeNull();
    expect(
      update.safetyGates.some(
        (gate) => gate.id === "gate-vehicle-unidentified" && gate.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("never reports a confirmed hypothesis in the MVP", () => {
    const update = evaluateSession(
      session({
        answers: [
          answer("complaint-category", "hard-start"),
          answer("cranking-speed", "normal"),
          answer("does-it-start", "starts-after-long-crank"),
          answer("smoke-color", "white"),
        ],
        evidence: [measurementEvidence],
      }),
    );
    expect(update.hypotheses.every((item) => item.status !== "confirmed")).toBe(true);
  });

  it("ranks hypotheses relatively and never as probabilities summing above one", () => {
    const update = evaluateSession(
      session({
        answers: [
          answer("complaint-category", "hard-start"),
          answer("cranking-speed", "normal"),
          answer("does-it-start", "starts-after-long-crank"),
        ],
      }),
    );
    expect(update.hypotheses.length).toBeGreaterThan(1);
    for (const hypothesis of update.hypotheses) {
      expect(hypothesis.relativeScore).toBeGreaterThanOrEqual(0);
      expect(hypothesis.relativeScore).toBeLessThanOrEqual(1);
    }
    const sorted = [...update.hypotheses]
      .map((item) => item.relativeScore)
      .every((value, index, list) => index === 0 || list[index - 1] >= value);
    expect(sorted).toBe(true);
  });

  it("keeps media evidence out of the ranking", () => {
    const withoutMedia = evaluateSession(
      session({ answers: [answer("complaint-category", "hard-start")] }),
    );
    const withMedia = evaluateSession(
      session({
        answers: [answer("complaint-category", "hard-start")],
        evidence: [photoEvidence],
      }),
    );

    expect(withMedia.hypotheses.map((item) => [item.id, item.relativeScore])).toEqual(
      withoutMedia.hypotheses.map((item) => [item.id, item.relativeScore]),
    );
    expect(withMedia.progress.evidenceCaptured).toBe(true);
  });

  it("records an uninterpretable measurement instead of scoring it while the specification is locked", () => {
    const update = evaluateSession(
      session({
        answers: [
          answer("complaint-category", "hard-start"),
          answer("cranking-speed", "normal"),
          answer("does-it-start", "starts-after-long-crank"),
        ],
        evidence: [measurementEvidence],
      }),
    );

    expect(update.specificationLocked).toBe(true);
    const timing = update.hypotheses.find((item) => item.id === "injection-timing");
    expect(timing?.status).toBe("partially-tested");
    expect(
      timing?.rationale.some(
        (link) => link.ref === measurementEvidence.id && link.direction === "context",
      ),
    ).toBe(true);
    expect(
      update.safetyGates.some((gate) => gate.id === "gate-measurement-uninterpretable"),
    ).toBe(true);
  });

  it("locks the specification and surfaces the conflict for a partially identified vehicle", () => {
    const update = evaluateSession(session());
    expect(update.specificationLocked).toBe(true);
    expect(update.sourceConflicts.length).toBeGreaterThan(0);
    expect(update.sourceConflicts[0].resolutionStatus).toBe("unresolved");
    expect(update.vehicleStatus.missingFields.length).toBeGreaterThan(0);
    expect(
      update.safetyGates.some((gate) => gate.id === "gate-specification-locked"),
    ).toBe(true);
  });

  it("only recommends a test once the vehicle is identified and symptoms are captured", () => {
    const early = evaluateSession(
      session({ answers: [answer("complaint-category", "hard-start")] }),
    );
    expect(early.recommendedTest).toBeNull();

    const later = evaluateSession(
      session({
        answers: [
          answer("complaint-category", "hard-start"),
          answer("cranking-speed", "normal"),
          answer("does-it-start", "starts-after-long-crank"),
        ],
      }),
    );
    expect(later.recommendedTest).not.toBeNull();
    expect(later.recommendedTest!.targetsHypothesisIds.length).toBeGreaterThan(0);
    expect(later.recommendedTest!.possibleInterpretations.length).toBeGreaterThan(0);
  });

  it("always warns that the source library is placeholder material", () => {
    const update = evaluateSession(session());
    expect(
      update.safetyGates.some((gate) => gate.id === "gate-placeholder-sources"),
    ).toBe(true);
    expect(update.citations.every((citation) => citation.isPlaceholder)).toBe(true);
  });

  it("marks the session complete once an outcome is recorded", () => {
    const update = evaluateSession(
      session({
        completedStepIds: ["step-1-prepare"],
        outcome: {
          resolved: "partially",
          performedTestIds: ["measure-plunger-stroke"],
          recordedAt: NOW,
        },
      }),
    );
    expect(update.stage).toBe("complete");
    expect(update.progress.outcomeRecorded).toBe(true);
    expect(update.progress.testingStarted).toBe(true);
  });
});
