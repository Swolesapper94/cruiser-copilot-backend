const MEASUREMENT_PATTERN =
  /\d+(?:[.,]\d+)?\s?(?:mm|cm|in|nm|kgf·m|kgf-m|ft-?lb|lb-?ft|psi|kpa|bar|ohms?|Ω|volts?|v|amps?|a|°|deg(?:rees)?)\b/gi;

/**
 * Rejects model prose that states a numeric mechanical value which does not
 * appear verbatim in the supplied source context.
 *
 * This is a blunt guard on purpose: a fabricated torque figure or tolerance is
 * the single most dangerous failure mode for this product.
 */
export function findUnsourcedMeasurements(
  explanation: string,
  sourceText: string,
): string[] {
  const haystack = sourceText.toLowerCase();
  const matches = explanation.match(MEASUREMENT_PATTERN) ?? [];
  const unsourced = new Set<string>();
  for (const match of matches) {
    if (!haystack.includes(match.toLowerCase().trim())) {
      unsourced.add(match.trim());
    }
  }
  return Array.from(unsourced);
}

/** Citation IDs the model returned that were never supplied to it. */
export function findInventedCitations(
  citedIds: readonly string[],
  allowedIds: readonly string[],
): string[] {
  const allowed = new Set(allowedIds);
  return citedIds.filter((id) => !allowed.has(id));
}

const CONFIRMATION_PATTERN =
  /\b(confirmed root cause|the root cause is|this confirms the (?:fault|cause)|definitely the cause)\b/i;

/** The policy layer owns confirmation. The model may never claim it. */
export function claimsConfirmation(explanation: string): boolean {
  return CONFIRMATION_PATTERN.test(explanation);
}

export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

export function guardExplanation(input: {
  explanation: string;
  citedCitationIds: readonly string[];
  allowedCitationIds: readonly string[];
  sourceText: string;
}): GuardResult {
  const reasons: string[] = [];

  const invented = findInventedCitations(
    input.citedCitationIds,
    input.allowedCitationIds,
  );
  if (invented.length > 0) {
    reasons.push(`invented citation ids: ${invented.join(", ")}`);
  }

  const unsourced = findUnsourcedMeasurements(input.explanation, input.sourceText);
  if (unsourced.length > 0) {
    reasons.push(`unsourced measurement values: ${unsourced.join(", ")}`);
  }

  if (claimsConfirmation(input.explanation)) {
    reasons.push("claimed a confirmed root cause");
  }

  return { ok: reasons.length === 0, reasons };
}
