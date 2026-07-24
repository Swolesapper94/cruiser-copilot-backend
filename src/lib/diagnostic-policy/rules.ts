/**
 * Deterministic hypothesis policy.
 *
 * This module owns ranking. An LLM may explain the result in plain language,
 * but it may never add, remove, reorder or confirm a hypothesis.
 *
 * Scores are relative ranking weights only. They are NOT probabilities and
 * must never be presented as a likelihood of failure.
 */

export interface HypothesisDefinition {
  id: string;
  name: string;
  summary: string;
  /** Starting weight before any evidence is applied. */
  baseWeight: number;
  /** Evidence that would materially settle this hypothesis. */
  requiredEvidence: string[];
  /** Exact-match keywords handed to retrieval. */
  searchKeywords: string[];
}

export const HYPOTHESES: HypothesisDefinition[] = [
  {
    id: "injection-timing",
    name: "Incorrect injection-pump timing",
    summary:
      "Pump timing away from the vehicle's specification delays or advances the start of injection, which shows up worst during cold cranking.",
    baseWeight: 1,
    requiredEvidence: [
      "Measured injection-pump plunger stroke at the specified crank position",
      "Confirmation of whether the pump was disturbed or re-timed",
    ],
    searchKeywords: ["injection pump timing", "plunger stroke", "static timing"],
  },
  {
    id: "air-ingress",
    name: "Air entering the fuel system",
    summary:
      "Air drawn into the low-pressure circuit, or fuel draining back to the tank while the engine is stopped, delays the establishment of injection pressure and lengthens cranking after a period of standing.",
    baseWeight: 1,
    requiredEvidence: [
      "Result of a hand-primer comparison",
      "Inspection of low-pressure joints, seals and the filter housing",
    ],
    searchKeywords: ["air ingress", "primer", "fuel drain back"],
  },
  {
    id: "acsd-fault",
    name: "Cold-start advance (ACSD) fault",
    summary:
      "A seized, disconnected or removed cold-start advance device changes cold behaviour while leaving warm running largely unaffected.",
    baseWeight: 0.9,
    requiredEvidence: [
      "Confirmation of whether the device is fitted",
      "Cold-to-warm functional check of the advance mechanism",
    ],
    searchKeywords: ["acsd", "cold start device", "advance"],
  },
  {
    id: "glow-plug-fault",
    name: "Glow-plug system fault",
    summary:
      "Weak or failed glow plugs, or a supply fault, degrade cold starting and typically improve as ambient temperature rises.",
    baseWeight: 1,
    requiredEvidence: [
      "Individual glow-plug resistance readings",
      "Supply voltage at the glow-plug bus during the preheat cycle",
    ],
    searchKeywords: ["glow plug", "preheat", "resistance"],
  },
  {
    id: "injector-fault",
    name: "Injector fault",
    summary:
      "Poor spray quality or an incorrect opening pressure produces incomplete combustion that often persists once the engine is warm.",
    baseWeight: 0.85,
    requiredEvidence: [
      "Injector opening-pressure and spray-pattern test results",
      "Cylinder contribution comparison",
    ],
    searchKeywords: ["injector", "nozzle", "opening pressure"],
  },
  {
    id: "low-compression",
    name: "Low compression",
    summary:
      "Reduced cylinder sealing lowers compression temperature and lengthens cold cranking; it cannot be judged from exhaust appearance.",
    baseWeight: 0.7,
    requiredEvidence: [
      "Compression readings for all cylinders with a known-good battery",
    ],
    searchKeywords: ["compression", "cylinder", "cranking"],
  },
  {
    id: "fuel-restriction",
    name: "Fuel restriction or incorrect fuel",
    summary:
      "A blocked filter, waxed or contaminated fuel, or a restricted pickup starves the pump, particularly at low temperature.",
    baseWeight: 0.8,
    requiredEvidence: [
      "Filter condition and fuel sample inspection",
      "Supply flow or restriction check",
    ],
    searchKeywords: ["fuel filter", "restriction", "contaminated fuel"],
  },
];

export interface ScoreEffect {
  hypothesisId: string;
  delta: number;
  /** Shown to the user as the reason this answer moved the ranking. */
  note: string;
}

export interface ScoreRule {
  questionId: string;
  value: string;
  effects: ScoreEffect[];
}

/**
 * The full, reviewable scoring table. Every movement in the ranking must be
 * traceable to one of these rows or to a measurement rule below.
 */
