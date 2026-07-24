import type { Procedure } from "@/types";
import { procedureSchema } from "@/lib/validation/schemas";
import { z } from "zod";

/**
 * Guided procedures.
 *
 * OEM content and community content are stored in separate fields so that the
 * UI can never accidentally present forum advice as a Toyota instruction.
 * Until licensed source pages are imported, OEM notes describe the *shape* of
 * the factory step without reproducing wording, figures or values.
 */
const rawProcedures = [
  {
    id: "proc-injection-pump-timing",
    title: "Inspect injection-pump timing (plunger stroke)",
    summary:
      "Measure the pump plunger stroke at the specified crank position and compare it with the specification that applies to this exact vehicle. Adjustment is a separate decision that only follows a valid measurement.",
    appliesTo: {
      series: ["70", "80"],
      engineCodes: ["1HZ", "1HD-T"],
    },
    difficulty: "advanced",
    estimatedMinutes: 120,
    visualFocus: "pump-detail",
    requiredTools: [
      "Dial indicator with a suitable pump adapter",
      "Means of accurately setting crank position",
      "Basic hand tools",
      "Clean rag, catch tray and sealing hardware",
    ],
    globalSafetyWarnings: [
      "Work on a cold engine.",
      "Never work under an unsupported vehicle. Use rated stands.",
      "Relieve fuel-system pressure before opening any fuel joint.",
      "Do not open a hot, pressurised cooling system.",
      "Stop if the pump has been previously modified or if any fastener does not behave as expected.",
    ],
    validationSteps: [
      "Inspect every disturbed joint for weeping with the system primed and the engine stopped.",
      "Prime the system and confirm no air is drawn in at the disturbed joints.",
      "Start the engine and confirm behaviour against the original complaint.",
      "Re-check for leaks after the engine has reached operating temperature and cooled again.",
      "Record the outcome in the session so the result is preserved.",
    ],
    steps: [
      {
        id: "step-1-prepare",
        order: 1,
        instruction:
          "Confirm the vehicle record is complete and the engine is cold before touching anything.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure begins by identifying the exact vehicle and confirming the specification that applies to it.",
        ],
        communityTips: [],
        requiredTools: [],
        safetyWarnings: ["Work on a cold engine."],
        stopConditions: [
          "Stop if the series, engine, production date, destination or pump model are still unknown.",
        ],
        citationIds: ["cit-psg-oem-timing-safety"],
      },
      {
        id: "step-2-resolve-spec",
        order: 2,
        instruction:
          "Resolve the applicable plunger-stroke specification for this vehicle before any measurement is interpreted.",
        oemNotes: [
          "PLACEHOLDER: the factory value depends on model code, production period and destination.",
        ],
        communityTips: [],
        specificationSubject: "injection-pump-plunger-stroke-at-tdc",
        requiredTools: [],
        safetyWarnings: [],
        stopConditions: [
          "Stop if more than one candidate specification still applies to this vehicle.",
          "Stop if the only available sources are placeholder records.",
        ],
        citationIds: [
          "cit-psg-spec-plunger-hdj80-early",
          "cit-psg-spec-plunger-hdj80-late-eu",
        ],
      },
      {
        id: "step-3-access",
        order: 3,
        instruction:
          "Gain access to the pump's distributive head plug and protect the surrounding area from debris.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure specifies which components are removed for access and how the area is protected.",
        ],
        communityTips: [
          "Owners report moving a small number of hoses first and taping over openings so dropped hardware cannot fall into the valley. Access advice only.",
        ],
        requiredTools: ["Basic hand tools", "Clean rag and catch tray"],
        safetyWarnings: [
          "Diesel fuel is a skin and fire hazard. No ignition sources.",
          "Relieve fuel-system pressure before removing the plug.",
        ],
        stopConditions: [
          "Stop if the plug is seized or the sealing surface is damaged.",
        ],
        photoCheckpoint: "Photograph the pump area before removing anything.",
        citationIds: ["cit-psg-forum-timing-tip", "cit-psg-oem-timing-safety"],
      },
      {
        id: "step-4-set-position",
        order: 4,
        instruction:
          "Set the engine to the crank position required by the procedure, on the correct stroke.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure defines the exact crank position and how the correct stroke is confirmed.",
        ],
        communityTips: [],
        requiredTools: ["Means of accurately setting crank position"],
        safetyWarnings: [
          "Keep hands clear of belts and the fan.",
          "Ensure the engine cannot be started while you are working.",
        ],
        stopConditions: [
          "Stop if the correct stroke cannot be positively confirmed.",
        ],
        diagramRef: "placeholder-diagram-pump-timing",
        citationIds: ["cit-psg-oem-timing-procedure"],
      },
      {
        id: "step-5-measure",
        order: 5,
        instruction:
          "Fit the dial indicator, zero it as the procedure requires, and record the plunger stroke you measure.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure defines the zeroing method and the reading point.",
        ],
        communityTips: [],
        specificationSubject: "injection-pump-plunger-stroke-at-tdc",
        requiredTools: ["Dial indicator with a suitable pump adapter"],
        safetyWarnings: [],
        stopConditions: [
          "Stop if the indicator cannot be seated squarely or the reading is unstable.",
        ],
        photoCheckpoint: "Photograph the indicator reading before removing it.",
        citationIds: ["cit-psg-oem-timing-procedure"],
      },
      {
        id: "step-6-interpret",
        order: 6,
        instruction:
          "Compare the measured value with the applicable specification. Do not adjust anything until the comparison is valid.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure states how far the measured value may deviate before adjustment is indicated.",
        ],
        communityTips: [
          "Community threads describe deliberately running values away from the factory figure to change cold-start or economy behaviour. This is not a Toyota instruction and may not be legal or safe for your vehicle.",
        ],
        specificationSubject: "injection-pump-plunger-stroke-at-tdc",
        requiredTools: [],
        safetyWarnings: [],
        stopConditions: [
          "Stop if the applicable specification is still locked.",
          "Stop and escalate if the measured value is far outside any candidate specification.",
        ],
        citationIds: [
          "cit-psg-spec-plunger-hdj80-early",
          "cit-psg-spec-plunger-forum-claim",
        ],
      },
      {
        id: "step-7-reassemble",
        order: 7,
        instruction:
          "Refit the plug with new sealing hardware, restore everything you removed, and prime the system.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure specifies the sealing hardware and tightening requirement. No torque figure is shown until a licensed source is imported.",
        ],
        communityTips: [],
        requiredTools: ["Basic hand tools"],
        safetyWarnings: [
          "Do not guess a torque figure. Stop if the applicable value is unavailable.",
        ],
        stopConditions: [
          "Stop if the correct sealing hardware is not available.",
        ],
        citationIds: ["cit-psg-oem-timing-safety"],
      },
      {
        id: "step-8-validate",
        order: 8,
        instruction:
          "Check for leaks, start the engine, and compare the behaviour with the original complaint.",
        oemNotes: [
          "PLACEHOLDER: the factory procedure closes with a leak check and a functional confirmation.",
        ],
        communityTips: [],
        requiredTools: [],
        safetyWarnings: [
          "Keep clear of the engine bay during the first start after fuel work.",
        ],
        stopConditions: [
          "Stop immediately if fuel weeps from any disturbed joint.",
        ],
        photoCheckpoint: "Photograph the disturbed joints after the first start.",
        citationIds: ["cit-psg-oem-timing-safety"],
      },
    ],
  },
];

export const PROCEDURES: Procedure[] = z.array(procedureSchema).parse(rawProcedures);

export function getProcedure(id: string): Procedure | undefined {
  return PROCEDURES.find((procedure) => procedure.id === id);
}
