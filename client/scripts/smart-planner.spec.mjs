import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const copy = ts.transpileModule(await readFile(new URL('../src/services/dashboardOpportunityCopy.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const copyUrl = `data:text/javascript;base64,${Buffer.from(copy).toString('base64')}`;
const source = (await readFile(new URL('../src/services/smartPlanner.ts', import.meta.url), 'utf8')).replace("'./dashboardOpportunityCopy'", JSON.stringify(copyUrl));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { autoSchedule, dateKey, mondayOf, weekDays, isWeekend, weeklyCompletion, reconcileRescan, visibleTasks, tasksFromIssues } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const monday = mondayOf(new Date(2026, 10, 4, 12));
assert.equal(dateKey(monday), '2026-11-02');
assert.equal(weekDays(monday, false).length, 5); assert.equal(weekDays(monday, true).length, 7);
assert.equal(isWeekend('2026-11-08'), true); assert.equal(isWeekend('2026-11-02'), false);
const task = (id, priority = 'Medium', category = 'Search') => ({ id, title:id, priority, category, status:'Needs Action', mode:'demo', source:'Website', explanation:'Existing evidence', guidance:'Existing guidance' });
const tasks = [task('hours','Urgent','Admin'), task('phone','Medium','Admin'), task('images','Urgent','Content'), task('meta','Low'), task('social','Medium','Social')];
const scheduled = autoSchedule(tasks, monday, false);
assert.deepEqual(autoSchedule(tasks, monday, false), scheduled, 'Scheduling is deterministic.');
assert.equal(scheduled.hours.day, '2026-11-02');
assert.equal(scheduled.phone.day, '2026-11-02');
assert.ok(scheduled.images.day <= scheduled.meta.day, 'Urgent work is earlier than low-priority work.');
assert.ok(Object.values(scheduled).every(slot => !isWeekend(slot.day)));
assert.equal(new Set(Object.values(scheduled).map(slot => `${slot.day}:${slot.hour}`)).size, tasks.length);
const fixed = { ...tasks[0], schedule: {day:'2026-11-03',hour:11} };
assert.equal(autoSchedule([fixed, ...tasks.slice(1)], monday, false).hours, undefined, 'Existing schedules are kept.');
const crowded = Array.from({length:45},(_,i)=>task(`task-${i}`));
assert.equal(Object.keys(autoSchedule(crowded, monday, false)).length,40, 'Bounded business hours cannot be overfilled.');
assert.equal(Object.keys(autoSchedule(crowded, monday, true)).length,45, 'Enabled weekends provide more capacity.');
const weekly = [{...task('one'),status:'Done',schedule:{day:'2026-11-02',hour:9}}, {...task('two'),schedule:{day:'2026-11-03',hour:9}}, {...task('later'),status:'Done',schedule:{day:'2026-11-09',hour:9}}];
assert.deepEqual(weeklyCompletion(weekly,monday), {done:1,total:2,percent:50});
assert.deepEqual(weeklyCompletion([],monday), {done:0,total:0,percent:0});
const state = {edits:{hours:{status:'Done'},social:{status:'Done'}},completed:{hours:{...tasks[0],status:'Done'}},custom:[],useWeekends:false};
assert.equal(reconcileRescan(state,tasks,true).edits.hours.status,'Needs Action');
assert.equal(reconcileRescan(state,tasks,true).edits.social.status,'Needs Action');
const saved = {...task('social'),mode:'saved'};
assert.equal(reconcileRescan(state,[saved],false).edits.social.status,'Done','A failed saved-report refresh cannot reopen its tasks.');
assert.equal(visibleTasks([],state)[0].status,'Done','Resolved source tasks remain completed.');
const mapped = tasksFromIssues([{id:'f',category:'social',severity:'Critical',status:'needs_review',source:'Facebook',mode:'saved',title:'Real saved finding',explanation:'Existing evidence',destination:'/social-media',recommendation:{id:'r',title:'Existing recommended action',explanation:'Use existing steps',status:'needs_review'}}]);
assert.equal(mapped[0].mode,'saved');assert.equal(mapped[0].title,'Existing recommended action');assert.equal(mapped[0].guidance,'Use existing steps');
console.log('PASS: source mapping, deterministic balanced scheduling, Monday preference, weekends, capacity, existing schedules, weekly completion, and source-aware re-scan');

const persistenceJs = ts.transpileModule(await readFile(new URL('../src/services/plannerPersistence.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { plannerStorageKey, emptyPlannerState, readPlannerState, writePlannerState, reconcilePlannerState } = await import(`data:text/javascript;base64,${Buffer.from(persistenceJs).toString('base64')}`);
const entries = new Map([['unrelated-key','keep me']]);
const storage = {getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};
const business = 'business-a', key = plannerStorageKey(business);
const customTask = {...task('custom:00000000-0000-4000-8000-000000000003'),mode:'custom',schedule:{day:'2026-11-03',hour:10},notes:'My work'};
const sourceTask = {...task('social:saved'),mode:'saved'};
const persisted = {edits:{'website:images':{schedule:{day:'2026-11-04',hour:10}},'social:saved':{status:'Done',schedule:{day:'2026-11-05',hour:13}}},completed:{'social:saved':{...sourceTask,status:'Done'}},custom:[customTask],useWeekends:true};
assert.equal(writePlannerState(business,persisted,storage),true);
assert.deepEqual(readPlannerState(business,storage),persisted);
assert.deepEqual(readPlannerState('business-b',storage),emptyPlannerState(),'Businesses have isolated keys');
assert.deepEqual(Object.keys(JSON.parse(entries.get(key))).sort(),['businessId','completed','custom','edits','useWeekends','version']);
assert.equal(entries.get('unrelated-key'),'keep me');
const encoded = entries.get(key);
for (const bad of ['{bad json',JSON.stringify({...JSON.parse(encoded),version:2}),JSON.stringify({...JSON.parse(encoded),businessId:'different'}),JSON.stringify({...JSON.parse(encoded),useWeekends:'yes'}),JSON.stringify({...JSON.parse(encoded),edits:{'website:bad':{schedule:{day:'2026-02-30',hour:9}}}}),JSON.stringify({...JSON.parse(encoded),edits:{'website:bad':{schedule:{day:'2026-11-04',hour:25}}}}),JSON.stringify({...JSON.parse(encoded),custom:[{...customTask,priority:['Urgent']}]}),JSON.stringify({...JSON.parse(encoded),custom:[customTask,customTask]})]) {
 entries.set(key,bad);assert.deepEqual(readPlannerState(business,storage),emptyPlannerState());assert.equal(entries.get('unrelated-key'),'keep me');
}
const unavailable = {getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('quota')}};
assert.deepEqual(readPlannerState(business,unavailable),emptyPlannerState());
assert.equal(writePlannerState(business,persisted,unavailable),false);
const stale = {...persisted,edits:{...persisted.edits,'social:active':{schedule:{day:'2026-11-03',hour:9}},'website:obsolete':{schedule:{day:'2026-11-02',hour:9}}}};
const loading = reconcilePlannerState(stale,[],false);
assert.ok(loading.edits['social:active'],'Loading/failed Facebook reads retain assignments');
assert.equal(loading.edits['website:obsolete'],undefined);
const loaded = reconcilePlannerState(stale,[{...task('website:images')}],true);
assert.equal(loaded.edits['social:active'],undefined,'A successful source read prunes vanished active assignments');
assert.ok(loaded.completed['social:saved'],'Completed history remains');
assert.deepEqual(loaded.custom,persisted.custom);
assert.equal(visibleTasks([{...task('website:new')}],loaded).find(item=>item.id==='website:new').schedule,undefined);
const reopened = {...persisted,edits:{'social:saved':{status:'Needs Action'}}};
assert.equal(reconcilePlannerState(reopened,[],true).completed['social:saved'],undefined,'Stale reopened snapshots must not resurrect active recommendations');
assert.ok(reconcilePlannerState(reopened,[],false).completed['social:saved'],'Do not prune on Facebook failure');
console.log('PASS: versioned business storage, schema validation, invalid dates/types, malformed JSON, isolation, storage failures, source-ready reconciliation, custom tasks, and completed history');

const hiddenWeekend = {...persisted,useWeekends:false,edits:{'social:hidden':{schedule:{day:'2026-11-07',hour:10}}}};
const weekendsOff = reconcilePlannerState(hiddenWeekend,[],false);
assert.equal(weekendsOff.edits['social:hidden'].schedule,null,'Disabling weekends unschedules stored assignments even while their source is unavailable');
assert.equal(writePlannerState(business,weekendsOff,storage),true);
assert.equal(readPlannerState(business,storage).useWeekends,false);

// Saved Website snapshots are legitimate source tasks after the saved-report integration.
for (const id of ['website:image-alt','social:report-finding','consistency:reported-check']) {
 for (const mode of ['demo','saved']) {
  const completedTask = {...task(id),mode,status:'Done',schedule:{day:'2026-11-04',hour:10}};
  const roundTrip = {edits:{[id]:{status:'Done',schedule:completedTask.schedule}},completed:{[id]:completedTask},custom:[customTask],useWeekends:false};
  assert.equal(writePlannerState(business,roundTrip,storage),true,`${id} accepts ${mode}`);
  assert.deepEqual(readPlannerState(business,storage),roundTrip,`${id} restores ${mode}, Done, schedule, and custom tasks`);
 }
}
for (const mode of ['unknown','live','custom','__proto__','toString',null,42,['saved']]) {
 const snapshot = {...task('website:image-alt'),mode,status:'Done'};
 const invalid = {edits:{},completed:{[snapshot.id]:snapshot},custom:[],useWeekends:false};
 assert.equal(writePlannerState(business,invalid,storage),false,'Invalid or custom modes cannot enter source history');
 entries.set(key,JSON.stringify({version:1,businessId:business,...invalid}));
 assert.deepEqual(readPlannerState(business,storage),emptyPlannerState(),'Invalid source modes safely reset on read');
}
for (const mode of ['unknown','demo','saved']) {
 const invalid = {...persisted,custom:[{...customTask,mode}]};
 assert.equal(writePlannerState(business,invalid,storage),false,'Custom tasks must retain custom mode');
 entries.set(key,JSON.stringify({version:1,businessId:business,...invalid}));
 assert.deepEqual(readPlannerState(business,storage),emptyPlannerState());
}
console.log('PASS: saved Website completion round-trip, typed source modes, custom-only task modes, and rejection of unknown/malformed modes on read/write');

const websiteSaved = {...task('website:image-alt'),mode:'saved'};
const websiteChoices = {edits:{[websiteSaved.id]:{schedule:{day:'2026-11-04',hour:10}},'social:waiting':{schedule:{day:'2026-11-05',hour:11}}},completed:{},custom:[customTask],useWeekends:false};
assert.equal(writePlannerState(business,websiteChoices,storage),true);
const restoredWebsite = readPlannerState(business,storage);
for (const phase of ['loading','error','unavailable']) {
 const waiting = reconcilePlannerState(restoredWebsite,[],false,false);
 assert.deepEqual(waiting.edits[websiteSaved.id].schedule,websiteChoices.edits[websiteSaved.id].schedule,`${phase} keeps Website assignment`);
 assert.deepEqual(waiting.edits['social:waiting'],websiteChoices.edits['social:waiting'],'Social loading protection unchanged');
 assert.deepEqual(waiting.custom,[customTask],'Custom tasks independent of source readiness');
 assert.equal(writePlannerState(business,waiting,storage),true);
 assert.deepEqual(readPlannerState(business,storage).edits[websiteSaved.id],websiteChoices.edits[websiteSaved.id]);
}
const websiteLoaded = reconcilePlannerState(restoredWebsite,[websiteSaved],false,true);
assert.deepEqual(websiteLoaded.edits[websiteSaved.id].schedule,websiteChoices.edits[websiteSaved.id].schedule,'Successful read retains matching assignment');
const websiteGone = reconcilePlannerState(websiteLoaded,[],false,true);
assert.equal(websiteGone.edits[websiteSaved.id],undefined,'Authoritative absent finding prunes stale active state');
assert.deepEqual(websiteGone.edits['social:waiting'],websiteChoices.edits['social:waiting']);
assert.deepEqual(websiteGone.custom,[customTask]);
const pendingCompletion = {...websiteChoices,edits:{[websiteSaved.id]:{status:'Done',schedule:websiteChoices.edits[websiteSaved.id].schedule}},completed:{[websiteSaved.id]:{...websiteSaved,status:'Done'}}};
assert.deepEqual(reconcilePlannerState(pendingCompletion,[],true,false),pendingCompletion,'Pending Website read preserves status, schedule, and completion snapshot');
assert.deepEqual(reconcilePlannerState(pendingCompletion,[],true,true),pendingCompletion,'Completed history remains after authoritative source absence');
console.log('PASS: Website loading/error/unavailable protects persisted schedule/status/history, successful reads retain matches and prune stale active state, Social/custom behavior unchanged');
