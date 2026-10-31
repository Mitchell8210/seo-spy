// Offline fixtures by default. --dashboard checks the investigation lifecycle with archives unavailable.
// --live runs Lighthouse; --live --homepage runs HTML-only checks; --live --dashboard runs one dashboard audit.
// No credentials are read by this script; live mode lets the backend load its own environment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const clientDir = fileURLToPath(new URL('..', import.meta.url));
const serverDir = path.resolve(clientDir, '..', 'server');
const liveMode = process.argv.includes('--live');
const dashboardMode = process.argv.includes('--dashboard');
const liveScope = process.argv.includes('--homepage') ? 'homepage' : 'lighthouse';
const fixtureHost = '127.0.0.1';
const businessId = 'demo-guzman';
const results = [];
const children = [];
let apiServer;
let cdp;
let artifactDir;
let browserErrors = [];
const browserRequests = [];

const stamp = () => new Date().toISOString();
const seedId = '00000000-0000-4000-8000-000000000001';
const jobs = new Map();
let latestId = seedId;
let activeId = null;
let creationCount = 0;
let available = true;
let apiRequests = 0;
let statusRequests = 0;
let loseNextCreateResponse = false;
let nextOutcome = null;
const stageDelayMs = 6500;

function summary(id, { scope = 'lighthouse', mode = 'live', status = 'completed', stage = 'complete', failure = null } = {}) {
  return { id, businessId, scope, mode, ...(scope === 'lighthouse' ? { strategy: 'mobile' } : {}), status, stage,
    createdAt: stamp(), startedAt: stamp(), completedAt: status === 'running' ? null : stamp(),
    warnings: mode === 'demo' ? ['Simulated fixture results only.'] : ['Controlled browser test; no public audit was run.'],
    failure, scoringVersion: scope === 'demo' ? 'demo-v1' : 'lighthouse-v1', counts: { findings: 1, recommendations: 1 } };
}

function findings(id, live = true) {
  return [{ id: `${id}-finding`, auditId: id, checkId: live ? 'lighthouse:image-alt' : 'image-alt',
    evidenceIds: [`${id}-evidence`], severity: 'low', source: 'website', title: live ? 'Fixture image review' : 'Fixture seed finding',
    explanation: live ? 'A controlled fixture finding from the API.' : 'A simulated seed finding.', status: 'needs_review' }];
}

function evidence(id, live = true) {
  return [{ id: `${id}-evidence`, auditId: id, checkId: 'image-alt', sourceUrl: 'https://example.com/', collectedAt: stamp(),
    observed: { count: '1', emptyCount: '1', values: '[{"alt":""}]' }, mode: live ? 'live' : 'demo' }];
}

function recommendations(id) {
  return [{ id: `${id}-recommendation`, auditId: id, findingId: `${id}-finding`, title: 'Review fixture image text',
    explanation: 'Inspect the measured finding.', recommendedChange: 'Confirm whether the fixture image is decorative.',
    purpose: 'Preserve context.', status: 'needs_review' }];
}

function lighthouseReport() {
  return { provider: 'google-pagespeed-insights', strategy: 'mobile', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/',
    fetchedAt: stamp(), lighthouseVersion: 'fixture-13.0.0',
    categories: ['performance', 'accessibility', 'best-practices', 'seo'].map((id, i) => ({ id,
      title: ['Performance', 'Accessibility', 'Best practices', 'SEO'][i], score: [73, 0, null, 91][i],
      availability: i === 2 ? 'unavailable' : 'measured', auditIds: ['image-alt'] })),
    metrics: [{ id: 'largest-contentful-paint', title: 'Largest Contentful Paint', value: 2800, unit: 'ms', displayValue: '2.8 s' },
      { id: 'cumulative-layout-shift', title: 'Cumulative Layout Shift', value: 0.04, unit: 'unitless', displayValue: '0.04' }],
    checks: [{ id: 'image-alt', title: 'Image alternatives', description: '<script>window.fixtureWasExecuted=true</script>', score: 0,
      scoreDisplayMode: 'binary', displayValue: null, explanation: null }], warnings: ['Best practices score is unavailable in this controlled fixture.'] };
}

