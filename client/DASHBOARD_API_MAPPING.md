# Dashboard saved-report integration

The Dashboard uses the existing saved Website and Facebook readers for the `businessId` query parameter, defaulting to the same registered demonstration ID as the channel pages. It imports no mock scores, identities, connections, findings or recommendations; the fixture ID is only a default lookup key. No backend changes or new provider calls are required to view it.

`src/hooks/useDashboardReports.ts` composes `useWebsiteReport` and `useFacebookReport`. They enforce the same business/audit checks and keep previous usable reports after read failures. Website reads poll every 15 seconds (2.5 seconds during active work). Facebook reads refresh every 15 seconds and on window focus. Changes in the existing investigation's ID/status refresh both readers. Business changes abort previous reads and clear data from the old business. Run Investigation starts both a mobile Lighthouse audit and a Facebook report for the saved Page. Each channel completes independently; failure or reconnection requirements in one channel do not discard the other channel's results. Facebook uses the existing browser connection, and errors appear in the existing notice area. No saved Page means Facebook cannot run until connected and initially selected through the local connection workflow.

Dashboard and Social Media share `useFacebookReportRun`, which polls the browser-session-scoped `GET /api/facebook/reports/status?businessId=...` endpoint every 2.5 seconds during active collection and every 15 seconds otherwise. Progress is recovered after navigation/reload, and terminal outcomes refresh saved data. Polling never starts collection or contacts Meta. Progress is in memory and does not survive backend restart; archived reports remain available. Website/Social Media Run Report buttons still run only their own channel. The Dashboard button remains busy while either channel is running. The existing layout, controls and styles are unchanged.

`src/services/dashboardMapping.ts` adapts the independently dated channel reports into the existing Dashboard slots:

| Existing slot | Source / limitations |
| --- | --- |
| Business identity | Registered dashboard business, with saved-report identity fallback |
| Connected assets and counts | Registered website supported by a saved Website report or live backend connection; Facebook identity from a saved usable Facebook report. Green Connected indicators are explicitly approved by the user as evidence of the established connection; this is not a new OAuth validity probe. Demo connections are excluded. |
| Website Health gauges and counters | The same `mapWebsiteReport` values as the Website page, including null/zero distinctions and referenced binary pass counts. No report means unavailable counts, not zero issues. |
| Main Spy Score / three component scores | Unavailable. Lighthouse SEO never substitutes for an SEO Spy combined score. No browser scoring is performed. |
| Priority opportunities | Number of Critical/Medium findings across the usable channel reports; unavailable when neither report exists |
| Business Consistency | All four existing rows remain; neutral labels/indicators and unavailable comparison values. No cross-channel comparison or consistency scoring is implemented by the backend. |
| Social followers | Available `followers_count` profile value, including zero |
| Social interactions — 30 days | Available additive `page_post_engagements.total` only when the saved report requested 30 days. Caption clarifies that returned periods may be incomplete. |
| Reach / engagement rate | Unavailable. Views are never substituted for unique reach; no engagement rate is invented. |
| Likes / Comments / Shares | Unavailable because these breakdowns are not collected. Existing numeric slots show an em dash to preserve the layout. |
| Priority Findings | Up to three backend findings sorted Critical, Medium, Low across both channels, preserving source and review status |
| Top Recommendations | Up to three evidence-linked backend recommendations, ordered by finding severity, with the actual recommended change in the existing description slot. Unmatched recommendations are excluded. |

Existing captions carry dates, homepage/sample limitations, partial coverage, failed newer attempts and read errors. Empty results are not advertised as a clean audit. Sections, metric labels, controls, layout, styles, ordering and navigation are preserved. The user approved replacing mock captions, reusing unavailable score treatments and neutralizing the unsupported consistency comparisons, with the explicit exception that connected asset checks remain green.

Verification from `client/`:

- `npm run lint`
- `npm run build`
- `npm run test:dashboard`: offline mapping tests and local Chrome fixture tests for both channels, source ownership, unavailable/zero values, evidence-safe text, connected assets, failed attempts, refresh recovery, investigation completion and responsive layout. No Meta/Google calls.
- `npm run test:website`: regression coverage for shared website rendering.

The older backend-lab smoke test still checks its isolated workflow and optional investigation lifecycle fixture; its fixture has no saved archives. `npm run test:dashboard` now targets the actual integrated Dashboard contract.
