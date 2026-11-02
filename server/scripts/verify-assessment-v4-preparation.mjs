// Offline verification of an existing preview. Never creates an intent or opens
// the source spending ledger; that ledger is inspected through a stable copy.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { readAiUsageSnapshot } from '../dist/integrations/ai/ai-usage-snapshot.js';
import { MetaMuseProvider } from '../dist/integrations/ai/meta-muse.provider.js';
import { AssessmentMuseAdapter, prepareAssessmentMuseEvidence, validateAssessmentMuseOutput } from '../dist/integrations/assessment-ai/assessment-muse.js';
import { assessmentMuseAnalysisSchema } from '../dist/integrations/assessment-ai/assessment-muse.types.js';
import { prepareV4Comparison } from '../dist/integrations/assessment-ai/assessment-v4-evaluation.js';
import { calculateScoreSnapshot } from '../dist/scoring/calculator.js';

const deny = () => { throw new Error('No network, authorization, reservation or generation during preparation verification.'); };
http.get = http.request = https.get = https.request = net.connect = net.createConnection = tls.connect = deny;
globalThis.fetch = deny; syncBuiltinESMExports();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const output = 'reports/assessment-v4-preparation-verification.json';
assert.equal(existsSync(output), false, 'Preserve previous verification artifacts; choose a new reviewed filename.');
const preview = read('reports/assessment-v4-testing-preview.json');
assert.equal(preview.selectionVersion, 'v4');
assert.equal(preview.noAuthorizationOrReservationCreated, true);
assert.equal(preview.networkRequests, 0); assert.equal(preview.metaDispatches, 0);
assert.deepEqual(preview.normalDevelopmentUnchanged, { MOCK_AI: true, AI_MODE: 'mock', AI_ENABLED: false, configuredBudgetMicros: 0 });
const protectedPaths = ['.env', 'reports/ai-usage.sqlite', 'reports/ai-usage.sqlite.initialized', 'reports/ai-usage.sqlite-wal', 'reports/ai-usage.sqlite-shm', 'reports/ai-usage.sqlite-journal', 'reports/seo-spy.sqlite', 'reports/seo-spy.sqlite-wal', 'reports/seo-spy.sqlite-shm'];
const fingerprints = () => protectedPaths.map(path => [path, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null]);
const before = fingerprints();
const database = new DatabaseSync('reports/seo-spy.sqlite', { readOnly: true });
let assessment, histories;
try {
  const rows = database.prepare('SELECT kind,data_json,checksum FROM assessment_records WHERE business_id=?').all(preview.businessId);
  for (const row of rows) assert.equal(hash(JSON.parse(row.data_json)), row.checksum);
  assessment = rows.filter(row => row.kind === 'assessment').map(row => JSON.parse(row.data_json)).find(item => item.id === preview.assessmentId);
  histories = rows.filter(row => row.kind === 'analysis').map(row => JSON.parse(row.data_json));
} finally { database.close(); }
assert.ok(assessment);
assert.equal(hash(calculateScoreSnapshot(assessment.input)), hash(assessment.snapshot));
const reports = [
  read('reports/audits/2026-11-01T19-52-03-282Z_43a66038-2184-4f72-b242-8381102b651d.json'),
  read('reports/audits/2026-11-01T19-51-25-647Z_3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b.json'),
];
const input = { assessmentId: assessment.id, businessId: assessment.businessId, policyVersion: assessment.snapshot.policyVersion, cutoff: assessment.snapshot.cutoff,
  snapshot: assessment.snapshot, sources: reports, scores: Object.entries(assessment.snapshot.scores).map(([category, value]) => ({ category, value: value.value, reasonCodes: value.reasons })) };
