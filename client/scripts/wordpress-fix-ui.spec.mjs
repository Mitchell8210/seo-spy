// Focused offline browser workflow. All API mutations below are fixture-memory operations only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const candidatesOnly = process.argv.includes('--dashboard-candidates');
let candidatesState = 'loading', releaseCandidates;
let facebookHistory = [], facebookHistoryFailed = false;
const clientDir = fileURLToPath(new URL('..', import.meta.url));
const receiptPath = path.join(clientDir, '../server/reports/wordpress-alt-first-application-result.json');
const originalReceipt = candidatesOnly ? Buffer.from(JSON.stringify({ publicVerification: { receipt: { requestedUrl: 'https://example.com/page/' } }, stored: { actualAlt: 'Reviewed image description' } })) : await readFile(receiptPath), saved = JSON.parse(originalReceipt);
const receiptHash = createHash('sha256').update(originalReceipt).digest('hex');
const reportId = 'e739442b-185f-4b89-ae12-a8273bb6bdbc', findingId = '5e02c565-e0ed-4ef2-9665-9a19bcfaaf64', evidenceId = 'ffb8a1dd-f142-4381-8f62-21744698c05c';
const now = new Date().toISOString(), business = { id: 'demo-guzman', name: 'Guzman Tax Accounting', website: 'https://guzmantaxaccounting.com', createdAt: now };
const pageUrl = saved.publicVerification.receipt.requestedUrl, approvedText = saved.stored.actualAlt;
const report = { schemaVersion: 'seo-spy.audit-report.v1', reportId, auditId: reportId, business, generatedAt: now,
  audit: { id: reportId, businessId: business.id, scope: 'homepage', mode: 'live', status: 'completed', stage: 'complete', completedAt: now, warnings: [], failure: null },
  results: { findings: [{ id: findingId, auditId: reportId, checkId: 'image-alt', evidenceIds: [evidenceId], severity: 'medium', source: 'website', title: 'Review the informative IRS assistance image', explanation: 'An exact informative image is bound to media 5659.', status: 'needs_review' }],
    evidence: [{ id: evidenceId, auditId: reportId, checkId: 'image-alt', sourceUrl: pageUrl, collectedAt: now, mode: 'live', observed: {} }],
    recommendations: [{ id: 'exact-alt-recommendation', auditId: reportId, findingId, title: 'Review the exact image alternative', explanation: 'Use the confirmed IRS-letter assistance message.', recommendedChange: 'Review the confirmed image purpose and prepare alternative text.', status: 'needs_review' }], scores: [] } };
const socialId = '00000000-0000-4000-8000-000000000123';
const socialFindings = Array.from({ length: 3 }, (_, index) => ({ id: 'social-' + index, auditId: socialId, checkId: 'facebook:profile:hours', evidenceIds: ['social-evidence'], severity: 'medium', source: 'facebook', title: 'Fixture social issue ' + (index + 1), explanation: 'A saved social media observation. ' + 'Additional detail belongs in the review dialog. '.repeat(12), status: 'needs_review' }));
const socialReport = { ...report, reportId: socialId, auditId: socialId, audit: { ...report.audit, id: socialId, scope: 'facebook', status: 'partial' }, results: {
  facebook: { provider: 'facebook-graph', version: 'facebook-v1', graphVersion: 'v26.0', pageId: '123', pageName: 'Fixture Facebook Page', collectedAt: now, window: { requestedDays: 30, since: now, until: now }, profile: {}, metrics: [], posts: { status: 'available', items: [], truncated: false, collectedAt: now }, limitations: [], summary: {}, coverage: {} },
  evidence: [{ id: 'social-evidence', auditId: socialId, checkId: 'facebook:profile:hours', mode: 'live', observed: { status: 'missing' } }], findings: socialFindings, recommendations: [], scores: [] } };
