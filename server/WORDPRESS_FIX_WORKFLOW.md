# Fix with AI — exact WordPress alt-text workflow

Implemented offline on November 2, 2026. No real model request, new production AI authorization, live WordPress request/write, budget change, push or deployment was performed. Browser visual signoff remains blocked; do not call this a live demonstration result.

## Checkpoint and reused infrastructure

Development checkpoint: `b8aa546` (`feat: implement SEO assessments and Muse AI integration`) on `feat/website-real-data-integration`. It contains 70 reviewed source/documentation/test-fixture files, preserving the previous work. No `.env`, runtime reports, SQLite databases, spending ledgers or actual credentials were staged. Intentional fake credential strings and a private-key redaction test were reviewed. Backend69 suites/1426 tests (one skip), typecheck/lint/build and frontend28 mapping tests, opportunity assertions, lint/typecheck/build passed. Existing Chrome smoke failed before app evaluation with `CDP timeout: Page.enable`; that limitation was reported before committing.

The new implementation reuses:

- Existing `WordPressService.propose`, `getProposal` and `apply`, exact hash/15-minute expiry, actor/business/site binding, write gate, fresh before-value/modification checks, immutable journals, SQLite artifacts, target locks, duplicate handling and uncertain-outcome rules.
- Existing `WordPressVerificationService`, protected `WebsiteCollector` and `verifyImageAlt`: separate stored-field/public-source verification, same-site URL/DNS/redirect protection and immutable receipts.
- Existing `MetaMuseProvider`, strict schema, one-use transport grant, central SQLite reservation/usage accounting, model settings and independent administrator approval. No new spending path or allocation.
- Existing three-step `FixReviewDialog`, buttons, report mapping and styles. The modal's temporary selection state is replaced with saved proposal/receipt behavior. No scoring, gauges, card layout, navigation or removed Social scoring breakdown was changed.

The old `AssessmentEditingService`/`media-alt-previews` bridge remains available to private operators. It uses a saved WordPress interpretation's exact cited media recommendation and operator-authored text; it neither generates alt text nor supplies reliable image-purpose evidence. The new browser layer adds those missing prerequisites and still delegates executable proposals to the existing WordPress service. Historical assessment v1–v5 and legacy WordPress routes remain compatible.

## Capability and evidence

Only `wordpress.media.alt_text.update` is browser-executable. Only the `alt_text` wire field is sent. Other media fields, pages/posts, Rank Math, Elementor body changes, Lighthouse investigations, business-information correction and Facebook posting remain informational/manual in this flow. Existing private generic WordPress endpoints retain their independent protections and are not accessible through a browser-session cookie.

The backend must first receive an explicit private-operator evidence confirmation. `fix-operator/evidence` binds one saved live `image-alt` finding/evidence to an exact media ID and a published, unprotected page/post. It requires:

