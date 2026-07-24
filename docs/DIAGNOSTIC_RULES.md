# Diagnostic rules

Everything that decides what the API returns is deterministic, inspectable and
lives in `src/lib/diagnostic-policy/`. The language model has no influence over
any of it.

## Interview

`questions.ts` holds an ordered bank of questions. Each has:

- a `prompt` and optional `helpText`,
- a `visualFocus` that drives the frontend's vehicle stage,
- a `rationale` shown behind "Why this question?",
- an optional `appliesWhen(answers)` gate.

`nextQuestionFor(session)` returns the first unanswered question whose gate
passes, or `null`. One question is asked at a time; there is never a form wall.
The starting/smoke branch is the only branch implemented in the MVP — other
complaint categories end the interview immediately rather than pretending to
cover ground the rules do not cover.

## Hypotheses

`rules.ts` defines seven hypotheses for the supported branch:

`injection-timing`, `air-ingress`, `acsd-fault`, `glow-plug-fault`,
`injector-fault`, `low-compression`, `fuel-restriction`.

Each has a `baseWeight`, a summary, the evidence it still requires, and the
keywords used for exact retrieval.

## Scoring

`SCORE_RULES` is a flat table of `(questionId, value) → [{hypothesisId, delta,
note}]`. Scores are summed, floored at zero, then normalised across all
hypotheses into `relativeScore`.

`relativeScore` is a **relative weight, not a probability**. The API says so
directly in `summary`, and the frontend renders it as a labelled meter, never as
a percentage of certainty.

Rules that are deliberately absent are as important as the ones present:

- **Media never scores.** Photos, video and audio are context only.
  `NON_DIAGNOSTIC_EVIDENCE_TYPES` enforces this.
- **A blocked measurement never scores.** If a `MEASUREMENT_RULE` is marked
  `requiresApplicability` and the specification is locked, the measurement is
  recorded as a `context` rationale link, the hypothesis becomes
  `partially-tested`, and a caution gate is raised.

## Status

`statusFor()` may return `untested`, `partially-tested`, `supported` or
`contradicted`. It **never** returns `confirmed` — confirmation requires a
verified specification and a verified outcome, neither of which the MVP has.

## Next-best test

`tests-catalog.ts` defines each test with an `effortCost`, the tools required,
safety warnings, and what each possible result would mean.

```
value = (Σ relativeScore of live targeted hypotheses × topBonus) / effortCost
        − 0.01 × safetyWarnings.length
```

`topBonus` is 1.6 when the test targets the current leader. Ties break toward the
lower effort cost. Contradicted hypotheses are not counted. A test is only
recommended once the vehicle is identified and at least three answers exist —
before that, recommending anything would be theatre.

Exactly one test is ever recommended.

## Safety gates

`buildSafetyGates()` can raise:

| Gate | Severity | Raised when |
| --- | --- | --- |
| `gate-vehicle-unidentified` | blocking | Series or engine unknown |
| `gate-specification-locked` | blocking | Conflict unresolved, fields missing, or placeholder-only sources |
| `gate-placeholder-sources` | caution | No licensed source imported |
| `gate-measurement-uninterpretable` | caution | A measurement was recorded that cannot be compared |
| `gate-general-safety` | info | Always |

## The single entry point

`evaluateSession(session)` produces the entire `DiagnosticUpdate` and ends with
`diagnosticUpdateSchema.parse(update)`. If the policy layer ever produces a shape
the contract does not allow, it throws rather than degrading quietly, and the
Express error handler returns a generic 500 rather than leaking internals.
