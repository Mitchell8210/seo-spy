# Google Analytics 4 and Search Console reporting

## Analysis & Revenue page

The Analysis page reads `GET /api/businesses/:businessId/analytics`, a separately scoped local-application endpoint. Its `GoogleAnalysisReadGuard` requires a loopback peer, the exact configured frontend/backend Host, an allowed Origin when supplied, no cross-site Fetch Metadata and no forwarding headers. A configured local operator connection and the existing business/property/site binding are required. It never sends operator keys or Google credentials to the browser. Existing `/google/*` routes retain `GoogleOperatorGuard` and require Bearer authorization. This local boundary is not customer authentication or public deployment authorization.

A cache miss makes one GA4 `batchRunReports` call containing five traffic reports. When a lead policy is configured, a second batch contains the independent period/daily lead reports. All traffic is filtered to the registered website hostname/www alias and `30daysAgo` through `yesterday` in the property timezone. Lead queries use the same resolved dates plus the exact configured event and lead-page allowlist:

| Existing page field | GA4 source |
| --- | --- |
| Users / calculator Monthly Visitors | Dimensionless whole-period `totalUsers` |
| Sessions | Dimensionless whole-period `sessions` |
| Conversions | `eventCount` filtered to the configured inquiry submission event and lead pages |
| Conversion Rate | Distinct `totalUsers` meeting that filter / whole-period website `totalUsers` × 100 |
| Traffic Over Time | `date` with `totalUsers`, `sessions`, and separately joined filtered submission counts |
| Traffic by Channel | `sessionDefaultChannelGroup` with `sessions`; original channel names retained |
| Users by Device | `deviceCategory` with `totalUsers` |
| Top Pages | Five `pagePath` rows ordered by `totalUsers` descending |

Users can occur on multiple days, devices and pages; those rows cannot be added to produce period unique users. Missing dates are not filled with invented zeroes. Source timestamps, actual dates, property timezone and Google sampling/thresholding/restriction caveats are retained. The user approved updating existing demo/source captions; layout, fields, controls and styling are preserved.

The v2 report replaces the original all-key-event conversion mapping. `GA4_LEAD_EVENT_NAME` selects one reviewed submission event. `GA4_LEAD_PAGE_PATHS` is a comma-separated exact path allowlist and is required for generic `form_submit`. A single event avoids double-counting a form_submit and a generated lead for the same action. Page views, session starts, scrolls, form starts and contact-link clicks cannot be selected as lead events. No GA4/site tracking configuration is modified. Missing configuration, restricted data and failed queries leave conversion values null while preserving all real traffic. A successful empty inquiry query returns **0 recorded conversions and 0%**, as requested; it is not labeled unavailable. The API retains tracking-coverage caveats; the user-approved source caption is limited to Google Analytics, the website hostname and Past 30 days. GA4's headerless dimensionless no-data responses are accepted only when there are no rows and request-column identities are known.

The calculator uses measured period users. Its existing editable 2% customer conversion rate and $150 customer value remain assumptions for estimated revenue and hypothetical +10/+20% traffic scenarios. No measured revenue or customer value is invented, and lead submissions do not establish paying customers.

The separate checksummed SQLite cache key includes business, property, website, credential identity and the conversion policy. v2 never reuses the earlier inflated key-event totals. Successes/empty reports use the success TTL; failures, including partial lead-query failures, use the error TTL. Concurrent reads share pending work. Failed refreshes retain history internally as stale, while the page uses existing unavailable treatments for failures. Corrupt storage fails closed. There is no polling, automatic retry, startup collection, AI call or website write.

Offline checks: `tests/google-analysis.spec.ts` covers contracts, filters, independent totals/rates, malformed data, local restrictions, caching and failures; frontend `scripts/analysis-mapping.test.mjs` covers mapping. `node scripts/backend-lab-smoke.mjs --analysis` uses offline fixtures for calculator behavior, zero write requests and four responsive widths.

