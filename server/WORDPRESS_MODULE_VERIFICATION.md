# WordPress module verification

October 31 implementation follow-up: immutable evidence reports, minimized Muse input, default-off read-only interpretation and public media-alt verification are implemented. The final live report `12897672-5152-4f1c-b727-b72cd3cdfe9c` (`2026-10-31T18:14:22.516Z`) passed saved-read/history and cost-free Muse preparation: 20 pages, 17 posts, 20 media, stored score samples 13/17, and 91 cited observations. All five source sections were available. Backend checks passed: 24 suites, 429 tests and one skipped, typecheck, lint and build. No live model call, content edit or new fresh audit occurred; writes remain disabled. The prepared media 5522 proposal expired without approval and requires fresh preview/review. Details and archive limits are in [saved report verification](WORDPRESS_REPORTS.md). Historical phase 1/2 results below are preserved.

Follow-up: [fresh-audit investigation](RANKMATH_AUDIT_INVESTIGATION.md) inspected the original receipt without rerunning it, added explicit execution states/redacted diagnostics, and successfully tested the independent post-evidence tool. The historical result and timestamps below remain unchanged.

Verified October 30–31, 2026 UTC (October 30 local time) against `https://guzmantaxaccounting.com`, registered business `demo-guzman`. Credentials were reused from ignored `server/.env`; a private random operator key and the matching business/site binding were configured there. `WORDPRESS_WRITES_ENABLED=false` remains set.

## Phase 1: module reads

Built the backend and started a fresh full application on a temporary `127.0.0.1` port. Verification went through the actual module HTTP endpoints, guard, business repository and DNS-pinned transport. Existing development processes were not stopped or restarted. No frontend files were changed by this work.

All paths below are relative to `/api/wordpress/businesses/demo-guzman`:

| GET request | Outcome |
| --- | --- |
| `/connection` with valid operator authorization | 200; authenticated user 12, administrator; writes disabled |
| `/connection` with invalid operator authorization | 401 `WORDPRESS_OPERATOR_REQUIRED` |
| `/api/wordpress/businesses/unregistered-business/connection` (absolute path) | 404 `BUSINESS_NOT_FOUND`; no remote request needed |
| `/content/pages?page=1&perPage=3` and `/content/pages/5652` | 200; editable title/content/excerpt/slug and modification timestamp available |
| `/content/posts?page=1&perPage=3` and `/content/posts/5521` | 200; editable title/content/excerpt/slug and modification timestamp available |
| `/content/media?page=1&perPage=3` and `/content/media/5669` | 200; editable title/alt text/caption/description/slug and modification timestamp available |

The six selected capabilities (`edit_pages`, `edit_posts`, `edit_published_pages`, `edit_published_posts`, `upload_files`, `manage_options`) were all true. This verifies read access and capability reporting; actual content mutation has not been tested.

Three items from each collection were sampled. Representative modification dates were `2026-09-25T02:44:22` (page), `2026-04-25T00:26:45` (post) and `2026-10-01T07:02:45` (media), all WordPress GMT values. Original values were inspected in memory; the diagnostic records only field availability, not private page bodies.

## Phase 2: Rank Math

Plugin inventory confirms active Rank Math Free `1.0.277.2`; no active Pro add-on was returned. Inventory does not establish a paid account subscription.

Live verification identified three adapter defects, now corrected: ability discovery exceeded the two-request transport limit, ability paths omitted `/abilities/`, and JSON-string query input returned HTTP 400. The site's authenticated REST index advertises `/wp-abilities/v1/abilities/{name}` and its `/run` route. Definitions are now read sequentially using those installed routes, and execution uses structured `input[...]` query fields. Offline fixtures cover the route shape, exact input encoding and discovery through a bounded transport.

All three expected ability definitions are present with `readonly: true`: `get-post-seo-meta`, `get-seo-scores` and `audit-site-seo`. Definition discovery establishes their advertised contracts; only the first two were executed as evidence reads. No 401/403 provider permission failure was observed in these reads. Earlier unavailable responses were adapter compatibility failures, not proof of missing configuration.

The page metadata ability returned page 5652's title, empty description, focus keyword, canonical, robots and social metadata, with stored score 13. A bounded 20-page sample returned numeric and null stored scores; null values were preserved. Missing optional metadata, templates/fallbacks and content outside the bounded sample remain coverage limits. Content modification dates and collection timestamps do not establish scoring dates. Metadata returned by Rank Math does not independently verify the public rendered page.

