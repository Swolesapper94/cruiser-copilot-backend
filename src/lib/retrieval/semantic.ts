import { semanticRetrievalAvailable } from "@/lib/config/env";

/**
 * Semantic retrieval placeholder.
 *
 * Embeddings are optional and disabled by default. When enabled, this module
 * is where a pgvector query against ingested passage embeddings belongs.
 * It may only *add* candidates — exact matching still owns model codes,
 * engine codes, tool numbers, torque values, tolerances and specifications.
 */
export function semanticCandidates(query: string): string[] {
  if (!semanticRetrievalAvailable()) return [];
  void query;
  // Intentionally empty until packages/database embeddings are populated.
  return [];
}
