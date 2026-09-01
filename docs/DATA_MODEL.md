# Data model

Every shape is defined once, as a zod schema, in
`src/lib/validation/schemas.ts`. Types are inferred from the schemas — there is
no second, hand-written definition that can drift on the backend.

(The separate `cruiser-copilot-frontend` repository keeps its own hand-written
TypeScript mirror of the response shapes below, since it never runs zod itself
— it only ever receives already-validated JSON from this API.)

Anything crossing a trust boundary (HTTP request body, model response, stored
session) is parsed, not cast.

## Vehicle

```ts
Vehicle {
  id, manufacturer?, modelName?, submodel?, vin?, series,
  modelCode?, chassisCode?, productionYear?, productionDate?, market?,
  engineCode, transmission?, pumpModel?, emissionsConfiguration?,
  acsdConfiguration?: "present" | "absent" | "unknown",
  modifications: string[],
  identificationConfidence: "user-confirmed" | "inferred" | "unknown"
}
```

`APPLICABILITY_FIELDS` includes identity, production, market, engine and
configuration-sensitive fields. A visual inference is never equivalent to a VIN
decode or user confirmation.

## Diagnostic retrieval query

```
DiagnosticCaseQuery {
  vehicle, complaint, symptomTerms[], affectedSystems[], diagnosticCodes[],
  userObservations[], machineObservations[],
  requestedSpecificationSubject?, missingApplicabilityFields[]
}
```

The complaint acts like an incoming service ticket. Structured identity fields
filter and rerank candidates; symptoms and observations drive exact and semantic
retrieval. User statements and machine observations remain separate.

## Source-neutral evidence extraction

`evidence-extraction.v2` uses `content_units` instead of requiring forum posts:

```
Document -> ContentUnit (forum_post|manual_page|manual_section|...)
         -> Block (heading|paragraph|notice|warning|specification|procedure_step|...)
         -> Observation / atomic Claim / ProcedureFragment
```

Every independently applicable numeric range is a separate claim with
`value_numeric_min`, `value_numeric_max`, a verbatim unit, applicability, claim
basis and a source-block citation.

## Sources

```
SourceDocument { id, title, sourceType, publisher?, edition?, url?,
                 licenseStatus, authorityLevel: 1..7, isPlaceholder }
SourcePassage  { id, sourceDocumentId, text, section?, pageNumber?, postNumber?,
                 modelCodes[], engineCodes[], markets[], pumpModels[],
                 yearStart?, yearEnd?, keywords[],
                 specificationSubject?, specificationValue? }
Citation       { id, sourceDocumentId, sourcePassageId, label, locator,
                 sourceType, authorityLevel, url?, isPlaceholder }
SourceConflict { id, subject, alternatives[≥2], missingApplicabilityFields[],
                 resolutionStatus, explanation }
```

## Evidence

```
EvidenceItem { id, type: photo|video|audio|measurement|code|observation,
               userDescription?, machineObservation?, observationLimit?,
               captureConditions?, provenance: "user" | "model",
               fileName?, mimeType?, sizeBytes?, createdAt,
               measurement?: { key, value, unit } }
```

`provenance` keeps what the user observed separate from what a model observed.
`captureConditions` records engine temperature, timing and whether the capture
was before or after work.

## Diagnosis

```
Hypothesis     { id, name, summary, relativeScore 0..1, status,
                 supportingEvidenceIds[], contradictingEvidenceIds[],
                 missingEvidence[], rationale: EvidenceLink[] }
EvidenceLink   { ref, label, direction: supports|contradicts|context, note }
RecommendedTest{ id, name, reason, difficulty, estimatedMinutes, requiredTools[],
                 safetyWarnings[], possibleInterpretations[], procedureId?,
                 targetsHypothesisIds[] }
SafetyGate     { id, severity: info|caution|blocking, title, detail,
                 missingApplicabilityFields[] }
```

## Procedures

```
Procedure     { id, title, summary, appliesTo{series[], engineCodes[]},
                difficulty, estimatedMinutes, globalSafetyWarnings[],
                requiredTools[], steps[≥1], validationSteps[≥1], visualFocus }
ProcedureStep { id, order, instruction, oemNotes[], communityTips[],
                specificationSubject?, requiredTools[], safetyWarnings[],
                stopConditions[], photoCheckpoint?, diagramRef?, citationIds[] }
```

`oemNotes` and `communityTips` are separate arrays by design.

## Session

```
DiagnosticSession { id, createdAt, updatedAt, vehicle, complaint,
                    stage: vehicle|symptoms|evidence|testing|repair|complete,
                    answers[], evidence[], completedStepIds[], outcome?,
                    mode: "scripted" | "live" }
```

`stage` is always derived by the policy layer. The client cannot set it.

## The wire contract

`DiagnosticUpdate` is what every mutating endpoint returns:

```
{ vehicleStatus{identified, missingFields}, summary, explanation?,
  explanationSource: "scripted" | "model",
  hypotheses[], nextQuestion|null, recommendedTest|null,
  sourceConflicts[], citations[], safetyGates[], specificationLocked,
  stage, progress{...} }
```

## Model boundary

```
ModelExplanation      { explanation, citedCitationIds[], observations[],
                        reportedConflicts[], missingApplicabilityFields[] }
MediaObservationOutput{ observations[≤10], observationLimit,
                        isDiagnosis: z.literal(false) }
```

`isDiagnosis` is a literal `false`: a media response that claims to be a
diagnosis fails to parse and is discarded.