export const SCORE_RULES: ScoreRule[] = [
  {
    questionId: "cranking-speed",
    value: "normal",
    effects: [
      {
        hypothesisId: "low-compression",
        delta: -0.3,
        note: "Normal cranking speed makes a severe mechanical sealing problem less likely.",
      },
    ],
  },
  {
    questionId: "cranking-speed",
    value: "slow",
    effects: [
      {
        hypothesisId: "low-compression",
        delta: 0.2,
        note: "Slow cranking can accompany reduced compression, but electrical supply must be ruled out first.",
      },
    ],
  },
  {
    questionId: "does-it-start",
    value: "starts-after-long-crank",
    effects: [
      {
        hypothesisId: "air-ingress",
        delta: 0.4,
        note: "Long cranking before firing is typical of pressure having to be re-established.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.3,
        note: "Extended cranking is also consistent with insufficient preheat.",
      },
      {
        hypothesisId: "injection-timing",
        delta: 0.2,
        note: "Timing away from specification lengthens cold cranking.",
      },
    ],
  },
  {
    questionId: "smoke-color",
    value: "white",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: 0.4,
        note: "White smoke indicates unburnt fuel, which is consistent with mistimed injection.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.4,
        note: "Unburnt fuel during cold starting is also consistent with weak preheat.",
      },
      {
        hypothesisId: "injector-fault",
        delta: 0.3,
        note: "Poor atomisation produces unburnt fuel in the exhaust.",
      },
      {
        hypothesisId: "low-compression",
        delta: 0.25,
        note: "Low compression temperature leaves fuel unburnt.",
      },
    ],
  },
  {
    questionId: "smoke-color",
    value: "gray",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: 0.35,
        note: "Grey smoke also indicates incomplete combustion.",
      },
      {
        hypothesisId: "injector-fault",
        delta: 0.3,
        note: "Incomplete combustion is consistent with degraded spray quality.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.25,
        note: "Insufficient preheat produces the same appearance during cold starting.",
      },
    ],
  },
  {
    questionId: "smoke-color",
    value: "blue",
    effects: [
      {
        hypothesisId: "low-compression",
        delta: 0.4,
        note: "Blue smoke suggests oil consumption, which shifts attention to cylinder sealing.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: -0.3,
        note: "Oil-related smoke is not explained by the preheat system.",
      },
    ],
  },
  {
    questionId: "smoke-color",
    value: "black",
    effects: [
      {
        hypothesisId: "injector-fault",
        delta: 0.4,
        note: "Black smoke suggests over-fuelling or poor spray quality.",
      },
      {
        hypothesisId: "fuel-restriction",
        delta: 0.2,
        note: "Air or fuel delivery imbalance can produce black smoke.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: -0.3,
        note: "Over-fuelling is not explained by the preheat system.",
      },
    ],
  },
  {
    questionId: "smoke-when-warm",
    value: "clears-when-warm",
    effects: [
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.3,
        note: "Smoke that clears with temperature fits a cold-start assistance problem.",
      },
      {
        hypothesisId: "acsd-fault",
        delta: 0.35,
        note: "Cold-only symptoms fit a cold-start advance problem.",
      },
      {
        hypothesisId: "injector-fault",
        delta: -0.2,
        note: "A mechanical injector defect usually persists once warm.",
      },
    ],
  },
  {
    questionId: "smoke-when-warm",
    value: "continues-when-warm",
    effects: [
      {
        hypothesisId: "injector-fault",
        delta: 0.4,
        note: "Smoke that persists when warm points away from cold-start assistance.",
      },
      {
        hypothesisId: "injection-timing",
        delta: 0.35,
        note: "Mistimed injection affects warm running as well as cold starting.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: -0.45,
        note: "The preheat system is not active once the engine is warm.",
      },
      {
        hypothesisId: "acsd-fault",
        delta: -0.35,
        note: "The cold-start advance device has returned to its warm position.",
      },
    ],
  },
  {
    questionId: "recent-work",
    value: "after-fuel-work",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: 0.8,
        note: "Onset immediately after pump or fuel work makes installation and timing the first thing to verify.",
      },
      {
        hypothesisId: "air-ingress",
        delta: 0.6,
        note: "Disturbed fuel joints are the most common source of air ingress.",
      },
    ],
  },
  {
    questionId: "recent-work",
    value: "no-recent-work",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: -0.25,
        note: "Timing rarely changes on its own without the pump being disturbed.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.2,
        note: "Gradual onset without work fits a wear-related preheat problem.",
      },
    ],
  },
  {
    questionId: "primer-effect",
    value: "improves",
    effects: [
      {
        hypothesisId: "air-ingress",
        delta: 0.9,
        note: "Improvement after priming is direct evidence that fuel was not held in the circuit.",
      },
      {
        hypothesisId: "fuel-restriction",
        delta: 0.35,
        note: "Priming can also mask a supply restriction.",
      },
      {
        hypothesisId: "injection-timing",
        delta: -0.3,
        note: "Priming does not change pump timing, so the improvement is better explained elsewhere.",
      },
    ],
  },
  {
    questionId: "primer-effect",
    value: "no-change",
    effects: [
      {
        hypothesisId: "air-ingress",
        delta: -0.4,
        note: "No change after priming makes fuel drain-back less likely.",
      },
      {
        hypothesisId: "injection-timing",
        delta: 0.25,
        note: "With supply behaviour unchanged, pump-side causes carry more weight.",
      },
    ],
  },
  {
    questionId: "smooths-after-start",
    value: "smooths-quickly",
    effects: [
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.25,
        note: "Rapid smoothing fits a preheat shortfall rather than a mechanical defect.",
      },
      {
        hypothesisId: "low-compression",
        delta: -0.25,
        note: "A compression problem does not resolve within seconds.",
      },
    ],
  },
  {
    questionId: "smooths-after-start",
    value: "stays-rough",
    effects: [
      {
        hypothesisId: "injector-fault",
        delta: 0.35,
        note: "Persistent roughness fits an individual cylinder or injector defect.",
      },
      {
        hypothesisId: "low-compression",
        delta: 0.3,
        note: "Persistent roughness is also consistent with uneven cylinder sealing.",
      },
    ],
  },
  {
    questionId: "cold-vs-warm",
    value: "worse-cold",
    effects: [
      {
        hypothesisId: "acsd-fault",
        delta: 0.45,
        note: "Temperature-dependent behaviour is the signature of the cold-start advance system.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: 0.35,
        note: "Preheat problems are worst at low temperature.",
      },
      {
        hypothesisId: "injection-timing",
        delta: 0.2,
        note: "Timing error is least tolerated when the charge is cold.",
      },
    ],
  },
  {
    questionId: "cold-vs-warm",
    value: "same",
    effects: [
      {
        hypothesisId: "acsd-fault",
        delta: -0.35,
        note: "A temperature-independent symptom is not explained by cold-start advance.",
      },
      {
        hypothesisId: "glow-plug-fault",
        delta: -0.3,
        note: "The preheat system only affects cold starting.",
      },
    ],
  },
  {
    questionId: "timing-measured",
    value: "never-measured",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: 0.15,
        note: "Timing has never been verified on this engine, so it remains unexcluded.",
      },
    ],
  },
  {
    questionId: "timing-measured",
    value: "measured-recently",
    effects: [
      {
        hypothesisId: "injection-timing",
        delta: -0.2,
        note: "A recent measurement exists; the recorded value still has to be checked against the applicable specification.",
      },
    ],
  },
];

