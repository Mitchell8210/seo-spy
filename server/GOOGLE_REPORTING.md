# Google Analytics 4 and Search Console reporting

This read-only backend integration retrieves existing Google measurements with a server-held service account. It is independent of WordPress/Site Kit authorization and PageSpeed Insights. It does not change tracking, edit websites, calculate SEO Spy scores or call Meta/Muse. Customer Google OAuth and frontend integration remain separate work.

## Server configuration

Keep configuration in ignored `server/.env` and private service-account JSON in ignored `server/secrets/`. `GOOGLE_APPLICATION_CREDENTIALS` is a path relative to `server/`, never a frontend variable. Do not commit the JSON or copy keys into browser configuration/logs/reports.

| Variable | Purpose/default |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service-account JSON path, required for live reads |
| `GA4_PROPERTY_ID` | Numeric Analytics property ID, not a measurement ID |
| `GSC_SITE_URL` | Exact authorized URL-prefix property, including trailing slash, or `sc-domain:example.com` |
| `GOOGLE_BUSINESS_ID` | Registered business binding; falls back to `WORDPRESS_BUSINESS_ID` |
| `GOOGLE_OPERATOR_KEY` | Local operator Bearer key, at least 32 characters; falls back to `WORDPRESS_OPERATOR_KEY` |
| `GOOGLE_FRONTEND_ORIGIN` | Allowed browser Origin; default `http://localhost:5173` |
| `GOOGLE_TIMEOUT_MS` | Per-request deadline: default 15000, range 1000–30000 |
| `GOOGLE_CACHE_TTL_SECONDS` | Success/empty cache lifetime: default 900, range 30–3600 |
| `GOOGLE_ERROR_CACHE_TTL_SECONDS` | Failed-request cache lifetime: default 60, range 30–300 |

Enable the Google Analytics Data API and Google Search Console API in the service account's Cloud project. Grant its email read access to the GA4 property (Viewer) and intended Search Console property. Cloud-project membership alone does not grant property access. Tokens request only `analytics.readonly` and `webmasters.readonly` scopes.

The bound business must already exist; requests for another business are rejected. When Search Console is configured, its normalized hostname must match the business website. This check does not prove GA4 property ownership; select that property deliberately.

## Local operator endpoints

Supply `Authorization: Bearer <local-operator-key>` from a trusted local operator client. The guard requires a localhost/loopback Host and, if supplied, the configured Origin. This development guard is separate from customer sign-in/ownership. Do not expose these routes as a multi-user service or ship the operator key in the frontend. HTTP responses use `Cache-Control: no-store`; backend SQLite caching is separate.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/businesses/:businessId/google/ga4` | Both 7/30-day sessions, active users and page views; one GA4 batch on a cache miss |
| GET | `/api/businesses/:businessId/google/search-console?days=30&view=summary` | Site-wide clicks, impressions, CTR and average position |
| GET | `/api/businesses/:businessId/google/search-console?days=30&view=queries` | At most 10 top queries, each with clicks, impressions, CTR and average position |

Search Console accepts only `days=7` or `30` (default 30) and `view=summary` or `queries` (default summary). Each view/window has its own request/cache entry; requesting one does not fetch the other automatically.

The `seo-spy.google-reporting.v1` envelope contains business/provider identity, `authentication: service_account`, configured `asset`, `availability`, nullable `data`, `fetchedAt`, `lastAttemptAt`, nullable sanitized `error`, `cache: {hit,stale,expiresAt}` and `limitations`. Data schemas are `seo-spy.google-ga4.v1` and `seo-spy.google-search-console.v1`. Credentials/tokens are never returned.

GA4 uses independent, dimensionless `7daysAgo`/`30daysAgo` through `yesterday` totals. Active users are measured over each whole range, never summed from daily counts. Overlapping windows must not be added. `pageViews` maps to `screenPageViews`, including app screen views when present; it is not people reached. Property timezone, resolved dates when available, sampling and thresholding caveats remain explicit.

Search Console requests finalized web-search data through yesterday in `America/Los_Angeles`. Recent dates can lag or be omitted; a requested date is not proof of complete data. CTR is a 0–1 ratio and average position an aggregate. Top queries are a bounded, privacy-filtered sample in Google's click order. That view returns `summary: null`: never sum query rows into site totals. The separate dimensionless summary query provides site totals with an empty `topQueries` list.

## Failures and caching

`availability: empty` means a successful no-row response. Empty count metrics can be zero; undefined empty Search Console CTR/position remain null. `unavailable` means a current usable request was not established. Sanitized codes distinguish missing setup/access, disabled APIs, authorization failures, quotas, timeouts and invalid responses. Failures never invent zero traffic. Raw Google errors, account identifiers, keys, tokens and local paths are excluded.

The primary SQLite `google_reporting_cache` table stores validated, SHA256-checked JSON up to 1 MiB. Keys include business, provider, configured asset, query/window and authorization fingerprint; credential identity changes select a different cache key. Fresh hits make no reporting request; concurrent identical requests share an in-process operation. Access tokens are cached in memory only, separately from report data.

Failures are cached briefly. A failed refresh retains earlier data with its original collection date and `cache.stale: true`; this does not prove current authorization. Expired entries remain available for fallback. Unavailable/corrupt cache storage fails closed. There are no automatic refreshes, startup calls, background polling, provider retries or deletion jobs. A later explicit read after expiry can contact Google again; diagnose errors before another live validation call.

The transport allows only fixed Google reporting/token methods, disables redirects, bounds payload sizes and limits concurrent operations. Google features import no AI service. Existing mock-first Meta approval/budget rules and the independent spending ledger remain unchanged.

## Architecture and validation

`src/integrations/google/` contains transport, service-account authentication, reporting client and runtime schemas. `GOOGLE_TOKEN_PROVIDER` injects `GoogleTokenProvider` (`getAccessToken`, `authorizationCacheKey`) so later customer OAuth can replace authentication without changing metric parsing. Shared customer access still requires authenticated ownership, encrypted scoped tokens, consent/revocation and per-business asset selection.

`src/modules/google/` owns HTTP contracts, local guard, business binding and cache orchestration. Offline suites (`google-auth`, `google-transport`, `google-reporting`, `google-cache`, and `google-api`) use fixtures and isolated SQLite; normal tests read no real keys and contact neither Google nor Meta.

Live validation succeeded on October 31, 2026 Pacific time (receipt `2026-11-01T05:51:37.135Z`). Exactly one GA4 batch returned both windows: October 24–30 had 43 sessions, 33 active users and 53 page views; October 1–30 had 143 sessions, 118 active users and 187 page views. One Search Console query request for October 1–30 returned 10 query rows with clicks, impressions, CTR and average position. These query metrics are not site totals. The separate live site-summary request was deliberately outside the two-report-call scope; summary parsing/endpoint behavior is fixture-tested.

Both subsequent HTTP reads hit SQLite cache without additional Google calls. The shared service-account token exchange ran once. Meta calls were zero and the protected AI spending ledger was byte-unchanged. The ignored, credential-free receipt is `reports/google/connectivity-verification.json`.

The explicit harness is `npm run build` followed by `node scripts/verify-google-reporting.mjs --confirmed` from `server/`. It requires prior administrator authorization, forces AI mocks/writes off, caps each Google upstream method at one attempt and writes an exclusive reservation file before dispatch. A reserved run cannot silently rerun. Inspect existing results and identify failures before separately authorizing any later connectivity check; normal development uses fixtures. It does not clear caches or reset budgets.
