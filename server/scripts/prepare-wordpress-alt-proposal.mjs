// Preparation and separately approved exact funding+intent activation. No paid approval, reservation, dispatch or WordPress write command.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { WordPressOperatorGuard, operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { WordPressService } from '../dist/modules/wordpress/wordpress.service.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressPurposeService } from '../dist/modules/wordpress/wordpress-purpose.service.js';
import { WordPressImageContent } from '../dist/integrations/wordpress/image-content.js';
import { altEvidenceSchema, altProposalContextSchema, hasAltTerm } from '../dist/modules/wordpress/wordpress-fix.types.js';
import { buildAltModelInput } from '../dist/modules/wordpress/wordpress-alt-request.js';
import { MetaMuseProvider } from '../dist/integrations/ai/meta-muse.provider.js';
import { AiUsageStore } from '../dist/integrations/ai/ai-usage.store.js';
import { authenticateAiAdministrator, AiAdminGuard } from '../dist/modules/ai/ai-admin.guard.js';
import { AiAdminController } from '../dist/modules/ai/ai-admin.controller.js';
import { WordPressClient, WordPressTransport } from '../dist/integrations/wordpress/wordpress.client.js';
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../dist/integrations/website/collector.js';
const { values, positionals } = parseArgs({ strict: true, allowPositionals: true, options: {
  'business-id': { type: 'string' }, 'evidence-id': { type: 'string' }, confirmed: { type: 'boolean' }, output: { type: 'string' },
  'revalidation-file': { type: 'string' }, 'spanish-review-file': { type: 'string' }, instructions: { type: 'string', default: '' },
  'funding-preview-file': { type: 'string' }, 'request-sha256': { type: 'string' }, 'policy-sha256': { type: 'string' }, 'funding-sha256': { type: 'string' }, 'reservation-micros': { type: 'string' } } });
