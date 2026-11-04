// One explicitly authorized proposal. Existing fixes.apply owns validation, locks, dispatch and receipts.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { AppDatabase } from '../dist/persistence/sqlite/app-database.js';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressActionsStore } from '../dist/modules/wordpress/wordpress-actions.store.js';
import { WordPressFixStore } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressVerificationService } from '../dist/modules/wordpress/wordpress-verification.service.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
assert.deepEqual(process.argv.slice(2), ['--confirmed-one-exact-write']);
const id = 'ef4a65f4-5dc5-4c06-8430-9b994642af6f', approvedHash = '7b9eb7015de632f370ead01cf55dd69ebd6a97d09a3eff6aff9c98fc1feb702e';
const businessId = 'demo-guzman', text = 'Guzman Tax Accounting ofrece ayuda para entender y responder cartas del IRS.';
const output = 'reports/wordpress-alt-first-application-result.json'; assert.equal(existsSync(output), false);
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false'); assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true');
const hash = value => createHash('sha256').update(value).digest('hex'), config = new ConfigService({ ...process.env, WORDPRESS_WRITES_ENABLED: false });
const ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite', protectedPaths = ['.env', ledgerPath, `${ledgerPath}.initialized`, `${ledgerPath}-wal`, `${ledgerPath}-shm`];
const fingerprints = () => Object.fromEntries(protectedPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const protectedBefore = fingerprints(), db = new DatabaseSync(config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite'); db.exec('PRAGMA busy_timeout=5000');
const application = new AppDatabase(config); application.connection = () => db;
const actions = new WordPressActionsStore(config, application), store = new WordPressFixStore(application);
const key = config.get('WORDPRESS_OPERATOR_KEY'), actor = operatorIdentity(key);
new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
const forbidden = new Proxy({}, { get: () => () => { throw new Error('AI, spending and unrelated operations are forbidden.'); } });
const reports = { read: async reportId => application.readArtifact('audit-report', reportId)?.payload ?? null };
const businesses = { findById: async business => JSON.parse(db.prepare('SELECT data_json FROM businesses WHERE id=?').get(business).data_json) };
const transport = new WordPressTransport(), send = transport.send.bind(transport);
let writes = 0, result = {};
transport.send = (...args) => {
  assert.ok(['/wp-json/wp/v2/media/5659', '/wp-json/wp/v2/pages/5652', '/wp-json/wp/v2/users/me'].includes(args[0].pathname));
  if (args[2] === 'POST') {
    assert.equal(config.get('WORDPRESS_WRITES_ENABLED'), true); assert.equal(args[0].pathname, '/wp-json/wp/v2/media/5659');
    assert.deepEqual(JSON.parse(args[4]), { alt_text: text }); assert.equal(writes, 0); writes++;
  } else assert.ok(['GET', 'OPTIONS'].includes(args[2]));
  return send(...args);
};
const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), transport), actions, businesses);
const collector = new WebsiteCollector(new WebsiteDns(), new WebsiteTransport());
const purposes = new WordPressPurposeService(wordpress, reports, store, collector, new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
const verification = new WordPressVerificationService(wordpress, actions, collector);
const fixes = new WordPressFixService(wordpress, reports, store, forbidden, config, verification, collector, forbidden, purposes);
const priorFixes = db.prepare('SELECT id,payload,checksum FROM wordpress_fix_records').all();
const priorArtifacts = db.prepare('SELECT kind,id,payload_json,checksum FROM artifacts').all();
try {
  const proposal = await fixes.read(businessId, actor, id);
  assert.equal(proposal.hash, approvedHash); assert.equal(proposal.siteUrl, 'https://guzmantaxaccounting.com');
  assert.equal(proposal.resource, 'media'); assert.equal(proposal.resourceId, 5659); assert.equal(proposal.modified, '2026-09-25T02:41:39');
  assert.deepEqual(proposal.before, { altText: '' }); assert.deepEqual(proposal.changes, { altText: text });
  assert.equal(proposal.textOrigin, 'human-edited'); assert.equal(proposal.executionStarted, false); assert.equal(proposal.outcome, null);
  assert.ok(Date.parse(proposal.expiresAt) > Date.now(), 'Approved proposal expired; do not replace it.');
  const revision = store.read(businessId, actor, id); assert.equal(revision.target.pageId, 5652);
  const owner = store.read(businessId, actor, revision.evidenceId);
  assert.equal(purposes.binding(owner).dependencyHash, '8f523fdaee40a15092c87436502f8edbafbcb196f5517eb4fa4eab6d3288c3d0');
  // Process-local gate plus exact transport allowlist; normal server/.env never changes.
  config.set('WORDPRESS_WRITES_ENABLED', true);
  try { result.execution = await fixes.apply(businessId, actor, id, approvedHash); }
  finally { config.set('WORDPRESS_WRITES_ENABLED', false); }
  if (result.execution.status === 'applied') {
    const fresh = await wordpress.altTarget(businessId, 5659, 'pages', 5652);
    result.stored = { actualAlt: fresh.target.currentAlt, matches: fresh.target.currentAlt === text, modified: fresh.target.modified };
    result.publicVerification = await fixes.verify(businessId, actor, id);
  }
} catch (error) {
  result.error = { code: typeof error.code === 'string' ? error.code : typeof error.getResponse === 'function' ? error.getResponse()?.code ?? 'OPERATOR_CHECK_FAILED' : 'OPERATOR_CHECK_FAILED' };
  process.exitCode = 1;
} finally {
  config.set('WORDPRESS_WRITES_ENABLED', false);
  try {
    result.savedExecution = await actions.read(id, 'outcome'); result.executionReservation = await actions.read(id, 'started');
    for (const row of priorFixes) { const current = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE id=?').get(row.id); assert.equal(current.payload, row.payload); assert.equal(current.checksum, row.checksum); }
    for (const row of priorArtifacts) { const current = db.prepare('SELECT payload_json,checksum FROM artifacts WHERE kind=? AND id=?').get(row.kind, row.id); assert.equal(current.payload_json, row.payload_json); assert.equal(current.checksum, row.checksum); }
    assert.deepEqual(fingerprints(), protectedBefore);
    writeFileSync(output, JSON.stringify({ ...result, proposalId: id, proposalHash: approvedHash, wordPressWriteRequests: writes,
      modelCalls: 0, historicalRecordsUnchanged: true, ledgerAndConfigurationUnchanged: true, writesEnabledAfter: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ artifact: output, writeRequests: writes, execution: result.execution, stored: result.stored,
      publicVerification: result.publicVerification, error: result.error, writesEnabledAfter: false }));
  } finally { db.close(); }
}
