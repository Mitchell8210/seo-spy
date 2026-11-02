import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const encode = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const apiUrl = encode(await readFile(new URL('../src/services/plannerApi.ts', import.meta.url), 'utf8'));
const { PlannerApiError } = await import(apiUrl);
const wordpressUrl = encode(await readFile(new URL('../src/services/wordpressFix.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/services/plannerAi.ts', import.meta.url), 'utf8')).replace("'./plannerApi'", JSON.stringify(apiUrl)).replace("'./wordpressFix'", JSON.stringify(wordpressUrl));
const { effectiveAiBudget, parseAiSettings, parseAiProposal, requestAi } = await import(encode(source));
const businessId = 'business-a';
const taskId = '11111111-1111-4111-8111-111111111111';
const secondTaskId = '22222222-2222-4222-8222-222222222222';
const settings = { weeklyAvailableMinutes: 600, targetUtilization: 70, horizonWeeks: 4, dailyLimitMinutes: 120, workingDays: [1, 2, 3, 4, 5], protectExistingSchedules: true };
const settingsResponse = () => ({ businessId, plannerRevision: 3, settings: structuredClone(settings), weeklyBudgetMinutes: 420 });
const entry = () => ({
  taskId, recommendedPriority: 'Medium', estimatedImpact: 'High', impactConfidence: 'Medium', impactRationale: 'Saved evidence suggests important content work; no ranking gain is promised.',
  estimatedMinutes: 60, effortConfidence: 'Low', effortRationale: 'Human planning estimate, not measured effort.', complexityAssumptions: ['One person follows the supplied guidance.'],
  dependencies: { required: [], suggested: [] }, proposedStart: { day: '2026-11-02', hour: 9, minute: 0 }, proposedEnd: { day: '2026-11-02', hour: 10, minute: 0 },
  schedulingRationale: 'Important work fits early within daily and weekly capacity.', deferredReason: null,
});
const proposal = () => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', businessId, plannerRevision: 3, mode: 'mock', model: 'offline-simulation', status: 'ready', stale: false, expired: false,
  createdAt: '2026-11-02T08:00:00.000Z', expiresAt: '2026-11-09T08:00:00.000Z', appliedAt: null, promptVersion: 'seo-impact-roadmap-v1', schemaVersion: 'planner-muse-proposal-v1', snapshotHash: 'a'.repeat(64),
  settings: structuredClone(settings), weeklyBudgetMinutes: 420,
  tasks: [{ id: taskId, title: 'Review important content', description: 'Saved content finding', guidance: 'Review the saved evidence.', priority: 'Medium', sourceSeverity: null, evidence: { channel: 'website', referenceHash: 'b'.repeat(64) }, status: 'Needs Action', protected: false, schedule: null, estimatedMinutes: 60, estimateSource: 'user' }],
  output: { schemaVersion: 'planner-muse-proposal-v1', businessId, plannerRevision: 3, snapshotHash: 'a'.repeat(64), planningWindow: { start: '2026-11-02', end: '2026-11-30' }, entries: [entry()],
    weeklyWorkloads: ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map((weekStart, index) => ({ weekStart, proposedMinutes: index === 0 ? 60 : 0, existingMinutes: 0, totalMinutes: index === 0 ? 60 : 0 })),
    tradeoffs: ['Headroom is reserved for uncertainty.'], prioritizationRationale: 'Expected qualitative impact before task count or maximum utilization.',
  }, diagnostics: [],
});
const invalidResponse = error => error instanceof PlannerApiError && error.status === 502;
const rejectSettings = (name, edit) => { const value = settingsResponse(); edit(value); assert.throws(() => parseAiSettings(value, businessId), invalidResponse, name); };
const rejectProposal = (name, edit) => { const value = proposal(); edit(value); assert.throws(() => parseAiProposal(value, businessId), invalidResponse, name); };

assert.equal(effectiveAiBudget(settings), 420);
assert.equal(effectiveAiBudget({ ...settings, weeklyAvailableMinutes: 630, targetUtilization: 70 }), 420, 'Budget rounds down to a supported half hour');
assert.deepEqual(parseAiSettings(settingsResponse(), businessId), settingsResponse());
for (const horizonWeeks of [2, 4, 8, 52]) {
  const value = settingsResponse(); value.settings.horizonWeeks = horizonWeeks; assert.equal(parseAiSettings(value, businessId).settings.horizonWeeks, horizonWeeks);
}
for (const [name, edit] of [
  ['different business', value => { value.businessId = 'business-b'; }],
  ['negative revision', value => { value.plannerRevision = -1; }],
  ['string revision', value => { value.plannerRevision = '3'; }],
  ['incorrect budget', value => { value.weeklyBudgetMinutes = 600; }],
  ['non-integral availability', value => { value.settings.weeklyAvailableMinutes = 615; }],
  ['invalid utilization', value => { value.settings.targetUtilization = 100; }],
  ['zero horizon', value => { value.settings.horizonWeeks = 0; }],
  ['overlong horizon', value => { value.settings.horizonWeeks = 53; }],
  ['no working days', value => { value.settings.workingDays = []; }],
  ['duplicate working days', value => { value.settings.workingDays = [1, 1]; }],
  ['unknown working day', value => { value.settings.workingDays = [0, 8]; }],
  ['string working day', value => { value.settings.workingDays = ['1']; }],
  ['invalid daily limit', value => { value.settings.dailyLimitMinutes = 45; }],
  ['non-boolean protection', value => { value.settings.protectExistingSchedules = 'true'; }],
]) rejectSettings(name, edit);
console.log('PASS: AI settings business scope, workload budget, supported horizons, working days and strict numeric types');

