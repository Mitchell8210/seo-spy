# Meta API credit protection

Implemented October 31, 2026. Preserve the promotional balance for final testing. Adding `MODEL_API_KEY` does not enable generation. Normal development, automated checks, debugging and UI work use local fixtures. No live proof-of-concept call was authorized or made during this implementation.

## Enforced policy

| Control | Backend limit |
| --- | --- |
| Default | `MOCK_AI=true`, `AI_MODE=mock`, `AI_ENABLED=false` |
| Model/processing | `muse-spark-1.3`, Standard; no automatic model fallback |
| Reasoning | `low` by default; only `low` or `minimal` |
| Output | At most 1,500 tokens including reasoning |
| Input | At most 32,768 bytes for the entire serialized request, including instructions/schema |
| Initial development | $2 cumulative, $0.50 per UTC calendar day, 10 reserved real attempts total |
| Concurrency/rate | One active or uncertain real attempt globally; at least 60 seconds between reservations |
| Real-call permission | A distinct short-lived, exact, single-use administrator approval for every request |
| Retry/search/tools | No automatic retries, paid web grounding, optional services or model execution tools |
| Demo | Separate explicit administrator authorization and cumulative limits; no development borrowing |

All features share `AiModule`, `MetaMuseProvider` and `AiUsageStore`. The native transport requires a module-private, single-use grant bound to the exact payload hash, minted only after persistent reservation. Direct transport calls without a grant fail before networking. A browser `confirmed:true`, API key, environment mode change, page load or application startup grants no spending authority.

`MOCK_AI=true` always forces the analysis workflow to mock, even if `AI_MODE` is `poc` or `demo`. There is no mock-to-real fallback. Mock results have `isMock:true`, `provider:mock-fixture`, `generationMode:mock`, zero billed usage, a fixture version, and explicit mock wording. Live and mock caches are isolated. Older records without provenance remain identifiable as unknown and are not reused as live cache entries.

## Persistent reservations and accounting

`AI_USAGE_DB` defaults to ignored `reports/ai-usage.sqlite`. Node 24's built-in SQLite supplies immediate transactions, full synchronous durability, WAL journaling, schema migrations and a shared cross-process ledger. No database server or paid dependency is required. Tables preserve development policy, reviewable intents/approvals, demo authorizations and every reserved attempt. Development limits can be reduced; reductions persist even when a request is rejected, and later environment increases cannot restore capacity. There is no reset, automatic unlock or counter deletion endpoint.

The primary application database is now a different SQLite file, `reports/seo-spy.sqlite`, for reports, audit status/timestamps and suggestions. Its history adoption must never move, replace, reset or alias the AI ledger. Actual adoption verified the credit-ledger files were byte-unchanged and made zero external requests. Cached analyses are now authoritative in application SQLite; JSON exports remain compatible history copies. See [DATABASE.md](DATABASE.md).

Each intent binds operator identity, business/report scope, exact payload hash, model, processing/reasoning settings in that payload, token bounds, frozen rates, price version, necessity reason, mode and expiry. Approval lasts no longer than the intent's 15-minute lifetime. Changed input/settings/prices require a new estimate and approval. Reservations atomically consume approval, check lifetime/UTC-day totals, reserve maximum estimated cost and increment the lifetime request count before dispatch.

Status `chargedMicros` includes full pending/uncertain reservations. Confirmed successful usage is conservatively costed from provider-reported input/output tokens using undiscounted prices; unused reservation may then be released. Failed requests retain their full reservation and count. Timeouts, missing usage, ambiguous server/network outcomes or usage overruns retain the reservation, mark accounting halted and block further calls. Restart never treats an interrupted reservation as permission to retry. Invalid output and failure to publish an analysis do not erase its usage attempt. Proof-of-concept iteration uses existing fixtures instead of new paid requests.

Database/storage/authorization failures block real calls. An initialized-file sentinel prevents a missing database from silently becoming a fresh development budget. Protect and back up the database and sentinel. For a consistent SQLite backup, stop writers and close the application before copying; preserve WAL/SHM files if taking an operational file-level snapshot. A valid database backup can restore its own schema/usage and recreate a missing sentinel. Never replace an uncertain ledger with an empty or older database to recover access. Reconcile provider usage and preserve original records before any deliberate recovery; no automated reconciliation/reset is implemented. Untrusted filesystem writers, deliberate deletion of all state, and provider billing outside this installation are outside this local ledger's enforcement boundary.

## Price estimates

Meta's [official pricing](https://dev.meta.ai/docs/pricing-rate-limits), checked October 31, 2026, lists Standard Muse Spark input at $1.25 and output at $4.25 per million tokens. We charge no assumed cache discount. The [reasoning documentation](https://dev.meta.ai/docs/reasoning) states that reasoning uses the output-token budget. No paid search tool is sent.

Money enforcement uses integer USD microdollars (1 USD = 1,000,000 micros), rounded upward. Before approval, the estimated input bound is four times the full payload's UTF-8 bytes plus 4,096 framing tokens; the output bound is the configured cap, at most 1,500. This deliberately reserves substantially more than ordinary tokenization suggests. The current undiscounted maximum for a 32 KiB payload and 1,500 output tokens is $0.175335. Lower configured budgets still block that request when unaffordable; most development should spend nothing.

