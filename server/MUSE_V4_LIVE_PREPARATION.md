# Single Guzman Muse v4 live-test preparation

Status: prepared and verified offline; **no spending authorization or live request**. The existing testing CLI now accepts `--testing --selection-version=v4`. Omitting the version retains v3 behavior. V4 uses the existing administrator identity, single-use intent, protected SQLite ledger, exact request hashes, reservation policy, private transport and immutable analysis store. It does not introduce another authorization path or funding allocation. V4 allocation activation is explicitly rejected.

## Exact prepared request

| Item | Prepared value |
| --- | --- |
| Business | `demo-guzman` |
| Assessment | `a0c19a0e-2be3-447e-a795-e7fdee84c0bf` |
| Scoring policy | Saved `seo-spy-score-v1.4`, unchanged |
| Website | `43a66038-2184-4f72-b242-8381102b651d` |
| Website content SHA-256 | `c2cb2983513bb071ef9745b52c6ca550bc39fcc6adcd924e2e7998afd09e629d` |
| Facebook | `3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b` |
| Facebook content SHA-256 | `7d879b07361625afd108f7bc865b9ccd6e5024f50c13383f23412ffedd76c479` |
| Full backend input SHA-256 | `9197c4401407028f7c26d59a55b49454e233b9debf209b564dc7c08b77f89825` |
| Exact request SHA-256 | `e60d1da34129c5e1b646d89595d35d57c01b4c3b600591e98dab118282868eff` |
| Request size | 10,201 UTF-8 bytes |
| Model / processing / reasoning | `muse-spark-1.3` / Standard / minimal |
| Strict selector schema | `assessment-muse-selection-output-v4`, zero to three exact opportunity IDs |
| Output bound | 1,500 tokens, including reasoning |
| Conservative input bound | 44,900 tokens: `4 × 10,201 + 4,096` |
| Price snapshot | `meta-spark-standard-2026-10-31`, unchanged |
| Maximum reservation | **62,500 USD micros = $0.062500** |

The reservation uses the existing undiscounted input/output rates and upward integer rounding: 56,125 input micros plus 6,375 output micros. It is not a prediction of the inference charge or a provider-guaranteed billing ceiling. No bounds, prices or accounting rules were reduced. Tools are empty, `tool_choice=auto` (required by Meta even with empty tools), truncation disabled, and storage/streaming/background execution false. Grounding, retries and model fallback remain absent.

The preview contains settings/schema and authoritative backend candidate mappings, not a saved raw provider response or model reasoning. Provider `store:false` remains mandatory. The old v3 request/records and all earlier receipts are preserved; their approvals cannot authorize this new hash.

## Existing allocation, before any new approval

| Capacity or protection | Verified value |
| --- | ---: |
| Original funded testing amount | $1.854992 |
| Testing charge so far | $0.008845 |
| Funded testing amount remaining | **$1.846147** |
| Testing requests used / remaining | **1 / 9** of 10 |
| Remaining UTC-day reservation capacity at preview | **$1.868520** |
| Per-request reservation ceiling | $0.50 |
| Historical development cumulative/daily caps | $0.152744 / $0.152744 |
| Historical development attempts | 4 consumed, maximum 4 |
| Historical development accounting | $0.145008 |
| Combined historical/testing accounting | $0.153853 |
| Protected demo reserve | **$148**, no demo authorization or usage |

The ledger is not halted, has no active/uncertain attempt, and has zero incomplete testing receipts. Capacity is not authorization. A successful future approval can reserve at most the exact $0.062500 request; its attempt slot is consumed before dispatch. Unknown outcomes and unfinalized receipts continue to block subsequent requests. The account balance/provider invoice was not queried.

## Complete verified candidate pool

All eight groups resolve to the pinned business, report, finding or scoring observation, and exact live evidence. The saved-data verification checked 15 candidate citation bindings. Full report/finding/evidence IDs and backend actions are in `reports/assessment-v4-testing-preview.json` and `reports/assessment-v4-preparation-verification.json`.

