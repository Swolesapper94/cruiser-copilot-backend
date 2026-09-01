import { z } from "zod";

/**
 * Single source of truth for Cruiser Copilot domain shapes.
 *
 * Everything that crosses a trust boundary (HTTP request body, LLM output,
 * imported source data) MUST be parsed through these schemas before it is
 * allowed to touch application state.
 */

/* ------------------------------------------------------------------ */
/* Vehicle                                                             */
/* ------------------------------------------------------------------ */

export const seriesSchema = z.string().min(1).max(32);
export const engineCodeSchema = z.string().min(1).max(64);
export const acsdSchema = z.enum(["present", "absent", "unknown"]);
export const identificationConfidenceSchema = z.enum([
  "user-confirmed",
  "inferred",
  "unknown",
]);

export const vehicleSchema = z.object({
  id: z.string().min(1),
  manufacturer: z.string().max(64).optional(),
  modelName: z.string().max(80).optional(),
  submodel: z.string().max(80).optional(),
  vin: z.string().max(32).optional(),
  series: seriesSchema,
  modelCode: z.string().max(32).optional(),
  chassisCode: z.string().max(32).optional(),
  productionYear: z.number().int().min(1960).max(2100).optional(),
  productionDate: z.string().date().optional(),
  market: z.string().max(64).optional(),
  engineCode: engineCodeSchema,
  transmission: z.string().max(64).optional(),
  pumpModel: z.string().max(64).optional(),
  emissionsConfiguration: z.string().max(120).optional(),
  acsdConfiguration: acsdSchema.optional(),
  modifications: z.array(z.string().max(160)).default([]),
  identificationConfidence: identificationConfidenceSchema,
});

export type Vehicle = z.infer<typeof vehicleSchema>;

/**
 * Structured query sent to evidence retrieval. The complaint and media-derived
 * observations remain distinct so a model observation cannot overwrite what
 * the user actually reported.
 */
export const diagnosticCaseQuerySchema = z.object({
  vehicle: vehicleSchema,
  complaint: z.string().min(1).max(4000),
  symptomTerms: z.array(z.string().min(1).max(120)).default([]),
  affectedSystems: z.array(z.string().min(1).max(120)).default([]),
  diagnosticCodes: z.array(z.string().min(1).max(64)).default([]),
  userObservations: z.array(z.string().min(1).max(500)).default([]),
  machineObservations: z.array(z.string().min(1).max(500)).default([]),
  requestedSpecificationSubject: z.string().max(160).optional(),
  missingApplicabilityFields: z.array(z.string().min(1)).default([]),
});

export type DiagnosticCaseQuery = z.infer<typeof diagnosticCaseQuerySchema>;

/** Fields that must be known before an exact specification may be selected. */
export const APPLICABILITY_FIELDS = [
  "manufacturer",
  "modelName",
  "submodel",
  "series",
  "modelCode",
  "productionYear",
  "productionDate",
  "market",
  "engineCode",
  "pumpModel",
  "emissionsConfiguration",
  "acsdConfiguration",
] as const;

export type ApplicabilityField = (typeof APPLICABILITY_FIELDS)[number];

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export const sourceTypeSchema = z.enum([
  "service_bulletin",
  "oem_manual",
  "oem_technical",
  "verified_case",
  "technician",
  "forum",
  "general",
]);

