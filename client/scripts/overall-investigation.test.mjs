import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BackendApiError } from '../src/services/backendApi.ts'
import { createOverallInvestigationSession } from '../src/services/overallInvestigation.ts'

const businessId = 'selected-business'
function job(status = 'running') {
  return { id: 'overall-one', businessId, websiteReportId: status === 'completed' ? 'website-new' : null,
    facebookReportId: status === 'completed' ? 'facebook-new' : null, assessmentId: status === 'completed' ? 'assessment-new' : null,
    audit: { id: 'overall-one', businessId, scope: 'lighthouse', strategy: 'mobile', mode: 'live', status,
      stage: status === 'running' ? 'collecting_evidence' : status === 'failed' ? 'failed' : 'complete',
      scoringVersion: 'overall-investigation-v1', createdAt: '2026-11-01T00:00:00Z', startedAt: null, completedAt: null,
      warnings: [], failure: status === 'failed' ? { code: 'FACEBOOK_REPORT_FAILED', message: 'Reconnect Facebook.' } : null,
      counts: { findings: 0, recommendations: 0 } } }
}
function harness() {
  const controller = new AbortController()
  let currentJob = null
  let state
  let posts = 0
  let reads = 0
  let createFailure = null
  let statusFailure = null
  let scheduled = null
  const api = {
    dashboard: async () => ({ business: { id: businessId }, latestAudit: null, activeAudit: null }),
    audit: async () => { throw new Error('Unexpected website status request') },
    overallInvestigationStatus: async () => {
      reads++
      if (statusFailure) throw statusFailure
      return { businessId, active: currentJob?.audit.status === 'running' ? currentJob : null, latest: currentJob?.audit.status !== 'running' ? currentJob : null }
    },
    createOverallInvestigation: async () => { posts++; currentJob = job(); if (createFailure) throw createFailure; return currentJob },
  }
  const session = createOverallInvestigationSession(businessId, api, controller.signal, value => { state = value }, callback => {
    scheduled = callback
    return () => { scheduled = null }
  })
  return { api, session, controller, state: () => state, posts: () => posts, reads: () => reads,
    scheduled: () => scheduled, setJob: value => { currentJob = value },
    failCreate: value => { createFailure = value }, failStatus: value => { statusFailure = value } }
}