1. Registered business/site, report and finding ownership, referenced live evidence at most seven days old, and immutable source-report hash.
2. Exact saved image-source URL matching the authenticated media's `source_url`; the recorded alternative must match the current stored value. Lazy placeholders, filenames and unrelated images cannot establish identity.
3. Fresh authenticated `context=edit` reads for that media/page, image attachment type, supported `OPTIONS` POST `alt_text` field, and account editing/upload capabilities. The existing www/non-www site-binding rule is retained. Credentials remain server-side. See the [WordPress media contract](https://developer.wordpress.org/rest-api/reference/media/).
4. Unambiguous source/attachment matching in the page's inert rendered-content sample using the existing verifier. This is evidence of placement, not proof that public builder/cache HTML has updated.
5. The trusted operator's explicit confirmation of informative/decorative/unknown purpose and a bounded, reliable description of the actual image. Optional browser preferences cannot create or replace this evidence.

Confirmed context expires after15 minutes. Capability GETs use saved local records only. Generation, proposal creation and each new Apply recheck the remote binding/state. Unknown purpose/empty informative description yields insufficient evidence; intentionally empty decorative alternatives are not offered as actionable defects. Multiple reviewed media targets under one finding require a separately scoped finding; the browser never guesses a target.

Media titles are not image descriptions. This implementation does not retrieve image pixels or send visual input to Muse. The modal shows the source-image link and explicitly says no thumbnail pixels were collected. A future visual adapter requires supported API input and separately authorized retrieval; no URL is silently sent to a vision API.

## Narrow Muse task

`wordpress-alt-input-v1` sends the current alternative, confirmed description/purpose/provenance, immutable source references and up to2000 characters of untrusted user preference text. It supplies no execution tool or selectable target. `wordpress-alt-output-v1` permits only `schemaVersion`, `status`, `altText` and a bounded reason enum.

For informative images, accepted text must be a normalized, contiguous excerpt of the confirmed description, at most300 characters. This conservative first adapter permits selection/shortening, not arbitrary visual invention or unrestricted paraphrase. It rejects invented words, extra target/action fields, HTML/control characters, URLs, stuffing and unsupported reasons. Decorative output must be empty with `DECORATIVE`; insufficient output must be null with `INSUFFICIENT_CONTEXT`. Human review remains necessary for factual accuracy and whether an excerpt adequately conveys the image's purpose.

Mock results are labeled `mock-fixture` with zero usage; real results retain `meta`, model/request/attempt/usage and exact request hash. Mode-aware generation caches are separate. Invalid output creates no executable proposal; any real provider usage remains in the central ledger. No raw response or reasoning is stored.

The private operator can prepare the exact request/cost with `fix-operator/preview` without creating an intent. `estimates` delegates to the existing provider/ledger; it does not authorize, raise limits or borrow an allocation. Real `generations` requires an existing, unexpired, separately administrator-approved intent for the exact actor/scope/request and enabled real gates. A private operator can dispatch the separately approved generation and then return the server to mocks: its saved, labeled result is readable by the scoped browser. Capability reads expose the latest validated saved generation for review without inference. Browser Generate remains mock-first; it never approves its own inference.

**Current live blocker:** normal AI flags and configured development budget remain mock/zero. Historical development attempts are exhausted. The existing controlled-testing allocation is assessment-scoped and cannot fund this new task. No alternative spending pathway or allocation extension was introduced. A future real alt-text test needs separately reviewed existing-ledger capacity, exact preview and explicit request/cost approval. Remaining assessment-testing capacity is not authorization for this task.

## Secure local browser connection

The server issues a60-second single-use random bootstrap grant only to the existing private Bearer-authenticated WordPress operator. The operator's key/application password never enters browser code. A20-minute session is stored server-side, scoped to the business, site and current operator identity. The browser receives an HttpOnly, SameSite=Strict cookie scoped to `/api/wordpress`; local HTTP is retained only for the existing loopback demo. This is not a public/remote or multi-user authentication system.

The bootstrap grant travels in a URL fragment, is removed before routing/network follow-up, and is consumed once. Sessions reject foreign/forwarded hosts, cross-site requests, changed business/site, expired grants/sessions and operator-key rotation. Mutations require the exact configured frontend Origin and a session-specific CSRF header. Restart invalidates in-memory sessions/tickets while preserving proposals, executions and receipts.

After building, a trusted operator may run the following locally to connect a browser. It grants no AI spending or WordPress write permission and was not run against production for this task:

```powershell
# Supply WORDPRESS_OPERATOR_KEY privately in this process's environment.
node scripts/wordpress-browser-session.mjs --business-id=demo-guzman --api-origin=http://127.0.0.1:3001
```

Open the printed private one-use link within60 seconds. Do not save/share/log it. Keep `.env`, writes and AI off while reviewing. The existing bearer-only APIs and AI administrator identity remain separate.

## Routes

All paths start `/api/wordpress`. Browser routes below are restricted to the scoped session/Origin/CSRF flow. Operator routes retain the existing Bearer/local-Host/exact-Origin guard. Zod rejects unknown input fields; hashes and ownership are checked again server-side.

| Method/path | Authorization and purpose |
| --- | --- |
| POST `browser-tickets` | Private operator; `{businessId}` creates one bootstrap grant, no provider request |
| POST `browser-session` | Exact local Origin/Host; consumes `{code}` once |
| GET `browser-session` | Session status/CSRF only, no provider request |
| POST `businesses/:businessId/fix-operator/evidence` | Private operator; `{confirmed:true,reportId,findingId,evidenceId,mediaId,pageResource,pageId,purpose,verifiedDescription}`; explicit read-only remote validation and immutable context |
| POST `businesses/:businessId/fix-operator/preview` | Private operator; `{evidenceId,instructions?}`; pure exact Muse preparation |
| POST `businesses/:businessId/fix-operator/estimates` | Private operator; same evidence/preferences plus necessity `reason`; existing central estimate, no approval/cap change |
| POST `businesses/:businessId/fix-operator/generations` | Private operator; `{confirmed:true,evidenceId,instructions?,intentId?}`; same protected generator, real calls require independent exact approval |
| GET `businesses/:businessId/fixes/capability?reportId=…&findingId=…` | Browser; saved eligibility, exact context, saved generation and gate state; no collection/inference |
| POST `businesses/:businessId/fixes/generations` | Browser; `{evidenceId,instructions?,intentId?}`; narrow mock-first generation/cache |
| GET `businesses/:businessId/fixes/generations/:id` | Browser; saved, revalidated mock/live result without inference |
| POST `businesses/:businessId/fixes/proposals` | Browser; `{generationId,altText}`; fresh target read and new existing-service proposal/hash |
| GET `businesses/:businessId/fixes/proposals/:id` | Browser; saved proposal and execution state without WordPress calls |
| POST `businesses/:businessId/fixes/proposals/:id/apply` | Browser; `{confirmed:true,proposalHash}`; exact single execution with independent writes gate |
| POST `businesses/:businessId/fixes/proposals/:id/verifications` | Browser; `{confirmed:true}`; explicit independent stored/public read, immutable receipt |
| GET `businesses/:businessId/fixes/proposals/:id/verifications/:verificationId` | Browser; saved receipt only |
| POST `businesses/:businessId/fixes/proposals/:id/restorations` | Browser; `{confirmed:true}` prepares a separate reversal proposal; no Apply |

## Three-step behavior and recovery

Review retains the original recommendation/evidence, exact media/page/source, recorded alternative, confirmed context, uncertainty, mock/live provenance and editable proposed text. Generate is explicit. Editing text or preferences invalidates the previous confirmation; continuing creates a new proposal/hash. Edits stay within the confirmed description/purpose.

Confirm shows exact before/after, media identity, `alt_text`, proposal ID/hash and expiry. The checkbox plus **Approve & Apply** is the only UI dispatch action. A client ref prevents double-click dispatch; existing SQLite/exclusive journals/target locks prevent duplicate/concurrent writes server-side. The execution marker now includes the original before-value and approved patch; successful stored verification records the fresh modification timestamp. No other field is sent.

Verify displays the saved execution receipt and offers an explicit independent verification. Statuses distinguish applied stored fields, `public_verified`, `public_mismatch`, `stored_verified_public_inconclusive`, `stored_mismatch`, and failed/uncertain receipts. Changed media/page identities produce a conflict. Actual public verification inspects protected collected source HTML, not a JavaScript-rendered browser DOM; builder/cache overrides can remain unresolved. No SEO score/ranking improvement is claimed.

An Apply transport failure triggers at most one local saved-receipt GET, never another write. `outcome_unknown`, missing receipts or an execution marker without outcome require explicit operator reconciliation under the existing lock rules. Do not automatically regenerate/reapprove/retry or unlock. WordPress itself does not provide an atomic cross-client compare-and-swap here: a third party can edit between our GET precondition and POST. This existing limitation remains disclosed.

### Restoration

After confirmed stored success, **Prepare restoration** reads the same media afresh and requires both the approved changed alt value and the recorded post-write modification timestamp. It also rejects replaced media/page identities. A different value/timestamp blocks reversal even when an intervening editor restored the same string. It creates a separate proposal with `restorationOf`, new hash/expiry and exact original alt value; no model call or automatic rollback occurs. The user must separately review/approve/apply that reversal, then explicitly verify it. Original and restoration proposals/start/outcome/verification records remain immutable. Historical receipts without a trustworthy stored timestamp cannot be automatically restored through this adapter.

## Guzman readiness — no eligible target established

- Binding: `demo-guzman`, `https://guzmantaxaccounting.com`.
- Saved WordPress report: `12897672-5152-4f1c-b727-b72cd3cdfe9c`, October31 UTC,20 media items. For example media5659 (`carta del irs`) has saved alt `""`; this is **a candidate for inspection only**, not an approved or eligible target. Its title does not prove the pixels or purpose.
- Saved Website report: `43a66038-2184-4f72-b242-8381102b651d`; image-review finding `d008461d-bf52-4ce4-bc8a-94f2469effac`; evidence `2c5a5959-45bf-4c0b-9a09-db1cc524badc`; source page `https://www.guzmantaxaccounting.com/`.
- The WordPress sample does not retain file `source_url`, exact page-placement bindings or per-item write permission. The homepage empty-alt entries use data-URI lazy placeholders. There is no proven match to media5659 or the other sampled IDs and no operator-confirmed image purpose/content.
- Current live alt: **not re-read** during this task. Proposed replacement: **none**. Actual edit eligibility: **not established**. No fabricated replacement or filename-based mapping was produced.

Safest next step, only after authorization for the read/inspection: identify one actual informative image and its exact media/page IDs, confirm pixels/purpose with the owner, obtain fresh image-source evidence (the current collector's placeholder-only record may need a separately reviewed lazy-source improvement), validate edit permission/before-state, and enroll that exact context. Prepare and review the proposal/hash/expiry. A real Muse request needs independent exact paid approval; a WordPress update needs separate explicit exact-change approval and a deliberately enabled write gate. No gate is enabled by this task.

## Offline verification and browser blocker

Final full backend check: **70 suites, 1,468 passing tests, one existing skip**, typecheck, lint and production build. After the last route/session/saved-generation changes, the focused workflow/OpenAPI run passed **72 tests** and typecheck/lint/build again. Frontend: **36 service/mapping tests** plus opportunity assertions, lint, TypeScript and production build passed. The final HTTP repeat saved proposal `97a997ca-742d-45c6-971e-d7f132625d53` and separately approved restoration `756ed540-9b89-4981-89e0-9dd623bcce23`, both `public_verified` in the disposable fixture. Protected `.env`, application/spending SQLite files and captured sidecars remained byte-unchanged; no production ledger operation or live provider call occurred.

The controlled backend tests cover exact ownership/source/page matching, informative/decorative/unknown content, unsupported output, edited proposals, expired/changed hashes and remote state, writes-off/unauthorized requests, double/concurrent approval, uncertain network/wrong-resource writes, public/stored mismatches, identity replacement, restoration conflicts, SQLite restart/corruption, cookie/CSRF/Origin/Host/rotation/expiry, mock/live isolation and the real provider/ledger pipeline with disposable approval and mock transport. Existing historical assessment/provider/WordPress suites remain in the full backend check.

Frontend service tests cover backend capability, omitted mappings/manual recommendations, one-use fragment removal, preference forwarding, mock provenance, exact edited proposals, incompatible responses, no Apply retries, separate saved reads and restoration/verification requests. Existing mapping/opportunity checks still pass.

Actual frontend service → Vite proxy → protected Nest routes → mocked WordPress execution passed: edited proposal → one mocked update → stored/public success → separately prepared/approved restoration → one mocked restoration → stored/public success and independent receipt read. Both operations use the actual existing WordPress execution infrastructure, not a UI success simulation. Zero model requests, two mocked WordPress writes, no protected database opened by the fixture. Receipts are in ignored `reports/fix-workflow-http-result.json` and the reviewed final repeat artifact. They are not live Guzman results.

Visual verification **did not complete** at either desktop or mobile width. The existing CDP smoke timed out at `Page.enable`; native Computer Use then stopped because it could not establish Chrome's current URL confidently enough for its policy. No further UI automation was attempted or bypass used. Existing responsive modal classes were retained, and lint/typecheck/build pass, but that is not visual signoff.

To reproduce offline HTTP/browser checks later, from separate shells:

```powershell
# server/ — ignores .env, uses temporary SQLite and mocked transports only
npm run build
node scripts/serve-fix-workflow-fixture.mjs --offline-confirmed
# client/
$env:BACKEND_LAB_API_TARGET='http://127.0.0.1:3187'
npm run dev -- --host localhost --port 5187 --strictPort
# client/ — actual service/proxy/API seam, not a browser visual test
node scripts/verify-wordpress-fix-http.mjs --offline-fixture-confirmed --out=../server/reports/NEW-reviewed-output.json
```

The browser fixture is `http://localhost:5187/scripts/fixtures/fix-workflow.html`. It imports the actual component/service and establishes only a disposable fixture session. It is a test entry, absent from the production Vite build. No live credentials/accounts are connected. Restart the fixture for a fresh original-alt state. Preserve earlier artifacts; output files are exclusive-create.

## Changed files

New server files: `src/modules/wordpress/wordpress-fix.types.ts`, `wordpress-fix.store.ts`, `wordpress-fix.service.ts`, `wordpress-fix.controller.ts`, `wordpress-fix-session.ts`; `scripts/wordpress-browser-session.mjs`, `scripts/serve-fix-workflow-fixture.mjs`; `tests/wordpress-fix-workflow.spec.ts`; this document.

Modified server files: `src/modules/wordpress/wordpress.service.ts`, `wordpress.module.ts`; `tests/api.spec.ts`; `README.md`, `PLAN.md`, `MUSE_PROVIDER.md`, `WORDPRESS_MODULE.md`, `DATABASE.md`.

New frontend files: `src/services/wordpressFix.ts`; `scripts/wordpress-fix.test.mjs`, `scripts/verify-wordpress-fix-http.mjs`, `scripts/fixtures/fix-workflow.html`, `scripts/fixtures/fix-workflow.tsx`.

Modified frontend files: `src/components/recommendations/FixWithAIButton.tsx`, `FixReviewDialog.tsx`; `src/components/dashboard/DashboardAssessment.tsx`; `src/components/website/WebsiteFindings.tsx`; `src/pages/Website/Website.tsx`; `src/services/dashboardAssessment.ts`; `src/main.tsx`; `DASHBOARD_API_MAPPING.md`.

Ignored local reports hold the checkpoint manifest, test logs, before/after protected-file fingerprints, saved-data survey, and mock HTTP receipts. None belongs in either commit. The implementation commit includes only the feature files/tests/documentation listed here. No source report, historical analysis, scoring policy, WordPress permission configuration, environment value, budget/counter or protected ledger was altered.
