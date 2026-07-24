import type {
  DiagnosticSession,
  DiagnosticUpdate,
  EvidenceLink,
  Hypothesis,
  Question,
  RecommendedTest,
  SafetyGate,
} from "@/types";
import { diagnosticUpdateSchema } from "@/lib/validation/schemas";
import {
  isVehicleIdentified,
  missingVehicleFields,
  retrieve,
  specificationIsLocked,
} from "@/lib/retrieval";
import { QUESTION_BANK, questionById, toWireQuestion } from "./questions";
import { HYPOTHESES, MEASUREMENT_RULES, SCORE_RULES } from "./rules";
import {
  DIAGNOSTIC_TESTS,
  toRecommendedTest,
  type DiagnosticTestDefinition,
} from "./tests-catalog";

const TIMING_SPEC_SUBJECT = "injection-pump-plunger-stroke-at-tdc";

/** Exact-match keywords handed to retrieval for this diagnostic branch. */
export const DIAGNOSTIC_SEARCH_KEYWORDS = Array.from(
  new Set(HYPOTHESES.flatMap((definition) => definition.searchKeywords)),
);

export const SPECIFICATION_SUBJECT = TIMING_SPEC_SUBJECT;

interface WorkingHypothesis {
  score: number;
  supporting: Set<string>;
  contradicting: Set<string>;
  rationale: EvidenceLink[];
  tested: boolean;
  testedButUninterpretable: boolean;
}

function answersMap(session: DiagnosticSession): Record<string, string> {
  const map: Record<string, string> = {};
  for (const answer of session.answers) map[answer.questionId] = answer.value;
  return map;
}

function labelForAnswer(questionId: string, value: string): string {
  const question = questionById(questionId);
  if (!question) return `${questionId}: ${value}`;
  const option = question.options.find((entry) => entry.value === value);
  return `${question.prompt} — ${option?.label ?? value}`;
}

/** The next unanswered question whose adaptive gate is satisfied. */
export function nextQuestionFor(session: DiagnosticSession): Question | null {
  const answered = new Set(session.answers.map((answer) => answer.questionId));
  const answers = answersMap(session);
  for (const definition of QUESTION_BANK) {
    if (answered.has(definition.id)) continue;
    if (definition.appliesWhen && !definition.appliesWhen(answers)) continue;
    return toWireQuestion(definition);
  }
  return null;
}

function scoreHypotheses(
  session: DiagnosticSession,
  specificationLocked: boolean,
): Map<string, WorkingHypothesis> {
  const working = new Map<string, WorkingHypothesis>();
  for (const definition of HYPOTHESES) {
    working.set(definition.id, {
      score: definition.baseWeight,
      supporting: new Set<string>(),
      contradicting: new Set<string>(),
      rationale: [],
      tested: false,
      testedButUninterpretable: false,
    });
  }

  const answers = answersMap(session);

  for (const rule of SCORE_RULES) {
    if (answers[rule.questionId] !== rule.value) continue;
    const ref = `answer:${rule.questionId}`;
    const label = labelForAnswer(rule.questionId, rule.value);
    for (const effect of rule.effects) {
      const entry = working.get(effect.hypothesisId);
      if (!entry) continue;
      entry.score += effect.delta;
      if (effect.delta > 0) entry.supporting.add(ref);
      else if (effect.delta < 0) entry.contradicting.add(ref);
      entry.rationale.push({
        ref,
        label,
        direction: effect.delta >= 0 ? "supports" : "contradicts",
        note: effect.note,
      });
    }
  }

  for (const evidence of session.evidence) {
    if (!evidence.measurement) {
      // Photo, video, audio and written observations are context only. They can
      // never move a ranking on their own.
      continue;
    }
    const rule = MEASUREMENT_RULES.find(
      (candidate) => candidate.key === evidence.measurement?.key,
    );
    if (!rule) continue;
    const entry = working.get(rule.hypothesisId);
    if (!entry) continue;

    const blocked = rule.requiresApplicability && specificationLocked;
    entry.tested = rule.marksTested;
    entry.testedButUninterpretable = blocked;
    if (!blocked) {
      entry.score += rule.delta;
      entry.supporting.add(evidence.id);
    }
    entry.rationale.push({
      ref: evidence.id,
      label: `Measurement: ${evidence.measurement.key} = ${evidence.measurement.value} ${evidence.measurement.unit}`,
      direction: blocked ? "context" : "supports",
      note: blocked
        ? "Recorded, but it cannot be interpreted until the applicable specification is resolved for this exact vehicle."
        : rule.note,
    });
  }

  return working;
}