jobs.set(seedId, { summary: summary(seedId, { scope: 'demo', mode: 'demo' }), report: null });

function settleJobs() {
  if (!activeId) return;
  const job = jobs.get(activeId);
  if (Date.now() - job.created < stageDelayMs) return;
  job.summary.status = job.failed ? 'failed' : job.partial ? 'partial' : 'completed';
  job.summary.stage = 'complete';
  job.summary.completedAt = stamp();
  job.summary.failure = job.failed ? { code: 'AUDIT_FAILED', message: 'Fixture investigation failed. Please try again.' } : job.partial ? { code: 'PAGESPEED_QUOTA_EXCEEDED', message: 'Fixture PageSpeed quota exhausted; HTML findings are retained.' } : null;
  job.report = job.partial ? null : lighthouseReport();
  latestId = activeId;
  activeId = null;
}

function dashboard() {
  settleJobs();
  const job = jobs.get(latestId);
  const live = job.summary.mode === 'live';
  return { mode: job.summary.mode, notice: live ? 'Controlled live-mode fixture. Lighthouse lab measurements only.' : 'Simulated demo results only. No website scan was performed.',
    business: { id: businessId, name: 'Fixture Tax Accounting', website: 'https://example.com/', createdAt: stamp() },
    connections: [{ id: 'website', businessId, platform: 'website', identity: 'https://example.com/', status: 'connected', mode: job.summary.mode },
      { id: 'facebook', businessId, platform: 'facebook', identity: 'Not connected', status: 'authorization_required', mode: job.summary.mode }],
    latestAudit: job.summary, activeAudit: activeId ? jobs.get(activeId).summary : null,
    scores: ['website', 'social', 'consistency', 'overall'].map(category => ({ category, value: live ? null : 78, maximum: 100,
      availability: live ? 'unavailable' : 'demo', scoringVersion: live ? 'homepage-v1' : 'demo-v1' })),
    findings: findings(latestId, live), recommendations: recommendations(latestId), priorityOpportunities: 1, lighthouse: job.report };
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'fixture-request' });
  res.end(JSON.stringify(body));
}

async function serveFixture(req, res) {
  apiRequests++;
  if (!available) return reply(res, 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture backend unavailable. Please retry.', requestId: 'fixture-request' } });
  settleJobs();
  const route = new URL(req.url, 'http://fixture').pathname;
  if (route === '/api/health') return reply(res, 200, { status: 'ok', service: 'fixture', mode: 'demo' });
  if (route.endsWith('/dashboard')) return reply(res, 200, dashboard());
  if (req.method === 'POST' && route.endsWith('/audits')) {
    if (activeId) return reply(res, 409, { error: { code: 'AUDIT_ALREADY_ACTIVE', message: 'A fixture audit is already running.', requestId: 'fixture-request' } });
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    creationCount++;
    const id = `00000000-0000-4000-8000-${String(creationCount + 1).padStart(12, '0')}`;
    const audit = summary(id, { scope: input.scope, status: 'running', stage: input.scope === 'lighthouse' ? 'running_lighthouse' : 'collecting_evidence' });
    if (input.strategy) audit.strategy = input.strategy;
    jobs.set(id, { summary: audit, created: Date.now(), partial: nextOutcome === 'partial' || (!dashboardMode && creationCount === 2), failed: nextOutcome === 'failed', report: null });
    nextOutcome = null;
    activeId = id;
    if (loseNextCreateResponse) {
      loseNextCreateResponse = false;
      jobs.get(id).created = Date.now() - stageDelayMs - 1;
      settleJobs();
      // The backend accepted and finished the job, but the browser never receives its 202.
      res.destroy();
      return;
    }
    return reply(res, 202, { ...audit, status: 'queued', stage: 'queued', statusUrl: `/api/audits/${id}` });
  }
  const match = /^\/api\/audits\/([^/]+)(?:\/(findings|recommendations|lighthouse))?$/.exec(route);
  if (match) {
    const job = jobs.get(match[1]);
    if (!job) return reply(res, 404, { error: { code: 'AUDIT_NOT_FOUND', message: 'Fixture audit not found.', requestId: 'fixture-request' } });
    const common = { mode: job.summary.mode, auditId: match[1], status: job.summary.status };
    if (!match[2]) { statusRequests++; return reply(res, 200, job.summary); }
    if (match[2] === 'findings') return reply(res, 200, { ...common, findings: findings(match[1], job.summary.mode === 'live'), evidence: evidence(match[1], job.summary.mode === 'live') });
    if (match[2] === 'recommendations') return reply(res, 200, { ...common, recommendations: recommendations(match[1]) });
    return reply(res, 200, { ...common, report: job.report, failure: job.summary.failure, warnings: job.summary.warnings });
  }
  return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route not found.', requestId: 'fixture-request' } });
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, fixtureHost); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(test, label, timeout = 18000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try { const value = await test(); if (value) return value; } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

function spawnHidden(executable, args, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  let diagnostic = '';
  child.stdout?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-12000); });
  child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-12000); });
  child.on('error', error => { diagnostic = `${diagnostic}\n${error.message}`; });
  child.diagnostic = () => diagnostic;
  return child;
}

