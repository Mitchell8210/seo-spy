# Isolated backend test dashboard

This page exercises the real backend without integrating the production dashboard. Open `/backend-lab` directly; it is intentionally absent from the main sidebar. `/dashboard`, its mock data, and its shared presentation components remain unchanged. The lab is lazy-loaded through one additive route in `src/App.tsx`.

## Run locally

Start the backend in one terminal:

```powershell
cd server
npm run dev
```

Start the lab-enabled client in a second terminal:

```powershell
cd client
npm run dev
```

Open **http://127.0.0.1:5173/backend-lab** (or the port Vite prints). The default business is the seeded `demo-guzman`; `/backend-lab/{businessId}` supports another existing backend business ID. The lab does not create businesses or accept arbitrary website URLs.

The normal Vite config includes a same-origin `/api` proxy to `http://127.0.0.1:3001`, so both `npm run dev` and `npm run dev:backend-lab` support the test page. The dedicated lab config is a compatibility alias; existing pages still use their mocks. To use a different local backend, set `BACKEND_LAB_API_TARGET` in the client terminal before starting Vite. This is an API origin, never a provider key. Both preview commands provide the same proxy for a built client.

If `/api/health` returns HTML instead of JSON, restart the frontend development server so it loads the proxy configuration, then refresh `/backend-lab`. Confirm that the backend is listening on port 3001. There is no need to enter private provider credentials in the frontend.

All private provider keys remain in ignored `server/.env`. The frontend neither needs nor accepts a PageSpeed key. Do not add a `VITE_` secret or paste credentials into the page.

## What it tests

- Reads the business, latest usable results, and active audit from the backend. Initial seeded results are explicitly labeled simulated.
- Run Investigation starts either homepage HTML checks or a Lighthouse investigation with mobile/desktop strategy. It sends one POST, then polls status every 2.5 seconds without holding the creation request open.
- Prevents duplicate submissions, reconciles a duplicate/lost creation response with the active audit, and stops on completed/partial/failed results.
- Keeps previous results visible during a new job and after a failed attempt. Partial results display the new usable HTML evidence without borrowing older Lighthouse scores.
- Displays the four Lighthouse category scores, measured zero values, unavailable/null scores, lab metrics, report version/device/time, findings, recommendations, and expandable evidence as text.
- Keeps combined SEO Spy and social scores unavailable. This page performs no Facebook authorization or external writes.
- Resumes an active audit after refresh. Leaving the route aborts frontend requests and polling; it does not cancel the server job. Backend restarts clear jobs and reports because storage is in memory.
- API errors pause polling and provide Retry/Refresh. The lab service and hook are contained in `src/pages/BackendLab/`; browser code does not import backend implementation modules.

To inspect responses directly, use backend Swagger at **http://127.0.0.1:3001/api/docs**. Normal inspection/refresh uses read requests; starting Lighthouse consumes Google PageSpeed quota.

## Verification

From `client/`:

```powershell
npm run lint
npm run build
npm run test:backend-lab
```

The browser smoke test requires local Chrome/Chromium (or `CHROME_PATH` pointing to its executable), Node.js 24, and installed client dependencies. It launches headless Chrome and temporary local Vite/API fixture servers, uses no new testing dependencies, makes no Google audit calls, and closes its child processes. Screenshots and browser profiles are stored under ignored `client/node_modules/.cache/backend-lab-smoke/`.

The fixture suite verifies that the original dashboard makes no API requests, the new route labels simulated results, polling completes, zero/null scores render correctly, duplicate clicks are prevented, partial results do not retain stale scores, reloading resumes work, leaving cancels polling, backend errors support retry, a lost submission response can recover a job that already completed, and a mobile viewport has no horizontal overflow.

For an explicit live browser test, first build the backend, then run:

```powershell
npm --prefix ../server run build
npm run test:backend-lab -- --live
```

Live mode starts its own temporary backend and client, submits exactly one mobile Lighthouse audit through the page, and waits for its terminal result. It uses the backend's existing ignored environment configuration, consumes Google PageSpeed quota, and saves desktop/mobile screenshots and a result summary under the ignored smoke-test artifact directory. It stops its temporary servers afterward, so use the normal two-terminal setup above for manual testing.

Use `npm run test:backend-lab -- --live --homepage` for the equivalent homepage-only browser check. It verifies one HTML-only submission without device strategy, evidence/findings rendering, and unavailable Lighthouse scorecards, without consuming PageSpeed quota.

Before integrating the actual Website page, review [WEBSITE_API_MAPPING.md](WEBSITE_API_MAPPING.md) with the frontend engineer. It records which fields are supported and which score, pass-count, and page-coverage decisions remain open.

This is an integration sandbox, not the final dashboard design. Once the API behavior and presentation are agreed, integrate through the frontend engineer's existing page/components in a separate task.
