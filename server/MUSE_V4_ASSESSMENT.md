# Muse v4 opportunity selection

V4 gives the selector zero to three ordered opportunities from a bounded verified pool. It does not require every candidate, a full list, or one action per channel. The backend retains ownership of facts, citations, action templates, score explanations and limitations. Models cannot return new prose, numerical scores, edits or publishing instructions.

New explicit mock assessment creation uses v4. Reads never generate an analysis. The existing Dashboard consumes v4 through its current interpretation and recommendation slots. A valid empty selection remains empty instead of falling back to unrelated recommendations. No component, label, layout or Social scoring breakdown was changed for v4.

## Candidate construction

The saved, replay-validated v3 fact builder is reused without changing its historical evidence bytes or prose behavior. V4 separately builds opportunities from saved evidence:

- Confirmed measured loading and verified posting shortfalls retain their backend action templates.
- Source disagreements produce owner-verification tasks; neither source is presumed correct.
- A bounded set of saved Website checks supports conditional reviews of links, keyboard navigation, readability, touch controls, image alternatives and indexing intent. The exact check must have usable proof. Generic Lighthouse run metadata is insufficient. An audit flag is never promoted into a confirmed sitewide business deficiency.
- Related link issues, repeated loading symptoms and posting symptoms are grouped. Candidate IDs are stable hashes of semantic groups, without priority labels. Evidence ownership remains scoped by the complete report/finding/evidence mapping.
- Missing, inaccessible, unsupported, failed, skipped and stale measurements are excluded. Empty image alternatives may be intentional. Indexing restrictions require owner confirmation before any correction.
- Pools can contain zero through eight groups. If more than eight supported groups exist, severity and certainty bound the pool before neutral ID ordering. There is no rule forcing five candidates.

The allowlist deliberately excludes generic audit findings and unsupported business-outcome claims. Future candidate types need a verified eligibility rule and safe action template; their availability alone does not authorize new Dashboard fields or executable targets.

## Decision space and offline outputs

| Prepared scenario | Original candidate count | Eligible grouped pool | Grouped deterministic mock priorities |
| --- | ---: | ---: | --- |
| Actual saved Guzman evidence | Saved reports contain 24 review findings, plus verified scoring facts | 8 | Loading diagnosis; sustainable posting; owner verification of name/hours |
| Explicit synthetic competing priorities | 8 | 7 | Contact correctness; unanswered inquiries; indexing-intent verification |
| Explicit synthetic sparse evidence | 1 | 1 | Owner verification of hours only |

Guzman's pool contains loading and posting as confirmed shortfalls, plus conditional consistency, link-purpose, keyboard-navigation, text-readability, touch-control and image-alternative reviews. The synthetic fixtures are explicitly labeled and are not Guzman evidence or real application reports.

Eight distinct candidates permit 401 ordered subsets of length zero through three, compared with six compulsory permutations in v3. Seven grouped candidates permit 260 subsets; a one-candidate pool permits the empty or single selection. Every selected ID must resolve exactly, and duplicate IDs/groups fail closed. Confirmed and conditional actions remain distinguished in their backend-authored text and summary.

The strong deterministic comparator uses severity, confirmation status and a stable semantic tie-break, then selects at most three distinct groups. It shares the model's pool and safety constraints. A tie with that comparator is acceptable. Tests predeclare several defensible orders for contact correctness, customer responses, and loading versus indexing review. They do not award novelty or infer genuine judgment from synthetic output fixtures.

Full mock outputs for all three scenarios are in `reports/muse-v4-offline-evaluation.json`. The committed-safe contract fixtures are `tests/fixtures/muse-v4-guzman.json` and `tests/fixtures/muse-v4-scenarios.json`. The former freezes only sanitized backend context, with original report IDs and source hashes; it contains no raw provider responses or contact values.

## Compact input and exact references

| Serialized measurement on saved Guzman | V3 bytes | V4 bytes |
| --- | ---: | ---: |
| Model-facing evidence/projection | 19,520 | 8,011 |
| Adapter input including instructions/schema | 22,194 | 9,554 |
| Full provider request, both at minimal reasoning | 23,997 | 10,201 |

The full v4 authoritative backend bundle is 31,044 bytes; it is never sent as the model input. The compact projection contains candidate statements, kind, severity, safe next step, unknown effort/risk, verification, cutoff, audience context, coverage, measurement gaps and limitations. UUID citations, scoring ledgers, baseline rankings, prewritten summaries and repeated recommendation boilerplate stay backend-side. Input identity hashes the full backend bundle, so changed source mappings invalidate the cache even if projected selection text is unchanged. These are byte counts, not measured provider token savings or billing estimates.

## Versions and safeguards

