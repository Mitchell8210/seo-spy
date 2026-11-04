// Exact operator for the separately approved intent. Existing guards/services own all authorization and accounting.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { AiAdminGuard } from '../dist/modules/ai/ai-admin.guard.js';
import { AiAdminController } from '../dist/modules/ai/ai-admin.controller.js';
import { WordPressFixOperatorController } from '../dist/modules/wordpress/wordpress-fix.controller.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressFixStore } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressAltReceiptService } from '../dist/modules/wordpress/wordpress-alt-receipt.service.js';
import { altEvidenceSchema } from '../dist/modules/wordpress/wordpress-fix.types.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
import { MetaMuseProvider, MetaMuseTransport } from '../dist/integrations/ai/meta-muse.provider.js';
import { AiUsageStore } from '../dist/integrations/ai/ai-usage.store.js';

const intentId = '96dfb73d-5c4f-413a-bc3e-78c5cfed0380', businessId = 'demo-guzman', evidenceId = '5b14c90d-5ba1-4775-b1a8-32af42d63e8e';
const requestHash = '5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c', reserveMicros = 34090;
assert.deepEqual(process.argv.slice(2), ['--confirmed-exact-live-request']);
const output = 'reports/wordpress-alt-first-live-result.json'; assert.equal(existsSync(output), false);
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false');
assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true'); assert.equal(Number(process.env.AI_DEV_BUDGET_MICROS ?? 0), 0);
const hash = value => createHash('sha256').update(value).digest('hex'), envHash = hash(readFileSync('.env'));
// Isolated process configuration; .env and the normal server remain mock-first. Payload settings are checked below.
const config = new ConfigService({ ...process.env, MOCK_AI: false, AI_MODE: 'poc', AI_ENABLED: true, AI_CONTROLLED_TESTING: true, WORDPRESS_WRITES_ENABLED: false });
const key = config.get('WORDPRESS_OPERATOR_KEY'), actor = operatorIdentity(key ?? '');
const req = secret => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${secret}` })[name] });
const context = request => ({ switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader() {} }) }) });
const operatorRequest = req(key), adminRequest = req(config.get('AI_ADMIN_KEY'));
new WordPressOperatorGuard(config).canActivate(context(operatorRequest)); new AiAdminGuard(config).canActivate(context(adminRequest));
const databasePath = config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite', ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite';
assert.notEqual(resolve(databasePath).toLowerCase(), resolve(ledgerPath).toLowerCase());
assert.ok(statSync(databasePath).ino !== statSync(ledgerPath).ino || statSync(databasePath).dev !== statSync(ledgerPath).dev);
const db = new DatabaseSync(databasePath); db.exec('PRAGMA busy_timeout=5000');
const store = new WordPressFixStore({ connection: () => db }), ledger = new AiUsageStore(config);
const forbidden = new Proxy({}, { get: () => () => { throw new Error('WordPress actions and unrelated operations are forbidden.'); } });
const reports = { read: async id => { const row = db.prepare("SELECT payload_json,checksum FROM artifacts WHERE kind='audit-report' AND id=?").get(id); if (!row) return null; assert.equal(hash(row.payload_json), row.checksum); return JSON.parse(row.payload_json); } };
const businesses = { findById: async id => { const row = db.prepare('SELECT data_json FROM businesses WHERE id=?').get(id); return row ? JSON.parse(row.data_json) : null; } };
const wpTransport = new WordPressTransport(), send = wpTransport.send.bind(wpTransport), wordpressReads = [];
const paths = new Set(['/wp-json/wp/v2/media/5659', '/wp-json/wp/v2/pages/5652', '/wp-json/wp/v2/users/me']);
wpTransport.send = (...args) => { assert.ok(['GET', 'OPTIONS'].includes(args[2])); assert.ok(paths.has(args[0].pathname)); wordpressReads.push({ method: args[2], path: args[0].pathname }); return send(...args); };
const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), wpTransport), forbidden, businesses);
const collector = new WebsiteCollector(new WebsiteDns(), new WebsiteTransport());
const purposes = new WordPressPurposeService(wordpress, reports, store, collector, new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
const transport = new MetaMuseTransport(), post = transport.post.bind(transport);
let calls = 0, metadata = {};
transport.post = async (...args) => {
  assert.equal(calls, 0); assert.equal(hash(args[0]), requestHash); calls++;
  const response = await post(...args);
  metadata = { httpStatus: response.status, requestId: response.requestId };
  if (response.status === 200) {
    try { const value = JSON.parse(response.body), usage = value.usage;
      metadata.completionStatus = ['completed', 'incomplete', 'failed', 'in_progress', 'queued', 'cancelled'].includes(value.status) ? value.status : null;
      for (const [field, value] of Object.entries({ inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens }))
        metadata[field] = Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch { /* Provider performs strict validation. No raw response is retained. */ }
  }
  return response;
};
const provider = new MetaMuseProvider(config, transport, ledger), receipts = new WordPressAltReceiptService(ledger, store);
const fixes = new WordPressFixService(wordpress, reports, store, provider, config, forbidden, collector, receipts, purposes);
const operator = new WordPressFixOperatorController(fixes, forbidden, purposes), admin = new AiAdminController(ledger, config);
let result = {}, beforeStatus, originalRows;
try {
  const intent = await ledger.readIntent(intentId);
  assert.equal(intent.requestHash, requestHash); assert.equal(intent.reserveMicros, reserveMicros); assert.ok(Date.parse(intent.expiresAt) > Date.now());
  assert.equal(intent.approvedAt, null); assert.equal(intent.consumedAt, null); assert.equal(await ledger.wordPressAltAttempt(intentId), null);
  const owner = altEvidenceSchema.parse(store.read(businessId, actor, evidenceId));
  assert.equal(owner.target.mediaId, 5659); assert.equal(owner.target.pageId, 5652); assert.equal(owner.target.currentAlt, '');
  assert.equal(owner.source.reportId, 'e739442b-185f-4b89-ae12-a8273bb6bdbc');
  assert.equal(owner.source.findingId, '5e02c565-e0ed-4ef2-9665-9a19bcfaaf64'); assert.equal(owner.source.evidenceId, 'ffb8a1dd-f142-4381-8f62-21744698c05c');
  assert.equal(owner.source.reportHash, 'a75830037a35b6e472598d277034d163e2ac3317c0a6b9b232a8fc35bde1a0bf');
  assert.equal(purposes.binding(owner).dependencyHash, '8f523fdaee40a15092c87436502f8edbafbcb196f5517eb4fa4eab6d3288c3d0');
  originalRows = db.prepare('SELECT id,payload,checksum FROM wordpress_fix_records').all();
  await purposes.refresh(businessId, actor, evidenceId);
  const prepared = await fixes.prepareRequest(businessId, actor, { evidenceId, instructions: '' });
  assert.equal(prepared.requestHash, requestHash); assert.equal(prepared.reserveMicros, reserveMicros);
  const payload = JSON.parse(prepared.payload);
  assert.equal(payload.model, 'muse-spark-1.3'); assert.equal(payload.reasoning.effort, 'minimal'); assert.equal(payload.max_output_tokens, 1500);
  assert.deepEqual(payload.tools, []); assert.equal(payload.tool_choice, 'auto'); assert.equal(payload.store, false); assert.equal(payload.stream, false); assert.equal(payload.background, false);
  const frozen = JSON.parse(readFileSync('reports/wordpress-alt-revised-funding-activation.json', 'utf8'));
  assert.equal(prepared.payload, frozen.payload);
  beforeStatus = await ledger.status();
  assert.equal(beforeStatus.wordPressAlt.funding.request.requestHash, requestHash); assert.equal(beforeStatus.wordPressAlt.funding.request.reserveMicros, reserveMicros);
  assert.equal(beforeStatus.wordPressAlt.funding.fundingHash, frozen.grant.fundingHash); assert.equal(beforeStatus.wordPressAlt.calls, 0); assert.equal(beforeStatus.wordPressAlt.incompleteReceipts, 0);
  assert.equal(beforeStatus.testing.incompleteReceipts, 0); assert.equal(beforeStatus.halted, false); assert.equal(beforeStatus.activeAttemptId, null);
  assert.equal(beforeStatus.demo.calls, 0); assert.equal(beforeStatus.demo.authorization, null);
  await admin.approve(intentId, adminRequest, { confirmed: true, requestHash, reserveMicros });
  // Existing generation service rechecks remote dependencies before the atomic single-use reservation.
  const generation = await operator.generate(businessId, operatorRequest, { confirmed: true, evidenceId, intentId, instructions: '' });
  const reread = await fixes.generation(businessId, actor, generation.id); assert.deepEqual(reread, generation);
  const capability = await fixes.capability(businessId, actor, owner.source.reportId, owner.source.findingId);
  const remote = await wordpress.altTarget(businessId, 5659, 'pages', 5652); assert.equal(remote.target.currentAlt, '');
  result = { generation, independentlyReadable: true, modalCapability: capability, currentWordPressAlt: remote.target.currentAlt };
} catch (error) {
  result.failure = { code: typeof error.code === 'string' ? error.code : typeof error.getResponse === 'function' ? error.getResponse()?.code ?? 'OPERATOR_CHECK_FAILED' : 'OPERATOR_CHECK_FAILED' };
  process.exitCode = 1;
} finally {
  try {
    const status = await ledger.status(), attempt = await ledger.wordPressAltAttempt(intentId), receipt = (await ledger.wordPressAltReceipts()).find(row => row.requestHash === requestHash) ?? null;
    for (const row of originalRows ?? []) { const current = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE id=?').get(row.id); assert.equal(current.payload, row.payload); assert.equal(current.checksum, row.checksum); }
    if (beforeStatus) {
      assert.deepEqual(status.development, beforeStatus.development); assert.deepEqual(status.demo, beforeStatus.demo);
      // The shared daily reservation total intentionally includes the exact alt attempt.
      assert.deepEqual(status.testing, { ...beforeStatus.testing,
        dailyReservedMicros: beforeStatus.testing.dailyReservedMicros + (attempt ? reserveMicros : 0) });
    }
    assert.equal(hash(readFileSync('.env')), envHash);
    result = { ...result, intentId, requestHash, metadata, providerRequests: calls, attempt, receipt, status,
      historicalFixRowsUnchanged: true, configurationUnchanged: true, wordPressWrites: 0, mockFirstDefaultsPreserved: true };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ artifact: output, providerRequests: calls, generationId: result.generation?.id, failure: result.failure, metadata, receiptPersisted: !!receipt, wordPressWrites: 0 }));
  } finally { ledger.onModuleDestroy(); db.close(); }
}
