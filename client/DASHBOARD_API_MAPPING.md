# Dashboard saved-report integration

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
| Run Investigation | Preserved website-only behavior: one explicit mobile Lighthouse audit. Viewing the Dashboard never starts an audit or Facebook collection |

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
