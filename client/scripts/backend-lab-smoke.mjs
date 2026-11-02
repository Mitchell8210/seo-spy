// Offline fixtures by default. --dashboard checks the unified assessment and investigation workflow.
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
const analysisMode = process.argv.includes('--analysis');
const plannerMode = process.argv.includes('--planner');
const settingsMode = process.argv.includes('--settings');
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
let extraSocialOpportunities = false;
let plannerSocialResolved = false;
let plannerFacebookFailure = false;
let plannerFacebookDelayMs = 0;
let plannerNewFinding = false;
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

function savedFacebookReport() {
  const collectedAt = '2026-10-29T16:49:21.881Z';
  const auditId = 'facebook-fixture-audit';
  const finding = { id: 'facebook-fixture-finding', auditId, checkId: 'facebook:posts', evidenceIds: [],
    severity: 'medium', source: 'facebook', title: 'Confirm the Facebook contact number',
    explanation: 'Saved posts show different contact numbers.', status: 'needs_review' };
  return { businessId, analysis: null, latestAttempt: null, report: {
    schemaVersion: 'seo-spy.audit-report.v1', reportId: auditId, auditId, generatedAt: collectedAt,
    business: { id: businessId, name: 'Fixture Tax Accounting', website: 'https://example.com/' },
    audit: { id: auditId, businessId, scope: 'facebook', mode: 'live', status: 'partial', warnings: [], failure: null },
    results: { scores: [], findings: plannerSocialResolved ? [] : plannerNewFinding ? [finding, { ...finding, id: 'planner-new-finding', title: 'Review newly saved profile details' }] : extraSocialOpportunities ? [finding, ...[1, 2, 3].map(index => ({ ...finding, id: `remaining-${index}`, title: ['Review contact information', 'Check profile details', 'Contact information may be inconsistent'][index - 1], severity: index === 3 ? 'low' : 'medium' }))] : [finding], recommendations: extraSocialOpportunities ? [{ id: 'remaining-action', findingId: 'remaining-3', title: 'Review your saved contact details', explanation: finding.explanation, recommendedChange: 'Confirm the correct phone number in your connected profiles.', status: 'needs_review' }] : [], evidence: [], facebook: {
      pageId: 'fixture-page', pageName: 'Saved fixture Facebook Page', collectedAt,
      window: { requestedDays: 30 }, profile: {}, metrics: [],
    } },
  } };
}

// Planner-only saved Website contracts; no production/demo findings are injected.
const plannerWebsiteAuditId = '00000000-0000-4000-8000-000000000042';
const plannerWebsiteSeeds = [
  { id:'image-alt', title:'Add helpful image descriptions', severity:'medium', change:'Review recorded image descriptions and describe informative images.' },
  { id:'meta-description', title:'Clarify your search summary', severity:'low', change:'Review the saved homepage summary and describe your services clearly.' },
  { id:'business-hours', title:'Review recorded business hours', severity:'critical', change:'Confirm the business hours recorded on the website.' },
  { id:'contact-phone', title:'Review recorded contact information', severity:'medium', change:'Confirm the phone number recorded on the website.' },
];
const plannerExpectedTasks = [
  ...plannerWebsiteSeeds.map(item => ({id:`website:${item.id}`,title:item.title})),
  {id:'social:facebook-fixture-finding',title:'Confirm the Facebook contact number'},
];
function plannerWebsiteReport() {
  const auditId = plannerWebsiteAuditId;
  const generatedAt = '2026-10-29T16:49:21.881Z';
  const savedFindings = plannerWebsiteSeeds.map(item => ({id:item.id,auditId,checkId:item.id,evidenceIds:[`evidence-${item.id}`],
    title:item.title,severity:item.severity,source:'website',explanation:`The saved website report flags ${item.id}.`,status:'needs_review'}));
  return {schemaVersion:'seo-spy.audit-report.v1',reportId:auditId,auditId,generatedAt,
    business:{id:businessId,name:'Fixture Tax Accounting',website:'https://example.com/',createdAt:generatedAt},
    audit:{...summary(auditId,{scope:'homepage',mode:'live'}),completedAt:generatedAt,counts:{findings:savedFindings.length,recommendations:savedFindings.length}},
    results:{findings:savedFindings,
      evidence:savedFindings.map(item=>({id:item.evidenceIds[0],auditId,checkId:item.checkId,mode:'live',sourceUrl:'https://example.com/',collectedAt:generatedAt,observed:{fixture:item.id}})),
      recommendations:plannerWebsiteSeeds.map(item=>({id:`action-${item.id}`,auditId,findingId:item.id,title:item.title,
        explanation:'Review the saved website evidence.',recommendedChange:item.change,status:'needs_review'}))}};
}
function plannerWebsiteSummaries(report) {
  return {version:'programmatic-evidence-v1',auditId:report.auditId,checks:[],
    findings:report.results.findings.map(item=>({id:item.id,evidenceIds:item.evidenceIds,text:item.explanation,sourceLabel:'Saved homepage fixture'}))};
}

