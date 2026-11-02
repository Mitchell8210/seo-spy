import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = ts.transpileModule(await readFile(new URL('../src/services/plannerTiming.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { dayTaskLayout, timeRange } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const task=(id,hour,minute,duration)=>({id,title:id,status:'Needs Action',category:'Admin',priority:'Medium',source:'Custom',mode:'custom',explanation:'',guidance:'',schedule:{day:'2026-11-02',hour,minute},estimatedDurationMinutes:duration});
const tasks=[task('a',9,30,90),task('b',10,0,30),task('c',11,0,120)];
const layout=dayTaskLayout(tasks,'2026-11-02');
assert.equal(timeRange(tasks[0]),'09:30–11:00');assert.equal(timeRange(tasks[2]),'11:00–13:00');
assert.deepEqual(layout.map(({task,top,height,left,width})=>({id:task.id,top,height,left,width})),[
 {id:'a',top:40,height:116,left:0,width:50},{id:'b',top:80,height:36,left:50,width:50},{id:'c',top:160,height:156,left:0,width:100},
]);
assert.equal(dayTaskLayout(tasks,'2026-11-03').length,0);
console.log('PASS: half-hour start/end labels, proportional durations, visible overlap lanes, adjacent boundaries and day isolation');
