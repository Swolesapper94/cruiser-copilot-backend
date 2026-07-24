import { env } from "@/lib/config/env";
import {
  mediaObservationOutputSchema,
  modelExplanationSchema,
} from "@/lib/validation/schemas";
import type { MediaObservationOutput, ModelExplanation } from "@/types";
import {
  DIAGNOSTIC_EXPLANATION_SYSTEM_PROMPT,
  MEDIA_OBSERVATION_SYSTEM_PROMPT,
} from "./prompts";
import type {
  DiagnosticModel,
  DiagnosticModelInput,
  MediaObservationInput,
} from "./types";

/**
 * Provider-independent adapter for any OpenAI-compatible chat completions API.
 * Provider and model names come from the environment; nothing is hard-coded and
 * no key is ever logged.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function buildContextBlock(input: DiagnosticModelInput): string {
  const lines: string[] = [];

  lines.push("VEHICLE:");
  lines.push(JSON.stringify(input.session.vehicle));

  lines.push("DETERMINISTIC RESULT (authoritative, do not change):");
  lines.push(
    JSON.stringify({
      summary: input.update.summary,
      hypotheses: input.update.hypotheses.map((item) => ({
        id: item.id,
        name: item.name,
        relativeScore: Number(item.relativeScore.toFixed(3)),
        status: item.status,
        missingEvidence: item.missingEvidence,
      })),
      recommendedTest: input.update.recommendedTest,
      specificationLocked: input.update.specificationLocked,
      missingApplicabilityFields: input.update.vehicleStatus.missingFields,
      sourceConflicts: input.update.sourceConflicts,
    }),
  );

  lines.push("CONTEXT (the only permitted sources):");
  for (const entry of input.passages) {
    lines.push(
      [
        `citationId: ${entry.citation.id}`,
        `sourceType: ${entry.document.sourceType}`,
        `authorityLevel: ${entry.document.authorityLevel}`,
        `placeholder: ${entry.document.isPlaceholder}`,
        `locator: ${entry.citation.locator}`,
        `applicability: ${entry.applicability.verdict}`,
        `text: ${entry.passage.text}`,
      ].join("\n"),
    );
    lines.push("---");
  }

  return lines.join("\n");
}

async function postJson(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const baseUrl = (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LLM_API_KEY ?? ""}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    // Status only. Never echo the response body or any header.
    throw new Error(`llm_http_${response.status}`);
  }

  return response.json();
}

function firstMessageContent(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("llm_empty_response");
  }
  return content;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  return JSON.parse(trimmed);
}

export const openAiCompatibleModel: DiagnosticModel = {
  id: "openai-compatible",
  kind: "live",

  async generateExplanation(input: DiagnosticModelInput): Promise<ModelExplanation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const payload = await postJson(
        "/chat/completions",
        {
          model: env.LLM_MODEL,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: DIAGNOSTIC_EXPLANATION_SYSTEM_PROMPT },
            { role: "user", content: buildContextBlock(input) },
          ],
        },
        controller.signal,
      );
      return modelExplanationSchema.parse(
        parseJsonObject(firstMessageContent(payload)),
      );
    } finally {
      clearTimeout(timeout);
    }
  },

  async observeMedia(input: MediaObservationInput): Promise<MediaObservationOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const payload = await postJson(
        "/chat/completions",
        {
          model: env.VISION_MODEL || env.LLM_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: MEDIA_OBSERVATION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: input.userDescription
                    ? `Owner description: ${input.userDescription}`
                    : "Describe only what is visible.",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${input.data}` },
                },
              ],
            },
          ],
        },
        controller.signal,
      );
      return mediaObservationOutputSchema.parse(
        parseJsonObject(firstMessageContent(payload)),
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};
