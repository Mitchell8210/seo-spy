# Facebook Page connection testing

## Temporary Shares exception and 30-day Comments

At the user's explicit request, the existing Social Media row stays labeled **Shares** and temporarily displays lifetime share counts, independently of the 30-day metric window. Existing bounded post reads now also request `shares`; each saved post retains `shareCount` (null when omitted/invalid). Separate `lifetimeShares` records the source field, collection time, known sum, exact total when established, counts of collected/known posts and completeness. Numeric positive partial sums display with `+` (for example `18+`); omitted counts or truncated post listings never become exact Page totals or zero. A confirmed exact zero remains zero. Old reports are not rewritten and keep the existing uncollected state until an explicit new report.

**Comments** retains its original label and counts comments/replies created during the same 30 completed Pacific days. It scans API-visible comment streams across all collected posts, including older posts, requesting only IDs/timestamps. Only a completely enumerated accessible post listing and exhausted comment pagination establishes the period total. If the existing 50-post sample is truncated, a separate bounded Page read uses comment field expansion to enumerate up to 250 accessible posts (ten pages of 25), preserving that original sample/UI. Embedded comment streams are paginated independently when necessary. If Meta omits an embedded comments field, an explicit direct comments read verifies that post rather than assuming zero. Other limits: five comment pages per post, 100 comments per page and 150 requests overall, within the collector's existing total deadline. It validates Page-bound post IDs, unique comment IDs, timestamps and cursor progress; missing/invalid/truncated/failed reads retain a null total. Neither comment text nor identities are requested or saved. API visibility cannot establish hidden/deleted comments.

The additive `commentCounts` summary records exact since/until/timezone, status/total/observed count and collection coverage. Separate evidence records retain provenance. Frontend mapping requires matching complete period proof for Comments and interprets Shares independently as the authorized temporary lifetime exception. The Interactions headline remains the original 30-day engagement metric, not an arithmetic sum of mixed-period supporting rows. No labels, controls, component structure, styling, scoring or external writes changed. Collection still requires explicit Run Report; saved reads and polling never contact Meta.

Initial live run `fde8d0a6-be7d-4714-a586-3f5b164e487b` at `2026-11-01T17:34:48.961Z` mapped Shares to `243+` from 20 known counts among 50 collected posts. Comments correctly remained unavailable with `INCOMPLETE_POST_COVERAGE` because more posts existed. This prompted the independent expanded comment-coverage read described above, without altering the preserved sample or presenting partial comments as a total.

Focused `probe=comments` diagnostics on the same confirmed browser endpoint isolate direct comment access and basic/stream/period field expansions without returning content, people or comment IDs. The actual `2026-11-01T17:39:30.211Z` response confirmed all variants accessible; only one of five sampled posts included a nested comments field, while direct timestamped reads succeeded. The first expansion-based report (`cf6b3a8d-50eb-49b5-81d8-abf6d44f0352`) correctly stayed unavailable when parsing those omissions. The collector now verifies omitted edges directly. No primary-source rule declaring omitted nested comments equal zero was found; Meta's [official SDK cursor](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/api.py) preserves absent totals as unavailable, and direct reference pages returned 429 during this review. A successful exhausted direct response can establish zero API-visible matching comments; a missing edge alone cannot.

Final user-triggered live verification saved `8d6ae8b9-23c9-4867-bccc-248133050615`, collected `2026-11-01T17:42:32.330Z`. Comment enumeration completed across all 76 accessible posts and returned exactly **1** API-visible comment/reply in October 2–31 Pacific. The report retains Shares **243+**, the known lifetime sum among 20 posts with counts in the preserved 50-post sample. The local saved-data verification script exercised the real frontend mapper and confirmed Comments `1` / Shares `243+`, with labels unchanged. The original 50-post sample remains visibly unchanged; the independent 76-post coverage exists only in saved comment evidence. Report remains partial for unrelated profile/timezone and recent-sample limitations. No additional collection is performed by verification reads.

## Cumulative 30-day report strategy

