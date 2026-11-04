// Explicit developer diagnostic. Saved reports only; one model dispatch maximum, no retries or external writes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from '../dist/app.module.js';
import { FileReportStore } from '../dist/reports/file-report.store.js';
import { InvestigationAiService, interpretationInput, INVESTIGATION_INSTRUCTIONS } from '../dist/modules/investigation-ai/investigation-ai.service.js';
import { InvestigationInterpretationStore } from '../dist/reporting/investigation-interpretation.store.js';
import { interpretationHash, interpretationSources, interpretationOutputSchema, INTERPRETATION_VERSION } from '../dist/reporting/investigation-interpretation.js';
import { MetaMuseProvider, MetaMuseTransport } from '../dist/integrations/ai/meta-muse.provider.js';
import { AiUsageStore } from '../dist/integrations/ai/ai-usage.store.js';
import { authenticateAiAdministrator } from '../dist/modules/ai/ai-admin.guard.js';
import { AppDatabase } from '../dist/persistence/sqlite/app-database.js';
import { BUSINESS_REPOSITORY } from '../dist/persistence/repositories.js';

const revalidate = process.argv.find(arg => /^--revalidate=[a-f0-9-]{36}$/.test(arg))?.slice('--revalidate='.length);
assert.ok(process.argv.slice(2).every(arg => ['--confirmed', '--website', '--social'].includes(arg) || arg === `--revalidate=${revalidate}`), 'Choose a supported diagnostic option.');
assert.ok(!(revalidate && process.argv.includes('--confirmed')), 'Offline revalidation cannot dispatch a paid request.');
assert.ok(!(process.argv.includes('--website') && process.argv.includes('--social')), 'Choose one channel or the combined reports.');
process.env.LOG_LEVEL = 'silent';
process.env.WORDPRESS_WRITES_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const config = app.get(ConfigService), businessId = config.getOrThrow('WORDPRESS_BUSINESS_ID'), siteUrl = config.getOrThrow('WORDPRESS_SITE_URL');
  const key = config.getOrThrow('AI_ADMIN_KEY'), actor = authenticateAiAdministrator(key, key);
  const store = app.get(FileReportStore), summaries = await store.list(businessId), reports = [];
  for (const scopes of [['homepage', 'lighthouse'], ['facebook']]) {
    if (process.argv.includes('--website') && scopes[0] === 'facebook' || process.argv.includes('--social') && scopes[0] !== 'facebook') continue;
    const candidate = summaries.find(item => item.mode === 'live' && ['completed', 'partial'].includes(item.status) && scopes.includes(item.scope));
    if (candidate) reports.push(await store.read(candidate.auditId));
  }
  assert.ok(reports.length && reports.every(Boolean), 'Saved live evidence is required.');
  reports.sort((a,b) => a.auditId.localeCompare(b.auditId));
  const ids = reports.map(report => report.auditId), hashes = reports.map(interpretationHash);
  const resourceKey = interpretationHash({ version: INTERPRETATION_VERSION, sources: interpretationSources(reports) });
  const prepared = interpretationInput(reports, resourceKey, siteUrl);
  const cost = app.get(MetaMuseProvider).prepare({ instructions: INVESTIGATION_INSTRUCTIONS, input: prepared.input,
    schema: z.toJSONSchema(interpretationOutputSchema), reasoningEffort: 'minimal' });
  console.log(JSON.stringify({ phase: 'prepared', reportIds: ids, requestHash: cost.requestHash, model: cost.model, maximumCostUsd: cost.reserveMicros / 1e6, maxOutputTokens: cost.maxOutputTokens }));
  if (revalidate) {
    const original = app.get(InvestigationInterpretationStore).saved(businessId, ids);
    assert.equal(original?.attemptId, revalidate, 'The saved attempt must match these exact source reports.');
    assert.deepEqual(original.sources, interpretationSources(reports));
    const ledger = await app.get(AiUsageStore).status();
    assert.equal(ledger.recentAttempts.find(attempt => attempt.id === revalidate)?.status, 'success');
    const generated = JSON.parse(await readFile(join(config.getOrThrow('REPORTS_DIR'), `investigation-diagnostic-${revalidate}.json`), 'utf8'));
    assert.equal(generated.attemptId, revalidate);
    const memory = new AppDatabase(new ConfigService({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }));
    try {
      const provider = app.get(MetaMuseProvider);
      const service = new InvestigationAiService(store, new InvestigationInterpretationStore(memory),
        { prepare: input => provider.prepare(input), generateFrontend: async () => generated }, app.get(BUSINESS_REPOSITORY));
      const checked = await service.interpret({ actor, businessId, siteUrl }, ids);
      assert.equal(checked.status, 'completed');
      assert.deepEqual(await Promise.all(ids.map(async id => interpretationHash(await store.read(id)))), hashes);
      assert.deepEqual(await app.get(AiUsageStore).status(), ledger);
      console.log(JSON.stringify({ phase: 'offline-revalidation', status: checked.status, recommendations: checked.recommendations.length, modelDispatches: 0, originalReceiptPreserved: true, sourcesUnchanged: true }));
    } finally { memory.onApplicationShutdown(); }
  }
  if (process.argv.includes('--confirmed')) {
    const ledger = app.get(AiUsageStore), before = await ledger.status();
    const provider = app.get(MetaMuseProvider), generate = provider.generateFrontend.bind(provider);
    provider.generateFrontend = async (...args) => {
      const generated = await generate(...args);
      // Local ignored artifact permits offline validation/debugging without another paid dispatch.
      await writeFile(join(config.getOrThrow('REPORTS_DIR'), `investigation-diagnostic-${generated.attemptId}.json`), JSON.stringify(generated), { flag: 'wx' });
      return generated;
    };
    const transport = app.get(MetaMuseTransport), post = transport.post.bind(transport); let calls = 0;
    transport.post = async (...args) => { assert.equal(calls++, 0, 'No second model dispatch is allowed.'); return post(...args); };
    const result = await app.get(InvestigationAiService).interpret({ actor, businessId, siteUrl }, ids);
    assert.deepEqual(await Promise.all(ids.map(async id => interpretationHash(await store.read(id)))), hashes);
    assert.deepEqual(app.get(InvestigationInterpretationStore).saved(businessId, ids), result);
    const after = await ledger.status();
    console.log(JSON.stringify({ phase: 'result', status: result.status, errorCode: result.errorCode, interpretationId: result.id, attemptId: result.attemptId,
      recommendations: result.recommendations.length, modelDispatches: calls, savedReadMatches: true, sourcesUnchanged: true,
      sharedCallsBefore: before.development.calls, sharedCallsAfter: after.development.calls, writesEnabled: false }));
    assert.equal(result.status, 'completed', 'Interpretation did not complete. Inspect saved receipts; do not retry.');
  }
} finally { await app.close(); }
