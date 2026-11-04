// Explicit local-only saved-data verification. Never collect or dispatch a model.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { readFile, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const root = resolve('.'), appPath = join(root,'reports/seo-spy.sqlite'), ledger = join(root,'reports/ai-usage.sqlite');
const protectedPaths=[ledger,...['.initialized','-wal','-shm','-journal'].map(s=>ledger+s),join(root,'.env')];
const fingerprints=async()=>Promise.all(protectedPaths.map(async path=>existsSync(path)?hash(await readFile(path)):null));
const beforeFiles=await fingerprints();
const ro=new DatabaseSync(appPath,{readOnly:true});
const oldAnalyses=ro.prepare("SELECT id,business_id,data_json,checksum FROM assessment_records WHERE kind='analysis' ORDER BY rowid").all();
const tables=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{assert.match(name,/^[a-z_]+$/);return [name,hash(db.prepare(`SELECT * FROM ${name}${name==='assessment_records'?" WHERE kind!='analysis'":''} ORDER BY rowid`).all())];}));
const beforeTables=tables(ro); ro.close();
const counters={network:0,model:0,ledger:0};
const deny=key=>()=>{counters[key]++;throw new Error(`Mock verification blocked ${key}`);};
globalThis.fetch=deny('network'); http.request=deny('network'); http.get=deny('network'); https.request=deny('network'); https.get=deny('network'); net.connect=deny('network'); net.createConnection=deny('network'); tls.connect=deny('network'); syncBuiltinESMExports();
Object.assign(process.env,{MOCK_AI:'true',AI_MODE:'mock',AI_ENABLED:'false',WORDPRESS_WRITES_ENABLED:'false',MODEL_API_KEY:'',LOG_LEVEL:'silent'});
const {NestFactory}=await import('@nestjs/core');
const {ConfigService}=await import('@nestjs/config');
const {MetaMuseProvider,MetaMuseTransport}=await import('../dist/integrations/ai/meta-muse.provider.js');
const {AiUsageStore}=await import('../dist/integrations/ai/ai-usage.store.js');
MetaMuseProvider.prototype.generate=deny('model'); MetaMuseProvider.prototype.estimate=deny('model'); MetaMuseTransport.prototype.post=deny('model');
for(const method of ['status','estimate','reserve','settle','approve','authorizeDemo']) if(typeof AiUsageStore.prototype[method]==='function') AiUsageStore.prototype[method]=deny('ledger');
const {AppModule}=await import('../dist/app.module.js');
const {configureApp}=await import('../dist/configure-app.js');
const {AppDatabase}=await import('../dist/persistence/sqlite/app-database.js');
const {AssessmentStore}=await import('../dist/modules/assessments/assessment.store.js');
const {AssessmentService}=await import('../dist/modules/assessments/assessment.service.js');
const {AssessmentAnalysisService}=await import('../dist/modules/assessments/assessment-analysis.service.js');
const {AssessmentMuseAdapter,prepareAssessmentMuseEvidence}=await import('../dist/integrations/assessment-ai/assessment-muse.js');
const app=configureApp(await NestFactory.create(AppModule,{logger:false,abortOnError:false}));
const result={verifiedAt:new Date().toISOString()};
let serving=false;
try {
  const config=app.get(ConfigService), store=app.get(AssessmentStore), assessments=app.get(AssessmentService), analyses=app.get(AssessmentAnalysisService);
  assert.equal(resolve(root,config.get('DATABASE_PATH')??'reports/seo-spy.sqlite'),appPath);
  assert.equal(resolve(root,config.get('AI_USAGE_DB')??'reports/ai-usage.sqlite'),ledger);
  const businessId=config.getOrThrow('WORDPRESS_BUSINESS_ID');
  const business=await assessments.business(businessId,true);
  const candidates=store.list('assessment',businessId,100);
  let assessment,reports;
  for(const item of candidates) {
    if(item.snapshot?.policyVersion!=='seo-spy-score-v1.4')continue;
    const saved=await assessments.read(businessId,item.id),sources=await assessments.pinnedReports(saved);
    if(sources.length===2){assessment=saved;reports=sources;break;}
  }
  assert.ok(assessment,'No valid saved v1.4 assessment with both sources.');
  const original=hash(assessment),sourcesBefore=reports.map(hash);
  const bundle=prepareAssessmentMuseEvidence({assessmentId:assessment.id,businessId,policyVersion:assessment.snapshot.policyVersion,cutoff:assessment.snapshot.cutoff,scores:Object.entries(assessment.snapshot.scores).map(([category,score])=>({category,value:score.value,reasonCodes:score.reasons})),sources:reports,snapshot:assessment.snapshot,version:'v3'});
  const prepared=app.get(AssessmentMuseAdapter).prepare(bundle);
  // Pure serialization/cost check: never estimate/approve/reserve through the ledger.
  const wirePreview=app.get(MetaMuseProvider).prepare(prepared.modelInput);
  const wire=JSON.parse(wirePreview.payload);
  const selection={schemaVersion:'assessment-muse-selection-output-v3',strengthIds:bundle.businessContext.facts.filter(item=>item.kind==='strength').map(item=>item.id).sort((a,b)=>b.length-a.length).slice(0,3),weaknessIds:bundle.businessContext.facts.filter(item=>item.kind==='weakness').map(item=>item.id).sort((a,b)=>b.length-a.length).slice(0,3),recommendationIds:bundle.businessContext.recommendations.map(item=>item.id)};
  const livePreview={endpoint:'https://api.meta.ai/v1/responses',requestHash:wirePreview.requestHash,wireBytes:Buffer.byteLength(wirePreview.payload),maxInputTokens:wirePreview.maxInputTokens,maxOutputTokens:wirePreview.maxOutputTokens,reserveMicros:wirePreview.reserveMicros,priceVersion:wirePreview.priceVersion,
    model:wire.model,processingMode:'standard',reasoning:wire.reasoning,store:wire.store,stream:wire.stream,background:wire.background,tools:wire.tools,toolChoice:wire.tool_choice,truncation:wire.truncation,
    outputFormat:wire.text.format,maximumValidSelectionBytes:Buffer.byteLength(JSON.stringify(selection)),configuredPocBudgetMicros:Number(config.get('AI_DEV_BUDGET_MICROS')??2000000),publicAssessmentWorkflow:'mock-only',administratorApprovalCreated:false};
  if(existsSync(ledger)){
    // Even a read-only SQLite connection may create WAL/SHM sidecars. Inspect an
    // isolated copy instead; never open or checkpoint the protected source ledger.
    const inspection=await mkdtemp(join(root,'reports/ledger-inspection-'));
    const copy=join(inspection,'usage.sqlite');
    try{
      await copyFile(ledger,copy);
      if(existsSync(ledger+'-wal'))await copyFile(ledger+'-wal',copy+'-wal');
      const usage=new DatabaseSync(copy,{readOnly:true});
      try{livePreview.existingPolicy=usage.prepare('SELECT budget,daily,calls,halted FROM policy WHERE id=1').get();livePreview.existingUsage=usage.prepare('SELECT mode,COUNT(*) attempts,COALESCE(SUM(charged_micros),0) chargedMicros FROM attempts GROUP BY mode').all();}
      finally{usage.close();}
    }finally{
      assert.ok(resolve(inspection).startsWith(resolve(root,'reports')+'/')||resolve(inspection).startsWith(resolve(root,'reports')+'\\'));
      await rm(inspection,{recursive:true});
    }
  }
  const analysis=await analyses.create(businessId,assessment.id);
  assert.equal(analysis.output.schemaVersion,'assessment-muse-output-v3'); assert.equal(analysis.isMock,true);assert.deepEqual(analysis.usage,{inputTokens:0,outputTokens:0});
  assert.deepEqual(await analyses.read(businessId,assessment.id,analysis.id),analysis);
  assert.deepEqual(await analyses.create(businessId,assessment.id),analysis);
  const historical=[];
  for(const row of oldAnalyses.filter(row=>row.business_id===businessId)) {const old=JSON.parse(row.data_json),read=await analyses.read(businessId,old.assessmentId,old.id);assert.equal(hash({...read,createdAt:old.createdAt}),hash(old));historical.push({id:old.id,promptVersion:old.promptVersion,readable:true});}
  assert.equal(hash(await assessments.read(businessId,assessment.id)),original);
  assert.deepEqual((await assessments.pinnedReports(assessment)).map(hash),sourcesBefore);
  const db=app.get(AppDatabase).connection();assert.deepEqual(tables(db),beforeTables);
  for(const row of oldAnalyses){const now=db.prepare("SELECT data_json,checksum FROM assessment_records WHERE kind='analysis' AND id=?").get(row.id);assert.equal(now.data_json,row.data_json);assert.equal(now.checksum,row.checksum);}
  const seen=new Set();
  for(const ref of [...bundle.businessContext.facts,...bundle.businessContext.measures,...analysis.output.recommendations].flatMap(item=>item.evidenceRefs)){
    const key=JSON.stringify(ref);if(seen.has(key))continue;seen.add(key);
    const report=reports.find(report=>report.reportId===ref.reportId);
    assert.ok(report?.results.evidence.some(item=>item.id===ref.evidenceId&&item.auditId===report.auditId&&item.mode==='live')||report?.results.lighthouse?.categories.some(item=>ref.evidenceId===`lighthouse-category:${item.id}`&&item.availability==='measured'));
  }
  assert.deepEqual(await fingerprints(),beforeFiles);assert.deepEqual(counters,{network:0,model:0,ledger:0});
  Object.assign(result,{business:{id:business.id,name:business.name},assessmentId:assessment.id,cutoff:assessment.snapshot.cutoff,scores:Object.fromEntries(Object.entries(assessment.snapshot.scores).map(([category,score])=>[category,score.value])),policyHash:assessment.snapshot.policyHash,
    sourceManifest:analysis.sourceManifest,inputBytes:Buffer.byteLength(JSON.stringify(bundle)),modelInputBytes:Buffer.byteLength(JSON.stringify(prepared.modelInput)),outputBytes:Buffer.byteLength(JSON.stringify(analysis.output)),analysis,businessContext:bundle.businessContext,measurementGaps:bundle.scoringContext.measurementGaps,livePreview,
    historical,referenceCount:seen.size,assessmentAndSourcesUnchanged:true,nonAnalysisTablesUnchanged:true,historicalRecordsUnchanged:true,ledgerAndConfigurationUnchanged:true,cacheReused:true,counters});
  await writeFile('reports/assessment-muse-v3-verification.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({assessmentId:assessment.id,analysisId:analysis.id,scores:result.scores,inputBytes:result.inputBytes,modelInputBytes:result.modelInputBytes,outputBytes:result.outputBytes,historical:historical.length,referenceCount:seen.size,counters},null,2));
  if(process.argv.includes('--serve')) {
    app.use((request,response,next)=>{if(!['GET','HEAD','OPTIONS'].includes(request.method))return response.status(403).json({error:{code:'VERIFICATION_READ_ONLY'}});next();});
    await app.listen(3016,'127.0.0.1'); serving=true;
    console.log('PROTECTED_SAVED_DATA_SERVER=http://127.0.0.1:3016');
    const stop=async()=>{await app.close();assert.deepEqual(await fingerprints(),beforeFiles);console.log(JSON.stringify({closed:true,counters,protectedFilesUnchanged:true}));process.exit(0);};
    process.once('SIGINT',()=>void stop()); process.once('SIGTERM',()=>void stop());
  }
} finally {if(!serving)await app.close();}
