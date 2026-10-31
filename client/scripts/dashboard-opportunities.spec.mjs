// Pure selection regressions; no API/provider calls or source writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/services/dashboardOpportunities.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { selectDashboardOpportunities: select, opportunityDestination: destination } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const issue = (id, category = 'website', severity = 'Medium', status = 'Needs review') => ({ id, category, severity, status,
  title: id, explanation: 'Existing evidence', source: category, mode: 'demo', destination: destination(category, 'business'),
  recommendation: { id: `${id}-action`, title: `Review ${id}`, explanation: 'Existing action', status: 'needs_review' } });
const input = [issue('low', 'website', 'Low'), issue('urgent', 'website', 'Critical'), issue('second'), issue('third'),
  issue('done', 'website', 'Critical', 'Verified'), issue('resolved', 'social', 'Critical', 'resolved'), issue('passed', 'consistency', 'Low', 'Passed')];
const original = JSON.stringify(input);
let result = select(input);
assert.deepEqual(result.top.website.map(item => item.id), ['urgent', 'second', 'third']);
assert.deepEqual(result.remaining.map(item => item.id), ['low']);
assert.deepEqual(result.path.map(item => item.id), ['low']);
assert.equal(JSON.stringify(input), original, 'Selection must not mutate source data.');
result = select(input.map(item => item.id === 'low' ? { ...item, severity: 'Critical' } : item));
assert.ok(result.top.website.some(item => item.id === 'low'));
assert.ok(!result.remaining.some(item => item.id === 'low'), 'Promotion removes the bottom opportunity and its action.');
result = select(input.map(item => item.id === 'urgent' ? { ...item, status: 'verified' } : item));
assert.deepEqual(result.remaining, [], 'Next active opportunity takes the verified item’s triage place.');
result = select([issue('a'), issue('b'), issue('c'), issue('pending', 'website', 'Low', 'pending_verification')]);
assert.deepEqual(result.remaining.map(item => item.id), ['pending'], 'Action taken is not verification.');
result = select([issue('a'), issue('b'), issue('c'), { ...issue('no-action', 'website', 'Low'), recommendation: undefined }]);
assert.equal(result.remaining.length, 1);
assert.equal(result.path.length, 0, 'No invented recommendation when the source has none.');
result = select([issue('a'), issue('b'), issue('c'), { ...issue('action-done', 'website', 'Low'), recommendation: { ...issue('x').recommendation, status: 'resolved' } }]);
assert.equal(result.path.length, 0, 'Resolved actions are not recommended again.');
assert.equal(destination('website', 'business'), '/website');
assert.equal(destination('social', 'business'), '/social-media?businessId=business');
assert.equal(destination('consistency', 'business'), '/dashboard#consistency-details');
assert.deepEqual(select([]).remaining, []);
console.log('PASS: triage exclusion, stable priority, immutable input, promotion, verified/resolved/passed filtering, pending verification, linked actions only, and existing destinations');

const copySource = await readFile(new URL('../src/services/dashboardOpportunityCopy.ts', import.meta.url), 'utf8');
const copyCompiled = ts.transpileModule(copySource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { opportunityTitle } = await import(`data:text/javascript;base64,${Buffer.from(copyCompiled).toString('base64')}`);
assert.equal(opportunityTitle('Saved profile opportunity 3', 'Two collected posts have different phone numbers.'), 'Contact information may be inconsistent');
assert.equal(opportunityTitle('Confirm your public contact number', 'Two phone numbers differ.'), 'Confirm your public contact number');
assert.equal(opportunityTitle('Opportunity 4', 'The profile description is missing.'), 'The profile description is missing.');
console.log('PASS: placeholder labels are replaced using evidence; valid user-facing titles are preserved');