`node scripts/verify-analysis.mjs --confirmed --lead-submissions` validates the API/cache with at most two Google batches, AI disabled and the protected ledger hashed before/after. It reserves ignored receipts and never silently repeats. The original November 2 validation returned 96 users, 122 sessions, 503 key events and a 100% key-event rate. The follow-up investigation found page_view/session_start/scroll were counted as key events and all four 30-day form_submit events belonged to /login/. Those were excluded from the corrected metric. The successful inquiry-only report has no recorded submissions and uses zero, not unavailable.

The user separately requested a full-year check. `node scripts/inspect-analysis-conversions.mjs --confirmed --year` made one read-only batch for November 2, 2025–November 1, 2026 and returned all 403 rows without truncation: 73 form_submit events on /login/, five on /password-reset/, and no inquiry-page form_submit events. Two gracias_view events on /schedule-a-free-consultation/gracias/ are potential confirmation signals, but their trigger must be verified before treating them as submissions. This historical investigation does not change the page's 30-day reporting period. Scripts read no form contents and never submit a test form. Raw provider responses, credentials and receipts remain ignored.

Metric definitions: [Google Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema); [five-report batch contract](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/batchRunReports).

## Facebook-attributed website visits on Social Media

The user approved replacing the existing Website Clicks row label with **Website Visits**. Its value is GA4 `sessions`, filtered by `sessionSource` with the declared case-insensitive full-match pattern `^(facebook|fb|([a-z0-9-]+\.)*facebook\.com)$` and the registered business website's exact hostName/www alias. It includes matching paid/organic traffic, cannot prove a click from the selected Facebook Page, is not unique people and cannot include visits that Analytics did not record. `firstUserSource`, all-social totals and substring matches are not substitutes.

The explicit browser-authorized Facebook Run Report process also invokes optional Google website-visit collection after Facebook evidence is collected. The Google business/property binding and existing server-held service account are reused; credentials/operator keys are never sent to frontend code. Google failures cannot erase usable Facebook results. Collection makes at most one sessions-only GA4 batch on a cold/expired scoped cache, no automatic retries. Current cache TTL/error TTL settings apply; the key includes business/property/hostname/exact dates/filter-policy version/auth identity. Original Facebook archives and scoring snapshots remain immutable.

`GET /api/businesses/:businessId/google/facebook-visits?since=UTC_ISO&until=UTC_ISO` is a local-operator-guarded explicit read/collection endpoint. It accepts only canonical UTC timestamps spanning exactly 30 completed Pacific reporting days, and requests corresponding inclusive GA4 calendar dates. A compatible GA4 property timezone is required before publishing a numeric value. The low-level schema is `seo-spy.google-ga4-facebook-visits.v1`, preserving property/date/filter provenance and sampling/privacy/data-loss caveats. Successful empty responses can establish zero; failed, incompatible, corrupt or missing sources never do.

Saved Social Media responses add a separate top-level `websiteVisits` read model scoped to business, metric, attribution, period and collection time. It reads application SQLite cache only (including dated historical results after TTL expiry), with no Google/token-exchange/Meta calls. A failed refresh retains old source data but does not present it as a successful numeric result. Missing or mismatched evidence uses the existing unavailable field treatment. No new visible card/field/control was added, and People Who Contacted You is not computed from session counts.

Live validation on November 1 (`2026-11-01T17:55:14.753Z`) returned **3** Facebook-attributed Guzman website sessions for October 2–31 Pacific. The property timezone matched America/Los_Angeles, subsequent saved reads matched the collection result, and the protected AI ledger hashes were unchanged. No Facebook/model request or website write was needed. `node scripts/verify-facebook-website-visits.mjs --confirmed` explicitly validates the latest saved Facebook window through the running local operator endpoint, reserves one report-window run in ignored receipts and never silently repeats it. Source credentials, databases and receipts remain ignored. Existing Google totals/Search Console endpoints are unchanged.

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
