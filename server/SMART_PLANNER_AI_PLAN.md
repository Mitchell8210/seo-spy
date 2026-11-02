# Muse-assisted Smart Planner

Authorized offline implementation: November 2, 2026. Repository baseline: schema 6, duration-aware deterministic planner V2. Preserve deterministic behavior, source facts, completion history, all existing Muse/scoring/Fix/accounting paths and local browser data.

Latest status: the isolation follow-up below replaces the initial gateway's dependency on shared request limits. Existing generate/review/apply, prompt/schema and scheduling validation are reused. Live dispatch remains blocked pending a dedicated central allowance/transport adapter; protected shared files are being edited by another agent and were not touched for this follow-up.

## Implementation checklist

- [x] Inspect actual planner, SQLite, frontend and centralized Muse transport/financial boundaries.
- [x] Define bounded snapshot, versioned impact-first prompt/JSON contract and deterministic validation.
- [x] Add schema 7 preferences/proposals and durable generation/application identity.
- [x] Implement explicit mock generation, central-provider request preparation and fail-closed dedicated financial preflight.
- [x] Add business-scoped generation/retrieval/settings/application APIs; apply within planner transaction.
- [x] Add AI Plan with Muse configuration/review dialog without redesigning the calendar.
- [x] Cover domain/API/migration/restart/concurrency/provider/error behavior and offline browser interactions.
- [x] Run regression checks and record final results and live limitations.

## Decisions

Optimize expected qualitative SEO impact, never task count or calendar utilization. Weekly availability defaults to 600 minutes, utilization to 70%, hard new-work budget 420 minutes, daily hard cap 120 minutes, horizon 4 weeks (2–52 supported), weekdays Monday–Friday. Existing commitments count against limits. Existing schedules are protected unless explicitly selected for reconsideration; completed records are immutable. Existing half-hour slots and supported duration choices remain compatible; longer/unschedulable work is deferred, never split silently. Estimates are not measured work or promised SEO benefits.

Separate generation, review and explicit apply. Snapshot and proposal hashes bind business, planner revision, exact task/source state and AI preferences. Every eligible task must appear exactly once, placed or deferred. Server recomputes intervals, dependencies and all weekly totals. Output errors produce diagnostics, not silent repairs. Source text is untrusted data, bounded and stripped of obvious credential/PII patterns; no full provider reports are sent.

The central Muse provider supports preparation and exact approved transport, but no dedicated planner allocation currently exists. This feature must not borrow assessment/development/Fix funding. Public live requests return approval-required without creating intents, accessing credentials, changing the ledger or dispatching. A dedicated authorization capability is required before any future live dispatch; central transport remains the only implementation. Explicit offline previews exercise the same schema/validator/apply path and never claim to be Muse output. No automatic fallback or retries.

## Retention and live testing

Store bounded sanitized snapshot/validated output and validation diagnostics in application SQLite, never financial records or raw HTTP/provider payloads. Retain applied records for auditability; expire unapplied proposals after 7 days and retain their immutable audit records (no automatic provider retry/cleanup). Future explicit retention/purge policy may remove old unapplied records; no background jobs or destructive cleanup added.

Live testing requires a separately reviewed planner-specific central allocation/authorization capability, exact request hash/model/prices/token reservation and one fresh explicit administrator approval. Existing approvals must never be reused. Implementation is developed entirely offline; any future wired live transport is not live-verified.

## Implemented contracts

Six methods on four additional business-scoped paths beneath `/api/businesses/:businessId/smart-planner`:

