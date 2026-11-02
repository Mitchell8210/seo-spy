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
import ts from 'typescript';

const clientDir = fileURLToPath(new URL('..', import.meta.url));
const serverDir = path.resolve(clientDir, '..', 'server');
const liveMode = process.argv.includes('--live');
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
let plannerSaveFailure = false;
let plannerReadFailure = false;
let plannerSaveDelay = 0;
let plannerConflict = false;
let plannerFixtureState;
const plannerReceipts = new Map();
let plannerAutoSchedule;
if (plannerMode) {
  const v1Source = ts.transpileModule(await readFile(new URL('../../server/src/modules/smart-planner/planner-scheduler.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const v1Url = `data:text/javascript;base64,${Buffer.from(v1Source).toString('base64')}`;
  const source = (await readFile(new URL('../../server/src/modules/smart-planner/planner-scheduler-v2.ts',import.meta.url),'utf8')).replace('"./planner-scheduler.js"',JSON.stringify(v1Url));
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  plannerAutoSchedule = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).schedulePlannerV2;
}
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

function plannerFixtureResponse() {
  if (!plannerFixtureState) plannerFixtureState = {businessId,revision:0,preferences:{useWeekends:false,dailyCapacityMinutes:120,maxTasksPerDay:3,horizonWeeks:4,timeZone:null},tasks:[
    ...plannerWebsiteSeeds.map((item,index)=>({id:`00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`,taskKey:`website:${item.id}`,title:item.title,explanation:`Saved ${item.id} finding`,guidance:item.change,
      priority:item.severity==='critical'?'Urgent':item.severity==='low'?'Low':'Medium',category:/hours|contact/.test(item.id)?'Admin':/image/.test(item.id)?'Content':'Search',source:'Website',mode:'saved',status:'Needs Action',schedule:null,destination:'/website',notes:null})),
    {id:'00000000-0000-4000-8000-000000000200',taskKey:'social:facebook-fixture-finding',title:'Confirm the Facebook contact number',explanation:'Saved contact finding',guidance:'Confirm the correct phone number.',priority:'Medium',category:'Admin',source:'Facebook',mode:'saved',status:'Needs Action',schedule:null,destination:'/social-media',notes:null},
  ]};
  return {...plannerFixtureState,sources:[{channel:'website',availability:'available',reportIds:[plannerWebsiteAuditId]},{channel:'social',availability:plannerFacebookFailure?'failed':'available',reportIds:['facebook-fixture-audit']},{channel:'consistency',availability:'empty',reportIds:[]}]};
}
async function servePlannerFixture(req,res,route) {
  if (plannerFacebookDelayMs) await delay(plannerFacebookDelayMs);
  const state=plannerFixtureResponse();
  if(req.method==='GET'&&plannerReadFailure)return reply(res,503,{error:{message:'Planner read temporarily unavailable. Use Re-scan to retry.'}});
  if(req.method==='GET')return reply(res,200,state);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
  if(plannerSaveDelay)await delay(plannerSaveDelay);
  if(plannerSaveFailure)return reply(res,503,{error:{message:'Planner save temporarily unavailable. Your changes were not saved.'}});
  if(plannerReceipts.has(body.mutationId))return reply(res,200,plannerReceipts.get(body.mutationId));
  if(plannerConflict){plannerConflict=false;plannerFixtureState.revision++;}
  if(body.expectedRevision!==plannerFixtureState.revision)return reply(res,409,{error:{message:'Planner revision changed.'}});
  let planning;
  if(route.endsWith('/preferences')){
    for(const key of ['useWeekends','dailyCapacityMinutes','maxTasksPerDay','horizonWeeks','timeZone'])if(key in body)plannerFixtureState.preferences[key]=body[key];
    if(body.useWeekends===false)for(const task of plannerFixtureState.tasks)if(task.schedule&&[0,6].includes(new Date(`${task.schedule.day}T12:00:00`).getDay()))task.schedule=null;
  } else if(route.endsWith('/auto-plan')){
    if(!plannerFixtureState.preferences.timeZone)return reply(res,400,{error:{message:'Confirm a time zone in Planning settings first.'}});
    const result=plannerAutoSchedule(plannerFixtureState.tasks,{weekStart:body.weekStart,...plannerFixtureState.preferences,now:new Date()});
    for(const task of plannerFixtureState.tasks)if(result.assignments[task.id]){task.schedule=result.assignments[task.id];task.scheduledBy='auto';}
    const {assignments,...metadata}=result;planning={...metadata,scheduledCount:Object.keys(assignments).length};
  } else if(route.endsWith('/reconcile')){
    // Saved reads must never reopen completed work.
  } else if(req.method==='POST'&&route.endsWith('/tasks')){
    const id=crypto.randomUUID();plannerFixtureState.tasks.push({id,taskKey:`custom:${id}`,title:body.title,priority:body.priority,category:body.category,notes:body.notes??'',explanation:body.notes??'',guidance:body.notes||'Complete your described task.',source:'Custom task',mode:'custom',status:'Needs Action',schedule:body.schedule??null,destination:null,estimatedDurationMinutes:body.estimatedDurationMinutes??60,durationEstimateSource:'estimatedDurationMinutes'in body?'user':'default',scheduledBy:body.schedule?'manual':null});
  } else {
    const task=plannerFixtureState.tasks.find(task=>route.endsWith(`/tasks/${task.id}`));
    if(!task)return reply(res,404,{error:{message:'Task not found'}});
    if('schedule'in body){task.schedule=body.schedule;task.scheduledBy=body.schedule?'manual':null;}if('estimatedDurationMinutes'in body){task.estimatedDurationMinutes=body.estimatedDurationMinutes;task.durationEstimateSource='user';}if(body.status){task.status=body.status;task.completedAt=stamp();}
  }
  plannerFixtureState.revision++;const result=structuredClone({...plannerFixtureResponse(),...(planning?{planning}:{})});plannerReceipts.set(body.mutationId,result);return reply(res,200,result);
}

async function serveFixture(req, res) {
  apiRequests++;
  if(plannerMode&&req.url.startsWith(`/api/businesses/${businessId}/smart-planner`))return servePlannerFixture(req,res,new URL(req.url,'http://fixture').pathname);
  if(plannerMode&&req.method==='GET'&&req.url==='/api/businesses/planner-other-business/smart-planner')return reply(res,200,{
    businessId:'planner-other-business',revision:0,preferences:{useWeekends:false,dailyCapacityMinutes:120,maxTasksPerDay:3,horizonWeeks:4,timeZone:null},
    tasks:[{id:'00000000-0000-4000-8000-000000000300',taskKey:'custom:other-business',title:'Second business task only',explanation:'Isolated fixture',guidance:'Review only this business.',priority:'Low',category:'Review',source:'Custom task',mode:'custom',status:'Needs Action',schedule:null,destination:null,notes:''}],
    sources:['website','social','consistency'].map(channel=>({channel,availability:'empty',reportIds:[]})),
  });
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

async function plannerScenario(base) {
  await cdp.send('Network.enable');
  const requestStart=browserRequests.length;
  const storageKey=`seo-spy:planner:v1:${businessId}`;
  const oldStorage=JSON.stringify({version:1,businessId,edits:{},completed:{},custom:[],useWeekends:true});
  plannerFacebookDelayMs=800;
  await navigate(`${base}/recommendations`);
  await waitFor(async()=>/Loading saved planner/.test(await pageText()),'planner loading feedback');
  await screenshot('smart-planner-loading-1440.png');
  await waitFor(()=>evaluate(`document.querySelectorAll('[data-task-id]').length === ${plannerExpectedTasks.length}`),'saved planner tasks');
  plannerFacebookDelayMs=0;
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(oldStorage)});localStorage.setItem('planner-test-unrelated','keep')`);
  const kpi=label=>evaluate(`document.querySelector('[data-kpi="${label}"]').textContent`);
  const ready=()=>waitFor(()=>evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Re-scan'&&!button.disabled)`),'planner idle');
  async function clickText(text,container='document') { await evaluate(`Array.from(${container}.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`); }
  async function setField(id,value) { await evaluate(`(()=>{const node=document.getElementById(${JSON.stringify(id)});const proto=node.tagName==='SELECT'?HTMLSelectElement.prototype:node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); }
  const dialogClosed=()=>waitFor(()=>evaluate(`!document.querySelector('dialog[open]')`),'save acknowledged and dialog closed');
  const openSchedule=async id=>{await evaluate(`(document.querySelector('[data-task-id="${id}"] button[aria-label^="Schedule or reschedule:"]')??document.querySelector('[data-calendar-task="${id}"]')).click()`);await waitFor(()=>evaluate(`Boolean(document.querySelector('dialog[open]'))`),'task details and schedule dialog');};
  const reload=async()=>{await evaluate('window.plannerReloadPending=true');await cdp.send('Page.reload');await waitFor(()=>evaluate(`!window.plannerReloadPending&&document.querySelector('p[role="status"]')?.textContent.startsWith('Planner loaded from the backend.')`),'planner reload');await ready();for(let attempt=0;attempt<6;attempt++){const first=await evaluate(`document.querySelector('[data-calendar-slot]').dataset.calendarSlot.split(':')[0]`);if(first===days[0])break;await evaluate(`document.querySelector('[aria-label="Next week"]').click()`);}};
  assert.equal(await evaluate(`document.querySelector('h1').textContent`),'Smart Planner');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#primary-navigation a')).map(node=>node.textContent)`),['Dashboard','Website','Social Media','Analysis','Smart Planner','Connections & Settings']);
  assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length));assert.equal(await kpi('Done'),'0');
  assert.equal(await evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`),'false','Old localStorage is not imported');
  assert.equal(await evaluate(`new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node=>node.dataset.calendarSlot.split(':')[0])).size`),5);
  assert.doesNotMatch(await pageText(),/Website & consistency: demo|Saved Facebook report|saved on this browser|Pending Verification|How It Works/);
  pass('Existing route, navigation, six KPIs, saved source labels and weekdays preserved; legacy browser state is not imported');
  await evaluate(`document.querySelector('[aria-label="Next week"]').click()`);
  await clickText('Planning settings');await waitFor(()=>evaluate(`Boolean(document.getElementById('planner-time-zone'))`),'planning settings');
  assert.equal(await evaluate(`document.getElementById('planner-daily-budget').value`),'120');
  await setField('planner-time-zone','UTC');await clickText('Save Settings',"document.querySelector('dialog')");await dialogClosed();
  assert.equal(plannerFixtureState.preferences.timeZone,'UTC','Time zone is explicitly confirmed');
  await clickText('Planning settings');await waitFor(()=>evaluate(`Boolean(document.getElementById('planner-time-zone'))`),'reopen planning settings');
  await setField('planner-daily-budget','180');await setField('planner-daily-tasks','5');await setField('planner-horizon','6');await setField('planner-time-zone','America/Los_Angeles');
  plannerSaveFailure=true;await clickText('Save Settings',"document.querySelector('dialog')");
  await waitFor(()=>evaluate(`Boolean(document.querySelector('dialog [role="alert"]')?.textContent.includes('not saved'))`),'settings save failure');
  assert.equal(await evaluate(`document.getElementById('planner-daily-budget').value`),'180','Failed settings save retains the edited budget');
  plannerSaveFailure=false;await clickText('Save Settings',"document.querySelector('dialog')");await dialogClosed();
  assert.deepEqual(plannerFixtureState.preferences,{useWeekends:false,dailyCapacityMinutes:180,maxTasksPerDay:5,horizonWeeks:6,timeZone:'America/Los_Angeles'});
  await cdp.send('Page.reload');await waitFor(()=>evaluate(`document.querySelector('p[role="status"]')?.textContent.startsWith('Planner loaded from the backend.')`),'settings reload');await ready();
  await evaluate(`document.querySelector('[aria-label="Next week"]').click()`);
  await clickText('Planning settings');await waitFor(()=>evaluate(`Boolean(document.getElementById('planner-time-zone'))`),'saved settings after reload');
  assert.deepEqual(await evaluate(`['planner-daily-budget','planner-daily-tasks','planner-horizon','planner-time-zone'].map(id=>document.getElementById(id).value)`),['180','5','6','America/Los_Angeles']);
  await setField('planner-daily-budget','120');await setField('planner-daily-tasks','3');await setField('planner-horizon','4');await setField('planner-time-zone','UTC');
  await clickText('Save Settings',"document.querySelector('dialog')");await dialogClosed();
  await openSchedule('website:image-alt');assert.equal(await evaluate(`document.getElementById('planner-day').value`),'','Unscheduled task edits do not preselect a date');
  await setField('planner-duration','30');await clickText('Save Schedule',"document.querySelector('dialog')");await dialogClosed();
  assert.equal(plannerFixtureState.tasks.find(task=>task.taskKey==='website:image-alt').schedule,null,'A duration-only edit leaves the task unscheduled');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-task-id="website:image-alt"]'))`),true);
  const days=await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node=>node.dataset.calendarSlot.split(':')[0]))).sort()`);
  async function drag(id,day,hour,fromCalendar=false) {
    const selector=fromCalendar?`[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]`:`[data-task-id="${id}"]`;
    await evaluate(`(()=>{window.plannerDragData=new DataTransfer();document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.plannerDragData}));})()`);
    await delay(30);
    await evaluate(`document.querySelector('[data-calendar-slot="${day}:${hour}"]').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.plannerDragData}))`);
    await evaluate(`document.querySelector('[data-calendar-slot="${day}:${hour}"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:window.plannerDragData}))`);
    await waitFor(()=>evaluate(`document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]')?.parentElement.dataset.calendarSlot==='${day}:${hour}'`),'schedule persisted after drop');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task="${id}"]').length`),1);
    await ready();
  }
  await drag('website:image-alt',days[2],13);await drag('website:image-alt',days[1],15,true);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-task-id="website:image-alt"]'))`),false,'Scheduled tasks leave the left list');
  await openSchedule('website:meta-description');await setField('planner-day',days[1]);await setField('planner-hour','15');await clickText('Save Schedule',"document.querySelector('dialog')");await dialogClosed();
  assert.notEqual(plannerFixtureState.tasks.find(task=>task.taskKey==='website:meta-description').durationEstimateSource,'user','Rescheduling without changing duration preserves its default provenance');
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-slot="${days[1]}:15"] [data-calendar-task]').length`),2,'Manual overlap preserved');
  await clickText('Auto Plan (AI)');await ready();
  await waitFor(()=>evaluate(`document.querySelectorAll('[data-testid="desktop-week-grid"] [data-calendar-task]').length === ${plannerExpectedTasks.length}`),'automatic planning');
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id]').length`),0,'The left list is empty when every task is planned');
  assert.equal(await kpi('Active Tasks'),String(plannerExpectedTasks.length),'Summary still includes scheduled tasks');
  pass('Recommendation dragging, calendar moves, manual overlap and deterministic Auto Plan save through the backend');
  await openSchedule('website:image-alt');
  const imageTask=plannerFixtureState.tasks.find(task=>task.taskKey==='website:image-alt');
  const details=await evaluate(`document.querySelector('[aria-label="Task details"]').textContent`);
  for(const value of [imageTask.title,imageTask.explanation,imageTask.guidance,imageTask.priority,imageTask.category,imageTask.status])assert.ok(details.includes(value),`Calendar dialog contains complete task field: ${value}`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Task details"] a').getAttribute('href')`),imageTask.destination);
  await evaluate(`document.querySelector('dialog input[type="checkbox"]').click()`);
  await setField('planner-task-choice','website:meta-description');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Task details"] h3').textContent`),'Clarify your search summary','Changing the selected task updates its details');
  assert.equal(await evaluate(`document.querySelector('dialog input[type="checkbox"]').checked`),false,'Completion confirmation resets when changing tasks');
  await setField('planner-task-choice','website:image-alt');
  assert.equal(await evaluate(`Array.from(document.querySelector('dialog').querySelectorAll('button')).find(button=>button.textContent.includes('Mark as Done')).disabled`),true);
  await evaluate(`document.querySelector('dialog input[type="checkbox"]').click()`);plannerSaveDelay=1000;
  await clickText('Mark as Done',"document.querySelector('dialog')");assert.equal(await kpi('Done'),'0');assert.equal(await evaluate(`Boolean(document.querySelector('dialog[open]'))`),true,'Dialog waits for acknowledgement');
  await screenshot('smart-planner-completion-saving-1440.png');
  await dialogClosed();plannerSaveDelay=0;assert.equal(await kpi('Done'),'1');
  const completedAt=plannerFixtureState.tasks.find(task=>task.taskKey==='website:image-alt').completedAt;
  await clickText('Re-scan');await ready();assert.equal(await kpi('Done'),'1');assert.equal(plannerFixtureState.tasks.find(task=>task.taskKey==='website:image-alt').completedAt,completedAt);
  await reload();assert.equal(await kpi('Done'),'1');
  assert.equal(await kpi('Plan Completion (This Week)'),'0%','Current-week completion is not replaced by a future planning horizon');
  pass('Completion requires confirmation and server acknowledgement; saved reconciliation and browser reload preserve Done and its original timestamp');
  await clickText('Add Custom Task');await setField('planner-task-name','Review local business notes');await setField('planner-notes','Review the full appointment notes.\nKeep the follow-up instructions available from the calendar.');
  plannerSaveFailure=true;await clickText('Add Task',"document.querySelector('dialog')");await waitFor(async()=>/not confirmed/.test(await pageText()),'save failure shown');
  assert.doesNotMatch(await evaluate(`document.querySelector('p[role="status"]').textContent`),/Saving planner changes/,'A failed save must not leave stale saving feedback');
  await screenshot('smart-planner-create-error-1440.png');
  assert.equal(await evaluate(`Boolean(document.querySelector('dialog[open]'))`),true);assert.equal(await evaluate(`document.getElementById('planner-task-name').value`),'Review local business notes');
  assert.equal(plannerFixtureState.tasks.filter(task=>task.mode==='custom').length,0);
  plannerSaveFailure=false;await clickText('Add Task',"document.querySelector('dialog')");await dialogClosed();
  assert.equal(plannerFixtureState.tasks.filter(task=>task.mode==='custom').length,1);
  assert.equal(plannerFixtureState.tasks.find(task=>task.mode==='custom').durationEstimateSource,'default','Untouched custom duration keeps default provenance');
  const customId=plannerFixtureState.tasks.find(task=>task.mode==='custom').taskKey;
  await openSchedule(customId);
  assert.ok((await evaluate(`document.querySelector('[aria-label="Task details"]').textContent`)).includes(plannerFixtureState.tasks.find(task=>task.taskKey===customId).notes),'Calendar task details include complete multiline custom notes');
  await setField('planner-hour','14');plannerConflict=true;
  await clickText('Save Schedule',"document.querySelector('dialog')");await waitFor(async()=>/conflicted with this action/.test(await pageText()),'conflict feedback');
  assert.equal(await evaluate(`document.getElementById('planner-hour').value`),'14');assert.equal(await evaluate(`Boolean(document.querySelector('dialog[open]'))`),true);
  await clickText('Save Schedule',"document.querySelector('dialog')");await dialogClosed();
  assert.equal(plannerFixtureState.tasks.find(task=>task.taskKey===customId).schedule.hour,14);
  pass('Failed custom saves retain form entries; deliberate retry creates one task; revision conflicts preserve scheduling intent without automatic replay');
  await evaluate(`document.querySelector('button[role="switch"]').click()`);await ready();
  const saturday=await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-calendar-slot]')).map(node=>node.dataset.calendarSlot.split(':')[0]))).sort()[5]`);
  await drag(customId,saturday,11,true);await evaluate(`document.querySelector('button[role="switch"]').click()`);await ready();
  assert.equal(plannerFixtureState.tasks.find(task=>task.taskKey===customId).schedule,null);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-task-id="${customId}"]'))`),true,'Unscheduling returns a task to the left list');
  await openSchedule(customId);await setField('planner-day',saturday);await clickText('Save Schedule',"document.querySelector('dialog')");assert.match(await pageText(),/Enable Use Weekends before scheduling/);
  await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);
  await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'closed schedule dialog unmounted');
  await openSchedule(customId);await clickText('Unschedule',"document.querySelector('dialog')");await dialogClosed();
  pass('Weekend preference persists, disabling weekends clears assignments atomically, and unscheduling retains the custom task');
  plannerFacebookFailure=true;await clickText('Re-scan');await ready();assert.doesNotMatch(await pageText(),/Some saved sources are not ready/);assert.equal(await kpi('Done'),'1');
  await screenshot('smart-planner-source-error-1440.png');
  plannerFacebookFailure=false;await clickText('Re-scan');await ready();await reload();assert.equal(await kpi('Done'),'1');
  plannerReadFailure=true;await cdp.send('Page.reload');
  await waitFor(async()=>/Planner read temporarily unavailable/.test(await pageText()),'initial planner read failure');
  assert.doesNotMatch(await evaluate(`document.querySelector('p[role="status"]').textContent`),/Loading saved planner/,'A failed read must not leave stale loading feedback');
  await screenshot('smart-planner-load-error-1440.png');
  plannerReadFailure=false;await clickText('Re-scan');await ready();
  assert.equal(await kpi('Done'),'1','Retry after a failed initial read restores persisted completion');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),oldStorage);assert.equal(await evaluate(`localStorage.getItem('planner-test-unrelated')`),'keep');
  const storageFailure=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError')}})`});
  await reload();await drag('website:meta-description',days[2],10,true);await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:storageFailure.identifier});
  pass('Failed saved sources retain completion and assignments; original localStorage stays untouched and blocked storage does not affect backend persistence');
  async function setView(view){await evaluate(`(()=>{const node=document.querySelector('select[aria-label="Calendar view"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,${JSON.stringify(view)});node.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  await setView('monthly');const month=await elementText('planner-date-range');await evaluate(`document.querySelector('[aria-label="Next month"]').click()`);assert.notEqual(await elementText('planner-date-range'),month);await evaluate(`document.querySelector('[aria-label="Previous month"]').click()`);assert.equal(await elementText('planner-date-range'),month);
  await setView('weekly');
  for(let attempt=0;attempt<6;attempt++){const first=await evaluate(`document.querySelector('[data-calendar-slot]').dataset.calendarSlot.split(':')[0]`);if(first===days[0])break;await evaluate(`document.querySelector('[aria-label="Next week"]').click()`);}
  for(const width of [1440,768,390,320]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    for(const view of ['weekly','monthly']){
      await setView(view);await evaluate('window.scrollTo(0,0)');await delay(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,`${view} no page overflow at ${width}`);
      if(view==='weekly')assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="${width<768?'mobile-day-grid':'desktop-week-grid'}"]')).display!=='none'`),true);
      else assert.equal(await evaluate(`document.querySelectorAll('[data-month-day]').length%7`),0);
      await screenshot(`smart-planner-${view}-${width}.png`);
    }
  }
  for(const width of [1440,390,320]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await clickText('Add Custom Task');await waitFor(()=>evaluate(`Boolean(document.querySelector('dialog[open]'))`),'custom creation dialog');
    await screenshot(`smart-planner-create-dialog-${width}.png`);
    await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'creation dialog unmounted');
    await openSchedule(customId);await screenshot(`smart-planner-schedule-dialog-${width}.png`);
    await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'schedule dialog unmounted');
    await openSchedule('website:meta-description');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Task details"] h3').textContent`),'Clarify your search summary');
    assert.ok((await evaluate(`document.querySelector('[aria-label="Task details"]').textContent`)).includes(plannerWebsiteSeeds[1].change),'Full guidance remains readable from calendar tasks at every width');
    await screenshot(`smart-planner-guidance-dialog-${width}.png`);
    await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'guidance dialog unmounted');
  }
  pass('Creation, scheduling and guidance dialogs render at desktop and two mobile widths; save and error states use existing UI locations');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});
  await openSchedule(customId);plannerFacebookDelayMs=700;
  await clickText('Re-scan');
  await evaluate(`history.pushState({},'', '/recommendations?businessId=planner-other-business');window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitFor(()=>evaluate(`Boolean(document.querySelector('[data-task-id="custom:other-business"]'))`),'second business planner loaded');
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id]').length`),1);
  assert.equal(await evaluate(`Boolean(document.querySelector('dialog'))`),false,'Previous business dialog does not leak');
  await delay(850);plannerFacebookDelayMs=0;
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id]').length`),1,'Delayed original business response cannot replace current tasks');
  assert.doesNotMatch(await pageText(),/Review local business notes|Confirm the Facebook contact number/);
  await screenshot('smart-planner-business-switch-390.png');
  await evaluate(`history.pushState({},'', '/recommendations?businessId=demo-guzman');window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitFor(()=>evaluate(`Boolean(document.querySelector('[data-calendar-task="website:image-alt"]'))`),'original business planner restored');await ready();
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-task-id="custom:other-business"]'))`),false);
  pass('Business switching hides previous dialogs and tasks and ignores a delayed response from the prior business');
  if(await evaluate(`Boolean(document.querySelector('dialog'))`)){await evaluate(`document.querySelector('button[aria-label="Close planner dialog"]').click()`);await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'restored business dialog closed');}
  const rolloverTasks=Array.from({length:12},(_,index)=>({id:crypto.randomUUID(),taskKey:`custom:rollover-${index}`,title:`Future workload ${index+1}`,explanation:'Offline duration fixture',guidance:'Review the saved task.',priority:'Medium',category:'Review',source:'Custom task',mode:'custom',status:'Needs Action',schedule:null,destination:null,notes:'',estimatedDurationMinutes:60,durationEstimateSource:'user'}));
  const oversized={...rolloverTasks[0],id:crypto.randomUUID(),taskKey:'custom:oversized',title:'Task larger than daily budget',estimatedDurationMinutes:240};
  plannerFixtureState.tasks.push(...rolloverTasks,oversized);plannerFixtureState.revision++;await reload();
  await clickText('Auto Plan (AI)');await ready();
  await waitFor(()=>evaluate(`Boolean(document.querySelector('[data-task-id="custom:oversized"]'))`),'duration overflow remains visible');
  assert.ok(rolloverTasks.every(task=>plannerFixtureState.tasks.find(item=>item.id===task.id).schedule),'Feasible tasks are assigned through the horizon');
  const nextWeek=new Date(`${days[0]}T12:00:00`);nextWeek.setDate(nextWeek.getDate()+7);const nextWeekKey=`${nextWeek.getFullYear()}-${String(nextWeek.getMonth()+1).padStart(2,'0')}-${String(nextWeek.getDate()).padStart(2,'0')}`;
  assert.ok(rolloverTasks.some(task=>plannerFixtureState.tasks.find(item=>item.id===task.id).schedule.day>=nextWeekKey),'Workload carries into later weeks');
  assert.match(await pageText(),/duration exceeds the daily budget/);
  assert.equal(await evaluate(`document.querySelectorAll('[data-task-id]').length`),1,'Only unscheduled overflow remains on the left');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await setView('monthly');await screenshot('smart-planner-multiweek-1440.png');
  await openSchedule(customId);await setField('planner-day',days[0]);await setField('planner-hour','9.5');await setField('planner-duration','90');await clickText('Save Schedule',"document.querySelector('dialog')");await dialogClosed();
  const adjusted=plannerFixtureState.tasks.find(task=>task.taskKey===customId);assert.equal(adjusted.schedule.minute,30);assert.equal(adjusted.estimatedDurationMinutes,90);
  await setView('weekly');const interval=await evaluate(`(()=>{const button=document.querySelector('[data-testid="desktop-week-grid"] [data-calendar-task="${customId}"]');return {label:button.getAttribute('aria-label'),top:button.parentElement.style.top,height:button.parentElement.style.height}})()`);
  assert.match(interval.label,/09:30–11:00/);assert.equal(interval.top,'42px');assert.equal(interval.height,'116px');
  await screenshot('smart-planner-duration-1440.png');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});await screenshot('smart-planner-duration-390.png');
  await clickText('Planning settings');await screenshot('smart-planner-settings-390.png');await evaluate(`document.querySelector('[aria-label="Close planning settings"]').click()`);await waitFor(()=>evaluate(`!document.querySelector('dialog')`),'settings dialog closed');
  pass('Planning settings persist confirmed time zone and workload limits; duration-aware Auto Plan rolls forward, leaves oversized work visible, and renders exact half-hour intervals');
  const writes=browserRequests.slice(requestStart).filter(request=>request.method!=='GET');assert.ok(writes.length>0);assert.ok(writes.every(request=>request.url.includes('/smart-planner/')),'Only planner persistence writes are allowed');
  assert.deepEqual(browserErrors,[]);
  pass('Weekly/monthly calendars retain responsive behavior at four widths with no runtime errors or provider/AI/fix requests');
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
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#primary-navigation a')).map(node => node.textContent)`), ['Dashboard', 'Website', 'Social Media', 'Analysis', 'Smart Planner', 'Connections & Settings']);
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

  if (plannerMode) {
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
