// Read-only verification of the prepared request and saved v4 comparator.
// Never imports an application bootstrap or creates authorization/accounting rows.
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
import { AssessmentMuseAdapter, prepareAssessmentMuseEvidence, validateAssessmentMuseAnalysisOutput } from '../dist/integrations/assessment-ai/assessment-muse.js';
import { assessmentMuseAnalysisSchema } from '../dist/integrations/assessment-ai/assessment-muse.types.js';
import { prepareV5Comparison } from '../dist/integrations/assessment-ai/assessment-v4-evaluation.js';
import { transparencyProjection } from '../dist/integrations/assessment-ai/assessment-muse-transparency.js';
import { calculateScoreSnapshot } from '../dist/scoring/calculator.js';

const deny = () => { throw new Error('No network, authorization, reservation or generation during preparation verification.'); };
http.get = http.request = https.get = https.request = net.connect = net.createConnection = tls.connect = deny;
globalThis.fetch = deny; syncBuiltinESMExports();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const output = 'reports/assessment-v5-preparation-verification.json';
assert.equal(existsSync(output), false, 'Preserve previous artifacts; review a new output filename before repeating.');
const before = read('reports/assessment-v5-preparation-integrity-before.json');
const fingerprints = () => Object.fromEntries(Object.keys(before).map(path => [path, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null]));
assert.deepEqual(fingerprints(), before);
const preview = read('reports/assessment-v5-testing-preview.json');
assert.equal(preview.selectionVersion, 'v5');
assert.equal(preview.noAuthorizationOrReservationCreated, true);
assert.equal(preview.networkRequests, 0); assert.equal(preview.metaDispatches, 0);
assert.deepEqual(preview.normalDevelopmentUnchanged, { MOCK_AI: true, AI_MODE: 'mock', AI_ENABLED: false, configuredBudgetMicros: 0 });
const database = new DatabaseSync('reports/seo-spy.sqlite', { readOnly: true });
let assessment, histories;
try {
  const rows = database.prepare('SELECT kind,data_json,checksum FROM assessment_records WHERE business_id=?').all(preview.businessId);
  for (const row of rows) assert.equal(hash(JSON.parse(row.data_json)), row.checksum);
  assessment = rows.filter(row => row.kind === 'assessment').map(row => JSON.parse(row.data_json)).find(item => item.id === preview.assessmentId);
  histories = rows.filter(row => row.kind === 'analysis').map(row => JSON.parse(row.data_json));
} finally { database.close(); }
assert.ok(assessment);
assert.equal(assessment.id, 'a0c19a0e-2be3-447e-a795-e7fdee84c0bf');
assert.equal(hash(calculateScoreSnapshot(assessment.input)), hash(assessment.snapshot));
assert.equal(assessment.snapshot.policyVersion, 'seo-spy-score-v1.4');
const reports = [
  read('reports/audits/2026-11-01T19-52-03-282Z_43a66038-2184-4f72-b242-8381102b651d.json'),
  read('reports/audits/2026-11-01T19-51-25-647Z_3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b.json'),
];
const input = { assessmentId: assessment.id, businessId: assessment.businessId, policyVersion: assessment.snapshot.policyVersion, cutoff: assessment.snapshot.cutoff,
  snapshot: assessment.snapshot, sources: reports, scores: Object.entries(assessment.snapshot.scores).map(([category, value]) => ({ category, value: value.value, reasonCodes: value.reasons })) };