const evidence = { id: '5b14c90d-5ba1-4775-b1a8-32af42d63e8e', expiresAt: new Date(Date.now() + 900000).toISOString(), purpose: 'informative',
  verifiedDescription: 'Gráfico promocional sobre ayuda para entender y responder cartas del IRS.', descriptionProvenance: 'operator-confirmed-text; no model visual inspection',
  target: { mediaId: 5659, pageResource: 'pages', pageId: 5652, pageUrl, sourceUrl: 'https://www.guzmantaxaccounting.com/wp-content/uploads/2026/09/irs-carta.png', currentAlt: '', modified: '2026-09-25T02:41:39' } };
let mode = 'mock', generation = null, proposal = null, verification = null;
const requests = [], errors = [], children = [];
let server, cdp, artifacts;
const workflow = () => ({ status: mode === 'saved' ? 'public_verified' : verification?.status ?? proposal?.outcome?.status ?? (proposal ? 'pending_approval' : 'draft'),
  proposal, generation, verification, pageUrl, approvalRequired: !!proposal && !proposal.outcome,
  generationApproval: { status: mode === 'pending' ? 'pending_approval' : 'not_required' } });
const item = () => ({ reportId, findingId, evidenceId, workflow: workflow() });
const capability = () => ({ capability: 'wordpress.media.alt_text.update', fixable: !proposal?.outcome, evidence, writesEnabled: mode === 'mock', reason: 'Exact verified informative media target.', limitations: [], savedGeneration: generation, workflow: workflow() });
const fullProposal = () => ({ id: '00000000-0000-4000-8000-000000000565', hash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 900000).toISOString(), resource: 'media', resourceId: 5659,
  before: { altText: '' }, changes: { altText: approvedText }, field: 'alt_text', restorationOf: null, textOrigin: 'human-edited', executionStarted: false, outcome: null });
