# Dashboard investigation action

The `/dashboard` will eventually summarize cumulative evaluations across all connected websites and social accounts for a business. Its scoring algorithm is deliberately deferred. Do not average current Lighthouse scores in the browser or present them as the future Main Spy Score.

The first integration connects only **Run Investigation** and its status display. Existing score, consistency, social, finding, recommendation, and connected-asset cards remain illustrative fixtures; no live report data replaces those cards yet.

## Current behavior

- The displayed demo business ID is passed into `useInvestigation`. The hook is parameterized by business; it does not hard-code the demo URL or require a provider key in the frontend.
- On load, read the business dashboard summary to discover an active job. Resume polling existing work after browser reload. No investigation starts automatically.
- A click submits one `POST /api/businesses/:businessId/audits` with `{"scope":"lighthouse","strategy":"mobile"}`. The backend currently collects the registered homepage and requests Google PageSpeed Insights measurements; social and other investigation stages remain future backend capabilities.
- Poll `GET /api/audits/:auditId` every 2.5 seconds. Show queued/running stages and disable duplicate submissions.
- Stop polling on `completed`, `partial`, or `failed`, and show an appropriate report-generation status. Partial provider failures retain the backend's usable report; failure reasons are displayed without exposing provider credentials.
- Lost submission responses and `409` conflicts trigger read-only reconciliation rather than automatic resubmission. Status errors pause updates and offer a read-only retry before another investigation can start.
- Leaving the page stops frontend polling; the backend job continues. The lab can inspect the generated report. Backend restarts clear in-memory jobs; terminal report files survive.

The dashboard reads summary/status endpoints only. It does not request the per-audit findings, recommendations, or Lighthouse report endpoints. The displayed cards therefore cannot silently acquire live report values.

## Where reports are stored

Each accepted run creates a new audit ID. The backend now automatically archives terminal runs as immutable JSON files under `server/reports/audits/`, named with a UTC generation timestamp and audit UUID. A new run does not overwrite earlier reports. Partial runs preserve usable results; failed runs save their failure/status record and any available evidence. Jobs remain in memory, but report files survive restart.

The status panel displays the audit ID. While the backend process is running, inspect that run through Swagger or these API routes:

- `/api/audits/{auditId}` for status, timestamps, warnings, and failure information.
- `/api/audits/{auditId}/findings` for findings and evidence.
- `/api/audits/{auditId}/recommendations` for linked suggestions.
- `/api/audits/{auditId}/lighthouse` for the nullable Lighthouse report.

The dashboard button does not download a report to the browser; the backend writes the file automatically. Completed audit summaries include optional `report` metadata with report ID, UTC generation time, filename, and download URL. `GET /api/businesses/{businessId}/reports` lists saved reports newest first, and `GET /api/audits/{auditId}/report` downloads one after restart. The existing `server/reports/guzman-*.json` files remain manual smoke-test snapshots, separate from the immutable per-run archive.

## Shared code and lab compatibility

Public API types and the HTTP client live in `src/types/backend.ts` and `src/services/backendApi.ts`. The lab's old API/type paths remain compatibility re-exports so `/backend-lab` continues to work. The new `src/hooks/useInvestigation.ts` handles only lifecycle summaries; the lab's report-loading hook remains responsible for its detailed results.

Run the backend and normal client dev server as documented in [BACKEND_LAB.md](BACKEND_LAB.md). The existing `/api` development proxy is used. Real PageSpeed calls occur only after an explicit Run Investigation click.

The real dashboard result integration and cumulative scoring are separate tasks. Coordinate those contracts and presentation with the frontend engineer before changing shared result components.

## Verification

Run `npm run test:dashboard` for local browser fixtures covering creation, duplicate clicks, status-only endpoint use, unchanged result cards, completed/partial/failed jobs, reload/unmount, read-only retries, lost POST responses, and backend restart recovery. Run `npm run test:backend-lab` to check report-viewing compatibility after changes to the shared client. Both suites avoid Google calls.

An explicit real dashboard check is available as `npm run test:backend-lab -- --live --dashboard` after building the backend. It starts temporary local servers, submits exactly one Lighthouse audit through the dashboard button, verifies terminal status and unchanged mock cards, and stores screenshots under ignored smoke-test artifacts. This optional command consumes PageSpeed quota.