const bundle = prepareAssessmentMuseEvidence({ ...input, version: 'v5' });
assert.equal(bundle.schemaVersion, 'seo-spy.assessment-muse-evidence.v5');
assert.equal(hash(bundle), preview.inputHash); assert.deepEqual(bundle.sources, preview.sourceManifest);
assert.deepEqual(bundle.sources.map(row => row.contentHash), [
  'c2cb2983513bb071ef9745b52c6ca550bc39fcc6adcd924e2e7998afd09e629d',
  '7d879b07361625afd108f7bc865b9ccd6e5024f50c13383f23412ffedd76c479',
]);
assert.equal(bundle.opportunities.length, 8);
let citationBindings = 0;
for (const item of bundle.opportunities) {
  if (item.action.origin.kind === 'finding') {
    const report = reports.find(report => report.reportId === item.action.reportId);
    assert.equal(report.business.id, bundle.businessId);
    const finding = report.results.findings.find(finding => finding.id === item.action.findingId);
    assert.ok(finding); assert.equal(finding.auditId, report.auditId);
    for (const ref of item.action.evidenceRefs) assert.ok(ref.reportId === report.reportId && finding.evidenceIds.includes(ref.evidenceId));
  }
  for (const ref of item.action.evidenceRefs) {
    const report = reports.find(report => report.reportId === ref.reportId);
    assert.equal(report.business.id, bundle.businessId); assert.equal(report.audit.businessId, bundle.businessId);
    assert.ok(assessment.snapshot.sources.find(source => source.reportId === ref.reportId).evidenceIds.includes(ref.evidenceId));
    assert.ok(report.results.evidence.some(evidence => evidence.id === ref.evidenceId && evidence.auditId === report.auditId && evidence.mode === 'live'));
    citationBindings++;
  }
}
assert.deepEqual(bundle.opportunities, preview.allowedSelections.opportunities);
assert.deepEqual(bundle.reviewIfOmittedIds, preview.reviewIfOmittedIds);
assert.deepEqual(prepareV5Comparison(bundle), preview.evaluation);
const config = new ConfigService({ AI_MODE: 'poc', MOCK_AI: false, AI_ENABLED: false, AI_CONTROLLED_TESTING: true, AI_MODEL: 'muse-spark-1.3', AI_PROCESSING_MODE: 'standard', AI_REASONING_EFFORT: 'minimal', AI_MAX_OUTPUT_TOKENS: 1500, AI_DEV_BUDGET_MICROS: 0 });
const provider = new MetaMuseProvider(config, { post: deny }, { estimate: deny, reserve: deny, settle: deny });
const adapter = new AssessmentMuseAdapter(config, provider);
const prepared = adapter.prepare(bundle), wire = provider.prepare(prepared.modelInput);
assert.equal(wire.requestHash, preview.requestHash); assert.equal(wire.reserveMicros, preview.maximumMicros);
assert.equal(prepared.cacheKey, preview.analysisCacheKey); assert.equal(Buffer.byteLength(wire.payload), preview.wireBytes);
const payload = JSON.parse(wire.payload);
assert.deepEqual(payload.tools, []); assert.equal(payload.tool_choice, 'auto');
assert.equal(payload.store, false); assert.equal(payload.stream, false); assert.equal(payload.background, false);
assert.equal(payload.text.format.strict, true);
assert.equal(payload.text.format.schema.properties.schemaVersion.const, 'assessment-muse-selection-output-v5');
let historicalReads = 0;
for (const saved of histories) {
  const { createdAt: _createdAt, ...record } = saved; void _createdAt;
  const parsed = assessmentMuseAnalysisSchema.parse(record);
  if (parsed.assessmentId !== assessment.id) continue;
  const version = parsed.promptVersion.endsWith('-v5') ? 'v5' : parsed.promptVersion.endsWith('-v4') ? 'v4' : parsed.promptVersion.endsWith('-v3') ? 'v3' : parsed.promptVersion.endsWith('-v2') ? 'v2' : undefined;
  const historic = prepareAssessmentMuseEvidence({ ...input, version, ...(version ? {} : { snapshot: undefined }) });
  assert.equal(hash(historic), parsed.inputHash); validateAssessmentMuseAnalysisOutput(parsed, historic); historicalReads++;
}
const v4 = prepareAssessmentMuseEvidence({ ...input, version: 'v4' });
const priorWire = provider.prepare(adapter.prepare(v4).modelInput);
assert.equal(priorWire.requestHash, 'e60d1da34129c5e1b646d89595d35d57c01b4c3b600591e98dab118282868eff');
const prior = histories.find(row => row.id === '70578de9-ca1d-41ce-a142-cfd5bf00a97a');
assert.ok(prior); assert.equal(prior.decisionLabels, undefined);
assert.equal(prior.authorization.requestHash, priorWire.requestHash);
const priorReceipt = read('reports/assessment-v4-testing-result.json').receipt;
assert.equal(priorReceipt.analysisId, prior.id); assert.equal(priorReceipt.requestHash, priorWire.requestHash);
assert.deepEqual(prior.output.recommendations.map(row => row.id), ['o_9eeb0b598d92d844', 'o_1dc22beb90342d37']);
const usage = await readAiUsageSnapshot(new ConfigService({ AI_USAGE_DB: 'reports/ai-usage.sqlite' }));
assert.deepEqual(usage, preview.ledger);
assert.ok(usage.testing); assert.equal(usage.halted, false); assert.equal(usage.activeAttemptId, null); assert.equal(usage.testing.incompleteReceipts, 0);
assert.deepEqual(fingerprints(), before);
const result = { stage: 'v5-preparation-verified-no-authorization', requestHash: wire.requestHash, inputHash: prepared.inputHash, maximumMicros: wire.reserveMicros,
  wireBytes: Buffer.byteLength(wire.payload), maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens, priceVersion: wire.priceVersion,
  candidates: bundle.opportunities.map(item => ({ id: item.id, group: item.group, kind: item.kind, title: item.action.title, reportId: item.action.reportId, findingId: item.action.findingId, evidenceRefs: item.action.evidenceRefs })),
  reviewIfOmittedIds: bundle.reviewIfOmittedIds, baselineIds: preview.evaluation.baselineIds, citationBindings, historicalReads, scoreSnapshotReplayed: true, protectedFilesUnchanged: true,
  fundedRemainingMicros: usage.testing.allocation.fundedMicros - usage.testing.chargedMicros, testingCallsRemaining: usage.testing.policy.maxCalls - usage.testing.calls,
  dailyReservationRemainingMicros: usage.testing.policy.dailyReservationMicros - usage.testing.dailyReservedMicros,
  networkRequests: 0, metaDispatches: 0, newIntents: 0, newApprovals: 0, newReservations: 0,
  v4Comparator: { analysisId: prior.id, requestHash: priorWire.requestHash, selectedIds: prior.output.recommendations.map(row => row.id), decisionLabels: null,
    inputTokens: priorReceipt.inputTokens, outputTokens: priorReceipt.outputTokens, reasoningTokens: priorReceipt.reasoningTokens, estimatedTokenMicros: priorReceipt.estimatedTokenMicros,
    wireBytes: Buffer.byteLength(priorWire.payload), maximumMicros: priorWire.reserveMicros },
  payloadGrowth: { bytes: Buffer.byteLength(wire.payload) - Buffer.byteLength(priorWire.payload), percent: 100 * (Buffer.byteLength(wire.payload) / Buffer.byteLength(priorWire.payload) - 1),
    projectionBytes: Buffer.byteLength(JSON.stringify(transparencyProjection(bundle))), actualTokenAndCostOverhead: null },
  evaluation: preview.evaluation,
  pendingLiveReview: { selectedOpportunities: null, prioritiesDefensible: null, labelsUseful: null, importantOmissions: null, schemaAccepted: null, actualCostChange: null },
  limits: 'Preparation is not authorization. Label validity is premise compatibility, not proof of actual motive or business usefulness. No retry, fallback, collection, model storage or WordPress action.' };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...result, candidates: undefined, evaluation: undefined }, null, 2));
