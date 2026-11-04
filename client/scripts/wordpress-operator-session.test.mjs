import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/services/wordpressFix.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
let moduleNumber = 0
const load = () => import(`data:text/javascript;base64,${Buffer.from(compiled + `\n// isolated test ${moduleNumber++}`).toString('base64')}`)
const business = 'demo-guzman', code = 'a'.repeat(43), csrf = 'c'.repeat(43)
const session = (businessId = business) => ({ connected: true, businessId, csrf, expiresAt: new Date(Date.now() + 20 * 60000).toISOString() })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const browser = () => {
  const location = { origin: 'http://localhost:5173', href: 'http://localhost:5173/dashboard?businessId=demo-guzman', pathname: '/dashboard', search: '?businessId=demo-guzman', hash: '' }
  globalThis.window = { location, history: { replaceState(_state, _unused, url) { const next = new URL(url, location.origin); Object.assign(location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) } }, dispatchEvent() {} }
}
const failure = (code = 'WORDPRESS_BROWSER_SESSION_REQUIRED', message = 'Connect this browser with a fresh one-use operator link.') => json({ error: { code, message } }, 401)
const calls = []
const record = (path, options) => { calls.push({ path: String(path), ...options }); assert.equal(options.credentials, 'same-origin'); assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.Authorization, undefined) }
const noPrivilegedRequests = () => {
  assert.ok(calls.every(call => !/browser-tickets|generations|\/apply|restorations|ai\/admin/.test(call.path)))
  assert.ok(calls.every(call => !JSON.stringify(call).includes('WORDPRESS_OPERATOR_KEY')))
}

