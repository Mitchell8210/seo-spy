// Offline saved-data replay. Never opens the spending ledger or starts Nest.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { AssessmentMuseAdapter, prepareAssessmentMuseEvidence, validateAssessmentMuseOutput } from '../dist/integrations/assessment-ai/assessment-muse.js';
import { MetaMuseProvider } from '../dist/integrations/ai/meta-muse.provider.js';
import { assessmentMuseAnalysisSchema } from '../dist/integrations/assessment-ai/assessment-muse.types.js';
import { groupedOpportunityBaseline, opportunityProjection } from '../dist/integrations/assessment-ai/assessment-muse-opportunities.js';
import { syntheticOpportunityBundle } from '../dist/integrations/assessment-ai/fixtures/opportunity-scenarios.js';

const deny = () => { throw new Error('No networking, generation, authorization or spending in offline evaluation.'); };
http.get = http.request = https.get = https.request = net.connect = net.createConnection = tls.connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const protectedPaths = ['.env', 'reports/ai-usage.sqlite', 'reports/ai-usage.sqlite-wal', 'reports/ai-usage.sqlite-shm', 'reports/ai-usage.sqlite.initialized'];
const protectedHashes = () => protectedPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path).toString('base64')) : null]);
const before = protectedHashes();
const database = new DatabaseSync('reports/seo-spy.sqlite', { readOnly: true });
let record, histories;
try {
  const rows = database.prepare('SELECT kind,data_json,checksum FROM assessment_records WHERE business_id=?').all('demo-guzman');
  for (const row of rows) assert.equal(hash(JSON.parse(row.data_json)), row.checksum);
  record = rows.filter(row => row.kind === 'assessment').map(row => JSON.parse(row.data_json)).find(item => item.id === 'a0c19a0e-2be3-447e-a795-e7fdee84c0bf');
  histories = rows.filter(row => row.kind === 'analysis').map(row => JSON.parse(row.data_json));
} finally { database.close(); }
assert.ok(record);
const reports = [
  read('reports/audits/2026-11-01T19-52-03-282Z_43a66038-2184-4f72-b242-8381102b651d.json'),
  read('reports/audits/2026-11-01T19-51-25-647Z_3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b.json'),
];
const input = { assessmentId: record.id, businessId: record.businessId, policyVersion: record.snapshot.policyVersion, cutoff: record.snapshot.cutoff,
  snapshot: record.snapshot, sources: reports, scores: Object.entries(record.snapshot.scores).map(([category, value]) => ({ category, value: value.value, reasonCodes: value.reasons })) };
const v3 = prepareAssessmentMuseEvidence({ ...input, version: 'v3' });
const v4 = prepareAssessmentMuseEvidence({ ...input, version: 'v4' });
assert.equal(hash(v3), '2979be4de0f5924adc0068cf649f4a21efde989cb0afebadcf0185b4bdee6be3');
let historicalReads = 0;
for (const saved of histories) {
  const { createdAt: _createdAt, ...value } = saved;
  void _createdAt;
  const parsed = assessmentMuseAnalysisSchema.parse(value);
  if (parsed.assessmentId !== record.id) continue;
  const version = parsed.promptVersion.endsWith('-v3') ? 'v3' : parsed.promptVersion.endsWith('-v2') ? 'v2' : undefined;
  const bundle = prepareAssessmentMuseEvidence({ ...input, version, ...(version ? {} : { snapshot: undefined }) });
  assert.equal(hash(bundle), parsed.inputHash);
  validateAssessmentMuseOutput(parsed.output, bundle);
  historicalReads++;
}
const config = new ConfigService({ MOCK_AI: true, AI_MODE: 'mock', AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0, AI_REASONING_EFFORT: 'minimal' });
const provider = new MetaMuseProvider(config, { post: deny }, { estimate: deny, reserve: deny, settle: deny });
const adapter = new AssessmentMuseAdapter(config, provider);
const old = adapter.prepare(v3), prepared = adapter.prepare(v4);
const oldWire = provider.prepare(old.modelInput), wire = provider.prepare(prepared.modelInput);
assert.equal(oldWire.requestHash, '65b838874e3a18b913d0f15b026dbc677e443cec712775c30d08a3b601bd0349');
assert.notEqual(old.cacheKey, prepared.cacheKey);
const result = await adapter.analyze(v4);
const syntheticScenarios = [];
for (const scenario of read('tests/fixtures/muse-v4-scenarios.json')) {
  const bundle = syntheticOpportunityBundle(scenario);
  const output = (await adapter.analyze(bundle)).output;
  syntheticScenarios.push({ id: scenario.id, provenance: 'SYNTHETIC OFFLINE FIXTURE; not Guzman evidence or real Muse reasoning.',
    originalCandidates: scenario.candidates.length, eligibleCandidates: bundle.opportunities.length,
    deterministicBaseline: groupedOpportunityBaseline(bundle.opportunities), mockOutput: output });
}
assert.equal(result.isMock, true);
assert.equal(result.usage.inputTokens, 0);
assert.deepEqual(protectedHashes(), before);
// This frozen sanitized backend bundle contains no raw provider response/contact
// values and is useful for reproducible contract tests without local databases.
writeFileSync('tests/fixtures/muse-v4-guzman.json', JSON.stringify(v4, null, 2) + '\n');
const evaluation = { version: 'muse-v4-offline-evaluation-v1', providerCalls: 0, spendingAuthorizationChanges: 0,
  historicalReads, historicalV3HashUnchanged: true, historicalV3RequestHashUnchanged: true, protectedFilesUnchanged: true,
  syntheticScenarios,
  actualGuzman: { eligibleCandidates: v4.opportunities.length, groups: v4.opportunities.map(item => ({ id: item.id, group: item.group, kind: item.kind })),
    deterministicBaseline: groupedOpportunityBaseline(v4.opportunities), inputHash: prepared.inputHash, cacheKey: prepared.cacheKey, mockOutput: result.output },
  sizes: { v3EvidenceBytes: bytes(v3), v4AuthoritativeBackendBundleBytes: bytes(v4), v4ProjectionBytes: bytes(opportunityProjection(v4)),
    v3ModelInputBytes: bytes(old.modelInput), v4ModelInputBytes: bytes(prepared.modelInput), v3WireBytes: Buffer.byteLength(oldWire.payload), v4WireBytes: Buffer.byteLength(wire.payload) },
  liveReadiness: 'Offline contracts only. No evidence of actual Muse prioritization quality. A separately approved exact v4 request/reservation and v4 operator support are required before dispatch.' };
writeFileSync('reports/muse-v4-offline-evaluation.json', JSON.stringify(evaluation, null, 2) + '\n');
console.log(JSON.stringify({ ...evaluation, syntheticScenarios: syntheticScenarios.map(item => ({ ...item, mockOutput: undefined })), actualGuzman: { ...evaluation.actualGuzman, mockOutput: undefined } }, null, 2));
