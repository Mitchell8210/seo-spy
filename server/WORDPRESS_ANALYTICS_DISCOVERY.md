# WordPress analytics availability

Checked October 31, 2026 UTC against the registered `demo-guzman` installation at `https://guzmantaxaccounting.com`. Used existing server-only application-password credentials and the protected Node WordPress client. All requests were GET; no tracking configuration, Google connection, content, audit, sync or import was changed. Writes remained disabled. No frontend or API contract changes were made.

## Confirmed sources

Active plugins include **Site Kit by Google 1.190.0** and **Rank Math SEO Free 1.0.277.2**. The filtered plugin/route discovery did not identify an independent page-view/statistics plugin such as Jetpack, WP Statistics, Matomo, MonsterInsights or Independent Analytics. This is bounded discovery, not proof that no external analytics service or custom tracking exists.

Site Kit reports setup complete and connected administrators present. Its Analytics 4 and Search Console modules are both active and connected, with configured property IDs. Google Ads is inactive/disconnected; AdSense and Tag Manager are active but disconnected. Configuration values, account IDs and owner identities were not copied into diagnostic reports.

## Actual access tests

All paths below are relative to `/wp-json`:

| GET | Outcome |
| --- | --- |
| `/` | 200; advertised routes/namespaces discovered |
| `/wp/v2/plugins?context=edit` | 200; relevant plugin identifiers/versions discovered |
| `/wp-abilities/v1/abilities?per_page=100&page=1` | 200; ability definitions read, none executed |
| `/google-site-kit/v1/core/site/data/connection` | 200; `connected: true`, `setupCompleted: true` |
| `/google-site-kit/v1/core/modules/data/list` | 200; Analytics 4 and Search Console active/connected |
| `/google-site-kit/v1/modules/analytics-4/data/settings` | 200; account/property/stream/measurement IDs configured, snippet enabled |
| `/google-site-kit/v1/modules/search-console/data/settings` | 200; property configured |
| `/google-site-kit/v1/core/user/data/authentication` | 200; current user's Google `authenticated: false`, `grantedScopes: []` |
| `/google-site-kit/v1/modules/analytics-4/data/report` | 403 `missing_required_scopes` |
| `/google-site-kit/v1/modules/search-console/data/searchanalytics` | 403 `missing_required_scopes` |
| `/rankmath/v1/an/dashboard` | 200; no usable measured search-performance totals; analytics series empty and merged graph has zero-filled entries |
| `/rankmath/v1/an/analyticsSummary` | 200; `ctr`, `posts`, `clicks`, `pageviews`, `impressions` all explicitly `n/a` |
| `/rankmath/v1/an/postsSummary` | 200; returned non-numeric summary values; not treated as measured traffic |

Requested Site Kit report dates: **2026-10-03 through 2026-10-30**, inclusive. GA4 query used metrics `totalUsers,sessions,screenPageViews,engagementRate`, no dimensions and `limit=1`. Search Console query used no dimensions and `rowLimit=1`. Both failed permission checks, so **no traffic totals were established for that period**. Rank Math's cached defaults use its own date-range logic, not that explicit Site Kit period.

WordPress authentication works. The missing authorization is the current WordPress user's Google grant within Site Kit; another administrator's connected module/property does not automatically authorize our user to query it. `needsReauthentication: false` does not override `authenticated: false`. A connected property and enabled snippet do not independently prove tracking accuracy, current collection or actual traffic volume.

Rank Math cached endpoint success is not proof of usable analytics. Its explicit `n/a` fields and empty analytics series mean the zero-filled graph and optimization totals must not become measured zero traffic or a replacement for the separately verified stored per-content SEO scores.

## Data we could use after authorization

| Data | Candidate source | Current availability |
| --- | --- | --- |
| Page views, users, sessions, engagement rate | Site Kit / GA4 | Configured; tested report blocked by missing Google scopes |
| Popular pages, traffic channels/referrers, device or geographic breakdowns | Additional bounded GA4 reports | Potential follow-up after access; not individually tested |
| Google Search clicks, impressions, CTR, average search position | Site Kit / Search Console | Configured; tested report blocked by missing Google scopes |
| Search queries and page-level search performance | Additional bounded Search Console reports | Potential follow-up after access; not individually tested |
| Imported Rank Math search/page-view summaries | Rank Math local analytics tables/cache | Readable endpoints; no usable totals returned |
| Stored SEO scores, metadata and content evidence | Existing WordPress/Rank Math adapter | Already verified; not page-view/visitor measurements |

**Scope decision:** the user requested discovery of readily available data only and explicitly excluded adding Google authorization setup. Do not add reconnection, scope-grant, direct Google OAuth or analytics setup work to the plan. Keep page views, traffic and search-performance metrics unavailable with the current connection; continue using the working content, metadata and stored SEO-score evidence. No traffic-based score contribution or additional access work is planned.

## Artifacts and checks

Ignored credential-free snapshots:

- `reports/wordpress/analytics-discovery.json`: relevant plugins, namespaces, route methods and argument schemas, ability discovery.
- `reports/wordpress/analytics-access.json`: Site Kit configuration and connection flags.
- `reports/wordpress/analytics-metrics.json`: two report reads and their 403 error codes.
- `reports/wordpress/analytics-cached.json`: authorization flags and cached Rank Math endpoint summaries.
- `reports/wordpress/analytics-cached-summary.json`: explicit `n/a` markers confirmed by one additional cached summary read.

Explicit scripts from `server/`: `node scripts/inspect-wordpress-analytics.mjs` for discovery, and `node scripts/verify-wordpress-analytics.mjs` for configuration. Its `--reports` mode reads the documented fixed date window; `--cached` checks Google authorization and existing Rank Math summaries; `--cached-summary` reads one Rank Math summary. Scripts use fixed read-only paths and bound site/business configuration. Diagnostics omit raw bodies, OAuth tokens, owner IDs, page content and provider messages. These operator diagnostics do not add application endpoints or automatically collect analytics.

Validation: script syntax checks and `npm run lint`; credential scan and disabled-write configuration check. No backend implementation changes required the application test suites.

Primary compatibility references: [Site Kit Analytics](https://sitekit.withgoogle.com/documentation/supported-services/analytics/), [Site Kit report controller](https://raw.githubusercontent.com/google/site-kit-wp/1.190.0/includes/Core/Modules/REST_Modules_Controller.php), [GA4 reporting](https://raw.githubusercontent.com/google/site-kit-wp/1.190.0/includes/Modules/Analytics_4/Datapoints/Get_Report.php), [Search Console reporting](https://raw.githubusercontent.com/google/site-kit-wp/1.190.0/includes/Modules/Search_Console/Datapoints/Search_Analytics_Trait.php), [Rank Math cached analytics routes](https://raw.githubusercontent.com/rankmath/seo-by-rank-math/master/includes/modules/analytics/rest/class-rest.php). These describe provider behavior; the actual site's access findings above come from the dated live checks.
