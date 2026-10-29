# SEO Spy server

Local NestJS API using TypeScript and the Express adapter. Supports simulated demo audits, **real single-homepage HTML audits**, and **Lighthouse lab measurements through Google PageSpeed Insights**. No local browser is required. Facebook, AI providers, and external changes remain deferred.

## Setup

Use Node.js 24 (verified with 24.11.1) and npm. From this directory:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

The environment file is optional; defaults match `.env.example`. The server listens on `http://127.0.0.1:3001/api`. `HOST` is restricted to `127.0.0.1` because authentication is not implemented. Keep this API local.

The server and client run independently. The client still uses its original fixtures; connecting it to this API is milestone 2 in [PLAN.md](PLAN.md).

## Interactive API documentation

Open **http://127.0.0.1:3001/api/docs** after starting the server. Swagger UI lists every implemented endpoint and the request/response models, including nested evidence, findings, scores, and errors. Expand an endpoint and select **Try it out** to send a request to the local API.

Use `demo-guzman` as the business ID. To create an investigation, submit `{ "scope": "demo" }` for simulated results or `{ "scope": "homepage" }` for a real homepage audit; then copy its returned ID into the audit endpoints to inspect progress and results. Use `{ "scope": "lighthouse", "strategy": "mobile" }` to add Google Lighthouse measurements (or choose `desktop`). All modes store their audit history in memory.

The downloadable OpenAPI JSON is at **http://127.0.0.1:3001/api/docs-json**. Documentation uses the same local API and needs no separate service or credentials. Keep response DTOs and Swagger annotations updated when adding or changing endpoints.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Compile and restart on changes |
| `npm run build` | Build `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Check application and test types |
| `npm run lint` | Run ESLint |
| `npm test` | Run configuration and API tests |
| `npm run check` | Type-check, lint, test, and build |

NestJS runtime packages use version 12. The Nest CLI stays on version 11 because the version 12 CLI's Angular tooling requires a newer Node patch release. The CLI is a development/build tool; it does not determine the runtime framework version. TypeScript 5.9 is used for this backend; it is independent of the client's compiler version. Exact dependency versions are recorded in `package-lock.json`.

The server uses ES modules (`NodeNext`); relative TypeScript imports use `.js` extensions for the compiled output. Jest currently runs with Node's experimental VM-module flag to test ESM dependencies. This flag is confined to the test command; normal server startup does not require it.

## Try the API

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
Invoke-RestMethod http://127.0.0.1:3001/api/businesses/demo-guzman/dashboard

$audit = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3001/api/businesses/demo-guzman/audits `
  -ContentType 'application/json' `
  -Body '{"scope":"demo"}'

Invoke-RestMethod "http://127.0.0.1:3001$($audit.statusUrl)"
Invoke-RestMethod "http://127.0.0.1:3001/api/audits/$($audit.id)/findings"
Invoke-RestMethod "http://127.0.0.1:3001/api/audits/$($audit.id)/recommendations"
```

Audit creation returns `202 Accepted`. Poll its status URL until `completed`, `partial`, or `failed`. At the default stage delay, a simulated audit completes in roughly four seconds:

```text
queued → collecting_evidence → evaluating_checks → preparing_recommendations → complete
```

The middle stages have `status: running`. Demo mode collects no real evidence. Homepage mode fetches the registered business website, with a 30-second collection deadline. Creation requires a scope of `demo`, `homepage`, or `lighthouse`; missing/unknown scope and extra fields are rejected. A second active audit for the business returns `409 AUDIT_ALREADY_ACTIVE`.

The dashboard exposes the last completed audit and an optional active audit separately, retaining previous results during an investigation. Findings reference evidence returned by the findings endpoint. Recommendations reference findings. Demo scores are explicitly illustrative (`availability: demo`). Real homepage scores have `value: null` and `availability: unavailable`; no scoring model is claimed. Pending/failed audit result lists may be empty; check the returned status.

