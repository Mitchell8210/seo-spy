// Offline customer flow. Every request below is intercepted; no provider or WordPress traffic.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const serviceSource = await readFile(new URL('../src/services/wordpressFix.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(serviceSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const serviceUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { wordpressFix, fixReviewState, customerFixReady, customerFixApplyReady, customerFixSetupMessage, customerFixWaitMessage, customerFixReviewMessage } = await import(serviceUrl)
const businessId = 'offline-business', csrf = 'c'.repeat(43), calls = []
const target = { mediaId: 5658, pageId: 5652, pageResource: 'pages', sourceUrl: 'https://example.test/image.jpg', pageUrl: 'https://example.test/bookkeeping/', currentAlt: '', modified: '2026-11-02T00:00:00' }
const originalText = 'Ayuda para comprender una carta del IRS.'
const editedText = 'Ayuda para entender y responder cartas del IRS.'
const generation = { id: 'saved-ai', isMock: false, provider: 'meta', output: { status: 'proposed', altText: originalText, reason: 'DESCRIPTION_EXCERPT' } }
const proposal = { id: 'exact-edit', hash: 'a'.repeat(64), resource: 'media', resourceId: 5658, field: 'alt_text', before: { altText: '' }, changes: { altText: editedText }, expiresAt: new Date(Date.now() + 60000).toISOString(), restorationOf: null }
const verification = { status: 'public_verified', receipt: { id: 'receipt', proposalId: proposal.id, storedFieldMatches: true, status: 'verified', limitations: [], observedAlts: [editedText] } }
const capability = { capability: 'wordpress.media.alt_text.update', fixable: true, reason: '', evidence: { id: 'review', expiresAt: '2099-01-01T00:00:00Z', purpose: 'informative', verifiedDescription: 'Ayuda para comprender y responder cartas del IRS.', descriptionProvenance: 'Owner confirmed', target }, writesEnabled: false, limitations: [], customerFixes: { status: 'active', allowWordPressAltApply: true, writeAuthorized: true }, savedGeneration: generation }
const generationOnly = { ...capability, customerFixes: { status: 'active', generationAuthorized: true, allowWordPressAltApply: false, writeAuthorized: false } }
assert.equal(customerFixReady(generationOnly), true, 'Shared frontend AI scope can suggest without authorizing another WordPress target')
assert.equal(customerFixApplyReady(generationOnly), false, 'Broader AI scope never broadens WordPress writes')
let failureCode = '', failureMessage = 'private implementation detail', changedText = false, readFails = false
let applied = false
globalThis.window = { location: { origin: 'http://localhost:5173', hash: '', pathname: '/dashboard', search: '' }, history: { replaceState() {} }, dispatchEvent() {} }
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null
  calls.push({ url, body, options })
  if (options.method === 'POST') assert.equal(options.headers['x-wordpress-csrf'], csrf)
  if (failureCode && url.endsWith('/customer-generations')) return { ok: false, status: 403, json: async () => ({ error: { code: failureCode, message: failureMessage } }) }
  let data
  if (url.endsWith('/browser-session')) data = { businessId, csrf, expiresAt: new Date(Date.now() + 86400000).toISOString() }
  else if (url.endsWith('/customer-generations')) { assert.deepEqual(body, { evidenceId: 'review' }); data = generation }
  else if (url.endsWith('/proposals')) data = { ...proposal, changes: { altText: changedText ? 'Unapproved change' : body.altText } }
  else if (url.endsWith('/customer-apply')) { assert.deepEqual(body, { confirmed: true, proposalHash: proposal.hash }); applied = true; data = { outcome: { status: 'applied', verification: 'verified_stored_fields' }, verification: null } }
  else if (url.endsWith('/verifications')) data = verification
  else if (url.endsWith('/candidates')) data = { items: applied ? [] : [{ target }] }
  else if (url.endsWith('/fixes/')) data = { items: [{ workflow: { status: 'public_verified', proposal, generation, verification } }] }
  else if (url.endsWith(`/proposals/${proposal.id}`)) { if (readFails) throw new Error('Read connection unavailable'); data = { ...proposal, executionStarted: false, outcome: null } }
  else throw new Error(`Unexpected offline fixture request: ${url}`)
  return { ok: true, status: 200, json: async () => data }
}
assert.equal(customerFixReady(capability), true)
assert.equal(customerFixApplyReady(capability), true, 'Scoped write permission does not require the global write gate')
assert.equal(customerFixReady({ ...capability, customerFixes: { status: 'pending_approval', allowWordPressAltApply: false } }), false)
assert.equal(customerFixReady({ ...capability, customerFixes: { status: 'exhausted', allowWordPressAltApply: true, writeAuthorized: true } }), false)
assert.equal(customerFixApplyReady({ ...capability, customerFixes: { status: 'exhausted', allowWordPressAltApply: true, writeAuthorized: true } }), true, 'Last permitted generation remains applicable')
assert.equal(customerFixApplyReady({ ...capability, customerFixes: { status: 'blocked', allowWordPressAltApply: true, writeAuthorized: true } }), false)
assert.equal(customerFixReady({ ...capability, customerFixes: { status: 'blocked', allowWordPressAltApply: true, writeAuthorized: true } }), false)
const mockGeneration = { ...generation, isMock: true }
assert.equal(fixReviewState({ ...capability, savedGeneration: mockGeneration }, true).generation, null, 'Real user action never reuses a saved mock')
assert.equal(fixReviewState({ ...capability, savedGeneration: mockGeneration }, false).generation.isMock, true, 'Explicit offline fixture remains available')
assert.equal((await wordpressFix.customerGenerate(businessId, 'review')).output.altText, originalText)
const exact = await wordpressFix.propose(businessId, generation.id, editedText)
const result = await wordpressFix.customerApply(businessId, exact)
assert.equal(result.outcome.status, 'applied', 'The stored write result returns before public verification')
assert.equal(result.verification, null)
assert.equal(calls.filter(call => call.url.endsWith('/verifications')).length, 0)
assert.equal((await wordpressFix.verify(businessId, exact.id)).status, 'public_verified')
assert.equal((await wordpressFix.candidates(businessId)).items.length, 0, 'Applied item leaves recommendations')
assert.equal((await wordpressFix.workflows(businessId)).items[0].workflow.verification.status, 'public_verified', 'Saved receipt restores on refresh')
assert.equal(generation.output.altText, originalText, 'Original AI output remains distinct from the human edit')
assert.equal(calls.filter(call => call.url.endsWith('/browser-session')).length, 1, 'Existing browser session is reused')
assert.equal(calls.filter(call => call.url.endsWith('/customer-generations')).length, 1)
assert.equal(calls.filter(call => call.url.endsWith('/customer-apply')).length, 1)
assert.ok(calls.every(call => !call.url.includes('intents') && !call.url.includes('approvals') && !call.url.includes('browser-tickets')))
changedText = true
await assert.rejects(wordpressFix.propose(businessId, generation.id, editedText), /did not match/)
for (const code of ['AI_SETUP_REQUIRED', 'WORDPRESS_SETUP_REQUIRED', 'AI_WORDPRESS_ALLOWANCE_EXHAUSTED']) {
  failureCode = code
  await assert.rejects(wordpressFix.customerGenerate(businessId, 'review'), error => error.message === customerFixSetupMessage)
}
for (const code of ['AI_RATE_LIMIT', 'AI_RATE_LIMITED', 'AI_REAL_REQUEST_ACTIVE']) {
  failureCode = code
  await assert.rejects(wordpressFix.customerGenerate(businessId, 'review'), error => error.message === customerFixWaitMessage)
}
failureCode = 'WORDPRESS_FIX_NOT_ELIGIBLE'; failureMessage = 'The reviewed media context expired or the installation changed. Reconfirm evidence.'
await assert.rejects(wordpressFix.customerGenerate(businessId, 'review'), error => error.message === customerFixReviewMessage)
failureCode = ''
assert.equal((await wordpressFix.reconcileFailedApply(businessId, proposal)).executionStarted, false, 'A confirmed undispatched journal can return to review')
readFails = true
const uncertain = await wordpressFix.reconcileFailedApply(businessId, proposal)
assert.equal(uncertain.outcome.status, 'outcome_unknown', 'A failed journal read remains uncertain')
assert.equal(fixReviewState({ ...capability, workflow: { proposal: uncertain } }, true).step, 'confirmed', 'Unknown results cannot offer another Apply')
assert.equal(calls.filter(call => call.url.endsWith('/customer-apply')).length, 1, 'Failures never retry an edit')

