# Dashboard saved-report integration

## Approved Social scoring breakdown v1.4 - November 1, 2026

The user explicitly requested category scores, evidence coverage, freshness, missing metrics and actionable recommendations on the Dashboard. The existing Social Media Performance card now includes a compact backend-supplied breakdown with six weighted category rows (15/20/25/15/15/10), evidence/explanation disclosures, dated freshness, missing metrics and category recommendations. Existing category headers, gauges, findings, report links and surrounding layout retain their presentation. No action/edit controls were added.

`assessment.socialAssessment` is separately typed and validated for `social-performance-v1`, v1.4 policy, business/Page identity and the displayed Facebook report. Available criterion citations must resolve to that report's actual saved evidence. The client neither scores criteria nor derives missing values. Backend `earned` category points and independently recorded `evidencedWeight` are displayed without normalizing incomplete categories in the browser. Verified zero remains zero; unknown points remain Not available.

Only a fresh `definitive` Social result can populate the existing Social and Spy Total gauges. A `provisional` value appears explicitly labeled in the breakdown and cannot silently contribute to the overall score. Insufficient or stale evidence has no numeric headline. The client defensively suppresses expired breakdown scores using the backend read timestamp/expiry; it never refreshes a provider or requests AI to fill a gap. Historical v1-v1.3 assessments retain their existing rendering without a fabricated breakdown.

Offline verification: `node --test scripts/social-score-details.test.mjs scripts/dashboard-assessment.test.mjs scripts/saved-score.test.mjs` exercises complete/provisional/stale/missing values, exact source/citation matching, legacy rendering and safe component text rendering. The component render test is local server rendering, not an authenticated browser/provider test.

## Overall investigation refresh - November 1, 2026

The existing Dashboard Run Investigation control now starts one explicit overall job through `POST /api/facebook/investigations` with only the selected `businessId`. The server selects and authorizes the saved Facebook Page, refreshes Facebook and the website, and publishes a deterministic assessment pinned to both newly saved report IDs. No provider credential or operator key enters client code. The Website page retains its separate website-only audit action.

`useOverallInvestigation` reads the session-scoped `/api/facebook/investigations/status?businessId=...` contract for recovery and progress. The existing status slots stay running until the overall job settles; a completed website audit alone does not complete this job. Failed starts, lost responses and Retry status check reconcile by GET without resubmitting provider work. Reload can recover a retained session job; unavailable jobs after restart stop polling, and an explicit status retry can clear missing progress without restarting collection. Saved reports remain visible through the existing readers.

The backend's `seo-spy-score-v1.3` assessment is accepted in existing score slots with the same business, policy-shape, eligibility and exact displayed-report matching guards. Reusable confirmations are a backend responsibility; the client does not carry approvals, infer hours or calculate scores. No labels, static copy, styles, cards, controls or responsive rules changed.

Offline lifecycle verification: `node --test scripts/overall-investigation.test.mjs scripts/saved-score.test.mjs scripts/dashboard-assessment.test.mjs scripts/dashboard-mapping.test.mjs`. Existing browser fixtures now serve the overall start/status contract for Dashboard and preserve website-only creation for Website/backend-lab tests.

## Approved scoring and saved interpretation

The dashboard now accepts the backend's optional `assessment` read model from its existing business response. `seo-spy-score-v1` supplies eligible numeric values only when the policy/business and pinned report IDs match the currently displayed reports. Zero remains valid. Missing, stale, incompatible or unavailable inputs retain the existing unavailable gauges; Lighthouse SEO is never substituted directly for the weighted Website or overall score. Existing source captions identify policy/profile/cutoff. Native Lighthouse category gauges on the Website page are unchanged.

The same saved assessment may carry a separately persisted interpretation. Recommendations replace only matching report/finding/evidence-linked prose; mock interpretations are explicitly prefixed `Mock AI recommendation`. Values, weights and scores never come from model prose. No generation or action request happens during page loads, polling, previews or renders. Backend generation remains an explicit operator-only mocked POST.

Business consistency keeps the same four rows and uses backend observed comparison values/outcomes only when both pinned sources match. No new sections, fields, labels, controls or styling are introduced.

The user explicitly deferred the compact action-review panel proposal. Its exact suggested fields/controls and required operator browser connection are recorded in [the backend plan](../server/PLAN.md) and [approved scoring/workflow runbook](../server/SCORING_POLICY.md); revisit with specific UI approval later. Fix with AI remains a read-only saved-recommendation preview.

Actual saved-data verification produced Website **80/100** from policy-weighted Lighthouse categories and displayed it in the existing gauge, with a labeled mock interpretation. Social/Consistency/Overall remain unavailable for explicit missing evidence/confirmation reasons. See the backend runbook for snapshot IDs, formula and validation scope. The historical integration notes below describe the original wiring; the policy-backed fields in this section supersede their former blanket unavailable-score behavior.