New explicit report runs use the last 30 **completed Pacific calendar reporting days** (`America/Los_Angeles`), excluding the current partial day. Each daily boundary is resolved independently across daylight saving changes. `window.basis: complete-provider-days` and `window.timeZone` distinguish this strategy from legacy rolling-time reports. Every summed metric retains source identity, numeric points and `coverage: {complete,expectedDays,returnedDays}`. Only all 30 expected exact day-ending buckets establish a cumulative total; incomplete or empty series have null totals, never missing-day zero filling. Unexpected old/future buckets are excluded; duplicate periods, mismatched metrics and invalid counts fail closed. These are provider-reported completed days, not a guarantee Meta has finalized or will never revise the measurements.

The collector now additionally reads `page_actions_post_reactions_total` and derives internal metric `page_post_likes` from the `like` key only. A present day's sparse reaction dictionary with no like key contributes zero likes; a missing day does not. New-conversation counts and aggregate Page actions are retained under their original, distinct metric names and evidence, without substituting them for Messages or People Who Contacted You. No per-post lifetime totals or new-post-only sampling is used to manufacture 30-day comments/shares.

The existing Social Media page displays eligible cumulative interactions, Likes, views and daily follows/unfollows in their original fields. Followers remains a current profile snapshot; unique People Reached remains unknown. Unsupported comment/share/message/contact/unique-mention fields retain their existing unavailable treatment. Old reports remain immutable/readable, but their unproven cumulative values are unavailable on this page until an explicit new Run Report succeeds. No labels, components, controls, layout or styling change. No background provider collection, external writes or AI calls are introduced. The existing Run Report button collects/saves a new immutable business-scoped report through the browser session.

Live saved validation: the user explicitly clicked Run Report, producing `45e6b787-93ee-4d06-94af-4e90777d0139` at `2026-11-01T17:22:34.493Z`. Its window is October 2–31 Pacific (`2026-10-02T07:00:00Z` through exclusive `2026-11-01T07:00:00Z`); all ten daily metrics have complete 30/30 coverage. Saved cumulative totals: engagements 5, likes 4, media views 115, Page views 36, video views 12, daily follows 2, daily unfollows 0, aggregate Page actions 0, new messaging conversations 1. Follower history remains snapshots, never summed. Report is partial because other source/profile limitations remain; completeness is per metric. The one conversation and aggregate actions are not displayed under Messages/People Who Contacted You. The saved API was read after collection without initiating another provider call. From `client/`, `node scripts/verify-social-30-day.mjs` validates ownership, complete saved evidence and actual frontend mapping using only the local saved-data API.

## Explicit interaction/contact metric diagnostics (November 1, 2026)

Focused share verification adds `&probe=shares` to the confirmed diagnostic URL, using the same browser credential and selected-Page authorization. It requests only five recent Page posts and, for each, separately tests the lifetime `shares` field, minimal `/sharedposts` access and `created_time` field selection. It never generates a report or changes UI values. Invalid probe names are rejected. No automatic retries, shared-post IDs/identities/text or raw provider URLs are exposed.

Actual browser result at `2026-11-01T17:28:50.811Z`, Graph v26.0: both basic and timestamp-field `/sharedposts` requests succeeded but returned empty lists on all five posts, with no next-page indication. The lifetime shares field was omitted on the first three posts; posts `608911535631168_122181928040791261` and `608911535631168_122179475564791261` each returned count 9. Thus at least two tested posts have known lifetime shares while no shared-post records are exposed by these reads. Timestamp values and complete share-event coverage remain unverified. The two lifetime counts cannot be assigned to October 2–31, and empty sharedposts must not become zero shares. The existing Shares UI field therefore remains unavailable. A delta between future lifetime snapshots would measure net changes and would not by itself establish gross sharing events within a period.

`GET /api/facebook/connection-metrics?pageId=AUTHORIZED_PAGE_ID&confirmed=true` uses the existing browser's encrypted connection, backend-origin Host guard, required read grants and bounded authorized Page selection. No configured CLI token fallback, credential export, frontend controls or external writes are involved. Only explicit navigation invokes these probes; saved-report reads, polling, startup and report collection do not invoke them. Each candidate is requested once without retries. The request has a two-minute deadline and returns allowlisted counts/insights, never people, message content, conversation IDs or provider paging URLs. This diagnostic does not save an audit or populate dashboard fields.

Live result supplied from the authorized browser at `2026-11-01T17:13:18.252Z`, Graph v26.0, Guzman Page `608911535631168`:

