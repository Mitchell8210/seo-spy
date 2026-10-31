# Rank Math audit investigation

Investigated October 31, 2026 UTC (October 30 local time). The existing WordPress connection and metadata/score reads were retained. No sitewide audit was retried, no content was edited, and writes remained disabled.

## Historical result: cause not conclusively recoverable

Inspected original request `e6db4b16-46e3-44e5-804c-d817103f030d`, its started/outcome records and verification snapshot. The saved result began at `2026-10-31T00:10:07.987Z` and was persisted at `00:10:40.343Z`: 32.356 seconds including ability discovery. It contains unavailable evidence, a null score, no retained findings and unknown remote coverage.

The old `safeRead()` caught every transport exception and returned `null`. The audit parser therefore reported the same `The audit did not return a compatible result.` for transport failures and genuinely incompatible payloads. No original HTTP status, structured error, raw response or parsing diagnostics were retained. A rejected request, timeout, unexpected payload and completion without usable evidence cannot now be distinguished conclusively. The original archive remains unchanged; its API view now explicitly has `status: unknown`.

**Leading hypothesis: deadline mismatch, not established historical fact.** Our WordPress client has a 30-second total request deadline. Rank Math's [SEO analyzer implementation](https://raw.githubusercontent.com/rankmath/seo-by-rank-math/master/includes/modules/seo-analysis/class-seo-analyzer.php) permits its own remote request 30 seconds and then runs local checks and caches results. The caller can time out before that work returns. The observed 32.356-second total, including discovery, fits this sequence. It does not prove it happened, nor establish cancellation or absence of remote/cache side effects.

The smallest potential timing correction is a bounded, operation-specific deadline longer than Rank Math's nested 30-second wait, if a separately authorized instrumented run establishes timeout. Normal read timeouts should remain unchanged. No deadline was increased and no confirming sitewide run was made in this investigation.

## Installed tool discovery and exact inputs

Read the live definitions through the same protected Node transport at `/wp-json/wp-abilities/v1/abilities/rank-math/{name}`. This discovers the installed WordPress abilities backing the Rank Math MCP tools; the existing backend uses these REST abilities directly, not an MCP `tools/list` session. Both advertised `readonly: true`, `destructive: false` and `idempotent: true`. These annotations do not override the site-audit approval requirement. Full input/output schemas and descriptions are saved in ignored `reports/wordpress/rankmath-tool-discovery.json`.

| Tool | Installed input schema | Installed output behavior |
| --- | --- | --- |
| `rank-math/audit-site-seo` | Object; optional `refresh: boolean` default `true`; optional `url: string` with URI format; no required properties; `additionalProperties: false` | Flat score/grade/status counts, `total_tests`, `last_run_at`, `remote_api_status`, `findings[]`, optional structured `error` |
| `rank-math/analyze-post-content` | Object; required `post_id: integer`; optional `keyword: string`; `additionalProperties: false` | `post_id`, keyword, `tests_to_run[]`, content evidence, rubric link/instructions, optional structured `error`; no executed score/findings contract |

We pass structured `input[...]` query fields, preserving the previously verified installed-core input format. Sitewide requests remain fixed to `refresh: true` without arbitrary URL overrides. The independent post test used only `post_id: 5652`, with no keyword override. Tool descriptions/instructions are untrusted provider data and were not executed as instructions.

