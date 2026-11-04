// Explicit technical adoption/state refresh; no owner review creation, AI or spending APIs.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressFixStore, fixDigest } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { altEvidenceSchema } from '../dist/modules/wordpress/wordpress-fix.types.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
const { values, positionals } = parseArgs({ strict: true, allowPositionals: true, options: {
  'business-id': { type: 'string' }, 'evidence-id': { type: 'string' }, confirmed: { type: 'boolean' }, output: { type: 'string' },
  'original-image-sha256': { type: 'string' }, provenance: { type: 'string' }, 'dependencies-unchanged': { type: 'boolean' } } });
assert.equal(positionals.length, 1); const command = positionals[0]; assert.ok(['adopt', 'refresh', 'status'].includes(command)); assert.equal(values.confirmed, true);
assert.match(values.output ?? '', /^[a-z0-9][a-z0-9-]*\.json$/); const output = `reports/${values.output}`; assert.equal(existsSync(output), false);
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_ENABLED, 'false'); assert.equal(process.env.AI_MODE, 'mock'); assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true');
const config = new ConfigService({ ...process.env }), key = config.get('WORDPRESS_OPERATOR_KEY');
new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
const actor = operatorIdentity(key), databasePath = config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite', ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite';
assert.notEqual(resolve(databasePath).toLowerCase(), resolve(ledgerPath).toLowerCase());
if (existsSync(ledgerPath)) { const app = statSync(databasePath), ledger = statSync(ledgerPath); assert.ok(!app.ino || app.ino !== ledger.ino || app.dev !== ledger.dev); }
const hash = value => createHash('sha256').update(value).digest('hex');
const protectedPaths = ['.env', ledgerPath, `${ledgerPath}.initialized`, `${ledgerPath}-wal`, `${ledgerPath}-shm`];
const fingerprints = () => Object.fromEntries(protectedPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const protectedBefore = fingerprints(), db = new DatabaseSync(databasePath, { readOnly: command === 'status' });
try {
  db.exec('PRAGMA busy_timeout=5000');
  const prior = db.prepare('SELECT id,payload,checksum FROM wordpress_fix_records').all();
  const store = new WordPressFixStore({ connection: () => db });
  const owner = altEvidenceSchema.parse(store.read(values['business-id'], actor, values['evidence-id']));
  const reports = { read: async id => { const row = db.prepare("SELECT payload_json,checksum FROM artifacts WHERE kind='audit-report' AND id=?").get(id); if (!row) return null; assert.equal(hash(row.payload_json), row.checksum); return JSON.parse(row.payload_json); } };
  const business = { findById: async id => { const row = db.prepare('SELECT data_json FROM businesses WHERE id=?').get(id); return row ? JSON.parse(row.data_json) : null; } };
  const forbidden = new Proxy({}, { get: () => () => { throw new Error('Actions, inference and spending operations are forbidden.'); } });
  const transport = new WordPressTransport(), native = transport.send.bind(transport), requests = [];
  const allowed = new Set([`/wp-json/wp/v2/media/${owner.target.mediaId}`, `/wp-json/wp/v2/${owner.target.pageResource}/${owner.target.pageId}`, '/wp-json/wp/v2/users/me']);
  transport.send = (...args) => { assert.notEqual(command, 'status'); assert.ok(['GET', 'OPTIONS'].includes(args[2])); assert.ok(allowed.has(args[0].pathname)); requests.push({ method: args[2], path: args[0].pathname }); return native(...args); };
  const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), transport), forbidden, business);
  const purposes = new WordPressPurposeService(wordpress, reports, store, new WebsiteCollector(new WebsiteDns(), new WebsiteTransport()), new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
  let result;
  if (command === 'adopt') result = await purposes.adopt(owner.businessId, actor, { evidenceId: owner.id, originalReviewHash: fixDigest(owner),
    originalImageHash: values['original-image-sha256'], hashProvenance: values.provenance, dependenciesUnchanged: values['dependencies-unchanged'] });
  else if (command === 'refresh') { const refreshed = await purposes.refresh(owner.businessId, actor, owner.id); result = { state: refreshed.state, ownerConfirmationRenewed: false }; }
  else { const effective = await purposes.resolve(owner, false); result = { purposeReusable: true, originalConfirmedAt: owner.createdAt, executionExpiresAt: effective.expiresAt, executionCurrent: Date.parse(effective.expiresAt) > Date.now(), dependencyHash: effective.purposeDependencyHash }; }
  for (const row of prior) { const current = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE id=?').get(row.id); assert.equal(current.payload, row.payload); assert.equal(current.checksum, row.checksum); }
  assert.deepEqual(fingerprints(), protectedBefore);
  writeFileSync(output, JSON.stringify({ ...result, evidenceId: owner.id, originalConfirmedAt: owner.createdAt, ownerConfirmationCreated: false, ownerConfirmationRenewed: false,
    priorConfirmationRecordsUnchanged: true, protectedLedgerAndConfigurationUnchanged: true, authenticatedRequests: requests, modelRequests: 0, wordPressWrites: 0 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ artifact: output, evidenceId: owner.id, originalConfirmedAt: owner.createdAt, ownerConfirmationCreated: false, purposeBindingId: result.binding?.id,
    stateExpiresAt: result.state?.expiresAt, protectedLedgerUnchanged: true, modelRequests: 0, wordPressWrites: 0 }));
} finally { db.close(); }
