// Explicit read-only operator collection. Never boots the application, AI provider or ledger.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
import { AppDatabase } from '../dist/persistence/sqlite/app-database.js';
import { SQLiteBusinessRepository } from '../dist/persistence/sqlite/sqlite.repositories.js';
import { FileReportStore } from '../dist/reports/file-report.store.js';
import { WordPressActionsStore } from '../dist/modules/wordpress/wordpress-actions.store.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressOperatorGuard } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressPageEvidenceService } from '../dist/modules/wordpress/wordpress-page-evidence.service.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
const { values } = parseArgs({ strict: true, options: { confirmed: { type: 'boolean' }, 'business-id': { type: 'string' },
  'media-id': { type: 'string' }, 'page-id': { type: 'string' }, 'page-resource': { type: 'string' }, output: { type: 'string' } } });
assert.equal(values.confirmed, true, 'Explicit --confirmed collection is required.');
assert.match(values.output ?? '', /^[a-z0-9][a-z0-9-]*\.json$/);
const outputPath = `reports/${values.output}`;
assert.equal(existsSync(outputPath), false, 'Choose a new immutable output filename.');
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false');
assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true', 'Writes must remain disabled.');
assert.equal(Number(process.env.AI_DEV_BUDGET_MICROS ?? 0), 0);
const config = new ConfigService({ ...process.env });
const key = config.get('WORDPRESS_OPERATOR_KEY');
assert.ok(typeof key === 'string' && key.length >= 32, 'Existing private operator credential required.');
// Reuse the normal private guard; no new authorization mechanism or exposed key.
new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
const hash = value => createHash('sha256').update(typeof value === 'string' || globalThis.Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite';
const paths = ['.env', ledgerPath, `${ledgerPath}.initialized`, `${ledgerPath}-wal`, `${ledgerPath}-shm`];
const fingerprints = () => Object.fromEntries(paths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const protectedBefore = fingerprints();
const database = new AppDatabase(config);
const snapshot = () => Object.fromEntries(database.connection().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
  assert.match(name, /^[a-zA-Z0-9_]+$/);
  return [name, database.connection().prepare(`SELECT * FROM "${name}"`).all().map(row => hash(row)).sort()];
}));
const historical = snapshot();
try {
  const transport = new WordPressTransport(), native = transport.send.bind(transport), requests = [];
  const allowedPaths = new Set([`/wp-json/wp/v2/media/${Number(values['media-id'])}`, `/wp-json/wp/v2/${values['page-resource']}/${Number(values['page-id'])}`, '/wp-json/wp/v2/users/me']);
  transport.send = (...args) => { assert.ok(['GET', 'OPTIONS'].includes(args[2]), 'No WordPress writes allowed.'); assert.ok(allowedPaths.has(args[0].pathname), 'Unexpected read target.'); requests.push({ method: args[2], path: args[0].pathname }); return native(...args); };
  const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), transport), new WordPressActionsStore(config, database), new SQLiteBusinessRepository(database));
  const service = new WordPressPageEvidenceService(wordpress, new WebsiteCollector(new WebsiteDns(), new WebsiteTransport()), new FileReportStore(config, database), new SQLiteBusinessRepository(database), new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
  const result = await service.collect(values['business-id'], { confirmed: true, mediaId: Number(values['media-id']), pageResource: values['page-resource'], pageId: Number(values['page-id']) });
  assert.deepEqual(fingerprints(), protectedBefore, 'Protected ledger/configuration changed.');
  const after = snapshot();
  for (const [table, rows] of Object.entries(historical)) {
    assert.ok(rows.every(row => after[table].includes(row)), `Historical row changed: ${table}`);
    assert.equal(after[table].length, rows.length + (table === 'artifacts' ? 1 : 0), `Unexpected application writes: ${table}`);
  }
  const artifact = { ...result, integrity: { allHistoricalRowsPreserved: true, onlyOneNewReportArtifact: true, protectedLedgerAndConfigurationByteUnchanged: true },
    authenticatedRequests: requests, paidRequests: 0, liveWordPressWrites: 0, purposeReviewRecorded: false };
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ reportId: result.reportId, findingId: result.findingId, evidenceId: result.evidenceId, fixable: false, artifact: outputPath, protectedFilesUnchanged: true }));
} finally { database.close(); }
