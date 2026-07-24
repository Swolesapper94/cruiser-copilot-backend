import type { Question } from "@/types";

export interface QuestionDefinition extends Question {
  /** Adaptive gate. Receives the answers recorded so far, keyed by question id. */
  appliesWhen?: (answers: Readonly<Record<string, string>>) => boolean;
}

const STARTING_COMPLAINTS = new Set(["hard-start", "wont-start", "smoke"]);

function startingOrSmoke(answers: Readonly<Record<string, string>>): boolean {
  return STARTING_COMPLAINTS.has(answers["complaint-category"] ?? "");
}

/**
 * The supported MVP journey: hard starting plus white/grey smoke.
 * One question at a time, each with an explicit reason for being asked.
 */
export const QUESTION_BANK: QuestionDefinition[] = [
  {
    id: "complaint-category",
    prompt: "What is the Land Cruiser doing?",
    helpText: "Pick the closest match. You can add detail in the next steps.",
    kind: "single-select",
    visualFocus: "front-three-quarter",
    rationale:
      "The complaint category decides which diagnostic branch is opened and which sources are searched.",
    options: [
      { value: "wont-start", label: "Will not start" },
      { value: "hard-start", label: "Hard to start" },
      { value: "smoke", label: "Smoke" },
      { value: "power-loss", label: "Loss of power" },
      { value: "overheating", label: "Overheating" },
      { value: "noise", label: "Noise or vibration" },
      { value: "leak", label: "Fluid leak" },
      { value: "warning-light", label: "Warning light" },
      { value: "other", label: "Something else" },
    ],
  },
  {
    id: "cranking-speed",
    prompt: "Does the engine crank at normal speed?",
    helpText:
      "Normal cranking makes battery and starter problems less likely, which changes what is worth testing first.",
    kind: "single-select",
    visualFocus: "dashboard",
    rationale:
      "Cranking speed separates electrical starting problems from combustion problems before anything else is tested.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "normal", label: "Normal speed" },
      { value: "slow", label: "Slower than normal" },
      { value: "very-slow", label: "Very slow, or clicking" },
      { value: "no-crank", label: "It does not crank" },
      { value: "unknown", label: "I am not sure" },
    ],
  },
  {
    id: "does-it-start",
    prompt: "Does it eventually start?",
    kind: "single-select",
    visualFocus: "dashboard",
    rationale:
      "How long the engine cranks before firing distinguishes fuel-delivery delay from ignition-quality problems.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "starts-quickly", label: "Yes, quickly" },
      { value: "starts-after-long-crank", label: "Yes, after long cranking" },
      { value: "starts-with-aid", label: "Only with an aid or a tow" },
      { value: "never-starts", label: "No" },
    ],
  },
  {
    id: "smoke-color",
    prompt: "What colour is the smoke?",
    helpText:
      "Smoke colour is a clue, not a diagnosis. It narrows the list; it does not identify a cause.",
    kind: "single-select",
    visualFocus: "rear-exhaust",
    rationale:
      "Smoke colour groups the failure family (unburnt fuel, oil, or over-fuelling) before any component is suspected.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "white", label: "White" },
      { value: "gray", label: "Grey" },
      { value: "blue", label: "Blue" },
      { value: "black", label: "Black" },
      { value: "none", label: "No visible smoke" },
      { value: "unknown", label: "I am not sure" },
    ],
  },
  {
    id: "smoke-when-warm",
    prompt: "Does the smoke continue once the engine is warm?",
    kind: "single-select",
    visualFocus: "rear-exhaust",
    rationale:
      "Cold-only smoke and continuous smoke point at different mechanisms; this is the single most useful smoke follow-up.",
    appliesWhen: (answers) =>
      startingOrSmoke(answers) &&
      ["white", "gray", "blue", "black"].includes(answers["smoke-color"] ?? ""),
    options: [
      { value: "clears-when-warm", label: "It clears once warm" },
      { value: "continues-when-warm", label: "It continues when warm" },
      { value: "unknown", label: "I am not sure" },
    ],
  },
  {
    id: "recent-work",
    prompt: "Did the issue begin after recent work?",
    kind: "single-select",
    visualFocus: "engine-bay",
    rationale:
      "Onset after fuel-system work sharply raises the relevance of installation and timing checks.",
    appliesWhen: startingOrSmoke,
    options: [
      {
        value: "after-fuel-work",
        label: "Yes, after fuel or injection-pump work",
      },
      { value: "after-other-work", label: "Yes, after other work" },
      { value: "no-recent-work", label: "No recent work" },
      { value: "unknown", label: "I am not sure" },
    ],
  },
  {
    id: "primer-effect",
    prompt: "Does operating the hand primer change the behaviour?",
    helpText:
      "Prime until firm with the engine off, then start as usual and compare.",
    kind: "single-select",
    visualFocus: "engine-bay",
    rationale:
      "Improvement after priming is strong, cheap evidence for air ingress or fuel drain-back rather than pump timing.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "improves", label: "It starts noticeably better" },
      { value: "no-change", label: "No difference" },
      { value: "not-tried", label: "I have not tried it" },
    ],
  },
  {
    id: "smooths-after-start",
    prompt: "Does the engine smooth out shortly after starting?",
    kind: "single-select",
    visualFocus: "engine-bay",
    rationale:
      "How quickly running settles separates cold-start assistance faults from mechanical and injection faults.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "smooths-quickly", label: "Yes, within a few seconds" },
      { value: "rough-for-minutes", label: "It stays rough for minutes" },
      { value: "stays-rough", label: "It never smooths out" },
    ],
  },
  {
    id: "cold-vs-warm",
    prompt: "Is the behaviour different cold versus warm?",
    kind: "single-select",
    visualFocus: "front-three-quarter",
    rationale:
      "Temperature dependence is the main discriminator for cold-start advance and glow-plug systems.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "worse-cold", label: "Much worse when cold" },
      { value: "same", label: "About the same" },
      { value: "worse-warm", label: "Worse when warm" },
    ],
  },
  {
    id: "timing-measured",
    prompt: "Has injection-pump timing been measured on this engine?",
    kind: "single-select",
    visualFocus: "pump-detail",
    rationale:
      "A measured value outranks every appearance-based clue, so the interview checks whether one already exists.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "measured-recently", label: "Yes, recently" },
      { value: "measured-long-ago", label: "Yes, but a long time ago" },
      { value: "never-measured", label: "No" },
      { value: "unknown", label: "I am not sure" },
    ],
  },
  {
    id: "cold-start-evidence",
    prompt: "Can you provide a cold-start observation or recording?",
    helpText:
      "Media is optional. Nothing is uploaded or analysed until you explicitly choose to.",
    kind: "single-select",
    visualFocus: "rear-exhaust",
    rationale:
      "A first-start-of-the-day observation is the highest-value evidence for this complaint and costs nothing to collect.",
    appliesWhen: startingOrSmoke,
    options: [
      { value: "will-provide", label: "Yes, I can add one" },
      { value: "already-added", label: "I already added it" },
      { value: "skip", label: "Not right now" },
    ],
  },
];

export function questionById(id: string): QuestionDefinition | undefined {
  return QUESTION_BANK.find((question) => question.id === id);
}

/** Strips the runtime-only gate so the question can cross the API boundary. */
export function toWireQuestion(definition: QuestionDefinition): Question {
  const { appliesWhen: _appliesWhen, ...question } = definition;
  void _appliesWhen;
  return question;
}