async function connectCdp(url) {
  const socket = new globalThis.WebSocket(url);
  await Promise.race([once(socket, 'open'), delay(15000).then(() => { throw new Error('Chrome debugging connection timed out.'); })]);
  const pending = new Map(); let counter = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') browserRequests.push({ method: message.params.request.method, url: message.params.request.url, postData: message.params.request.postData });
    if (!message.id) return;
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  return { close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}

async function evaluate(expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

const selector = id => `[data-testid="${id}"]`;
const elementText = id => evaluate(`document.querySelector(${JSON.stringify(selector(id))})?.innerText ?? ''`);
const pageText = () => evaluate('document.body.innerText');
const click = id => evaluate(`document.querySelector(${JSON.stringify(selector(id))})?.click()`);
async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(() => evaluate('document.readyState === "complete"'), 'page load');
}
const pass = name => { results.push(name); console.log(`PASS ${name}`); };

async function screenshot(filename) {
  const layout = await cdp.send('Page.getLayoutMetrics');
  const dimensions = layout.cssContentSize ?? layout.contentSize;
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: dimensions.width, height: Math.min(dimensions.height, 20000), scale: 1 } });
  const destination = path.join(artifactDir, filename);
  await writeFile(destination, Buffer.from(shot.data, 'base64'));
  return destination;
}

const dashboardStatus = () => elementText('dashboard-investigation-status');
const dashboardDisabled = () => evaluate(`document.querySelector(${JSON.stringify(selector('dashboard-run-audit'))})?.disabled`);
function assertDashboardRequests(requests) {
  assert.equal(requests.filter(request => /\/api\/audits\/[^/]+\/(findings|recommendations|lighthouse)(?:\?|$)/.test(request.url)).length, 0, 'Dashboard must never request report result endpoints.');
  for (const request of requests.filter(request => request.method === 'POST')) {
    assert.equal(new URL(request.url).pathname, `/api/businesses/${businessId}/audits`);
    assert.deepEqual(JSON.parse(request.postData ?? '{}'), { scope: 'lighthouse', strategy: 'mobile' });
  }
}

