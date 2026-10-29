// Explicit live smoke test: starts the compiled API on a temporary loopback port,
// runs the registered demo business through its real HTTP audit workflow, and exits.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

process.env.LOG_LEVEL = 'silent';
const { AppModule } = await import('../dist/app.module.js');
const { configureApp } = await import('../dist/configure-app.js');
const { buildHomepageReport } = await import('../dist/reporting/homepage-report.js');
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
const scope = process.argv.includes('--lighthouse') ? 'lighthouse' : 'homepage';
const strategy = process.argv.includes('--desktop') ? 'desktop' : 'mobile';
const reportPath = scope === 'lighthouse' ? `reports/guzman-lighthouse-${strategy}.json` : 'reports/guzman-homepage.json';
try {
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function json(path, options) {
    const response = await globalThis.fetch(`${base}${path}`, { ...options, signal: globalThis.AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`API returned ${response.status}: ${await response.text()}`);
    return response.json();
  }
  const created = await json('/api/businesses/demo-guzman/audits', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, ...(scope === 'lighthouse' ? { strategy } : {}) }),
  });
  let audit;
  const deadline = Date.now() + 40000 + (scope === 'lighthouse' ? app.get(ConfigService).getOrThrow('PAGESPEED_TIMEOUT_MS') : 0);
  do {
    audit = await json(created.statusUrl);
    if (['completed', 'partial', 'failed'].includes(audit.status)) break;
    await delay(250);
  } while (Date.now() < deadline);
  const findings = await json(`/api/audits/${created.id}/findings`);
  const recommendations = await json(`/api/audits/${created.id}/recommendations`);
  const dashboard = await json('/api/businesses/demo-guzman/dashboard');
  const lighthouse = scope === 'lighthouse' ? await json(`/api/audits/${created.id}/lighthouse`) : undefined;
  const report = buildHomepageReport(audit, findings, recommendations, dashboard, lighthouse);
  await mkdir('reports', { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ auditId: created.id, status: audit.status, failure: audit.failure, counts: audit.counts,
    collection: findings.evidence.find((e) => e.checkId === 'collection')?.observed,
    findings: findings.findings.map((f) => ({ checkId: f.checkId, title: f.title })),
    ...(lighthouse ? { lighthouse: lighthouse.report?.categories.map(({ id, score, availability }) => ({ id, score, availability })) ?? null } : {}), report: reportPath }, null, 2));
  if (audit.status !== 'completed') process.exitCode = 1;
} finally {
  await app.close();
}
