import type {
  DiagnosticSession,
  DiagnosticUpdate,
  MediaObservationOutput,
  ModelExplanation,
} from "@/types";
import type { RetrievedPassage } from "@/lib/retrieval/types";

export interface DiagnosticModelInput {
  session: DiagnosticSession;
  /** Already-computed deterministic result. The model may only explain it. */
  update: DiagnosticUpdate;
  passages: readonly RetrievedPassage[];
}

export interface MediaObservationInput {
  mimeType: string;
  /** Base64 payload. Only ever sent after an explicit user action. */
  data: string;
  userDescription?: string;
}

export interface DiagnosticModel {
  readonly id: string;
  readonly kind: "scripted" | "live";
  generateExplanation(input: DiagnosticModelInput): Promise<ModelExplanation>;
  observeMedia?(input: MediaObservationInput): Promise<MediaObservationOutput>;
}