async function dashboardScenario(base, backendBase) {
  await cdp.send('Network.enable');
  const requestStart = browserRequests.length;
  await navigate(`${base}/dashboard`);
  await waitFor(async () => /Your online performance/.test(await pageText()) && await dashboardDisabled() === false, 'dashboard ready');
  assert.match(await pageText(), /not available|No saved/i);
  assert.equal(creationCount, 0);
  assert.equal(browserRequests.slice(requestStart).filter(request => request.method === 'POST').length, 0, 'Loading the dashboard must not start an audit.');
  pass('Dashboard keeps unavailable archive fields without starting an audit');

  const submit = async outcome => {
    nextOutcome = outcome;
    const expected = creationCount + 1;
    await click('dashboard-run-audit'); await click('dashboard-run-audit');
    if (!liveMode) await waitFor(() => creationCount === expected, 'one dashboard POST');
    await waitFor(async () => await dashboardDisabled() === true, 'disabled investigation button');
    await waitFor(async () => /lighthouse|measur|performance|running|queued/i.test(await dashboardStatus()), 'running stage label');
    return expected;
  };
  const terminal = async pattern => {
    await waitFor(async () => pattern.test(await dashboardStatus()) && await dashboardDisabled() === false, 'dashboard terminal state', liveMode ? 170000 : 22000);
    assert.doesNotMatch(await pageText(), /Fixture image review|Review fixture image text|fixture-13\.0\.0/);
    assertDashboardRequests(browserRequests.slice(requestStart));
  };
  const stopped = async () => {
    await delay(500); const polls = statusRequests; await delay(3000);
    assert.equal(statusRequests, polls, 'Terminal status must stop polling.');
  };
  await submit('completed');
  await terminal(/Investigation complete|partially completed|failed|could not complete/i);
  assert.match(await dashboardStatus(), /[a-f0-9-]{36}/i, 'Status must identify the backend audit.');
  pass('One mobile Lighthouse POST, duplicate prevention, and stage progress');
  if (liveMode) {
    const requests = browserRequests.slice(requestStart);
    assert.equal(requests.filter(request => request.method === 'POST').length, 1, 'Live dashboard must create exactly one real audit.');
    const auditId = /([a-f0-9-]{36})/i.exec(await dashboardStatus())?.[1];
    const audit = await (await fetch(`${backendBase}/api/audits/${auditId}`, { signal: AbortSignal.timeout(10000) })).json();
    assert.equal(audit.status, 'completed');
    assert.equal(audit.scope, 'lighthouse'); assert.equal(audit.strategy, 'mobile');
    await screenshot('dashboard-live-desktop.png');
    await writeFile(path.join(artifactDir, 'dashboard-live-summary.json'), `${JSON.stringify({ auditId, status: audit.status, auditPosts: 1, reportReads: 0 }, null, 2)}\n`);
  } else {
    await stopped();
    await submit('partial'); await terminal(/Investigation partially completed\. A partial report is available\./); await stopped();
    pass('Partial provider failure stops status polling');
    await submit('failed'); await terminal(/failed|could not complete/i); await stopped();
    pass('Full failure is shown without fabricating result cards');

    const expected = await submit('completed');
    await cdp.send('Page.reload');
    await waitFor(async () => await dashboardDisabled() === true, 'reload resumes active audit');
    assert.equal(creationCount, expected);
    pass('Reload resumes an active job without another POST');
    await navigate(`${base}/settings`);
    await waitFor(() => evaluate('location.pathname === "/settings"'), 'settings navigation');
    await delay(500); const polls = statusRequests; await delay(3000);
    assert.equal(statusRequests, polls, 'Leaving dashboard cancels polling.');
    pass('Leaving dashboard for settings cancels polling');
    // Finish the detached fixture before testing API recovery.
    if (activeId) { jobs.get(activeId).created = Date.now() - stageDelayMs - 1; settleJobs(); }
    available = false;
    await navigate(`${base}/dashboard`);
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector('dashboard-investigation-retry'))}))`), 'dashboard retry button');
    assert.equal(creationCount, expected);
    available = true;
    await click('dashboard-investigation-retry');
    await waitFor(async () => await dashboardDisabled() === false, 'dashboard API recovery');
    await delay(500); assert.equal(creationCount, expected, 'Retry must only reconcile status, never auto-submit.');
    pass('API error and retry never automatically submit an audit');
    loseNextCreateResponse = true;
    await click('dashboard-run-audit');
    await waitFor(() => creationCount === expected + 1, 'lost dashboard POST accepted');
    await waitFor(async () => (await dashboardStatus()).includes(`00000000-0000-4000-8000-${String(creationCount + 1).padStart(12, '0')}`), 'lost dashboard POST reconciled audit ID');
    await terminal(/Investigation complete\. Report generated\./);
    assert.equal(creationCount, expected + 1);
    assert.match(await dashboardStatus(), new RegExp(`00000000-0000-4000-8000-${String(creationCount + 1).padStart(12, '0')}`));
    assert.equal(await evaluate('document.querySelectorAll(\'[role="alert"]\').length'), 0);
    await delay(800); assert.equal(creationCount, expected + 1);
    pass('Lost POST reconciles an already completed job without resubmitting');

    const restartCreations = await submit('completed');
    const forgottenId = activeId;
    assert.ok(forgottenId, 'Restart fixture needs an active accepted job.');
    activeId = null; latestId = seedId; jobs.delete(forgottenId);
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector('dashboard-investigation-retry'))}))`), 'missing in-memory job retry');
    await click('dashboard-investigation-retry');
    await waitFor(async () => await dashboardDisabled() === false && !await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector('dashboard-investigation-retry'))}))`), 'reconcile dashboard after backend restart');
    assert.equal(creationCount, restartCreations, 'Restart recovery must not automatically POST another audit.');
    assert.equal(await evaluate('document.querySelectorAll(\'[role="alert"]\').length'), 0, 'Restart recovery must clear the missing-job error.');
    assert.equal((await dashboardStatus()).includes(forgottenId), false, 'Restart recovery must clear stale job status.');
    await delay(800); assert.equal(creationCount, restartCreations);
    pass('Backend restart clears a missing active job through status-only retry');
  }
  assertDashboardRequests(browserRequests.slice(requestStart));
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ mode: liveMode ? 'live-dashboard' : 'fixture-dashboard', passed: results.length, scenarios: results, artifactDirectory: artifactDir }, null, 2));
}

async function liveScenario(base, backendBase) {
  await cdp.send('Network.enable');
  await navigate(`${base}/backend-lab`);
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector('lab-run-audit'))}) && !document.querySelector(${JSON.stringify(selector('lab-run-audit'))}).disabled)`), 'live business and enabled run button');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector('lab-scope'))}).value`), 'lighthouse');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector('lab-strategy'))}).value`), 'mobile');
  if (liveScope === 'homepage') {
    await evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector('lab-scope'))});
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'homepage');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(selector('lab-scope'))}).value === 'homepage' && document.querySelector(${JSON.stringify(selector('lab-strategy'))}).disabled`), 'homepage scope with disabled device strategy');
  }
  const started = Date.now();
  await click('lab-run-audit');
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(selector('lab-run-audit'))})?.disabled === true`), 'live job submission');
  await waitFor(async () => {
    const status = await elementText('lab-status-panel');
    const enabled = await evaluate(`document.querySelector(${JSON.stringify(selector('lab-run-audit'))})?.disabled === false`);
    return enabled && /Completed|Partial results|Failed/.test(status);
  }, `live ${liveScope} terminal state`, 170000);
  const statusText = await elementText('lab-status-panel');
  const auditId = /Audit\s+([a-f0-9-]{36})/i.exec(statusText)?.[1];
  assert.ok(auditId, 'The UI must identify the live audit being displayed.');
  const auditResponse = await globalThis.fetch(`${backendBase}/api/audits/${auditId}`, { signal: globalThis.AbortSignal.timeout(10000) });
  assert.equal(auditResponse.ok, true);
  const audit = await auditResponse.json();
  assert.ok(['completed', 'partial', 'failed'].includes(audit.status), 'The backend audit must have a terminal status.');
  assert.equal(audit.scope, liveScope, 'The created backend audit must use the selected scope.');
  const creations = browserRequests.filter(request => request.method === 'POST' && new URL(request.url).pathname === `/api/businesses/${businessId}/audits`);
  assert.equal(creations.length, 1, 'Live mode must trigger exactly one audit POST through the UI.');
  assert.deepEqual(JSON.parse(creations[0].postData ?? '{}'), liveScope === 'homepage' ? { scope: 'homepage' } : { scope: 'lighthouse', strategy: 'mobile' }, 'The submitted scope and strategy must match the controls; homepage must not send a strategy.');
  const scorecards = {};
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) scorecards[category] = await elementText(`lab-category-${category}`);
  const findingsResponse = await globalThis.fetch(`${backendBase}/api/audits/${auditId}/findings`, { signal: globalThis.AbortSignal.timeout(10000) });
  assert.equal(findingsResponse.ok, true);
  const findingResults = await findingsResponse.json();
  assert.equal(findingResults.auditId, auditId);
  assert.ok(findingResults.evidence.length > 0, 'A completed live audit must preserve collected evidence.');
  assert.equal(await evaluate('Boolean(document.querySelector("#lab-findings-title"))'), true, 'The UI must show its findings section.');
  assert.match(await pageText(), /View evidence/, 'The UI must expose collected evidence.');
  if (liveScope === 'homepage') {
    for (const text of Object.values(scorecards)) {
      assert.match(text, /Unavailable/i, 'Homepage-only audits must keep all Lighthouse scores unavailable.');
      assert.doesNotMatch(text, /\d+\s*\/\s*100/, 'Homepage-only audits must not show measured Lighthouse numbers.');
    }
    const measurementResponse = await globalThis.fetch(`${backendBase}/api/audits/${auditId}/lighthouse`, { signal: globalThis.AbortSignal.timeout(10000) });
    assert.equal(measurementResponse.ok, true);
    assert.equal((await measurementResponse.json()).report, null, 'Homepage-only audits must have no Lighthouse report.');
  }
  const screenshotPrefix = liveScope === 'homepage' ? 'backend-lab-live-homepage' : 'backend-lab-live';
  const desktopScreenshot = await screenshot(`${screenshotPrefix}-desktop.png`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Live mobile page must not overflow horizontally.');
  const mobileScreenshot = await screenshot(`${screenshotPrefix}-mobile.png`);
  assert.deepEqual(browserErrors, [], 'Live browser must not emit uncaught runtime exceptions.');
  const report = { mode: 'live', scope: liveScope, auditId, status: audit.status, elapsedSeconds: (Date.now() - started) / 1000,
    failureCode: audit.failure?.code ?? null, auditPosts: creations.length, findings: findingResults.findings.length, evidence: findingResults.evidence.length,
    scorecards, desktopScreenshot, mobileScreenshot };
  await writeFile(path.join(artifactDir, liveScope === 'homepage' ? 'live-homepage-summary.json' : 'live-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  assert.equal(audit.status, 'completed', 'The live workflow returned partial/failed results; inspect the saved summary and UI.');
}

try {
  const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to a local Chrome/Chromium executable.');
  const cacheDir = path.join(clientDir, 'node_modules', '.cache', 'backend-lab-smoke');
  await mkdir(cacheDir, { recursive: true });
  artifactDir = await mkdtemp(path.join(cacheDir, 'run-'));
  let backendBase;
  if (liveMode) {
    const backendPort = await freePort();
    const backend = spawnHidden(process.execPath, [path.join(serverDir, 'dist/main.js')], { cwd: serverDir,
      env: { ...process.env, HOST: fixtureHost, PORT: String(backendPort), NODE_ENV: 'development', LOG_LEVEL: 'silent' } });
    backendBase = `http://${fixtureHost}:${backendPort}`;
    await waitFor(async () => {
      if (backend.exitCode !== null) throw new Error('The compiled backend exited before startup. Run npm run build in server/.');
      return (await globalThis.fetch(`${backendBase}/api/health`, { signal: globalThis.AbortSignal.timeout(1000) })).ok;
    }, 'compiled backend startup');
  } else {
    apiServer = http.createServer((req, res) => { void serveFixture(req, res).catch(() => reply(res, 500, { error: { code: 'FIXTURE_ERROR', message: 'Fixture error.' } })); });
    apiServer.listen(0, fixtureHost); await once(apiServer, 'listening');
    backendBase = `http://${fixtureHost}:${apiServer.address().port}`;
  }
  const vitePort = await freePort();
  const vite = spawnHidden(process.execPath, [path.join(clientDir, 'node_modules/vite/bin/vite.js'), '--config', liveMode ? 'vite.backend-lab.config.ts' : 'vite.config.ts',
    '--host', fixtureHost, '--port', String(vitePort), '--strictPort'], { cwd: clientDir,
    env: { ...process.env, BACKEND_LAB_API_TARGET: backendBase } });
  const base = `http://${fixtureHost}:${vitePort}`;
  await waitFor(async () => {
    if (vite.exitCode !== null) throw new Error(vite.diagnostic());
    return (await globalThis.fetch(base, { signal: globalThis.AbortSignal.timeout(1000) })).ok;
  }, 'Vite startup');
  const profile = path.join(artifactDir, 'chrome-profile');
  const browser = spawnHidden(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', 'about:blank']);
  const debugPort = await waitFor(async () => {
    if (browser.exitCode !== null) throw new Error(browser.diagnostic());
    return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
  }, 'headless Chrome startup');
  const targets = await (await globalThis.fetch(`http://${fixtureHost}:${debugPort}/json/list`)).json();
  cdp = await connectCdp(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  if (dashboardMode) {
    await dashboardScenario(base, backendBase);
  } else if (liveMode) {
    await liveScenario(base, backendBase);
  } else {
  await cdp.send('Network.enable');
  const initialRequests = browserRequests.length;
  await navigate(`${base}/dashboard`);
  await waitFor(async () => /Your online performance/.test(await pageText()), 'original dashboard');
  await delay(800);
  assert.equal(creationCount, 0, 'Dashboard must not start an audit before a click.');
  assertDashboardRequests(browserRequests.slice(initialRequests));
  assert.match(await pageText(), /not available|No saved/i);
  pass('Dashboard preserves unavailable data fields without starting an audit');

  await navigate(`${base}/backend-lab`);
  await waitFor(async () => (await pageText()).includes('Fixture Tax Accounting'), 'backend lab data');
  assert.match(await pageText(), /simulated|mock|demo/i);
  pass('Isolated lab loads the backend business and labels seeded demo results');

  await click('lab-run-audit'); await click('lab-run-audit');
  await waitFor(() => creationCount === 1, 'first audit submission');
  assert.equal(creationCount, 1, 'Duplicate clicks must not create duplicate jobs.');
  await waitFor(async () => (await elementText('lab-category-performance')).includes('73'), 'Lighthouse completion', 20000);
  assert.match(await elementText('lab-category-accessibility'), /\b0\b/);
  assert.match(await elementText('lab-category-best-practices'), /unavailable|not measured|not available|—/i);
  assert.match(await elementText('lab-category-seo'), /91/);
  assert.equal(await evaluate('window.fixtureWasExecuted === true'), false, 'Provider text must never execute HTML.');
  pass('Audit submission/polling renders real zero, unavailable scores, and measured values');
  await delay(500);
  const terminalPolls = statusRequests; await delay(3000);
  assert.equal(statusRequests, terminalPolls, 'Terminal jobs must stop status polling.');
  pass('Polling stops on terminal completion');

  await click('lab-run-audit');
  await waitFor(() => creationCount === 2, 'partial audit submission');
  assert.match(await elementText('lab-category-performance'), /73/, 'Previous measurements should remain visible while a new job runs.');
  await waitFor(async () => /Fixture PageSpeed quota exhausted|PAGESPEED_QUOTA_EXCEEDED/.test(await pageText()), 'partial failure display', 20000);
  assert.match(await pageText(), /Fixture image review/);
  assert.doesNotMatch(await elementText('lab-category-performance'), /\b73\b/, 'Partial report must not retain another audit\'s Lighthouse score.');
  pass('Partial results preserve HTML findings without stale Lighthouse scores');
  await delay(500); const partialPolls = statusRequests; await delay(3000);
  assert.equal(statusRequests, partialPolls, 'Partial jobs are terminal and must stop polling.');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Mobile page must not overflow horizontally.');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifactDir, 'backend-lab-mobile.png'), Buffer.from(shot.data, 'base64'));
  pass('Mobile layout has no horizontal overflow');

  await click('lab-run-audit'); await waitFor(() => creationCount === 3, 'resumable audit');
  await cdp.send('Page.reload');
  await waitFor(async () => (await pageText()).includes('Fixture Tax Accounting'), 'reload data');
  await delay(3000); assert.equal(creationCount, 3, 'Reload must resume an existing job instead of creating one.');
  pass('Reload resumes the active audit without creating another job');
  await navigate(`${base}/settings`); await waitFor(() => evaluate('location.pathname === "/settings"'), 'leave lab');
  await delay(500); const leavingPolls = statusRequests; await delay(3000);
  assert.equal(statusRequests, leavingPolls, 'Leaving the lab must cancel status polling.');
  pass('Leaving the lab cancels polling');

  available = false;
  await navigate(`${base}/backend-lab`);
  await waitFor(async () => /unavailable|retry|connect|could not|failed/i.test(await pageText()), 'backend unavailable state');
  available = true;
  await evaluate(`(() => { const buttons = [...document.querySelectorAll('button')]; const retry = document.querySelector(${JSON.stringify(selector('lab-refresh'))}) ?? buttons.find(button => /retry|try again/i.test(button.innerText)); retry?.click(); })()`);
  await waitFor(async () => (await pageText()).includes('Fixture Tax Accounting'), 'backend retry');
  pass('Unavailable backend supports retry');

  loseNextCreateResponse = true;
  const expectedCreations = creationCount + 1;
  const lostResponseAuditId = `00000000-0000-4000-8000-${String(expectedCreations + 1).padStart(12, '0')}`;
  await click('lab-run-audit');
  await waitFor(() => creationCount === expectedCreations, 'accepted audit with lost response');
  await waitFor(async () => {
    const status = await elementText('lab-status-panel');
    const enabled = await evaluate(`document.querySelector(${JSON.stringify(selector('lab-run-audit'))})?.disabled === false`);
    return status.includes(lostResponseAuditId) && /Completed/.test(status) && enabled;
  }, 'completed audit reconciliation after lost response');
  assert.equal(await evaluate('document.querySelectorAll(\'[role="alert"]\').length'), 0, 'A reconciled completed audit must not retain a submission error.');
  await delay(800);
  assert.equal(creationCount, expectedCreations, 'Lost POST responses must not automatically resubmit jobs.');
  pass('Lost create response reconciles a completed audit without stale errors or resubmission');
  assert.deepEqual(browserErrors, [], 'Browser must not emit uncaught runtime exceptions.');
  console.log(JSON.stringify({ passed: results.length, scenarios: results, artifactDirectory: artifactDir }, null, 2));
  }
} catch (error) {
  console.error(`Backend lab smoke test failed: ${error.message}`);
  if (cdp) {
    try { console.error((await pageText()).slice(0, 5000)); } catch { /* Browser may already be closed. */ }
  }
  process.exitCode = 1;
} finally {
  if (cdp) {
    try { await cdp.send('Browser.close'); } catch { /* Chrome may have already exited. */ }
    cdp.close();
  }
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill();
  }
  if (apiServer) { apiServer.closeAllConnections(); await new Promise(resolve => apiServer.close(resolve)); }
}
