# Muse selection transparency v5

Implemented offline. New explicit mock assessment creation uses v5. No live request, intent, approval, reservation, budget change or provider collection was performed. Normal mock-first settings and the protected ledger/demo allocation are unchanged.

## Contract and discretion

The selector returns `assessment-muse-selection-output-v5`:

```json
{
  "schemaVersion": "assessment-muse-selection-output-v5",
  "selected": [
    {"id": "o_9eeb0b598d92d844", "reason": "ADDRESS_CONFIRMED_SHORTFALL"},
    {"id": "o_1dc22beb90342d37", "reason": "ADDRESS_CONFIRMED_SHORTFALL"}
  ],
  "omitted": [
    {"id": "o_0cdbbc667338f875", "reason": "FOCUS_CONFIRMED_SHORTFALLS"}
  ]
}
```

This example is a **hypothetical offline fixture**, not reasons supplied by the saved live v4 model. The complete rendered example and deterministic baseline mock are in `reports/muse-v5-offline-evaluation-final.json`. No annotations were retrofitted to old analyses.

There are zero to three ordered selections, one reason each, and up to two omission records. No slot filling, channel representation or owner-verification selection is compulsory. Conditional-only selections, short lists and empty lists remain valid. Duplicate IDs/groups, invented IDs, unowned evidence, unsupported fields and missing required omission records fail closed.

| Reason code | Evidence/selection compatibility |
| --- | --- |
| `ADDRESS_CONFIRMED_SHORTFALL` | Candidate is a confirmed shortfall. |
| `RESOLVE_CUSTOMER_INFORMATION` | Candidate belongs to a backend-defined business-information group: consistency, identity review, hours review or contact route. |
| `VERIFY_RECORDED_FLAG` | Candidate is a conditional review opportunity. |
| `FOCUS_CONFIRMED_SHORTFALLS` | Omitted alternative is conditional; at least one selected action exists and every selected action is confirmed. |
| `HIGHER_PRIORITY_ELSEWHERE` | At least one selected action exists; relative priority remains a subjective judgment. |
| `CONTEXT_BEFORE_PRIORITIZING` | With nonempty selections, the omitted alternative is conditional or has unknown effort/risk. With zero selections, it records subjective abstention for any eligible pool, including known effort/risk. It never asserts missing measurements or failure. |

Codes establish premise compatibility only. A valid label can still be a poor decision or a post-hoc rationalization. They do not prove motive, commercial benefit, urgency, correctness, implementation cost or ranking quality. Missing measurements cannot become failures, and no outcome/score/quick-win codes or free-form justifications are accepted.

## Prompt and scrutiny policy

The new prompt distinguishes an established disagreement from an unverified correction. Verifying customer-facing business information can be useful even when the correct replacement is unknown. It removes the old preference over “cosmetic reviews,” preserves discretion and explicitly states that conditional tasks need not receive priority.

The backend scrutiny set is capped at two verified existing IDs: a customer-information opportunity if present, plus the highest-severity remaining candidate, with stable semantic tie-breaking. IDs are presented in neutral sorted order. For Guzman these are owner verification and loading. Only unselected scrutiny IDs require omission records. The set grants no rank or selection requirement and is validated against the backend rule before every preparation/read.

Attention to these alternatives may influence the model. This limitation is explicit in the prompt, saved record limitations and evaluation. No test claims that the set is bias-free. The small set also means not every omitted alternative receives an explanation.

## Backend ownership and compatibility

V4 candidate construction, factual rendering, action templates, citations, score explanations, measurement gaps and safety limitations are reused unchanged. The v5 projection preserves the complete v4 candidate data and adds only the scrutiny IDs and a new projection version. No source collection or scoring arithmetic is added.

Versions are distinct:

- Evidence: `seo-spy.assessment-muse-evidence.v5`.
- Input projection: `assessment-muse-input-v5`.
- Selection policy/cache identity: `assessment-muse-selection-v5`.
- Prompt: `assessment-muse-prompt-v5`.
- Selector response: `assessment-muse-selection-output-v5`.
- Local fixture: `assessment-muse-fixture-v5`.

The factual consultation deliberately keeps `assessment-muse-output-v4` so the existing Dashboard receives its established presentation contract. Internal analysis records store `decisionLabels` separately, with an explicit v5-prompt/fixture compatibility rule. Labels are required for v5 and forbidden on historical v1-v4 records. HTTP POST/GET and Dashboard latest views strip labels; local server/operator reads retain them. Labels never become factual recommendation wording or citations.

Saved reads validate labels against the reconstructed evidence and selected order independently of current model settings. Corrupt labels cannot pass merely because their storage checksum and rendered prose are valid. Caches bind the full evidence bundle, scrutiny IDs, prompt/schema/selection identity, settings, fixture and mock/live mode. V1-v4 records, evidence bytes, hashes and cache identities remain unchanged.

