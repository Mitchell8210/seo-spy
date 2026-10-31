# SEO Spy backend plan

Detailed next-stage backlog: [Meta Muse agent integration plan](AI_AGENT_INTEGRATION_PLAN.md). The WordPress-only read-only slice is implemented behind default-off gates; broader cross-channel scoring/actions remain planned. This backlog supersedes the generic future-AI outline for task sequencing; existing implementation history remains below.

Status: foundation, homepage checks, Lighthouse integration, isolated backend-lab workflow, and durable report files implemented. Main dashboard action/status integration is available; real result-card integration and cumulative scoring remain separate tasks.
Created: October 27, 2026.
Last updated: October 31, 2026.

## Progress record

### October 31, 2026 - SQLite selected and application persistence adopted

- User selected SQLite as the application's database instead of PostgreSQL. Added a primary `reports/seo-spy.sqlite` with transactional migrations, foreign keys, indexed businesses/audits, durable statuses/timestamps, findings/suggestions and immutable report/action artifacts. Repository tokens/API contracts are preserved; frontend presentation is unchanged.
- Existing JSON archives are preserved as compatibility exports and idempotent migration sources. Actual adoption imported 12 audit reports/audits, three WordPress evidence reports, one Muse analysis and three WordPress operation records. Original creation/completion dates and report payloads were retained. Registered identities/newer runtime state are never replaced by archive snapshots.
- Application records/history and Website latest-result selection now survive restart. Facebook audits have separate channel reservations and do not overwrite Website dashboard results. Jobs remain in-process; operator recovery can adopt a saved terminal outcome or close an interrupted run without replaying collection or spending credits.
- The protected AI usage database remains separate and byte-unchanged by migration. WordPress target locks and encrypted credential stores remain protected. No external request, model call, WordPress change, budget reset or history deletion occurred. See [database operation, backup and recovery](DATABASE.md).
- Verification passed: 33 suites, 550 tests and one skipped, plus typecheck/lint/build. Actual adoption rerun inserted nothing and retained all existing counts; the saved mock-analysis API reused its original ID from SQLite in a new process with zero real calls/charges. No client files changed.

### October 31, 2026 - Promotional-credit preservation and mock-first AI

- Implemented the user's $2 lifetime development/$0.50 UTC-daily/ten-call ceilings with transactional SQLite reservations, versioned schema migrations and persistent attempt/approval history. Process restarts and mode changes cannot reset cumulative limits; reductions remain sticky. Unknown outcomes/overruns halt usage; missing/corrupt initialized storage fails closed. No automatic retry, expiry unlock or budget reset exists.
- All real model access now shares one protected provider and payload-bound one-use native dispatch grant. The separate local AI administrator must approve every exact scoped estimate/hash/cost before reservation. One global active/unknown attempt and 60-second spacing apply across processes. Demo requires a separate recorded authorization and cannot draw from development or reset prior usage.
- Safe defaults are MOCK_AI=true, AI_MODE=mock, AI_ENABLED=false, Muse Spark 1.3 Standard/low reasoning, at most 1500 output tokens and 32768 input bytes. The supplied private model key was preserved; a separate ignored administrator credential was configured without exposing it. Adding either credential does not spend credits.
- Added labeled realistic fixtures, summarized cited inputs, mode-isolated persistent cache and local end-to-end mock verification. The actual local API generated mock analysis a1283558-6b10-4c37-8120-9f3563b631b4 from the saved Guzman report, reused its cache and read it back with zero external requests. Persistent development/demo counts and charges remained zero. No live request or live approval was created.
- See [credit protection and administrator runbook](AI_USAGE_RULES.md). Deterministic SEO/Lighthouse collection, numeric scoring and WordPress action authorization remain separate. Provider billing limits are still required; the account's actual credit balance has not been queried.
- Final checks passed: 28 suites, 502 tests and one skipped, plus typecheck/lint/build. Re-running the local mock harness in a fresh process reused the same analysis ID with unchanged zero usage. No client files changed, no live approvals were created, and no real API requests were made.

### October 31, 2026 - WordPress saved evidence, Muse pipeline and public verification

- Implemented separate immutable WordPress evidence reports, saved history/reads, published non-password-protected sample selection, parent-bound media and filtered Rank Math metadata/stored scores. Null scoring/freshness and explicit per-source failures are preserved. First live report saved and read back successfully; its media mapping failure is preserved in the original archive and corrected for subsequent reports.
- Added minimized cited Muse bundles, default-off fixed Responses transport, bounded calls/tokens/concurrency, strict output/target/reference validation and separate immutable WordPress-only interpretation records. Generation requires an explicit confirmed operator request. Live key/model/processing-mode/budget setup remains pending; no live AI calls, scores or model execution tools.
- Added public source-HTML media-alt verification through a shared protected collector with registered-site redirect binding, independent stored/public statuses and saved receipts. Fixtures cover cache mismatch, later propagation, builder/source conflicts and failed collection.
- Prepared the exact media-alt pilot requested by the user on the existing Guzman live site; the preview expired without approval and was not applied. A fresh preview/hash/review is required. Separate staging isolation is not established. The pilot CLI cannot retry uncertain writes or restore automatically. No frontend change was made.
- Final live report `12897672-5152-4f1c-b727-b72cd3cdfe9c` has current visibility-policy proof, all five sources available, 20 pages/17 posts/20 media and 91 bounded Muse observations. Saved/history/preparation checks passed without model calls, writes or a fresh audit. Backend check passed: 24 suites, 429 tests plus one skipped, typecheck/lint/build.
- See [report contracts/results](WORDPRESS_REPORTS.md), [provider setup](MUSE_PROVIDER.md), [pilot workflow](WORDPRESS_STAGING.md) and [remaining tasks](WORDPRESS_NEXT_STEPS.md). Specialized editors, application identity/shared execution, scoring and broader combined assessments remain future work.

### October 31, 2026 - WordPress traffic-data discovery

