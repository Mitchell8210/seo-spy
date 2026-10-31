// Offline browser checks for the existing Website page. No provider calls.
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
const children = [], errors = [], requests = [];
const savedTarget = process.argv.includes('--saved') ? process.env.WEBSITE_API_TARGET ?? 'http://127.0.0.1:3001' : null;
const dashboardMode = process.argv.includes('--dashboard');
let mode = 'loaded', cdp, server, artifacts;
let rerun = null, rejectRun = false;
let facebookJob = null, facebookLatest = null;
const rerunId = '00000000-0000-4000-8000-000000000002';
const now = '2026-10-29T01:57:37.216Z';
const auditId = '00000000-0000-4000-8000-000000000001';
const business = { id: 'demo-guzman', name: 'Fixture Business', website: 'https://example.com/', createdAt: now };
const report = {
  schemaVersion: 'seo-spy.audit-report.v1', reportId: auditId, auditId, generatedAt: now, business,
  audit: { id: auditId, businessId: business.id, scope: 'lighthouse', mode: 'live', status: 'completed', stage: 'complete', completedAt: now, warnings: [], failure: null },
  results: {
    findings: [{ id: 'fixture-finding', auditId, checkId: 'image-alt', evidenceIds: ['evidence'], severity: 'low', source: 'website', title: 'Review fixture image alternatives', explanation: 'Empty alt text can be intentional. ' + 'long-diagnostic-value'.repeat(25), status: 'needs_review' }],
    evidence: [{ id: 'evidence', auditId, checkId: 'image-alt', sourceUrl: 'https://example.com/', collectedAt: now, mode: 'live', observed: { html: '<script>window.fixtureExecuted=true</script>' } }],
    recommendations: [{ id: 'rec', auditId, findingId: 'fixture-finding', recommendedChange: 'Confirm which images are informative.' }],
    lighthouse: { provider: 'google-pagespeed-insights', strategy: 'mobile', finalUrl: 'https://example.com/', fetchedAt: now, lighthouseVersion: '13.0.0',
      categories: [{ id: 'performance', title: 'Performance', score: 0, availability: 'measured', auditIds: [] }, { id: 'accessibility', title: 'Accessibility', score: null, availability: 'unavailable', auditIds: ['pass', 'manual', 'numeric'] }, { id: 'seo', title: 'SEO', score: 91, availability: 'measured', auditIds: ['pass'] }],
      checks: [{ id: 'pass', title: 'Measured passing check', description: 'A binary pass.', scoreDisplayMode: 'binary', score: 1 }, { id: 'manual', title: 'Do not count manual', scoreDisplayMode: 'manual', score: 1 }, { id: 'numeric', title: 'Do not count numeric', scoreDisplayMode: 'numeric', score: 1 }], metrics: [], warnings: [] }
  }
};
const summary = (scope, mode) => ({ reportId: report.auditId, auditId: report.auditId, businessId: business.id, scope, mode, status: report.audit.status, generatedAt: now });
const facebookAuditId = '00000000-0000-4000-8000-000000000003';
const facebookFinding = { id: 'facebook-review', auditId: facebookAuditId, checkId: 'facebook:profile:hours', evidenceIds: ['facebook-evidence'], severity: 'medium', source: 'facebook', title: 'Review the Page business hours', explanation: 'Meta did not return populated business hours. <script>window.fixtureExecuted=true</script>', status: 'needs_review' };
const facebookReport = {
  schemaVersion: 'seo-spy.audit-report.v1', reportId: facebookAuditId, auditId: facebookAuditId, generatedAt: now, business,
  audit: { ...report.audit, id: facebookAuditId, scope: 'facebook', mode: 'live', status: 'partial' },
  results: { facebook: { provider: 'facebook-graph', version: 'facebook-v1', graphVersion: 'v26.0', pageId: '123', pageName: 'Fixture Facebook Page', collectedAt: now,
    window: { requestedDays: 30, since: now, until: now }, profile: { followers_count: { status: 'available', value: 15, collectedAt: now } },
    metrics: [{ name: 'page_post_engagements', aggregation: 'sum', status: 'available', total: 0, points: [], period: 'day', collectedAt: now }, { name: 'page_media_view', status: 'available', total: 999 }],
    posts: { status: 'available', items: [], truncated: false, collectedAt: now }, limitations: [], summary: {}, coverage: {} },
    evidence: [{ id: 'facebook-evidence', auditId: facebookAuditId, checkId: 'facebook:profile:hours', mode: 'live', observed: { status: 'missing' } }],
    findings: [facebookFinding], recommendations: [{ id: 'facebook-rec', auditId: facebookAuditId, findingId: facebookFinding.id, title: 'Review your Page hours', explanation: 'Help visitors plan a visit.', recommendedChange: 'Check the hours shown on Facebook before changing them.', status: 'needs_review' }], scores: [] }
};
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
async function assertDetailsFit(label) {
  const overflow = await evaluate(`Array.from(document.querySelectorAll('section[aria-labelledby="website-findings-title"] li[id]')).flatMap(card => Array.from(card.querySelectorAll('p, li, h4, h5, button')).filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map(el => ({ card: card.id, tag: el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth })))`);
  assert.deepEqual(overflow, [], label + ': expanded text must fit inside each card');
}
async function screenshot(filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(artifacts, filename), Buffer.from(result.data, 'base64'));
}

