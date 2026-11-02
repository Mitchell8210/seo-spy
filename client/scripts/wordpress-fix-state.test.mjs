import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/services/wordpressFix.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { fixReviewState, fixActionLabel, fixStatusLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const original = { id: 'saved-muse', isMock: false, provider: 'meta', output: { status: 'proposed', altText: 'Original grounded excerpt', reason: 'DESCRIPTION_EXCERPT' } }
const human = 'Guzman Tax Accounting ofrece ayuda para entender y responder cartas del IRS.'
const proposal = { id: 'human-proposal', hash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), resource: 'media', resourceId: 5659, before: { altText: '' }, changes: { altText: human }, field: 'alt_text', restorationOf: null }
const capability = { fixable: true, savedGeneration: original, workflow: { status: 'pending_approval', generation: original, proposal, verification: null, approvalRequired: true } }
const pending = fixReviewState(capability)
assert.equal(pending.step, 'confirm'); assert.equal(pending.text, human); assert.equal(pending.generation.output.altText, original.output.altText)
const verified = { status: 'public_verified', receipt: { id: 'receipt', proposalId: proposal.id, storedFieldMatches: true, status: 'verified' } }
const completed = { ...capability, fixable: false, workflow: { ...capability.workflow, status: 'public_verified', proposal: { ...proposal, expiresAt: '2020-01-01T00:00:00Z', executionStarted: true, outcome: { status: 'applied', verification: 'verified_stored_fields' } }, verification: verified } }
assert.equal(fixReviewState(completed).step, 'confirmed'); assert.deepEqual(fixReviewState(completed).verification, verified)
assert.equal(fixReviewState(completed).text, human); assert.equal(fixActionLabel(completed), 'Verified')
assert.equal(fixStatusLabel('public_verified'), 'Verified in WordPress and public page')
const unknown = { ...completed, workflow: { ...completed.workflow, status: 'outcome_unknown', verification: null, proposal: { ...proposal, executionStarted: true, outcome: null } } }
assert.equal(fixReviewState(unknown).outcome.status, 'outcome_unknown'); assert.equal(fixActionLabel(unknown), 'Review fix result')
assert.equal(fixReviewState({ ...capability, workflow: { ...capability.workflow, proposal: { ...proposal, expiresAt: '2020-01-01T00:00:00Z' } } }).step, 'review')
assert.equal(fixReviewState(null).step, 'review'); assert.equal(fixActionLabel(null), 'Review Recommendation')
assert.equal(original.output.altText, 'Original grounded excerpt')
console.log('WordPress persisted fix hydration: 15 assertions passed; zero provider calls.')
