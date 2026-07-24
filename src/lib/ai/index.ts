import { liveModelAvailable } from "@/lib/config/env";
import type { DiagnosticUpdate } from "@/types";
import { guardExplanation } from "./guards";
import { openAiCompatibleModel } from "./openai-compatible";
import { buildScriptedExplanation, scriptedModel } from "./scripted";
import type { DiagnosticModel, DiagnosticModelInput } from "./types";

export type { DiagnosticModel, DiagnosticModelInput } from "./types";
export { scriptedModel } from "./scripted";
export { guardExplanation } from "./guards";

export function getDiagnosticModel(): DiagnosticModel {
  return liveModelAvailable() ? openAiCompatibleModel : scriptedModel;
}

/**
 * Decorates a deterministic update with a plain-language explanation.
 *
 * Any failure — missing credentials, network error, schema violation, invented
 * citation, unsourced measurement, or a confirmation claim — falls back to the
 * scripted explanation. The session is never left in a partial state.
 */
export async function explainUpdate(
  input: DiagnosticModelInput,
): Promise<Pick<DiagnosticUpdate, "explanation" | "explanationSource">> {
  const model = getDiagnosticModel();

  if (model.kind === "scripted") {
    return {
      explanation: buildScriptedExplanation(input).explanation,
      explanationSource: "scripted",
    };
  }

  try {
    const result = await model.generateExplanation(input);
    const guard = guardExplanation({
      explanation: result.explanation,
      citedCitationIds: result.citedCitationIds,
      allowedCitationIds: input.update.citations.map((citation) => citation.id),
      sourceText: input.passages.map((entry) => entry.passage.text).join("\n"),
    });

    if (!guard.ok) {
      console.warn("[cruiser-copilot] rejected model explanation", {
        reasons: guard.reasons,
      });
      return {
        explanation: buildScriptedExplanation(input).explanation,
        explanationSource: "scripted",
      };
    }

    return { explanation: result.explanation, explanationSource: "model" };
  } catch (error) {
    console.warn("[cruiser-copilot] model explanation failed", {
      code: error instanceof Error ? error.message : "unknown_error",
    });
    return {
      explanation: buildScriptedExplanation(input).explanation,
      explanationSource: "scripted",
    };
  }
}
