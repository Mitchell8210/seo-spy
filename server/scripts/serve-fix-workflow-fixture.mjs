// Explicit offline browser fixture. Never boots AppModule or reads .env/live databases.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WordPressModule } from '../dist/modules/wordpress/wordpress.module.js';
import { WordPressClient } from '../dist/integrations/wordpress/wordpress.client.js';
import { MetaMuseTransport } from '../dist/integrations/ai/meta-muse.provider.js';
import { WebsiteCollector } from '../dist/integrations/website/collector.js';
import { FileReportStore } from '../dist/reports/file-report.store.js';
import { BUSINESS_REPOSITORY } from '../dist/persistence/repositories.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressFixSessions } from '../dist/modules/wordpress/wordpress-fix-session.js';
import { operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { configureApp } from '../dist/configure-app.js';
if (!process.argv.includes('--offline-confirmed')) throw new Error('Use --offline-confirmed for the isolated transport fixture only.');
const directory = await mkdtemp(join(tmpdir(), 'seo-spy-fix-browser-'));
const businessId = 'demo-guzman', operator = 'offline-only-operator-never-a-live-credential';
const reportId = randomUUID(), evidenceId = randomUUID();
let alt = '', writes = 0, modelRequests = 0;
const description = 'A blue calculator beside a notebook.';
const image = 'https://example.com/photo.jpg', page = 'https://example.com/page/';
const config = new ConfigService({ NODE_ENV: 'test', DATABASE_PATH: join(directory, 'application.sqlite'), AI_USAGE_DB: join(directory, 'usage.sqlite'), WORDPRESS_BUSINESS_ID: businessId,
  WORDPRESS_SITE_URL: 'https://example.com', WORDPRESS_USERNAME: 'offline-user', WORDPRESS_APPLICATION_PASSWORD: 'offline-password', WORDPRESS_OPERATOR_KEY: operator,
  WORDPRESS_WRITES_ENABLED: true, WORDPRESS_FRONTEND_ORIGIN: 'http://localhost:5187', WORDPRESS_ACTIONS_DIR: join(directory, 'actions'), WORDPRESS_REPORTS_DIR: join(directory, 'reports'),
  WORDPRESS_MUSE_DIR: join(directory, 'muse'), MOCK_AI: true, AI_MODE: 'mock', AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0, PORT: 3187, LOG_LEVEL: 'silent' });
const report = { schemaVersion: 'seo-spy.audit-report.v1', reportId, auditId: reportId, generatedAt: new Date().toISOString(), business: { id: businessId, name: 'Offline fixture business', website: 'https://example.com', createdAt: new Date().toISOString() },
  audit: { id: reportId, businessId, scope: 'homepage', mode: 'live', status: 'completed' }, results: {
    findings: [{ id: 'fixture-alt-finding', auditId: reportId, checkId: 'image-alt', evidenceIds: [evidenceId], severity: 'low', source: 'website', status: 'needs_review', title: 'Review this informative image', explanation: 'A confirmed informative image has empty alternative text.' }],
    evidence: [{ id: evidenceId, auditId: reportId, checkId: 'image-alt', sourceUrl: page, collectedAt: new Date().toISOString(), mode: 'live', observed: { values: JSON.stringify([{ src: image, alt: '' }]) } }], recommendations: [],
  } };
const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WordPressModule] })
  .overrideProvider(ConfigService).useValue(config)
  .overrideProvider(FileReportStore).useValue({ read: async id => id === reportId ? report : null })
  .overrideProvider(BUSINESS_REPOSITORY).useValue({ findById: async id => id === businessId ? report.business : null, connections: async () => [] })
  .overrideProvider(MetaMuseTransport).useValue({ post: async () => { modelRequests++; throw new Error('All model transport is forbidden in the browser fixture.'); } })
  .overrideProvider(WordPressClient).useValue({ request: async (_connection, method, path, body) => {
    if (path.startsWith('/wp-json/wp/v2/users/me')) return { id: 1, capabilities: { upload_files: true, edit_posts: true } };
    if (method === 'OPTIONS') return { endpoints: [{ methods: ['POST'], args: { alt_text: { type: 'string' } } }] };
    if (path.startsWith('/wp-json/wp/v2/pages/9')) return { id: 9, type: 'page', status: 'publish', link: page, content: { protected: false, rendered: `<img class="wp-image-7" src="${image}" alt="${alt}">` } };
    if (path.startsWith('/wp-json/wp/v2/media/7')) {
      if (method === 'POST') { if (Object.keys(body).join(',') !== 'alt_text') throw new Error('Only alt_text supported.'); alt = body.alt_text; writes++; }
      return { id: 7, type: 'attachment', media_type: 'image', status: 'inherit', post: 9, source_url: image, alt_text: alt, modified_gmt: `2026-11-02T00:${String(writes).padStart(2, '0')}:00` };
    }
    throw new Error('Unknown mock WordPress target. No real request was made.');
  } })
  .overrideProvider(WebsiteCollector).useValue({ collect: async () => ({ requestedUrl: page, finalUrl: page, collectedAt: new Date().toISOString(), contentType: 'text/html; charset=utf-8', body: Buffer.from(`<img class="wp-image-7" src="${image}" alt="${alt}">`) }) }).compile();
const app = configureApp(module.createNestApplication()); app.useLogger(false);
const fixes = app.get(WordPressFixService), actor = operatorIdentity(operator);
await fixes.enroll(businessId, actor, { confirmed: true, reportId, findingId: 'fixture-alt-finding', evidenceId, mediaId: 7, pageResource: 'pages', pageId: 9, purpose: 'informative', verifiedDescription: description });
app.getHttpAdapter().getInstance().get('/api/fix-fixture', async (_req, res) => {
  const ticket = await app.get(WordPressFixSessions).issue({ get: name => name === 'authorization' ? `Bearer ${operator}` : undefined }, businessId);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ bootstrap: ticket.url, review: { id: 'fixture-alt-finding', title: 'Review this informative image', category: 'website', source: 'Offline saved report fixture', explanation: 'The exact image was confirmed informative. Empty alt text needs contextual review.', recommendation: 'Prepare a concise description using the confirmed context.', evidence: [description], businessId, reportId, findingId: 'fixture-alt-finding' } });
});
app.getHttpAdapter().getInstance().get('/api/fix-fixture/receipts', (_req, res) => res.json({ offline: true, mockWordPressWrites: writes, modelRequests, currentAlt: alt, protectedDatabasesOpened: false }));
await app.init(); await app.listen(3187, '127.0.0.1');
console.log('Offline fixture API ready on 127.0.0.1:3187. Only disposable data and mocked transports; no live credentials or calls.');
process.once('SIGINT', async () => { await app.close(); process.exit(0); });
