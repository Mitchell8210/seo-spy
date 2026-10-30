// Offline browser checks. No credentials are loaded and no Meta API calls are made.
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
const children = [];
const errors = [];
const requests = [];
let mode = 'loaded';
let cdp;
let server;
let artifacts;
const now = '2026-10-29T16:49:21.881Z';
const auditId = '00000000-0000-4000-8000-000000000001';
const evidence = { id: 'evidence', auditId, checkId: 'facebook:posts', sourceUrl: 'https://www.facebook.com/123', collectedAt: now, mode: 'live', observed: { post: '<script>window.fixtureExecuted=true</script>', phone: '702-555-0101' } };
const finding = { id: 'finding', auditId, checkId: 'facebook:posts', evidenceIds: ['evidence'], severity: 'low', source: 'facebook', title: 'Review the phone number', explanation: 'Two collected posts have different phone numbers.', status: 'needs_review' };
const recommendation = { id: 'recommendation', auditId, findingId: 'finding', title: finding.title, explanation: finding.explanation, recommendedChange: 'Confirm the correct contact number.', purpose: 'Help customers contact the business.', status: 'needs_review' };
const facebook = {
  provider: 'facebook-graph', version: 'facebook-v1', graphVersion: 'v26.0', pageId: '123', pageName: 'Fixture Facebook Page', collectedAt: now,
  window: { since: '2026-09-29T16:49:21.881Z', until: now, requestedDays: 30 },
  profile: { followers_count: { status: 'available', value: 15, collectedAt: now }, hours: { status: 'missing', value: null, collectedAt: now } },
  posts: { status: 'available', items: [{ id: '123_456', message: '<img src=x onerror="window.fixtureExecuted=true">', createdTime: now, url: 'https://www.facebook.com/123_456' }], truncated: true, collectedAt: now },
  metrics: [
    { name: 'page_daily_follows_unique', status: 'available', period: 'day', points: [{ endTime: now, value: 3 }], aggregation: 'sum', total: 3, collectedAt: now },
    { name: 'page_daily_unfollows_unique', status: 'available', period: 'day', points: [{ endTime: now, value: 1 }], aggregation: 'sum', total: 1, collectedAt: now },
    { name: 'page_post_engagements', status: 'available', period: 'day', points: [{ endTime: now, value: 0 }], aggregation: 'sum', total: 0, collectedAt: now },
    { name: 'page_media_view', status: 'available', period: 'day', points: [{ endTime: now, value: 63 }], aggregation: 'sum', total: 63, collectedAt: now },
    { name: 'page_views_total', status: 'available', period: 'day', points: [{ endTime: now, value: 3 }], aggregation: 'sum', total: 3, collectedAt: now },
    { name: 'page_video_views', status: 'available', period: 'day', points: [{ endTime: now, value: 12 }], aggregation: 'sum', total: 12, collectedAt: now },
  ],
  summary: { followersStart: 15, followersEnd: 15, followersChange: 0, latestPostAt: now, postsInWindow: 1, postsInWindowComplete: false },
  coverage: { profileFieldsAvailable: 1, profileFieldsMissing: 1, profileFieldsUnavailable: 0, metricsAvailable: 1, metricsRequested: 2, postsLimit: 50 },
  limitations: ['At most 50 recent posts are collected.'],
};
const report = { schemaVersion: 'seo-spy.audit-report.v1', reportId: auditId, auditId, generatedAt: now, business: { id: 'demo-guzman', name: 'Fixture Business', website: 'https://example.com/', createdAt: now },
  audit: { id: auditId, businessId: 'demo-guzman', scope: 'facebook', mode: 'live', status: 'partial', warnings: ['Recent posts are bounded.'], failure: null },
  results: { facebook, findings: [], recommendations: [], evidence: [evidence], scores: [] } };
const payload = () => ({ businessId: 'demo-guzman', report: mode === 'empty' ? null : report, analysis: mode === 'empty' ? null : { version: 'facebook-analysis-v1', auditId, summaries: ['Follower snapshots remained at 15.'], findings: [finding], recommendations: [recommendation] },
  latestAttempt: mode === 'failed-latest' ? { reportId: 'failed', auditId: 'failed', generatedAt: now, fileName: 'failed.json', downloadUrl: '/api/audits/failed/report', businessId: 'demo-guzman', scope: 'facebook', mode: 'live', status: 'failed', counts: { findings: 0, recommendations: 0 } } : null });