function statusFor(
  entry: WorkingHypothesis,
  relativeScore: number,
  baseWeight: number,
): Hypothesis["status"] {
  if (entry.tested && entry.testedButUninterpretable) return "partially-tested";
  if (entry.tested) return "supported";
  if (entry.score <= baseWeight * 0.5) return "contradicted";
  if (entry.contradicting.size > 0 && entry.supporting.size > 0) {
    return "partially-tested";
  }
  if (relativeScore >= 0.25 && entry.supporting.size >= 2) return "supported";
  return "untested";
}

function selectRecommendedTest(
  ranked: Hypothesis[],
  session: DiagnosticSession,
): RecommendedTest | null {
  if (ranked.length === 0) return null;
  const performed = new Set(session.outcome?.performedTestIds ?? []);
  const topId = ranked[0]?.id;
  const scoreById = new Map(ranked.map((item) => [item.id, item.relativeScore]));
  const statusById = new Map(ranked.map((item) => [item.id, item.status]));

  let best: { test: DiagnosticTestDefinition; value: number } | null = null;

  for (const test of DIAGNOSTIC_TESTS) {
    if (performed.has(test.id)) continue;

    const live = test.targetsHypothesisIds.filter((id) => {
      const status = statusById.get(id);
      return status !== undefined && status !== "contradicted" && status !== "confirmed";
    });
    if (live.length === 0) continue;

    const targetedScore = live.reduce((sum, id) => sum + (scoreById.get(id) ?? 0), 0);
    const topBonus = topId !== undefined && live.includes(topId) ? 1.6 : 1;
    const safetyPenalty = test.safetyWarnings.length * 0.01;
    const value = (targetedScore * topBonus) / test.effortCost - safetyPenalty;

    if (
      !best ||
      value > best.value + 1e-9 ||
      (Math.abs(value - best.value) <= 1e-9 && test.effortCost < best.test.effortCost)
    ) {
      best = { test, value };
    }
  }

  if (!best) return null;

  const targeted = best.test.targetsHypothesisIds
    .map((id) => ranked.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const reason =
    targeted.length > 1
      ? `This test directly separates ${targeted.slice(0, -1).join(", ")} from ${targeted[targeted.length - 1]} for the least effort at this point in the workflow.`
      : `This test directly tests ${targeted[0] ?? "the leading hypothesis"} and is the most informative next step for the effort involved.`;

  return toRecommendedTest(best.test, reason);
}

function buildSafetyGates(input: {
  specificationLocked: boolean;
  missingFields: string[];
  vehicleIdentified: boolean;
  placeholderSources: boolean;
  hasUninterpretableMeasurement: boolean;
}): SafetyGate[] {
  const gates: SafetyGate[] = [];

  if (!input.vehicleIdentified) {
    gates.push({
      id: "gate-vehicle-unidentified",
      severity: "blocking",
      title: "Vehicle not identified yet",
      detail:
        "Series and engine are required before any specification-dependent step can be opened.",
      missingApplicabilityFields: input.missingFields,
    });
  }

  if (input.specificationLocked) {
    gates.push({
      id: "gate-specification-locked",
      severity: "blocking",
      title: "Specification locked",
      detail:
        "Cruiser Copilot will not select an exact timing value for this vehicle. Resolve the applicability details below, and import a licensed, vehicle-matched source, before any value is applied.",
      missingApplicabilityFields: input.missingFields,
    });
  }

  if (input.placeholderSources) {
    gates.push({
      id: "gate-placeholder-sources",
      severity: "caution",
      title: "Placeholder source library",
      detail:
        "No licensed Toyota source has been imported yet. Every citation shown is scaffolding and must not be treated as a factory instruction or specification.",
      missingApplicabilityFields: [],
    });
  }

  if (input.hasUninterpretableMeasurement) {
    gates.push({
      id: "gate-measurement-uninterpretable",
      severity: "caution",
      title: "Measurement recorded but not interpreted",
      detail:
        "Your measurement is stored with the session. It will not be compared against any value until the applicable specification is resolved.",
      missingApplicabilityFields: input.missingFields,
    });
  }

  gates.push({
    id: "gate-general-safety",
    severity: "info",
    title: "Before any physical work",
    detail:
      "Work on a cold engine, never under an unsupported vehicle, and never open a hot pressurised cooling system. Stop and escalate if anything does not match what you expect.",
    missingApplicabilityFields: [],
  });

  return gates;
}

/**
 * The single deterministic entry point for diagnostic state.
 *
 * Everything the UI uses to drive the workflow comes from here. The LLM only
 * ever decorates the result with an explanation.
 */
export function evaluateSession(session: DiagnosticSession): DiagnosticUpdate {
  const vehicle = session.vehicle;
  const missingFields = missingVehicleFields(vehicle);
  const vehicleIdentified = isVehicleIdentified(vehicle);

  const retrieval = retrieve({
    vehicle,
    keywords: DIAGNOSTIC_SEARCH_KEYWORDS,
    specificationSubject: TIMING_SPEC_SUBJECT,
  });

  const specificationLocked =
    specificationIsLocked(retrieval.conflicts) ||
    !vehicleIdentified ||
    missingFields.length > 0 ||
    retrieval.placeholderOnly;

  const working = scoreHypotheses(session, specificationLocked);

  const positiveTotal = Array.from(working.values()).reduce(
    (sum, entry) => sum + Math.max(entry.score, 0),
    0,
  );

  const hypotheses: Hypothesis[] = HYPOTHESES.map((definition) => {
    const entry = working.get(definition.id)!;
    const relativeScore =
      positiveTotal > 0 ? Math.max(entry.score, 0) / positiveTotal : 0;
    const missingEvidence = entry.tested
      ? entry.testedButUninterpretable
        ? [
            "An applicable, vehicle-matched specification to interpret the measured value",
            ...definition.requiredEvidence.slice(1),
          ]
        : definition.requiredEvidence.slice(1)
      : definition.requiredEvidence;

    return {
      id: definition.id,
      name: definition.name,
      summary: definition.summary,
      relativeScore: Math.min(Math.max(relativeScore, 0), 1),
      status: statusFor(entry, relativeScore, definition.baseWeight),
      supportingEvidenceIds: Array.from(entry.supporting),
      contradictingEvidenceIds: Array.from(entry.contradicting),
      missingEvidence,
      rationale: entry.rationale,
    };
  }).sort((a, b) => {
    if (b.relativeScore !== a.relativeScore) return b.relativeScore - a.relativeScore;
    return a.id.localeCompare(b.id);
  });

  const nextQuestion = nextQuestionFor(session);
  const symptomsCaptured = session.answers.length >= 3;
  const recommendedTest =
    vehicleIdentified && symptomsCaptured
      ? selectRecommendedTest(hypotheses, session)
      : null;

  const hasUninterpretableMeasurement = Array.from(working.values()).some(
    (entry) => entry.testedButUninterpretable,
  );

  const safetyGates = buildSafetyGates({
    specificationLocked,
    missingFields,
    vehicleIdentified,
    placeholderSources: retrieval.placeholderOnly,
    hasUninterpretableMeasurement,
  });

  const stage = resolveStage(session, {
    vehicleIdentified,
    symptomsCaptured,
    interviewComplete: nextQuestion === null,
  });

  const update: DiagnosticUpdate = {
    vehicleStatus: { identified: vehicleIdentified, missingFields },
    summary: buildSummary({
      vehicleIdentified,
      symptomsCaptured,
      topName: hypotheses[0]?.name,
      specificationLocked,
    }),
    explanationSource: "scripted",
    hypotheses,
    nextQuestion,
    recommendedTest,
    sourceConflicts: retrieval.conflicts,
    citations: retrieval.citations,
    safetyGates,
    specificationLocked,
    stage,
    progress: {
      vehicleIdentified,
      symptomsCaptured,
      evidenceCaptured: session.evidence.length > 0,
      testingStarted: session.completedStepIds.length > 0,
      outcomeRecorded: Boolean(session.outcome),
    },
  };

  // Fail closed: the workflow only ever consumes a validated update.
  return diagnosticUpdateSchema.parse(update);
}

function resolveStage(
  session: DiagnosticSession,
  flags: {
    vehicleIdentified: boolean;
    symptomsCaptured: boolean;
    interviewComplete: boolean;
  },
): DiagnosticUpdate["stage"] {
  if (session.outcome) return "complete";
  if (session.completedStepIds.length > 0) return "repair";
  if (!flags.vehicleIdentified) return "vehicle";
  if (!flags.interviewComplete) return "symptoms";
  if (session.evidence.length === 0) return "evidence";
  return "testing";
}

function buildSummary(input: {
  vehicleIdentified: boolean;
  symptomsCaptured: boolean;
  topName?: string;
  specificationLocked: boolean;
}): string {
  if (!input.vehicleIdentified) {
    return "Identify the vehicle before any specification-dependent guidance can be offered.";
  }
  if (!input.symptomsCaptured) {
    return "Answer a few more questions so the ranking is based on evidence rather than assumptions.";
  }
  const lead = input.topName
    ? `The evidence so far ranks ${input.topName.toLowerCase()} highest, but nothing has been confirmed.`
    : "The evidence so far does not favour a single cause.";
  const tail = input.specificationLocked
    ? " No exact specification will be selected until vehicle applicability is resolved and a licensed source is imported."
    : "";
  return `${lead}${tail}`;
}