export const licenseStatusSchema = z.enum([
  "owned",
  "licensed",
  "permission_granted",
  "unknown",
]);

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  sourceType: sourceTypeSchema,
  title: z.string().min(1),
  manufacturer: z.string().optional(),
  documentNumber: z.string().optional(),
  revision: z.string().optional(),
  publicationDate: z.string().optional(),
  url: z.string().url().optional(),
  /** 1 = highest authority. See lib/retrieval/authority.ts */
  authorityLevel: z.number().int().min(1).max(7),
  licenseStatus: licenseStatusSchema,
  /**
   * True when the record is scaffolding rather than a real ingested document.
   * Placeholder records may never be presented as a Toyota specification.
   */
  isPlaceholder: z.boolean().default(false),
});

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const sourcePassageSchema = z.object({
  id: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  text: z.string().min(1),
  pageNumber: z.number().int().positive().optional(),
  section: z.string().optional(),
  postNumber: z.string().optional(),
  manufacturers: z.array(z.string()).default([]),
  modelNames: z.array(z.string()).default([]),
  submodels: z.array(z.string()).default([]),
  modelCodes: z.array(z.string()).default([]),
  engineCodes: z.array(z.string()).default([]),
  markets: z.array(z.string()).default([]),
  yearStart: z.number().int().optional(),
  yearEnd: z.number().int().optional(),
  pumpModels: z.array(z.string()).default([]),
  acsdStates: z.array(acsdSchema).default([]),
  emissionsConfigurations: z.array(z.string()).default([]),
  diagramRef: z.string().optional(),
  /** Free-form keywords used by the exact-match stage of retrieval. */
  keywords: z.array(z.string()).default([]),
  /** Subject key used to group competing specification values. */
  specificationSubject: z.string().optional(),
  /** Verbatim specification value, or a clearly labelled placeholder. */
  specificationValue: z.string().optional(),
});

export type SourcePassage = z.infer<typeof sourcePassageSchema>;

export const citationSchema = z.object({
  id: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  sourcePassageId: z.string().min(1),
  label: z.string().min(1),
  locator: z.string().min(1),
  sourceType: sourceTypeSchema,
  authorityLevel: z.number().int().min(1).max(7),
  url: z.string().url().optional(),
  isPlaceholder: z.boolean().default(false),
});

export type Citation = z.infer<typeof citationSchema>;

export const sourceConflictSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  alternatives: z
    .array(
      z.object({
        value: z.string().min(1),
        citationId: z.string().min(1),
        applicabilitySummary: z.string().min(1),
      }),
    )
    .min(2),
  missingApplicabilityFields: z.array(z.string()).default([]),
  resolutionStatus: z.enum(["unresolved", "resolved"]),
  explanation: z.string().min(1),
});

export type SourceConflict = z.infer<typeof sourceConflictSchema>;

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export const evidenceTypeSchema = z.enum([
  "photo",
  "video",
  "audio",
  "measurement",
  "code",
  "observation",
]);

export const captureConditionsSchema = z.object({
  engineTemperature: z.enum(["cold", "warm", "unknown"]).default("unknown"),
  timing: z.string().max(160).optional(),
  relationToRepair: z.enum(["before", "after", "unknown"]).default("unknown"),
});

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  type: evidenceTypeSchema,
  userDescription: z.string().max(2000).optional(),
  machineObservation: z.string().max(2000).optional(),
  observationLimit: z.string().max(500).optional(),
  captureConditions: captureConditionsSchema.optional(),
  provenance: z.enum(["user", "model"]),
  fileName: z.string().max(240).optional(),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  /** Machine-readable facts derived from a measurement, when applicable. */
  measurement: z
    .object({
      key: z.string().min(1),
      value: z.number(),
      unit: z.string().min(1),
    })
    .optional(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/* ------------------------------------------------------------------ */
/* Interview                                                           */
/* ------------------------------------------------------------------ */

export const diagnosticAnswerSchema = z.object({
  questionId: z.string().min(1),
  value: z.string().min(1),
  freeText: z.string().max(2000).optional(),
  answeredAt: z.string(),
});

export type DiagnosticAnswer = z.infer<typeof diagnosticAnswerSchema>;

export const visualFocusSchema = z.enum([
  "front-three-quarter",
  "driver-side",
  "rear-three-quarter",
  "rear-exhaust",
  "engine-bay",
  "dashboard",
  "pump-detail",
]);

export type VisualFocus = z.infer<typeof visualFocusSchema>;

export const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  helpText: z.string().optional(),
  kind: z.enum(["single-select", "free-text"]),
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
  visualFocus: visualFocusSchema,
  /** Why the interview is asking this now. Shown to the user on request. */
  rationale: z.string().min(1),
});

