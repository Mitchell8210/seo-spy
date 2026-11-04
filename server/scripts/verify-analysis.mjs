// Explicit bounded live check for the authorized Analysis integration. Never run by tests/startup.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { get as httpGet } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

if (!process.argv.includes('--confirmed')) throw new Error('An explicitly authorized live Analytics read requires --confirmed.');
process.env.LOG_LEVEL = 'silent';
process.env.AI_ENABLED = 'false';
process.env.MOCK_AI = 'true';
process.env.AI_MODE = 'mock';
process.env.WORDPRESS_WRITES_ENABLED = 'false';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'reports/google');
const leadMode = process.argv.includes('--lead-submissions');
const maximumBatches = leadMode ? 2 : 1;
const receiptName = process.argv.includes('--empty-report-fix') ? 'analysis-lead-empty-verification' : leadMode ? 'analysis-lead-verification' : 'analysis-verification';
const { AppModule } = await import('../dist/app.module.js');
const { configureApp } = await import('../dist/configure-app.js');
const { GoogleTransport } = await import('../dist/integrations/google/google-transport.js');
const { MetaMuseTransport } = await import('../dist/integrations/ai/meta-muse.provider.js');
const calls = { oauth: 0, ga4: 0, meta: 0 };
MetaMuseTransport.prototype.post = async () => { calls.meta++; throw new Error('AI is prohibited in this verification.'); };
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let reserved = false, receipt = null, ledgerPath, before;
const ledger = () => Promise.all(['', '.initialized', '-wal', '-shm', '-journal'].map(async suffix => {
  try { return createHash('sha256').update(await readFile(ledgerPath + suffix)).digest('hex'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}));
try {
  const config = app.get(ConfigService);
  const businessId = config.get('GOOGLE_BUSINESS_ID') || config.get('WORDPRESS_BUSINESS_ID');
  if (!businessId || !config.get('GA4_PROPERTY_ID')) throw new Error('Google reporting is not configured.');
  ledgerPath = resolve(root, config.get('AI_USAGE_DB')); before = await ledger();
  const transport = app.get(GoogleTransport), post = transport.post.bind(transport);
  transport.post = async (url, body, options) => {
    const kind = url === 'https://oauth2.googleapis.com/token' ? 'oauth' : /^https:\/\/analyticsdata.googleapis.com\/v1beta\/properties\/\d+:batchRunReports$/.test(url) ? 'ga4' : null;
    if (!kind || calls[kind] >= (kind === 'ga4' ? maximumBatches : 1) || kind === 'ga4' && (!body || ![5, ...(leadMode ? [2] : [])].includes(body.requests?.length))) throw new Error('Additional upstream attempts are prohibited.');
    calls[kind]++; return post(url, body, options);
  };
  await app.listen(0, '127.0.0.1');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${receiptName}.started.json`), JSON.stringify({ startedAt: new Date().toISOString(), maximumBatches }), { flag: 'wx', mode: 0o600 });
  reserved = true;
  const url = `${await app.getUrl()}/api/businesses/${encodeURIComponent(businessId)}/analytics`;
  const host = new URL(config.get('GOOGLE_FRONTEND_ORIGIN')).host;
  const read = () => new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { host, accept: 'application/json' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { reject(new Error('Invalid local response.')); } });
      response.on('error', reject);
    });
    request.setTimeout(45000, () => request.destroy(new Error('Local verification timeout.'))); request.on('error', reject);
  });
  const first = await read(), data = first.body.data;
  const count = calls.ga4;
  const second = await read();
  receipt = { completedAt: new Date().toISOString(), httpStatus: first.status, businessId, availability: first.body.availability,
    errorCode: first.body.errorCode ?? first.body.error?.code ?? null, calls, dateRange: data?.dateRange ?? null,
    totals: data?.totals ?? null, conversion: data?.conversion ?? null, rows: data ? { daily: data.daily.length, channels: data.channels.length, devices: data.devices.length, pages: data.pages.length } : null,
    metadata: data?.metadata ?? null, limitations: data?.limitations ?? [], cacheVerified: second.body.cache?.hit === true && calls.ga4 === count && JSON.stringify(second.body.data) === JSON.stringify(data),
    metaLedgerUnchanged: JSON.stringify(before) === JSON.stringify(await ledger()) };
  await writeFile(resolve(directory, `${receiptName}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
  if (first.status !== 200 || first.body.availability === 'unavailable' || !receipt.cacheVerified || !receipt.metaLedgerUnchanged || calls.meta) process.exitCode = 1;
} catch {
  console.error('Live Analytics verification did not finish. Inspect the sanitized receipt/configuration before any separately authorized retry.');
  if (reserved && !receipt) await writeFile(resolve(directory, `${receiptName}.json`), JSON.stringify({ availability: 'unavailable', calls, completedAt: new Date().toISOString() }), { mode: 0o600 });
  process.exitCode = 1;
} finally { await app.close(); }
