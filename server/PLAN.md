# SEO Spy backend plan

Status: foundation, homepage checks, Lighthouse integration, and isolated backend-lab workflow implemented and verified. Integration into the main frontend pages remains a separate task.
Created: October 27, 2026.
Last updated: October 28, 2026.

## Progress record

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

Build a Node.js and TypeScript backend using NestJS with its Express adapter for SEO Spy, an evidence-based website and social-media business audit application. Add PostgreSQL after the initial API and website audit work end to end.

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
    ├── Repositories → in-memory storage initially → PostgreSQL later
    ├── Website collector → public website evidence
    ├── Deterministic checks and scoring
    └── Provider adapters → Facebook and AI later
```

- Keep controllers small; injectable services own application behavior and feature modules declare their dependencies.
- Define repository interfaces around actual operations, such as creating an audit or reading its findings.
- Use asynchronous repository interfaces from the start so PostgreSQL can replace memory storage without changing service callers.
- Register repository implementations through explicit injection tokens: TypeScript interfaces do not exist at runtime. Use singleton memory repositories shared across requests and swap providers for PostgreSQL later.
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
      postgres/                # Later
    integrations/
      website/
      providers/               # Later
    scoring/                   # Plain rules; injectable service if needed
    fixtures/
  tests/
    fixtures/
  migrations/                  # Added with PostgreSQL
```

Keep `client/` and `server/` independently runnable at first. A root workspace or shared contracts package can be added when useful; the browser must not import backend implementation code.

Each feature directory follows the audits example as needed. Export services/providers explicitly through modules. Avoid circular module dependencies and broad global modules; do not generate controllers or services for trivial utility functions.

## Technology and third-party tools

Foundation tools are now installed in `server/package.json` with resolved versions in its lockfile. Tools for later milestones remain planned. Verify compatible stable versions and runtime requirements when adding them.

| Tool | Purpose | Timing / decision |
| --- | --- | --- |
| Node.js | Backend runtime and HTTP fetching | Select a supported LTS release compatible with dependencies |
| TypeScript | Strict application and contract typing | Foundation; compile and type-check with `tsc` |
| NestJS (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`) | Feature modules, HTTP controllers, dependency injection, and lifecycle management | Foundation; use the Express adapter and compatible Express version |
| Nest CLI | Scaffold, watch, and build the TypeScript application | Foundation; use local package scripts and compile for production |
| `@nestjs/swagger` | Interactive endpoint documentation and OpenAPI schemas | Installed; `/api/docs` and `/api/docs-json` |
| `@nestjs/config` + Zod | Load and validate environment configuration; validate structured provider output later | Foundation; keep configuration validation explicit |
| `class-validator` + `class-transformer` | Validate request DTOs through Nest's global `ValidationPipe` | Foundation; reject unknown request fields and validate parameter/body types; avoid duplicate Zod request schemas |
| ESLint and typescript-eslint | Static checks | Foundation; align conventions with the client |
| nestjs-pino / Pino | Structured application and request logs integrated with Nest | Proposed for foundation; redact credentials |
| Helmet | Baseline HTTP response headers | Foundation; configure for an API |
| `@nestjs/testing` + Jest + Supertest | Isolated provider tests and HTTP integration tests | Foundation; override repository/provider dependencies and apply the same global app configuration as runtime |
| Cheerio | Parse fetched HTML into structured evidence | First website audit |
| PostgreSQL | Durable records, relationships, and audit history | Persistence milestone |
| PostgreSQL driver/query builder or ORM | Database access and migrations | Choose with persistence; evaluate `pg`, Drizzle, or Prisma and select one approach |
| Meta Graph API / Facebook Login | Authorized Facebook Page identity and available audit data | Later; confirm permissions, app review, metric availability, and reporting windows |
| Meta-compatible model API | Structured AI analysis and recommendations | Later; confirm actual provider, model, hosting, pricing, and data handling before integration |
| Baseten | Possible model hosting/provider integration | Candidate only; do not assume it is required |
| Playwright or another browser collector | Render JavaScript-dependent pages | Optional later; not needed for the initial HTML-only collector |
| Google PageSpeed Insights v5 | Remote Lighthouse lab measurements, categories, metrics, and checks | Implemented through a fixed provider adapter; Google API key/quota applies |
| WordPress API/integration | Apply explicitly approved website changes | Deferred; requires a defined authorization and verification design |

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

| Record | Core information |
| --- | --- |
| Business | ID, name, website URL, timestamps; ownership added before shared deployment |
| Connection | Business ID, platform, identity, authorization/connection status, last checked time |
| Audit | Business ID, requested scope, status, stage, timestamps, warnings, failure information, scoring version |
| Evidence | Audit ID, source URL/platform, collection time, check identifier, observed values and relevant excerpts |
| Finding | Audit ID, evidence references, check identifier, severity, source, title, explanation, review status |
| Recommendation | Audit ID, finding references, explanation, proposed change, purpose, review/action status |
| Score | Audit ID, category, value or unavailable state, maximum, scoring version, contributing checks and coverage |
| Action, later | Approved recommendation revision, actor, target, execution state and result |
| Verification, later | Action reference, before/after evidence, check result and timestamp |

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

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Basic process health |
| GET | `/api/businesses/:businessId/dashboard` | Business, connections, latest audit summary, scores, priority findings and recommendations |
| POST | `/api/businesses/:businessId/audits` | Validate scope and enqueue an audit; return `202` with audit ID and status URL |
| GET | `/api/audits/:auditId` | Lifecycle state, stage, timestamps, warnings and summary |
| GET | `/api/audits/:auditId/findings` | Findings and evidence references for that audit |
| GET | `/api/audits/:auditId/recommendations` | Recommendations for that audit |

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

In-memory records and in-process jobs are local-development conveniences: restarting the server loses them. Document this behavior. Durable execution/recovery is required when PostgreSQL and shared deployment are introduced.

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

## PostgreSQL preparation

Add the database after the API and first real website audit are stable.

- Design migrations for businesses, connections, audits, evidence, findings, recommendations, and score snapshots.
- Add foreign keys, status constraints, timestamps, and indexes for business/audit lookups.
- Keep relationships and searchable fields relational; use JSON only where evidence or provider payload structure warrants it.
- Preserve API IDs and response contracts when replacing memory repositories.
- Use transactions where related state must change atomically.
- Define restart recovery for queued/running audits, retention of collected evidence, and migration/seed commands.
- Add repository integration tests against an isolated test database.
- Add ownership/user records with authentication before exposing multiple businesses to real users.
- Choose deployment, backups, and connection pooling when the deployment environment is known.

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

### 5. PostgreSQL and durable execution

- Select database access tooling and add migrations.
- Replace memory repositories and preserve contracts.
- Implement restart recovery and test persistent history.

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
