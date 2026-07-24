import type { RecommendedTest } from "@/types";

export interface DiagnosticTestDefinition extends RecommendedTest {
  /** Effort/cost weight used by the next-best-test selector. */
  effortCost: number;
}

/**
 * Tool names are deliberately generic. Exact special-service-tool numbers are
 * withheld until a licensed Toyota source is imported.
 */
export const DIAGNOSTIC_TESTS: DiagnosticTestDefinition[] = [
  {
    id: "prime-and-inspect-low-pressure",
    name: "Hand-prime comparison and low-pressure circuit inspection",
    reason: "",
    difficulty: "basic",
    estimatedMinutes: 30,
    effortCost: 1,
    requiredTools: ["Basic hand tools", "Clean rag and catch tray"],
    safetyWarnings: [
      "Diesel fuel is a skin and fire hazard. No ignition sources, and wear eye protection.",
      "Relieve fuel-system pressure before opening any joint.",
    ],
    possibleInterpretations: [
      "Improvement after priming supports air ingress or drain-back.",
      "No improvement makes supply-side causes less likely but does not exclude them.",
      "Visible weeping at a joint is a finding, not yet a confirmed root cause.",
    ],
    targetsHypothesisIds: ["air-ingress", "fuel-restriction"],
  },
  {
    id: "glow-plug-resistance",
    name: "Measure glow-plug resistance and preheat supply",
    reason: "",
    difficulty: "basic",
    estimatedMinutes: 45,
    effortCost: 1.2,
    requiredTools: ["Multimeter", "Basic hand tools"],
    safetyWarnings: [
      "Disconnect the preheat supply before touching the bus bar.",
      "Work on a cold engine; the glow-plug area stays hot for a long time.",
    ],
    possibleInterpretations: [
      "An out-of-range plug supports a preheat fault.",
      "All plugs in range makes a preheat fault unlikely without excluding the controller or supply.",
    ],
    targetsHypothesisIds: ["glow-plug-fault"],
  },
  {
    id: "acsd-function-check",
    name: "Check cold-start advance device fitment and movement",
    reason: "",
    difficulty: "intermediate",
    estimatedMinutes: 45,
    effortCost: 1.6,
    requiredTools: ["Basic hand tools", "Infrared or contact thermometer"],
    safetyWarnings: [
      "Do not open a hot, pressurised cooling system.",
      "Keep hands clear of the fan and belts whenever the engine may start.",
    ],
    possibleInterpretations: [
      "A device that is absent or seized supports a cold-start advance fault.",
      "Normal movement reduces, but does not eliminate, the cold-advance hypothesis.",
    ],
    targetsHypothesisIds: ["acsd-fault", "injection-timing"],
  },
  {
    id: "measure-plunger-stroke",
    name: "Measure injection-pump plunger stroke at the specified crank position",
    reason: "",
    difficulty: "advanced",
    estimatedMinutes: 120,
    effortCost: 2.4,
    requiredTools: [
      "Dial indicator with a suitable pump adapter",
      "Means of accurately setting crank position",
      "Basic hand tools",
    ],
    safetyWarnings: [
      "Work on a cold engine.",
      "Relieve fuel-system pressure before removing the pump head plug.",
      "Never work under an unsupported vehicle.",
      "Do not disturb the pump mounting until the current value has been recorded.",
    ],
    possibleInterpretations: [
      "A measured value outside the applicable specification supports the timing hypothesis.",
      "A value inside specification largely excludes static timing and redirects effort.",
      "A value cannot be interpreted at all until the applicable specification is resolved for this exact vehicle.",
    ],
    targetsHypothesisIds: ["injection-timing", "acsd-fault"],
    procedureId: "proc-injection-pump-timing",
  },
  {
    id: "compression-test",
    name: "Compression test, all cylinders",
    reason: "",
    difficulty: "advanced",
    estimatedMinutes: 150,
    effortCost: 2.6,
    requiredTools: [
      "Diesel compression gauge with the correct adapter",
      "Known-good battery or support supply",
    ],
    safetyWarnings: [
      "Disable fuel delivery before extended cranking.",
      "Work on a cold engine and keep clear of rotating parts.",
    ],
    possibleInterpretations: [
      "Low or uneven readings support a mechanical sealing problem.",
      "Even, healthy readings largely exclude low compression as the cause.",
    ],
    targetsHypothesisIds: ["low-compression"],
  },
  {
    id: "injector-bench-test",
    name: "Injector opening-pressure and spray-pattern test",
    reason: "",
    difficulty: "advanced",
    estimatedMinutes: 180,
    effortCost: 2.8,
    requiredTools: ["Injector test bench or pop tester", "Basic hand tools"],
    safetyWarnings: [
      "Injector spray penetrates skin. Never place any part of your body in the spray path.",
      "Use eye protection and an enclosed test rig.",
    ],
    possibleInterpretations: [
      "Out-of-range opening pressure or poor pattern supports an injector fault.",
      "Good results redirect effort to timing, preheat or compression.",
    ],
    targetsHypothesisIds: ["injector-fault"],
  },
  {
    id: "fuel-filter-and-sample",
    name: "Inspect fuel filter, water trap and take a fuel sample",
    reason: "",
    difficulty: "basic",
    estimatedMinutes: 25,
    effortCost: 0.9,
    requiredTools: ["Basic hand tools", "Clear sample container"],
    safetyWarnings: [
      "Diesel fuel is a skin and fire hazard. No ignition sources.",
      "Dispose of drained fuel and filters correctly.",
    ],
    possibleInterpretations: [
      "Contamination, water or waxing supports a fuel-supply cause.",
      "Clean fuel and a serviceable filter reduce the supply hypotheses.",
    ],
    targetsHypothesisIds: ["fuel-restriction", "air-ingress"],
  },
];

export function testById(id: string): DiagnosticTestDefinition | undefined {
  return DIAGNOSTIC_TESTS.find((test) => test.id === id);
}

export function toRecommendedTest(
  definition: DiagnosticTestDefinition,
  reason: string,
): RecommendedTest {
  const { effortCost: _effortCost, ...rest } = definition;
  void _effortCost;
  return { ...rest, reason };
}