async function serveFixture(req, res) {
  apiRequests++;
  // Saved reports remain readable when the investigation service is unavailable.
  if (req.method === 'GET' && req.url === `/api/businesses/${businessId}/facebook-report`) {
    if (plannerFacebookDelayMs) await delay(plannerFacebookDelayMs);
    if (plannerFacebookFailure) return reply(res, 503, { error: { code: 'UNAVAILABLE', message: 'Saved Facebook report temporarily unavailable.' } });
    return reply(res, 200, savedFacebookReport());
  }
  if (!available) return reply(res, 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture backend unavailable. Please retry.', requestId: 'fixture-request' } });
  settleJobs();
  const route = new URL(req.url, 'http://fixture').pathname;
  if (plannerMode && req.method === 'GET') {
    const report = plannerWebsiteReport();
    if (route === `/api/businesses/${businessId}/reports`) return reply(res,200,{businessId,reports:[{
      reportId:report.reportId,auditId:report.auditId,businessId,scope:report.audit.scope,mode:'live',status:'completed',generatedAt:report.generatedAt,counts:report.audit.counts}]});
    if (route === `/api/audits/${report.auditId}/report`) return reply(res,200,report);
    if (route === `/api/audits/${report.auditId}/evidence-summary`) return reply(res,200,plannerWebsiteSummaries(report));
    if (route === `/api/audits/${report.auditId}/website-analysis`) return reply(res,200,{version:'website-priority-v1',auditId:report.auditId,
      findings:report.results.findings,recommendations:report.results.recommendations,
      priorities:report.results.findings.map(item=>({findingId:item.id,ruleId:'fixture-rule',severity:item.severity,reason:'Saved fixture priority',evidenceIds:item.evidenceIds}))});
  }

  const overall = id => {
    const audit = jobs.get(id)?.summary;
    if (!audit || audit.mode !== 'live') return null;
    return { id, businessId, audit: { ...audit, scoringVersion: 'overall-investigation-v1' },
      websiteReportId: audit.status === 'completed' ? id : null, facebookReportId: audit.status === 'completed' ? 'fixture-facebook' : null,
      assessmentId: audit.status === 'completed' ? 'fixture-assessment' : null };
  };
  if (route === '/api/facebook/investigations/status') {
    statusRequests++;
    return reply(res, 200, { businessId, active: activeId ? overall(activeId) : null, latest: activeId ? null : overall(latestId) });
  }
  if (route === '/api/health') return reply(res, 200, { status: 'ok', service: 'fixture', mode: 'demo' });
  if (route.endsWith('/dashboard')) return reply(res, 200, dashboard());
  if (req.method === 'POST' && (route.endsWith('/audits') || route === '/api/facebook/investigations')) {
    if (activeId) return reply(res, 409, { error: { code: 'AUDIT_ALREADY_ACTIVE', message: 'A fixture audit is already running.', requestId: 'fixture-request' } });
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = route === '/api/facebook/investigations' ? { scope: 'lighthouse', strategy: 'mobile' } : JSON.parse(body || '{}');
    if (route === '/api/facebook/investigations') assert.deepEqual(JSON.parse(body), { businessId });
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
    return reply(res, 202, route === '/api/facebook/investigations' ? overall(id) : { ...audit, status: 'queued', stage: 'queued', statusUrl: `/api/audits/${id}` });
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
const assessmentSelector = 'section[aria-labelledby="spy-total-title"]';
const dashboardMocks = () => evaluate(`JSON.stringify([...document.querySelectorAll('${assessmentSelector}, section[aria-labelledby="findings-title"], section[aria-labelledby="recommendations-title"]')].map(node => node.innerText))`);
async function assertUnifiedAssessment() {
  const assessment = await evaluate(`(() => {
    const section = document.querySelector('${assessmentSelector}');
    if (!section) return null;
    const social = section.querySelector('section[aria-label="Social Media Performance"]');
    return { count: document.querySelectorAll('${assessmentSelector}').length, text: section.innerText,
      categories: Array.from(section.querySelectorAll('h3')).map(node => node.textContent),
      socialText: social?.innerText, socialRings: social?.querySelectorAll('div[aria-label="Score: not available"] svg circle').length,
      socialIssues: social?.querySelectorAll('li').length,
      websiteLink: section.querySelector('a[href="/website"]')?.textContent,
      socialLink: section.querySelector('a[href="/social-media"]')?.textContent,
      details: section.querySelector('details summary')?.textContent,
      manage: document.querySelector('a[href="/settings#connected-assets"]')?.textContent,
    };
  })()`);
  assert.ok(assessment, 'Unified assessment must exist.');
  assert.equal(assessment.count, 1);
  assert.match(assessment.text, /Spy Total Score/);
  assert.deepEqual(assessment.categories, ['Website Health', 'Social Media Performance', 'Business Consistency']);
  assert.match(assessment.socialText, /—\s+Not available/);
  assert.doesNotMatch(assessment.socialText, /\b82\b|\/100/);
  assert.equal(assessment.socialRings, 1, 'Unavailable Social score must have only the empty gauge track.');
  assert.equal(assessment.websiteLink, 'Open Website Report');
  assert.equal(assessment.socialLink, 'Open Social Media Report');
  assert.equal(assessment.details, 'View Consistency Details');
  assert.equal(assessment.manage, 'Manage Connections');
  if (!liveMode) {
    assert.match(assessment.socialText, /Confirm the Facebook contact number/);
    assert.match(assessment.socialText, /Saved posts show different contact numbers/);
    assert.equal(assessment.socialIssues, 1, 'One backend finding must remain one finding.');
    assert.equal(await evaluate(`document.querySelector('${assessmentSelector} section[aria-label="Social Media Performance"] button')?.textContent`), 'Fix with AI');
  }
}

function assertDashboardRequests(requests) {
  assert.equal(requests.filter(request => /\/api\/audits\/[^/]+\/(findings|recommendations|lighthouse)(?:\?|$)/.test(request.url)).length, 0, 'Dashboard must not fetch website report details; saved Facebook reports are allowed.');
  for (const request of requests.filter(request => request.method === 'POST')) {
    assert.equal(new URL(request.url).pathname, '/api/facebook/investigations');
    assert.deepEqual(JSON.parse(request.postData ?? '{}'), { businessId });
  }
}

async function dashboardScenario(base, backendBase) {
  await cdp.send('Network.enable');
  const requestStart = browserRequests.length;
  await navigate(`${base}/dashboard`);
  await waitFor(async () => /Your online performance/.test(await pageText()) && await dashboardDisabled() === false, 'dashboard ready');
  if (!liveMode) await waitFor(async () => (await pageText()).includes('Confirm the Facebook contact number'), 'saved Facebook finding');
  await assertUnifiedAssessment();
  pass('Unified assessment preserves saved Facebook findings, unavailable Social score, and report actions');
  const mocks = await dashboardMocks();
  assert.match(await pageText(), /Demo overall score/i);
  assert.equal(creationCount, 0);
  assert.equal(browserRequests.slice(requestStart).filter(request => request.method === 'POST').length, 0, 'Loading the dashboard must not start an audit.');
  pass('Dashboard loads illustrative results without starting an audit');

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
    await assertUnifiedAssessment();
    assert.equal(await dashboardMocks(), mocks, 'Investigation status must preserve the assessment and lower demo results.');
    assert.doesNotMatch(await pageText(), /Fixture image review|Review fixture image text|fixture-13\.0\.0/);
    assertDashboardRequests(browserRequests.slice(requestStart));
  };
  const stopped = async () => {
    await delay(500); const polls = statusRequests; await delay(3000);
    assert.equal(statusRequests, polls, 'Terminal status must stop polling.');
  };
  await submit('completed');
  await terminal(liveMode ? /Investigation complete|partially completed|failed|could not complete/i : /Investigation complete\. Report generated\./);
  assert.match(await dashboardStatus(), /[a-f0-9-]{36}/i, 'Status must identify the backend audit.');
  pass('One mobile Lighthouse POST, duplicate prevention, stage progress, and unchanged mock results');
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
    pass('Partial provider failure preserves mock cards and stops polling');
    await submit('failed'); await terminal(/failed|could not complete/i); await stopped();
    pass('Full failure is shown without replacing illustrative cards');

    const expected = await submit('completed');
    await cdp.send('Page.reload');
    await waitFor(async () => await dashboardDisabled() === true, 'reload resumes active audit');
    assert.equal(creationCount, expected);
    pass('Reload resumes an active job without another POST');
    // Website now legitimately polls the same running audit; use a page without audit polling.
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
    await waitFor(async () => (await pageText()).includes('Confirm the Facebook contact number'), 'saved report after recovery');
    await assertUnifiedAssessment();
    assert.equal(await dashboardMocks(), mocks);
    await delay(800); assert.equal(creationCount, restartCreations);
    pass('Backend restart clears a missing active job through status-only retry');
  }
  if (!liveMode) {
    extraSocialOpportunities = true;
    await navigate(`${base}/dashboard`);
    await waitFor(async () => (await pageText()).includes('Contact information may be inconsistent'), 'remaining saved Social opportunity');
    const bottom = await evaluate(`(() => {
      const section = document.querySelector('#next-steps-title').closest('section');
      return { text: section.innerText, links: Array.from(section.querySelectorAll('a')).map(node => node.getAttribute('href')) };
    })()`);
    assert.match(bottom.text, /More Opportunities/);
    assert.match(bottom.text, /Recommended Path/);
    assert.match(bottom.text, /Contact information may be inconsistent/);
    assert.match(bottom.text, /Review your saved contact details/);
    assert.doesNotMatch(bottom.text, /Confirm the Facebook contact number|Review contact information|Check profile details|Missing image alt text|Business hours differ/);
    assert.match(bottom.text, /Confirm the correct phone number in your connected profiles/);
    assert.doesNotMatch(bottom.text, /opportunity \d+|Website and Business Consistency use demo data/i);
    assert.equal((bottom.text.match(/Saved posts show different contact numbers/g) ?? []).length, 1, 'Evidence is not repeated as recommendation copy.');
    assert.deepEqual(bottom.links, [`/social-media?businessId=${businessId}`, `/social-media?businessId=${businessId}`]);
    await evaluate(`document.querySelector('#findings-title').closest('section').querySelector('a').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(() => evaluate('location.pathname === "/social-media"'), 'opportunity keyboard navigation');
    pass('Remaining saved opportunities and linked actions exclude triage issues and navigate by keyboard');
  }
  assertDashboardRequests(browserRequests.slice(requestStart));
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ mode: liveMode ? 'live-dashboard' : 'fixture-dashboard', passed: results.length, scenarios: results, artifactDirectory: artifactDir }, null, 2));
}

async function analysisScenario(base) {
  await cdp.send('Network.enable');
  const requestStart = browserRequests.length;
  await navigate(`${base}/analysis`);
  await waitFor(()=>evaluate(`document.querySelector('h1')?.textContent === 'Analysis & Revenue'`),'Analysis route');
  assert.equal(await evaluate(`document.querySelectorAll('#primary-navigation a[href="/analysis"]').length`),1);
  assert.equal(await evaluate(`document.querySelector('#primary-navigation a[href="/analysis"]').getAttribute('aria-current')`),'page');
  assert.equal(await evaluate(`document.querySelector('#primary-navigation a[href="/analysis"]').textContent`),'Analysis & Revenue');
  assert.match(await pageText(),/Demo analytics/);
  for(const title of ['Traffic Over Time','Traffic by Channel','Users by Device','Top Pages','Revenue Calculator']) assert.ok((await pageText()).includes(title));
  assert.equal(await evaluate(`document.querySelectorAll('[data-analysis-kpi]').length`),4);
  assert.equal(await evaluate(`document.getElementById('customer-value').value`),'150');
  assert.equal(await evaluate(`document.getElementById('assumed-conversion').value`),'2');
  assert.equal(await evaluate(`document.getElementById('monthly-visitors').readOnly`),true);
  const visitors=Number((await evaluate(`document.getElementById('monthly-visitors').value`)).replaceAll(',',''));
  assert.equal(visitors,1254);
  const usd=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
  async function setInput(id,value) {
    await evaluate(`(() => {const node=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  async function revenue(expected) { await waitFor(()=>evaluate(`document.querySelector('[data-testid="estimated-revenue"]').textContent.startsWith(${JSON.stringify(expected)})`),'revenue update'); }
  await revenue(usd(visitors*.02*150));
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Analytics summary"] article svg')).map(node=>({width:node.getBoundingClientRect().width,badge:node.parentElement.getBoundingClientRect().width}))`),Array.from({length:4},()=>({width:22,badge:36})));
  assert.equal(await evaluate(`document.querySelector('section[aria-labelledby="traffic-title"] polyline').getAttribute('stroke')`),'#22C55E');
  assert.equal(await evaluate(`document.querySelector('section[aria-labelledby="revenue-title"] [role="status"] svg').getAttribute('width')`),'36');
  const beforeEdits=browserRequests.length;
  await setInput('customer-value','200');await revenue(usd(visitors*.02*200));
  await setInput('assumed-conversion','3');await revenue(usd(visitors*.03*200));
  for(const growth of [10,20]) {
    const copy=await evaluate(`document.querySelector('[data-testid="traffic-scenario-${growth}"]').innerText`);
    assert.ok(copy.includes(usd(visitors*(1+growth/100)*.03*200)));
    assert.ok(copy.includes(usd(visitors*growth/100*.03*200)));
  }
  await setInput('customer-value','');await revenue('—');
  await setInput('customer-value','-5');await revenue('—');
  await setInput('customer-value','150');
  await setInput('assumed-conversion','');await revenue('—');
  await setInput('assumed-conversion','-2');await revenue('—');
  await setInput('assumed-conversion','120');await revenue(usd(visitors*150));
  assert.equal(await evaluate(`document.getElementById('assumed-conversion').value`),'100');
  await setInput('assumed-conversion','0');await revenue('$0');
  await setInput('assumed-conversion','2');await revenue(usd(visitors*.02*150));
  await evaluate(`document.getElementById('customer-value').focus()`);
  assert.equal(await evaluate(`document.activeElement.id`),'customer-value');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  assert.ok(Number(await evaluate(`document.getElementById('customer-value').value`))>150);
  await setInput('customer-value','150');
  await evaluate(`Array.from(document.querySelectorAll('[aria-label="Traffic metric"] button')).find(node=>node.textContent==='sessions').click()`);
  assert.match(await evaluate(`document.querySelector('section[aria-labelledby="traffic-title"] svg').getAttribute('aria-label')`),/sessions/);
  await delay(200);
  assert.equal(browserRequests.length,beforeEdits,'Calculator changes and chart controls make no network requests');
  assert.equal(browserRequests.slice(requestStart).filter(item=>item.url.includes('/api/')).length,0,'No analytics/operator APIs or database writes');
  async function contrastAudit() {
    return evaluate(`(${function () {
      const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently:true});
      ctx.canvas.width=ctx.canvas.height=1;
      const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).map((value,index)=>index===3?value/255:value)};
      const over=(fg,bg)=>[0,1,2].map(index=>fg[index]*(fg[3]??1)+bg[index]*(1-(fg[3]??1)));
      const background=node=>{const chain=[];for(let current=node;current;current=current.parentElement)chain.unshift(current);return chain.reduce((bg,item)=>over(rgba(getComputedStyle(item).backgroundColor),bg),[255,255,255])};
      const luminance=color=>color.map(value=>value/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
      const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const rows=[];
      function check(group,selector,threshold=4.5,property='color',againstParent=false) {
        for(const node of document.querySelectorAll(selector)) {
          if(property==='color' && !node.textContent.trim() && !node.matches('input,svg')) continue;
          const bg=background(againstParent?node.parentElement:node),raw=rgba(getComputedStyle(node)[property]),fg=over(raw,bg);
          rows.push({group,label:(node.textContent||node.getAttribute('aria-label')||node.tagName).trim().slice(0,70),foreground:fg.map(Math.round),background:bg.map(Math.round),ratio:Number(contrast(fg,bg).toFixed(2)),threshold});
        }
      }
      check('KPI labels','[aria-label="Analytics summary"] h2');
      check('KPI values','[data-analysis-kpi]',3);
      check('KPI icons','[aria-label="Analytics summary"] svg',3);
      check('Channel legend text','section[aria-labelledby="channel-title"] li');
      check('Channel legend text','section[aria-labelledby="channel-title"] li span');
      check('Channel legend dots','section[aria-labelledby="channel-title"] li span[style]',3,'backgroundColor',true);
      check('Traffic axis labels','section[aria-labelledby="traffic-title"] svg text');
      check('Calculator labels','section[aria-labelledby="revenue-title"] label');
      check('Input text','section[aria-labelledby="revenue-title"] input');
      check('Input boundaries','section[aria-labelledby="revenue-title"] input',3,'borderTopColor',true);
      check('Input boundaries against fill','section[aria-labelledby="revenue-title"] input',3,'borderTopColor');
      check('Estimated Revenue label','section[aria-labelledby="revenue-title"] [role="status"] h3');
      check('Estimated Revenue value','[data-testid="estimated-revenue"]',3);
      check('Estimated Revenue supporting text','section[aria-labelledby="revenue-title"] [role="status"] p:not([data-testid]), [data-testid="estimated-revenue"] span');
      check('Scenario text','[data-testid^="traffic-scenario-"] h3, [data-testid^="traffic-scenario-"] p, [data-testid^="traffic-scenario-"] p span');
      check('Disclaimer','section[aria-labelledby="revenue-title"] > div:last-child p');
      check('Calculator icon badge','section[aria-labelledby="revenue-title"] header svg',3);
      check('Coins icon','section[aria-labelledby="revenue-title"] [role="status"] svg',3);
      check('Scenario icons','[data-testid^="traffic-scenario-"] svg',3);
      check('Traffic line','section[aria-labelledby="traffic-title"] polyline',3,'stroke');
      check('Traffic points','section[aria-labelledby="traffic-title"] circle',3,'fill');
      check('Metric control text','[aria-label="Traffic metric"] button');
      const input=document.getElementById('customer-value');input.focus();
      const outline=getComputedStyle(input);
      check('Keyboard focus on card','#customer-value',3,'outlineColor',true);
      check('Keyboard focus on input','#customer-value',3,'outlineColor');
      return {rows,focus:{visible:input.matches(':focus-visible'),style:outline.outlineStyle,width:outline.outlineWidth},nativeTooltip:'SVG title: browser/OS controlled, no author-specified text/background colors'};
    }.toString()})()`);
  }
  const contrastReport=await contrastAudit();
  await writeFile(path.join(artifactDir,'analysis-contrast.json'),JSON.stringify(contrastReport,null,2));
  console.log('Analysis contrast:',JSON.stringify(Object.fromEntries([...new Set(contrastReport.rows.map(item=>item.group))].map(group=>[group,Math.min(...contrastReport.rows.filter(item=>item.group===group).map(item=>item.ratio))]))),JSON.stringify(contrastReport.focus));
  const contrastFailures=contrastReport.rows.filter(item=>item.ratio<item.threshold);
  assert.deepEqual(contrastFailures,[],'Analysis contrast thresholds');
  assert.equal(contrastReport.focus.visible,true,'Keyboard focus visibly rendered');
  assert.notEqual(contrastReport.focus.style,'none');
  for(const width of [1440,768,390,320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await evaluate('window.scrollTo(0,0)');await delay(120);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),true,`Analysis fits ${width}px`);
    const boxes = await evaluate(`Object.fromEntries(['traffic-title','revenue-title','channel-title','device-title','pages-title'].map(id=>{const r=document.getElementById(id).closest('section').getBoundingClientRect();return [id,{top:r.top,bottom:r.bottom,left:r.left,right:r.right}]}))`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Analytics summary"] article h2')).every(node=>node.scrollWidth<=node.clientWidth+1)`),true,'KPI labels fit without overflow');
    assert.equal(await evaluate(`document.querySelector('[data-testid="estimated-revenue"]').scrollWidth<=document.querySelector('[data-testid="estimated-revenue"]').clientWidth+1`),true,'Revenue and Coins fit');
    const chart=boxes['traffic-title'],calculator=boxes['revenue-title'],channel=boxes['channel-title'],device=boxes['device-title'],pages=boxes['pages-title'];
    if(width===1440) {
      assert.ok(Math.abs(chart.top-calculator.top)<2,'Calculator and chart align at the top');
      assert.ok(Math.abs(channel.top-chart.bottom-20)<2,'Breakdown starts one existing gap below the chart');
      assert.ok(Math.abs(channel.top-device.top)<2 && Math.abs(channel.top-pages.top)<2,'Three breakdown cards share a desktop row');
      assert.ok(channel.top<calculator.bottom,'Calculator height does not delay breakdown placement');
      assert.ok(pages.right<=calculator.left && channel.right<=device.left && device.right<=pages.left,'Columns do not overlap');
    } else {
      assert.ok(chart.bottom<=calculator.top && calculator.bottom<=channel.top,'Stacked chart, calculator, then breakdown order');
      if(width<768) assert.ok(channel.bottom<=device.top && device.bottom<=pages.top,'Mobile breakdown cards stack');
      else assert.ok(Math.abs(channel.top-device.top)<2 && pages.top>=Math.max(channel.bottom,device.bottom),'Tablet breakdown uses readable two-column rows');
    }
    await screenshot(`analysis-revenue-${width}.png`);
  }
  await evaluate(`document.querySelector('button[aria-controls="primary-navigation"]').click()`);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('primary-navigation')).visibility`),'visible');
  assert.equal(await evaluate(`document.querySelectorAll('a[href="/analysis"]').length`),1);
  assert.deepEqual(browserErrors,[]);
  pass('Analysis route/active/mobile navigation, demo graphics, calculator defaults/math/scenarios/input validation/keyboard, zero network writes, and four responsive widths');
  console.log(JSON.stringify({passed:results,artifactDirectory:artifactDir},null,2));
}

async function plannerScenario(base) {
  await cdp.send('Network.enable');
  const requestStart = browserRequests.length;
  const readCount = () => browserRequests.slice(requestStart).filter(item => item.url.includes('/facebook-report')).length;
  const kpi = label => evaluate(`document.querySelector('[data-kpi="${label}"]').textContent`);
  async function pressEnter() {
    await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
    await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  }
  async function setField(id, value) {
    await evaluate(`(() => { const node = document.getElementById(${JSON.stringify(id)}); const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, ${JSON.stringify(value)}); node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`);
  }
  async function clickText(text, container = 'document') {
    await evaluate(`Array.from(${container}.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
  }
  async function fixTask(id, mode) {
    await evaluate(`document.querySelector('[data-task-id="${id}"] button[aria-label^="${mode === 'ai' ? 'Fix with AI:' : 'Manual Fix:'}"]').click()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`), 'fix dialog');
    assert.equal(await evaluate(`Array.from(document.querySelector('dialog').querySelectorAll('button')).find(button => button.textContent.includes('Mark as Done')).disabled`),true,'Completion needs user confirmation');
    await evaluate(`document.querySelector('dialog input[type="checkbox"]').click()`);
    await clickText('Mark as Done', "document.querySelector('dialog')");
    await waitFor(() => evaluate(`document.querySelector('[data-task-id="${id}"]').innerText.includes('Done')`), 'task Done');
  }
  async function dragTask(id, day, hour, fromCalendar = false) {
    const selector = fromCalendar ? `[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]` : `[data-task-id="${id}"]`;
    await evaluate(`(() => { window.plannerDragData = new DataTransfer(); document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.plannerDragData})); })()`);
    await delay(40);
    await evaluate(`document.querySelector('[data-calendar-slot="${day}:${hour}"]').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.plannerDragData}))`);
    await waitFor(() => evaluate(`document.querySelector('[data-calendar-slot="${day}:${hour}"]').dataset.dropActive === 'true'`),'active calendar drop highlight');
    await evaluate(`document.querySelector('[data-calendar-slot="${day}:${hour}"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:window.plannerDragData}))`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window.plannerDragData}))`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]').length`),1,'A task has one calendar block');
    assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]').parentElement.dataset.calendarSlot`),`${day}:${hour}`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-drop-active="true"]').length`),0);
  }
  async function rescan() {
    await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Re-scan' && !button.disabled)`),'Re-scan ready');
    const reads = readCount(); await clickText('Re-scan');
    await waitFor(() => readCount() > reads, 'saved findings refresh GET');
    await waitFor(async () => (await pageText()).includes('Current saved findings refreshed.'), 'refresh completion');
  }
  await navigate(`${base}/recommendations`);
  await waitFor(async () => (await pageText()).includes('Confirm the Facebook contact number'), 'shared saved Facebook planner source');
  await waitFor(() => evaluate(`document.querySelectorAll('article[data-task-id]').length === ${plannerExpectedTasks.length}`),'all saved channel findings');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('article[data-task-id]')).map(node=>({id:node.dataset.taskId,title:node.querySelector('h3').textContent})).sort((a,b)=>a.id.localeCompare(b.id))`),[...plannerExpectedTasks].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id^="consistency:"]').length`),0,'No unsupported demo consistency tasks');

  assert.equal(await evaluate('document.querySelector("h1").textContent'),'Smart Planner');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#primary-navigation a')).map(node => node.textContent)`),['Dashboard','Website','Social Media','Analysis & Revenue','Smart Planner','Connections & Settings']);
  assert.doesNotMatch(await pageText(),/Pending Verification|How It Works|Google Calendar|Microsoft Outlook|Trello/);
  assert.equal(await evaluate(`document.querySelector('dialog[open]') === null`),true);
  assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length)); assert.equal(await kpi('Done'),'0'); assert.equal(await kpi('Plan Completion (This Week)'),'0%');
  assert.equal(await evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`),'false');
  assert.equal(await evaluate(`new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node => node.dataset.calendarSlot.split(':')[0])).size`),5);
  assert.equal(await evaluate(`document.querySelectorAll('article[data-task-id] button[aria-label^="Fix with AI:"]').length`),plannerExpectedTasks.length);
  assert.equal(await evaluate(`document.querySelectorAll('article[data-task-id] button[aria-label^="Manual Fix:"]').length`),plannerExpectedTasks.length);
  pass('Smart Planner route, exact sidebar, six KPIs, shared sources, both fix actions, business-day defaults, and no prohibited sections');
  const businessDays = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node => node.dataset.calendarSlot.split(':')[0]))).sort()`);
  await dragTask('website:image-alt',businessDays[2],13);
  await dragTask('website:image-alt',businessDays[3],14);
  await dragTask('website:image-alt',businessDays[1],15,true);
  assert.equal(await kpi('Done'),'0'); assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length));
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task]').length`),1);
  pass('Direct recommendation drops assign day/time, calendar moves reuse the same task, active status stays unchanged, and drop highlighting clears');
  await clickText('Auto Plan (AI)');
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task]').length === ${plannerExpectedTasks.length}`),'automatic planning');
  await fixTask('website:image-alt','manual');
  assert.equal(await kpi('Done'),'1'); assert.equal(await kpi('Plan Completion (This Week)'),`${Math.round(100 / plannerExpectedTasks.length)}%`);
  assert.ok((await evaluate(`document.querySelector('[data-kpi="Done"]').parentElement.querySelector('span').className`)).includes('text-blue-300'));
  assert.ok((await evaluate(`document.querySelector('[data-kpi="Plan Completion (This Week)"]').parentElement.querySelector('span').className`)).includes('text-indigo-300'));
  assert.ok((await evaluate(`document.querySelector('[data-kpi="Plan Completion (This Week)"]').closest('article').querySelector('.h-full').className`)).includes('bg-indigo-400'));
  assert.ok((await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').className`)).includes('text-blue-200'));
  await fixTask('social:facebook-fixture-finding','ai');
  assert.equal(await kpi('Done'),'2');
  await rescan();
  await waitFor(async () => await kpi('Done') === '0','unresolved findings reopen');
  await fixTask('social:facebook-fixture-finding','manual');
  plannerSocialResolved = true; await rescan();
  assert.equal(await kpi('Done'),'1','A source-resolved task stays completed');
  plannerSocialResolved = false; await rescan();
  await waitFor(async () => await kpi('Done') === '0','returning source issue reopens');
  pass('Manual/AI preview confirmation, derived completion, source refresh, unresolved reopen, and resolved completion retention');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Add Custom Task').focus()`);
  await pressEnter(); await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`),'keyboard custom task');
  await setField('planner-task-name','Review local business notes');
  await setField('planner-priority','Urgent');
  await clickText('Add Task',"document.querySelector('dialog')");
  await waitFor(async () => (await pageText()).includes('Review local business notes'),'custom task created');
  assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length + 1));
  for (const [priority,color] of [['Urgent','red'],['Medium','amber'],['Low','emerald']]) {
    const badge = await evaluate(`(() => { const row = Array.from(document.querySelectorAll('[data-task-id]')).find(node => node.querySelector('div > span:last-child')?.textContent === '${priority}'); const badge = row.querySelector('div > span:first-child'); return {classes:badge.className,iconColor:getComputedStyle(badge.querySelector('svg')).color,badgeColor:getComputedStyle(badge).color}; })()`);
    for (const token of [`border-${color}-400/40`,`bg-${color}-400/15`,`text-${color}-300`]) assert.ok(badge.classes.includes(token),`${priority} badge uses ${token}`);
    assert.equal(badge.iconColor,badge.badgeColor,'Icon inherits the urgency color');
  }
  pass('Urgent, Medium, and Low badges use matching icon, background, and border colors while preserving urgency pills');

  const customId = await evaluate(`Array.from(document.querySelectorAll('[data-task-id]')).find(node => node.innerText.includes('Review local business notes')).dataset.taskId`);
  await evaluate(`document.querySelector('[data-task-id="${customId}"] button[aria-label^="Schedule or reschedule:"]').focus()`);
  await pressEnter(); await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`),'keyboard scheduling');
  const originalDay = await evaluate(`document.getElementById('planner-day').value`);
  await setField('planner-hour','15'); await clickText('Save Schedule',"document.querySelector('dialog')");
  assert.match(await evaluate(`document.querySelector('[data-task-id="${customId}"]').innerText`),/15:00/);
  const secondDay = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node => node.dataset.calendarSlot.split(':')[0]))).sort()[1]`);
  await dragTask(customId,secondDay,14,true);
  assert.match(await evaluate(`document.querySelector('[data-task-id="${customId}"]').innerText`),/14:00/);
  await clickText('Plan Manually'); await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`),'manual planning alternative');
  await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  const saturday = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node => node.dataset.calendarSlot.split(':')[0]))).sort()[5]`);
  assert.ok(saturday);
  await dragTask(customId,saturday,11);
  await evaluate(`document.querySelector('[data-task-id="${customId}"] button[aria-label^="Schedule or reschedule:"]').click()`);
  await setField('planner-day',saturday); await clickText('Save Schedule',"document.querySelector('dialog')");
  assert.ok((await evaluate(`document.querySelector('[data-task-id="${customId}"]').innerText`)).includes(saturday));
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  assert.equal(await evaluate(`new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node => node.dataset.calendarSlot.split(':')[0])).size`),5);
  assert.ok(!(await evaluate(`document.querySelector('[data-task-id="${customId}"]').innerText`)).includes(saturday));
  await evaluate(`document.querySelector('[data-task-id="${customId}"] button[aria-label^="Schedule or reschedule:"]').click()`);
  await setField('planner-day',saturday); await clickText('Save Schedule',"document.querySelector('dialog')");
  assert.match(await pageText(),/Enable Use Weekends before scheduling/);
  await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);
  await clickText('Auto Plan (AI)');
  const range = await elementText('planner-date-range');
  await evaluate(`document.querySelector('button[aria-label="Next week"]').click()`);
  assert.notEqual(await elementText('planner-date-range'),range);
  await evaluate(`document.querySelector('button[aria-label="Previous week"]').click()`);
  assert.equal(await elementText('planner-date-range'),range);
  assert.ok(originalDay);
  pass('Custom tasks, keyboard creation, manual scheduling, native drop handlers, week controls, and weekend restrictions without data loss');
  async function setView(view) {
    await evaluate(`(() => { const node = document.querySelector('select[aria-label="Calendar view"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,${JSON.stringify(view)}); node.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  }
  async function monthDrop(id, day, fromCalendar = false, allowed = true) {
    const source = fromCalendar ? `[data-testid="monthly-calendar"] [data-calendar-task="${id}"]` : `[data-task-id="${id}"]`;
    const previous = await evaluate(`document.querySelector('[data-task-id="${id}"]').innerText`);
    await evaluate(`(() => { window.plannerDragData = new DataTransfer(); document.querySelector(${JSON.stringify(source)}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.plannerDragData})); })()`);
    await delay(40);
    await evaluate(`document.querySelector('[data-month-day="${day}"]').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.plannerDragData}))`);
    assert.equal(await evaluate(`document.querySelector('[data-month-day="${day}"]').dataset.dropActive === 'true'`),allowed);
    await evaluate(`document.querySelector('[data-month-day="${day}"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:window.plannerDragData}))`);
    if (allowed) {
      assert.equal(await evaluate(`document.querySelectorAll('[data-testid="monthly-calendar"] [data-calendar-task="${id}"]').length`),1);
      assert.equal(await evaluate(`document.querySelector('[data-testid="monthly-calendar"] [data-calendar-task="${id}"]').parentElement.dataset.monthDay`),day);
    } else assert.equal(await evaluate(`document.querySelector('[data-task-id="${id}"]').innerText`),previous);
  }
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Calendar view"]').value`),'weekly');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('select[aria-label="Calendar view"]').options).map(option=>option.textContent)`),['Weekly View','Monthly View']);
  await setView('monthly');
  const monthInfo = await evaluate(`(() => { const nodes = Array.from(document.querySelectorAll('[data-month-day]')); const inside=nodes.filter(node=>node.dataset.inMonth === 'true').map(node=>node.dataset.monthDay); const [year,month]=inside[0].split('-').map(Number); return {count:nodes.length,inside,expected:new Date(year,month,0).getDate(),start:new Date(nodes[0].dataset.monthDay+'T12:00:00').getDay(),end:new Date(nodes.at(-1).dataset.monthDay+'T12:00:00').getDay()}; })()`);
  assert.equal(monthInfo.count % 7,0); assert.equal(monthInfo.inside.length,monthInfo.expected); assert.equal(new Set(monthInfo.inside).size,monthInfo.expected); assert.equal(monthInfo.start,1); assert.equal(monthInfo.end,0);
  for (const [id,color] of [['website:image-alt','amber'],['website:meta-description','emerald'],[customId,'red']]) {
    assert.ok((await evaluate(`document.querySelector('[data-testid="monthly-calendar"] [data-calendar-task="${id}"]').className`)).includes(`text-${color}-300`));
  }
  await monthDrop('website:image-alt',businessDays[2]);
  assert.match(await evaluate(`document.querySelector('[data-task-id="website:image-alt"]').innerText`),/15:00/);
  await monthDrop('website:image-alt',businessDays[3],true);
  const weekend = await evaluate(`document.querySelector('[data-month-day][data-in-month="true"][data-drop-disabled="true"]').dataset.monthDay`);
  await monthDrop('website:image-alt',weekend,false,false);
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  await monthDrop('website:image-alt',weekend);
  await monthDrop('website:image-alt',businessDays[2],true);
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  assert.equal(await kpi('Done'),'0'); assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length + 1));
  await evaluate(`document.querySelector('[data-testid="monthly-calendar"] [data-calendar-task="website:image-alt"]').focus()`);
  await pressEnter(); await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`),'monthly keyboard editing');
  assert.equal(await evaluate(`document.getElementById('planner-day').value`),businessDays[2]);
  await setField('planner-hour','16'); await clickText('Save Schedule',"document.querySelector('dialog')");
  await setView('weekly');
  assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').parentElement.dataset.calendarSlot`),`${businessDays[2]}:16`);
  await dragTask('website:image-alt',businessDays[1],14,true);
  await setView('monthly');
  assert.equal(await evaluate(`document.querySelector('[data-testid="monthly-calendar"] [data-calendar-task="website:image-alt"]').parentElement.dataset.monthDay`),businessDays[1]);
  const monthLabel = await elementText('planner-date-range');
  await evaluate(`document.querySelector('[aria-label="Next month"]').click()`);
  assert.notEqual(await elementText('planner-date-range'),monthLabel);
  await evaluate(`document.querySelector('[aria-label="Previous month"]').click()`);
  assert.equal(await elementText('planner-date-range'),monthLabel);
  await fixTask(customId,'manual');
  assert.ok((await evaluate(`document.querySelector('[data-testid="monthly-calendar"] [data-calendar-task="${customId}"]').className`)).includes('text-blue-200'));
  pass('Full monthly grid, urgency/completion colors, shared weekly/monthly state, date moves without duplicates, weekend rejection/enablement, and keyboard editing');
  await setView('weekly');
  for (const width of [1440,768,390,320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await evaluate('window.scrollTo(0,0)'); await delay(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),true,`Planner has no overflow at ${width}`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="${width<768 ? 'mobile-day-grid' : 'desktop-week-grid'}"]')).display !== 'none'`),true);
    await screenshot(`smart-planner-${width}.png`);
    await setView('monthly');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),true,`Monthly planner has no page overflow at ${width}`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-month-day]').length % 7`),0);
    await screenshot(`smart-planner-monthly-${width}.png`);
    await setView('weekly');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const storageKey = `seo-spy:planner:v1:${businessId}`;
  const savedState = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`);
  async function awaitSource() {
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-task-id="social:facebook-fixture-finding"]')) && Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Re-scan' && !button.disabled) && !document.querySelector('[role="alert"]')`),'saved Facebook source ready');
  }
  async function visitDashboardAndReturn() {
    await evaluate(`document.querySelector('#primary-navigation a[href="/dashboard"]').click()`);
    await waitFor(() => evaluate(`location.pathname === '/dashboard' && document.querySelector('h1')?.textContent === 'Dashboard'`),'Dashboard navigation and Planner unmount');
    await evaluate(`document.querySelector('#primary-navigation a[href="/recommendations"]').click()`);
    await waitFor(() => evaluate(`location.pathname === '/recommendations' && Boolean(document.querySelector('[data-task-id="website:image-alt"]'))`),'Planner remount');
    await awaitSource();
  }
  async function reloadPlanner() {
    await evaluate(`window.plannerReloadPending = true`);
    await cdp.send('Page.reload');
    await waitFor(() => evaluate(`!window.plannerReloadPending && Boolean(document.querySelector('[data-task-id="website:image-alt"]'))`),'Planner document reload');
  }
  // Monthly navigation selected a different week; remount restores the normal current-week cursor.
  await visitDashboardAndReturn();
  await dragTask('website:image-alt',businessDays[2],10);
  await waitFor(async () => (await savedState()).edits['website:image-alt']?.schedule.hour === 10,'schedule persisted');
  await visitDashboardAndReturn();
  assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').parentElement.dataset.calendarSlot`),`${businessDays[2]}:10`);
  await reloadPlanner(); await awaitSource();
  assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').parentElement.dataset.calendarSlot`),`${businessDays[2]}:10`);
  await dragTask('website:image-alt',businessDays[3],13,true);
  await waitFor(async () => (await savedState()).edits['website:image-alt']?.schedule.hour === 13,'moved schedule persisted');
  await reloadPlanner(); await awaitSource();
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').length`),1);
  assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="website:image-alt"]').parentElement.dataset.calendarSlot`),`${businessDays[3]}:13`);
  await fixTask('website:image-alt','manual');
  await visitDashboardAndReturn();
  assert.match(await evaluate(`document.querySelector('[data-task-id="website:image-alt"]').innerText`),/Done/);
  await reloadPlanner(); await awaitSource();
  assert.equal((await savedState()).completed['website:image-alt'].status,'Done');
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id="${customId}"]').length`),1);
  assert.match(await evaluate(`document.querySelector('[data-task-id="${customId}"]').innerText`),/Done/);
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  await visitDashboardAndReturn();
  assert.equal(await evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`),'true');
  await reloadPlanner(); await awaitSource();
  assert.equal(await evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`),'true');
  await evaluate(`document.querySelector('button[role="switch"]').click()`);
  await visitDashboardAndReturn();
  assert.equal(await evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`),'false');
  pass('Schedules, moves without duplication, custom tasks, Done, and both weekend preferences survive navigation and browser reload');
  await dragTask('social:facebook-fixture-finding',businessDays[2],11);
  await waitFor(async () => (await savedState()).edits['social:facebook-fixture-finding']?.schedule.hour === 11,'Facebook assignment persisted');
  plannerFacebookDelayMs = 600;
  await reloadPlanner();
  assert.equal((await savedState()).edits['social:facebook-fixture-finding'].schedule.hour,11,'Loading must retain saved Facebook assignments');
  await awaitSource(); plannerFacebookDelayMs = 0;
  plannerFacebookFailure = true;
  await reloadPlanner();
  await waitFor(async () => (await pageText()).includes('Saved Facebook findings could not be refreshed.'),'Facebook failure feedback');
  assert.equal((await savedState()).edits['social:facebook-fixture-finding'].schedule.hour,11,'Failure must retain saved Facebook assignments');
  plannerFacebookFailure = false;
  await reloadPlanner(); await awaitSource();
  assert.equal(await evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="social:facebook-fixture-finding"]').parentElement.dataset.calendarSlot`),`${businessDays[2]}:11`);
  plannerNewFinding = true; await rescan();
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-task-id="social:planner-new-finding"]'))`),'new source finding');
  assert.match(await evaluate(`document.querySelector('[data-task-id="social:planner-new-finding"]').innerText`),/Schedule task/);
  assert.equal(await evaluate(`document.querySelectorAll('[data-calendar-task="social:planner-new-finding"]').length`),0);
  plannerSocialResolved = true; await rescan();
  await waitFor(() => evaluate(`!document.querySelector('[data-task-id="social:facebook-fixture-finding"]')`),'stale active finding removed');
  await waitFor(async () => !(await savedState()).edits['social:facebook-fixture-finding'],'stale source association pruned');
  await reloadPlanner();
  await waitFor(() => evaluate(`Boolean(document.querySelector('button[role="switch"]')) && !document.querySelector('button[role="switch"]').disabled`),'Planner loaded');
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id="social:facebook-fixture-finding"]').length`),0);
  plannerSocialResolved = false; plannerNewFinding = false; await rescan(); await awaitSource();
  assert.match(await evaluate(`document.querySelector('[data-task-id="social:facebook-fixture-finding"]').innerText`),/Schedule task/,'Pruned assignments do not resurrect with a returning finding');
  pass('Facebook assignments survive loading/failure; new findings start unscheduled and successfully removed findings cannot resurrect stale assignments');
  // Corrupt only this planner entry; unrelated storage must survive.
  await evaluate(`localStorage.setItem('planner-test-unrelated','keep'); localStorage.setItem(${JSON.stringify(storageKey)},'{invalid json')`);
  await reloadPlanner(); await awaitSource();
  assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length)); assert.equal(await kpi('Done'),'0');
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task]').length`),0);
  assert.equal(await evaluate(`localStorage.getItem('planner-test-unrelated')`),'keep');
  const storageFailureScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError')}})`});
  await reloadPlanner(); await awaitSource();
  await dragTask('website:image-alt',businessDays[2],10);
  await clickText('Auto Plan (AI)');
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task]').length`),plannerExpectedTasks.length);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:storageFailureScript.identifier});
  pass('Malformed planner storage resets safely without touching other keys; denied storage leaves scheduling and Auto Plan usable in memory');
  assert.equal(browserRequests.slice(requestStart).filter(request=>request.method==='POST').length,0,'Planner actions must not write externally or start provider scans');
  assert.deepEqual(browserErrors,[]);
  pass('Four responsive widths, selected-day mobile layout, no runtime errors, and no external write/AI calls');
  console.log(JSON.stringify({passed:results.length,scenarios:results,artifactDirectory:artifactDir},null,2));
}