try {
  const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  if (!chrome) throw new Error('Set CHROME_PATH to a local Chrome executable.');
  const cache = path.join(clientDir, 'node_modules/.cache/website-smoke'); await mkdir(cache, { recursive: true }); artifacts = await mkdtemp(path.join(cache, 'run-'));
  server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    let data;
    if (req.url.startsWith('/api/facebook/reports/status?')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ businessId: business.id, active: facebookJob, latest: facebookLatest })); return;
    }
    if (req.method === 'POST' && req.url === '/api/facebook/reports') {
      let body = ''; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { businessId: business.id, pageId: '123' });
      facebookJob = { pageId: '123', status: 'running' };
      setTimeout(() => {
        facebookReport.results.facebook.profile.followers_count.value = 17;
        facebookJob = null;
        facebookLatest = { pageId: '123', result: { reportId: facebookAuditId, auditId: facebookAuditId, status: 'partial', failure: null }, error: null };
        res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify(facebookLatest.result));
      }, 5000);
      return;
    }
    if (req.url.endsWith('/facebook-report')) {
      if (mode === 'facebook-error' || mode === 'error') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'FIXTURE_FACEBOOK_ERROR', message: 'Saved Facebook reports are temporarily unavailable.' } })); return; }
      const empty = mode === 'empty';
      data = { businessId: business.id, report: empty ? null : facebookReport,
        analysis: empty ? null : { version: 'facebook-analysis-v1', auditId: facebookAuditId, findings: facebookReport.results.findings, recommendations: facebookReport.results.recommendations, summaries: [] },
        latestAttempt: mode === 'failed-latest' ? { auditId: 'failed-facebook', status: 'failed' } : null };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    if (req.method === 'POST' && req.url === '/api/businesses/demo-guzman/audits') {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.at(-1).body = JSON.parse(body);
      if (rejectRun) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'START_FAILED', message: 'The report could not be started.' } })); return; }
      rerun = { ...report.audit, id: rerunId, status: 'queued', stage: 'queued', completedAt: null, createdAt: now, strategy: 'mobile' };
      setTimeout(() => { res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...rerun, statusUrl: '/api/audits/' + rerunId })); }, 300);
      return;
    }
    if (mode === 'error') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'FIXTURE_ERROR', message: 'Saved reports are temporarily unavailable.' } })); return; }
    if (req.url === '/api/audits/' + rerunId && rerun) {
      rerun = { ...rerun, status: 'completed', stage: 'complete', completedAt: now };
      report.auditId = rerunId; report.reportId = rerunId; report.audit = { ...rerun };
      for (const item of [...report.results.findings, ...report.results.evidence, ...report.results.recommendations]) item.auditId = rerunId;
      report.results.findings[0].title = 'Fresh report image alternatives';
      data = rerun;
    }
    else if (req.url === '/api/audits/running') data = { ...report.audit, id: 'running', status: 'running', stage: 'running_lighthouse' };
    else if (req.url.endsWith('/dashboard')) data = { business, connections: [], latestAudit: null, activeAudit: rerun?.status === 'queued' ? rerun : mode === 'running' ? { ...report.audit, id: 'running', status: 'running', stage: 'running_lighthouse' } : null };
    else if (req.url.endsWith('/reports')) data = { businessId: 'demo-guzman', reports: mode === 'empty' ? [summary('demo', 'demo'), summary('facebook', 'live')] : [summary('facebook', 'live'), ...(mode === 'failed-latest' ? [{ ...summary('homepage', 'live'), auditId: 'failed', status: 'failed' }] : []), summary(report.audit.scope, 'live')] };
    else if (req.url === '/api/audits/' + report.auditId + '/website-analysis') data = {
      version: 'website-priority-v1', auditId: mode === 'analysis-mismatch' ? 'other-audit' : report.auditId,
      findings: report.results.findings.map(item => ({ ...item, severity: 'critical' })),
      recommendations: report.results.recommendations.map(item => ({ ...item, recommendedChange: 'Backend priority recommendation: inspect the recorded bottleneck. ' + 'long-resource-reference'.repeat(25) })), priorities: []
    };
    else if (req.url === '/api/audits/' + report.auditId + '/evidence-summary') data = {
      version: 'programmatic-evidence-v1', auditId: report.auditId,
      findings: [{ id: 'fixture-finding', evidenceIds: ['evidence'], text: 'Backend evidence summary. <script>window.fixtureExecuted=true</script> ' + 'x'.repeat(180), sourceLabel: 'Homepage HTML - Oct 29, 2026' }],
      checks: report.results.lighthouse ? [{ id: 'pass', evidenceIds: [], text: 'Backend passed-check summary.', sourceLabel: 'Lighthouse - mobile' }] : []
    };
    else if (req.url === '/api/audits/' + report.auditId + '/report') data = mode === 'mismatch' ? { ...report, auditId: 'wrong-audit' } : report;
    else { res.writeHead(404); res.end(); return; }
    setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); }, 150);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const vitePort = await freePort(); const base = `http://127.0.0.1:${vitePort}`;
  const vite = run(process.execPath, [path.join(clientDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: clientDir, env: { ...process.env, BACKEND_LAB_API_TARGET: savedTarget ?? `http://127.0.0.1:${server.address().port}` } });
  await waitFor(async () => vite.exitCode === null && (await fetch(base)).ok, 'Vite startup');
  const profile = path.join(artifacts, 'chrome-profile'); run(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', 'about:blank']);
  let port; await waitFor(async () => { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); return Boolean(port); }, 'Chrome startup');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  if (dashboardMode) {
    const go = async (query = '') => { await navigateReport(base + '/dashboard' + query); };
    const sectionText = id => evaluate('document.querySelector("section[aria-labelledby=' + id + ']").innerText');
    await go();
    await waitFor(async () => (await text()).includes('Fixture Facebook Page') && (await text()).includes('Review fixture image alternatives'), 'both saved channel reports');
    assert.equal(requests.filter(item => item.method === 'POST').length, 0, 'Viewing the Dashboard starts no audit.');
    assert.match(await text(), /Fixture Business/);
    assert.doesNotMatch(await text(), /Guzman|mock|illustrative|demo connections|Business hours differ|Phone formatting differs|business name matches/i);
    assert.equal(await evaluate('window.fixtureExecuted === true'), false);
    assert.ok((await sectionText('social-performance-title')).includes('<script>') === false);
    assert.match(await sectionText('social-performance-title'), /Followers\s+15/);
    assert.match(await sectionText('social-performance-title'), /Reach — 30 days\s+—/);
    assert.match(await sectionText('social-performance-title'), /Engagement Rate\s+—/);
    assert.match(await sectionText('social-performance-title'), /Interactions — 30 days\s+0/);
    assert.doesNotMatch(await sectionText('social-performance-title'), /999/);
    assert.match(await sectionText('findings-title'), /Facebook/);
    assert.match(await sectionText('recommendations-title'), /Check the hours shown on Facebook before changing them/);
    const gauges = await evaluate('Array.from(document.querySelectorAll("[role=img]")).map(el=>el.getAttribute("aria-label"))');
    assert.ok(gauges.some(value => value.startsWith('Performance: 0 out of 100')));
    assert.equal(await evaluate('document.querySelector("section[aria-labelledby=main-spy-title] [role=img]").getAttribute("aria-label")'), 'Score: not available');
    assert.equal(await evaluate('document.querySelectorAll("section[aria-labelledby=consistency-title] li").length'), 4);
    assert.equal(await evaluate('document.querySelectorAll("section[aria-labelledby=connections-title] li .text-emerald-300").length'), 2, 'Both connected assets keep green checks.');
    assert.match(await text(), /1 website connected/); assert.match(await text(), /1 social account connected/);
    const sections = await evaluate('Array.from(document.querySelectorAll("section[aria-labelledby]")).map(el=>el.getAttribute("aria-labelledby"))');
    assert.deepEqual(sections, ['business-title', 'main-spy-title', 'consistency-title', 'results-title', 'website-health-title', 'social-performance-title', 'connections-title', 'findings-title', 'recommendations-title']);
    await screenshot('dashboard-desktop.png');
    for (const width of [320, 390, 768, 1280]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Dashboard overflow at ' + width);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await screenshot('dashboard-mobile.png');
    mode = 'failed-latest'; await go();
    await waitFor(async () => (await text()).includes('A newer report attempt failed.') && (await text()).includes('Review fixture image alternatives'), 'failed newer attempts');
    assert.match(await text(), /Review fixture image alternatives/); assert.match(await text(), /Fixture Facebook Page/);
    mode = 'facebook-error'; await evaluate('window.dispatchEvent(new Event("focus"))');
    await waitFor(async () => (await text()).includes('Saved Facebook reports are temporarily unavailable'), 'Facebook refresh failure');
    assert.match(await sectionText('social-performance-title'), /Followers\s+15/);
    assert.match(await text(), /Review fixture image alternatives/);
    mode = 'loaded'; facebookReport.results.facebook.profile.followers_count.value = 16;
    await evaluate('window.dispatchEvent(new Event("focus"))');
    await waitFor(async () => /Followers\s+16/.test(await sectionText('social-performance-title')), 'Facebook refresh recovery');
    mode = 'empty'; await go(); await waitFor(async () => (await text()).includes('No saved website report is available.'), 'no live reports');
    assert.equal(await evaluate('document.querySelectorAll("#findings-title ~ div article").length'), 0);
    assert.equal(await evaluate('document.querySelector("section[aria-labelledby=website-health-title] [role=img]").getAttribute("aria-label")'), 'Score: not available');
    assert.match(await sectionText('social-performance-title'), /Followers\s+—/);
    mode = 'loaded'; await go('?businessId=other-business');
    await waitFor(async () => (await text()).includes('different business') || (await text()).includes('selected business'), 'business identity rejection');
    assert.doesNotMatch(await text(), /Fixture Business|Fixture Facebook Page|Review fixture image alternatives/);
    await go(); await waitFor(async () => (await text()).includes('Review fixture image alternatives'), 'report restored');
    await waitFor(async () => await evaluate('!document.querySelector("[data-testid=dashboard-run-audit]").disabled'), 'investigation ready');
    await evaluate('document.querySelector("[data-testid=dashboard-run-audit]").click(); document.querySelector("[data-testid=dashboard-run-audit]").click()');
    await waitFor(async () => (await text()).includes('Investigation queued'), 'existing investigation starts');
    assert.equal(requests.filter(item => item.method === 'POST').length, 2, 'Dashboard starts exactly one Website and one Facebook report.');
    assert.match(await text(), /Review fixture image alternatives/);
    await navigateReport(base + '/social-media');
    await waitFor(async () => (await text()).includes('Report running'), 'Social page resumes backend progress after navigation');
    assert.equal(await evaluate('document.querySelector("[data-testid=social-run-report]").disabled'), true);
    await cdp.send('Page.reload');
    await waitFor(async () => (await text()).includes('Report running'), 'Social progress survives reload');
    await go();
    await waitFor(async () => (await text()).includes('Fresh report image alternatives'), 'investigation refreshes Dashboard results');
    await waitFor(async () => /Followers\s+17/.test(await sectionText('social-performance-title')), 'new Facebook report refreshes after leaving initiating page');
    assert.equal(requests.filter(item => item.method === 'POST').length, 2, 'Navigation and reload do not submit duplicate jobs.');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: ['both saved channels', 'business identity', 'zero versus unavailable', 'no invented scores or metrics', 'priority findings and linked recommendations', 'green connected assets', 'preserved section order and metric labels', 'failed attempts retain reports', 'refresh recovery', 'demo exclusion', 'business rejection', 'mobile overflow', 'investigation duplicate protection and fresh results'], artifactDirectory: artifacts }, null, 2));
  } else if (savedTarget) {
    const list = await (await fetch(savedTarget + '/api/businesses/demo-guzman/reports')).json();
    const candidate = list.reports.find(item => item.mode === 'live' && ['homepage', 'lighthouse'].includes(item.scope) && ['completed', 'partial'].includes(item.status));
    assert.ok(candidate, 'A saved real Website report is required for --saved.');
    const record = await (await fetch(savedTarget + '/api/audits/' + candidate.auditId + '/report')).json();
    await navigateReport(base + '/website');
    await waitFor(async () => (await text()).includes('Saved live results'), 'real saved Website report');
    assert.equal(await evaluate('document.querySelector("#selected-website option").textContent'), new URL(record.business.website).hostname);
    assert.equal(await evaluate('document.querySelector("time").dateTime'), record.audit.completedAt ?? record.generatedAt);
    const scores = await evaluate('Array.from(document.querySelectorAll("#website-health-title ~ * [role=img], section[aria-labelledby=website-health-title] [role=img]")).map(el => el.getAttribute("aria-label"))');
    for (const category of record.results.lighthouse?.categories ?? []) {
      if (category.availability === 'measured') assert.ok(scores.some(value => value.toLowerCase().startsWith((category.title + ': ' + category.score + ' out of 100').toLowerCase())), category.title + ' matches archive');
    }
    assert.equal(await evaluate('document.querySelector("#website-summary-title").closest("section").querySelector("[role=img]").getAttribute("aria-label")'), 'Score: not available');
    const expectedFindings = record.results.findings.filter(item => item.source === 'website');
    const visible = await text(); for (const finding of expectedFindings) assert.ok(visible.includes(finding.title));
    const priorities = await (await fetch(savedTarget + '/api/audits/' + candidate.auditId + '/website-analysis')).json();
    for (const finding of priorities.findings) {
      const card = await evaluate('document.getElementById(' + JSON.stringify(finding.id) + ').textContent');
      assert.ok(card.includes(finding.severity[0].toUpperCase() + finding.severity.slice(1)), 'Priority matches backend analysis.');
      const rec = priorities.recommendations.find(item => item.findingId === finding.id);
      if (rec) assert.ok(card.includes(rec.recommendedChange), 'Recommendation matches backend analysis.');
    }
    const summaries = await (await fetch(savedTarget + '/api/audits/' + candidate.auditId + '/evidence-summary')).json();
    for (const item of summaries.findings) {
      const shown = await evaluate('Array.from(document.getElementById(' + JSON.stringify(item.id) + ').querySelectorAll("h5")).find(el => el.textContent === "Evidence").parentElement.querySelector("p").textContent');
      assert.equal(shown, item.text, 'Frontend displays the backend summary exactly.');
      assert.ok(shown.length <= 280);
      assert.doesNotMatch(shown, /auditIds|scoreDisplayMode|data:image|categories/);
    }
    if (expectedFindings.length) await evaluate('document.getElementById(' + JSON.stringify(expectedFindings[0].id) + ').querySelector("button").click()');
    await evaluate(`document.querySelectorAll('section[aria-labelledby=website-findings-title] button[aria-expanded=false]').forEach(button => button.click())`);
    await assertDetailsFit('saved desktop details');
    await screenshot('saved-desktop.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    await assertDetailsFit('saved mobile details');
    await screenshot('saved-mobile.png');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: ['real archive through local API', 'business identity', 'original completion time', 'measured scores match archive', 'combined score unavailable', 'all website findings', 'mobile overflow'], auditId: candidate.auditId, artifactDirectory: artifacts }, null, 2));
  } else {
  const go = async () => { await navigateReport(base + '/website'); };
  await go();
  await waitFor(async () => (await text()).includes('Review fixture image alternatives'), 'saved Website report');
  assert.equal(await evaluate('document.querySelector("#selected-website").value'), business.id);
  assert.equal(await evaluate('document.querySelector("#selected-website option").textContent'), 'example.com');
  assert.match(await text(), /Website Health Summary/); assert.match(await text(), /SEO Spy Website Report/);
  assert.doesNotMatch(await text(), /Mock|Sample analyzed/);
  assert.equal(await evaluate('document.querySelectorAll("#findings-urgent-title, #findings-medium-title, #findings-low-title, #findings-great-title").length'), 4);
  const gauges = await evaluate('Array.from(document.querySelectorAll("[role=img]")).map(el => el.getAttribute("aria-label"))');
  assert.ok(gauges.includes('Score: not available'));
  assert.ok(gauges.some(value => value.startsWith('Performance: 0 out of 100')));
  assert.match(await text(), /Checks passed/);
  assert.equal(await evaluate('document.getElementById("fixture-finding").closest("section").querySelector("h3").textContent'), 'Urgent');
  assert.match(await evaluate('document.getElementById("fixture-finding").textContent'), /Backend priority recommendation/);
  assert.equal(await evaluate('document.querySelector("#findings-great-title").closest("section").querySelectorAll(":scope > ul > li").length'), 1);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Fix Now").click()');
  await waitFor(async () => (await text()).includes('<script>window.fixtureExecuted=true</script>'), 'finding evidence');
  assert.equal(await evaluate('window.fixtureExecuted === true'), false);
  assert.match(await text(), /Homepage HTML.*Oct 29, 2026/);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "View Fix Steps").click()');
  assert.match(await text(), /No changes have been applied/);
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Fix with AI").disabled'), true);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "View Details").click()');
  assert.match(await text(), /Passed in this Lighthouse run/);
  await assertDetailsFit('desktop columns');
  await screenshot('desktop.png');
  for (const width of [320, 390, 768, 1280]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await assertDetailsFit('viewport ' + width);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'no page overflow at ' + width);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  mode = 'failed-latest'; await go(); await waitFor(async () => (await text()).includes('latest website investigation failed'), 'failed newer attempt');
  assert.match(await text(), /Review fixture image alternatives/);
  mode = 'running'; await go(); await waitFor(async () => (await text()).includes('Investigation running'), 'active investigation');
  await waitFor(async () => await evaluate('document.querySelector("[data-testid=website-run-report]").disabled'), 'existing audit disables run');
  assert.match(await text(), /Review fixture image alternatives/);
  mode = 'error'; await evaluate('window.dispatchEvent(new Event("focus"))');
  await waitFor(async () => (await text()).includes('Saved reports are temporarily unavailable'), 'refresh error');
  assert.match(await text(), /Review fixture image alternatives/, 'last successful result survives refresh errors');
  mode = 'loaded'; await evaluate('window.dispatchEvent(new Event("focus"))');
  await waitFor(async () => !(await text()).includes('temporarily unavailable'), 'refresh recovers');
  const lighthouse = report.results.lighthouse; delete report.results.lighthouse; report.audit.scope = 'homepage'; report.audit.status = 'partial';
  await go(); await waitFor(async () => (await text()).includes('Partial coverage'), 'HTML-only partial report');
  assert.match(await text(), /passed-check totals are not available/);
  assert.equal(await evaluate('document.querySelector("#findings-great-title").closest("section").querySelectorAll(":scope > ul > li").length'), 0);
  report.results.lighthouse = lighthouse; report.audit.scope = 'lighthouse'; report.audit.status = 'completed';
  mode = 'analysis-mismatch'; await go(); await waitFor(async () => (await text()).includes('analysis did not match'), 'reject mismatched analysis');
  mode = 'mismatch'; await go(); await waitFor(async () => (await text()).includes('did not match this website investigation'), 'audit mismatch rejected');
  mode = 'empty'; await go(); await waitFor(async () => (await text()).includes('No saved website analysis is available'), 'demo/social records excluded');
  assert.equal(await evaluate('document.querySelector("#website-summary-title") === null'), true);
  mode = 'error'; await go(); await waitFor(async () => (await text()).includes('Saved reports are temporarily unavailable'), 'initial API failure');
  mode = 'loaded'; await go(); await waitFor(async () => (await text()).includes('Review fixture image alternatives'), 'report restored');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'no mobile overflow');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.method === 'GET'), 'report viewing performs no writes or provider calls');
  await waitFor(async () => await evaluate('!document.querySelector("[data-testid=website-run-report]").disabled'), 'run button ready');
  await evaluate('document.querySelector("[data-testid=website-run-report]").click(); document.querySelector("[data-testid=website-run-report]").click()');
  await waitFor(async () => (await text()).includes('Report running'), 'report queued');
  assert.equal(requests.filter(item => item.method === 'POST').length, 1, 'Rapid clicks create one report.');
  assert.deepEqual(requests.find(item => item.method === 'POST').body, { scope: 'lighthouse', strategy: 'mobile' });
  assert.match(await text(), /Review fixture image alternatives/, 'Previous results stay visible during collection.');
  await waitFor(async () => (await text()).includes('Fresh report image alternatives'), 'fresh report replaces saved results');
  await waitFor(async () => await evaluate('!document.querySelector("[data-testid=website-run-report]").disabled'), 'button re-enabled after completion');
  rejectRun = true;
  await evaluate('document.querySelector("[data-testid=website-run-report]").click()');
  await waitFor(async () => (await text()).includes('The report could not be started.'), 'submission error');
  assert.match(await text(), /Fresh report image alternatives/, 'Submission failure preserves saved results.');
  assert.equal(await evaluate('document.querySelector("[data-testid=website-run-report]").disabled'), false, 'Failed submission can be retried.');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const positions = await evaluate('const selector=document.querySelector("#selected-website").getBoundingClientRect(); const button=document.querySelector("[data-testid=website-run-report]").getBoundingClientRect(); ({selectorRight:selector.right, buttonLeft:button.left, selectorBottom:selector.bottom, buttonBottom:button.bottom})');
  assert.ok(positions.buttonLeft > positions.selectorRight, 'Button sits to the right of the selector.');
  assert.ok(Math.abs(positions.selectorBottom - positions.buttonBottom) < 2, 'Button and dropdown align.');
  await screenshot('run-report-desktop.png');
  console.log(JSON.stringify({ passed: ['live report', 'zero vs unavailable', 'binary passes', 'evidence disclosure', 'inert scraped text', 'review actions', 'failed latest attempt', 'active progress', 'retained results on refresh failure', 'refresh recovery', 'HTML-only partial', 'audit mismatch', 'demo/Facebook exclusion', 'initial API failure', 'mobile overflow', 'read-only API'], artifactDirectory: artifacts }, null, 2));
  }
} catch (error) { console.error(error); process.exitCode = 1; }

finally {
  if (cdp) { try { await cdp.send('Browser.close'); } catch { /* Browser may have closed. */ } cdp.close(); }
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