export interface MeasurementRule {
  key: string;
  hypothesisId: string;
  /** Applied when a measurement with this key has been recorded. */
  delta: number;
  note: string;
  /** Marks the hypothesis as tested rather than merely suspected. */
  marksTested: boolean;
  /** The value cannot be interpreted until applicability is settled. */
  requiresApplicability: boolean;
}

export const MEASUREMENT_RULES: MeasurementRule[] = [
  {
    key: "plunger-stroke",
    hypothesisId: "injection-timing",
    delta: 0.6,
    note: "A measured plunger stroke is stronger evidence than any appearance-based clue.",
    marksTested: true,
    requiresApplicability: true,
  },
  {
    key: "glow-plug-resistance",
    hypothesisId: "glow-plug-fault",
    delta: 0.5,
    note: "Measured glow-plug resistance directly tests the preheat circuit.",
    marksTested: true,
    requiresApplicability: false,
  },
  {
    key: "compression",
    hypothesisId: "low-compression",
    delta: 0.6,
    note: "Measured compression directly tests cylinder sealing.",
    marksTested: true,
    requiresApplicability: true,
  },
];

/** Evidence types that only ever add context, never a conclusion. */
export const NON_DIAGNOSTIC_EVIDENCE_TYPES = new Set([
  "photo",
  "video",
  "audio",
]);
