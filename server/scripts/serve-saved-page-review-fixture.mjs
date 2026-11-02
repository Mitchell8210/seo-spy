// Read-only UI replay of saved real source evidence. All transports disconnected.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Test } from '@nestjs/testing';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { WordPressModule } from '../dist/modules/wordpress/wordpress.module.js';
import { WordPressClient } from '../dist/integrations/wordpress/wordpress.client.js';
import { MetaMuseTransport } from '../dist/integrations/ai/meta-muse.provider.js';
import { WebsiteCollector } from '../dist/integrations/website/collector.js';
import { FileReportStore } from '../dist/reports/file-report.store.js';
import { BUSINESS_REPOSITORY } from '../dist/persistence/repositories.js';
import { WordPressFixStore } from '../dist/modules/wordpress/wordpress-fix.store.js';
import { WordPressFixService } from '../dist/modules/wordpress/wordpress-fix.service.js';
import { WordPressFixSessions } from '../dist/modules/wordpress/wordpress-fix-session.js';
import { operatorIdentity } from '../dist/modules/wordpress/wordpress.guard.js';
import { configureApp } from '../dist/configure-app.js';
import { summarizeEvidence } from '../dist/reporting/evidence-summary.js';
const {values}=parseArgs({strict:true,options:{'offline-confirmed':{type:'boolean'},'report-file':{type:'string'},'enrollment-file':{type:'string'}}});
assert.equal(values['offline-confirmed'],true);
const report=JSON.parse(await readFile(values['report-file'],'utf8'));
const enrollment=JSON.parse(await readFile(values['enrollment-file'],'utf8')).enrollment;
assert.equal(report.reportId,enrollment.source.reportId);
const directory=await mkdtemp(join(tmpdir(),'seo-spy-saved-page-review-'));
const operator='offline-saved-source-replay-operator-fixture',actor=operatorIdentity(operator),businessId=report.business.id;
const config=new ConfigService({NODE_ENV:'test',DATABASE_PATH:join(directory,'application.sqlite'),AI_USAGE_DB:join(directory,'usage.sqlite'),
 WORDPRESS_BUSINESS_ID:businessId,WORDPRESS_SITE_URL:enrollment.siteUrl,WORDPRESS_USERNAME:'offline',WORDPRESS_APPLICATION_PASSWORD:'offline',WORDPRESS_OPERATOR_KEY:operator,
 WORDPRESS_FRONTEND_ORIGIN:'http://localhost:5187',WORDPRESS_WRITES_ENABLED:false,WORDPRESS_ACTIONS_DIR:join(directory,'actions'),WORDPRESS_REPORTS_DIR:join(directory,'reports'),
 WORDPRESS_MUSE_DIR:join(directory,'muse'),REPORTS_DIR:join(directory,'audit-reports'),MOCK_AI:true,AI_MODE:'mock',AI_ENABLED:false,AI_DEV_BUDGET_MICROS:0,PORT:3187,LOG_LEVEL:'silent'});
let forbiddenDispatches=0;
const forbidden=()=>{forbiddenDispatches++;throw new Error('All WordPress, page and model transports are disconnected in this saved-source UI replay.');};
const module=await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true}),WordPressModule]})
 .overrideProvider(ConfigService).useValue(config).overrideProvider(FileReportStore).useValue({read:async id=>id===report.reportId?report:null})
 .overrideProvider(BUSINESS_REPOSITORY).useValue({findById:async id=>id===businessId?report.business:null,connections:async()=>[]})
 .overrideProvider(WordPressClient).useValue({request:forbidden}).overrideProvider(WebsiteCollector).useValue({collect:forbidden})
 .overrideProvider(MetaMuseTransport).useValue({post:forbidden}).compile();
const app=configureApp(module.createNestApplication());app.useLogger(false);
app.get(WordPressFixStore).publish({...enrollment,actor});
const fixes=app.get(WordPressFixService);
for(const method of ['generate','propose','apply','verify','restore'])fixes[method]=forbidden;
const finding=report.results.findings.find(row=>row.id===enrollment.source.findingId),recommendation=report.results.recommendations.find(row=>row.findingId===finding.id);
const summary=summarizeEvidence(report.reportId,report.results).findings.find(row=>row.id===finding.id);
app.getHttpAdapter().getInstance().get('/api/fix-fixture',async(_req,res)=>{
 const ticket=await app.get(WordPressFixSessions).issue({get:name=>name==='authorization'?`Bearer ${operator}`:undefined},businessId);
 res.setHeader('Cache-Control','no-store');res.json({bootstrap:ticket.url,review:{id:finding.id,findingId:finding.id,reportId:report.reportId,businessId,
  title:finding.title,category:'website',source:summary.sourceLabel,explanation:finding.explanation,recommendation:recommendation.recommendedChange,
  evidence:[summary.text],evidenceRefs:[{reportId:report.reportId,evidenceId:enrollment.source.evidenceId}]}});
});
app.getHttpAdapter().getInstance().get('/api/fix-fixture/receipts',(_req,res)=>res.json({offline:true,savedRealSourceReplay:true,protectedDatabasesOpened:false,forbiddenDispatches,
 modelRequests:0,mockWordPressWrites:0,liveWordPressWrites:0,reportId:report.reportId,targetMediaId:enrollment.target.mediaId}));
await app.init();await app.listen(3187,'127.0.0.1');console.log('Saved-source review fixture ready. Disposable context copy, no live credentials or transports.');
process.once('SIGINT',async()=>{await app.close();process.exit(0);});