const bundle = prepareAssessmentMuseEvidence({ ...input, version: 'v4' });
assert.equal(bundle.schemaVersion, 'seo-spy.assessment-muse-evidence.v4');
assert.equal(hash(bundle), preview.inputHash);
assert.deepEqual(bundle.sources, preview.sourceManifest);
assert.equal(bundle.opportunities.length, 8);
let citationBindings = 0;
for (const item of bundle.opportunities) {
  if (item.action.origin.kind === 'finding') {
    const report = reports.find(report => report.reportId === item.action.reportId);
    assert.equal(report.business.id, bundle.businessId);
    const finding = report.results.findings.find(finding => finding.id === item.action.findingId);
    assert.ok(finding);
    assert.equal(finding.auditId, report.auditId);
    for (const ref of item.action.evidenceRefs) assert.ok(ref.reportId === report.reportId && finding.evidenceIds.includes(ref.evidenceId));
  }
  for (const ref of item.action.evidenceRefs) {
    const report = reports.find(report => report.reportId === ref.reportId);
    assert.equal(report.business.id, bundle.businessId);
    assert.equal(report.audit.businessId, bundle.businessId);
    assert.ok(assessment.snapshot.sources.find(source => source.reportId === ref.reportId).evidenceIds.includes(ref.evidenceId));
    assert.ok(report.results.evidence.some(evidence => evidence.id === ref.evidenceId && evidence.auditId === report.auditId && evidence.mode === 'live'));
    citationBindings++;
  }
}
assert.deepEqual(bundle.opportunities, preview.allowedSelections.opportunities);
assert.deepEqual(prepareV4Comparison(bundle), preview.evaluation);
const config = new ConfigService({ AI_MODE: 'poc', MOCK_AI: false, AI_ENABLED: false, AI_MODEL: 'muse-spark-1.3', AI_PROCESSING_MODE: 'standard', AI_REASONING_EFFORT: 'minimal', AI_MAX_OUTPUT_TOKENS: 1500, AI_DEV_BUDGET_MICROS: 0 });
const provider = new MetaMuseProvider(config, { post: deny }, { estimate: deny, reserve: deny, settle: deny });
const adapter = new AssessmentMuseAdapter(config, provider);
const prepared = adapter.prepare(bundle), wire = provider.prepare(prepared.modelInput);
assert.equal(wire.requestHash, preview.requestHash); assert.equal(wire.reserveMicros, preview.maximumMicros);
assert.equal(prepared.cacheKey, preview.analysisCacheKey); assert.equal(Buffer.byteLength(wire.payload), preview.wireBytes);
assert.equal(wire.requestHash, 'e60d1da34129c5e1b646d89595d35d57c01b4c3b600591e98dab118282868eff');
assert.equal(wire.reserveMicros, 62500);
let historicalReads = 0;
for (const saved of histories) {
  const { createdAt: _createdAt, ...record } = saved; void _createdAt;
  const parsed = assessmentMuseAnalysisSchema.parse(record);
  if (parsed.assessmentId !== assessment.id) continue;
  const version = parsed.promptVersion.endsWith('-v4') ? 'v4' : parsed.promptVersion.endsWith('-v3') ? 'v3' : parsed.promptVersion.endsWith('-v2') ? 'v2' : undefined;
  const historic = prepareAssessmentMuseEvidence({ ...input, version, ...(version ? {} : { snapshot: undefined }) });
  assert.equal(hash(historic), parsed.inputHash); validateAssessmentMuseOutput(parsed.output, historic); historicalReads++;
}
const usage = await readAiUsageSnapshot(new ConfigService({ AI_USAGE_DB: 'reports/ai-usage.sqlite' }));
assert.deepEqual(usage, preview.ledger);
assert.ok(usage.testing); assert.equal(usage.halted, false); assert.equal(usage.activeAttemptId, null); assert.equal(usage.testing.incompleteReceipts, 0);
assert.deepEqual(fingerprints(), before);
const result = { stage: 'v4-preparation-verified-no-authorization', requestHash: wire.requestHash, inputHash: prepared.inputHash, maximumMicros: wire.reserveMicros, wireBytes: Buffer.byteLength(wire.payload), maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens, priceVersion: wire.priceVersion,
  candidates: bundle.opportunities.map(item => ({ id: item.id, group: item.group, kind: item.kind, title: item.action.title, reportId: item.action.reportId, findingId: item.action.findingId, evidenceRefs: item.action.evidenceRefs })),
  baselineIds: preview.evaluation.baselineIds, citationBindings, historicalReads, scoreSnapshotReplayed: true, protectedFilesUnchanged: true,
  fundedRemainingMicros: usage.testing.allocation.fundedMicros - usage.testing.chargedMicros, testingCallsRemaining: usage.testing.policy.maxCalls - usage.testing.calls, dailyReservationRemainingMicros: usage.testing.policy.dailyReservationMicros - usage.testing.dailyReservedMicros,
  networkRequests: 0, metaDispatches: 0, newIntents: 0, newApprovals: 0, newReservations: 0,
  evaluation: preview.evaluation, limits: 'Preparation is not spending authorization. One separately approved exact request only; no retry, fallback, model-request storage or automatic publishing.' };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...result, candidates: undefined, evaluation: undefined }, null, 2));
