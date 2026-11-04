// Offline only: saved evidence, pure request sizing and local mock rendering.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { AssessmentMuseAdapter, prepareAssessmentMuseEvidence, validateAssessmentMuseAnalysisOutput } from '../dist/integrations/assessment-ai/assessment-muse.js';
import { assessmentMuseAnalysisSchema } from '../dist/integrations/assessment-ai/assessment-muse.types.js';
import { expandTransparencySelection, transparencyProjection, validateTransparencySelection } from '../dist/integrations/assessment-ai/assessment-muse-transparency.js';
import { opportunityProjection } from '../dist/integrations/assessment-ai/assessment-muse-opportunities.js';
import { MetaMuseProvider } from '../dist/integrations/ai/meta-muse.provider.js';
import { calculateScoreSnapshot } from '../dist/scoring/calculator.js';

const deny = () => { throw new Error('No live generation, collection, authorization or ledger operations in offline evaluation.'); };
http.get = http.request = https.get = https.request = net.connect = net.createConnection = tls.connect = deny;
globalThis.fetch = deny; syncBuiltinESMExports();
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const output = 'reports/muse-v5-offline-evaluation-final.json';
assert.equal(existsSync(output), false, 'Preserve previous evaluations; choose a new reviewed output filename.');
const before = read('reports/muse-v5-protected-before.json');
const fingerprint = () => Object.fromEntries(Object.keys(before).map(path => [path, existsSync(resolve('..', path)) ? createHash('sha256').update(readFileSync(resolve('..', path))).digest('hex') : null]));
assert.deepEqual(fingerprint(), before);
const database = new DatabaseSync('reports/seo-spy.sqlite', { readOnly: true });
let saved, analyses;
try {
  const rows = database.prepare('SELECT kind,data_json,checksum FROM assessment_records WHERE business_id=?').all('demo-guzman');
  for (const row of rows) assert.equal(hash(JSON.parse(row.data_json)), row.checksum);
  saved = rows.filter(row => row.kind === 'assessment').map(row => JSON.parse(row.data_json)).find(record => record.id === 'a0c19a0e-2be3-447e-a795-e7fdee84c0bf');
  analyses = rows.filter(row => row.kind === 'analysis').map(row => JSON.parse(row.data_json));
} finally { database.close(); }
assert.ok(saved); assert.equal(hash(calculateScoreSnapshot(saved.input)), hash(saved.snapshot));
const sources = [read('reports/audits/2026-11-01T19-52-03-282Z_43a66038-2184-4f72-b242-8381102b651d.json'), read('reports/audits/2026-11-01T19-51-25-647Z_3aeafc4c-34f5-4caa-82ed-0a8dd6b9857b.json')];
const input = { assessmentId: saved.id, businessId: saved.businessId, policyVersion: saved.snapshot.policyVersion, cutoff: saved.snapshot.cutoff, sources, snapshot: saved.snapshot,
  scores: Object.entries(saved.snapshot.scores).map(([category, score]) => ({ category, value: score.value, reasonCodes: score.reasons })) };