assert.equal(parseAiProposal(null, businessId), null);
assert.deepEqual(parseAiProposal(proposal(), businessId), proposal());
for (const status of ['generating', 'invalid', 'failed', 'approval_required']) {
  const value = proposal(); value.status = status; value.output = null; value.model = null;
  value.diagnostics = [{ code: 'AI_OFFLINE_FIXTURE', detail: 'A bounded, safe fixture diagnostic.' }];
  assert.equal(parseAiProposal(value, businessId).status, status);
}
const deferred = proposal(); deferred.output.entries[0].proposedStart = null; deferred.output.entries[0].proposedEnd = null; deferred.output.entries[0].deferredReason = 'The task does not fit sustainable capacity.';
deferred.output.weeklyWorkloads[0].proposedMinutes = 0; deferred.output.weeklyWorkloads[0].totalMinutes = 0;
assert.equal(parseAiProposal(deferred, businessId).output.entries[0].proposedStart, null);
const protectedCommitment = proposal();
protectedCommitment.tasks.push({ ...structuredClone(protectedCommitment.tasks[0]), id: secondTaskId, title: 'Protected manual work', protected: true, schedule: { day: '2026-11-03', hour: 9, minute: 0 } });
protectedCommitment.output.weeklyWorkloads[0].existingMinutes = 60; protectedCommitment.output.weeklyWorkloads[0].totalMinutes = 120;
assert.equal(parseAiProposal(protectedCommitment, businessId).tasks[1].protected, true);
for (const [name, edit] of [
  ['different business', value => { value.businessId = 'business-b'; }],
  ['invalid proposal ID', value => { value.id = 'not-a-uuid'; }],
  ['invalid mode', value => { value.mode = 'fallback'; }],
  ['invalid status', value => { value.status = 'saved-without-approval'; }],
  ['missing stale flag', value => { delete value.stale; }],
  ['non-boolean expiration', value => { value.expired = 'false'; }],
  ['ready without output', value => { value.output = null; }],
  ['applied without output', value => { value.status = 'applied'; value.output = null; }],
  ['invalid snapshot task ID', value => { value.tasks[0].id = 'other'; }],
  ['too many tasks', value => { value.tasks = Array.from({ length: 61 }, () => value.tasks[0]); }],
  ['malformed diagnostics', value => { value.diagnostics = [{ code: 5, detail: 'Invalid' }]; }],
  ['too many diagnostics', value => { value.diagnostics = Array.from({ length: 51 }, () => ({ code: 'x', detail: 'x' })); }],
  ['unsupported output schema', value => { value.output.schemaVersion = 'unknown-v2'; }],
  ['unknown priority', value => { value.output.entries[0].recommendedPriority = 'Highest'; }],
  ['unknown impact', value => { value.output.entries[0].estimatedImpact = 'Guaranteed'; }],
  ['unknown confidence', value => { value.output.entries[0].effortConfidence = 'Certain'; }],
  ['unsupported duration', value => { value.output.entries[0].estimatedMinutes = 45; }],
  ['malformed assumptions', value => { value.output.entries[0].complexityAssumptions = 'None'; }],
  ['malformed dependencies', value => { value.output.entries[0].dependencies.required = null; }],
  ['invalid minute', value => { value.output.entries[0].proposedStart.minute = 15; }],
  ['invalid hour', value => { value.output.entries[0].proposedEnd.hour = 18; }],
  ['missing workload weeks', value => { value.output.weeklyWorkloads.pop(); }],
  ['negative workload', value => { value.output.weeklyWorkloads[0].proposedMinutes = -30; }],
  ['incorrect workload sum', value => { value.output.weeklyWorkloads[0].totalMinutes = 90; }],
]) rejectProposal(name, edit);
console.log('PASS: AI proposal states, deferred tasks, impact/effort enums, bounded diagnostics and workload summaries');