export type Question = z.infer<typeof questionSchema>;

/* ------------------------------------------------------------------ */
/* Hypotheses and tests                                                */
/* ------------------------------------------------------------------ */

export const hypothesisStatusSchema = z.enum([
  "untested",
  "partially-tested",
  "supported",
  "contradicted",
  "confirmed",
]);

export const evidenceLinkSchema = z.object({
  /** `answer:<questionId>` or an evidence item id. */
  ref: z.string().min(1),
  label: z.string().min(1),
  direction: z.enum(["supports", "contradicts", "context"]),
  note: z.string().min(1),
});

export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;

export const hypothesisSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  /** Relative ranking weight in [0,1]. NOT a calibrated probability. */
  relativeScore: z.number().min(0).max(1),
  status: hypothesisStatusSchema,
  supportingEvidenceIds: z.array(z.string()).default([]),
  contradictingEvidenceIds: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  rationale: z.array(evidenceLinkSchema).default([]),
});

export type Hypothesis = z.infer<typeof hypothesisSchema>;

export const recommendedTestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  reason: z.string().min(1),
  difficulty: z.enum(["basic", "intermediate", "advanced"]),
  estimatedMinutes: z.number().int().positive(),
  requiredTools: z.array(z.string()).default([]),
  safetyWarnings: z.array(z.string()).default([]),
  possibleInterpretations: z.array(z.string()).default([]),
  /** Procedure that this test opens, when one exists. */
  procedureId: z.string().optional(),
  targetsHypothesisIds: z.array(z.string()).default([]),
});

export type RecommendedTest = z.infer<typeof recommendedTestSchema>;

/* ------------------------------------------------------------------ */
/* Procedures                                                          */
/* ------------------------------------------------------------------ */

export const procedureStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  instruction: z.string().min(1),
  /** OEM-sourced detail. Never mixed with community content. */
  oemNotes: z.array(z.string()).default([]),
  /** Community/technician tips, always rendered as a separate block. */
  communityTips: z.array(z.string()).default([]),
  specificationSubject: z.string().optional(),
  requiredTools: z.array(z.string()).default([]),
  safetyWarnings: z.array(z.string()).default([]),
  stopConditions: z.array(z.string()).default([]),
  photoCheckpoint: z.string().optional(),
  diagramRef: z.string().optional(),
  citationIds: z.array(z.string()).default([]),
});

export type ProcedureStep = z.infer<typeof procedureStepSchema>;

export const procedureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  appliesTo: z.object({
    series: z.array(seriesSchema),
    engineCodes: z.array(engineCodeSchema),
  }),
  difficulty: z.enum(["basic", "intermediate", "advanced"]),
  estimatedMinutes: z.number().int().positive(),
  globalSafetyWarnings: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  steps: z.array(procedureStepSchema).min(1),
  validationSteps: z.array(z.string()).min(1),
  visualFocus: visualFocusSchema,
});

export type Procedure = z.infer<typeof procedureSchema>;

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export const sessionStageSchema = z.enum([
  "vehicle",
  "symptoms",
  "evidence",
  "testing",
  "repair",
  "complete",
]);

export const outcomeSchema = z.object({
  resolved: z.enum(["yes", "no", "partially", "unknown"]),
  performedTestIds: z.array(z.string()).default([]),
  notes: z.string().max(4000).optional(),
  recordedAt: z.string(),
});

export type Outcome = z.infer<typeof outcomeSchema>;

export const diagnosticSessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  vehicle: vehicleSchema,
  complaint: z.string().max(4000).default(""),
  stage: sessionStageSchema,
  answers: z.array(diagnosticAnswerSchema).default([]),
  evidence: z.array(evidenceItemSchema).default([]),
  completedStepIds: z.array(z.string()).default([]),
  outcome: outcomeSchema.optional(),
  mode: z.enum(["scripted", "live"]),
});

