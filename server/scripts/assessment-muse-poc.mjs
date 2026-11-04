// Local-only staged operator command. Nothing dispatches except explicit execute.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { parseArgs } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// The credential eval launcher already normalizes argv to [node, script, stage, ...].
// Do not let parseArgs infer a different slice merely because Node used --eval.
const {positionals,values}=parseArgs({args:process.argv.slice(2),allowPositionals:true,strict:true,options:{
  'business-id':{type:'string'},'assessment-id':{type:'string'},'request-hash':{type:'string'},'input-hash':{type:'string'},'maximum-micros':{type:'string'},
  'intent-id':{type:'string'},'analysis-id':{type:'string'},reason:{type:'string'},out:{type:'string'},confirmed:{type:'boolean'},'authorize-one-request':{type:'boolean'},poc:{type:'boolean'},
  testing:{type:'boolean'},'selection-version':{type:'string'},'policy-hash':{type:'string'},
}});
const stage=positionals[0],businessId=values['business-id'],assessmentId=values['assessment-id'];
if(positionals.length!==1||!['preview','approve','execute','review',...(values.testing?['activate','benchmark']:[])].includes(stage)||!businessId||!assessmentId)throw new Error('Use a documented operator stage with --business-id and --assessment-id.');
const selectionVersion=values['selection-version']??'v3';
if(!['v3','v4','v5'].includes(selectionVersion)||values['selection-version']&&!values.testing)throw new Error('--selection-version=v3|v4|v5 requires --testing.');
if(values.testing&&selectionVersion!=='v3'&&stage==='activate')throw new Error('V4/v5 reuse the existing testing allocation; do not activate a new one.');
const confirmation={confirmed:values.confirmed===true,requestHash:values['request-hash'],inputHash:values['input-hash'],maximumMicros:Number(values['maximum-micros'])};
if(['approve','execute','activate'].includes(stage)&&(!confirmation.confirmed||!/^[a-f0-9]{64}$/.test(confirmation.requestHash??'')||!/^[a-f0-9]{64}$/.test(confirmation.inputHash??'')||!Number.isSafeInteger(confirmation.maximumMicros)||confirmation.maximumMicros<1))throw new Error('Confirm the exact preview hashes and maximum micros before this stage.');
if(stage==='activate'&&!/^[a-f0-9]{64}$/.test(values['policy-hash']??''))throw new Error('Activation requires explicit confirmation of the testing policy hash.');
if(stage==='execute'&&(!values.poc||!values['intent-id']))throw new Error('Execution requires --poc and an already approved --intent-id.');
if(stage==='approve'&&(!values['authorize-one-request']||!values.reason))throw new Error('Approval requires --authorize-one-request and --reason.');
if(stage==='review'&&!values['analysis-id'])throw new Error('Review requires --analysis-id.');
// Validate artifact location before any authorization or dispatch side effect.
const outputPath=values.out?resolve(values.out):null;
if(outputPath&&!outputPath.startsWith(resolve('reports')+sep))throw new Error('Review artifacts must be inside the ignored server/reports directory.');
if(outputPath&&existsSync(outputPath))throw new Error('Choose a new artifact filename; existing results are never overwritten.');