| Candidate/read | Actual response | Meaning/limit |
| --- | --- | --- |
| `page_post_engagements` | Daily series, sum 5 | Returned aggregate engagement; not a sum of the UI's four interaction fields |
| `page_actions_post_reactions_total` | Daily reaction dictionaries; `like: 4` in one bucket, remaining dictionaries empty | Like breakdown accessible; preserve source periods and empty breakdown semantics when integrating |
| `page_total_actions` | Numeric daily series, all zero | Aggregate Page actions; not unique people and not a website/address breakdown |
| `page_messages_new_conversations_unique` | Daily series with one bucket 1 | New messaging conversations, not messages or a deduplicated period-wide people total |
| `page_messages_total_messaging_connections` | Empty metric array | No measurement established; not zero |
| Website/directions/CTA unique-click candidates | Rejected, Meta 100 | Tested names unavailable for this request; this alone does not prove all click APIs are unavailable or identify a deprecation reason |
| `page_activity_by_action_type`, `page_consumptions_by_consumption_type`, `page_messages_total_messaging_connections_unique` | Rejected, Meta 100 | Do not infer missing permissions or zero activity |
| First two recent post LIKE summaries | 1 each | Lifetime per-post counts, not 30-day Page totals |
| First two recent post comment summaries | 1 and 0 | Lifetime per-post counts; does not establish when the comment occurred |
| First two post `shares` fields | Omitted | Unknown, not confirmed zero |
| Tagged posts and visitor feed, bounded requested window | Empty, no next page | No returned posts; not proof of all mentions or zero unique people mentioning the business |
| Messenger conversations, IDs requested only | Rejected, Meta 200 | Conversation access not established; `pages_messaging` absent from the granted set |

All nine user-listed permissions were actually granted, alongside `public_profile`. The diagnostic's historical permission list displays only its eight configured read/write checks; `email` not appearing there is not proof of a missing grant. This new diagnostic returns sanitized actual grant names. Neither optional management grants nor Page tasks authorize writes by the application.

The requested rolling 30-day window returned Meta day buckets, including a bucket ending after collection time. Do not claim exact finalized rolling-window totals without explicitly handling provider day/timezone boundaries and completeness. No new value has been mapped into a mismatched frontend slot: new conversations must not populate Messages, aggregate actions must not populate People Who Contacted You, and post/comment counts must not become unique mentions.

Official references: Meta's [Post SDK reference](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/post.py) supports the separate reaction/comment reads and shares field. Its [Messenger Conversations documentation](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a) requires `pages_messaging` as well as the applicable Page grants/tasks; counting conversations is distinct from counting messages. Direct Page Insights documentation returned 429 during research, so unsupported candidate names are reported as live outcomes rather than a definitive deprecation claim.

