# Controlled Muse v5 preparation — no paid authorization

**Subsequent status:** the user separately approved this exact request and $0.068780 reservation. Exactly one dispatch completed on November2 UTC; authorization is now consumed. Saved analysis `250df898-3dcb-4ef4-9e79-09c71cce80aa` selected posting only, with valid name/hours and loading omission codes. See [the recorded outcome and accounting](MUSE_PROVIDER.md#single-authorized-v5-result--november-2-2026-utc) and `reports/assessment-v5-testing-evaluation.json`. Commands below are historical instructions, not unused approval or permission to repeat. All preparation artifacts remain preserved.

Prepared November 2, 2026 against the existing Guzman assessment and the exact Website/Facebook reports used by the successful v4 test. **Stop before approval or dispatch.** No live request, new intent, paid approval, reservation, allocation activation, spending-policy change or persisted application analysis was made. Remaining capacity is not authorization.

## Exact review target

| Field | Prepared value |
| --- | --- |
| Business / assessment | `demo-guzman` / `a0c19a0e-2be3-447e-a795-e7fdee84c0bf` |
| Request SHA-256 | `92615c79f4d981631530b9924d122cd63f3b7e9288bf8ccbcc4f804be0f3a875` |
| Evidence input SHA-256 | `ffa4b87dcfa463eb525dcf4648f5a3dd7a2808a701dc1a76d5b56ca4e935c70f` |
| Model / processing / reasoning | `muse-spark-1.3` / Standard / minimal |
| Selector / factual renderer | `assessment-muse-selection-output-v5` / unchanged `assessment-muse-output-v4` |
| Complete request / input bound / output cap | 11,457 UTF-8 bytes / 49,924 conservative input tokens / 1,500 output tokens including reasoning |
| Maximum reservation | **68,780 USD micros = $0.068780** |
| Price snapshot | `meta-spark-standard-2026-10-31`; fails closed starting November 30 UTC |
| Request controls | Strict v5 JSON schema, `tools:[]`, required `tool_choice:"auto"`, `store:false`, `stream:false`, `background:false`, truncation disabled |
| Excluded | Grounding, retries, fallback, provider collection, executable edits, WordPress writes |

Website report `43a66038-2184-4f72-b242-8381102b651d`, content hash `c2cb2983513bb071ef9745b52c6ca550bc39fcc6adcd924e2e7998afd09e629d`.

Facebook report `3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b`, content hash `7d879b07361625afd108f7bc865b9ccd6e5024f50c13383f23412ffedd76c479`.

The request describes historical evidence at the saved cutoff, not current business conditions. Scores remain Website80 / Social71 / Consistency60 / Total73 under `seo-spy-score-v1.4`.

## Candidates and scrutiny

| ID | Group | Classification | Scrutiny if omitted |
| --- | --- | --- | --- |
| `o_05ee93cbc231dd09` | link-purpose | Conditional review | No |
| `o_0cdbbc667338f875` | consistency/name-hours | Conditional review | Yes |
| `o_1dc22beb90342d37` | posting | Confirmed shortfall | No |
| `o_251f486c4a30e275` | text-readability | Conditional review | No |
| `o_26c6df899f333cef` | touch-controls | Conditional review | No |
| `o_36d88033f8eda01c` | image-alternatives | Conditional review | No |
| `o_7faf9a281e6bd80b` | keyboard-navigation | Conditional review | No |
| `o_9eeb0b598d92d844` | loading | Confirmed shortfall | Yes |

Scrutiny IDs are `o_0cdbbc667338f875` and `o_9eeb0b598d92d844`. Scrutiny draws attention but never requires selection or rank. Zero to three choices, conditional-only choices and empty selection remain valid. Every unselected scrutiny ID requires one compatible omission annotation; other omissions are not annotated. The deterministic baseline remains loading, posting, owner verification.

## Existing protected path

`assessment-muse-poc.mjs --testing --selection-version=v5` uses the existing administrator identity, ledger allocation, exact single-use intent, atomic reservation, transport grant and immutable receipt path. Omitted version still means v3; v4 remains supported. V4/v5 allocation activation is rejected before application bootstrap and again by the operator. Normal HTTP creation remains mock-only.

V5 metadata explicitly distinguishes selector v5 from factual output v4. Historical metadata/receipts remain valid without new fields. New v5 receipts store validated decision labels in selected order, separately from prose; invalid labels are never retained as valid decisions. The saved analysis also retains its internal labels. Public creation/read/Dashboard responses continue to strip them. No raw provider response, reasoning, credential or request body is added to receipts.

Current allocation snapshot: 2/10 testing attempts consumed, **8 policy attempts available**, cumulative testing charge **$0.012251**, funded remainder **$1.842741**. Current UTC-day reservation headroom is **$1.806020**; limits are rechecked at reservation time. Historical development charge remains $0.145008 with all four attempts consumed and caps152744/152744/4 unchanged. Combined accounting remains $0.157259. No active/uncertain attempt or incomplete receipt; demo authorization absent and demo use zero. The protected $148 reserve remains intact under application accounting. Actual provider balance/billing was not queried.

## Verification and comparison prepared

`npm run check` passed typecheck, lint, all **69 suites / 1,426 tests**, one existing skip, and production build. Final lint also covered the new verifier. Extended tests run the existing v3 and v4/v5 protected pipeline against disposable SQLite databases and mock transport: exact administrator/hash/input/cost confirmation, version isolation, spent development rejection, activation rejection, immutable old receipts, zero/one/two/three and conditional-only selections, rendering order, cache reuse, fabricated/duplicate IDs and groups, unsupported fields/evidence, conditional-as-confirmed labels, invalid information/omission premises, missing significant omissions, transport/publication failures and no replay/retry. Existing v5 tests additionally cover sparse/zero pools, known effort/risk abstention, five fixed candidate permutations, public stripping and corrupt stored labels.

Actual saved-data verification reconstructed the same request through the adapter/provider, replayed six historical analyses and scoring, validated 15 candidate action citation bindings, confirmed unchanged v4 request SHA-256, and verified byte-unchanged `.env`, application/spending databases and their sidecars. It made zero network/model calls and created no intents, approvals, reservations or analyses. The 15 figure counts candidate action references; it is not the earlier 19-reference full rendered consultation count.

Read-only artifacts:

- `reports/assessment-v5-testing-preview.json`: exact hashes, full selector schema/settings, candidates, scrutiny, baseline and ledger snapshot.
- `reports/assessment-v5-preparation-verification.json`: source/scoring/history/integrity checks and frozen v4 comparison.
- `reports/assessment-v5-preparation-integrity-before.json`: protected-file fingerprints, no environment contents.
- `reports/assessment-v5-operator-check.log`: full backend validation.

The successful v4 comparator is saved analysis `70578de9-ca1d-41ce-a142-cfd5bf00a97a`: loading then posting, owner verification omitted, no reason labels. Input/output/included-reasoning tokens1827/264/211; usage-based charge $0.003406. The v5 request is 1,256 bytes larger (+12.3%); reservation rises $0.006280 (+10.0%). Actual token/cost overhead is unmeasured.

The preview and future execution output carry a v5 review plan. Two independent blinded reviewers should compare the v5 selections with both the saved v4 list and baseline, rate evidence grounding/business usefulness/order/nonredundancy/important omissions/conditional handling/abstention, and explain material disagreements. Review reason-premise compatibility separately from label usefulness: a generic relative-priority code may be valid yet reveal little. Explicitly review omitted customer-information concerns. Do not reward novelty, list length or disagreement with v4. Record schema/semantic/publication failures and absolute/relative input/output/reasoning/usage costs, including failed outcomes. No extra requests follow automatically.

No real v5 priorities, label quality, schema acceptance or inference costs have been observed. Valid labels can be post-hoc rationalizations; scrutiny can affect attention; omission coverage is bounded. One request cannot establish robustness, causal prompt effects, superiority or stable costs. V5 cannot explain the old ID-only v4 omission.

## Commands — only after separate exact user approval

Run from `server/`. The following are handoff instructions, **not executed authorization**. Do not run `activate`; reuse the existing allocation. Preview is safe without credentials and makes no external calls:

```powershell
npm run build
node scripts/assessment-muse-poc.mjs preview --testing --selection-version=v5 --business-id=demo-guzman --assessment-id=a0c19a0e-2be3-447e-a795-e7fdee84c0bf
```

After the user separately approves the exact request SHA-256 and $0.068780 maximum, set the reviewed arguments. Any changed source, settings, schema, instructions, payload, prices or reservation requires a new review; runtime reconstructs the request and fails on mismatch.

```powershell
$v5Args = @('--testing', '--selection-version=v5', '--business-id=demo-guzman', '--assessment-id=a0c19a0e-2be3-447e-a795-e7fdee84c0bf')
$v5Exact = @('--confirmed', '--request-hash=92615c79f4d981631530b9924d122cd63f3b7e9288bf8ccbcc4f804be0f3a875', '--input-hash=ffa4b87dcfa463eb525dcf4648f5a3dd7a2808a701dc1a76d5b56ca4e935c70f', '--maximum-micros=68780')
```

Administrator approval stage, once only after that approval (no provider dispatch):

```powershell
$v5Secret = Read-Host 'AI administrator credential' -AsSecureString
try {
  $env:SEO_SPY_AI_ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', $v5Secret).Password
  node scripts/assessment-muse-poc.mjs approve @v5Args @v5Exact --authorize-one-request --reason='One separately approved Guzman v5 strict-schema, decision-label quality and cost comparison' --out=reports/assessment-v5-testing-approval.json
  if ($LASTEXITCODE -ne 0) { throw 'Approval failed. Stop; do not renew or dispatch.' }
} finally {
  Remove-Item Env:SEO_SPY_AI_ADMIN_TOKEN -ErrorAction SilentlyContinue
  $v5Secret = $null
}
```

One deliberate dispatch, within the existing 15-minute intent lifetime. Use only the successful approval's returned intent. Existing artifact filenames fail closed; preserve them. A failed/unknown attempt must never be replayed or automatically reapproved.

```powershell
$v5Approved = Get-Content -Raw reports/assessment-v5-testing-approval.json | ConvertFrom-Json
if ($v5Approved.stage -ne 'approved') { throw 'No successful approval; stop.' }
$v5Secret = Read-Host 'AI administrator credential' -AsSecureString
try {
  $env:SEO_SPY_AI_ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', $v5Secret).Password
  node scripts/assessment-muse-poc.mjs execute @v5Args @v5Exact --poc "--intent-id=$($v5Approved.intentId)" --out=reports/assessment-v5-testing-result.json
  if ($LASTEXITCODE -ne 0) { throw 'Execution did not establish success. Preserve receipts and inspect; never retry.' }
} finally {
  Remove-Item Env:SEO_SPY_AI_ADMIN_TOKEN -ErrorAction SilentlyContinue
  $v5Secret = $null
}
```

The CLI's private live gates end on process exit. `.env` and normal `MOCK_AI=true`, `AI_MODE=mock`, `AI_ENABLED=false`, configured development budget zero remain unchanged. Review the saved result/receipt and benchmark read-only with the same existing administrator procedure. Never reset counters, top up allocations or borrow demo capacity as cleanup.

## Files changed in this preparation

Existing working-tree files extended (all earlier work preserved):

- `scripts/assessment-muse-poc.mjs`
- `src/modules/assessments/assessment-poc.operator.ts` (evidence return type only)
- `src/modules/assessments/assessment-testing.operator.ts`
- `src/modules/assessments/assessment-analysis.service.ts`
- `src/integrations/ai/muse-testing-ledger.ts`
- `src/integrations/assessment-ai/assessment-v4-evaluation.ts` (adds v5 review plan)
- `tests/assessment-v4-testing.spec.ts` (runs both v4 and v5 protected pipelines)
- `tests/assessment-poc-cli.spec.ts`
- `README.md`, `PLAN.md`, `MUSE_PROVIDER.md`, `AI_USAGE_RULES.md`, `MUSE_V5_TRANSPARENCY.md`

New: `scripts/verify-assessment-v5-preparation.mjs` and this document. Ignored reports contain the preparation artifacts listed above and local capture/console logs; the first PowerShell fingerprint attempt could not read the open application DB, so its incomplete `assessment-v5-preparation-protected-before.json` is not the integrity baseline. The later complete Node fingerprint artifact is authoritative and passed before/after verification. No frontend, scoring, provider transport, source-report, WordPress or environment changes were made. No commit, push or deployment.