The original transparency implementation left the testing CLI v3/v4-only. The subsequent [controlled v5 operator preparation](MUSE_V5_LIVE_PREPARATION.md) extends the existing metadata/receipt path, without activating an allocation or creating paid authorization. V5 still requires separate exact user approval before administrator approval and one dispatch. An older approval cannot authorize v5.

## Size and output limits

Saved Guzman evidence contains the same eight eligible groups:

| Measurement | V4 | V5 |
| --- | ---: | ---: |
| Compact projection | 8,011 bytes | 8,076 bytes |
| Full serialized request | 10,201 bytes | 11,457 bytes |
| Canonical two-selection response / annotated fixture | 116 bytes | 280 bytes |

The projection grows by 65 bytes (about 0.8%). Most request growth is bounded reason definitions, instructions and schema. The response comparison uses canonical JSON for the old saved IDs and a hypothetical v5 fixture; it is not a comparison of raw provider response bytes. Actual input/output/reasoning token overhead remains unmeasured. The model remains Muse Spark 1.3, Standard, minimal reasoning, with the unchanged 1,500-token cap and existing input/reservation safeguards. No bounds or budgets were adjusted.

## Offline verification

Backend `npm run check` passed **69 suites, 1,392 tests and one existing skip**, including typecheck, lint and production build. Final lint also covers the new offline evaluator. Existing frontend mapping tests and opportunity assertions passed without frontend edits.

Tests cover zero/one/two/three selections; confirmed and conditional reason combinations; required omissions; invalid IDs and reason codes; duplicated IDs/groups; cross-source/unowned proof; conditional-as-confirmed claims; absent unknown-context premises; sparse/empty evidence; alternate defensible orders; five fixed candidate-order permutations; public stripping/internal persistence; label/render order coupling; corrupt saved labels; v1-v4 API reads; mock/live cache isolation; full rendering; and strict mock provider transport responses. Fixture invariance is not proof of actual Muse order insensitivity or improved judgment.

`node scripts/evaluate-muse-v5.mjs` reads saved application data without Nest startup or generation, validates record checksums, replays the original score snapshot and six historical analyses, verifies the exact historical v4 request hash, measures the new projection/request, and renders mock examples locally. It never opens the spending ledger or creates an application analysis. Fingerprints confirm unchanged application/spending database files and sidecars plus `.env`. The evaluator writes only new ignored report artifacts and refuses to overwrite an existing evaluation.

One old ignored prototype helper needed explicit `globalThis.structuredClone` references to pass repository-wide lint; its behavior and investigation results were not changed.

## Remaining limitations and future live value

The labels expose bounded stated decision bases, not detailed reasoning or reliable explanations of rank. Scrutiny can change attention. Subjective priority/deferral labels can pass valid premise checks while conveying limited information. Sparse and permutation fixtures verify contracts, not real model behavior. Existing backend wording and complete caveats remain authoritative regardless of labels.

After separate v5 operator preparation and exact approval, one live test could provide new evidence about schema acceptance, compatible label use, useful omission annotations and token/usage cost. It would not establish the cause of the original v4 omission, superiority over the baseline or general robustness. A causal bias assessment would require a controlled comparison and human review. No live request is authorized by this implementation.

## Changed files

- `src/integrations/assessment-ai/assessment-muse-transparency.ts` — new prompt, scrutiny policy, validators, mock labels, projection and rendering adapter.
- `src/integrations/assessment-ai/assessment-muse.types.ts` — versioned evidence/selection/record contracts and public label stripping.
- `src/integrations/assessment-ai/assessment-muse.ts` — preparation, cache identity, generation/validation and internal decision persistence.
- `src/modules/assessments/assessment-analysis.service.ts`, `assessment.service.ts`, `assessments.controller.ts` — v5 default mocks, historical replay, saved semantic validation and public response boundary.
- `tests/assessment-transparency.spec.ts`, `tests/assessments-api.spec.ts` — contracts, provider fixtures, storage and API compatibility.
- `scripts/evaluate-muse-v5.mjs` — saved-data offline verification and examples.
- Documentation: this file, `MUSE_PROVIDER.md`, `PLAN.md`, `README.md`, `AI_USAGE_RULES.md`.
- Ignored artifacts: `reports/muse-v5-offline-evaluation-final.json`, `reports/muse-v5-check.log`, protected-file fingerprint snapshot, and the lint-only fix to the previous prototype helper.

No frontend file, scoring policy, provider/ledger implementation, WordPress protection, configuration, old saved record or original report was changed by this task. Pre-existing uncommitted work remains preserved; no commit, push or deployment occurred.