async function waitFor(test, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await test()) return; } catch { /* Startup/navigation can transiently fail. */ } await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
function run(executable, args, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); children.push(child);
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {}); return child;
}
async function connect(url) {
  const socket = new globalThis.WebSocket(url); await once(socket, 'open');
  let counter = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
    if (!data.id) return; const job = pending.get(data.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(data.id); data.error ? job.reject(new Error(data.error.message)) : job.resolve(data.result);
  });
  return { close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value;
}
const text = () => evaluate('document.body.innerText');
const navigateReport = url => cdp.send('Page.navigate', { url });
async function screenshot(filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(artifacts, filename), Buffer.from(result.data, 'base64'));
}

try {
  const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  if (!chrome) throw new Error('Set CHROME_PATH to a local Chrome executable.');
  const cache = path.join(clientDir, 'node_modules/.cache/social-media-smoke'); await mkdir(cache, { recursive: true }); artifacts = await mkdtemp(path.join(cache, 'run-'));
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url !== '/api/businesses/demo-guzman/facebook-report') { res.writeHead(404); res.end(); return; }
    const selected = mode;
    const data = selected === 'error' ? { error: { code: 'FIXTURE_ERROR', message: 'Saved reports are temporarily unavailable.' } } : selected === 'mismatch' ? { ...payload(), businessId: 'different-business' } : payload();
    setTimeout(() => { res.writeHead(selected === 'error' ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); }, 250);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const vitePort = await freePort(); const base = `http://127.0.0.1:${vitePort}`;
  const vite = run(process.execPath, [path.join(clientDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: clientDir, env: { ...process.env, BACKEND_LAB_API_TARGET: `http://127.0.0.1:${server.address().port}` } });
  await waitFor(async () => vite.exitCode === null && (await fetch(base)).ok, 'Vite startup');
  const profile = path.join(artifacts, 'chrome-profile'); run(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', 'about:blank']);
  let port; await waitFor(async () => { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); return Boolean(port); }, 'Chrome startup');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${base}/social-media` });
  await waitFor(async () => (await text()).includes('Fixture Facebook Page'), 'saved Facebook report');
  assert.equal(await evaluate('document.querySelector("#social-account").disabled'), false, 'The saved account dropdown must be interactive.');
  assert.equal(await evaluate('document.querySelector("#social-account").value'), '123');
  assert.match(await text(), /Partial coverage/); assert.match(await text(), /Interactions\s+0/); assert.match(await text(), /People Reached\s+Not available/);
  assert.match(await text(), /Review the phone number/);
  assert.match(await text(), /Social Media Health Summary/); assert.match(await text(), /SEO Spy Social Media Report/);
  assert.doesNotMatch(await text(), /returned daily measurements|Newest collected post|Report coverage and business details/);
  assert.match(await text(), /People Who Contacted You\s+Not available/);
  const healthLabels = await evaluate(`Array.from(document.querySelectorAll('section[aria-labelledby="social-health-title"] article')).map(card => ({ title: card.querySelector('h3').textContent, labels: Array.from(card.querySelectorAll('dt')).map(row => row.lastElementChild.textContent.trim()) }))`);
  assert.deepEqual(healthLabels, [
    { title: 'Followers', labels: ['New Followers', 'Unfollowed'] },
    { title: 'People Reached', labels: ['Media views', 'Page views', 'Video views'] },
    { title: 'People Who Contacted You', labels: ['Website Clicks', 'Address Clicks', 'People Mentioning Your Business'] },
    { title: 'Interactions', labels: ['Likes', 'Comments', 'Shares', 'Messages'] },
  ], 'Health tiles preserve main labels while retaining correctly labeled view metrics.');
  assert.match(await text(), /Media views\s+63/);
  assert.match(await text(), /Page views\s+3/);
  assert.match(await text(), /Video views\s+12/);
  assert.match(await text(), /Positive activity:.*New Followers\s+3/s);
  assert.match(await text(), /People lost:.*Unfollowed\s+1/s);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('section[aria-labelledby="social-health-title"] dd')).filter(value => value.textContent === 'Not collected').every(value => getComputedStyle(value).fontSize === '12px' && getComputedStyle(value).whiteSpace === 'nowrap')`), true, 'Uncollected values use compact, nonwrapping text.');
  assert.doesNotMatch(await text(), /Mock score|Mock benchmark|higher than.*similar local businesses/);
  assert.equal(await evaluate('document.querySelectorAll("[data-performance-graphic]").length'), 1);
  assert.equal(await evaluate('document.querySelector("[data-performance-graphic]").getAttribute("aria-hidden")'), 'true', 'The original graph illustration is decorative.');
  assert.equal(await evaluate('document.querySelector("#social-score-title").closest("section").querySelector("[role=img]").getAttribute("aria-label")'), 'Score: not available');
  assert.equal(await evaluate('document.querySelector("#social-score-title").closest("section").querySelectorAll("[role=img] circle").length'), 1, 'Unavailable scores retain the shared gauge without a performance indicator.');
  assert.match(await text(), /A few things need attention on your social media account\./);
  assert.doesNotMatch(await text(), /Follower snapshots remained at 15\./);
  assert.equal(await evaluate('document.querySelectorAll("#social-health-title").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll("#social-urgent-title, #social-medium-title, #social-low-title, #social-great-title").length'), 4);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Fix Now'))?.click()`);
  await waitFor(async () => (await text()).includes('<script>window.fixtureExecuted=true</script>'), 'native finding evidence disclosure');
  assert.equal(await evaluate('window.fixtureExecuted === true'), false); assert.equal(await evaluate('document.querySelector("[data-testid=social-report] script") !== null'), false);
  await screenshot('desktop.png');
  report.audit.status = 'completed';
  await navigateReport(`${base}/social-media`);
  await waitFor(async () => (await text()).includes('Your social media is in good shape, but a few things need attention.'), 'general health summary');
  finding.severity = 'critical';
  await navigateReport(`${base}/social-media`);
  await waitFor(async () => (await text()).includes('Your social media has important issues that need attention.'), 'urgent health summary');
  finding.severity = 'low'; report.audit.status = 'partial';
  mode = 'error'; await navigateReport(`${base}/social-media`); await waitFor(async () => (await text()).includes('Saved reports are temporarily unavailable'), 'API error state');
  mode = 'mismatch'; await navigateReport(`${base}/social-media`); await waitFor(async () => (await text()).includes('did not match the selected business'), 'reject mismatched business');
  mode = 'empty'; await navigateReport(`${base}/social-media`); await waitFor(async () => (await text()).includes('No saved Facebook analysis is available'), 'empty state');
  assert.equal(await evaluate('document.querySelector("#social-account").disabled'), true, 'No account can be selected without a saved report.');
  assert.equal(await evaluate('document.querySelector("[data-testid=social-report]") === null'), true);
  mode = 'loaded'; await navigateReport(`${base}/social-media`); await waitFor(async () => (await text()).includes('Fixture Facebook Page'), 'report loads after empty state');
  assert.equal(await evaluate('document.querySelector("#social-account").disabled'), false);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await delay(150);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Mobile must not overflow.');
  await screenshot('mobile.png'); assert.deepEqual(errors, []);
  await cdp.send('Page.navigate', { url: `${base}/settings` });
  await waitFor(async () => (await text()).includes('Business Profile'), 'remote Settings route');
  assert.equal(requests.every(request => request.method === 'GET'), true, 'Viewing reports must not start audits or provider calls.');
  console.log(JSON.stringify({ passed: ['partial coverage', 'zero versus unavailable', 'native hero/health/report components', 'unsupported score and benchmark unavailable', 'derived findings', 'no added summary or coverage sections', 'inert provider text', 'API error state', 'business mismatch rejected', 'empty and loaded states', 'mobile layout', 'remote Settings route', 'read-only API'], artifactDirectory: artifacts }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (cdp) { try { await cdp.send('Browser.close'); } catch { /* Browser may have closed. */ } cdp.close(); }
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
