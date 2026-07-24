# MVP acceptance tests

These are the behaviours the MVP is judged on. Each one is covered by an
automated test.

| # | Behaviour | Automated cover |
| --- | --- | --- |
| 1 | The vehicle is identified before anything specification-dependent opens | `engine.test.ts` → blocking `gate-vehicle-unidentified` |
| 2 | Branch questions are skipped when they do not apply | `engine.test.ts` |
| 3 | Hypotheses are ranked relatively, never as probabilities | `engine.test.ts` |
| 4 | Every hypothesis shows what moved it and what is missing | `engine.test.ts` (`rationale`) |
| 5 | Nothing is ever reported as confirmed | `engine.test.ts` |
| 6 | Exactly one next-best test, with reasoning and interpretations | `engine.test.ts` |
| 7 | Competing source values are surfaced, not silently picked | `conflicts.test.ts` |
| 8 | The specification stays locked until applicability resolves | `conflicts.test.ts`, `engine.test.ts` |
| 9 | A measurement is recorded but explicitly not interpreted while locked | `engine.test.ts` |
| 10 | Media never moves the ranking | `engine.test.ts` |
| 11 | Community content never overrides an OEM specification | `conflicts.test.ts` (`mayOverrideSpecification`) |
| 12 | Placeholder sources are declared as placeholders | `conflicts.test.ts`, `engine.test.ts` |
| 13 | Model output that invents a citation is discarded | `guards.test.ts` |
| 14 | Model output that states an unsourced numeric value is discarded | `guards.test.ts` |
| 15 | Model output that claims a confirmed root cause is discarded | `guards.test.ts` |
| 16 | Malformed model output fails to parse and falls back to scripted | `guards.test.ts` |
| 17 | The outcome is recorded, including negative outcomes | `engine.test.ts` |
| 18 | The policy layer validates its own output | `engine.test.ts` (`diagnosticUpdateSchema.parse` in `evaluateSession`) |

The full end-to-end journey (identification → interview → evidence → workspace
→ repair → outcome), OEM/community separation in the rendered UI, and reduced
motion are covered by Playwright in `cruiser-copilot-frontend/tests/e2e`, which
runs against this API.

## Running the backend suite

```bash
npm test
```
