# Website page and backend API mapping

This is a handoff for a later integration task. The `/website` page and its components remain unchanged and still consume `mockWebsiteAudits`. The separate `/backend-lab` page is the working API reference. This document describes the current contract first, then proposes decisions to agree with the frontend engineer.

## Current sources

- Page and view models: `src/pages/Website/Website.tsx`, `src/types/website.ts`, and `src/types/dashboard.ts`.
- Current presentation: `WebsiteSelector`, `WebsiteHealth`, `ScoreCard`, and the `WebsiteFindings` priority board. `PageIssues` and `PassedChecks` exist but are not currently rendered by `Website.tsx`.
- Mock data: `src/data/mockWebsiteAudits.ts` and `src/data/mockResults.ts`. The selector currently has one mock website, while the mock audit includes fictional homepage, services, and contact-page findings. The array-based model can represent more sites; this is not evidence that multiple sites/pages have been audited.
- Implemented API definitions: `../server/src/contracts/domain.ts`, `../server/src/contracts/responses.dto.ts`, and `../server/src/contracts/lighthouse.dto.ts`. Swagger is available at `/api/docs` and `/api/docs-json` on the backend.
- Working browser client: `src/pages/BackendLab/types.ts`, `api.ts`, and `useBackendLab.ts`. Browser code must not import backend implementation modules.

## API reads and job lifecycle

| Operation | Implemented route | Consumer purpose |
| --- | --- | --- |
| Load business/latest usable result/active job | `GET /api/businesses/:businessId/dashboard` | Initial page data and refresh recovery |
| Start HTML investigation | `POST /api/businesses/:businessId/audits` with `{"scope":"homepage"}` | Evidence-backed HTML findings; no Lighthouse report |
| Start HTML plus Lighthouse | Same POST with `{"scope":"lighthouse","strategy":"mobile"}` | Mobile lab measurement; `desktop` is also supported |
| Poll job | `GET /api/audits/:auditId` | `status`, `stage`, dates, warnings, failure, counts |
| Load findings and all evidence | `GET /api/audits/:auditId/findings` | Findings plus observations, including observations without findings |
| Load recommendations | `GET /api/audits/:auditId/recommendations` | Suggestions linked by `findingId` |
| Load normalized Lighthouse report | `GET /api/audits/:auditId/lighthouse` | Nullable report, status, failure, warnings |

Creation returns `202 Accepted`, an audit ID, and a relative `statusUrl` immediately. The target website comes from the registered business record, not a user-provided URL. One queued/running audit per business is allowed; `409 AUDIT_ALREADY_ACTIVE` means resume the existing job rather than submit another.

The lab polls sequentially every 2.5 seconds. Stop on all three terminal statuses: `completed`, `partial`, and `failed`. Retain the prior usable report while a new job runs. Publish a terminal report and its status together after its endpoints load, so a new partial-result label does not briefly accompany old scores. After a lost creation response, reconcile the dashboard: the job may be active or may already have completed.

PageSpeed failure preserves HTML findings as a terminal `partial` audit with `failure` and warnings. Some unavailable Lighthouse category scores can also produce partial completion while the other measured scores remain usable. A collection failure produces a failed audit; the dashboard retains the previous usable result. Keep the failed attempt's status distinct from the report being displayed. Backend restarts clear in-memory jobs and history; browser reload can resume work only while that backend process still has it.

## Field-by-field mapping

