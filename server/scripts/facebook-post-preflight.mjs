// Explicit local read-only diagnostic. No model generation and no Facebook writes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../dist/app.module.js';
import { FileReportStore } from '../dist/reports/file-report.store.js';
import { InvestigationInterpretationStore } from '../dist/reporting/investigation-interpretation.store.js';
import { AssessmentService } from '../dist/modules/assessments/assessment.service.js';
import { FacebookService } from '../dist/modules/facebook/facebook.service.js';
import { AiUsageStore } from '../dist/integrations/ai/ai-usage.store.js';

assert.ok(process.argv.slice(2).every(arg => arg === '--permissions' || /^--business-id=[a-zA-Z0-9_-]{1,128}$/.test(arg)), 'Use --business-id=ID and optional --permissions.');
const businessId = process.argv.find(arg => arg.startsWith('--business-id='))?.slice('--business-id='.length) ?? 'demo-guzman';
process.env.LOG_LEVEL = 'silent';
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const config = app.get(ConfigService), reports = app.get(FileReportStore);
  const latest = (await reports.list(businessId)).find(item => item.scope === 'facebook' && item.mode === 'live' && ['completed', 'partial'].includes(item.status));
  const report = latest ? await reports.read(latest.auditId) : null;
  const interpretation = latest ? app.get(InvestigationInterpretationStore).saved(businessId, [latest.auditId], false) : null;
  const assessment = (await app.get(AssessmentService).latest(businessId)).assessment;
  const usage = await app.get(AiUsageStore).status();
  const result = { businessId, publishingEnabled: config.get('FACEBOOK_POSTS_ENABLED'), pageId: report?.results?.facebook?.pageId ?? null,
    pageName: report?.results?.facebook?.pageName ?? null, reportId: latest?.auditId ?? null,
    recommendations: interpretation?.recommendations.filter(item => item.category === 'social').map(item => ({ id: item.id, title: item.title, findingId: item.findingId })) ?? [],
    assessmentRecommendations: assessment?.analysis?.output.recommendations.filter(item => item.findingId === 'score:social:posting').map(item => ({ id: item.id, title: item.title, reportId: item.reportId })) ?? [],
    aiBudget: usage.development, configuredTokenPermission: 'not checked', writes: 0, modelRequests: 0 };
  if (process.argv.includes('--permissions')) {
    const token = config.get('FACEBOOK_ACCESS_TOKEN');
    if (!token) result.configuredTokenPermission = 'No configured diagnostic token; browser authorization must be checked when publishing.';
    else {
      try { result.configuredTokenPermission = (await app.get(FacebookService).requirePermissions(token)).includes('pages_manage_posts') ? 'pages_manage_posts granted (browser connection checked separately at publication)' : 'pages_manage_posts missing; update Facebook Login configuration and reconnect'; }
      catch { result.configuredTokenPermission = 'Permission check failed; reconnect Facebook. No write was attempted.'; }
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