The final module snapshot began at `2026-10-31T00:06:34.832Z`; all 11 HTTP checks returned their expected statuses. Both page and post evidence report `availability: available`:

| Evidence | Result |
| --- | --- |
| Page 5652 metadata | Title, canonical, keyword, robots, Open Graph/Twitter fields exposed; description is an empty string; stored score 13 |
| Post 5521 metadata | Title, nonempty description, canonical, keyword, robots, Open Graph/Twitter fields exposed; stored score 53 |
| Stored page-score sample | 20 entries: 12 numeric scores (8–85), eight unavailable/null |
| Stored post-score sample | 17 entries: 14 numeric scores (7–66), three unavailable/null |
| Fresh audit | One explicitly authorized request dispatched; result unavailable, score null, no established findings; receipt/replay verified |

An empty description in the metadata response does not prove the rendered page lacks a description, because templates/fallbacks may apply. No expected ability was unsupported after the compatibility fixes. Account subscription, scoring dates and public rendered values remain unverified. No permission failures were observed with the corrected read requests; the initial JSON-string input requests returned HTTP 400 and were corrected.

### Authorized fresh-audit verification

After the operation and cache/remote-service effects were explained, the user explicitly authorized finishing phase 2. One fresh-audit request was dispatched against the bound Guzman installation on October 31, 2026 UTC (October 30 local time), using request ID `e6db4b16-46e3-44e5-804c-d817103f030d`.

The verification began at `2026-10-31T00:10:07.927Z`; its outcome was saved at `2026-10-31T00:10:40.343Z`. The gate was enabled only in the temporary backend process; ignored `.env` retained `WORDPRESS_WRITES_ENABLED=false` throughout. No content proposal or Apply operation was issued.

| Check | Observed result |
| --- | --- |
| Confirmed POST `/rank-math/audits` | HTTP 201 with persisted outcome |
| Remote `/audit-site-seo/run` dispatch count | Exactly one |
| Repeat POST with the same request ID | HTTP 201; identical saved outcome, no additional remote audit dispatch |
| GET `/rank-math/audits/e6db4b16-46e3-44e5-804c-d817103f030d` after disabling gate | HTTP 200; receipt matched original outcome, no additional remote audit dispatch |
| GET `/connection` after verification | HTTP 200; `writesEnabled: false` |

The provider result is `availability: unavailable`, `score: null`, `sourceLastRunAt: null`, `remoteApiStatus: unknown`, and `findings: []`, with limitation `The audit did not return a compatible result.` This is **not** evidence of a clean audit or a completed remote scan. No fresh findings, coverage or scoring date were established. The current adapter returns the same safe limitation for a failed request or incompatible payload, so the precise cause is not established by this receipt. Remote completion and any cache update remain unconfirmed. The request was not rerun and no new ID was generated to bypass the reservation.

The durable outcome is in ignored `reports/wordpress-actions/e6db4b16-46e3-44e5-804c-d817103f030d.outcome.json`; the credential-free verification snapshot is `reports/wordpress/audit-verification-e6db4b16-46e3-44e5-804c-d817103f030d.json`. The existing page/post metadata and stored-score evidence remains usable and separate from this unavailable fresh result. Further fresh audit attempts require new explicit authorization after investigating the existing outcome.

`scripts/verify-rankmath-audit.mjs` requires `--confirmed --request-id=<uuid-v4>` and the exact verified business/site binding. It starts a temporary backend, enables the gate only in that process, submits one confirmed audit, replays the same ID while counting remote dispatches, disables the gate, and compares the saved GET receipt. It refuses a second remote audit dispatch. The command was executed once for this authorization and passed its receipt/replay/gate checks. Reuse the original request ID to inspect an uncertain operation; never create a new ID as an automatic retry.

## Repeatability and checks

From `server/`, build with `npm run build`, then explicitly run `node scripts/verify-wordpress-module.mjs` for live read-only verification. It starts/closes its own temporary API, forces writes disabled, issues only GETs, and saves `reports/wordpress/module-verification.json` (ignored). Do not confuse successful HTTP evidence responses with available provider data; inspect the nested availability and limitations.

`npm run check` passed: typecheck, ESLint, 16 suites, 270 tests passed and one skipped, followed by build. Automated tests use offline fixtures. No API contract or frontend presentation change was made.