Meta also maintains an official [Social Technologies MCP](https://github.com/meta/agentic-tools) at `https://mcp.facebook.com/devtools`, with documentation search and integration guidance. It is not configured here and does not replace the existing Page connection. No MCP installation, additional authorization or model call was performed.

## Saved results in the application

The **Social Media** page reads the latest usable saved Facebook report for the selected business. It uses `GET /api/businesses/:businessId/facebook-report`, returning `{businessId, report, analysis, latestAttempt}`. `report` is the original immutable archive; `analysis` is deterministic `facebook-analysis-v1` output linked by `auditId`. It includes summaries and evidence-linked findings/recommendations about profile fields, the newest collected post and differing formatted US contact numbers. A newer failed attempt is reported separately while an older usable report remains visible. Empty, unavailable and zero results are distinct. This read makes no Meta calls and does not imply the current connection is still valid.

Existing saved reports receive current derived analysis without changing any archive files. Newly generated reports persist the improved findings/recommendations and add `results.facebook.analysisVersion`. Downloaded archive JSON remains the original snapshot and can differ from the current derived analysis displayed by the page. Analysis uses collection time, reports historical/partial data limits, and does not define a social score or guarantee increased reach.

Use the browser connection/report tool to generate a new report, then refresh the Social Media page. The main Overview/Website pages are outside this integration. Authentication, customer ownership, write actions and cross-channel website comparisons are still deferred.

## Generate a report from browser authorization

Restart the backend and open **http://localhost:3001/api/facebook** directly. Click **Connect / reconnect Facebook** once to replace the previous temporary session. The backend exchanges the authorization code, requests a long-lived user token, checks its app/type/validity and expiry through Meta, and verifies all five read permissions before saving credentials.

After consent, select your Page, enter the registered business ID (`demo-guzman` for the seeded business), and click **Generate and save Facebook report**. The request uses this browser's saved connection, independently of `FACEBOOK_ACCESS_TOKEN`. It performs bounded read-only collection and returns a download link after the immutable archive is saved. Completed, partial, and failed reports show their own status. Existing report-list/download and evidence/recommendation routes can read these archives after restart; main dashboard cards are not yet populated by this workflow.

`FACEBOOK_TOKEN_KEY` is a server-only, base64-encoded random 32-byte encryption key. A local key was generated in ignored `server/.env` without displaying it. Keep it stable across restarts. New installations must generate their own key; never commit it, reuse the App Secret for it, or include it in screenshots. Credentials use AES-256-GCM authenticated encryption, random nonces, hashed filenames and atomic publication under ignored `server/reports/facebook-connections/` (override with `FACEBOOK_CONNECTIONS_DIR`). Missing, incorrect or corrupt keys/storage fail closed. Losing or changing the key requires reconnecting; archived reports remain independent of credentials.

The opaque HttpOnly/SameSite browser cookie persists for at most 30 days, with an independent server-side 30-day connection limit. Meta token/data-access expiry and revocation can require an earlier reconnect. Token and data-access expiry are recorded from Meta rather than assumed; no background refresh or indefinite renewal is promised. The user token is encrypted at rest; Page tokens are derived during collection and are not saved in reports. Disconnect deletes that connection's encrypted credential and clears its cookie without revoking the business integration at Meta. Pending OAuth state remains in memory for ten minutes and does not survive restart.

This is a local operator workflow. Application sign-in, user-to-business authorization, production HTTPS cookies, shared deployment, background scheduling and main frontend integration remain subsequent work. Report creation reserves a business against duplicate browser report requests, aborts on shutdown, and records usable partial collection or a failed archive as appropriate.

## Saved Facebook audit report

The local operator can collect and archive a business-scoped report with an explicit authorized Page selection:

```powershell
npm run audit:facebook -- --business-id demo-guzman --business-name "Guzman Tax Accounting" --website https://guzmantaxaccounting.com --page-id 608911535631168
```

Use the appropriate business identity and Page ID for other businesses. The collector verifies that the configured user token can access the selected Page before using its Page token. These operator-provided business details are a local snapshot, not proof of customer ownership. It reads `FACEBOOK_ACCESS_TOKEN` from the ignored server environment. No credentials are accepted on the command line.

Each run creates a UUID and an immutable `seo-spy.audit-report.v1` JSON archive under `REPORTS_DIR` (default `server/reports/audits/`). The command prints the report ID and download route only after saving and reading it back. It archives failed attempts as failed, and preserves usable evidence on partial collection. It never overwrites a prior run. A missing/invalid local configuration fails before collection.

October 29 verification: automated checks passed (143 tests, one skipped). The live collector archived and read back failed attempts because Meta rejected the existing token with `190/463` (expired). Populated live report verification awaits a fresh `FACEBOOK_ACCESS_TOKEN`.

The report adds `scope: facebook`, `scoringVersion: facebook-v1`, `source: facebook` findings, and `results.facebook`. It includes dated profile evidence, bounded recent posts, 30 days of supported daily metrics, coverage, warnings, and cautious recommendations linked to evidence. Missing or failed data is not zero; follower snapshots are not summed. Social/overall scores remain unavailable. Findings are review suggestions, not executed changes or guarantees of increased reach.

Existing local routes retrieve archived results after restart: `GET /api/audits/:auditId/report`, `/api/audits/:auditId`, `/api/audits/:auditId/findings`, and `/api/audits/:auditId/recommendations`. `GET /api/businesses/demo-guzman/reports` lists runs for the seeded business; other business IDs require a registered business for the list endpoint. Main dashboard cards and its latest-audit selection are not populated by the CLI. HTTP audit creation still accepts only demo/homepage/Lighthouse scopes; customer OAuth, authorization, frontend mapping, and scheduling are subsequent work.

The local Facebook provider is a development diagnostic tool. It exchanges an OAuth authorization code on the backend, checks granted permissions, lists authorized Pages, and probes supported Page data. It does not publish posts, edit a Page, generate social scores, or connect the main dashboard cards to live results.

## Configure the server

Put these variables in ignored `server/.env`, without a leading `#`. Never put credentials in client/Vite variables, screenshots, or source control.

```dotenv
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CONFIG_ID=
FACEBOOK_TOKEN_KEY=
FACEBOOK_CONNECTIONS_DIR=reports/facebook-connections
FACEBOOK_ACCESS_TOKEN=
FACEBOOK_REDIRECT_URI=http://localhost:3001/api/facebook/callback
FACEBOOK_GRAPH_VERSION=v26.0
```

The App ID and App Secret come from the Meta app's basic settings. The configuration ID comes from a Facebook Login for Business configuration; it is not the App ID, Page ID, or business portfolio ID. All three are required to start a connection. The redirect URI and Graph version have the defaults above. Restart the server after changing `.env`; existing process environment values take precedence.

`FACEBOOK_ACCESS_TOKEN` is optional and is used only by the legacy CLI/diagnostic paths. Browser-authorized reports do not use it. The retained developer-only `/test-token` endpoint creates a temporary one-hour memory session and does not verify OAuth, extend the token or save it encrypted. It is no longer offered as the primary browser workflow.

## Configure Meta

1. Keep the app in development/testing mode. Use its **Manage everything on your Page** use case and locate **Facebook Login for Business** settings/configurations. Dashboard labels can vary.
2. Create a login configuration using a **User access token**, with access to the Pages the person authorizing the app manages. Copy its configuration ID to `FACEBOOK_CONFIG_ID`.
3. Include `pages_show_list`, `pages_read_engagement`, `read_insights`, `pages_read_user_content`, and `business_management` in the configuration and enable the corresponding permissions for testing in the use case. All five are now required by the connection check.
4. Enable web OAuth login and register this exact valid OAuth redirect URI:

   ```text
   http://localhost:3001/api/facebook/callback
   ```

5. Authorize with an app administrator/developer/tester who also has the appropriate access/tasks on the test Facebook Page. Accept any tester invitation first. During consent, grant access to the Page you want to inspect.

Open the local test page using **localhost**, matching the callback hostname. `127.0.0.1` and `localhost` are different browser cookie hosts. If changing the server port, update the redirect variable and Meta allowlist together.

The test page uses `Referrer-Policy: same-origin` to preserve the browser Origin header on form submissions. Callback and diagnostic responses retain `no-referrer`. OAuth and diagnostics must use the backend page directly; avoid proxying these routes or using cached copies after a restart.

The main Social Media page now offers Run Report for its selected saved Page. For this JSON report request only, the backend also accepts the exact local frontend Host and Origin configured by `FACEBOOK_FRONTEND_ORIGIN` (default `http://localhost:5173`). Use the same hostname as the callback and the same browser used to connect Facebook; the HttpOnly connection cookie is shared across ports and remains restricted to `/api/facebook`. The Vite proxy preserves Host, Origin and cookies. Different ports require configuring the exact frontend origin and restarting the backend. Unknown origins, mismatched hosts and frontend form submissions are rejected. No wildcard CORS or fallback to a server-configured token is used. Other connection routes keep their backend-origin guards.

The test page and connect response allow `https://www.facebook.com` in CSP `form-action` because browsers may apply that directive to the OAuth redirect following the local POST. Other routes retain Helmet's default `form-action 'self'`. Reload the test page after a backend restart to receive its current CSP.

If Meta rejects local HTTP in your configuration, do not expose this unauthenticated API through a public tunnel. Establish authentication, authorization, and a deliberately secured HTTPS development setup before using a public callback.

## Test the connection

From `server/`, run `npm run dev`, then open:

```text
http://localhost:3001/api/facebook
```

Use the connection form, complete Meta consent, and inspect the resulting diagnostic data in the same browser. No access token needs to be copied into the browser or `.env`.

| Method | Route                      | Purpose                                                                                                                                 |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/facebook`            | Local HTML connection test page                                                                                                         |
| GET    | `/api/facebook/status`     | Configuration availability, without secret values                                                                                       |
| POST   | `/api/facebook/connect`    | Same-origin form starts Meta authorization                                                                                              |
| POST   | `/api/facebook/test-token` | Same-origin form creates a diagnostic session using optional server-configured user token                                               |
| GET    | `/api/facebook/callback`   | Validate OAuth state and exchange the code on the backend                                                                               |
| GET    | `/api/facebook/connection` | Sanitized diagnostic result for the browser session                                                                                     |
| POST   | `/api/facebook/disconnect` | Forget the local connection/session                                                                                                     |
| POST   | `/api/facebook/reports`    | Generate and archive a report using the browser connection; form or JSON body `{businessId, pageId}`; HTTP 201 only after archive write |

OAuth state is bound to a browser cookie and consumed once. Validated OAuth credentials survive restarts in encrypted storage. Old in-memory diagnostic sessions need reconnecting to use that persistence. Remove the business integration in Facebook settings to revoke Meta authorization itself.

## Interpret results

The provider checks `/me/permissions`, traverses a bounded number of `/me/accounts` results, and probes Page metadata, posts, and an insights request using `page_post_engagements`. Each probe reports its own outcome so a missing field or rejected metric does not imply that the whole connection failed. A bounded Page listing is not a complete inventory when more Pages exist.

| Permission                 | What the test establishes                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pages_show_list`          | Whether the user granted permission to list managed Pages                                                                      |
| `pages_read_engagement`    | Whether the user granted permission needed for supported Page information/content reads                                        |
| `read_insights`            | Whether the user granted insights permission; the actual insights probe separately establishes whether its metric is available |
| Optional write permissions | Whether Meta reports them as granted; no write is attempted                                                                    |

An empty Page list can mean no Page was selected during consent, the account lacks suitable Page access, or asset access is restricted. Reconnect and review the selected assets and app/tester roles. A granted permission does not prove that every operation or every Page is accessible.

Unavailable insights are not zero engagement. API metrics, history, retention, and editable fields vary by Graph version and Page eligibility. This initial probe does not establish follower trends, full reach/impression history, or publishing/profile-edit capability. Write support requires a separate implementation with concrete approval and verification before external changes.

For customer accounts beyond the app's development roles, complete the applicable App Review, Advanced Access, and business verification requirements. Encrypted local storage does not establish application authentication, business ownership authorization, or production account onboarding.

Meta setup references: [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/), [Pages API getting started](https://developers.facebook.com/docs/pages-api/getting-started/), and [permissions reference](https://developers.facebook.com/docs/permissions/).

## Verification status

`GET /api/facebook/reports/status?businessId=...` reads this browser connection's report progress without provider calls. It accepts the configured frontend proxy Host and requires a valid local browser credential. The response contains `businessId`, nullable `active` (`pageId`, `status: running`) and nullable `latest` (`pageId`, archived `result` or safe `error`). Another browser session cannot inspect the initiating session's job/outcome. Running state remains in memory across navigation; backend restart clears it. Terminal outcomes expire after one hour and the cache is bounded; saved report archives are unaffected.

Expanded read-only checks ran successfully on October 29, 2026 UTC using `node scripts/test-facebook.mjs --all-permissions`. This saves a dated, credential-free diagnostic under ignored `server/reports/facebook/`. The five requested permissions are granted. Representative reads verified Page listing, business portfolio/owned Page access, profile fields and posts, user-content endpoints, and multiple Page/post insights. Empty user-content results establish endpoint access, not the existence or completeness of visitor content. Hours and username were omitted by Meta. Legacy impression and engaged-user metric probes returned error 100; do not treat these as zero or assume a missing permission. Browser OAuth remains a separate test.

The initial token was rejected with error `190/467`; a replacement token passed the live checks above. The user subsequently completed basic browser OAuth and confirmed all five grants plus Page/posts/insights access. The extended long-lived exchange and browser report workflow are covered by controlled tests and need fresh browser consent for live verification.

To run the explicit read-only live diagnostic from `server/`:

```powershell
npm run build
node scripts/test-facebook.mjs
```

The script reports safe error codes and sanitized diagnostics without printing tokens or raw provider error bodies. It contacts Meta and is separate from normal automated checks. The implementation can be verified with controlled test responses independently of Meta credentials; actual OAuth consent must be confirmed through the browser flow. Do not interpret configuration availability as verified credentials or permission approval.