| Website view-model field | Current API support | Integration treatment |
| --- | --- | --- |
| `ConnectedWebsite.id` / audit `websiteId` | Business ID and website connection IDs are returned, but audit ownership is `businessId`; no independent website-audit CRUD API exists. | Choose one stable business/asset mapping in the adapter. Do not send the mock connection ID as `businessId`. |
| `ConnectedWebsite.url` / `domain` | `dashboard.business.website`; website connection `identity` may contain the fetched final URL. | Derive a display hostname from the registered URL. Preserve requested/final URLs separately in evidence. |
| `ConnectedWebsite.status: 'Connected'` | Connection status is `connected`, `disconnected`, `authorization_required`, `checking`, or `error`, with separate demo/live mode. | Current frontend type is too narrow. Support the returned states without calling every asset connected. |
| `WebsiteAudit.id` | `latestAudit.id` or the selected per-audit ID. | Use generated audit IDs, not fixture IDs. |
| `analyzedAt` | Audit `completedAt`; Lighthouse `fetchedAt`; each evidence record `collectedAt`. | Use completion time for the audit label and retain collection/measurement times for provenance. Do not replace dates with the browser's current time. |
| `results.categories` | Four normalized Lighthouse categories: `performance`, `accessibility`, `best-practices`, `seo`. Each has `title`, `score`, `availability`, and `auditIds`. | Map title to label and measured score to value. Preserve unavailable/null state and provider/device/version metadata. |
| `results.overall` | Original backend score array has website/social/consistency/overall entries, but real values remain null and unavailable. | Current required numeric `Score.value` cannot represent this. Show unavailable or hide the aggregate card until a backend scoring rule exists. |
| `results.issues` | `findings.length` and audit `counts.findings`. | Derive the displayed count from that audit's records and the chosen filter. If counting website-only findings, label the filter and use the same set in the board. |
| `results.checksPassed` | No backend aggregate pass count is supplied. Lighthouse check outcomes are available; HTML evidence does not expose explicit per-check pass status. | Do not carry over mock `34`, subtract findings from an assumed total, or count evidence records as checks. Agree on the pass-count semantics first. |
| Finding `id`, `title`, `explanation` | Direct fields on each backend finding. | Preserve IDs and text. Render provider/site strings as text; descriptions may contain Markdown. |
| Finding `severity` | `critical`, `medium`, `low`. Current real HTML/Lighthouse review rules emit `low`. | Capitalize to the existing UI labels. Do not invent urgency or populate empty columns with mock issues. |
| Finding `source` / `status` | `website` or `website_and_facebook`; status is currently `needs_review`. | Map to readable labels. The Website view type forces `Website`; either extend it for cross-channel records or explicitly filter them with coverage explained. |
| Finding `category` | No `WebsiteCategory` field is returned. HTML findings have `checkId`; Lighthouse findings have namespaced IDs such as `lighthouse:image-alt`. Lighthouse category `auditIds` reference its checks. | An explicit adapter taxonomy is needed. It must retain the original check ID and allow unknown/multiple categories; do not guess from a title. |
| Finding `evidence: string` | `evidenceIds` references separate evidence records containing `sourceUrl`, `collectedAt`, `mode`, `checkId`, and `observed`. | A text summary can serve the existing card, but retain all references and expose details. `observed` values are strings; list observations are JSON-encoded strings. |
| Finding `pageId` | No page entity or `pageId` is returned. | Derive a report-local page association from referenced evidence URLs if required. Avoid manufacturing services/contact-page findings. |
| `AffectedPage.url` / `findingIds` | Can be derived from finding-to-evidence links and distinct `sourceUrl` values. | Group observations by actual evidence URL. A single finding may reference more than one URL; use the existing `findingIds` association or expand the view type rather than discard links. |
| `PassedCheck` | Normalized Lighthouse checks contain ID/title/description/score/display mode; they have no independent verification status. | Introduce a clear measured-check mapping, as described below. Do not call a successful lab check a verified applied fix. |
| `WebsiteRecommendation.action` | Backend `recommendedChange`, linked through the same `findingId`. | Map the action text; retain backend `title`, `explanation`, `purpose`, and review status where the UI can show them. |

## Scores, metrics, and coverage

The mock card category IDs already match the four Lighthouse category IDs, but their numeric values are fixtures. Real Lighthouse category scores are normalized to 0-100 by the backend. A real zero is a measured value; null means unavailable. The separate backend `scores` array is not a substitute for the Lighthouse report. Do not average categories in the browser, relabel Lighthouse SEO as the combined SEO Spy Website Score, or treat Lighthouse best-practices as a consistency/social score.

`Score` in `src/types/dashboard.ts` requires `value: number`; `ScoreCard` and `WebsiteHealth` assume it can always display a number. A later integration must add a nullable measured-score view model or deliberately broaden those shared types/components with the frontend engineer. Passing zero in place of null would create a false result. Mode/provenance also needs to be passed to currently hard-coded mock labels instead of globally removing them from pages that still use fixtures.

The Lighthouse report additionally provides:

| Metric ID | Unit | Meaning in this API |
| --- | --- | --- |
| `first-contentful-paint` | `ms` | Lighthouse lab FCP |
| `largest-contentful-paint` | `ms` | Lighthouse lab LCP |
| `total-blocking-time` | `ms` | Lighthouse lab TBT |
| `speed-index` | `ms` | Lighthouse lab Speed Index |
| `cumulative-layout-shift` | `unitless` | Lighthouse lab CLS |

Each metric has nullable `value` and `displayValue`. Retain units when formatting and show unavailable rather than a fabricated measurement. Label results mobile/desktop lab measurements with `provider`, `lighthouseVersion`, `fetchedAt`, and report URL provenance. These measurements do not establish field Core Web Vitals, complete accessibility compliance, actual search-engine rankings, or social performance.

