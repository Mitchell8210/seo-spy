// Independent saved read plus authenticated GET/OPTIONS check. No model/spending mutation or WordPress write capability.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressFixStore } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteDns } from '../dist/integrations/website/collector.js';
const output = 'reports/wordpress-alt-first-live-result.json'; assert.equal(existsSync(output), false);
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false'); assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true');
const hash = value => createHash('sha256').update(value).digest('hex'), config = new ConfigService({ ...process.env });
const dbPath = config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite', ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite';
const paths = ['.env', dbPath, `${dbPath}-wal`, `${dbPath}-shm`, ledgerPath, `${ledgerPath}-wal`, `${ledgerPath}-shm`, `${ledgerPath}.initialized`];
const fingerprints = () => Object.fromEntries(paths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const before = fingerprints(), app = new DatabaseSync(dbPath, { readOnly: true }), ledger = new DatabaseSync(ledgerPath, { readOnly: true });
try {
  const key = config.get('WORDPRESS_OPERATOR_KEY'), actor = operatorIdentity(key), businessId = 'demo-guzman', intentId = '96dfb73d-5c4f-413a-bc3e-78c5cfed0380';
  new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
  const forbidden = new Proxy({}, { get: () => () => { throw new Error('Model, spending and write operations forbidden.'); } });
  const reports = { read: async id => { const row = app.prepare("SELECT payload_json,checksum FROM artifacts WHERE kind='audit-report' AND id=?").get(id); assert.ok(row); assert.equal(hash(row.payload_json), row.checksum); return JSON.parse(row.payload_json); } };
  const businesses = { findById: async id => JSON.parse(app.prepare('SELECT data_json FROM businesses WHERE id=?').get(id).data_json) };
  const wp = new WordPressTransport(), send = wp.send.bind(wp);
  wp.send = (...args) => { assert.ok(['GET', 'OPTIONS'].includes(args[2])); assert.ok(['/wp-json/wp/v2/media/5659', '/wp-json/wp/v2/pages/5652', '/wp-json/wp/v2/users/me'].includes(args[0].pathname)); return send(...args); };
  const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), wp), forbidden, businesses);
  const store = new WordPressFixStore({ connection: () => app }), purposes = new WordPressPurposeService(wordpress, reports, store, forbidden, forbidden);
  const fixes = new WordPressFixService(wordpress, reports, store, forbidden, config, forbidden, forbidden, forbidden, purposes);
  const row = ledger.prepare('SELECT payload,checksum FROM muse_wordpress_alt_receipts WHERE intent_id=?').get(intentId); assert.ok(row); assert.equal(hash(row.payload), row.checksum);
  const receipt = JSON.parse(row.payload), attempt = ledger.prepare('SELECT * FROM attempts WHERE intent_id=?').get(intentId);
  const generation = await fixes.generation(businessId, actor, receipt.generationId);
  assert.equal(generation.isMock, false); assert.equal(receipt.schemaValid, true); assert.equal(receipt.persisted, true);
  assert.equal(generation.requestHash, '5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c');
  assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM attempts WHERE intent_id=?').get(intentId).n, 1);
  const capability = await fixes.capability(businessId, actor, 'e739442b-185f-4b89-ae12-a8273bb6bdbc', '5e02c565-e0ed-4ef2-9665-9a19bcfaaf64');
  assert.equal(capability.savedGeneration.id, generation.id); assert.equal(capability.fixable, true); assert.equal(capability.writesEnabled, false);
  const current = await wordpress.altTarget(businessId, 5659, 'pages', 5652); assert.equal(current.target.currentAlt, '');
  assert.deepEqual(fingerprints(), before);
  const result = { intentId, generation, receipt, attempt, independentlyReadable: true, modalSavedGenerationAvailable: true,
    currentWordPressAlt: current.target.currentAlt, mediaId: 5659, parentPageId: 5652, modelCallsDuringRead: 0, wordPressWrites: 0,
    protectedFilesByteUnchangedDuringRead: true, mockFirstDefaultsPreserved: true, reasoningTokens: null,
    reasoningUsageLimitation: 'The model call completed, but the post-run reporting assertion failed before transient reasoning-token metadata was saved. The immutable generation and receipt retain total input/output usage; the reasoning split is unavailable. No inference was repeated.',
    usageEstimateMicrosUnrounded: attempt.input_tokens * 1.25 + attempt.output_tokens * 4.25 };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ artifact: output, generationId: generation.id, receipt, output: generation.output, currentWordPressAlt: '', independentlyReadable: true, modalSavedGenerationAvailable: true }));
} finally { ledger.close(); app.close(); }