async function settingsScenario(base) {
  await cdp.send('Network.enable');
  const requestStart = browserRequests.length;
  const commerce = ['Shopify', 'WooCommerce', 'Lightspeed', 'Wix', 'BigCommerce', 'Square'];
  const assets = `document.getElementById('settings-assets')`;
  await navigate(`${base}/dashboard`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('a[href="/settings#connected-assets"]'))`), 'Manage Connections link');
  await evaluate(`document.querySelector('a[href="/settings#connected-assets"]').click()`);
  await waitFor(() => evaluate(`location.pathname === '/settings' && location.hash === '#connected-assets' && document.activeElement?.id === 'settings-assets-title'`), 'Dashboard to Settings focus');
  assert.equal(await evaluate(`document.querySelector('h1').textContent`), 'Connections & Settings');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#primary-navigation a')).map(node => node.textContent)`), ['Dashboard', 'Website', 'Social Media', 'Analysis & Revenue', 'Smart Planner', 'Connections & Settings']);
  assert.equal(await evaluate(`${assets}.querySelectorAll('[aria-label="Currently connected assets"] article').length`), 2);
  const connected = await evaluate(`${assets}.querySelector('[aria-label="Currently connected assets"]').innerText`);
  assert.match(connected, /guzmantaxaccounting.com/); assert.match(connected, /Guzman Tax Accounting/);
  assert.equal((connected.match(/Connected/g) ?? []).length, 2);
  assert.doesNotMatch(connected, /Shopify|WooCommerce|Lightspeed|Wix|BigCommerce|Square/);
  for (const group of ['meta', 'social', 'commerce']) assert.equal(await evaluate(`Boolean(document.getElementById('available-${group}'))`), true);
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#available-commerce').closest('section').querySelectorAll('button')).map(node => node.getAttribute('aria-label').split(' (')[0])`), commerce);
  for (const name of commerce) {
    await evaluate(`Array.from(${assets}.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === ${JSON.stringify(name)} + ' (demo connection option)').click()`);
    assert.match(await pageText(), new RegExp(`${name}: Demo connection option only`));
    assert.equal(await evaluate(`${assets}.querySelectorAll('[aria-label="Currently connected assets"] article').length`), 2);
  }
  pass('Connections title, original navigation, two demo assets, three groups, and six commerce options');
  const otherPlatforms = ['Google Analytics (GA4)', 'Google Search Console', 'Google Business Profile', 'Google Ads', 'Google Merchant Center', 'Lighthouse'];
  const marketplaces = ['Amazon', 'eBay', 'Etsy', 'TikTok Shop', 'Facebook Marketplace'];
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-testid="secondary-connections"] section > h4')).map(node => node.textContent)`), ['Other Connections', 'Marketplace Connections']);
  for (const [id, names] of [['google', otherPlatforms], ['marketplaces', marketplaces]]) {
    assert.deepEqual(await evaluate(`Array.from(document.getElementById('available-${id}').closest('section').querySelectorAll('button')).map(node => node.getAttribute('aria-label').replace(' (demo connection option)', '').replace(' (demo tool option)', ''))`), names);
  }
  assert.equal(await evaluate(`document.querySelector('[data-testid="secondary-connections"]').previousElementSibling.querySelectorAll('section').length`), 3, 'Primary groups stay above the secondary groups');
  for (const name of [...otherPlatforms, ...marketplaces]) {
    await evaluate(`Array.from(document.querySelectorAll('[data-testid="secondary-connections"] button')).find(node => node.getAttribute('aria-label').startsWith(${JSON.stringify(name)} + ' (')).click()`);
    assert.match(await pageText(), name === 'Lighthouse' ? /No sign-in is required and no analysis has been started/ : /No account or store has been connected/);
  }
  assert.equal(await evaluate(`${assets}.querySelectorAll('[aria-label="Currently connected assets"] article').length`), 2);
  pass('Six supporting tools and five marketplaces use demo-only feedback with neutral Lighthouse wording');

  await evaluate(`Array.from(${assets}.querySelectorAll('button')).find(node => node.textContent === 'Add Connection').focus()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(() => evaluate(`Boolean(document.querySelector('dialog[open]'))`), 'picker keyboard open');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('dialog section > h3')).map(node => node.textContent)`), ['Websites', 'Meta Platforms', 'Other Social Platforms', 'E-commerce Platforms', 'Google & SEO', 'Marketplaces']);
  const pickerText = await evaluate(`document.querySelector('dialog').innerText`);
  for (const name of [...commerce, ...otherPlatforms, ...marketplaces, 'Pinterest', 'Snapchat', 'Reddit']) assert.ok(pickerText.includes(name));
  await evaluate(`document.querySelector('button[aria-label="Preview Lighthouse tool (demo)"]').click()`);
  assert.match(await pageText(), /No sign-in is required and no analysis has been started/);
  await evaluate(`document.querySelector('button[aria-label="Connect Shopify (demo)"]').click()`);
  assert.match(await pageText(), /No account has been connected/);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(() => evaluate(`!document.querySelector('dialog[open]') && document.activeElement?.textContent === 'Add Connection'`), 'picker dismiss restores focus');
  pass('Picker catalog preserves existing options, commerce demo feedback, keyboard activation, and return focus');
  await evaluate(`(() => { const input = document.getElementById('business-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Local demo edit'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate(`document.querySelector('#settings-business form').requestSubmit()`);
  await waitFor(async () => (await pageText()).includes('Changes saved in this view only'), 'profile save');
  for (const id of ['ai-suggestions', 'require-approval']) {
    const initial = await evaluate(`document.getElementById('${id}').getAttribute('aria-checked')`);
    await evaluate(`document.getElementById('${id}').click()`);
    assert.notEqual(await evaluate(`document.getElementById('${id}').getAttribute('aria-checked')`), initial);
  }
  await evaluate(`(() => { const input = document.getElementById('content-tone'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, 'Friendly'); input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  assert.equal(await evaluate(`document.getElementById('content-tone').value`), 'Friendly');
  await evaluate(`Array.from(document.querySelector('#settings-plan').querySelectorAll('button')).find(node => node.textContent === 'View Plans').click()`);
  assert.match(await pageText(), /No billing or subscription changes were made/);
  for (const id of ['business', 'assets', 'preferences', 'plan']) {
    await evaluate(`document.querySelector('button[aria-controls="settings-${id}"]').click()`);
    await waitFor(() => evaluate(`document.activeElement?.id === 'settings-${id}-title'`), `internal navigation ${id}`);
  }
  pass('Business Profile save, preferences, tone, Plan preview, and internal section focus remain functional');
  await navigate(`${base}/dashboard`);
  await navigate(`${base}/settings#connected-assets`);
  await waitFor(() => evaluate(`document.activeElement?.id === 'settings-assets-title'`), 'direct hash navigation');
  for (const width of [1440, 768, 390, 320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    await evaluate('window.scrollTo(0, 0)'); await delay(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `Settings has no overflow at ${width}`);
    const bounds = await evaluate(`Array.from(document.querySelectorAll('#available-meta, #available-social, #available-commerce')).map(node => node.closest('section').getBoundingClientRect().y)`);
    if (width === 1440) {
      assert.equal(new Set(bounds).size, 1, 'Three equal-priority groups align on desktop');
      for (const [id, columns] of [['google', 6], ['marketplaces', 5]]) assert.equal(await evaluate(`getComputedStyle(document.getElementById('available-${id}').nextElementSibling.nextElementSibling).gridTemplateColumns.split(' ').length`), columns, 'Supporting platforms form compact desktop rows');
    }
    const svgChecks = await evaluate(`Array.from(document.querySelectorAll('[data-testid="secondary-connections"] button')).map(button => { const svg = button.querySelector('svg'); return svg && Array.from(svg.querySelectorAll('path')).every(path => { const box = path.getBBox(); return box.width > 0 && box.height > 0; }); })`);
    assert.equal(svgChecks.length, 11); assert.ok(svgChecks.every(Boolean), 'All supporting platform marks are nonempty local SVGs');
    const secondaryBounds = await evaluate(`(() => { const r = document.querySelector('[data-testid="secondary-connections"]').getBoundingClientRect(); return {x:r.x+scrollX, y:r.y+scrollY, width:r.width, height:r.height, scale:1}; })()`);
    const secondaryShot = await cdp.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:secondaryBounds});
    await writeFile(path.join(artifactDir, `secondary-${width}.png`), Buffer.from(secondaryShot.data, 'base64'));
    await screenshot(`settings-${width}.png`);
    await evaluate(`Array.from(${assets}.querySelectorAll('button')).find(node => node.textContent === 'Add Connection').click()`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `Picker has no overflow at ${width}`);
    const dialog = await evaluate(`(() => { const r = document.querySelector('dialog').getBoundingClientRect(); return {left:r.left,right:r.right}; })()`);
    assert.ok(dialog.left >= 0 && dialog.right <= width);
    await evaluate(`document.querySelector('dialog').close()`);
  }
  assert.equal(browserRequests.slice(requestStart).filter(request => request.method === 'POST').length, 0, 'Settings must not authorize accounts or change external systems');
  assert.deepEqual(browserErrors, []);
  pass('Direct hash navigation, four responsive widths, picker bounds, and no external writes');
  console.log(JSON.stringify({ passed: results.length, scenarios: results, artifactDirectory: artifactDir }, null, 2));
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

  if (analysisMode) {
    await analysisScenario(base);
  } else if (plannerMode) {
    await plannerScenario(base);
  } else if (settingsMode) {
    await settingsScenario(base);
  } else if (dashboardMode) {
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
  assert.match(await pageText(), /Demo overall score/i);
  pass('Dashboard loads demo and saved results without starting an audit');

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
  await navigate(`${base}/website`); await waitFor(() => evaluate('location.pathname === "/website"'), 'leave lab');
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