let historicalAnalysesReplayed = 0;
for (const stored of analyses) {
  const { createdAt: _createdAt, ...record } = stored; void _createdAt;
  const parsed = assessmentMuseAnalysisSchema.parse(record);
  if (parsed.assessmentId !== input.assessmentId) continue;
  const version = parsed.promptVersion.endsWith('-v4') ? 'v4' : parsed.promptVersion.endsWith('-v3') ? 'v3' : parsed.promptVersion.endsWith('-v2') ? 'v2' : undefined;
  const bundle = prepareAssessmentMuseEvidence({ ...input, version, ...(version ? {} : { snapshot: undefined }) });
  assert.equal(hash(bundle), parsed.inputHash); validateAssessmentMuseAnalysisOutput(parsed, bundle); historicalAnalysesReplayed++;
}
const v4 = prepareAssessmentMuseEvidence({ ...input, version: 'v4' }), v5 = prepareAssessmentMuseEvidence({ ...input, version: 'v5' });
assert.equal(v4.schemaVersion, 'seo-spy.assessment-muse-evidence.v4'); assert.equal(v5.schemaVersion, 'seo-spy.assessment-muse-evidence.v5');
const settings = new ConfigService({ MOCK_AI: true, AI_MODE: 'mock', AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0, AI_MODEL: 'muse-spark-1.3', AI_PROCESSING_MODE: 'standard', AI_REASONING_EFFORT: 'minimal', AI_MAX_OUTPUT_TOKENS: 1500 });
const provider = new MetaMuseProvider(settings, { post: deny }, { estimate: deny, reserve: deny, settle: deny });
const adapter = new AssessmentMuseAdapter(settings, provider), p4 = adapter.prepare(v4), p5 = adapter.prepare(v5);
const wire4 = provider.prepare(p4.modelInput), wire5 = provider.prepare(p5.modelInput);
assert.equal(wire4.requestHash, 'e60d1da34129c5e1b646d89595d35d57c01b4c3b600591e98dab118282868eff');
assert.notEqual(p4.cacheKey, p5.cacheKey); assert.deepEqual(opportunityProjection(v4).opportunities, transparencyProjection(v5).opportunities);
const mocked = await adapter.analyze(v5); assert.equal(mocked.isMock, true); assert.equal(mocked.usage.inputTokens, 0);
// This is a hypothetical v5 fixture. Never retroactively attach it to live v4.
const fixture = validateTransparencySelection({ schemaVersion: 'assessment-muse-selection-output-v5', selected: [
  { id: 'o_9eeb0b598d92d844', reason: 'ADDRESS_CONFIRMED_SHORTFALL' },
  { id: 'o_1dc22beb90342d37', reason: 'ADDRESS_CONFIRMED_SHORTFALL' },
], omitted: [{ id: 'o_0cdbbc667338f875', reason: 'FOCUS_CONFIRMED_SHORTFALLS' }] }, v5);
const exampleOutput = expandTransparencySelection(fixture, v5, true);
assert.deepEqual(fingerprint(), before);
const report = { version: 'muse-selection-transparency-offline-v5', providerCalls: 0, authorizationChanges: 0, budgetChanges: 0, newApplicationAnalyses: 0, protectedFilesUnchanged: true,
  historicalAnalysesReplayed, historicalV4RequestUnchanged: true, scoringSnapshotUnchanged: true,
  versions: { evidence: v5.schemaVersion, selection: v5.selectionVersion, prompt: mocked.promptVersion, selectorResponse: fixture.schemaVersion, projection: p5.modelInput.input.schemaVersion, materializedOutput: mocked.outputSchemaVersion, fixture: mocked.fixtureVersion },
  sizes: { v4ProjectionBytes: bytes(opportunityProjection(v4)), v5ProjectionBytes: bytes(transparencyProjection(v5)), v4WireBytes: Buffer.byteLength(wire4.payload), v5WireBytes: Buffer.byteLength(wire5.payload),
    canonicalV4SelectionBytes: bytes({ schemaVersion: 'assessment-muse-selection-output-v4', opportunityIds: fixture.selected.map(row => row.id) }), canonicalAnnotatedFixtureBytes: bytes(fixture), unchangedMaximumOutputTokens: 1500,
    caveat: 'Canonical JSON/UTF-8 bytes, not actual provider token counts. Token and reasoning overhead is unmeasured.' },
  candidates: v5.opportunities.length, reviewIfOmittedIds: v5.reviewIfOmittedIds,
  baselineMock: { provenance: 'Local deterministic fixture, not Muse inference.', decisionLabels: mocked.decisionLabels, output: mocked.output },
  example: { provenance: 'Hypothetical offline v5 two-selection/one-omission fixture. These were not the live v4 model reasons.', decisionLabels: fixture, output: exampleOutput },
  limitations: ['Premise-compatible labels do not prove sound judgment or reveal the actual cause of an earlier choice.', 'The small scrutiny set draws attention to alternatives and may influence selection; it never forces rank or selection.', 'Current testing CLI remains v3/v4-only; preparing a future v5 exact live request needs a separately reviewed operator extension and approval.', 'No sparse/permutation model behavior or live v5 schema acceptance is established by fixtures.'] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...report, baselineMock: undefined, example: { ...report.example, output: undefined } }, null, 2));