let networkRequests=0,metaDispatches=0,dispatching=false;
const deny=()=>{throw new Error('External collection/network access is forbidden in this operator command.');};
const nativeHttpsRequest=https.request;
https.request=(...args)=>{
  if(stage!=='execute'||!dispatching||String(args[0])!=='https://api.meta.ai/v1/responses'||networkRequests!==0)return deny();
  networkRequests++;
  return nativeHttpsRequest(...args);
};
https.get=deny;http.request=deny;http.get=deny;globalThis.fetch=deny;syncBuiltinESMExports();
// Always bootstrap the application under normal mock-only gates. The operator's
// private provider configuration enables one approved invocation only in execute.
Object.assign(process.env,{MOCK_AI:'true',AI_MODE:'mock',AI_ENABLED:'false',WORDPRESS_WRITES_ENABLED:'false',LOG_LEVEL:'silent'});
const {NestFactory}=await import('@nestjs/core');
const {ConfigService}=await import('@nestjs/config');
const {AppModule}=await import('../dist/app.module.js');
const {AssessmentPocOperator}=await import('../dist/modules/assessments/assessment-poc.operator.js');
const {AssessmentAnalysisService}=await import('../dist/modules/assessments/assessment-analysis.service.js');
const {AssessmentStore}=await import('../dist/modules/assessments/assessment.store.js');
const {AiUsageStore}=await import('../dist/integrations/ai/ai-usage.store.js');
const {MetaMuseTransport}=await import('../dist/integrations/ai/meta-muse.provider.js');
const app=await NestFactory.createApplicationContext(AppModule,{logger:false,abortOnError:false});
try{
  const config=app.get(ConfigService),transport=app.get(MetaMuseTransport),original=transport.post.bind(transport);
  transport.post=async(...args)=>{
    if(stage!=='execute'||metaDispatches!==0)throw new Error('Only one approved model attempt is permitted.');
    metaDispatches++;dispatching=true;
    try{return await original(...args);}finally{dispatching=false;}
  };
  const Operator=values.testing?(await import('../dist/modules/assessments/assessment-testing.operator.js')).AssessmentTestingOperator:AssessmentPocOperator;
  const operator=new Operator(config,app.get(AssessmentAnalysisService),app.get(AssessmentStore),app.get(AiUsageStore),transport,...(values.testing?[undefined,selectionVersion]:[]));
  const credential=process.env.SEO_SPY_AI_ADMIN_TOKEN??'';
  let result;
  if(stage==='preview')result=values.testing?await operator.previewTesting(businessId,assessmentId):await operator.preview(businessId,assessmentId);
  if(stage==='approve')result=await operator[values.testing?'approveTesting':'approve'](businessId,assessmentId,credential,{...confirmation,authorizeOneRequest:values['authorize-one-request']===true,reason:values.reason});
  if(stage==='execute')result=await operator[values.testing?'executeTesting':'execute'](businessId,assessmentId,credential,values['intent-id'],{...confirmation,poc:values.poc===true});
  if(stage==='activate')result=await operator.activate(businessId,assessmentId,credential,{...confirmation,policyHash:values['policy-hash']});
  if(stage==='benchmark')result=await operator.benchmark(credential);
  if(values.testing&&stage==='execute'&&result.receipt&&!result.receipt.persisted)process.exitCode=1;
  if(stage==='review')result=await operator.review(businessId,assessmentId,credential,values['analysis-id']);
  const output={...result,networkRequests,metaDispatches,normalDevelopmentUnchanged:{MOCK_AI:true,AI_MODE:'mock',AI_ENABLED:false,configuredBudgetMicros:Number(config.get('AI_DEV_BUDGET_MICROS')??2000000)},
    restore:'This process-local allowance ends on exit. Keep normal MOCK_AI=true, AI_MODE=mock, AI_ENABLED=false, AI_DEV_BUDGET_MICROS=0. Never reset the ledger.'};
  console.log(JSON.stringify(output,null,2));
  if(outputPath)await writeFile(outputPath,JSON.stringify(output,null,2),{flag:'wx',mode:0o600});
}catch(error){
  const response=typeof error?.getResponse==='function'?error.getResponse():null;
  const candidate=error?.code??(typeof response==='object'?response?.code:undefined);
  const code=typeof candidate==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(candidate)?candidate:'ASSESSMENT_POC_FAILED';
  console.error(JSON.stringify({stage,code,networkRequests,metaDispatches,accepted:false,message:'The operation did not establish a valid saved result. No retry or fallback was made. Inspect the existing ledger and any saved analysis before further action.'}));
  process.exitCode=1;
}finally{delete process.env.SEO_SPY_AI_ADMIN_TOKEN;await app.close();}
