# Meta Muse read-only provider

Implemented October 31, 2026. Offline transport fixtures pass; no account access, live generation, billing configuration or real-data transmission has been verified. Choosing an API/model in code does not enable spending.

`MetaMuseProvider.generate({ instructions, input, schema }, signal?)` makes at most one request and returns parsed JSON, the configured model, reported token usage and a sanitized request correlation ID. The caller must validate the output against its runtime schema and resolve every evidence reference before publication. JSON parsing and the provider's strict response format do not establish factual accuracy or authorize an action.

## Configuration

The backend configuration must supply these independent gates and bounds:

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_ENABLED` | `false` | Global model generation gate |
| `MODEL_API_KEY` | blank | Private backend credential |
| `AI_MODEL` | blank | Explicit Standard-mode selection; only `muse-spark-1.3` and `muse-spark-1.2` are accepted |
| `AI_MAX_CALLS_PER_PROCESS` | `0` | Generation disabled until a positive limit is deliberately configured; maximum 100 |
| `AI_MAX_CONCURRENCY` | `1` | Maximum simultaneous calls; environment validation caps this at two |
| `AI_TIMEOUT_MS` | `60000` | Total request deadline; 1000–120000 ms |
| `AI_MAX_INPUT_BYTES` | `131072` | Complete request payload limit, including instructions/schema; environment range 4096–131072 bytes |
| `AI_MAX_OUTPUT_TOKENS` | `2000` | Requested upper bound including reasoning; environment range 16–8000 tokens |

These are call/token bounds, **not a hard dollar budget**. The call counter is in memory and resets when the backend restarts. A failed, timed-out, cancelled or invalid generation still consumes its reservation because remote work/billing may already have occurred. There are no automatic retries. Shared operation or a restart-safe spending budget requires durable reservations and an agreed pricing/budget policy before enabling live calls. Provider account limits must also be configured independently.

The adapter does not implement a public generation route. Any caller that exposes it over HTTP must enforce the existing authenticated local operator, exact trusted Origin/Host checks, business/site binding and explicit user generation request. GET report reads must never generate. Application identity and membership are required before shared/public use. Model interpretation has no WordPress execution tools and cannot turn a recommendation into an approved Apply request.

## Transport and outcomes

Requests use native HTTPS to the fixed `https://api.meta.ai/v1/responses` endpoint. Neither report content nor browser requests can choose a provider destination, headers, model or tools. The request separates developer-level instructions from a JSON-serialized user evidence block, requests strict JSON output, uses `store: false`, and disables tools/background/streaming. It never requests encrypted reasoning, reasoning summaries or a previous response.

Transport rejects redirects, unsupported compression and oversized headers/responses. The response body limit is 512 KiB, enforced against both declared and streamed bytes. Native HTTPS validates TLS certificates. The total deadline and optional caller cancellation abort the connection; remote cancellation or absence of billing cannot be inferred. Raw provider error bodies and private chain-of-thought are not returned, persisted or logged by the adapter.

Safe errors distinguish disabled/missing configuration, disabled/exhausted call budget, concurrency rejection, input limits, authorization failure, unavailable quota, rate limit, redirect, network failure, timeout, cancellation, oversized response, provider failure, refusal, truncation and invalid output. Only a completed response for the selected model with a single assistant JSON answer and valid reported usage is accepted. Tool output is rejected. Any reasoning items are excluded from the returned generation.

## Sources and compatibility

Official documentation checked October 31, 2026:

- [Responses API](https://dev.meta.ai/docs/protocols/responses) documents the endpoint, typed user inputs, developer-level `instructions`, completed output messages and usage. Its stateless mode supports `store: false`.
- [Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas) documents `text.format` with `type: "json_schema"`, schema/name/strict fields, output-token limits and refusal/output item shapes. Responses payloads differ from the Chat Completions `response_format` examples.
- [Models](https://dev.meta.ai/docs/models) identifies pinned Muse Spark versions and separates Standard model IDs from Contributor variants. This adapter accepts only the two listed Standard IDs; model/account availability and approved data handling still require live confirmation.

The adapter uses documented contracts, not an account-tested integration. Before a live test, select the model and permitted data, authorize a bounded budget, confirm account access and processing terms, and validate the exact assessment schema with that model. Leave model generation disabled until those decisions are complete.

Offline verification: `npm test -- --runTestsByPath tests/meta-muse-provider.spec.ts`. Coverage includes configuration gates, request shape, call/concurrency limits, failed-call accounting, refusal/truncation/tools, JSON/usage validation, safe errors, timeout/cancellation, transport encoding/redirect/size limits and secret redaction. No credentials are loaded from `.env` and no network calls are made.

The operator HTTP pipeline is implemented: see [report and analysis routes](WORDPRESS_REPORTS.md). It remains default-off. After the user chooses the Standard model, approves the data/budget and configures `MODEL_API_KEY` privately, one explicit test can use a current-policy saved report:

```powershell
node scripts/verify-wordpress-muse.mjs --confirmed --report-id=SAVED-UUID-V4 --model=APPROVED-STANDARD-MODEL --max-input-bytes=APPROVED-BYTES --max-output-tokens=APPROVED-TOKENS
```

The script limits its temporary process to one model dispatch, disables WordPress writes, forbids WordPress collection/fresh audits, compares the saved analysis GET with the generation result, and disables AI before shutdown. It never retries a failed/unknown generation. Its flags are placeholders requiring actual user decisions; the script has not been run live. Call/token bounds do not enforce a dollar cap; establish provider/account limits and a conservative cost bound before invoking it.