const command = positionals[0];
assert.equal(positionals.length, 1); assert.ok(['revalidate', 'preview', 'draft-preview', 'funding-preview', 'activate-funding', 'funded-intent'].includes(command)); assert.equal(values.confirmed, true);
const fundedOperation = ['activate-funding', 'funded-intent'].includes(command);
assert.match(values.output ?? '', /^[a-z0-9][a-z0-9-]*\.json$/);
const output = `reports/${values.output}`; assert.equal(existsSync(output), false, 'Choose a new immutable output filename.');
assert.equal(process.env.MOCK_AI, 'true'); assert.equal(process.env.AI_MODE, 'mock'); assert.equal(process.env.AI_ENABLED, 'false');
assert.notEqual(process.env.WORDPRESS_WRITES_ENABLED, 'true'); assert.equal(Number(process.env.AI_DEV_BUDGET_MICROS ?? 0), 0);
const config = new ConfigService({ ...process.env }), key = config.get('WORDPRESS_OPERATOR_KEY'), actor = operatorIdentity(key ?? '');
new WordPressOperatorGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => ({ get: name => ({ host: 'localhost:3001', authorization: `Bearer ${key}` })[name] }), getResponse: () => ({ setHeader() {} }) }) });
const digest = value => createHash('sha256').update(typeof value === 'string' || globalThis.Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const databasePath = config.get('DATABASE_PATH') ?? 'reports/seo-spy.sqlite', ledgerPath = config.get('AI_USAGE_DB') ?? 'reports/ai-usage.sqlite';
const protectedPaths = ['.env', databasePath, `${databasePath}-wal`, `${databasePath}-shm`, ledgerPath, `${ledgerPath}.initialized`, `${ledgerPath}-wal`, `${ledgerPath}-shm`];
const fingerprints = () => Object.fromEntries(protectedPaths.map(path => [path, existsSync(path) ? digest(readFileSync(path)) : null]));
const before = fingerprints();
const db = new DatabaseSync(databasePath, { readOnly: true });
let record, report, business, records, archivedReports;
try {
  const row = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE id=? AND business_id=? AND actor=?').get(values['evidence-id'], values['business-id'], actor);
  assert.ok(row); assert.equal(digest(row.payload), row.checksum); record = altEvidenceSchema.parse(JSON.parse(row.payload));
  const archived = db.prepare("SELECT payload_json,checksum FROM artifacts WHERE kind='audit-report' AND id=? AND business_id=?").get(record.source.reportId, values['business-id']);
  assert.ok(archived); assert.equal(digest(archived.payload_json), archived.checksum); report = JSON.parse(archived.payload_json);
  assert.equal(digest(report), record.source.reportHash);
  business = JSON.parse(db.prepare('SELECT data_json FROM businesses WHERE id=?').get(values['business-id']).data_json);
  const rows = db.prepare('SELECT payload,checksum FROM wordpress_fix_records WHERE business_id=? AND actor=? ORDER BY created_at DESC,rowid DESC').all(values['business-id'], actor);
  assert.ok(rows.length <= 5000 && rows.reduce((sum, row) => sum + globalThis.Buffer.byteLength(row.payload), 0) <= 32 * 1024 * 1024);
  records = rows.map(row => { assert.equal(digest(row.payload), row.checksum); return JSON.parse(row.payload); });
  const latestState = records.find(row => row.kind === 'execution-state' && row.evidenceId === record.id);
  archivedReports = new Map([[report.reportId, report]]);
  if (latestState && latestState.source.reportId !== report.reportId) {
    const source = db.prepare("SELECT payload_json,checksum FROM artifacts WHERE kind='audit-report' AND id=? AND business_id=?").get(latestState.source.reportId, record.businessId);
    assert.ok(source); assert.equal(digest(source.payload_json), source.checksum); archivedReports.set(latestState.source.reportId, JSON.parse(source.payload_json));
  }
} finally { db.close(); }
const forbidden = new Proxy({}, { get: () => () => { throw new Error('Ledger mutation, model dispatch and action storage are forbidden during preparation.'); } });
const provider = new MetaMuseProvider(config, forbidden, forbidden);
const wordpressTransport = new WordPressTransport(), native = wordpressTransport.send.bind(wordpressTransport), authenticatedRequests = [];
const allowedPaths = new Set([`/wp-json/wp/v2/media/${record.target.mediaId}`, `/wp-json/wp/v2/${record.target.pageResource}/${record.target.pageId}`, '/wp-json/wp/v2/users/me']);
wordpressTransport.send = (...args) => { assert.ok(command === 'revalidate' || fundedOperation); assert.ok(['GET', 'OPTIONS'].includes(args[2])); assert.ok(allowedPaths.has(args[0].pathname)); authenticatedRequests.push({ method: args[2], path: args[0].pathname }); return native(...args); };
const wordpress = new WordPressService(config, new WordPressClient(new WebsiteDns(), wordpressTransport), forbidden, { findById: async id => id === business.id ? business : null });
const reports = { read: async id => archivedReports.get(id) ?? null };
const store = { read: (businessId, owner, id) => businessId === record.businessId && owner === actor ? records.find(row => row.id === id) ?? null : null,
  list: (businessId, owner) => businessId === record.businessId && owner === actor ? records : [], publish: forbidden.publish };
const collector = new WebsiteCollector(new WebsiteDns(), new WebsiteTransport());
const purposes = new WordPressPurposeService(wordpress, reports, store, collector, new WordPressImageContent(new WebsiteDns(), new WebsiteTransport()));
const fixes = new WordPressFixService(wordpress, reports, store, provider, config, forbidden, collector, forbidden, purposes);
let result;
if (command === 'revalidate') {
  result = { ...(await fixes.revalidate(record.businessId, actor, record.id)), authenticatedRequests };
} else {
  let evidence = record, unconfirmedDraft = false;
  if (command === 'draft-preview') {
    const checked = JSON.parse(readFileSync(values['revalidation-file'], 'utf8'));
    const spanish = JSON.parse(readFileSync(values['spanish-review-file'], 'utf8'));
    assert.equal(checked.evidenceId, record.id); assert.deepEqual(checked.target, record.target);
    assert.deepEqual(checked.source, record.source); assert.equal(checked.confirmationRenewed, false);
    assert.ok(Date.now() - Date.parse(checked.revalidatedAt) < 15 * 60000 && Date.parse(checked.revalidatedAt) <= Date.now());
    assert.ok(spanish.requiredTerms.every(term => hasAltTerm(spanish.verifiedDescription, term)));
    evidence = altEvidenceSchema.parse({ ...record, verifiedDescription: spanish.verifiedDescription,
      proposalContext: altProposalContextSchema.parse({ version: 'wordpress-alt-context-v2', language: 'es', requiredTerms: spanish.requiredTerms,
        business: { id: report.business.id, name: report.business.name, website: report.business.website }, page: checked.pageContext }) });
    unconfirmedDraft = true;
  } else {
    assert.equal(record.proposalContext?.language, 'es', 'This preparation command requires an explicitly reviewed Spanish context.');
    await fixes.preview(record.businessId, actor, { evidenceId: record.id, instructions: values.instructions });
  }
  const prepared = unconfirmedDraft ? provider.prepare(buildAltModelInput(evidence, values.instructions))
    : await fixes.prepareRequest(record.businessId, actor, { evidenceId: record.id, instructions: values.instructions });
  const effective = !unconfirmedDraft && purposes.hasBinding(record) ? await purposes.resolve(record) : record;
  const payload = JSON.parse(prepared.payload);
  result = { ...prepared, requestBytes: globalThis.Buffer.byteLength(prepared.payload), evidenceId: record.id,
    scope: `wordpress-alt:${record.businessId}:${record.id}`, unconfirmedDraft, activeReview: !unconfirmedDraft && Date.parse(effective.expiresAt) > Date.now(),
    ownerConfirmedAt: record.createdAt, purposeReusable: !!effective.purposeDependencyHash, executionStateExpiresAt: effective.expiresAt,
    confirmationRequiredBeforeGeneration: unconfirmedDraft, paidAuthorizationAvailable: false,
    expectedOutputSchema: payload.text.format.schema, modelSettings: { model: payload.model, processing: 'standard', reasoning: payload.reasoning.effort,
      maxOutputTokens: payload.max_output_tokens, tools: payload.tools, toolChoice: payload.tool_choice, store: payload.store, stream: payload.stream, background: payload.background },
    noAuthorizationCreated: true, noReservationCreated: true, modelRequests: 0, wordPressWrites: 0 };
  if (command === 'funding-preview' || fundedOperation) {
    const adminKey = config.get('AI_ADMIN_KEY') ?? '';
    const adminActor = authenticateAiAdministrator(adminKey, adminKey);
    const request = { actor, businessId: record.businessId, evidenceContextId: record.id, requestHash: prepared.requestHash,
      model: prepared.model, processingMode: 'standard', reasoningEffort: 'minimal', maxInputTokens: prepared.maxInputTokens,
      maxOutputTokens: prepared.maxOutputTokens, reserveMicros: prepared.reserveMicros, priceVersion: prepared.priceVersion,
      inputPriceMicrosPerMillion: prepared.inputPriceMicrosPerMillion, outputPriceMicrosPerMillion: prepared.outputPriceMicrosPerMillion };
    const ledger = new AiUsageStore(config);
    try {
      const reviewed = fundedOperation ? JSON.parse(readFileSync(values['funding-preview-file'], 'utf8')) : null;
      result.funding = command === 'funded-intent' ? reviewed.funding : await ledger.prepareWordPressAltFunding(adminActor, request);
      if (fundedOperation) {
        assert.equal(values['request-sha256'], prepared.requestHash); assert.equal(Number(values['reservation-micros']), prepared.reserveMicros);
        assert.equal(values['policy-sha256'], result.funding.policyHash); assert.equal(values['funding-sha256'], result.funding.fundingHash);
        assert.equal(reviewed.requestHash, prepared.requestHash); assert.equal(reviewed.payload, prepared.payload);
        assert.deepEqual(reviewed.fundingRequest, request); assert.deepEqual(reviewed.funding, result.funding);
        assert.ok(effective.purposeDependencyHash); assert.equal(effective.target.mediaId, 5659); assert.equal(effective.target.pageId, 5652); assert.equal(effective.target.currentAlt, '');
        const checked = await fixes.revalidate(record.businessId, actor, record.id);
        assert.equal(checked.purposeReusable, true); assert.equal(checked.requiresNewOperatorConfirmation, false); assert.equal(checked.executionRefreshRequired, false);
        assert.deepEqual(checked.target, effective.target); assert.deepEqual(checked.source, effective.source);
        assert.deepEqual(fingerprints(), before);
        const adminRequest = { get: name => ({ host: 'localhost:3001', authorization: `Bearer ${adminKey}` })[name] };
        new AiAdminGuard(config).canActivate({ switchToHttp: () => ({ getRequest: () => adminRequest, getResponse: () => ({ setHeader() {} }) }) });
        // Keep a complete immutable row baseline, independently of the funding history guard.
        const snapshot = () => {
          const copy = new DatabaseSync(ledgerPath, { readOnly: true });
          try { return Object.fromEntries(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => {
            assert.match(name, /^[a-z_]+$/); return [name, copy.prepare(`SELECT * FROM ${name}`).all().map(row => digest(row)).sort()];
          })); } finally { copy.close(); }
        };
        const historical = snapshot();
        const admin = new AiAdminController(ledger, config), statusBefore = await ledger.status();
        assert.equal(statusBefore.activeAttemptId, null); assert.equal(statusBefore.halted, false);
        let grant;
        if (command === 'activate-funding') {
          assert.equal(statusBefore.wordPressAlt, undefined);
          grant = await admin.activateFunding(adminRequest, { request, confirmed: true, policyHash: values['policy-sha256'], fundingHash: values['funding-sha256'] });
        } else {
          grant = statusBefore.wordPressAlt?.funding; assert.ok(grant);
          assert.equal(grant.adminActor, adminActor); assert.deepEqual(grant.request, request);
          assert.equal(grant.policyHash, values['policy-sha256']); assert.equal(grant.fundingHash, values['funding-sha256']);
          assert.equal(statusBefore.wordPressAlt.calls, 0); assert.equal(statusBefore.wordPressAlt.receiptCount, 0);
        }
        // Transport is an unconditional local rejection; this operator cannot dispatch even if flags are changed elsewhere.
        const intentProvider = new MetaMuseProvider(config, { post: forbidden.post }, ledger);
        const intentFixes = new WordPressFixService(wordpress, reports, store, intentProvider, config, forbidden, collector, forbidden, purposes);
        const intent = await intentFixes.estimate(record.businessId, actor, { evidenceId: record.id, instructions: values.instructions }, 'One separately funded Spanish alt proposal; paid dispatch requires a further exact approval.');
        assert.equal(intent.requestHash, prepared.requestHash); assert.equal(intent.reserveMicros, prepared.reserveMicros); assert.equal(intent.approvedAt, null); assert.equal(intent.consumedAt, null);
        const statusAfter = await ledger.status(), afterRows = snapshot();
        for (const [table, rows] of Object.entries(historical)) for (const row of rows) assert.ok(afterRows[table]?.includes(row), `Historical ${table} row changed.`);
        assert.deepEqual(statusAfter.development, statusBefore.development); assert.deepEqual(statusAfter.demo, statusBefore.demo); assert.deepEqual(statusAfter.recentAttempts, statusBefore.recentAttempts);
        assert.equal(statusAfter.wordPressAlt.calls, 0); assert.equal(statusAfter.wordPressAlt.chargedMicros, 0);
        result = { ...result, fundingActivated: true, grant, intent, statusBefore, statusAfter, historicalRowsUnchanged: true,
          authenticatedRequests, paidAuthorizationAvailable: false, noAuthorizationCreated: false, paidRequestApproved: false, noReservationCreated: true };
      }
    }
    finally { ledger.onModuleDestroy(); }
    result.fundingActivated ??= false;
    result.fundingRequest = request;
  }
}
if (fundedOperation) {
  const after = fingerprints();
  for (const path of protectedPaths.filter(path => ![ledgerPath, `${ledgerPath}-wal`, `${ledgerPath}-shm`].includes(path))) assert.equal(after[path], before[path], `Protected ${path} changed.`);
} else assert.deepEqual(fingerprints(), before, 'Protected files changed during read-only preparation.');
writeFileSync(output, JSON.stringify({ ...result, protectedFilesByteUnchanged: !fundedOperation }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ artifact: output, requestHash: result.requestHash, reserveMicros: result.reserveMicros,
  reviewExpired: result.reviewExpired, confirmationRenewed: false, unconfirmedDraft: result.unconfirmedDraft, modelRequests: 0, wordPressWrites: 0 }));
