// Explicit one-shot, read-only event inspection for the authorized lead-conversion correction.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
if (!process.argv.includes('--confirmed')) throw new Error('Explicit live read requires --confirmed.');
process.env.LOG_LEVEL = 'silent'; process.env.AI_ENABLED = 'false'; process.env.MOCK_AI = 'true'; process.env.AI_MODE = 'mock'; process.env.WORDPRESS_WRITES_ENABLED = 'false';
const { AppModule } = await import('../dist/app.module.js');
const { GoogleReportingService } = await import('../dist/modules/google/google.service.js');
const { GoogleTransport } = await import('../dist/integrations/google/google-transport.js');
const { GOOGLE_TOKEN_PROVIDER } = await import('../dist/integrations/google/google-auth.js');
const { BUSINESS_REPOSITORY } = await import('../dist/persistence/repositories.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const directory = resolve(fileURLToPath(new URL('../', import.meta.url)), 'reports/google');
const filtered = process.argv.includes('--lead-filter');
const year = process.argv.includes('--year');
const receiptName = year ? 'lead-year-inspection' : filtered ? 'lead-filter-inspection' : 'lead-events-inspection';
let reserved = false;
try {
  const config = app.get(ConfigService), businessId = config.get('GOOGLE_BUSINESS_ID') || config.get('WORDPRESS_BUSINESS_ID');
  const propertyId = await app.get(GoogleReportingService).configuredGa4Asset(businessId);
  const business = await app.get(BUSINESS_REPOSITORY).findById(businessId);
  const hostname = new URL(business.website).hostname.toLowerCase().replace(/^www\./, '');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${receiptName}.started.json`), JSON.stringify({ startedAt: new Date().toISOString(), maximumBatches: 1 }), { flag: 'wx', mode: 0o600 });
  reserved = true;
  const accessToken = await app.get(GOOGLE_TOKEN_PROVIDER).getAccessToken();
  const request = filtered ? { requests: [[], ['date']].map((dimensions, index) => ({
    dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }], dimensions: dimensions.map(name => ({ name })),
    metrics: (index ? ['eventCount'] : ['eventCount', 'totalUsers']).map(name => ({ name })), limit: index ? '30' : '1',
    dimensionFilter: { andGroup: { expressions: [
      { filter: { fieldName: 'hostName', inListFilter: { values: [hostname, `www.${hostname}`], caseSensitive: false } } },
      { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: config.get('GA4_LEAD_EVENT_NAME'), caseSensitive: true } } },
      { filter: { fieldName: 'pagePath', inListFilter: { values: config.get('GA4_LEAD_PAGE_PATHS').split(','), caseSensitive: true } } },
    ] } },
  })) } : {
    requests: [{ dateRanges: [{ startDate: year ? '365daysAgo' : '30daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'eventName' }, { name: 'isKeyEvent' }, { name: 'pagePath' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }, { name: 'keyEvents' }], limit: year ? '1000' : '250',
      dimensionFilter: { filter: { fieldName: 'hostName', inListFilter: { values: [hostname, `www.${hostname}`], caseSensitive: false } } },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    }],
  };
  const data = await app.get(GoogleTransport).post(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, request, { accessToken });
  if (filtered) {
    const receipt = { collectedAt: new Date().toISOString(), businessId, hostname, reports: data?.reports?.map(report => ({
      dimensionHeaders: report.dimensionHeaders, metricHeaders: report.metricHeaders, rowCount: report.rowCount, metadata: report.metadata, rows: report.rows,
    })) };
    await writeFile(resolve(directory, `${receiptName}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
  } else {
  const report = data?.reports?.[0];
  if (!report || report.metricHeaders?.map(item => item.name).join(',') !== 'eventCount,totalUsers,keyEvents' ||
    report.dimensionHeaders?.map(item => item.name).join(',') !== 'eventName,isKeyEvent,pagePath') throw new Error('Invalid report.');
  const rows = (report.rows ?? []).map(row => ({ event: row.dimensionValues[0].value, isKeyEvent: row.dimensionValues[1].value,
    page: row.dimensionValues[2].value, events: row.metricValues[0].value, users: row.metricValues[1].value, keyEvents: row.metricValues[2].value }));
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: report.metadata.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = key => parts.find(item => item.type === key).value;
  const midnight = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  const receipt = { collectedAt: now.toISOString(), businessId, hostname,
    dateRange: { startDate: new Date(midnight - (year ? 365 : 30) * 86400000).toISOString().slice(0, 10), endDate: new Date(midnight - 86400000).toISOString().slice(0, 10) },
    rowCount: report.rowCount ?? rows.length, metadata: report.metadata, rows };
  await writeFile(resolve(directory, `${receiptName}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(year ? { ...receipt, truncated: receipt.rowCount > rows.length, eventNames: [...new Set(rows.map(row => row.event))].sort(), rows: rows.filter(row => /form|submit|lead|book|appoint|contact|inquiry|enquiry|conversion/i.test(row.event)) } : receipt, null, 2));
  }
} catch (error) {
  console.error('Lead-event inspection failed; no automatic retry was attempted.');
  if (reserved) await writeFile(resolve(directory, `${receiptName}.failed.json`), JSON.stringify({ failedAt: new Date().toISOString(), code: typeof error.code === 'string' ? error.code : 'INSPECTION_FAILED' }), { mode: 0o600 });
  process.exitCode = 1;
} finally { await app.close(); }