| Neutral ID | Group | Status | Backend action |
| --- | --- | --- | --- |
| `o_05ee93cbc231dd09` | link-purpose | Conditional review | Review link destinations and discoverability |
| `o_0cdbbc667338f875` | consistency | Conditional review | Confirm the intended business name and hours |
| `o_1dc22beb90342d37` | posting | Confirmed shortfall | Restart a sustainable posting routine |
| `o_251f486c4a30e275` | text-readability | Conditional review | Verify text readability |
| `o_26c6df899f333cef` | touch-controls | Conditional review | Verify mobile control usability |
| `o_36d88033f8eda01c` | image-alternatives | Conditional review | Review image alternatives in context |
| `o_7faf9a281e6bd80b` | keyboard-navigation | Conditional review | Verify keyboard access to the main content |
| `o_9eeb0b598d92d844` | loading | Confirmed shortfall | Investigate the slow main content on mobile |

The confirmed concerns are the saved approximately 11.6-second mobile lab loading measurement and verified sparse posting history (three posts over 90 days, latest about 73 days before cutoff). The other candidates authorize only verification, never presumed correction. Neither name/hours source is presumed correct; empty image alternatives can be intentional. Missing growth, response and other measurements remain caveats, not failures. The saved small audience and 71% Social coverage remain independent of selection.

The deterministic grouped baseline selects, in order:

1. `o_9eeb0b598d92d844` — loading diagnosis.
2. `o_1dc22beb90342d37` — sustainable posting.
3. `o_0cdbbc667338f875` — owner verification of name/hours.

## Predeclared comparison

The preview freezes `assessment-v4-human-comparison-v1` before any live output, with baseline IDs, all candidate kinds/groups and the criteria below. It is an evaluation rubric, not SEO scoring policy. Baseline rankings and the rubric are not added to the compact model input.

Two blinded reviewers should independently rate evidence grounding, business usefulness, selected priorities/order, nonredundancy, coverage of important verified issues, treatment of conditional reviews, and abstention under insufficient evidence. Use 0–4 evaluation ratings, label baseline/model/tie preference, and explain material disagreements. Accept ties and multiple defensible orders. A different order, longer list or channel coverage alone earns no credit.

Invented/cross-business IDs, duplicate groups, unavailable-as-failure claims, conditional findings promoted to confirmed defects, missing mandatory caveats, altered scores and unsupported executable actions are hard failures. A short or empty list is contract-valid; reviewers must assess whether its omissions are useful and defensible. No specific order or source quota is compulsory.

Compare the full reservation with returned input/output/reasoning tokens and usage-based ledger charge. Report unknown usage and failures separately. One live sample cannot establish stable cost per report, failure rate, candidate-order robustness or general reasoning quality. Synthetic mock responses validate contracts only.

## Verification completed

- Backend `npm run check`: **68 suites, 1,350 tests passed, one existing skip**, plus typecheck, lint and production build.
- Mock transport covers zero/one/two/three choices, alternative orders, empty lists, invalid/duplicate IDs, duplicate groups, unsupported evidence/cross-business references, malformed/incomplete/HTTP/network responses, publication failure, persisted reads, consumed-intent rejection and zero-dispatch cache reuse.
- The new tests run through the real provider, protected testing ledger and immutable store with fake credentials and temporary databases. A prior v3 testing attempt is seeded before v4, validating additive metadata/receipt compatibility and unchanged historical development/demo records.
- CLI parser tests cover direct/eval private credential delivery, explicit v4 routing and rejection of unsupported versions, v4 without testing, or new v4 activation before backend access.
- Existing v1/v2/v3 historical suites pass. Actual saved-data verification replays the unchanged deterministic score snapshot and five saved analyses. The preview and verification made **zero network/provider calls, intents, approvals or reservations**.
- `.env`, source reports, application database and protected spending database/sentinel/sidecars were byte-unchanged across preparation. No scoring, Dashboard, WordPress, report, budget or deployment changes occurred.

Artifacts: `reports/assessment-v4-testing-preview.json`, `reports/assessment-v4-preparation-verification.json`, and `reports/muse-v4-operator-check.log`. Neither an approval nor a live-result artifact was created.

## Future commands — not authorized by this preparation

Run from `server/`. Safe preview can be repeated without creating an intent; omit `--out` or use a new artifact name, because existing artifacts are never overwritten:

```powershell
node scripts/assessment-muse-poc.mjs preview --testing --selection-version=v4 --business-id=demo-guzman --assessment-id=a0c19a0e-2be3-447e-a795-e7fdee84c0bf
```

**Stop here until the user explicitly approves this exact request hash and maximum $0.062500 reservation.** No allocation activation is needed or permitted on the v4 path. After that separate approval, supply the existing administrator credential privately and approve exactly one short-lived intent:

```powershell
$v4Args = @('--testing', '--selection-version=v4', '--business-id=demo-guzman', '--assessment-id=a0c19a0e-2be3-447e-a795-e7fdee84c0bf')
$v4Exact = @('--confirmed', '--request-hash=e60d1da34129c5e1b646d89595d35d57c01b4c3b600591e98dab118282868eff', '--input-hash=9197c4401407028f7c26d59a55b49454e233b9debf209b564dc7c08b77f89825', '--maximum-micros=62500')
$v4Admin = Read-Host 'Existing AI administrator credential' -AsSecureString
$env:SEO_SPY_AI_ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', $v4Admin).Password
node scripts/assessment-muse-poc.mjs approve @v4Args @v4Exact --authorize-one-request --reason='One separately approved v4 opportunity-selection and inference-cost evaluation' --out=reports/assessment-v4-testing-approval.json
if ($LASTEXITCODE -ne 0) { throw 'Approval failed. Stop; do not dispatch.' }
$v4Approval = Get-Content -Raw reports/assessment-v4-testing-approval.json | ConvertFrom-Json
```

The following is a separate, deliberate one-request dispatch using only that returned intent. Approval expires after at most 15 minutes; changed data/settings/cost invalidate it. An expired/failed request must never be automatically renewed or retried.

```powershell
node scripts/assessment-muse-poc.mjs execute @v4Args @v4Exact --poc "--intent-id=$($v4Approval.intentId)" --out=reports/assessment-v4-testing-result.json
```

After the single result, stop. Review a persisted success without generation; if it failed or is unknown, inspect its receipt/ledger and do not replay execute:

```powershell
$v4Result = Get-Content -Raw reports/assessment-v4-testing-result.json | ConvertFrom-Json
if ($v4Result.receipt.persisted) {
  node scripts/assessment-muse-poc.mjs review @v4Args "--analysis-id=$($v4Result.receipt.analysisId)" --out=reports/assessment-v4-testing-review.json
}
node scripts/assessment-muse-poc.mjs benchmark @v4Args
Remove-Item Env:SEO_SPY_AI_ADMIN_TOKEN -ErrorAction SilentlyContinue
$v4Admin = $null
```

Keep the private credential out of arguments/logs/chat. Clear it on every exit path, including approval failure. Normal server settings remain `MOCK_AI=true`, `AI_MODE=mock`, `AI_ENABLED=false`, configured development budget zero; only the deliberate operator execution has a private process-local live configuration. Never reset the ledger, alter historical caps, activate another allocation or borrow the demo reserve.

## Remaining risks and readiness

No technical blocker was found for preparing one separately authorized v4 dispatch. **No exact approval exists yet, so dispatch remains blocked.** Live v4 schema acceptance, actual usefulness/order, token consumption, provider billing and failure behavior are unmeasured. Existing price validity ends November 30, 2026 UTC and fails closed afterward. Evidence remains tied to its original cutoff; no current-condition refresh is authorized. Human review is required before business actions, independently of any model or spending approval.

## Files changed for this preparation

- `src/modules/assessments/assessment-analysis.service.ts` — pure v4 pinned evidence preparation.
- `src/modules/assessments/assessment-poc.operator.ts` — shared typed evidence hook; existing POC default retained.
- `src/modules/assessments/assessment-testing.operator.ts` — explicit version selection, capacity preview, v4 validation, persistence, cache and comparison handling.
- `src/integrations/ai/muse-testing-ledger.ts` — additive v4 metadata/receipt validation; unchanged policy hash and accounting.
- `src/integrations/assessment-ai/assessment-v4-evaluation.ts` — predeclared human comparison rubric.
- `scripts/assessment-muse-poc.mjs` — explicit testing version flag and fail-closed routing.
- `scripts/verify-assessment-v4-preparation.mjs` — read-only saved-data replay and isolated ledger inspection.
- `tests/assessment-v4-testing.spec.ts`, `tests/assessment-poc-cli.spec.ts`, `tests/fixtures/assessment-poc-cli.fixture.mjs` — isolated transport, ledger, persistence and CLI tests.
- Documentation: this file, `MUSE_PROVIDER.md`, `MUSE_V4_ASSESSMENT.md`, `AI_USAGE_RULES.md`, `PLAN.md`, `README.md`.

Pre-existing uncommitted work is preserved. No commit, push, merge or deployment was performed.