// Server render the real component without a browser portal to inspect customer-facing states.
const dialogSource = await readFile(new URL('../src/components/recommendations/FixReviewDialog.tsx', import.meta.url), 'utf8')
let dialogJs = ts.transpileModule(dialogSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
for (const name of ['react/jsx-runtime', 'react', 'lucide-react']) dialogJs = dialogJs.replaceAll(`from '${name}'`, `from '${import.meta.resolve(name)}'`).replaceAll(`from "${name}"`, `from '${import.meta.resolve(name)}'`)
dialogJs = dialogJs.replace(/import \{ createPortal \} from ['"]react-dom['"];?/, 'const createPortal = value => value;')
dialogJs = dialogJs.replace(/from ['"]\.\.\/\.\.\/services\/wordpressFix['"]/, `from '${serviceUrl}'`)
const { FixReviewDialog } = await import(`data:text/javascript;base64,${Buffer.from(dialogJs).toString('base64')}`)
globalThis.document = { body: {} }
const review = { id: 'finding', title: 'Image alternative', category: 'website', businessId, explanation: 'Informative image with empty alt.', source: 'Saved evidence', isMock: false }
const candidate = { businessId, reportId: 'report', findingId: 'finding', target, pageTitle: 'Bookkeeping', pageLanguage: 'es', capability, requiresPurposeConfirmation: false, isMock: false }
const html = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability, candidate, onClose() {} }))
assert.match(html, /Approve &amp; Apply/)
assert.match(html, /Proposed alt text/)
assert.match(html, /1\. Review/)
assert.match(html, /2\. Apply/)
assert.match(html, /3\. Verify/)
assert.doesNotMatch(html, /Continue to confirmation|administrator approval|Proposal:|Hash:|checkbox|Generate AI proposal/)
const completed = { ...capability, fixable: false, workflow: { status: 'public_verified', proposal: { ...proposal, outcome: { status: 'applied' }, executionStarted: true }, generation, verification } }
const done = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: completed, candidate, onClose() {} }))
assert.match(done, /Verified in WordPress and public page/)
assert.match(done, /Ayuda para entender y responder cartas del IRS\./)
assert.match(done, /View affected page/)
assert.doesNotMatch(done, /Approve &amp; Apply|Generate AI proposal/)
const historicalMock = { ...completed, workflow: { ...completed.workflow, generation: mockGeneration } }
assert.equal(fixReviewState(historicalMock, true).generation.isMock, true, 'Completed historical receipts retain original provenance')
const savedMock = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: { ...capability, savedGeneration: mockGeneration }, candidate, onClose() {} }))
assert.doesNotMatch(savedMock, /Mock AI suggestion|Proposed alt text/, 'Real recommendation ignores old mock output and awaits real authorized generation')
const uncertainHtml = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: { ...capability, workflow: { proposal: uncertain } }, candidate, onClose() {} }))
assert.match(uncertainHtml, /The result is uncertain/)
assert.doesNotMatch(uncertainHtml, /Approve &amp; Apply/)
const unavailable = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: { ...capability, customerFixes: { status: 'pending_approval', allowWordPressAltApply: false } }, candidate, onClose() {} }))
assert.match(unavailable, /AI fixes need the one-time account setup/)
const abstained = { ...generation, output: { status: 'insufficient_evidence', altText: null, reason: 'INSUFFICIENT_CONTEXT' } }
const needsContext = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: { ...capability, savedGeneration: abstained,
  evidence: { ...capability.evidence, verifiedDescription: 'Taxes', proposalContext: { language: 'es', requiredTerms: ['Taxes'] } } }, candidate, onClose() {} }))
assert.match(needsContext, /Review image purpose/)
assert.match(needsContext, /Confirm image purpose/)
assert.match(needsContext, />Taxes<\/textarea>/)
assert.doesNotMatch(needsContext, /Proposed alt text/)
const automaticContext = renderToStaticMarkup(createElement(FixReviewDialog, { review, capability: { ...capability, customerGenerationPolicy: 'page-context-v1', savedGeneration: abstained }, candidate, onClose() {} }))
assert.doesNotMatch(automaticContext, /Confirm image purpose|at least six Spanish words/, 'Saved page context replaces the obsolete one-word-description abstention on a new opening')
console.log('Customer Review → exact edited Apply → automatic verification, persistence, setup gates, and modal states passed; all network calls mocked.')