The current Dashboard assessment layout reads saved Website and Facebook results. Its `businessId` query parameter selects the registered business; the demonstration ID is only the default lookup key. Business identity, connections, findings and recommendations do not fall back to mock data.

`useDashboardAssessment` composes `useDashboardReports`, `useWebsiteReport` and `useFacebookReport`. The existing readers validate business/audit ownership, exclude demo audits and retain usable results after refresh failures. Website reads refresh every 15 seconds, or 2.5 seconds during active work; Facebook saved reads refresh every 15 seconds and on focus. Investigation status changes refresh saved reports. Switching businesses aborts old reads and clears the old view.

`dashboardAssessment.ts` maps backend evidence into the existing assessment model. It preserves backend priorities, statuses, evidence summaries and linked recommendations. Each category shows its top three active issues. More Opportunities contains the remaining issues, and Recommended Path contains only their existing active recommendations. Resolved, verified and passed items are excluded; no extra findings or actions are invented. Existing report/opportunity links retain the selected business.

| Existing slot | Source and limitations |
| --- | --- |
| Business identity | Registered backend business, with saved-report identity fallback; missing identity is Not available |
| Connected asset counts | Live registered website connection or saved Website evidence; saved Facebook Page identity. Saved evidence does not prove current OAuth validity |
| Spy Total Score and component gauges | Existing unavailable treatment. No combined, Website SEO Spy, social or consistency scoring policy is implemented; Lighthouse and traffic metrics are never substituted |
| Website Health issues | Saved Website findings with backend priority and evidence summaries; collection date, homepage/partial coverage, failed newer attempts and read errors appear in the existing source caption |
| Social Media Performance issues | Saved Facebook analysis/findings with original collection date and partial/failed-refresh limitations |
| Business Consistency | All four existing rows remain with unavailable values and comparison status; no mock differences or browser comparison/scoring |
| More Opportunities / Recommended Path | Remaining evidence-backed Website/Facebook findings and their linked suggested changes; existing category ordering/selection logic remains |
| Fix with AI | Existing feedback area previews the saved recommendation. It does not request AI, approve a proposal or apply an edit |
| Run Investigation | One explicit overall refresh: Facebook, mobile Lighthouse, then a pinned assessment. Viewing the Dashboard never starts collection |

The user approved replacing only existing demo/source captions, disclosure, empty-state messages and demo feedback with truthful saved-report/unavailable wording. Labels, cards, controls, icons, classes, layout, responsive rules and section order are preserved. Existing error/retry presentation handles read failures; old results keep their collection dates.

GA4 and Search Console backend endpoints are not called here: the current dashboard has no corresponding traffic/query fields, and Google operator/service-account credentials must not enter browser code. No Meta/Muse calls, model charges or WordPress writes are introduced. Scoring policy, cross-channel comparisons and approved AI execution remain separate tasks.

## Validation

From `client/`:

- `npm run lint` and `npm run build`.
- `npm run test:dashboard`: mapping/selection tests and local browser fixtures for real-source mapping, unchanged assessment/section structure, read-only previews, empty/unavailable results, stale retention, refresh recovery, business rejection, responsive overflow and investigation refresh/duplicate protection.
- `node scripts/website-smoke.mjs`: shared Website-reader regression coverage.
- `npm run test:settings`: Settings navigation and controls regression coverage.
- `node scripts/website-smoke.mjs --dashboard --saved`: explicit read-only check against a running local backend (`WEBSITE_API_TARGET`, default `http://127.0.0.1:3001`). It never creates an audit. Local-only screenshots live under ignored `node_modules/.cache/website-smoke/`.

The actual SQLite-backed Guzman Dashboard passed the saved-data browser check against audit `9961da8a-4575-4f6c-a2e7-53ed72441838`, with external backend requests blocked: zero external provider attempts, no model calls, no new audits or edits. Desktop and 320/390/768/1280-pixel widths passed. No backend source or credentials changed.

## Approved scoring v1.2 integration ? November 1, 2026

The existing score slots accept backend policy v1/v1.1/v1.2 only for the same displayed report IDs and business. New v1.2 Social values measure five profile-readiness checks, with posting activity advisory. Source-agreement comparisons populate the existing four detail rows without inventing authoritative names/hours. The policy provenance slot reads the actual saved version. No labels, styling, controls or layout changed.

Actual saved SQLite assessment f4222edc-0e4f-4fde-8bc7-2a6fe70e4adb displayed Website78 / Social100 / Consistency60 / Total81 in the existing gauges. Desktop and 320/390/768/1280 widths passed; all browser API requests were saved-data GETs, zero external backend attempts, and AI ledger files were unchanged. Earlier unavailable-score validation above describes the historical v1 data.


## Dashboard presentation follow-up ? November 1, 2026

The user requested removal of the new Social scoring breakdown from the Dashboard. The section and its component were removed. Scoring, evidence coverage, category ledgers and definitive-only gauge eligibility remain in the data/backend layer. Preserve the existing dashboard gauges and presentation; do not reintroduce calculation details without explicit approval.