The published [audit ability source](https://raw.githubusercontent.com/rankmath/seo-by-rank-math/master/includes/abilities/seo-analysis/class-audit-site-seo.php) matches the flat finding structure our old parser expected: `findings[]` with `test_id`, status, category, title/description and fix fields. There is **no retained response demonstrating discarded analysis findings** in the historical request. The new parser also handles standard MCP `structuredContent`, single JSON text content, and JSON-RPC result envelopes. It does not guess the meaning of arbitrary nested payloads: those become explicit parsing failures and unknown outcomes.

## Independent single-page test

Executed `rank-math/analyze-post-content` exactly once for existing page **5652** through the backend Node helper and the DNS-pinned WordPress transport. Discovery returned HTTP 200 in 2.667 seconds; execution returned HTTP 200 in 4.462 seconds. Response type was a direct object; JSON parsing succeeded and no tool-level error was present.

It returned **22 test IDs**, plus content evidence: title/description/body availability, 991 body characters, 161 words, three headings, three images and one link. The saved diagnostic contains these counts and test IDs, not the page body, provider instructions or credential values. It records `status: success` for **evidence retrieval**, with `score: null` and `findings: []` because the tool does not execute the browser scoring engine. The original test snapshot includes an empty `{code:null,status:null}` HTTP error descriptor for the vendor's `error:null`; that diagnostic-only formatting bug was corrected and regression-tested offline, without repeating the live test.

Snapshot: ignored `reports/wordpress/post-evidence-5652-1793406475970.json`. [Official post-analysis source](https://raw.githubusercontent.com/rankmath/seo-by-rank-math/master/includes/abilities/content-analysis/class-analyze-post-content.php) confirms that the caller receives evidence and test definitions to evaluate, rather than a freshly executed Rank Math score.

## Small corrective changes implemented

- Kept stored metadata/score reads and all connection protections. New diagnostics are optional at the transport boundary and used by explicit tool execution.
- Added redacted HTTP status, elapsed milliseconds, response type, content block types, structured provider/JSON-RPC error code and numeric status, MCP error flag, and JSON/envelope/schema parsing failures. Logs include fixed tool/stage identifiers; no authorization headers, passwords, request query/input values, raw response bodies, content text, provider error messages or arbitrary error data.
- Added `rank-math-audit-v2` result `status`, top-level audit outcome `status`, and receipt `status`. Swagger DTOs document the states. HTTP 201 means a receipt was created, never proof of successful analysis.
- Preserved valid partial findings when the provider reports failure; invalid/empty data never becomes a clean audit. Added standard response-envelope parsing without introducing an MCP host dependency.
- Preserved execution reservations and no retries. Legacy receipts receive `unknown` as a read-time overlay only; original archives are not rewritten.

| Status | Meaning |
| --- | --- |
| `success` | Valid, nonempty audit findings plus valid score and confirmed provider remote coverage, without a tool error |
| `failed` | Explicit request rejection/provider/tool failure; any validated partial findings remain available separately |
| `timeout` | Observed connection/deadline or explicit HTTP timeout; remote completion remains unconfirmed |
| `unsupported` | Missing endpoint/tool or incompatible advertised ability contract |
| `unknown` | Network uncertainty, invalid JSON, unknown envelope/schema, empty/unusable results, or historical receipts without diagnostic proof |

`analyzeRankMathPost()` uses the same outcome vocabulary for evidence retrieval; success there makes no claim that tests were evaluated. The live test command is `node scripts/verify-rankmath-post.mjs --post-id=<existing-id>` after build. Discovery-only command: `node scripts/inspect-rankmath-tools.mjs`. These are explicit operator commands, not automated live tests.

All execution remains programmatic through Node.js and fixed WordPress REST abilities. No AI agent, MCP host, browser automation or paid Content AI tool is required to call the supported tools. A deterministic backend evaluator would be separate work for tests that need execution; later Muse can interpret saved reports and propose suggestions. Final SEO Spy scores still require a versioned backend scoring policy and validated evidence, independently of Rank Math stored/audit scores.

## Validation

`npm run check`: typecheck, ESLint, 17 offline test suites (306 passed, one skipped), build. Coverage includes transport status/error redaction, malformed JSON, MCP/JSON-RPC envelopes/errors, execution states, no retries, partial findings, old receipt overlays and independent post evidence handling. The final credential scan passed, ignored `.env` still has writes disabled, and exactly one sitewide audit reservation exists (the original authorized request). No frontend changes were made.