export type DiagnosticSession = z.infer<typeof diagnosticSessionSchema>;

/* ------------------------------------------------------------------ */
/* Diagnostic update (the only contract the UI reads for workflow)     */
/* ------------------------------------------------------------------ */

export const safetyGateSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "caution", "blocking"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  missingApplicabilityFields: z.array(z.string()).default([]),
});

export type SafetyGate = z.infer<typeof safetyGateSchema>;

export const diagnosticUpdateSchema = z.object({
  vehicleStatus: z.object({
    identified: z.boolean(),
    missingFields: z.array(z.string()).default([]),
  }),
  summary: z.string().min(1),
  /** Plain-language explanation. May come from an LLM; never drives state. */
  explanation: z.string().optional(),
  explanationSource: z.enum(["scripted", "model"]).default("scripted"),
  hypotheses: z.array(hypothesisSchema),
  nextQuestion: questionSchema.nullable(),
  recommendedTest: recommendedTestSchema.nullable(),
  sourceConflicts: z.array(sourceConflictSchema).default([]),
  citations: z.array(citationSchema).default([]),
  safetyGates: z.array(safetyGateSchema).default([]),
  /** True when a specification value must not be selected yet. */
  specificationLocked: z.boolean(),
  stage: sessionStageSchema,
  progress: z.object({
    vehicleIdentified: z.boolean(),
    symptomsCaptured: z.boolean(),
    evidenceCaptured: z.boolean(),
    testingStarted: z.boolean(),
    outcomeRecorded: z.boolean(),
  }),
});

export type DiagnosticUpdate = z.infer<typeof diagnosticUpdateSchema>;

/* ------------------------------------------------------------------ */
/* API request bodies                                                  */
/* ------------------------------------------------------------------ */

export const createSessionRequestSchema = z.object({
  complaint: z.string().max(4000).optional(),
});

export const patchVehicleRequestSchema = vehicleSchema
  .omit({ id: true })
  .partial()
  .extend({ modifications: z.array(z.string().max(160)).optional() });

export const postAnswerRequestSchema = z.object({
  questionId: z.string().min(1),
  value: z.string().min(1),
  freeText: z.string().max(2000).optional(),
});

export const postEvidenceRequestSchema = z.object({
  type: evidenceTypeSchema,
  userDescription: z.string().max(2000).optional(),
  captureConditions: captureConditionsSchema.partial().optional(),
  fileName: z.string().max(240).optional(),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  measurement: z
    .object({
      key: z.string().min(1),
      value: z.number(),
      unit: z.string().min(1),
    })
    .optional(),
  /** User must explicitly consent before any media leaves the device. */
  allowModelAnalysis: z.boolean().default(false),
});

export const postOutcomeRequestSchema = z.object({
  resolved: z.enum(["yes", "no", "partially", "unknown"]),
  performedTestIds: z.array(z.string()).optional(),
  notes: z.string().max(4000).optional(),
});

export const postStepRequestSchema = z.object({
  stepId: z.string().min(1),
  completed: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* LLM boundary                                                        */
/* ------------------------------------------------------------------ */

/**
 * The model may only return explanatory prose plus references to citation IDs
 * that were supplied in its context. It cannot rank, confirm, or navigate.
 */
export const modelExplanationSchema = z.object({
  explanation: z.string().min(1).max(2000),
  citedCitationIds: z.array(z.string()).default([]),
  observations: z.array(z.string()).default([]),
  reportedConflicts: z.array(z.string()).default([]),
  missingApplicabilityFields: z.array(z.string()).default([]),
});

export type ModelExplanation = z.infer<typeof modelExplanationSchema>;

export const mediaObservationOutputSchema = z.object({
  observations: z.array(z.string().min(1)).max(10),
  observationLimit: z.string().min(1),
  /** Must always be false: media alone never establishes a root cause. */
  isDiagnosis: z.literal(false),
});

export type MediaObservationOutput = z.infer<typeof mediaObservationOutputSchema>;