// Backend enforcement is authoritative; client parsing must still refuse malformed
// transport responses rather than rendering them as an approvable saved plan.
for (const [name, edit] of [
  ['invalid generated timestamp', value => { value.createdAt = 'not-a-date'; }],
  ['invalid application timestamp', value => { value.appliedAt = 'not-a-date'; }],
  ['invalid snapshot hash', value => { value.snapshotHash = 'not-a-hash'; }],
  ['mismatched output business', value => { value.output.businessId = 'business-b'; }],
  ['mismatched output revision', value => { value.output.plannerRevision = 4; }],
  ['mismatched output snapshot hash', value => { value.output.snapshotHash = 'b'.repeat(64); }],
  ['invalid planning window date', value => { value.output.planningWindow.start = '2026-02-30'; }],
  ['invalid planning window order', value => { value.output.planningWindow.end = '2026-11-01'; }],
  ['invalid task priority', value => { value.tasks[0].priority = 'unknown'; }],
  ['unsupported task duration', value => { value.tasks[0].estimatedMinutes = 31; }],
  ['invalid existing schedule date', value => { value.tasks[0].schedule = { day: '2026-02-30', hour: 9, minute: 0 }; }],
  ['invalid existing schedule minute', value => { value.tasks[0].schedule = { day: '2026-11-02', hour: 9, minute: 15 }; }],
  ['invalid proposed civil date', value => { value.output.entries[0].proposedStart.day = '2026-02-30'; }],
  ['string proposed minute', value => { value.output.entries[0].proposedStart.minute = '0'; }],
  ['string proposed duration', value => { value.output.entries[0].estimatedMinutes = '60'; }],
  ['invalid dependency identifier', value => { value.output.entries[0].dependencies.required = ['not-a-uuid']; }],
  ['duplicate entry identifiers', value => { value.output.entries.push(structuredClone(value.output.entries[0])); }],
  ['unknown entry identifier', value => { value.output.entries[0].taskId = secondTaskId; }],
  ['missing candidate entry', value => { value.output.entries = []; }],
  ['protected entry', value => { value.tasks[0].protected = true; }],
  ['unknown dependency identifier', value => { value.output.entries[0].dependencies.required = [secondTaskId]; }],
  ['inconsistent interval', value => { value.output.entries[0].proposedEnd.hour = 11; }],
  ['deferred with an end', value => { value.output.entries[0].proposedStart = null; value.output.entries[0].deferredReason = 'Deferred'; }],
  ['placement with a deferred reason', value => { value.output.entries[0].deferredReason = 'Deferred'; }],
  ['invalid workload civil date', value => { value.output.weeklyWorkloads[0].weekStart = '2026-02-30'; }],
]) rejectProposal(name, edit);
console.log('PASS: AI calendar dates, timestamps, task identity, strict interval values and placement consistency');

const originalFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(settingsResponse()), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const signal = new AbortController().signal;
  assert.deepEqual(await requestAi('business/a', '/ai-preferences', signal), settingsResponse());
  assert.equal(calls[0].url, '/api/businesses/business%2Fa/smart-planner/ai-preferences');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls.length, 1); assert.equal(calls[0].options.body, undefined);
  const body = { expectedRevision: 3, mutationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', mode: 'mock', weekStart: '2026-11-02' };
  await requestAi(businessId, '/ai-proposals', signal, 'POST', body);
  assert.deepEqual(JSON.parse(calls[1].options.body), body); assert.equal(calls[1].options.headers['content-type'], 'application/json');
  const liveCalls = [];
  globalThis.fetch = async (url, options) => {
    liveCalls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/browser-session')
      ? { connected: true, businessId, csrf: 'x'.repeat(43), expiresAt: new Date(Date.now() + 3600000).toISOString() }
      : proposal()), { status: 200 });
  };
  await requestAi(businessId, '/ai-proposals', signal, 'POST', { ...body, mode: 'live' });
  assert.equal(liveCalls[0].url, '/api/wordpress/browser-session');
  assert.equal(liveCalls[1].url, `/api/wordpress/businesses/${businessId}/smart-planner/ai-proposals`);
  assert.equal(liveCalls[1].options.headers['x-wordpress-csrf'], 'x'.repeat(43));
  assert.equal(liveCalls[1].options.credentials, 'same-origin');
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error('Network failed'); };
  await assert.rejects(requestAi(businessId, '/ai-proposals', signal, 'POST', body), error => error instanceof PlannerApiError && error.status === 0 && /not confirmed/.test(error.message));
  assert.equal(attempts, 1, 'An ambiguous paid generation request is never automatically retried');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Planner changed; regenerate the proposal.' } }), { status: 409 });
  await assert.rejects(requestAi(businessId, '/ai-proposals', signal, 'POST', body), error => error instanceof PlannerApiError && error.status === 409 && /regenerate/.test(error.message));
  globalThis.fetch = async () => new Response(JSON.stringify({ unexpected: true }), { status: 503 });
  await assert.rejects(requestAi(businessId, '/ai-proposals', signal, 'POST', body), error => error instanceof PlannerApiError && error.status === 503 && /failed/.test(error.message));
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  await assert.rejects(requestAi(businessId, '/ai-proposals', signal), invalidResponse);
  const controller = new AbortController(); controller.abort(); let aborted = false;
  globalThis.fetch = async (_url, options) => { aborted = options.signal.aborted; throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(requestAi(businessId, '/ai-proposals', controller.signal, 'POST', body), error => error instanceof PlannerApiError && error.status === 0);
  assert.equal(aborted, true, 'Business switch/unmount cancellation reaches the transport');
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: AI request transport, scoped URLs, mutation bodies, aborts, meaningful errors and zero automatic retries');
