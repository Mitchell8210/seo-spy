# Website page and backend API mapping

The /website page now reads saved live Website reports. Its existing sections, controls, metric labels, styles and layout are preserved. The approved mock/sample captions describe the actual saved audit and unavailable states. Other mock pages retain their original captions.

## Implemented integration

- Public API client: src/services/backendApi.ts; archive response types: src/types/websiteApi.ts.
- Read lifecycle: src/hooks/useWebsiteReport.ts. It reads the dashboard for registered identity/active progress, lists saved reports, and downloads the newest completed or partial live homepage/Lighthouse report plus its backend evidence summaries. Demo and Facebook archives are excluded. Reads use the audit ID and fixed local API routes, never archive-supplied URLs.
- View adapter: src/services/websiteMapping.ts. Browser modules do not import backend implementation code.
- Business selection uses the businessId query parameter, defaulting to the existing demo business ID. Identity and website URL come from the API, not mock website content. There is one registered site per business; the API has no multi-site registration/list endpoint.
- The reader checks business/audit identity and evidence ownership/references before publishing a report. Status and report replace the previous view together. A newer failed attempt or a refresh failure keeps prior usable results visible.
- The page reads archives after backend restarts; it does not rely on the dashboard retaining an in-memory completed audit. A saved report badge describes saved data, not current website connectivity.
- Reads refresh every 2.5 seconds while the dashboard has an active audit, otherwise every 15 seconds, when the window regains focus, and when the Website investigation changes status. In-flight requests abort on business change/unmount. Page viewing only issues GET requests.
- The approved Run Report button sits to the right of the website selector on wider screens and stacks beneath it on small screens. It reuses the Dashboard investigation hook to start a mobile Lighthouse audit for the selected business (`POST /api/businesses/:businessId/audits`, `{scope: 'lighthouse', strategy: 'mobile'}`). This includes homepage HTML collection. Submission and active-audit states prevent duplicate runs; the existing notice area displays progress and errors. Previous usable results remain visible until a new saved report is loaded. After a status/submission error, the same button recovers status before starting another run, avoiding duplicates after ambiguous responses. No other presentation changes were introduced.

## Existing data slots

| Slot | Real source and semantics |
| --- | --- |
| Selected website | Registered business ID, URL and hostname; saved-report status when archive data is shown |
| Analyzed time | audit.completedAt, with generatedAt fallback; original timestamp formatted in the existing Pacific timezone |
| Four category cards | Lighthouse performance, accessibility, best-practices and seo category scores; existing label capitalization preserved |
| SEO Spy Website Score | Unavailable; no frontend averaging or substitution of Lighthouse SEO |
| Issues requiring attention | Number of website-source findings actually displayed |
| Checks passed / Great Condition | Distinct category-referenced binary Lighthouse checks with score 1; numeric, manual, skipped, informative and error checks are excluded |
| Finding severity/title/explanation | Backend values, mapped to the existing severity labels |
| Finding category | Explicit HTML check-ID mapping or Lighthouse category membership; unknown IDs preserved instead of guessing from titles |
| Evidence | Concise backend-generated summary text plus a compact source/time caption; raw observations and IDs remain in the saved report, and collected HTML is never injected |
| Affected pages | All distinct evidence source URLs associated with a finding; no fictional services/contact pages |
| Recommended fix | recommendedChange joined by findingId |

Measured zero remains zero. Null and missing category scores use the existing unavailable gauge treatment. HTML-only results have unavailable category scores and passed-check totals, because observations alone do not prove passed checks. The archive retains complete evidence and Lighthouse provenance. Existing evidence slots identify HTML collection versus Lighthouse device/version/time. Coverage, partial status, warnings, active progress, failed newer attempts and read errors use the existing captions/status area.

Fix Now still opens a disclosure. View Fix Steps shows suggestions; Review Manually only acknowledges selection in this view. Fix with AI remains disabled. There are no approval/execution/verification API writes. A passing Lighthouse check is not a verified remediation.

Evidence summaries come from `GET /api/audits/:auditId/evidence-summary` as `{version,auditId,findings,checks}`. Items contain `{id,evidenceIds,text,sourceLabel}`. The backend persists `programmatic-evidence-v1` summaries on new Website reports and derives the same display data from older archives without rewriting them. The hook validates summary version, audit identity and references before replacing the view. The adapter displays returned text directly; it has no finding-specific summary templates and does not fall back to raw JSON. Missing summaries use the existing unavailable treatment. AI summaries and weighted scoring remain future backend work.

Priority and recommendation data come from `GET /api/audits/:auditId/website-analysis`, versioned `website-priority-v1`. The hook validates the audit, finding/recommendation IDs and evidence associations before overlaying analysis onto the saved report. Existing columns and controls render these updated data values; no priority rules run in the browser. New reports persist this analysis, while legacy archives remain unchanged. See ../server/WEBSITE_PRIORITY_RULES.md for numeric boundaries, diagnostic rules and limitations. Analysis read failures retain previous usable results.

## Verification

From client/:

- npm run lint
- npm run build
- npm run test:website: offline adapter tests and Chrome browser checks against a controlled local API. No provider calls or credentials. Chrome path can be supplied with CHROME_PATH.
- npm run test:website:saved: optional read-only browser check against an already running backend and an existing saved live Website report. Defaults to http://127.0.0.1:3001; override with WEBSITE_API_TARGET. It does not create an audit or consume provider credits.

Browser screenshots are written under ignored node_modules/.cache/website-smoke/ directories. Coverage includes unavailable/zero scores, binary pass semantics, evidence and review controls, safe text rendering, older usable results after failures, active progress, refresh recovery, partial HTML-only results, identity rejection, demo/social exclusion and mobile overflow.
