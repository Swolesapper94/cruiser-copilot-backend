import type { Citation, SourceDocument, SourcePassage, Vehicle } from "@/types";
import type { ApplicabilityResult } from "./applicability";

export interface RetrievedPassage {
  passage: SourcePassage;
  document: SourceDocument;
  citation: Citation;
  applicability: ApplicabilityResult;
  score: number;
  matchedKeywords: string[];
  /** True when the match came from embeddings rather than exact lookup. */
  semantic: boolean;
}

export interface RetrievalRequest {
  vehicle: Vehicle;
  keywords?: string[];
  specificationSubject?: string;
  /** Keep passages whose applicability cannot yet be settled. Default true. */
  includeUnresolved?: boolean;
  limit?: number;
}

export interface RetrievalResult {
  passages: RetrievedPassage[];
  citations: Citation[];
  conflicts: import("@/types").SourceConflict[];
  /** True when every relied-upon record is still placeholder scaffolding. */
  placeholderOnly: boolean;
}