Coverage is the registered homepage HTML response plus a remote Lighthouse navigation when requested. The backend does not crawl the mock services/contact URLs or return a page inventory, a crawl budget result, site-wide broken-link count, sitemap discovery result, or independent robots.txt collection result. Redirected homepage URLs and a different Lighthouse final URL are provenance, not proof of a multi-page crawl. A provider check such as `robots-txt` can appear in Lighthouse results, but do not attach the fictional mock `/robots.txt` or `/sitemap.xml` evidence to it.

## Passed, skipped, manual, and failed checks

The backend stores every normalized Lighthouse check's `scoreDisplayMode` and nullable score. It currently creates review findings only for category-referenced `binary`/`numeric` checks with a non-null score below 1. Category `auditIds` identify which checks belong to a category. One check may belong to multiple categories; count it once when presenting a distinct-check total.

For a future Great Condition column:

- A category-referenced `binary` check with score 1 can be shown as a passing Lighthouse check with its report URL, title, description, device, engine version, and fetch time. The existing `Passed` label is suitable once provenance is explicit.
- A numeric score of 1 means full score on that measured Lighthouse check; agree whether such graded measurements belong in the same column or a separate metrics section. Do not silently mix graded metrics with binary pass totals.
- Keep `manual`, `notApplicable`, `informative`, and `error` outcomes distinct. None is proof of a pass, and a null score must not become zero. Unknown future display modes need an explicit fallback.
- Do not infer HTML passes from an empty findings array. HTML evidence includes collection metadata and observations, not a complete structured outcome inventory. If authoritative HTML pass badges/counts are required, add versioned check outcomes on the backend in a later task.
- Reserve `Verified` for a defined verification process using fresh evidence after an approved change. A Lighthouse run or a local manual-review click does not verify remediation.

`WebsiteFindings` declares a `passedTotal` prop but currently does not use it; its column counts come from the supplied board items. `PassedChecks`, if reintroduced, currently describes examples from a mock aggregate. Decide whether the future UI lists every eligible passing check or a subset, and label its total accordingly.

## Recommendations and controls

Current backend recommendations support review only. No API approves, edits, rejects, executes, or verifies external changes. `Fix with AI` must remain unavailable. `Fix Now` currently opens a disclosure; clarify that it reveals suggestions rather than applying a fix. `View Fix Steps` can display the backend's `recommendedChange`; local `Review Manually` feedback must remain explicitly local and must not become a persisted backend approval or a `Verified` status.

The evidence text and measured outcomes should drive the actual recommendations. Do not reuse the mock assumptions that empty alt text always represents informative images, that a canonical difference is necessarily wrong, or that a service-page link was tested. Current backend findings deliberately request contextual review for empty alternatives and canonical differences.

## Proposed integration sequence and decisions

1. Agree on one business/website identity mapping for the initial single-business demo. Keep the adapter parameterized by business ID; the current API has no business-list or multi-site registration endpoint.
2. Extract or promote the lab's public API client/types and polling hook into shared frontend service/hook locations in a dedicated integration change. Keep the lab operational while moving imports; avoid two diverging implementations of timeout, cancellation, duplicate reconciliation, and atomic report hydration.
3. Create a Website page view-model adapter. Preserve audit IDs, evidence links, dates, mode, warnings, and partial/failure state. Decide the category taxonomy and multi-URL association explicitly instead of embedding conditionals in card JSX.
4. Agree on unavailable score presentation and the aggregate-card policy. Update shared score components only with a coordinated change that preserves other mock consumers. Display measured category scores separately from undefined combined scores.
5. Agree on the eligible passed-check list/count and whether structured HTML outcome records are needed. Exclude manual/skipped/error states and do not promise remediation verification.
6. Add real loading/empty/error/partial/progress states to `/website`. Replace mock wording only when showing live records, retain old results during work, and offer retry/recovery without automatically repeating a creation request.
7. Coordinate which existing mock-specific strings become component props, including WebsiteHealth quality labels, Website page disclaimers/timestamps, board evidence notes, review controls, and PassedChecks coverage text. Keep external write controls disabled.
8. Test the adapter and page with seeded demo, HTML-only completion, full Lighthouse completion, measured zero/null scores, provider quota failure, collection failure, stale/lost requests, reload/unmount, and per-audit identity checks. Then explicitly run a live smoke test; normal checks should not consume Google quota.

No page integration, new backend capability, or score calculation is implemented by this document. The next code change should be scoped with the frontend engineer using these decisions, while `/backend-lab` remains the reference for the working API workflow.