| Method/path | Behavior |
| --- | --- |
| GET `/ai-preferences` | Separate AI settings, effective weekly budget and current planner revision |
| PATCH `/ai-preferences` | `{expectedRevision, mutationId, settings}`; all settings validated and atomically saved with planner revision receipt |
| POST `/ai-proposals` | `{expectedRevision, mutationId, mode:"mock"|"live", weekStart, reconsiderTaskIds?}`; reserves a durable generation identity, saves a separate snapshot/proposal and never modifies active tasks |
| GET `/ai-proposals` | Latest saved proposal or JSON `null`; never generates or retries |
| GET `/ai-proposals/:proposalId` | Business-scoped review with stale/expiry status and immutable sanitized snapshot labels |
| POST `/ai-proposals/:proposalId/apply` | `{expectedRevision, mutationId, confirmed:true}`; validates current revision, source state, preferences, clock and constraints again, then commits tasks, normal mutation receipt and proposal application metadata in one SQLite transaction |

Generation statuses: `generating`, `ready`, `invalid`, `failed`, `approval_required`, `applied`. A crash/ambiguous dispatch remains `generating`; rereading/retrying the same generation mutation returns its saved record without another dispatch. A changed request under the same ID conflicts. Invalid output stores bounded diagnostics but no unvalidated raw response. Network retries preserve exact mutation identity; no paid retries or automatic fallback. Applied duplicate requests return the current planner only for the original exact application identity; a new apply ID conflicts.

Prompt: `seo-impact-roadmap-v1`. Output: `planner-muse-proposal-v1`. Snapshot: `planner-snapshot-v1`. All candidate IDs must appear once, either placed or deferred; protected commitments never appear as mutable entries. Each entry includes recommended priority, qualitative impact/confidence/rationale, bounded effort/confidence/rationale/assumptions, required versus suggested dependencies, start/end, scheduling rationale and a nullable deferral reason. Full-horizon weekly summaries include existing, proposed and total minutes, recomputed by the server. Required dependencies are proposal-scoped; application does not permanently alter task relationships.

Source severity is stored only when derived from a finding, distinct from the model's impact. Legacy exact-matching saved findings can expose current source severity without rewriting their records; unknown legacy/completed severity stays unknown. Applying a reviewed proposal changes planner priority/estimate/schedule only. New estimate/scheduling provenance distinguishes `muse-estimate`/`muse` from `offline-estimate`/`offline-preview`; original guidance, source hashes and completion records remain intact.

Working days apply to AI proposals independently of free planner settings. Accepting a proposal with weekend placements enables calendar weekend display; no existing weekend assignments are removed. Existing manual overlaps remain legal and count as separate commitments. A day/week already above capacity receives no new AI work. The weekly utilization budget is rounded down to a supported half hour and is a hard combined limit whenever new work is proposed. Daily minutes and the existing maximum-task count also apply. Short valuable backlogs can still fit in week one; no artificial delay is required. The offline generator is a transparent severity-first simulation, not a claimed Muse judgment or validated SEO-impact predictor.

## Original financial readiness checkpoint (before isolation follow-up)

The shared provider, cost estimator and ledger currently enforce 32,768 input bytes and 1,500 output tokens. The full 60-task/52-week contract cannot generally fit. The transport also retains its historical `wordpress_analysis` format name. None of those shared behaviors was changed. Live generation is unavailable by default, before request preparation, because no planner-specific authorization capability/allocation is registered. No credentials or ledger reads occur for a blocked request. A future capability must use the scope `smart-planner:muse:roadmap-v1:<businessId>`, authenticate the actor server-side, enforce a dedicated allocation and bind exact request/snapshot/generation identity before calling the existing central provider. Existing financial capacity is not authorization.

Before any future live test: (1) separately review a planner-only compact/batch contract or additive output-limit policy without changing historical scoring/Fix requests; (2) measure the exact request and maximum response against central limits; (3) implement and offline-test the dedicated central allocation/preflight capability without activating funding; (4) obtain separate exact funding and administrator paid-request approval; (5) explicitly generate one live proposal, validate/review it and only then explicitly apply if desired. Unknown outcomes must never be redispatched automatically. No ready-to-run paid command is provided while these prerequisites are unresolved.

## Final verification — November 2, 2026

