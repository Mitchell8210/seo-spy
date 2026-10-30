# Saved Facebook reports on Social Media

The `/social-media` page reads `GET /api/businesses/:businessId/facebook-report` through the existing Vite API proxy. It displays saved Facebook evidence and the backend's versioned analysis. Reading or refreshing this page does not call Meta, start collection, alter reports, or make Facebook changes.

The demonstration business defaults to the same ID used by the Overview page. To inspect another registered business, open `/social-media?businessId=your-business-id`. The response must match that business; analysis must match the displayed report's audit ID. A business change or unmount aborts the previous request.

The response contract is:

```ts
{
  businessId: string
  report: AuditReportRecord | null
  analysis: {
    version: 'facebook-analysis-v1'
    auditId: string
    summaries: string[]
    findings: Finding[]
    recommendations: Recommendation[]
    evidenceSummaries: {
      version: 'programmatic-evidence-v1'
      auditId: string
      findings: { id: string; evidenceIds: string[]; text: string; sourceLabel: string }[]
      checks: []
    }
  } | null
  latestAttempt: StoredReportSummary | null
}
```

The backend chooses the latest usable saved Facebook report and retains an older usable result when a newer attempt failed. The page maps saved data into its existing selected-account block, score hero, four health cards, and priority report. It does not add separate summary, coverage, profile, or post sections. Loading, API errors, no report, and partial coverage are handled in the page's existing visual style. Findings/recommendations come from the backend; the frontend does not calculate scores, infer social advice, or provide unsupported approval/apply controls. Saved evidence does not establish current connection status.

To connect Facebook, use the local backend tool at `http://localhost:3001/api/facebook`, then open the frontend at `http://localhost:5173` in the same browser. Do not open the OAuth tool through the frontend proxy. The frontend hostname must match the callback hostname so the browser sends the HttpOnly `/api/facebook` connection cookie.

The approved Run Report button beside the selected-account dropdown submits `{businessId, pageId}` to `POST /api/facebook/reports` through the same-origin Vite proxy. The backend permits only JSON requests with Host and Origin matching `FACEBOOK_FRONTEND_ORIGIN` (default `http://localhost:5173`) and the callback hostname. Configure that exact local origin for another frontend port. OAuth, connection diagnostics and disconnect remain backend-only; no broad CORS or credentials in browser code were added.

Report creation returns after bounded collection and durable archiving. The client allows 180 seconds for this request, prevents duplicate clicks, shows a running state, and reloads the saved report on completion. Existing results stay visible during collection and failures, including reconnect-required and failed-report responses. Viewing alone remains read-only; clicking Run Report performs fresh Meta reads using the existing authorized browser connection. The button stacks beneath the dropdown on small screens. No other components or presentation were changed.

Issue details use backend-generated evidence summaries (at most 280 characters) instead of raw observation keys, JSON, or post IDs. These describe missing profile fields, collected posting activity and differing contact numbers, retaining API/sample limitations. The existing explanation, impact, affected area and recommendation slots continue to use backend values. Summary audit/finding/evidence references are checked before publishing a response. Older APIs without summaries use the existing unavailable text; raw observations are never a fallback. The backend derives current summaries from old archives without rewriting them. No component structure, labels, styles or actions changed for this integration; suggestions remain programmatic and fixes require manual review.

Verification:

```powershell
npm run lint
npm run build
npm run test:social-media
```

The browser smoke test uses local HTTP fixtures and an isolated headless Chrome profile under ignored `node_modules/.cache/social-media-smoke/`. It loads no credentials and contacts no Meta APIs. It checks derived analysis/evidence rendering, zero versus unavailable metrics, the existing page sections without added summary/coverage panels, API errors, business mismatch rejection, empty/loaded states, inert provider text, mobile overflow, and GET-only API access. Desktop/mobile screenshots are saved with the run's artifacts. Set `CHROME_PATH` if Chrome isn't installed at a detected path.

Remote `main` was pulled through commit `9229270`. Saved data now maps into its existing selected-account block, `SocialScoreHero`, four `SocialHealthCard` instances, and `SocialMediaReport` priority columns. `socialMediaMapping.ts` adapts API records to these existing component contracts. Optional live-mode props replace mock notices and unsupported scores/benchmarks without creating an alternate report layout. Health tile titles and supporting labels match main exactly: Followers, People Reached, People Who Contacted You, and Interactions. People Reached remains unavailable because media views do not measure unique reach. Contact activity and uncollected reaction breakdowns remain unavailable; no passed checks are fabricated.

The remote App/Settings/navigation/Website files were preserved. The overlapping previous local router/page and superseded custom renderer were backed up under ignored `server/reports/integration-backups/main-9229270/` before integration. Overview and Website cards retain their existing integration/mock status.

Visual preservation review (2026-10-29): fetched `origin/main` and confirmed both main refs remain at `9229270467829dc49f0fe1dd8c1f3afc4ceaff25`. Reviewed every changed social component and its shared dependencies against that commit, and captured desktop (1440px) and mobile (390px) screenshots of both a clean main snapshot and the integrated page. Global CSS, app shell, navigation, common components, priority columns, and report disclosures have no changes against main. Card surfaces, borders, shadows, icons, typography, spacing, and responsive grid breakpoints remain in place. Necessary data differences include one saved Facebook account instead of mock account choices, unavailable metrics, neutral activity indicators, no fabricated passed checks, and no mock benchmark. The original graph illustration remains decorative and is hidden from assistive technology; it does not represent measured performance.

The review replaced the integration's custom missing-score circle with the existing `ScoreCard`, adding a null state that preserves the original gauge dimensions and styles without a colored performance indicator. Existing numeric scores render as before. The hero shows a short account-health message selected from the backend finding severities and report coverage, without calculating a score. The account dropdown opens when a saved account is available; the API currently supplies only one account per business. The later label review restored main's original supporting rows and removed the extra follower-change row. The period label uses main's "Last … days" wording with the requested day count. "Not collected" labels identify metrics the collector does not request, distinct from requested metrics with unavailable results. The unmeasured benchmark retains main's visual treatment with an unavailable value rather than an invented heading or comparison. Removed the unused `pages/SocialMedia/format.ts` helper left from the superseded renderer. No new UI components were added during the review.

Validation passed: `npm run lint`, `npm run build`, `npm run test:social-media`, and `git diff --check -- client`. Browser checks use fixture API responses; they do not validate provider availability or initiate live Facebook collection. Screenshot artifacts are under ignored `client/node_modules/.cache/` directories.

Follow-up: the People Reached tile retains its original title and shows Media views, Page views, and Video views. Unique people and the duplicate Shares row were removed at the user's request; Shares remains under Interactions. These preserve available report values without substituting view counts for unique reach. Activity arrows use the original up/down shapes, with muted styling for unavailable values; missing supporting values use smaller nonwrapping text.
