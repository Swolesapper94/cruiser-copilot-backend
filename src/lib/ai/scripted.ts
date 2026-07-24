import type { ModelExplanation } from "@/types";
import type { DiagnosticModel, DiagnosticModelInput } from "./types";

/**
 * Scripted explainer. No network, no credentials, fully deterministic.
 * This is the default runtime and the fallback for every live failure.
 */
export const scriptedModel: DiagnosticModel = {
  id: "scripted",
  kind: "scripted",
  async generateExplanation(input: DiagnosticModelInput): Promise<ModelExplanation> {
    return buildScriptedExplanation(input);
  },
};

export function buildScriptedExplanation(
  input: DiagnosticModelInput,
): ModelExplanation {
  const { update } = input;
  const parts: string[] = [update.summary];

  const top = update.hypotheses[0];
  const second = update.hypotheses[1];
  if (top && second) {
    parts.push(
      `${top.name} currently ranks above ${second.name.toLowerCase()} because of the answers you gave, not because anything has been measured. These are relative rankings, not probabilities.`,
    );
  }

  if (update.recommendedTest) {
    parts.push(
      `The suggested next step is: ${update.recommendedTest.name}. ${update.recommendedTest.reason}`,
    );
  } else if (update.nextQuestion) {
    parts.push(
      "A few more answers are needed before a test is worth recommending.",
    );
  }

  if (update.specificationLocked) {
    parts.push(
      "No exact specification will be selected for this vehicle yet. Applicability is unresolved and the source library still contains placeholder records only.",
    );
  }

  return {
    explanation: parts.join(" "),
    citedCitationIds: update.citations.map((citation) => citation.id),
    observations: input.session.evidence
      .map((item) => item.userDescription)
      .filter((value): value is string => Boolean(value)),
    reportedConflicts: update.sourceConflicts.map((conflict) => conflict.subject),
    missingApplicabilityFields: update.vehicleStatus.missingFields,
  };
}