**Offline workflow implemented and verified. Live dispatch unavailable pending the financial/size prerequisites above; no live Muse verification was performed.**

- `server/npm run check`: typecheck, lint, **94 suites / 2,043 passing tests / one existing skip**, production build passed. Log: `server/node_modules/.cache/smart-planner-ai-check.log`. Focused AI domain suite also passed all 79 cases after adding advisory/mixed dependency-cycle coverage; dedicated gateway has 15 offline cases. Full suites cover API validation, migration preservation, fresh/repeated reopen, source/revision staleness, duplicate generations/applications, rollback, failed/invalid outputs, interruption/expiry, business isolation and zero unauthorized paid calls.
- `client/npm run lint` and `npm run build`: passed. Existing non-failing bundle-size warning remains (~543 kB main chunk); no dependencies added.
- `client/npm run test:planner`: pure source/scheduling, transport/session/timing, strict AI response/transport checks and **12 offline browser scenarios** passed. The original ten scenarios remain passing. New coverage exercises settings persistence/budget, no generation on open/navigation, blocked live generation, explicit offline preview, protected/deferred work, all weeks' summaries, explicit approval, failed apply retention/retry, no false acknowledgement, reload durability, stale conflict and business-switch races.
- Browser evidence: `client/node_modules/.cache/backend-lab-smoke/run-ixDufV`, **40 PNGs**. Desktop (1440) and mobile (390/320) AI settings/review/workload/apply states were captured; screenshot inspection verified readable content, existing dialog scrolling and no viewport overflow. Original weekly/monthly checks retain 1440/768/390/320 coverage. Browser fixtures import the actual snapshot builder, offline generator and validator, while persistence/API transaction tests use temporary SQLite databases.
- `git diff --check` reviewed; no protected Muse transport, accounting, scoring/Fix or WordPress implementation file was changed. No real application DB reset/manual migration, provider request, paid request, funding/approval change, commit or deployment was performed for this extension. Schema 7 applies on normal backend startup.

### Files and local testing

Created backend: `planner-ai.domain.ts` (snapshot/prompt/schema/validator/offline simulation), `planner-ai.gateway.ts` (central adapter and blocked dedicated authorization capability), `planner-ai.store.ts` (checksummed records), `planner-ai.service.ts` (orchestration/CAS/application), `planner-ai.dto.ts`, `planner-ai.controller.ts`, four `smart-planner-ai-*.spec.ts` test files and this tracker.

Created frontend: `PlannerAiDialog.tsx`, `plannerAi.ts`, `planner-ai.test.mjs`. Modified planner module/service/types/source adapter/DTOs, SQLite migration, Swagger and migration/source-parity expectations; frontend calendar/page/hook/session/API/types/task estimate-provenance display/package/browser harness; README, PLAN, DATABASE, AGENTS and the original planner tracker. Additional backend source severity is provenance only and does not change the existing task recommendation mapping. The free button is labeled `Auto Plan (Free)`; its algorithm/parity fixtures were preserved.

Local test steps: restart backend to apply schema 7 and refresh the client. Confirm a planning time zone in existing Planning settings. Choose the desired week, open **AI Plan with Muse**, save desired AI settings, explicitly select **Offline preview — no Muse request**, generate, inspect protected commitments/weekly workload/deferred work, check approval and apply. Reload to verify persistence. Choosing live mode instead produces approval-required and makes no provider call.

Remaining limitations: live response sizing/dedicated financial capability unresolved as detailed above; maximum 60 visible planner tasks and 64 KiB snapshot per generation, maximum 256 KiB structured output and 512 KiB stored proposal; supported effort choices remain 30/60/90/120/180/240 minutes. Longer work requires explicit task decomposition in a future design, never silent splitting. Unapplied proposals expire after seven days; records remain retained for auditability with no destructive/background cleanup. Public shared-user ownership/authentication remains the application's pre-existing future boundary; business scoping here is not a replacement for it. No shared-file coordination blockers remain.