async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port; }
async function waitFor(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await test()) return; } catch { /* Navigation/render startup only. */ } await delay(100); } throw new Error(`Timed out: ${label}`); }
function run(executable, args, options = {}) { const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore', ...options }); children.push(child); return child; }
async function connect(url) {
  const socket = new globalThis.WebSocket(url); await once(socket, 'open'); let counter = 0; const pending = new Map();
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
    const job = pending.get(value.id); if (!job) return; clearTimeout(job.timer); pending.delete(value.id); value.error ? job.reject(new Error(value.error.message)) : job.resolve(value.result); });
  return { close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }) };
}
async function evaluate(expression) { const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.text); return response.result.value; }
const text = () => evaluate('document.body.innerText');
const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === ${JSON.stringify(label)}).click()`);
async function screenshot(name) { const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(path.join(artifacts, name), Buffer.from(result.data, 'base64')); }
try {
  const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync); assert.ok(chrome);
  const cache = path.join(clientDir, 'node_modules/.cache/wordpress-fix-ui'); await mkdir(cache, { recursive: true }); artifacts = await mkdtemp(path.join(cache, 'run-'));
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); url.pathname = url.pathname.replace(/\/$/, ''); let body;
      if (req.method === 'POST') { let data = ''; for await (const chunk of req) data += chunk; body = JSON.parse(data); assert.equal(req.headers['x-wordpress-csrf'], 'c'.repeat(43)); }
      requests.push({ method: req.method, path: url.pathname, body }); let result;
      const base = `/api/wordpress/businesses/${business.id}/fixes`;
      if (candidatesOnly && url.pathname.endsWith('/fixes/candidates')) {
        const reply = () => {
          if (candidatesState === 'error') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Fixture recommendations unavailable' } })); return; }
          const items = Array.from({ length: candidatesState === 'empty' ? 0 : candidatesState === 'two' ? 2 : 4 }, (_, index) => ({
            businessId: business.id, reportId, findingId: findingId + ':' + index, evidenceId,
            target: { ...evidence.target, mediaId: index + 1 }, pageTitle: 'Fixture alt page ' + (index + 1), pageLanguage: 'en', purposeStatus: 'unreviewed',
            issue: 'Fixture alternative recommendation ' + (index + 1), requiresPurposeConfirmation: true, isMock: true, capability: capability(),
            thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          }));
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ items }));
        };
        if (candidatesState === 'loading') releaseCandidates = reply; else reply();
        return;
      }
      if (url.pathname === '/api/facebook/posts/history') {
        if (facebookHistoryFailed) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Fixture Facebook actions unavailable' } })); return; }
        result = { businessId: business.id, items: facebookHistory };
      }
      else if (url.pathname === '/api/wordpress/browser-session') result = { csrf: 'c'.repeat(43), businessId: business.id, connected: true };
      else if (candidatesOnly && url.pathname === `/api/wordpress/local/businesses/${business.id}/fixes`) result = { items: [{ reportId, findingId, evidenceId, workflow: {
        ...workflow(), status: 'public_verified', proposal: { ...fullProposal(), executionStarted: true, outcome: { status: 'applied', verification: 'verified_stored_fields', completedAt: now } },
        verification: { status: 'public_verified', receipt: { id: 'fixture-verification', storedFieldMatches: true, status: 'verified', limitations: [] } },
        pageTitle: 'Fixture fixed image', completedAt: now,
      } }] };
      else if (url.pathname === base) result = { items: [item()] };
      else if (url.pathname === base + '/capability') result = capability();
      else if (url.pathname === base + '/generations' && req.method === 'POST') {
        assert.equal(mode, 'mock'); assert.equal(body.evidenceId, evidence.id);
        generation = { id: '9bb52ffd-67a8-467c-8946-6966ab99344b', isMock: true, provider: 'mock-fixture', output: { status: 'proposed', altText: 'sobre ayuda para entender y responder cartas del IRS.', reason: 'DESCRIPTION_EXCERPT' } }; result = generation;
      } else if (url.pathname === base + '/proposals' && req.method === 'POST') {
        assert.equal(body.generationId, generation.id); assert.equal(body.altText, approvedText); proposal = fullProposal(); result = proposal;
      } else if (proposal && url.pathname === base + `/proposals/${proposal.id}/apply`) {
        assert.equal(mode, 'mock'); assert.deepEqual(body, { confirmed: true, proposalHash: proposal.hash }); assert.equal(proposal.executionStarted, false);
        proposal.executionStarted = true; proposal.outcome = { status: 'applied', verification: 'verified_stored_fields' }; result = proposal.outcome;
      } else if (proposal && url.pathname === base + `/proposals/${proposal.id}/verifications`) {
        assert.deepEqual(body, { confirmed: true }); verification = { status: 'public_verified', receipt: { ...saved.publicVerification.receipt, proposalId: proposal.id } }; result = verification;
      } else if (proposal && url.pathname === base + `/proposals/${proposal.id}`) result = proposal;
      else if (url.pathname.endsWith('/dashboard')) result = { business, connections: [], assessment: null, latestAudit: null, activeAudit: null };
      else if (url.pathname.endsWith('/facebook-report')) result = { businessId: business.id, report: candidatesOnly ? socialReport : null, analysis: candidatesOnly ? { version: 'facebook-analysis-v1', auditId: socialId, findings: socialFindings, recommendations: [], summaries: [] } : null, latestAttempt: null };
      else if (url.pathname.endsWith('/reports')) result = { businessId: business.id, reports: [{ reportId, auditId: reportId, businessId: business.id, scope: 'homepage', mode: 'live', status: 'completed', generatedAt: now }] };
      else if (url.pathname === `/api/audits/${reportId}/report`) result = report;
      else if (url.pathname === `/api/audits/${reportId}/website-analysis`) result = { version: 'website-priority-v1', auditId: reportId, findings: report.results.findings, recommendations: report.results.recommendations, priorities: [] };
      else if (url.pathname === `/api/audits/${reportId}/evidence-summary`) result = { version: 'programmatic-evidence-v1', auditId: reportId, findings: [{ id: findingId, evidenceIds: [evidenceId], text: 'Exact informative image and page context.', sourceLabel: 'Saved page evidence' }], checks: [] };
      else if (url.pathname === '/api/facebook/investigations/status') result = { businessId: business.id, active: null, latest: null };
      else { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unknown fixture route' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { errors.push(error.message); res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  run(process.execPath, [path.join(clientDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: clientDir, env: { ...process.env, BACKEND_LAB_API_TARGET: `http://127.0.0.1:${server.address().port}` } });
  await waitFor(async () => (await fetch(base)).ok, 'Vite startup');
  const profile = path.join(artifacts, 'chrome-profile'); run(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', 'about:blank']);
  let debugPort; await waitFor(async () => { debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); return debugPort; }, 'Chrome startup');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const navigate = async () => { await cdp.send('Page.navigate', { url: base + '/dashboard?businessId=demo-guzman' }); await waitFor(async () => (await text()).includes('Review the informative IRS assistance image'), 'Dashboard fixture'); };
  const open = async label => { await waitFor(async () => evaluate(`Array.from(document.querySelectorAll('button')).some(el => el.textContent.trim() === ${JSON.stringify(label)})`), label); await click(label); await waitFor(() => evaluate('Boolean(document.querySelector("dialog[open]"))'), 'modal open'); };
  if (candidatesOnly) {
    await cdp.send('Page.navigate', { url: base + '/dashboard?businessId=demo-guzman' });
    const category = 'section[aria-label="Website Health"]';
    const healthText = () => evaluate(`document.querySelector(${JSON.stringify(category)})?.innerText ?? ''`);
    await waitFor(async () => (await healthText()).includes('Loading saved image recommendations'), 'candidate loading');
    await waitFor(() => Boolean(releaseCandidates), 'candidate request pending');
    candidatesState = 'four'; releaseCandidates();
    await waitFor(async () => (await healthText()).includes('Fixture alt page 3'), 'three inline suggestions');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(category)}).querySelectorAll('li').length`), 3);
    assert.doesNotMatch(await healthText(), /Fixture alt page 4|Review the informative IRS assistance image/);
    assert.match(await healthText(), /Top issues to fix now/);
    assert.equal(await evaluate(`document.querySelector('section[aria-label="Recommended Fixes"]') === null`), true);
    const socialCategory = 'section[aria-label="Social Media Performance"]';
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(socialCategory)})?.innerText.includes('Fixture social issue 3')`), 'saved social issues');
    for (const selector of [category, socialCategory]) {
      assert.equal(await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('li')).every(row => { const button = row.querySelector('button'); return button?.textContent.trim() === 'Fix With AI' && !!button.querySelector('svg'); })`), true, 'Every top issue has a visible labeled AI button and icon');
    }
    assert.doesNotMatch(await healthText(), /Saved website report|Homepage coverage|SEO Spy policy/);
    assert.doesNotMatch(await evaluate(`document.querySelector(${JSON.stringify(socialCategory)}).innerText`), /Saved Facebook report|Partial coverage|SEO Spy policy/);
    assert.doesNotMatch(await text(), /Saved comparison ·|SEO Spy policy/);
    for (const width of [1440, 768, 390, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Dashboard overflow at ' + width);
      assert.equal(await evaluate(`Array.from(document.querySelector(${JSON.stringify(category)}).querySelectorAll('li button')).every(row => row.getBoundingClientRect().height <= 84)`), true, 'Compact recommendation rows at ' + width);
      assert.equal(await evaluate(`Array.from(document.querySelector(${JSON.stringify(socialCategory)}).querySelectorAll('li button')).every(row => row.getBoundingClientRect().height <= 84)`), true, 'Compact social issue rows at ' + width);
      await screenshot('inline-candidates-' + width + '.png');
    }
    await evaluate(`document.querySelector(${JSON.stringify(category)}).querySelector('button').click()`);
    await waitFor(() => evaluate('Boolean(document.querySelector("dialog[open]"))'), 'inline image review dialog');
    await evaluate(`document.querySelector('button[aria-label="Close fix review"]').click()`);
    await evaluate(`document.querySelector(${JSON.stringify(socialCategory)}).querySelector('button').click()`);
    await waitFor(() => evaluate('Boolean(document.querySelector("dialog[open]"))'), 'social issue review dialog');
    assert.equal(await evaluate(`document.querySelector('dialog').innerText.includes(${JSON.stringify(socialFindings[0].explanation)})`), true, 'Full social explanation remains available on review');
    await evaluate(`document.querySelector('button[aria-label="Close fix review"]').click()`);
    candidatesState = 'two'; await evaluate('window.dispatchEvent(new Event("wordpress-fix-updated"))');
    await waitFor(async () => !(await healthText()).includes('Fixture alt page 3'), 'completed suggestion refresh');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(category)}).querySelectorAll('li').length`), 2);
    candidatesState = 'error'; await evaluate('window.dispatchEvent(new Event("wordpress-fix-updated"))');
    await waitFor(async () => (await healthText()).includes('Fixture recommendations unavailable'), 'candidate error');
    candidatesState = 'empty'; await click('Retry saved recommendations');
    await waitFor(async () => (await healthText()).includes('No outstanding, exactly bound image-alt opportunities'), 'candidate empty');
    const recent = 'section[aria-label="Recent Actions"]';
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText.includes('1 fully verified')`), 'saved fix count');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(recent)}).querySelector('details').open`), false, 'Recently Fixed starts collapsed');
    assert.equal(await evaluate(`Boolean(document.querySelector('#next-steps-title').closest('section').compareDocumentPosition(document.querySelector(${JSON.stringify(recent)})) & Node.DOCUMENT_POSITION_FOLLOWING)`), true, 'Recently Fixed follows Your Next Steps');
    const readsBeforeExpand = requests.length;
    await evaluate(`document.querySelector(${JSON.stringify(recent)}).querySelector('summary').click()`);
    assert.match(await text(), /Image description updated/);
    assert.equal(requests.slice(readsBeforeExpand).filter(item => item.path.includes('/wordpress/')).length, 0, 'Expanding saved actions triggers no WordPress requests');
    const facebookPost = { id: 'fixture-facebook-action', businessId: business.id, reportId: socialId, recommendationId: 'posting', pageId: '123', pageName: 'Fixture Facebook Page', status: 'published', text: 'Reviewed welcome post from the accounting team.', verified: true, postId: '123_456', permalink: 'https://www.facebook.com/123/posts/456', completedAt: new Date(Date.parse(now) + 1000).toISOString() };
    facebookHistory = [facebookPost, { ...facebookPost, id: 'fixture-unknown-action', status: 'outcome_unknown', verified: false, postId: null, permalink: null, completedAt: null, executedAt: new Date(Date.parse(now) + 2000).toISOString() }];
    await evaluate('window.dispatchEvent(new Event("facebook-post-updated"))');
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText.includes('Facebook post published')`), 'Facebook actions refresh');
    const recentText = await evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText`);
    assert.match(recentText, /2 fully verified/); assert.match(recentText, /Publication was not confirmed/); assert.match(recentText, /Reviewed welcome post/);
    assert.deepEqual(await evaluate(`Array.from(document.querySelector(${JSON.stringify(recent)}).querySelectorAll('li h3')).map(el => el.textContent)`), ['Facebook publishing needs review', 'Facebook post published', 'Image description updated']);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(recent)}).querySelector('a').href`), facebookPost.permalink);
    facebookHistoryFailed = true;
    await evaluate('window.dispatchEvent(new Event("facebook-post-updated"))');
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText.includes('Fixture Facebook actions unavailable')`), 'partial history failure');
    assert.match(await evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText`), /Image description updated/);
    facebookHistoryFailed = false;
    await click('Retry saved actions');
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText.includes('2 fully verified')`), 'history retry');
    const readsBeforeLayout = requests.length;
    for (const width of [1440, 390, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Expanded saved fixes overflow at ' + width);
      await screenshot('recent-fixes-expanded-' + width + '.png');
    }
    await evaluate(`document.querySelector(${JSON.stringify(recent)}).querySelector('summary').focus()`);
    await cdp.send('Page.bringToFront');
    assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(() => evaluate(`!document.querySelector(${JSON.stringify(recent)}).querySelector('details').open`), 'keyboard collapses saved fixes');
    assert.doesNotMatch(await evaluate(`document.querySelector(${JSON.stringify(recent)}).innerText`), /Image description updated/);
    assert.equal(requests.slice(readsBeforeLayout).filter(item => item.path.includes('/wordpress/')).length, 0, 'Toggling saved actions triggers no WordPress requests; unrelated Dashboard polling may continue');
    await screenshot('recent-fixes-collapsed-mobile.png');
    assert.equal(requests.filter(item => item.method !== 'GET').length, 0, 'Inline recommendations and review trigger no paid generation or writes');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: ['three-suggestion cap', 'standalone section removed', 'compact matching website/social rows', 'image and social review dialogs', 'refresh after fixes', 'loading/error/retry/empty', 'desktop/tablet/mobile layout', 'Recently Fixed collapsed/expanded and keyboard toggle', 'Recently Fixed below Your Next Steps', 'read-only fixture traffic'], artifactDirectory: artifacts }, null, 2));
  } else {
  await navigate(); await open('Fix with AI'); await click('Generate AI proposal');
  await waitFor(() => evaluate(`Boolean(document.querySelector('textarea[aria-label="Proposed alt text"]'))`), 'generated text');
  await evaluate(`(() => { const input=document.querySelector('textarea[aria-label="Proposed alt text"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(approvedText)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Continue to confirmation'); await waitFor(async () => (await text()).includes('Exact before/after update'), 'confirmation');
  assert.equal(await evaluate('document.querySelector("dialog input[type=checkbox]").checked'), false);
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(el=>el.textContent === "Approve & Apply").disabled'), true);
  await navigate(); await open('Fix with AI'); await waitFor(async () => (await text()).includes('Exact before/after update'), 'saved proposal restored after reload');
  assert.ok((await text()).includes(approvedText));
  await evaluate('document.querySelector("dialog input[type=checkbox]").click()'); await click('Approve & Apply');
  await waitFor(async () => (await text()).includes('Verify stored and public result'), 'execution result'); await click('Verify stored and public result');
  await waitFor(async () => (await text()).includes('Verified in WordPress and public page'), 'verified result');
  await navigate(); await open('Verified'); assert.ok((await text()).includes(approvedText));
  assert.equal(requests.filter(item => item.path.endsWith('/apply')).length, 1); assert.equal(requests.filter(item => item.path.endsWith('/generations') && item.method === 'POST').length, 1);
  await screenshot('mock-completed-desktop.png');
  mode = 'pending'; generation = null; proposal = null; verification = null;
  await navigate(); await open('Fix with AI');
  await waitFor(async () => (await text()).includes('Pending administrator approval'), 'honest pending state');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(el=>el.textContent === "Generate AI proposal").disabled'), true);
  mode = 'saved'; generation = { id: '9bb52ffd-67a8-467c-8946-6966ab99344b', isMock: false, provider: 'meta', output: { status: 'proposed', altText: 'sobre ayuda para entender y responder cartas del IRS.', reason: 'DESCRIPTION_EXCERPT' } };
  proposal = { ...fullProposal(), id: saved.proposalId, hash: saved.proposalHash, expiresAt: '2026-11-02T20:42:37.429Z', outcome: saved.execution, executionStarted: true }; verification = saved.publicVerification;
  const mutationsBefore = requests.filter(item => item.method === 'POST').length;
  await navigate(); await open('Verified'); await waitFor(async () => (await text()).includes('Verified in WordPress and public page'), 'real saved receipt displayed');
  assert.ok((await text()).includes(approvedText)); assert.ok((await text()).includes(saved.publicVerification.receipt.id));
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('dialog a')).some(el => el.href === ${JSON.stringify(pageUrl)})`), true);
  await screenshot('real-receipt-desktop.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true); await screenshot('real-receipt-mobile.png');
  assert.equal(requests.filter(item => item.method === 'POST').length, mutationsBefore, 'Saved real receipt display triggers no mutation');
  assert.equal(createHash('sha256').update(await readFile(receiptPath)).digest('hex'), receiptHash); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['mock generation/edit/approval/apply/verification', 'proposal and completed reload', 'pending administrator approval', 'real immutable receipt replay', 'mobile/desktop modal', 'one mock Apply', 'no live provider traffic'], artifactDirectory: artifacts }, null, 2));
  }
} catch (error) { console.error(error); if (cdp) { try { console.error(await text()); } catch { /* Renderer may be unavailable. */ } } process.exitCode = 1; }
finally { if (cdp) cdp.close(); for (const child of children.reverse()) if (child.exitCode === null) child.kill(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
