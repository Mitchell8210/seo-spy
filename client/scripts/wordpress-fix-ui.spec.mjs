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

const clientDir = fileURLToPath(new URL('..', import.meta.url));
const receiptPath = path.join(clientDir, '../server/reports/wordpress-alt-first-application-result.json');
const originalReceipt = await readFile(receiptPath), saved = JSON.parse(originalReceipt);
const receiptHash = createHash('sha256').update(originalReceipt).digest('hex');
const reportId = 'e739442b-185f-4b89-ae12-a8273bb6bdbc', findingId = '5e02c565-e0ed-4ef2-9665-9a19bcfaaf64', evidenceId = 'ffb8a1dd-f142-4381-8f62-21744698c05c';
const now = new Date().toISOString(), business = { id: 'demo-guzman', name: 'Guzman Tax Accounting', website: 'https://guzmantaxaccounting.com', createdAt: now };
const pageUrl = saved.publicVerification.receipt.requestedUrl, approvedText = saved.stored.actualAlt;
const report = { schemaVersion: 'seo-spy.audit-report.v1', reportId, auditId: reportId, business, generatedAt: now,
  audit: { id: reportId, businessId: business.id, scope: 'homepage', mode: 'live', status: 'completed', stage: 'complete', completedAt: now, warnings: [], failure: null },
  results: { findings: [{ id: findingId, auditId: reportId, checkId: 'image-alt', evidenceIds: [evidenceId], severity: 'medium', source: 'website', title: 'Review the informative IRS assistance image', explanation: 'An exact informative image is bound to media 5659.', status: 'needs_review' }],
    evidence: [{ id: evidenceId, auditId: reportId, checkId: 'image-alt', sourceUrl: pageUrl, collectedAt: now, mode: 'live', observed: {} }],
    recommendations: [{ id: 'exact-alt-recommendation', auditId: reportId, findingId, title: 'Review the exact image alternative', explanation: 'Use the confirmed IRS-letter assistance message.', recommendedChange: 'Review the confirmed image purpose and prepare alternative text.', status: 'needs_review' }], scores: [] } };
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
      if (url.pathname === '/api/wordpress/browser-session') result = { csrf: 'c'.repeat(43), businessId: business.id, connected: true };
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
      else if (url.pathname.endsWith('/facebook-report')) result = { businessId: business.id, report: null, analysis: null, latestAttempt: null };
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
} catch (error) { console.error(error); if (cdp) { try { console.error(await text()); } catch { /* Renderer may be unavailable. */ } } process.exitCode = 1; }
finally { if (cdp) cdp.close(); for (const child of children.reverse()) if (child.exitCode === null) child.kill(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