test('load and refresh read existing status without starting providers', async () => {
  const h = harness()
  await h.session.refresh(); await h.session.refresh()
  assert.equal(h.posts(), 0); assert.equal(h.reads(), 2)
  assert.equal(h.state().audit, null); assert.equal(h.state().loading, false)
})
test('one explicit start and duplicate protection keep overall status running until final assessment', async () => {
  const h = harness(); await h.session.refresh()
  await Promise.all([h.session.start(), h.session.start()]); await h.session.start()
  assert.equal(h.posts(), 1); assert.equal(h.state().audit.status, 'running')
  assert.ok(h.scheduled())
  h.setJob(job('completed')); await h.session.poll()
  assert.equal(h.state().audit.status, 'completed'); assert.equal(h.scheduled(), null)
  assert.equal(h.posts(), 1)
})
test('a lost accepted start response reconciles by status without another POST', async () => {
  const h = harness(); await h.session.refresh()
  h.failCreate(new BackendApiError('Lost response', 'BACKEND_UNREACHABLE', 0))
  await h.session.start()
  assert.equal(h.posts(), 1); assert.equal(h.state().audit.id, 'overall-one'); assert.equal(h.state().error, null)
  await h.session.refresh(); assert.equal(h.posts(), 1)
})
test('an older terminal job cannot masquerade as a recovered failed start', async () => {
  const h = harness(); await h.session.refresh()
  h.api.createOverallInvestigation = async () => {
    h.setJob(job('completed'))
    throw new BackendApiError('The new run was not started.', 'START_FAILED', 503)
  }
  await h.session.start()
  assert.equal(h.state().error.code, 'START_FAILED'); assert.equal(h.posts(), 0)
})
test('an unaccepted start preserves the error and retry remains a read', async () => {
  const h = harness(); await h.session.refresh()
  h.api.createOverallInvestigation = async () => { throw new BackendApiError('Reconnect Facebook.', 'FACEBOOK_RECONNECT_REQUIRED', 400) }
  await h.session.start()
  assert.equal(h.state().error.code, 'FACEBOOK_RECONNECT_REQUIRED')
  await h.session.refresh(); assert.equal(h.state().error, null); assert.equal(h.posts(), 0)
})
test('reload recovers active work without starting another run', async () => {
  const h = harness(); h.setJob(job()); await h.session.refresh()
  assert.equal(h.state().audit.id, 'overall-one'); assert.equal(h.posts(), 0); assert.ok(h.scheduled())
})
test('status failure pauses polling and explicit retry only rechecks existing work', async () => {
  const h = harness(); h.setJob(job()); await h.session.refresh()
  h.failStatus(new BackendApiError('Status unavailable', 'SERVICE_UNAVAILABLE', 503)); await h.session.poll()
  assert.equal(h.state().error.code, 'SERVICE_UNAVAILABLE'); assert.equal(h.scheduled(), null)
  await h.session.start(); assert.equal(h.posts(), 0)
  h.failStatus(null); await h.session.refresh()
  assert.equal(h.state().error, null); assert.ok(h.scheduled()); assert.equal(h.posts(), 0)
})
test('missing status after restart does not restart providers or claim completion', async () => {
  const h = harness(); h.setJob(job()); await h.session.refresh()
  h.setJob(null); await h.session.poll()
  assert.equal(h.state().error.code, 'INVESTIGATION_STATUS_LOST')
  assert.equal(h.state().audit.status, 'running'); assert.equal(h.posts(), 0); assert.equal(h.scheduled(), null)
  await h.session.refresh(); assert.equal(h.state().audit, null); assert.equal(h.state().error, null); assert.equal(h.posts(), 0)
})
test('terminal channel failure retains its actionable existing failure slot', async () => {
  const h = harness(); h.setJob(job('failed')); await h.session.refresh()
  assert.equal(h.state().audit.status, 'failed'); assert.equal(h.state().audit.failure.message, 'Reconnect Facebook.')
  assert.equal(h.posts(), 0); assert.equal(h.scheduled(), null)
})
test('rejects wrong business and completed work missing exact source or assessment references', async () => {
  for (const change of [value => { value.businessId = 'another-business' }, value => { value.audit.businessId = 'another-business' },
    value => { value.assessmentId = null }, value => { value.facebookReportId = null }]) {
    const h = harness(); const value = job('completed'); change(value); h.setJob(value)
    await h.session.refresh(); assert.equal(h.state().error.code, 'INVESTIGATION_MISMATCH'); assert.equal(h.posts(), 0)
  }
})
test('disconnected browser can read historical dashboard but an explicit start still requires its connection', async () => {
  const h = harness(); h.failStatus(new BackendApiError('Reconnect Facebook.', 'FACEBOOK_RECONNECT_REQUIRED', 400))
  await h.session.refresh(); assert.equal(h.state().error, null); assert.equal(h.state().loading, false)
  h.api.createOverallInvestigation = async () => { throw new BackendApiError('Reconnect Facebook.', 'FACEBOOK_RECONNECT_REQUIRED', 400) }
  await h.session.start(); assert.equal(h.state().error.code, 'FACEBOOK_RECONNECT_REQUIRED')
})
test('dispose aborts local updates and never submits work', async () => {
  const h = harness(); await h.session.refresh(); const previous = h.state()
  h.session.dispose(); h.controller.abort(); await h.session.start(); await h.session.refresh()
  assert.equal(h.state(), previous); assert.equal(h.posts(), 0)
})
