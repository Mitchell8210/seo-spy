import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const encode = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
const apiUrl = encode(await readFile(new URL('../src/services/plannerApi.ts',import.meta.url),'utf8'));
const { PlannerApiError, parsePlannerResponse, plannerTasks, requestPlanner } = await import(apiUrl);
const sessionSource = (await readFile(new URL('../src/services/plannerSession.ts',import.meta.url),'utf8')).replace("'./plannerApi'",JSON.stringify(apiUrl));
const { PlannerSession } = await import(encode(sessionSource));
const task = { id:'server-uuid',taskKey:'website:one',title:'One',explanation:'Evidence',guidance:'Original guidance',priority:'Medium',category:'Review',source:'Website',mode:'saved',status:'Needs Action',schedule:null,destination:'/website',notes:null };
const response = (revision=0,businessId='business-a') => ({businessId,revision,preferences:{useWeekends:false},tasks:[{...task}],sources:[{channel:'website',availability:'available',reportIds:['report-a']}]});
const settle = () => new Promise(resolve=>setTimeout(resolve,0));
const deferred = () => { let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}; };
assert.equal(plannerTasks(parsePlannerResponse(response(),'business-a'))[0].id,'website:one');
for (const bad of [ {...response(),businessId:'other'}, {...response(),revision:-1}, {...response(),tasks:[{...task,mode:['saved']}]}, {...response(),tasks:[task,task]}, {...response(),tasks:[{...task,schedule:{day:'2026-02-30',hour:9}}]}, {...response(),tasks:[{...task,destination:'//external'}]} ]) assert.throws(()=>parsePlannerResponse(bad,'business-a'));
console.log('PASS: response validation, strict business scope, identity, enums, calendar dates and safe destinations');

let calls=[];
const gate=deferred();
const session = new PlannerSession('business-a',async(_business,_signal,method='GET',suffix='',body)=>{
  calls.push({method,suffix,body});if(method==='GET')return response();if(calls.length===2)await gate.promise;return response(body.expectedRevision+1);
});
const stop=session.start();await settle();
const first=session.mutate('PATCH','/preferences',{useWeekends:true},'Saved');
const duplicate=session.mutate('PATCH','/preferences',{useWeekends:true},'Saved');
const second=session.mutate('POST','/auto-plan',{weekStart:'2026-11-02'},'Planned');
await settle();assert.equal(calls.length,2);assert.equal(session.getSnapshot().message,'Saving planner changes…');assert.equal(session.getSnapshot().saving,true);
assert.equal(first,duplicate,'Duplicate in-flight submission shares one operation');
gate.resolve();assert.equal(await first,true);assert.equal(await second,true);assert.equal(calls[1].body.expectedRevision,0);assert.equal(calls[2].body.expectedRevision,1);stop();
console.log('PASS: no premature acknowledgement, duplicate click protection and serialized revisions');

calls=[];let fail=true;
const uncertain=new PlannerSession('business-a',async(_b,_s,method='GET',suffix='',body)=>{
  if(method==='GET')return response();calls.push({suffix,body});if(fail){fail=false;throw new PlannerApiError('Save not confirmed',0)}return response(1);
});
uncertain.start();await settle();
assert.equal(await uncertain.mutate('POST','/tasks',{title:'My task'},'Saved'),false);assert.equal(uncertain.getSnapshot().tasks.length,1);
assert.equal(uncertain.getSnapshot().saving,false);assert.doesNotMatch(uncertain.getSnapshot().message,/Saving/);assert.match(uncertain.getSnapshot().message,/not confirmed/);
assert.equal(await uncertain.mutate('POST','/tasks',{title:'My task'},'Saved'),true);assert.deepEqual(calls[0],calls[1],'Uncertain retries preserve mutation ID and original expected revision');
console.log('PASS: ambiguous network saves retain tasks and retry the exact request without duplicates');