- Verified active Site Kit with configured/connected GA4 and Search Console. Configuration reads work, but both report reads returned 403 `missing_required_scopes`; the WordPress user behind current credentials has no Google authorization in Site Kit.
- Read existing Rank Math analytics summaries without syncing or auditing: no usable traffic totals; explicit `n/a` is preserved, not converted to zero. Documented candidate metrics and access limitations in [analytics discovery](WORDPRESS_ANALYTICS_DISCOVERY.md). The user explicitly excluded Google authorization setup; no reconnect/OAuth/analytics setup follow-up is planned.
- Added explicit read-only operator diagnostics only; no frontend/API changes, new analytics connection, tracking configuration change or scoring calculation. Writes remain disabled.

### October 30, 2026 - stored Rank Math scoring direction

- User approved using available WordPress/Rank Math metadata and stored scores in the future assessment, with stored scores contributing only a small supporting weight. Exact numeric weights remain undecided; no score calculation was implemented.
- Recorded freshness, sample coverage, missing-data and overlap requirements in the [scoring plan](AI_AGENT_INTEGRATION_PLAN.md#accepted-direction-stored-rank-math-evidence). Evidence packaging can proceed without a fresh sitewide audit; Muse interpretation and final backend scoring remain later work.

### October 30, 2026 - Rank Math execution diagnostics

- Investigated the original unavailable audit without retrying it. Lost HTTP/error data prevents a conclusive historical cause; a 30-second outer deadline versus Rank Math's own 30-second remote wait is the leading timing hypothesis. Existing parser shape matches the installed audit schema.
- Added optional redacted transport diagnostics, explicit audit execution states, standard MCP/JSON-RPC envelope parsing and read-only unknown overlays for old receipts. Kept working evidence reads, write gates, reservations and no retries.
- Discovered both live tool schemas and independently called `analyze-post-content` once on page 5652: HTTP 200, evidence plus 22 test IDs, no executed score. Node execution requires no AI host; Muse interpretation and the final backend scoring policy remain separate. See [investigation and validation](RANKMATH_AUDIT_INVESTIGATION.md).

### October 30, 2026 - WordPress next steps phases 1 and 2

- Configured the ignored local business/site binding and independent operator key with writes disabled. Verified actual module HTTP reads for account capabilities, lists, representative editable records and authorization rejection through a fresh temporary loopback backend.
- Added a repeatable live read-only module diagnostic and [credential-free verification record](WORDPRESS_MODULE_VERIFICATION.md).
- Corrected Rank Math ability paths to match the installed REST index and serialized definition discovery to respect transport concurrency. Offline checks pass; fresh audit authorization remains separate from evidence reads.
- Corrected ability input encoding to structured query fields after live HTTP 400 responses. Verified page/post metadata and bounded stored-score samples through the module (20 pages, 17 posts), preserving null scores.
- Following explicit user authorization, dispatched one fresh Rank Math audit request. Its saved result is unavailable (null score, no established findings, unknown remote coverage); no successful remote scan is claimed. Verified identical same-ID replay and saved GET receipt with exactly one remote audit dispatch, then confirmed writes disabled. See the verification record for request ID, timestamps and limitations. Phase 2 verification is complete; no content edit was performed.

### October 30, 2026 - WordPress local operator module and Rank Math evidence

- Added business-bound WordPress reads and exact-hash approved page/post/media updates through an HTTPS/DNS-pinned bounded adapter. Writes default off; no live changes performed. Local operator authentication is separate from the WordPress application password and future customer sign-in.
- Added persisted proposals, single-execution/target reservations, stale-target checks and distinct stored-field verification. Unknown outcomes/publication failures retain locks; remote compare-and-swap and automatic reconciliation are not implemented.
- Added Rank Math ability discovery, stored metadata/content scores and explicitly requested audit results with durable receipts. No fresh audit runs on GET evidence. See [module setup and limitations](WORDPRESS_MODULE.md) and [Rank Math notes](RANKMATH_API_NOTES.md).

### October 30, 2026 - Dashboard starts both report channels

- Dashboard Run Investigation now requests a Website Lighthouse audit and a browser-authorized Facebook report independently. Both retain saved results during collection/failure.
- Added session-scoped Facebook progress/outcome reads without provider calls; Dashboard and Social Media recover running state after navigation and refresh saved results at completion. Progress is in memory; immutable reports remain durable.

### October 30, 2026 - Social Media report rerun control

- Connected an approved Run Report button beside the social account selector to existing browser-authorized Facebook report generation, preserving saved results during collection and failures.
- Added an exact local frontend origin setting for JSON report requests through the existing proxy. Retained cookie-bound credentials, permission checks, authorized Page selection, duplicate protection, immutable archives and backend-only OAuth/diagnostic routes.

### October 30, 2026 - readable Social Media report evidence

- Added evidence-linked programmatic summaries to the saved Facebook analysis response. Existing detail fields show clear observations, implications and recommendations without raw key/value dumps or post identifiers.
- Preserved collection caveats, immutable archives, metric meanings, UI structure and review-only actions. Older archives gain summaries on read; older APIs without summaries use the existing unavailable treatment. AI generation remains deferred.

### October 30, 2026 - evidence-based Website performance priorities

- Replaced blanket low severity for known Lighthouse performance findings with `website-priority-v1`: strategy-aware metric boundaries, evidence-linked decisions and conditional diagnostic escalation. Preserved measured category scores and unavailable combined scores.
- Generated targeted investigation/fix steps and same-device verification guidance. Unknown checks and unrelated findings retain their existing classifications; poor category scores alone never escalate findings.
- Added saved-report analysis reads and frontend data overlays so legacy reports reflect current priorities without rewriting archives, scans, provider calls, or presentation changes. See WEBSITE_PRIORITY_RULES.md for policy boundaries and sources.

### October 29, 2026 - backend-owned Website evidence summaries

- Added a backend reporting step that persists versioned, concise evidence summaries in newly generated homepage/Lighthouse reports. Uses actual check observations and measured values, with no frontend finding-specific copy catalog. Raw evidence and scores are preserved.
- Added the read-only `GET /api/audits/:auditId/evidence-summary` contract. Older archives gain derived summaries without overwrites, scans, or provider calls. Source references and summary method version remain explicit.
- Connected the existing Website evidence slots to backend summary text and compact source captions, preserving components, headings, controls, styling and layout. Shared Lighthouse payloads, base64 image data, and internal IDs no longer fill each disclosure.
- AI-generated reports, interpretation and weighted scoring remain future backend analysis stages. The programmatic summary version is distinct from scoring versions; no API keys or model calls are introduced here.

### October 29, 2026 - integrate the remote Social Media components

- Fast-forwarded local main to origin/main `9229270`, preserving uncommitted backend and client work. The overlapping local page/router were backed up under ignored `reports/integration-backups/main-9229270/` before the pull.
- Adapted saved Facebook data to the remote SocialScoreHero, SocialHealthCard and SocialMediaReport/priority-column layout. Kept remote Settings, navigation and Website components. Unsupported scores/benchmarks/contact metrics remain unavailable; source post engagement and media views are not relabeled as reach or contacts.
- Connection management remains the explicit local backend OAuth workflow. Saved-report refresh is a separate read-only API action.
- Verified frontend lint/build and 14 offline Chrome scenarios, including native component layout, absent score/benchmark, evidence disclosure, failed/empty/retry states, mobile overflow and the remote Settings route. App/Settings/navigation/Website files match fetched origin/main exactly; no commit or push was made.

### October 29, 2026 - Facebook analysis and saved Social Media results

- Added deterministic, versioned Facebook analysis for populated profile fields, posting inactivity within the collected sample, phone inconsistencies and measured performance summaries. Recommendations reference saved evidence; unsupported data stays unavailable and scores remain undefined.
- Added `GET /api/businesses/:businessId/facebook-report` to read the newest usable Facebook archive with current derived analysis and separate newest-attempt metadata. Reads preserve immutable files and avoid provider calls; newer failures do not erase previous usable results.
- New report collections persist improved findings/recommendations with an analysis version. Existing reports gain derived display analysis without rewriting archives.
- Connected the Social Media page to saved results, with retry/empty/partial/failure states, evidence and read-only recommendations. The browser connection tool remains the entry point for live collection; main dashboard/website integration and customer authorization remain separate.
- Verified backend type-check, lint, build and 175 passing tests (one platform-dependent skip). Read the real saved Guzman report through the new HTTP endpoint: current analysis identified hours, username, posting inactivity and differing contact numbers without provider calls or archive changes.
- Frontend lint/build passed, along with 11 offline Chrome smoke scenarios covering partial/empty/error/retry states, zero versus unavailable values, failed-latest preservation, business mismatch rejection, inert provider text, mobile layout and read-only requests. See `../client/SOCIAL_MEDIA_INTEGRATION.md`.

### October 29, 2026 - browser-authorized Facebook reports

- Connected browser OAuth to registered business/Page selection and durable report creation. All five read permissions must be granted. Reports use the browser credential, not the optional `.env` test token.
- Added long-lived token exchange and debug-token app/type/validity/expiry validation. AES-256-GCM credentials persist across restarts using a separate local encryption key, with a 30-day browser/server connection limit, expiry checks, revocation handling, and disconnect deletion.
- Retained bounded collection, safe partial/failed archives, duplicate browser report prevention, shutdown cancellation and token-free response/report boundaries. Application authentication, business ownership, production hosting, scheduling and main frontend integration remain deferred.
- Controlled validation passed 161 tests (one skipped), type-check, lint and build. Basic live browser OAuth was verified previously; the extended exchange and populated browser report still require reconnecting through the user browser.

- Scoped the Facebook test page/connect CSP form-action allowlist to self plus https://www.facebook.com so browser form redirects can reach Meta. Other routes retain strict defaults. Added regression coverage for both CSP policies and the config-ID/callback redirect.

- Fixed the Facebook test page's referrer policy so same-origin browser form POSTs can pass the strict Origin check. Callback responses retain no-referrer; mismatched hostname/port errors identify the configured test URL. Type-check, lint and 12 provider tests passed.

### October 29, 2026 UTC - saved Facebook audit reports

- Added a bounded, validated Facebook collector and explicit local CLI with Page selection. Profile, recent post and insight evidence retain dates, missing/failed availability, coverage, and linked review recommendations; numeric scores remain unavailable.
- Reused immutable report storage and archived-result retrieval with additive Facebook scope/source/version and optional results.facebook. CLI-created audits do not change main dashboard state or enable HTTP Facebook audit creation.
- Customer ownership/authentication, browser onboarding, frontend mapping, cross-channel analysis, full-history collection and approved writes remain separate work.
- Verified type-check, lint, production build, and 143 passing tests (one platform-dependent test skipped). Live archive write/readback succeeded for failed attempts; Meta rejected the saved token with 190/463 on October 29. A fresh token is needed to verify a populated Facebook archive against live data.

### October 28, 2026 - local Facebook connection diagnostics

- Added a local-only OAuth connection test and sanitized permission/Page diagnostics, separate from audit scoring and main dashboard results. See [FACEBOOK_SETUP.md](FACEBOOK_SETUP.md) for configuration, browser flow, routes, and Meta dashboard actions.
- Browser-bound, single-use OAuth state and temporary in-memory sessions keep provider credentials on the backend. Restart/expiry discards the connection; disconnect forgets it locally rather than revoking Meta authorization.
- Test reads cover granted permissions, bounded authorized Page listing, and independent Page metadata/posts/insights probes. Granted optional write permissions do not execute or verify external writes.
- Live token checks verified all five requested read permissions through representative endpoints (47 probes, 42 accessible, five metric requests rejected with error 100). Browser consent remains pending. Production authentication, per-business ownership, durable credential storage, full analytics collection, and approved Page changes remain deferred.

### October 28, 2026 - durable per-run report archive

- Kept execution/runtime state in memory while adding automatic immutable JSON snapshots for completed, partial, and failed investigations. The startup demo seed is not archived as a new run.
- Added versioned `seo-spy.audit-report.v1` files under ignored `server/reports/audits/`, named with a Windows-safe UTC generation timestamp and audit UUID. Report IDs match audit IDs; snapshots include business/audit metadata, scope and version provenance, and available results. Credentials/configuration/raw HTML are excluded.
- Added bounded archive reads, atomic non-overwriting publication, same-audit idempotency, and safe storage errors. Successful terminal status is published after its report file exists; unavailable disk storage yields REPORT_WRITE_FAILED.
- Added date-sorted business report listing and report download endpoints, optional report metadata in audit summaries, and archived fallback for known per-audit reads after restart. Active jobs and the dashboard selection are not restored from files.
- Verified filesystem/HTTP tests covering distinct and concurrent writes, complete normalized data, failed/partial reports, file errors, and restart retrieval. The symlink escape case is skipped on Windows where privileged symlink creation is unavailable; it runs on other supported test platforms.
- Live homepage validation created `2026-10-29T01-44-18-740Z_7c9e9000-5c9e-42de-bc78-36080bdbefb8.json`. A separate backend process listed and downloaded that same report and recovered its completed audit/evidence. The run retained seven evidence records and one finding.
- Future AI evaluation should create separate derived results referencing the immutable report ID/schema version. No AI analysis, aggregate scoring, approval/execution integration, or external write actions were added.

### October 28, 2026 - validated Lighthouse and backend-lab checkpoint

- Added the isolated `/backend-lab` route with its own API types/service, polling hook, score/metric displays, evidence, recommendations, and explicit simulated/unavailable states. Existing Dashboard and Website pages remain mock-driven and unchanged by this integration work.
- Added same-origin API proxy support to normal Vite development/preview startup so the test route works without a special startup requirement. Dedicated lab commands remain compatible aliases.
- Verified the full backend check (105 tests, type-check, lint, build), client lint/build, and ten controlled browser scenarios including partial results, reload/unmount, duplicate prevention, and lost-submission-response recovery.
- Revalidated both real workflows through the browser: homepage-only completed in 10.9 seconds with one finding/seven evidence records and unavailable Lighthouse scores; mobile Lighthouse completed in 54.9 seconds with twenty findings/twenty-seven evidence records and category scores 38/85/96/92. These measurements describe individual runs only. Screenshots and summaries stay in ignored test artifacts.
- Added `../client/WEBSITE_API_MAPPING.md` to document supported fields, evidence references, category/null-score handling, and gaps in aggregate scores, pass counts, and page coverage. No main-page integration was performed.
- For the hackathon/demo, retain in-memory jobs and results. Database and durable-queue work is deferred beyond the demo scope; process restarts still clear history.

### October 28, 2026 - Google PageSpeed Insights Lighthouse capability

- User selected Google PageSpeed Insights rather than local Chrome. Added a fixed-endpoint provider adapter using native fetch, a server-only API-key header, no redirects, a bounded 20 MiB JSON response, a configurable 120-second default deadline, and one provider call at a time. No new npm dependencies or browser installation are needed.
- Added `scope: lighthouse` with mobile (default) or desktop strategy. Protected HTML collection still runs first. Provider failures preserve HTML findings as terminal `partial` results; shutdown aborts measurement. Existing demo/homepage behavior remains available.
- Added normalized performance, accessibility, best-practices, and SEO scores; actual engine version, device strategy, URLs, timestamp, lab metrics with units, check modes, and warnings. Unavailable values remain null. Failed measured checks generate namespaced evidence-linked review findings and recommendations. No field Core Web Vitals, accessibility compliance, or combined SEO Spy score is claimed.
- Added `GET /api/audits/:auditId/lighthouse`, nullable dashboard `lighthouse`, `running_lighthouse` stage, and `lighthouse-v1` audit marker. Updated Swagger request/response models. Original SEO Spy score arrays remain unavailable on real audits; clients should display the separate Lighthouse report and stop polling on partial completion.
- Added `npm run audit:lighthouse` with optional `-- --desktop`. Reports are stored in ignored `reports/` and keep Lighthouse data associated with the tested audit. API keys stay in ignored local environment configuration and are not included in reports.
- Verified `npm run check`: type-check, lint, 105 tests across four suites, and production build. Tests cover response validation, units/zero/null scores, request construction, bounded responses, provider failures/quotas, deadlines, concurrency, evidence references, mobile/desktop HTTP workflows, partial results, shutdown, and a blank API key in the tracked environment template without external calls.
- Live anonymous attempt reached Google but hit quota and correctly returned partial HTML results. A subsequent keyed mobile audit completed successfully: performance 35, accessibility 85, best practices 96, SEO 92; 20 findings/recommendations including the HTML image-alternative review. Saved local `reports/guzman-lighthouse-mobile.json`. These are one run's lab results, not stable score guarantees.

### October 28, 2026 - backend review fixes

- Added fallback across validated DNS addresses on connection failures, preserving pinned destinations and a shared 30-second deadline. Each connection/TLS-handshake attempt has a five-second timeout so a stalled address does not consume the entire collection budget. Policy, HTTP, content, certificate-validation, and cancellation failures are not retried.
- Fixed live smoke-test report assembly to include dashboard scores only when its completed audit ID matches the tested audit. Failed or unfinished audits report an empty score list instead of inheriting earlier demo scores.
- Added regression coverage for IPv6-to-IPv4 fallback, exhausted addresses, non-retryable failures, cancellation/deadline preservation, matching-audit scores, and stale/missing dashboard audit IDs.
- Verified `npm run check`: type-check, lint, 71 tests across three suites, and production build passed. API routes and response contracts are unchanged; frontend changes are not required for these fixes.

### October 28, 2026 ? real homepage backend

- Added `scope: homepage` to the existing creation endpoint; targets the registered business website rather than accepting arbitrary request URLs. Demo mode remains available.
- Added a protected Node HTTP/HTTPS collector: public IPv4/IPv6 and all DNS-answer validation, pinned lookup, actual remote-address checks, per-redirect validation, HTTPS downgrade rejection, five redirects, 30-second total deadline, 2 MiB HTML limit, 16 KiB header limit, and two concurrent collections. Cookies and credentials are not forwarded. Unsupported compression is rejected.
- Added Cheerio byte-buffer parsing with encoding detection and HTTP charset support. Evidence records final URL, timestamp, status, size, redirect chain, title, description, headings, canonical, robots directives, and image alt observations. Raw HTML is transient and is not exposed by the API.
- Added deterministic review findings and recommendations with evidence references. Empty alt text explicitly requires context. Homepage scores remain unavailable pending a documented scoring model (`homepage-v1` identifies this unscored check set).
- Wired live collection into the asynchronous runner, failure/shutdown handling, existing result endpoints, dashboard mode/notice, and OpenAPI contracts. Facebook remains unauthorized on live dashboards.
- Verified `npm run check`: type-check, lint, 60 tests, and production build. Added an explicit live HTTP smoke test via `npm run audit:homepage`; normal automated tests use controlled fixtures and make no external calls.
- Live Guzman audit completed: 301 to the HTTPS www homepage, HTTP 200, 245,059 bytes, seven evidence groups, one image-alternative review finding/recommendation. Eight images have empty alt text and zero lack the attribute. Saved `reports/guzman-homepage.json`.
- Frontend remains unchanged. Collection covers one returned HTML page only; robots.txt, sitemap, browser rendering, crawl coverage, scores, persistence, and external integrations remain deferred.

### October 27, 2026 — interactive API documentation

- Added `@nestjs/swagger` and Swagger UI at `/api/docs`, with OpenAPI JSON at `/api/docs-json`.
- Documented all six implemented endpoints, path parameters, demo audit request, successful responses, and relevant errors.
- Added explicit response DTOs with nested schemas, enums, nullable fields, and examples; controller return types check compatibility with service results.
- Kept documentation setup shared between runtime and HTTP tests. Disabled only the CSP HTTPS-upgrade directive so assets work over local HTTP; other Helmet protections remain enabled.
- Added HTTP coverage for the UI, JavaScript assets, endpoint inventory, and key request/response schemas. `npm run check` passed: type-check, lint, all 17 tests across two suites, and production build.
- New endpoints and contract changes must update Swagger annotations/DTOs alongside this plan.

### October 27, 2026 — milestone 1 complete

- Created the NestJS server with the Express adapter, feature modules, singleton in-memory repository providers, and explicit injection tokens.
- Added all six initial API routes below, including the seeded demo dashboard and asynchronous simulated audit lifecycle.
- Added environment validation, global DTO validation, consistent exception responses, generated request IDs, structured logs, Helmet headers, and localhost-only binding.
- Added duplicate audit protection, history preservation, evidence/finding/recommendation references, runner failure handling, and shutdown cleanup.
- Added [README.md](README.md) with setup, commands, API examples, and limitations.
- Verified `npm run check`: type-check, lint, 16 tests across two suites, and production build all passed.
- Started the compiled server and checked health, dashboard, audit creation, and completed audit status through actual localhost HTTP requests; stopped the smoke-test server afterward.
- Frontend source is unchanged and still uses its own mock data. PostgreSQL, crawling, credentials, and provider calls remain deferred.

Implementation decisions:

- Node.js 24, verified on the existing 24.11.1 runtime.
- NestJS 12 runtime and testing packages. Nest CLI 11 is deliberately retained because CLI 12's Angular dependencies require a newer Node patch version; build and startup were verified with this combination.
- Backend TypeScript 5.9, separate from the client's compiler. ES modules with `NodeNext` and `.js` relative imports for emitted JavaScript.
- Jest 30, ts-jest, Supertest, and `@nestjs/testing`. The test script uses Node's experimental VM-module flag for ESM dependencies; normal startup does not require it.
- Request DTOs use `class-validator`/`class-transformer`; environment configuration uses Zod. Pino is integrated through nestjs-pino.
- Audit creation currently requires `{ "scope": "demo" }`. Unknown fields and live scopes are rejected. One queued/running audit per business returns a conflict on duplicate submission.
- Each simulated stage defaults to one second. All data is memory-only and lost on restart. No real website, Facebook, AI, or external action occurs.
- Initial dashboard contracts expose domain summaries, scores, findings, and recommendations. Detailed website/social card view models will be addressed during client integration; illustrative score values are explicitly labeled as demo data.

## Objective

Build a Node.js and TypeScript backend using NestJS with its Express adapter for SEO Spy, an evidence-based website and social-media business audit application. SQLite is the selected durable database; the previous PostgreSQL direction is superseded.

The product workflow is:

```text
Evidence → Analysis → Recommendation → Approval → Action → Verification
```

Start with a local demonstration for one business, while keeping records scoped by business and audit. Guzman Tax Accounting is demonstration data, not a hard-coded product constraint.

## Current project

- `client/` contains React, TypeScript, Vite, Tailwind, and React Router.
- The dashboard has reusable cards and separate mock data.
- Other navigation destinations are currently placeholders.
- Run Investigation currently updates local demo state only.
- At the initial review there was no API, crawler, authentication, job runner, or database. Milestone 1 now provides the API and an in-process simulated runner; the other capabilities remain deferred.
- Dashboard types are presentation-oriented and need broader states before live integration.
- Frontend build and lint passed during the initial code review.

## Scope and boundaries

The backend owns input validation, evidence collection, audit orchestration, scoring, provider credentials, AI calls, authorization, approved external actions, and verification.

The frontend owns presentation and user interaction. It calls a service layer and must never contain private provider keys, Facebook tokens, or WordPress credentials.

Initial implementation excludes real Facebook connections, paid AI calls, external content changes, production deployment, and database setup. These are later milestones.

## Architecture

Use one backend application. Avoid microservices, a generic repository framework, or a separate queue infrastructure until there is a demonstrated need.

Decision: use NestJS for feature modules, controllers, services, and dependency injection. Its conventions give audits, integrations, and approval workflows a consistent structure as the application grows. Accept the additional module and decorator setup, but keep parsing, normalization, and scoring functions as plain TypeScript where framework integration adds no value.

```text
React client
    ↓ HTTP API
NestJS controllers and validation pipes (Express adapter)
    ↓
Business and audit services
    ├── Repositories → SQLite application database
    ├── Website collector → public website evidence
    ├── Deterministic checks and scoring
    └── Provider adapters → Facebook and AI later
```

- Keep controllers small; injectable services own application behavior and feature modules declare their dependencies.
- Define repository interfaces around actual operations, such as creating an audit or reading its findings.
- Preserve asynchronous repository interfaces so persistence changes do not alter service contracts.
- Register singleton SQLite repository implementations through explicit injection tokens. Memory repositories remain controlled fixtures only.
- Keep domain records separate from dashboard response formatting.
- Keep provider-specific response shapes behind adapters.
- Use Nest exception filters for the consistent API error envelope, pipes for request validation, and guards for authorization when accounts are introduced.
- Keep Nest application configuration reusable between `main.ts` and HTTP tests so validation, route prefixes, and error behavior match.

## Proposed directory structure

Create files as their milestone requires them; this is a target layout, not a requirement to scaffold empty modules.

```text
server/
  PLAN.md
  README.md
  package.json
  package-lock.json
  tsconfig.json
  nest-cli.json
  .env.example
  src/
    main.ts
    app.module.ts
    configure-app.ts
    config/
    contracts/
    common/
      filters/
      pipes/
    modules/
      businesses/
      audits/
        audits.module.ts
        audits.controller.ts
        audits.service.ts
        dto/
      findings/
      recommendations/
      connections/             # Later
      actions/                 # Later
      verification/            # Later
    persistence/
      persistence.module.ts    # Registers and exports repository providers
      repositories/            # Interfaces and injection tokens
      memory/
      sqlite/                  # Primary database, migrations and repositories
    integrations/
      website/
      providers/               # Later
    scoring/                   # Plain rules; injectable service if needed
    fixtures/
  tests/
    fixtures/
  # SQLite schema migrations currently live with the database implementation.
```

Keep `client/` and `server/` independently runnable at first. A root workspace or shared contracts package can be added when useful; the browser must not import backend implementation code.

Each feature directory follows the audits example as needed. Export services/providers explicitly through modules. Avoid circular module dependencies and broad global modules; do not generate controllers or services for trivial utility functions.

## Technology and third-party tools

Foundation tools are now installed in `server/package.json` with resolved versions in its lockfile. Tools for later milestones remain planned. Verify compatible stable versions and runtime requirements when adding them.

| Tool                                                                  | Purpose                                                                                | Timing / decision                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Node.js                                                               | Backend runtime and HTTP fetching                                                      | Select a supported LTS release compatible with dependencies                                                      |
| TypeScript                                                            | Strict application and contract typing                                                 | Foundation; compile and type-check with `tsc`                                                                    |
| NestJS (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`) | Feature modules, HTTP controllers, dependency injection, and lifecycle management      | Foundation; use the Express adapter and compatible Express version                                               |
| Nest CLI                                                              | Scaffold, watch, and build the TypeScript application                                  | Foundation; use local package scripts and compile for production                                                 |
| `@nestjs/swagger`                                                     | Interactive endpoint documentation and OpenAPI schemas                                 | Installed; `/api/docs` and `/api/docs-json`                                                                      |
| `@nestjs/config` + Zod                                                | Load and validate environment configuration; validate structured provider output later | Foundation; keep configuration validation explicit                                                               |
| `class-validator` + `class-transformer`                               | Validate request DTOs through Nest's global `ValidationPipe`                           | Foundation; reject unknown request fields and validate parameter/body types; avoid duplicate Zod request schemas |
| ESLint and typescript-eslint                                          | Static checks                                                                          | Foundation; align conventions with the client                                                                    |
| nestjs-pino / Pino                                                    | Structured application and request logs integrated with Nest                           | Proposed for foundation; redact credentials                                                                      |
| Helmet                                                                | Baseline HTTP response headers                                                         | Foundation; configure for an API                                                                                 |
| `@nestjs/testing` + Jest + Supertest                                  | Isolated provider tests and HTTP integration tests                                     | Foundation; override repository/provider dependencies and apply the same global app configuration as runtime     |
| Cheerio                                                               | Parse fetched HTML into structured evidence                                            | First website audit                                                                                              |
| SQLite                                                               | Durable records, relationships, audit history and suggestions                           | Selected and implemented; separate protected AI credit ledger retained                                           |
| Node 24 `node:sqlite`                                                  | Native prepared statements, transactions and schema migrations                         | Implemented; no PostgreSQL driver or ORM required                                                                 |
| Meta Graph API / Facebook Login                                       | Authorized Facebook Page identity and available audit data                             | Later; confirm permissions, app review, metric availability, and reporting windows                               |
| Meta-compatible model API                                             | Structured AI analysis and recommendations                                             | Later; confirm actual provider, model, hosting, pricing, and data handling before integration                    |
| Baseten                                                               | Possible model hosting/provider integration                                            | Candidate only; do not assume it is required                                                                     |
| Playwright or another browser collector                               | Render JavaScript-dependent pages                                                      | Optional later; not needed for the initial HTML-only collector                                                   |
| Google PageSpeed Insights v5                                          | Remote Lighthouse lab measurements, categories, metrics, and checks                    | Implemented through a fixed provider adapter; Google API key/quota applies                                       |
| WordPress API/integration                                             | Apply explicitly approved website changes                                              | Deferred; requires a defined authorization and verification design                                               |

No paid service is needed for the initial API or deterministic website audit. Do not spend Meta credits during foundation work.

Reference documentation:

- NestJS application setup: https://docs.nestjs.com/first-steps
- NestJS modules: https://docs.nestjs.com/modules
- NestJS custom providers: https://docs.nestjs.com/fundamentals/custom-providers
- NestJS validation: https://docs.nestjs.com/techniques/validation
- NestJS testing: https://docs.nestjs.com/fundamentals/testing
- Cheerio capabilities and limitations: https://cheerio.js.org/docs/intro/

## Domain records and contracts

Use generated identifiers and UTC timestamps from the start. IDs should not depend on display names or URLs.

| Record              | Core information                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Business            | ID, name, website URL, timestamps; ownership added before shared deployment                                |
| Connection          | Business ID, platform, identity, authorization/connection status, last checked time                        |
| Audit               | Business ID, requested scope, status, stage, timestamps, warnings, failure information, scoring version    |
| Evidence            | Audit ID, source URL/platform, collection time, check identifier, observed values and relevant excerpts    |
| Finding             | Audit ID, evidence references, check identifier, severity, source, title, explanation, review status       |
| Recommendation      | Audit ID, finding references, explanation, proposed change, purpose, review/action status                  |
| Score               | Audit ID, category, value or unavailable state, maximum, scoring version, contributing checks and coverage |
| Action, later       | Approved recommendation revision, actor, target, execution state and result                                |
| Verification, later | Action reference, before/after evidence, check result and timestamp                                        |

Contract rules:

- Separate severity (`critical`, `medium`, `low`) from check outcome (`passed`, `failed`, `skipped`, `error`) and verification state.
- Model connection states beyond connected: disconnected, authorization required, checking, and error as appropriate.
- Audit lifecycle: `queued`, `running`, `completed`, `partial`, `failed`.
- Keep recommendation review state separate from execution and verification state; approval alone must not imply a change was applied.
- Return raw numeric social metrics with units, reporting periods, and availability; the client formats values.
- Represent unmeasured scores and missing evidence explicitly. Missing Facebook data is not a zero score.
- Preserve original business details as evidence while comparing normalized phone numbers, URLs, names, and hours.
- Keep recommendations and findings attached to their original audit so repeat investigations preserve history.
- Use stable machine-readable status codes; map them to friendly labels in the client.

## Initial API

Paths are proposed contracts to finalize during the foundation milestone.

| Method | Route                                   | Purpose                                                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/health`                           | Basic process health                                                                       |
| GET    | `/api/businesses/:businessId/dashboard` | Business, connections, latest audit summary, scores, priority findings and recommendations |
| POST   | `/api/businesses/:businessId/audits`    | Validate scope and enqueue an audit; return `202` with audit ID and status URL             |
| GET    | `/api/audits/:auditId`                  | Lifecycle state, stage, timestamps, warnings and summary                                   |
| GET    | `/api/audits/:auditId/findings`         | Findings and evidence references for that audit                                            |
| GET    | `/api/audits/:auditId/recommendations`  | Recommendations for that audit                                                             |

Initially seed the demo business rather than implementing full business management. Add creation/settings endpoints when the corresponding UI is ready.

Use consistent errors, for example:

```json
{
  "error": {
    "code": "INVALID_WEBSITE_URL",
    "message": "Enter a valid public website address.",
    "requestId": "generated-request-id"
  }
}
```

- Validate parameters and bodies at the HTTP boundary.
- Return appropriate validation, not-found, conflict, and server errors.
- Do not expose stack traces, secrets, or raw provider responses.
- Add pagination when result lists can grow; avoid returning entire crawl payloads in the dashboard.
- Keep fixture-backed responses explicitly marked as demo data.
- Prevent repeated clicks from spawning unbounded duplicate audits; define one-active-audit behavior per business and scope initially.

## Audit execution and evidence

Start with a bounded in-process runner managed as a Nest provider and client polling. Do not hold an HTTP request open for a complete investigation. Handle runner errors explicitly and stop accepting work/clean up active resources during application shutdown. NestJS alone does not provide job durability; do not add Redis or BullMQ for the initial simulation.

Proposed stages:

1. Validate audit scope and target.
2. Collect website evidence.
3. Evaluate deterministic checks.
4. Calculate supported scores.
5. Produce rule-based recommendations.
6. Complete the audit with coverage information and warnings.

Facebook collection, cross-channel comparison, and AI analysis are later stages. A provider failure should preserve usable results and yield partial completion where appropriate.

Records now persist in SQLite across restarts. Execution remains in-process; interrupted queued/running records require explicit operator reconciliation and never automatically replay external work. Shared deployment still needs application identity and deliberate worker coordination.

### First website checks

Begin with one homepage and record the actual page URL and collection timestamp:

- Title presence and content.
- Meta description presence and content.
- Heading structure, including H1 observations.
- Images missing appropriate alt attributes; account for intentionally decorative images.
- Canonical URL presence and value.
- Page-level robots directives.

Next expand to a bounded same-site crawl, robots.txt, sitemap discovery, internal links, and structured data. Record coverage and distinguish unsupported or failed checks from passing checks.

HTML collection does not execute page JavaScript or measure real browser performance. Do not populate performance, accessibility, social, or combined scores with fabricated values.

### Collector controls

- Accept only supported public HTTP/HTTPS destinations; reject URL credentials and unsupported ports initially.
- Block loopback, private, link-local, metadata-service, and other non-public addresses for IPv4 and IPv6.
- Validate DNS results and the actual connection destination; prevent DNS rebinding from bypassing checks.
- Revalidate every redirect and discovered crawl target.
- Enforce timeouts, redirect counts, content types, response-size limits, page counts, and concurrency limits.
- Respect crawl policy and avoid aggressive request rates.
- Treat fetched content as untrusted data. Render excerpts as text; do not inject scraped HTML into the client.

## Scoring and recommendations

- Define deterministic, documented scoring rules before displaying live scores.
- Version the rules and retain contributing check results.
- Define how skipped, failed-to-fetch, and unsupported checks affect coverage and score availability.
- Derive issue counts, check totals, and priority opportunities from the audit's records.
- Keep overall score unavailable until its required components and weighting policy are defined.
- Start with rule-based recommendations. AI may explain and prioritize measured evidence later, but must not invent observations or silently alter scores.

## Frontend integration

- Add `client/src/services/api.ts` as the HTTP boundary and a dashboard data hook.
- Replace direct fixture imports in `Dashboard.tsx` with service results while preserving card props where practical.
- Normalize API responses into UI view models when needed.
- Add loading, empty, error, retry, partial-result, disconnected, and unavailable-score states.
- Replace the demo Run Investigation handler with audit creation and polling; prevent duplicate submissions and stop polling on completion or unmount.
- Keep existing results visible while a new audit runs, clearly identifying their audit timestamp.
- Remove hard-coded mock wording only for live results; retain explicit labels for demo responses.
- Configure a Vite development API proxy or an explicit allowed client origin; public frontend configuration must contain no secrets.

## SQLite persistence

Implemented after the API and first website audits stabilized. SQLite replaces the old PostgreSQL plan; see [DATABASE.md](DATABASE.md) for the actual schema, additive import, backup and recovery behavior.

- Design migrations for businesses, connections, audits, evidence, findings, recommendations, and score snapshots.
- Add foreign keys, status constraints, timestamps, and indexes for business/audit lookups.
- Keep relationships and searchable fields relational; use JSON only where evidence or provider payload structure warrants it.
- Preserve API IDs and response contracts when replacing memory repositories.
- Use transactions where related state must change atomically.
- Define restart recovery for queued/running audits, retention of collected evidence, and migration/seed commands.
- Add repository integration tests against an isolated test database.
- Add ownership/user records with authentication before exposing multiple businesses to real users.
- Keep SQLite on local server storage, with prepared statements, short transactions and consistent backups. Reassess distributed/high-write deployment only if the application needs it.

## Authentication, integrations, and external changes

Local fixture development can begin without authentication and must not be exposed as a public service. Authentication and per-business authorization precede shared deployment or real account connections.

Facebook integration belongs on the backend: OAuth state validation, token exchange, secure token storage, expiry/revocation handling, and Page selection. Never request a Facebook password. Confirm available permissions and metrics before promising them in the UI.

Keep AI behind a provider adapter. Validate structured output, set time/cost limits, and treat website content as evidence rather than instructions. Confirm what business data may be sent to the provider.

External actions require approval of a concrete recommendation revision. Record the approving actor and target, prevent duplicate execution, and verify the result using new evidence. Rejection or editing must not accidentally execute an older approved revision.

## Milestones and acceptance criteria

### 1. Foundation and fixture API

Status: complete. See the progress record for implementation decisions and verification.

- Scaffold the NestJS server package with the Express adapter, strict TypeScript, development/build/start/check scripts, and documented setup.
- Add feature modules, configuration validation, global request validation, an exception filter, request logging, and health endpoint.
- Define initial contracts, injection tokens, singleton memory repository providers, and a seeded demo business.
- Serve the demo dashboard and an explicitly simulated audit lifecycle over HTTP.
- Use `@nestjs/testing`, Jest, and Supertest for meaningful API tests covering successful responses, validation, unknown resources, and lifecycle transitions.

Done when the server starts locally, checks pass, and the demo dashboard response is available without a database or external credentials.

### 2. Client integration

- Add the client service layer and dashboard hook.
- Load the existing dashboard through the backend.
- Wire Run Investigation to creation and polling.
- Handle loading, errors, partial/empty states, and duplicate clicks.

Done when the demo workflow works end to end over HTTP and remains clearly labeled as simulated.

### 3. Real homepage audit

Status: collector, parser, deterministic checks, recommendations, and live API workflow implemented. Scores deliberately remain unavailable until scoring rules are agreed.

- Implement the protected HTTP collector and HTML parser.
- Add deterministic checks with evidence and supported scores.
- Generate rule-based recommendations and derive summary counts.
- Test collector restrictions, redirects, limits, check outcomes, scoring, and failure handling using controlled fixtures.

Done when a real public homepage yields repeatable evidence-backed results without AI calls or external writes.

### 4. Crawl coverage and reliability

- Add bounded same-site collection, robots/sitemap handling, and additional checks.
- Improve partial completion, concurrency controls, and audit coverage reporting.
- Document the limits of HTML-only analysis.

Done when multi-page audits remain bounded and accurately report unavailable or failed checks.

### 5. SQLite persistence and explicit interrupted-job recovery

- [x] Use Node SQLite with transactional schema migrations.
- [x] Replace production memory repositories while preserving contracts and archived history.
- [x] Persist reports, statuses, timestamps, findings and suggestions across restarts.
- [x] Provide explicit interrupted-run reconciliation and offline persistence tests; no automatic provider replay.

Done when audits and evidence survive restarts and interrupted work has a defined recovery path.

### 6. Authorized Facebook and AI analysis

- Add authentication/authorization, OAuth, secure credentials, provider adapters, and validated structured AI results.
- Implement cross-channel comparison using normalized evidence.
- Confirm permissions, metrics, data handling, and cost limits before live use.

Done when authorized data produces traceable results and missing access is handled explicitly.

### 7. Approved actions and verification

- Add concrete proposal review, approval/edit/rejection, execution records, and verification.
- Begin with one narrowly scoped integration and action type.

Done when an explicitly approved change can be applied once and verified with before/after evidence.

## Verification strategy

- Run TypeScript, lint, and build checks for changed applications.
- Test API contracts and lifecycle behavior at the HTTP boundary.
- Test checks and scoring against fixed HTML/evidence fixtures.
- Test URL restrictions and redirects without relying on production websites.
- Exercise timeouts, partial results, unavailable data, and provider failures.
- Add database tests with persistence, and authorization tests with accounts.
- Keep external network and paid-provider tests explicit and separate from normal checks.
- Document actual results; do not report checks as passed unless run.

## Open decisions

- Supported Node LTS version and exact dependency versions.
- Final request/response schemas and shared contract distribution.
- Homepage-only limits and later crawl budgets.
- Score weights, coverage thresholds, and overall-score prerequisites.
- Database library and durable job execution approach.
- Authentication provider and single-user versus team ownership model.
- Meta app permissions and available Page metrics.
- Actual AI model/provider and whether Baseten is needed.
- Hosting, evidence retention, and the first supported external action.

Resolve these at their relevant milestone rather than blocking the first API on all future integrations.

## Immediate next task

Coordinate the first main-page integration with the frontend engineer using `../client/WEBSITE_API_MAPPING.md`. Agree on nullable and overall score presentation, passed-check semantics, and homepage-only coverage before adapting the Website page. Reuse the proven backend-lab service/polling behavior in a separately scoped change. Keep the existing main pages unchanged until that integration is authorized; retain in-memory execution for the hackathon demo.
