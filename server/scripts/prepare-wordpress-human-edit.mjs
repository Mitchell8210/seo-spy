// Exact human-reviewed revision through existing proposal services. No inference, approval or Apply operation.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { AppDatabase } from '../dist/persistence/sqlite/app-database.js';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressActionsStore } from '../dist/modules/wordpress/wordpress-actions.store.js';
import { WordPressFixStore } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
const { values } = parseArgs({ strict: true, options: { 'confirmed-human-edit': { type: 'boolean' }, output: { type: 'string', default: 'wordpress-alt-human-reviewed-proposal.json' }, 'previous-proposal-id': { type: 'string' }, 'previous-proposal-hash': { type: 'string' } } });
assert.equal(values['confirmed-human-edit'], true); assert.match(values.output, /^[a-z0-9][a-z0-9-]*\.json$/);
assert.equal(!!values['previous-proposal-id'], !!values['previous-proposal-hash']);
const output = `reports/${values.output}`; assert.equal(existsSync(output), false);
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false'); assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true');
const hash = value => createHash('sha256').update(value).digest('hex'), config = new ConfigService({ ...process.env });
const ledger = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite', protectedPaths = ['.env', ledger, `${ledger}.initialized`, `${ledger}-wal`, `${ledger}-shm`];
const fingerprints = () => Object.fromEntries(protectedPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const protectedBefore = fingerprints(), db = new DatabaseSync(config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite'); db.exec('PRAGMA busy_timeout=5000');
try {
  const key = config.get('WORDPRESS_OPERATOR_KEY'), actor = operatorIdentity(key), businessId = 'demo-guzman';
  new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
  const forbidden = new Proxy({}, { get: () => () => { throw new Error('Inference, spending, approval and Apply are forbidden.'); } });
  // Use existing artifact validation/transactions on this already initialized connection; no schema migration or seeding.
  const application = new AppDatabase(config); application.connection = () => db;
  const actions = new WordPressActionsStore(config, application), store = new WordPressFixStore(application);
  const reports = { read: async id => application.readArtifact('audit-report', id)?.payload ?? null };
  const businesses = { findById: async id => JSON.parse(db.prepare('SELECT data_json FROM businesses WHERE id=?').get(id).data_json) };
  const transport = new WordPressTransport(), send = transport.send.bind(transport), authenticatedReads = [];
  transport.send = (...args) => { assert.ok(['GET', 'OPTIONS'].includes(args[2])); assert.ok(['/wp-json/wp/v2/media/5659', '/wp-json/wp/v2/pages/5652', '/wp-json/wp/v2/users/me'].includes(args[0].pathname)); authenticatedReads.push({ method: args[2], path: args[0].pathname }); return send(...args); };
  const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), transport), actions, businesses);
  const collector = new WebsiteCollector(new WebsiteDns(), new WebsiteTransport());
  const purposes = new WordPressPurposeService(wordpress, reports, store, collector, new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
  const fixes = new WordPressFixService(wordpress, reports, store, forbidden, config, forbidden, collector, forbidden, purposes);
  const generationId = '9bb52ffd-67a8-467c-8946-6966ab99344b', generation = await fixes.generation(businessId, actor, generationId);
  assert.equal(generation.isMock, false); assert.equal(generation.requestHash, '5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c');
  const owner = store.read(businessId, actor, generation.evidenceId);
  assert.equal(owner.target.mediaId, 5659); assert.equal(owner.target.pageId, 5652); assert.equal(owner.target.currentAlt, '');
  assert.equal(purposes.binding(owner).dependencyHash, '8f523fdaee40a15092c87436502f8edbafbcb196f5517eb4fa4eab6d3288c3d0');
  const previousFixes = db.prepare('SELECT id,payload,checksum FROM wordpress_fix_records').all();
  const previousArtifacts = db.prepare('SELECT kind,id,payload_json,checksum FROM artifacts').all();
  const text = 'Guzman Tax Accounting ofrece ayuda para entender y responder cartas del IRS.';
  if (values['previous-proposal-id']) {
    const previous = await fixes.read(businessId, actor, values['previous-proposal-id']);
    assert.equal(previous.hash, values['previous-proposal-hash']); assert.equal(previous.textOrigin, 'human-edited');
    assert.equal(previous.executionStarted, false); assert.equal(previous.outcome, null); assert.deepEqual(previous.before, { altText: '' });
    assert.deepEqual(previous.changes, { altText: text }); assert.equal(previous.resourceId, 5659);
  }
  const proposal = await fixes.propose(businessId, actor, generationId, text);
  assert.equal(proposal.textOrigin, 'human-edited'); assert.equal(proposal.before.altText, ''); assert.deepEqual(proposal.changes, { altText: text });
  assert.equal(proposal.resourceId, 5659); assert.equal(proposal.resource, 'media'); assert.equal(proposal.field, 'alt_text');
  const saved = await fixes.read(businessId, actor, proposal.id); assert.equal(saved.hash, proposal.hash); assert.equal(saved.executionStarted, false); assert.equal(saved.outcome, null);
  assert.deepEqual(await fixes.generation(businessId, actor, generationId), generation);
  for (const row of previousFixes) { const current = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE id=?').get(row.id); assert.equal(current.payload, row.payload); assert.equal(current.checksum, row.checksum); }
  for (const row of previousArtifacts) { const current = db.prepare('SELECT payload_json,checksum FROM artifacts WHERE kind=? AND id=?').get(row.kind, row.id); assert.equal(current.payload_json, row.payload_json); assert.equal(current.checksum, row.checksum); }
  assert.deepEqual(fingerprints(), protectedBefore);
  writeFileSync(output, JSON.stringify({ proposal, saved, target: owner.target, purposeBindingId: purposes.binding(owner).id,
    originalGeneration: generation, humanReviewedText: text, historicalRecordsUnchanged: true, ledgerAndConfigurationUnchanged: true,
    independentlyReadable: true, supersedesProposalId: values['previous-proposal-id'] ?? null, authenticatedReads, modelCalls: 0, wordPressWrites: 0, writesEnabled: false, approvalCreated: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ artifact: output, proposalId: proposal.id, hash: proposal.hash, expiresAt: proposal.expiresAt, modified: proposal.modified, before: proposal.before, changes: proposal.changes, textOrigin: proposal.textOrigin, modelCalls: 0, wordPressWrites: 0 }));
} finally { db.close(); }
