// Actual frontend service -> Vite proxy -> protected Nest routes -> mocked WP.
import assert from 'node:assert/strict'
import process from 'node:process'
import console from 'node:console'
import { writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
if (!process.argv.includes('--offline-fixture-confirmed')) throw new Error('Only the separately launched offline fixture is supported.')
const origin = 'http://localhost:5187', nativeFetch = globalThis.fetch
const output = resolve(process.argv.find(value => value.startsWith('--out='))?.slice(6) ?? '../server/reports/fix-workflow-http-result.json')
assert.ok(output.startsWith(resolve('../server/reports') + sep))
const before = await nativeFetch(origin + '/api/fix-fixture/receipts').then(response => response.json())
assert.equal(before.offline, true); assert.equal(before.protectedDatabasesOpened, false); assert.equal(before.modelRequests, 0)
const config = await nativeFetch(origin + '/api/fix-fixture').then(response => response.json())
let cookie = '', networkRequests = 0
globalThis.window = { location: { hash: new URL(config.bootstrap).hash, pathname: '/scripts/fixtures/fix-workflow.html', search: '' }, history: { replaceState() {} } }
globalThis.fetch = async (path, options = {}) => {
  assert.ok(path.startsWith('/api/wordpress/'), 'Only the local protected workflow may be requested')
  networkRequests++
  const response = await nativeFetch(origin + path, { ...options, headers: { ...options.headers, origin, ...(cookie ? { cookie } : {}) }, redirect: 'error' })
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]
  return response
}
try {
  const api = await import('../src/services/wordpressFix.ts')
  const capability = await api.fixCapability(config.review)
  assert.equal(capability.fixable, true)
  const generated = await api.wordpressFix.generate(config.review.businessId, capability.evidence.id, 'Use a concise description; this is an offline fixture.')
  assert.equal(generated.isMock, true)
  const proposal = await api.wordpressFix.propose(config.review.businessId, generated.id, 'A blue calculator')
  assert.equal(proposal.before.altText, '')
  const applied = await api.wordpressFix.apply(config.review.businessId, proposal)
  assert.equal(applied.status, 'applied'); assert.equal(applied.verification, 'verified_stored_fields')
  const verified = await api.wordpressFix.verify(config.review.businessId, proposal.id)
  assert.equal(verified.status, 'public_verified')
  const restoration = await api.wordpressFix.restore(config.review.businessId, proposal.id)
  assert.equal(restoration.restorationOf, proposal.id); assert.equal(restoration.changes.altText, '')
  const restored = await api.wordpressFix.apply(config.review.businessId, restoration)
  assert.equal(restored.status, 'applied')
  const restoredVerified = await api.wordpressFix.verify(config.review.businessId, restoration.id)
  assert.equal(restoredVerified.status, 'public_verified')
  const saved = await api.wordpressFix.read(config.review.businessId, proposal.id)
  assert.deepEqual(saved.outcome, applied)
  const after = await nativeFetch(origin + '/api/fix-fixture/receipts').then(response => response.json())
  assert.equal(after.mockWordPressWrites, before.mockWordPressWrites + 2); assert.equal(after.modelRequests, 0); assert.equal(after.currentAlt, '')
  const result = { scope: 'offline-service-http-integration', browserUIVerified: false, networkRequests, realProviderCalls: 0, protectedDatabasesOpened: false,
    generated, proposal, applied, verified, restoration, restored, restoredVerified, independentlyRead: true, counters: after }
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ proposalId: proposal.id, restorationId: restoration.id, verification: verified.status, restorationVerification: restoredVerified.status, counters: after, browserUIVerified: false }, null, 2))
} finally { globalThis.fetch = nativeFetch; delete globalThis.window }
