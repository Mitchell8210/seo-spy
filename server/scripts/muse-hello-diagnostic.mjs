// Fixed one-time Hello diagnostic. No public endpoint, generic cap increase or retry.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import {parseArgs} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';

const {positionals,values}=parseArgs({args:process.argv.slice(2),allowPositionals:true,strict:true,options:{confirmed:{type:'boolean'},poc:{type:'boolean'},'request-hash':{type:'string'},'maximum-micros':{type:'string'},'intent-id':{type:'string'},out:{type:'string'}}});
const stage=positionals[0];
if(positionals.length!==1||!['preview','approve','execute'].includes(stage))throw new Error('Choose preview, approve or execute.');
const maximumMicros=Number(values['maximum-micros']);
if(stage!=='preview'&&(!values.confirmed||!/^[a-f0-9]{64}$/.test(values['request-hash']??'')||!Number.isInteger(maximumMicros)||maximumMicros<1||maximumMicros>10000))throw new Error('Confirm the exact fixed request hash and reservation, at most 10000 micros.');
if(stage==='execute'&&(!values.poc||!values['intent-id']))throw new Error('A deliberate POC command and approved intent are required.');
const output=values.out?resolve(values.out):null;
if(output&&(!output.startsWith(resolve('reports')+sep)||existsSync(output)))throw new Error('Choose a new ignored reports artifact path.');
let calls=0,wireRequests=0,dispatching=false;
const deny=()=>{throw new Error('External collection or additional network calls are forbidden.');};
const send=https.request;
https.request=(...args)=>{if(stage!=='execute'||!dispatching||wireRequests!==0||String(args[0])!=='https://api.meta.ai/v1/responses')return deny();wireRequests++;return send(...args);};
http.get=http.request=https.get=deny;globalThis.fetch=deny;syncBuiltinESMExports();
Object.assign(process.env,{MOCK_AI:'true',AI_MODE:'mock',AI_ENABLED:'false',WORDPRESS_WRITES_ENABLED:'false',LOG_LEVEL:'silent'});
const {NestFactory}=await import('@nestjs/core');
const {ConfigService}=await import('@nestjs/config');
const {AppModule}=await import('../dist/app.module.js');
const {AiUsageStore}=await import('../dist/integrations/ai/ai-usage.store.js');
const {readAiUsageSnapshot}=await import('../dist/integrations/ai/ai-usage-snapshot.js');
const {prepareMinimalMuseHello}=await import('../dist/integrations/ai/muse-hello-request.js');
const {MetaMuseProvider,MetaMuseTransport}=await import('../dist/integrations/ai/meta-muse.provider.js');
const {authenticateAiAdministrator}=await import('../dist/modules/ai/ai-admin.guard.js');
const app=await NestFactory.createApplicationContext(AppModule,{logger:false,abortOnError:false});
try{
  const config=app.get(ConfigService),ledger=app.get(AiUsageStore),prepared=prepareMinimalMuseHello();
  const proposal=JSON.parse(await readFile('reports/muse-hello-minimal-512-proposal.json','utf8'));
  if(proposal.requestHash!==prepared.requestHash||proposal.reserveMicros!==prepared.reserveMicros||proposal.wirePayload!==prepared.payload)throw new Error('Approved proposal bytes or reservation differ; stop.');
  let result;
  if(stage==='preview')result={stage,prepared,ledger:await readAiUsageSnapshot(config),authorizationCreated:false};
  else{
    const actor=authenticateAiAdministrator(config.get('AI_ADMIN_KEY')??'',process.env.SEO_SPY_AI_ADMIN_TOKEN??'');
    if(values['request-hash']!==prepared.requestHash||maximumMicros!==prepared.reserveMicros)throw new Error('Exact diagnostic request or cost mismatch.');
    const key=config.get('MODEL_API_KEY')??'';
    if(!key.trim()||key.length>1024||/[\r\n]/.test(key))throw new Error('Server-side model credential is not configured.');
    if(stage==='approve'){
      const amendment=await ledger.amendMinimalHelloDiagnostic(actor,{confirmed:true,requestHash:prepared.requestHash,maximumMicros});
      const persisted=await ledger.readHelloAmendment(),state=await ledger.status();
      if(JSON.stringify(persisted)!==JSON.stringify(amendment)||state.development.budgetMicros!==152744||state.development.dailyMicros!==152744||state.development.maxCalls!==4||state.development.calls!==3||state.development.chargedMicros!==144548)throw new Error('Persisted amendment safety check failed.');
      const approval=await ledger.approve(amendment.intentId,actor);
      result={stage,prepared,amendment,intentId:approval.id,expiresAt:approval.expiresAt,ledger:await ledger.status(),originalEntryUnchanged:true,otherPocScopesLocked:true};
    }else{
      const amendment=await ledger.readHelloAmendment(),intent=await ledger.readIntent(values['intent-id']);
      if(!amendment||intent.id!==amendment.intentId||intent.actor!==actor||intent.approvedBy!==actor||intent.requestHash!==prepared.requestHash||intent.scope!==prepared.scope||!intent.approvedAt||intent.consumedAt||Date.parse(intent.expiresAt)<=Date.now())throw new Error('Exact unused diagnostic approval is required; no replay allowed.');
      const runtime=new ConfigService({AI_ENABLED:true,MOCK_AI:false,AI_MODE:'poc',MODEL_API_KEY:key,AI_DEV_BUDGET_MICROS:amendment.after.budgetMicros,AI_DEV_DAILY_MICROS:amendment.after.dailyMicros,AI_DEV_MAX_CALLS:amendment.after.maxCalls,AI_TIMEOUT_MS:60000});
      const transport=app.get(MetaMuseTransport),original=transport.post.bind(transport);
      transport.post=async(...args)=>{if(calls!==0)throw new Error('One diagnostic dispatch only.');calls++;dispatching=true;try{return await original(...args);}finally{dispatching=false;}};
      const report=await new MetaMuseProvider(runtime,transport,ledger).generateHelloDiagnostic({intentId:intent.id,actor,scope:prepared.scope});
      await ledger.readHelloAmendment();
      result={stage,prepared,report,ledger:await ledger.status(),originalEntryUnchanged:true,otherPocScopesLocked:true};
      if(!report.accepted)process.exitCode=1;
    }
  }
  // No prompt, complete wire request, raw reasoning or unfiltered provider body in new receipts/logs.
  const {payload:_payload,...safePrepared}=prepared;void _payload;
  const receipt={...result,prepared:{...safePrepared,processingMode:'standard',reasoningEffort:'minimal',store:false,stream:false,background:false,tools:[],tool_choice:'auto'},metaDispatches:calls,networkRequests:wireRequests,normalDefaults:{MOCK_AI:true,AI_MODE:'mock',AI_ENABLED:false,configuredPocBudgetMicros:Number(config.get('AI_DEV_BUDGET_MICROS')??2000000)}};
  if(output)await writeFile(output,JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt,null,2));
}catch(error){
  const body=typeof error?.getResponse==='function'?error.getResponse():null;
  const candidate=error?.code??body?.code;
  const code=typeof candidate==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(candidate)?candidate:'HELLO_DIAGNOSTIC_FAILED';
  console.error(JSON.stringify({stage,code,metaDispatches:calls,networkRequests:wireRequests,accepted:false,noRetry:true}));process.exitCode=1;
}finally{delete process.env.SEO_SPY_AI_ADMIN_TOKEN;await app.close();}
