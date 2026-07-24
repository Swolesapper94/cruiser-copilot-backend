import type { SourceDocument } from "@/types";

/**
 * Source authority precedence (1 = highest).
 *
 * 1. Vehicle-applicable Toyota service bulletin / superseding OEM information
 * 2. Exact-match Toyota repair manual
 * 3. Other applicable Toyota technical documentation
 * 4. Verified, completed repair case
 * 5. Experienced technician guidance
 * 6. Forum post
 * 7. General automotive information
 */
export const AUTHORITY_BY_SOURCE_TYPE = {
  service_bulletin: 1,
  oem_manual: 2,
  oem_technical: 3,
  verified_case: 4,
  technician: 5,
  forum: 6,
  general: 7,
} as const;

export type AuthoritySourceType = keyof typeof AUTHORITY_BY_SOURCE_TYPE;

export const OEM_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "service_bulletin",
  "oem_manual",
  "oem_technical",
]);

export function isOemSource(sourceType: string): boolean {
  return OEM_SOURCE_TYPES.has(sourceType);
}

export function authorityFor(sourceType: AuthoritySourceType): number {
  return AUTHORITY_BY_SOURCE_TYPE[sourceType];
}

/** Sorts documents strongest-authority-first. Stable for equal levels. */
export function byAuthority<T extends Pick<SourceDocument, "authorityLevel">>(
  documents: readonly T[],
): T[] {
  return [...documents].sort((a, b) => a.authorityLevel - b.authorityLevel);
}

/**
 * A lower-authority source may add practical advice but must never silently
 * override an applicable OEM specification.
 */
export function mayOverrideSpecification(
  candidate: Pick<SourceDocument, "authorityLevel">,
  incumbent: Pick<SourceDocument, "authorityLevel">,
): boolean {
  return candidate.authorityLevel < incumbent.authorityLevel;
}
