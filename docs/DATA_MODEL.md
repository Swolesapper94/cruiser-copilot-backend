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
  id, series: "70" | "80" | "unknown",
  modelCode?, chassisCode?, productionYear?, market?,
  engineCode: "1HZ" | "1HD-T" | "unknown",
  transmission?, pumpModel?,
  acsdConfiguration?: "present" | "absent" | "unknown",
  modifications: string[],
  identificationConfidence: "user-confirmed" | "inferred" | "unknown"
}
```

`APPLICABILITY_FIELDS` lists the seven fields that decide which published value
applies: `series`, `modelCode`, `productionYear`, `market`, `engineCode`,
`pumpModel`, `acsdConfiguration`.

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