Errors use `{ "error": { "code", "message", "requestId" } }`. Responses include `x-request-id`; use it to correlate request logs. Logs omit request bodies, headers, and query strings. HTTP tests use the same global validation and filters as the running server.

## Real homepage audits

With the server running, send:

```http
POST /api/businesses/demo-guzman/audits
Content-Type: application/json

{"scope":"homepage"}
```

The target comes from the business record (`https://guzmantaxaccounting.com`); the API does not accept a URL override. Poll the returned `statusUrl` until `completed` or `failed`. Read `/api/audits/{id}/findings` for both findings and **all collected evidence**, including checks without issues, and `/api/audits/{id}/recommendations` for linked suggestions. The business dashboard supplies the latest completed results and unavailable scores. Returned live records use `mode: live`; `homepage-v1` identifies the initial, unscored HTML check set. Previous results remain visible while a new investigation runs or if it fails.

Checks cover one nonempty title and description, H1 count/content and heading observations, canonical validity/match, page-level indexing restrictions, and image alt attributes. Canonical differences and empty image alternatives are review items, not proof of an error. Evidence `observed` is a string map; lists such as headings, image observations, and redirect chains are JSON strings. Treat all collected strings as untrusted text when displaying them.

Collection accepts public HTTP/HTTPS on standard ports only. Every DNS answer must be public, each request pins a validated IP while preserving hostname/TLS validation, and the actual remote address is checked. Redirects are revalidated (at most five); HTTPS downgrades are rejected. Limits are 30 seconds total including DNS/redirects/body, 2 MiB HTML, 16 KiB response headers, and two concurrent collections. Requests do not carry browser cookies or credentials. Compression contrary to the identity request is rejected. Failures expose safe codes such as `BLOCKED_DESTINATION`, `COLLECTION_TIMEOUT`, `HTTP_ERROR`, `RESPONSE_TOO_LARGE`, and `COLLECTION_FAILED` in the audit's `failure` field.

This does not execute JavaScript, fetch image assets, measure page performance, verify search-engine indexing, or evaluate robots.txt/sitemaps. No numeric SEO score is calculated. HTML is parsed transiently; only extracted evidence remains in memory.

If a validated address is unreachable, the collector tries the other validated addresses for that hostname. Each connection attempt has a five-second connection/TLS-handshake timeout; all attempts and redirects share the existing 30-second deadline. Policy, HTTP, content, certificate-validation, and cancellation failures stop collection without address fallback.

Run an explicit live smoke test from `server/`:

```powershell
npm run audit:homepage
```

This builds the server, starts a temporary loopback API on an available port, submits/polls a real audit through HTTP, saves `reports/guzman-homepage.json`, and closes the API. It requires public network access and is separate from `npm run check`. The saved report is a snapshot, not durable application storage. The October 28 test completed with HTTP 200 after the www redirect, 245,059 bytes, and one contextual image-alt review finding (eight empty alternatives; zero missing attributes).

Report scores are included only when the dashboard's latest completed audit ID matches the tested audit ID. Otherwise `scores` is empty, so a failed or unfinished live audit cannot inherit a previous audit's demo scores.

## Lighthouse through Google PageSpeed Insights

The `lighthouse` scope runs the protected HTML collector first, then sends the final public URL to Google's PageSpeed Insights v5 API. Google runs the browser remotely; this does not launch Chrome on the backend or relax the local collector's restrictions. The browser-rendered page and its resources are processed by Google, so its measurements may differ from the separately collected HTML and between runs.

Configure the server:

1. Select/create your Google Cloud project, enable the [PageSpeed Insights API](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com), and create a key using [Google's setup guide](https://developers.google.com/speed/docs/insights/v5/get-started).
2. Restrict the key to the PageSpeed Insights API and use suitable server IP restrictions where available. Put it only in the ignored `server/.env` as `PAGESPEED_API_KEY=your-key`; never use a `VITE_` variable or send the key from the browser. Existing process environment values take precedence over `.env`.
3. Keep `PAGESPEED_TIMEOUT_MS=120000` unless needed (allowed range: 1000-180000 milliseconds). Restart the API after configuration changes.

Blank keys use anonymous access, which may have no available quota. Google can return quota/access errors even when the HTML page is reachable. The provider sends the key in the `x-goog-api-key` header, not a URL, and does not expose provider error bodies. See [Google's key-handling guidance](https://cloud.google.com/docs/authentication/api-keys-best-practices).

```http
POST /api/businesses/demo-guzman/audits
Content-Type: application/json

{"scope":"lighthouse","strategy":"mobile"}
```

Choose `mobile` (default) or `desktop`; strategy is rejected for other scopes. Poll `statusUrl`, then read `/api/audits/{id}/lighthouse`. Its response contains `report`, `status`, `failure`, and `warnings`. The report is null for pending/failed measurements and non-Lighthouse scopes. The dashboard adds a nullable `lighthouse` field for the latest completed/partial audit; the per-audit endpoint also preserves access to historical measurements.

Reports contain four category scores scaled to 0-100: performance, accessibility, best-practices, and SEO. Zero is a measured score; unavailable scores are null. Each report retains provider, device strategy, requested/final URL, fetch timestamp, and actual Lighthouse engine version. Lab metrics include FCP, LCP, TBT, Speed Index (milliseconds), and CLS (unitless). Checks preserve their score display modes, including manual, error, and not-applicable outcomes. Raw screenshots, network details, and unrelated provider fields are not retained.

Failed measured numeric/binary checks referenced by a category generate review findings with `lighthouse:` check IDs, evidence references, and recommendations. Manual, informational, not-applicable, and error outcomes do not become passing or failed findings. The original website/social/consistency/overall `scores` array remains unavailable for real audits; Lighthouse is a separate measurement source. Its lab results do not establish field Core Web Vitals, full accessibility compliance, social performance, or a combined SEO Spy score.

During measurement, the audit has `status: running` and `stage: running_lighthouse`; HTML evidence may already be available. PageSpeed failure or missing category scores produces `status: partial` with usable HTML results, safe failure information, and warnings. If protected HTML collection fails, PageSpeed is not called and the audit fails. Shutdown aborts pending provider work. Partial audits count as terminal and become the latest usable dashboard results; frontend polling must stop on `completed`, `partial`, or `failed`.

Provider calls are limited to one at a time, a configurable total deadline, and 20 MiB of decoded JSON. The endpoint is fixed, redirects are disabled, responses are validated, and quotas/access errors are not automatically retried. Normal automated checks use controlled responses without contacting Google.

From `server/`, run `npm run audit:lighthouse` (mobile) or `npm run audit:lighthouse -- --desktop`. This starts a temporary local API, exercises the HTTP workflow, writes an ignored `reports/guzman-lighthouse-mobile.json` or `reports/guzman-lighthouse-desktop.json`, and shuts down. A partial/failed audit exits nonzero while still saving its usable evidence. Keep repeated live calls deliberate because they consume provider quota.

## Storage and shutdown details

Businesses and audits use singleton in-memory repositories registered with explicit dependency-injection tokens. Each process seeds one demo business and a completed demo audit. A completed homepage audit replaces the latest dashboard results with `mode: live`; seeded results remain available by audit ID. All history disappears on restart; memory history is suitable only for a short local demo, not sustained production use.

The in-process runner catches failures and marks failed audits. Graceful shutdown stops queued work, aborts pending stage timers, and waits for jobs to settle. There is no durable queue or recovery across restarts yet. No database or Redis instance is required. Demo and homepage modes need no provider credentials; Lighthouse uses optional server-side PageSpeed credentials and is subject to Google quotas.

See [PLAN.md](PLAN.md) for the data model, future integrations, PostgreSQL migration strategy, milestones, and progress.