## Isolated gateway follow-up — November 2, 2026 (current)

Reused all offline scheduling, source/snapshot contracts, prompt/schema versions, review/apply endpoints, proposal storage, revision/mutation protections and frontend components. No scheduler, database migration, UI redesign or second schedule persistence path was introduced.

Changes are limited to `planner-ai.gateway.ts`, its service's safe typed error mapping, the new `planner-muse.request.ts`, planner-owned tests and this document. The gateway no longer calls shared `MetaMuseProvider.prepare/generate`, which hardcode legacy limits. It prepares a bounded scheduling-specific Responses request and decodes its response locally; it does not implement HTTP, read credentials, mint transport grants or create a ledger. The existing provider/accounting owner supplies the narrow trusted execution capability described below. Master `AI_ENABLED`/`MOCK_AI`/`AI_MODE` security switches still prohibit real requests; their values and all other features' configurations are untouched.

### Scheduling-only server configuration

| Environment key | Default | Bound / purpose |
| --- | --- | --- |
| `PLANNER_MUSE_MODEL` | `muse-spark-1.3` | Standard `muse-spark-1.3` or `muse-spark-1.2`; no Contributor mode or fallback |
| `PLANNER_MUSE_MAX_OUTPUT_TOKENS` | Required explicit value | 512–16,384; choose a value confirmed for the selected provider model. Does not inherit `AI_MAX_OUTPUT_TOKENS` |
| `PLANNER_MUSE_MAX_REQUEST_BYTES` | 98,304 | 8,192–131,072 for the entire wire body, including prompt/schema |
| `PLANNER_MUSE_TIMEOUT_MS` | 90,000 | 1,000–120,000; abort signal and no automatic paid retries |
| `PLANNER_MUSE_PER_GENERATION_MICROS` | 500,000 ($0.50) | 1–1,000,000; reservation ceiling, **not funding authorization** |
| `PLANNER_MUSE_ALLOWANCE_CEILING_MICROS` | 0 | 0 disables this additional ceiling; positive values up to 100,000,000 further restrict a request. Never creates an allowance or proves remaining funds |

No real `.env`, global config validator or other workflow settings were changed. Tests explicitly request 8,000/12,000 output tokens with fixture responses. These are tested application settings, not claimed provider-certified limits. A missing explicit output cap is a configuration error once live capabilities are present; Offline Preview is independent of these settings.

### Provider capability inspection