V4 has distinct evidence, selection, input, prompt, fixture, selector-output and materialized-output versions. Cache identity includes the full authoritative input hash, settings, prompt/schema/instruction identity, selection version and mock/live mode. Historical v1/v2/v3 branches remain intact. Offline replay verified five saved analyses for the pinned Guzman assessment, including its successful historical live result. The exact v3 input hash remains `2979be4de0f5924adc0068cf649f4a21efde989cb0afebadcf0185b4bdee6be3`.

V4 requires `muse-spark-1.3`, Standard processing, minimal reasoning and the unchanged 1,500-token cap. A request-scoped minimal-reasoning field is supported by the shared provider; existing requests without it keep their original bytes/settings. It grants no spending authority and is included in exact request preparation. Persistent reservation arithmetic, budgets, single-use administrator approvals, private transport grants, no-retry/fallback behavior, protected demo allocation and normal mock defaults are unchanged. The implementation makes no live calls.

The historical POC/default testing behavior stays v3. The testing CLI now supports explicit `--testing --selection-version=v4` using the same approval and ledger protections, with additive v4 metadata/receipt validation. V4 reuses the existing allocation and refuses activation. See [the exact no-authorization preparation and future commands](MUSE_V4_LIVE_PREPARATION.md). No existing v3 intent authorizes v4.

## Reproduction and verification

Run from `server/`:

```powershell
npm run check
node scripts/evaluate-muse-v4.mjs
```

The evaluator disables networking, opens the application database read-only, never opens the spending ledger, validates saved record checksums and historical input/output compatibility, prepares exact payload bytes and renders only mock outputs. It compares protected-file hashes before/after and writes the evaluation artifact and sanitized contract fixture. It does not create an estimate, intent, reservation or saved application analysis.

Offline tests cover candidate eligibility/grouping; zero, one, two and three selections; no channel quotas; five fixed candidate permutations; multiple defensible ranking orders; invalid/duplicate IDs and duplicate groups; wrong report/finding/evidence/origin ownership; unavailable-as-failure claims; stale proof; omitted caveats; unsupported edits; cache isolation; historical saved reads; prompt/output limits; and fake approvals through the real provider pipeline with mock transport and isolated temporary ledgers. Candidate-order fixture invariance does not establish real Muse permutation robustness.

Frontend validation covers v3/v4 mapping, returned order, empty selection, scoped provenance and unchanged score values. It verifies the existing data path, not a new visual redesign or fresh browser signoff.

Final verification: backend `npm run check` passed 67 suites, 1,319 tests and one existing skip, including typecheck, lint and production build. Frontend lint/build, 26 mapping tests and existing opportunity assertions passed. An earlier full run timed out in an existing malformed-route API test during a long environment pause; the complete rerun passed without changing that test or increasing its timeout. `git diff --check` passes.

## Readiness and limits

The v4 selection contract is ready for review and offline use. One separately authorized live test would be useful after approval of the [prepared exact v4 hash/reservation](MUSE_V4_LIVE_PREPARATION.md), using the same candidates and model settings against the frozen strong baseline. Do not repeat the old compulsory v3 task. Do not dispatch during implementation or infer permission from remaining allocation capacity.

Actual usefulness, model sensitivity to candidate order, live v4 schema acceptance, costs and failure rates remain unmeasured. Two blinded human reviewers should compare owner usefulness, prioritization, redundancy, grounding and consistency under predeclared safety constraints; accept ties and treat unsupported claims as hard failures. Synthetic fixtures validate contracts only. The candidate allowlist and grouping can still bias decisions; scores do not establish commercial benefit, effort, cause or exact edit targets.

## Files changed for v4

- Core: `src/integrations/assessment-ai/assessment-muse-opportunities.ts`, `assessment-muse.ts`, `assessment-muse.types.ts`, and the v3 builder's type-only parameter narrowing in `assessment-muse-business.ts`.
- Fixtures: `src/integrations/assessment-ai/fixtures/opportunity-scenarios.ts`, `tests/fixtures/muse-v4-guzman.json`, `tests/fixtures/muse-v4-scenarios.json`.
- Provider contract: `src/integrations/ai/meta-muse.provider.ts` (request-scoped minimal reasoning only).
- Creation and historical reads: `src/modules/assessments/assessment-analysis.service.ts`, `assessment.service.ts`.
- Verification: `tests/assessment-opportunities.spec.ts`, `tests/assessments-api.spec.ts`, `scripts/evaluate-muse-v4.mjs`.
- Frontend mapping/tests: `../client/src/services/dashboardMuse.ts`, `dashboardAssessment.ts`, `../client/scripts/dashboard-assessment.test.mjs`.
- Documentation: this file, `MUSE_PROVIDER.md`, `PLAN.md`, `README.md`, `../client/DASHBOARD_API_MAPPING.md`.

All pre-existing uncommitted changes remain preserved. No scoring formulas/policies, source archives, historical analyses, ledger allocations or Dashboard components were changed by this task.
