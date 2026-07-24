import type { SourceConflict, Vehicle } from "@/types";
import type { RetrievedPassage } from "./types";

function describeApplicability(entry: RetrievedPassage): string {
  const passage = entry.passage;
  const parts: string[] = [];
  if (passage.modelCodes.length) parts.push(`model ${passage.modelCodes.join("/")}`);
  if (passage.engineCodes.length) parts.push(`engine ${passage.engineCodes.join("/")}`);
  if (passage.markets.length) parts.push(`market ${passage.markets.join("/")}`);
  if (passage.pumpModels.length) parts.push(`pump ${passage.pumpModels.join("/")}`);
  if (passage.yearStart || passage.yearEnd) {
    parts.push(`years ${passage.yearStart ?? "?"}–${passage.yearEnd ?? "?"}`);
  }
  if (parts.length === 0) parts.push("no applicability metadata recorded");
  return parts.join(", ");
}

/**
 * Groups competing values for the same specification subject and reports a
 * conflict whenever more than one distinct value survives the applicability
 * filter, or whenever applicability cannot yet be settled.
 *
 * A conflict is only "resolved" when exactly one alternative is fully
 * applicable to the vehicle and it comes from the highest authority present.
 */
export function detectSpecificationConflicts(
  candidates: readonly RetrievedPassage[],
  vehicle: Vehicle,
): SourceConflict[] {
  void vehicle;

  const bySubject = new Map<string, RetrievedPassage[]>();
  for (const entry of candidates) {
    const subject = entry.passage.specificationSubject;
    if (!subject || !entry.passage.specificationValue) continue;
    if (entry.applicability.verdict === "not-applicable") continue;
    const bucket = bySubject.get(subject);
    if (bucket) bucket.push(entry);
    else bySubject.set(subject, [entry]);
  }

  const conflicts: SourceConflict[] = [];

  for (const [subject, entries] of bySubject) {
    const distinctValues = new Set(
      entries.map((entry) => entry.passage.specificationValue as string),
    );
    if (distinctValues.size < 2) continue;

    const missingApplicabilityFields = Array.from(
      new Set(entries.flatMap((entry) => entry.applicability.unresolvedFields)),
    ).sort();

    const fullyApplicable = entries.filter(
      (entry) => entry.applicability.verdict === "applicable",
    );
    const topAuthority = Math.min(
      ...entries.map((entry) => entry.document.authorityLevel),
    );
    const applicableAtTopAuthority = fullyApplicable.filter(
      (entry) => entry.document.authorityLevel === topAuthority,
    );
    const applicableValues = new Set(
      applicableAtTopAuthority.map((entry) => entry.passage.specificationValue as string),
    );

    const resolved =
      missingApplicabilityFields.length === 0 && applicableValues.size === 1;

    const anyPlaceholder = entries.some((entry) => entry.document.isPlaceholder);

    conflicts.push({
      id: `conflict-${subject}`,
      subject,
      alternatives: entries.map((entry) => ({
        value: entry.passage.specificationValue as string,
        citationId: entry.citation.id,
        applicabilitySummary: describeApplicability(entry),
      })),
      missingApplicabilityFields,
      resolutionStatus: resolved && !anyPlaceholder ? "resolved" : "unresolved",
      explanation: buildExplanation({
        subject,
        missingApplicabilityFields,
        applicableCount: applicableValues.size,
        anyPlaceholder,
      }),
    });
  }

  return conflicts.sort((a, b) => a.subject.localeCompare(b.subject));
}

function buildExplanation(input: {
  subject: string;
  missingApplicabilityFields: string[];
  applicableCount: number;
  anyPlaceholder: boolean;
}): string {
  const reasons: string[] = [];
  if (input.missingApplicabilityFields.length > 0) {
    reasons.push(
      `the vehicle record is missing ${input.missingApplicabilityFields.join(", ")}`,
    );
  }
  if (input.applicableCount > 1) {
    reasons.push("more than one source still matches this vehicle");
  }
  if (input.anyPlaceholder) {
    reasons.push("at least one record is placeholder scaffolding, not an imported source");
  }
  if (reasons.length === 0) {
    reasons.push("the sources disagree and the difference has not been explained");
  }
  return `Sources disagree on "${input.subject}". Cruiser Copilot will not choose a value because ${reasons.join("; ")}.`;
}

/** A specification may only be applied when every conflict for it is resolved. */
export function specificationIsLocked(conflicts: readonly SourceConflict[]): boolean {
  return conflicts.some((conflict) => conflict.resolutionStatus === "unresolved");
}
