# Meta Muse provider

The [credit-protection policy](AI_USAGE_RULES.md) governs every real model request. Normal development is mock-first: `MOCK_AI=true`, `AI_MODE=mock`, `AI_ENABLED=false`. A configured API key never enables a paid call. The default model is `muse-spark-1.3`, Standard mode, low reasoning; no automatic fallback, paid grounding or optional tools.

## Configuration

| Setting | Default / maximum |
| --- | --- |
| `MOCK_AI`, `AI_MODE`, `AI_ENABLED` | `true`, `mock`, `false` |
| `MODEL_API_KEY` | Private, blank in the tracked template |
| `AI_ADMIN_KEY` | Separate private local administrator credential |
| `AI_MODEL` / `AI_PROCESSING_MODE` | `muse-spark-1.3` / `standard` |
| `AI_REASONING_EFFORT` | `low`; `minimal` also allowed |
| `AI_MAX_OUTPUT_TOKENS` | 1500; includes reasoning and visible output |
| `AI_MAX_INPUT_BYTES` | 32768; entire wire request, instructions/schema included |
| `AI_MAX_CONCURRENCY` | 1, enforced across processes through SQLite |
| `AI_TIMEOUT_MS` | 60000; allowed 1000–120000 |
| `AI_USAGE_DB` | `reports/ai-usage.sqlite` |
| `AI_DEV_BUDGET_MICROS` | 2000000 ($2 lifetime development); may only be reduced |
| `AI_DEV_DAILY_MICROS` | 500000 ($0.50 UTC day); may only be reduced |
| `AI_DEV_MAX_CALLS` | 10 lifetime reserved development attempts; may only be reduced |

The previous process-only call cap is replaced by durable cumulative accounting. Application restarts and mode changes do not replenish development limits. A separate explicit administrator authorization is required for demo limits; development cannot borrow that allocation. Every real call in either mode still needs an individually approved exact cost estimate.

## Protected interfaces

`MetaMuseProvider.prepare(input)` builds a fixed Responses request and conservative maximum-cost estimate with no credential access, networking or spend. `estimate(input,{actor,scope,reason})` persists an expiring exact intent for independent administrator review. `generate(input,signal?,{intentId,actor,scope})` requires all real-mode gates and atomically reserves approved maximum cost/count in SQLite before dispatch. It records token usage and outcome even when no successful analysis can be published. Failed/uncertain outcomes keep reservations; uncertain accounting halts subsequent real requests.

The native `MetaMuseTransport` accepts only a module-private one-use payload-bound dispatch grant issued after successful reservation. Direct raw calls fail before networking. Requests use the fixed `https://api.meta.ai/v1/responses` destination, strict JSON schema, separate instructions and untrusted evidence, low reasoning, `store:false`, no tools/search/background/streaming, no redirects and no automatic retries. Response bytes, headers, input size, output tokens and total time are bounded. Provider messages, credentials, reasoning and raw bodies are not logged or archived. Unexpected usage is recorded conservatively and halts the ledger.

`WordPressMuseService` validates output shape, cited evidence and proposed informational targets before saving a separate immutable analysis. It makes no WordPress calls during analysis and cannot create or execute proposals. It sends only selected summarized evidence, with explicit omissions. Identical requests return a scoped durable cache entry, with mock/poc/demo isolation. Local fixtures carry `isMock:true`, `provider:mock-fixture` and explicit mock wording; they never fall back to live generation. Source observations, deterministic checks and numerical scoring remain separate.

## Operator verification

`npm run check` uses offline fixtures and no real key. The [policy runbook](AI_USAGE_RULES.md) describes safe key storage, exact estimate/admin approval routes, persistent usage inspection, mode gates and recovery limitations. Saved result GETs and repeated identical analyses make no model requests.

After building, test without spending:

```powershell
node scripts/verify-muse-mock.mjs --report-id=SAVED_CURRENT_POLICY_REPORT_UUID
```

Only when one essential proof-of-concept check is separately approved, the maximum cost fits the ledger and provider limits, and live mode is explicitly enabled, use an already approved intent:

```powershell
node scripts/verify-wordpress-muse.mjs --confirmed --report-id=REPORT_UUID --intent-id=APPROVED_INTENT_UUID
```

The script never authorizes itself, raises limits or enables live mode. No live model call was made during implementation. Backend reservations are conservative estimates and do not replace provider billing controls; the actual promotional account balance has not been queried.

## Official contracts

Verified October 31, 2026: [Responses API](https://dev.meta.ai/docs/protocols/responses), [Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas), [models](https://dev.meta.ai/docs/models), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [reasoning and output budgets](https://dev.meta.ai/docs/reasoning). The frozen price policy expires starting November 30 UTC and must be reverified in reviewed code before further real use. Live account/model/schema acceptance remains unverified until a separately approved essential test; mocks cover ordinary development.