This is a conservative application estimate, not a provider-guaranteed token count or account billing ceiling. Actual unexpected usage halts accounting and is recorded conservatively. Rates may be raised through configuration but cannot be lowered below the verified baseline. The versioned price snapshot fails closed for real preparation starting November 30, 2026 UTC until rechecked and updated in reviewed code. Provider account billing/spend limits remain necessary; these controls neither query the promotional credit balance nor replace provider-side limits. Do not claim that the unqueried account balance is exactly $150.

## Administrator workflow

Use the local operator credential for the WordPress report routes. Use a **separate** server-only `AI_ADMIN_KEY` for `/api/ai/admin/*`. Both require loopback Hosts and exact configured Origins when present; CLI requests may omit Origin. Keys stay in ignored server configuration and Authorization headers; never paste them into chat, URLs, reports or frontend variables. There is no shared/public application administrator identity yet.

1. Develop against mocks and cache. Determine whether a live check is essential and cannot reasonably be confirmed locally. No bulk analysis, automated live suite, or repeated prompt refinement is permitted.
2. With the chosen Standard model/settings, POST `/api/wordpress/businesses/:businessId/reports/:reportId/muse-estimates` with `{ "reason": "Specific essential validation and why mocks are insufficient" }`. This makes no Meta request. It persists the exact scoped estimate and returns its hash, reservation in micros, formatted maximum USD, bounds, price version and expiry. In mock mode this previews `poc`; a demo estimate requires a prior demo authorization.
3. An administrator reviews GET `/api/ai/admin/intents/:intentId` and GET `/api/ai/admin/status`, checks the maximum cost fits all limits, and explicitly approves that one request through POST `/api/ai/admin/intents/:intentId/approve` with `{ "confirmed": true, "requestHash": "EXACT_REVIEWED_HASH", "reserveMicros": EXACT_REVIEWED_MAXIMUM }`. This records approval only; it does not dispatch, increase limits or enable live mode.
4. Only after that review, explicitly configure `AI_MODE=poc`, `MOCK_AI=false`, `AI_ENABLED=true`. Preserve the reviewed model/token settings. POST the original report's `muse-analyses` with `{ "confirmed": true, "intentId": "APPROVED_ID" }`. The backend rechecks the exact payload, operator, scope, expiry, limits, rate and active reservations transactionally. Restoring flags alone cannot bypass missing approval or accounting failure.
5. Inspect the saved analysis, its attempt ID and persistent usage, then restore `MOCK_AI=true`, `AI_MODE=mock`, `AI_ENABLED=false`. Do not automatically retry errors; use stored output for follow-up development. Saved reads and cache hits are free.

For final testing, POST `/api/ai/admin/demo-authorizations` with explicit `confirmed:true`, `budgetMicros`, `dailyMicros`, `maxCalls` and a reason for entering final/demo work. Demo cumulative allocation is capped at $148, separately from the $2 development allocation. New demo limits preserve previous usage and invalidate outstanding intents under older authorizations. Explicit environment selection of `demo` still requires per-call estimate approval; no process, feature or script can automatically activate or replenish it. No demo authorization exists by default.

`node scripts/verify-wordpress-muse.mjs --confirmed --report-id=REPORT_UUID --intent-id=APPROVED_INTENT_UUID` can execute one already-approved essential check or reuse its cache. It cannot approve itself, choose higher limits, enable live mode or retry. Do not run it without a fresh concrete administrator approval.

## Development configuration and checks

The tracked `.env.example` contains safe defaults and blank private keys. `AI_MODEL`, `AI_PROCESSING_MODE`, `AI_REASONING_EFFORT`, timeout/input/output/concurrency bounds, price snapshots, database location and reduced development limits are environment-configurable within the hard policy ceilings. `AI_DEV_BUDGET_MICROS`, `AI_DEV_DAILY_MICROS`, `AI_DEV_MAX_CALLS` cannot exceed 2,000,000 / 500,000 / 10. The superseded `AI_MAX_CALLS_PER_PROCESS` is no longer a control and must not be used to reset access.

Deterministic HTML checks, metadata collection and Lighthouse remain separate from paid interpretation. The WordPress interpretation sends a bounded subset (up to two observations per provider/resource, at most 12 total), explicit omission/coverage information and original citations. It does not invent new checks, scores or measurements. Cache keys include evidence and selected-input hashes, business/report, model, reasoning/token limits, prompt/schema/settings, input-selection version and mock/live mode. Identical requests reuse the immutable saved result across restarts; mock/live/demo caches remain separate.

Run `npm run check` for offline validation. Real credentials and live opt-in are removed from automated test settings. Fixtures in `src/integrations/ai/fixtures/muse-development-fixtures.ts` cover audit observations, conditional recommendations, scoring explanations and source-bound WordPress output without fabricated numeric scores.

After building, `node scripts/verify-muse-mock.mjs --report-id=SAVED_CURRENT_POLICY_REPORT_UUID` verifies the actual local API, labeled mocks, durable cache, saved reads and unchanged usage while explicitly blocking external WordPress and Meta access. On October 31 this passed for report `12897672-5152-4f1c-b727-b72cd3cdfe9c`: zero external requests, zero real development/demo calls and zero charged micros. The private model key was preserved, mock mode remains enabled and no real administrator approval was created.

Final backend validation passed: 28 suites, 502 tests and one skipped, typecheck, lint and production build. A second mock-harness process reused the original saved mock analysis and confirmed unchanged zero usage across restart. Restart any preexisting backend process to load the new settings and protected provider implementation; no unrelated development process was stopped by this work.