Inspected official [Responses documentation](https://dev.meta.ai/docs/protocols/responses), [models](https://dev.meta.ai/docs/models), [structured output](https://dev.meta.ai/docs/structured-output), and [pricing](https://dev.meta.ai/docs/pricing-rate-limits) on November 2. `max_output_tokens` includes reasoning plus visible output, has a minimum of 16, and shares the model context budget with input. The documented Muse Spark context is 1,048,576 tokens; an output budget above the model's configured maximum is rejected with HTTP 400. The public documentation inspected does **not** publish a concrete per-model maximum output value, so this work does not assume 8,000 is available for the account/model or enable it implicitly. Provider confirmation remains required before live configuration; HTTP 400 is reported accurately without a smaller paid retry.

Scheduling requests use `planner_muse_schedule` as their own structured-output format name and preserve `seo-impact-roadmap-v1` / `planner-muse-proposal-v1`. Tools, streaming, background processing, provider storage and truncation remain disabled. Completed status, requested model, usage bounds, one complete assistant message, valid JSON and the strict existing response contract are required. The existing service then runs its scheduling validator before storing a ready proposal. Large valid fixture responses above 1,500 output tokens are accepted within the explicit planner cap; incomplete, refusal, malformed, oversized and overrun responses are rejected.

### Costs and exact remaining shared integration

Use the existing reviewed Standard price constants/version/expiry and `museUsageCostMicros` calculation. Reserve conservatively for all wire bytes (`bytes*4+4096` input tokens) plus the entire chosen output allowance. Enforce context, per-generation and optional allowance ceilings before calling financial preflight. Request hash binds exact payload; settings hash also binds timeout/cost/ceiling settings. No local account balances, financial tables, usage fabrication, budget activation or ledger writes were added.

The two planner-owned dependency tokens remain deliberately unregistered:

1. `PLANNER_AI_AUTHORIZATION.preflight(...)`: authenticate server-side actor and reserve current dedicated business-scoped planner capacity for the exact request/settings/snapshot/generation tuple. An already authorized planner allowance may authorize subsequent explicit generations automatically within its limits—no repeated diagnostic approval UI is required. Missing/exhausted/storage-failed capacity blocks dispatch; never borrow assessment/Fix/development/WordPress funds.
2. `PLANNER_MUSE_EXECUTOR.execute(prepared, approval, context, signal)`: the **existing central owner** reuses the server-held `MODEL_API_KEY` and its private one-use transport grant, dispatches once through `MetaMuseTransport`, records/settles actual input/output usage in the existing accounting database even for invalid/truncated responses, and keeps unknown reservations locked on timeout/network ambiguity. Return the central attempt ID and exact request/settings/scope identity; missing/mismatched receipts reject the proposal.

The concrete missing integration is a planner-specific allowance reservation/intent-validation branch (allowing only this purpose's bounded output cap) and a central prepared-request dispatch entry point that can mint the existing private transport grant. Existing generic intent validation caps output at 1,500, and the transport's grant map is private to `meta-muse.provider.ts`; a local HTTP or financial workaround would bypass established protections. Those shared files have concurrent WordPress/allowance work. They were left untouched. The adapter must preserve every existing workflow's validators, requests, records and limits; no broad provider/accounting refactor is needed or authorized by this implementation. Funding activation and paid testing remain separately unauthorized.

If `allowanceCeilingMicros` is positive, the central preflight must additionally enforce it against cumulative settled charges plus outstanding reservations, bounded by the separately approved grant. The local check rejects a request that individually exceeds it, but never treats this environment value as available/authorized funds. The bridge must not expose the private dispatch-grant factory to callers or call the raw HTTP transport without a central reservation.

**Readiness:** isolated configuration/request/decoding/gateway behavior is implemented and fixture-tested. Real generation is still blocked until the accounting/provider owner wires those two capabilities and a verified output cap and separately approved planner allowance exist. No actual provider call, credential access, budget increase or accounting record change occurred in this follow-up. Frontend and atomic apply are unchanged. Prior full verification above is a historical checkpoint; follow-up results are recorded below.

### Isolation verification

- Full backend `npm run check`: **96 suites passed, 2,110 tests passed, one existing skip**, plus typecheck, lint and production build. Log: `server/node_modules/.cache/planner-muse-isolation-check.log`.
- Focused request preparation/decoding: **31 tests passed**. Focused gateway/authorization/timeout/receipt/security-switch cases: **41 tests passed**. Existing offline domain/API/migration tests: **102 tests passed**. Larger explicit 8,000/12,000-token configurations are exercised with mocked responses; the existing provider still prepares at its original 1,500-token cap and rejects its original oversized inputs.
- Existing client `planner-ai.test.mjs` and `smart-planner-api.spec.mjs` passed. No frontend source/layout changes were made or new visual verification claimed in this follow-up; prior screenshot verification above remains the baseline.
- Changed in this follow-up only: added `planner-muse.request.ts` and `planner-muse-request.spec.ts`; updated `planner-ai.gateway.ts`, safe typed error mapping in `planner-ai.service.ts`, its owned gateway test and this tracker. No shared provider/accounting/configuration, credential, allocation, database schema, scheduler or application logic edits. Other agents' pre-existing and ongoing changes remain intact.
- Zero real Muse calls, financial reservations/allowance activations, protected ledger writes, commits or deployment. Remaining coordination is exactly the shared allowance/transport bridge described above, not another planner redesign.
