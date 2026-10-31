# Facebook Page connection testing

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