test('local saved history, capability and proposal reads need no operator cookie or grant', async () => {
  browser(); calls.length = 0
  globalThis.fetch = async (path, options) => {
    record(path, options); assert.match(String(path), /^\/api\/wordpress\/local\/businesses\/demo-guzman\/fixes\//)
    assert.equal(options.method, 'GET')
    if (String(path).includes('/capability?')) return json({ capability: 'wordpress.media.alt_text.update', fixable: false, evidence: null })
    if (String(path).endsWith('/proposals/saved-proposal')) return json({ id: 'saved-proposal' })
    return json({ items: [] })
  }
  const api = await load()
  assert.deepEqual(await api.wordpressFix.workflows(business), { items: [] })
  assert.equal((await api.fixCapability({ category: 'website', businessId: business, reportId: 'saved-report', findingId: 'saved-finding' })).fixable, false)
  assert.equal((await api.wordpressFix.read(business, 'saved-proposal')).id, 'saved-proposal')
  assert.equal(calls.length, 3); assert.equal(calls.some(call => call.path.includes('browser-session')), false); noPrivilegedRequests()
})

test('same-origin one-use UI redemption loads a saved receipt and survives a module/page refresh', async () => {
  browser(); calls.length = 0
  // Use the actual local immutable receipt when available; CI needs no private reports.
  let saved
  try { saved = JSON.parse(await readFile(new URL('../../server/reports/wordpress-alt-first-application-result.json', import.meta.url), 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    saved = { proposalId: 'offline-proposal', proposalHash: 'a'.repeat(64), stored: { actualAlt: 'Guzman Tax Accounting ofrece ayuda para entender y responder cartas del IRS.' },
      execution: { status: 'applied', verification: 'verified_stored_fields' }, publicVerification: { status: 'public_verified', receipt: {
        id: 'offline-verification', storedFieldMatches: true, status: 'verified', requestedUrl: 'https://example.com/bookkeeping/', observedAlts: [], limitations: [] } } }
  }
  const items = [{ reportId: 'saved-report', findingId: 'saved-finding', evidenceId: 'saved-evidence', workflow: {
    status: 'public_verified', proposal: { id: saved.proposalId, hash: saved.proposalHash, resource: 'media', resourceId: 5659, before: { altText: '' }, changes: { altText: saved.stored.actualAlt }, field: 'alt_text', executionStarted: true, outcome: saved.execution },
    verification: saved.publicVerification, pageUrl: saved.publicVerification.receipt.requestedUrl, approvalRequired: false,
  } }]
  let connected = false
  globalThis.fetch = async (path, options) => {
    record(path, options)
    if (String(path).endsWith('browser-session') && options.method === 'POST') { assert.deepEqual(JSON.parse(options.body), { code }); connected = true; return json(session()) }
    if (String(path).endsWith('browser-session')) return connected ? json(session()) : failure()
    assert.match(String(path), /^\/api\/wordpress\/local\/businesses\/demo-guzman\/fixes\/?$/); return json({ items })
  }
  const api = await load()
  await api.redeemWordPressBrowserTicket(`http://localhost:5173/dashboard?businessId=${business}#wordpress-session=${code}`, business)
  const first = await api.wordpressFix.workflows(business)
  assert.equal(first.items[0].workflow.status, 'public_verified'); assert.equal(first.items[0].workflow.proposal.before.altText, '')
  assert.equal(first.items[0].workflow.proposal.changes.altText, 'Guzman Tax Accounting ofrece ayuda para entender y responder cartas del IRS.')
  connected = false // The next page has no privileged session; saved local results remain readable.
  const sessionChecks = calls.filter(call => call.path.endsWith('browser-session')).length
  const refreshed = await load(), next = await refreshed.wordpressFix.workflows(business)
  assert.equal(next.items[0].workflow.verification.receipt.id, saved.publicVerification.receipt.id)
  assert.equal(calls.filter(call => call.path.endsWith('browser-session')).length, sessionChecks)
  assert.equal(calls.filter(call => call.method === 'POST').length, 1); noPrivilegedRequests()
})

test('malformed, foreign-origin and wrong-business links are rejected before transmitting a ticket', async () => {
  browser(); calls.length = 0
  globalThis.fetch = async (path, options) => { record(path, options); throw new Error('Should not transmit') }
  const api = await load()
  for (const value of ['not-a-ticket', `https://evil.example/dashboard#wordpress-session=${code}`, `http://127.0.0.1:5173/dashboard#wordpress-session=${code}`, `http://localhost:5173/dashboard?businessId=another-business#wordpress-session=${code}`])
    await assert.rejects(api.redeemWordPressBrowserTicket(value, business))
  assert.equal(calls.length, 0)
})

test('expired or replayed one-use code fails and a fresh code can reconnect without a cached rejection', async () => {
  browser(); calls.length = 0
  let connected = false
  globalThis.fetch = async (path, options) => {
    record(path, options)
    if (options.method === 'POST') {
      const incoming = JSON.parse(options.body).code
      if (incoming === code) return failure('WORDPRESS_OPERATOR_TICKET_EXPIRED', 'The one-use operator link is expired or invalid.')
      assert.equal(incoming, 'b'.repeat(43)); connected = true; return json(session())
    }
    return connected ? json(session()) : failure()
  }
  const api = await load()
  await assert.rejects(api.redeemWordPressBrowserTicket(code, business), /expired|invalid/i)
  await api.redeemWordPressBrowserTicket('b'.repeat(43), business)
  assert.equal(calls.filter(call => call.method === 'POST').length, 2); noPrivilegedRequests()
})

test('a ticket for another business cannot establish this business privileged session', async () => {
  browser(); calls.length = 0
  globalThis.fetch = async (path, options) => { record(path, options); return json(session('another-business')) }
  const api = await load()
  await assert.rejects(api.redeemWordPressBrowserTicket(code, business), /business|scope|connect/i)
  assert.equal(calls.some(call => call.path.includes('/fixes')), false); noPrivilegedRequests()
})

test('expired protected mutation requests clear the previously successful session cache', async () => {
  browser(); calls.length = 0
  let expired = false
  globalThis.fetch = async (path, options) => {
    record(path, options)
    if (String(path).endsWith('browser-session')) return expired ? failure() : json(session())
    assert.equal(options.method, 'POST'); assert.match(String(path), /\/businesses\/demo-guzman\/fixes\/proposals$/)
    assert.equal(String(path).includes('/local/'), false); return failure()
  }
  const api = await load()
  await api.connectWordPressBrowser(business); expired = true
  await assert.rejects(api.wordpressFix.propose(business, 'generation', 'human reviewed text'), /connect|operator|session/i)
  await assert.rejects(api.connectWordPressBrowser(business), /connect|operator|session/i)
  assert.equal(calls.filter(call => call.path.endsWith('browser-session')).length, 2)
  noPrivilegedRequests()
})

test('explicit privileged connection rejects an expired or foreign-business browser session', async () => {
  browser(); calls.length = 0
  globalThis.fetch = async (path, options) => { record(path, options); return json({ ...session(), expiresAt: '2020-01-01T00:00:00Z' }) }
  await assert.rejects((await load()).connectWordPressBrowser(business), /expired|session|connect/i)
  assert.equal(calls.some(call => call.path.includes('/fixes')), false)
  calls.length = 0
  globalThis.fetch = async (path, options) => { record(path, options); return json(session('another-business')) }
  await assert.rejects((await load()).connectWordPressBrowser(business), /business|scope|connect/i)
  assert.equal(calls.some(call => call.path.includes('/fixes')), false); noPrivilegedRequests()
})
