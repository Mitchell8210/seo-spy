// Offline candidate workflow: all providers are a local fetch fixture.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/services/wordpressFix.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { wordpressFix, fixGenerationPending } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const businessId = 'offline-business', calls = [], csrf = 'c'.repeat(43)
const target = { mediaId: 7, pageResource: 'pages', pageId: 9, sourceUrl: 'https://example.com/image.png', pageUrl: 'https://example.com/page/', currentAlt: '', modified: '2026-11-02T00:00:00' }
const capability = { capability: 'wordpress.media.alt_text.update', fixable: false, reason: 'Review purpose', evidence: null, writesEnabled: false, limitations: [], liveGenerationAllowed: false }
const candidate = { businessId, reportId: 'report', findingId: 'finding', evidenceId: 'evidence', target, pageTitle: 'Bookkeeping', pageLanguage: 'es', purposeStatus: 'unreviewed', capability, issue: 'Review empty alternative', requiresPurposeConfirmation: true, isMock: false, imageHash: 'a'.repeat(64), imageHashProvenance: 'Saved original content hash' }
const description = 'Gráfico sobre ayuda para entender y responder cartas del IRS.'
let applied = false
globalThis.window = { location: { origin: 'http://localhost:5173', hash: '', pathname: '/dashboard', search: '' }, dispatchEvent() {}, history: { replaceState() {} } }
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null
  calls.push({ url, options, body })
  if (options.method === 'POST') assert.equal(options.headers['x-wordpress-csrf'], csrf)
  let data
  if (url.endsWith('/browser-session')) data = { businessId, csrf, expiresAt: new Date(Date.now() + 86400000).toISOString() }
  else if (url.endsWith('/candidates')) data = { items: applied ? [] : [candidate] }
  else if (url.endsWith('/purpose')) data = { id: 'review', ...body, target }
  else if (url.endsWith('/generations')) { assert.equal(body.requireLive, true); data = { id: 'generation', isMock: false, provider: 'meta', output: { status: 'proposed', altText: 'ayuda para entender y responder cartas del IRS.', reason: 'DESCRIPTION_EXCERPT' } } }
  else if (url.endsWith('/proposals')) data = { id: 'proposal', hash: 'b'.repeat(64), resource: 'media', resourceId: 7, field: 'alt_text', before: { altText: '' }, changes: { altText: body.altText }, expiresAt: new Date(Date.now() + 60000).toISOString(), restorationOf: null }
  else if (url.endsWith('/apply')) { assert.deepEqual(body, { confirmed: true, proposalHash: 'b'.repeat(64) }); applied = true; data = { status: 'applied', verification: 'verified_stored_fields' } }
  else if (url.endsWith('/verifications')) data = { status: 'public_verified', receipt: { id: 'receipt', proposalId: 'proposal', storedFieldMatches: true, status: 'verified', observedAlts: ['Updated human text'], limitations: [] } }
  else throw new Error('Unexpected fixture request')
  return { ok: true, status: 200, json: async () => data }
}
assert.equal((await wordpressFix.candidates(businessId)).items[0].requiresPurposeConfirmation, true)
assert.equal(calls.some(call => call.url.endsWith('/browser-session')), false, 'Saved candidate reads do not require operator connection')
assert.equal(fixGenerationPending(capability, true), true, 'Real evidence never silently uses a mock')
assert.equal(fixGenerationPending({ ...capability, liveGenerationAllowed: true, workflow: { generationApproval: { status: 'pending_approval' } } }, true), true)
assert.equal(fixGenerationPending({ ...capability, liveGenerationAllowed: true, workflow: { generationApproval: { status: 'approved', intentId: 'intent' } } }, true), false)
await wordpressFix.confirmPurpose(businessId, candidate, 'informative', description, 'es', ['ayuda', 'cartas', 'IRS'])
const confirmation = calls.find(call => call.url.endsWith('/purpose')).body
assert.equal(confirmation.verifiedDescription, description); assert.equal(confirmation.confirmed, true)
assert.deepEqual(confirmation.durablePurpose, { originalImageHash: candidate.imageHash, hashProvenance: candidate.imageHashProvenance })
assert.equal(confirmation.mediaId, 7); assert.equal(confirmation.pageId, 9)
const generation = await wordpressFix.generate(businessId, 'review', '', 'intent', true)
const proposal = await wordpressFix.propose(businessId, generation.id, 'Updated human text')
assert.equal(proposal.changes.altText, 'Updated human text')
assert.equal((await wordpressFix.apply(businessId, proposal)).status, 'applied')
assert.equal((await wordpressFix.verify(businessId, proposal.id)).status, 'public_verified')
assert.equal((await wordpressFix.candidates(businessId)).items.length, 0)
assert.equal(calls.filter(call => call.url.endsWith('/apply')).length, 1)
assert.equal(calls.some(call => call.url.includes('browser-tickets')), false)
assert.ok(calls.every(call => call.url.startsWith('/api/wordpress/')))
console.log('Candidate purpose → exact proposal → explicit Apply → verification fixture passed; zero live provider traffic.')