const failedRead=new PlannerSession('unavailable',async()=>{throw new PlannerApiError('Offline fixture',0)});
const stopFailedRead=failedRead.start();await settle();
assert.equal(failedRead.getSnapshot().loading,false);assert.doesNotMatch(failedRead.getSnapshot().message,/Loading/);assert.match(failedRead.getSnapshot().message,/could not be loaded/);stopFailedRead();
console.log('PASS: failed loading and saving stop pending messages without claiming success');

calls=[];let reads=0;
const conflict=new PlannerSession('business-a',async(_b,_s,method='GET',suffix='',body)=>{
 calls.push({method,suffix,body});if(method==='GET')return response(reads++ ? 8 : 0);if(body.expectedRevision===0)throw new PlannerApiError('Conflict',409);return response(9);
});
conflict.start();await settle();
assert.equal(await conflict.mutate('PATCH','/tasks/server-uuid',{schedule:{day:'2026-11-03',hour:11}},'Saved'),false);
assert.equal(calls.filter(x=>x.method==='PATCH').length,1,'Conflict does not replay the intent');assert.match(conflict.getSnapshot().error,/entries are kept/);
assert.equal(await conflict.mutate('PATCH','/tasks/server-uuid',{schedule:{day:'2026-11-03',hour:11}},'Saved'),true);assert.equal(calls.at(-1).body.expectedRevision,8);
console.log('PASS: conflicts refetch, retain intent, and require a deliberate retry against the new revision');

const replayResponse={...response(5),planning:{policyVersion:'planner-balanced-v2',range:{start:'2026-11-02',end:'2026-11-30'},scheduledCount:3,remaining:[],overloadedDays:[]}};
const replay=new PlannerSession('business-a',async(_b,_s,method='GET')=>method==='GET'?response():replayResponse);
const stopReplay=replay.start();await settle();
assert.equal(await replay.mutate('POST','/auto-plan',{weekStart:'2026-11-02'},'Saved'),true);
assert.match(replay.getSnapshot().message,/1 task remains unscheduled/);assert.match(replay.getSnapshot().message,/Existing schedules were kept/);assert.match(replay.getSnapshot().message,/through 2026-11-29/);stopReplay();
console.log('PASS: replay summaries use current unscheduled tasks, preserve operation metadata, and explain existing schedules');

const oldRead=deferred();const old=new PlannerSession('old',async()=>oldRead.promise);const dispose=old.start();dispose();
const next=new PlannerSession('next',async()=>response(0,'next'));next.start();await settle();oldRead.resolve(response(40,'old'));await settle();assert.equal(next.getSnapshot().tasks.length,1);assert.equal(old.getSnapshot().tasks.length,0,'Disposed reads cannot publish old business state');
console.log('PASS: business switching ignores stale responses');

const originalFetch=globalThis.fetch;
try {
 let request;
 globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify(response(1)),{status:200,headers:{'content-type':'application/json'}})};
 await requestPlanner('business-a',new AbortController().signal,'PATCH','/preferences',{useWeekends:true,expectedRevision:0,mutationId:'id'});
 assert.equal(request.options.method,'PATCH');assert.equal(request.url,'/api/businesses/business-a/smart-planner/preferences');
 await requestPlanner('business-a',new AbortController().signal,'DELETE','/tasks/custom-id',{confirmed:true,expectedRevision:1,mutationId:'delete-id'});
 assert.equal(request.options.method,'DELETE');assert.equal(request.url,'/api/businesses/business-a/smart-planner/tasks/custom-id');assert.equal(JSON.parse(request.options.body).confirmed,true);
 globalThis.fetch=async()=>{throw Error('network down')};await assert.rejects(()=>requestPlanner('business-a',new AbortController().signal,'POST','/tasks',{}),error=>error.status===0&&/not confirmed/.test(error.message));
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Stale revision'}}),{status:409});await assert.rejects(()=>requestPlanner('business-a',new AbortController().signal),error=>error.status===409);
} finally {globalThis.fetch=originalFetch}
const hook=await readFile(new URL('../src/hooks/useSmartPlanner.ts',import.meta.url),'utf8');assert.doesNotMatch(hook,/readPlannerState|writePlannerState|localStorage/);
console.log('PASS: PATCH transport, network errors, conflict errors and no automatic browser-storage import');
