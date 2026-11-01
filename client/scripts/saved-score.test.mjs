import assert from 'node:assert/strict'
import { test } from 'node:test'
import { savedChannelScore, scoreCaption } from '../src/services/savedScore.ts'

const fixture = () => ({ businessId: 'business', policyVersion: 'seo-spy-score-v1.2', policyHash: 'a'.repeat(64), profile: 'baseline-mobile-v1', cutoff: '2026-11-01T08:00:00Z', socialScope: 'facebook-profile-readiness',
  sources: [{ businessId: 'business', reportId: 'web', provider: 'website' }, { businessId: 'business', reportId: 'fb', provider: 'facebook' }],
  scores: { website: { value: 78, maximum: 100, availability: 'available' }, social: { value: 100, maximum: 100, availability: 'available' } } })

test('returns saved channel scores and their scope without computing new scores', () => {
  const assessment = fixture()
  assert.equal(savedChannelScore(assessment, 'business', 'web', 'website'), 78)
  assert.equal(savedChannelScore(assessment, 'business', 'fb', 'social'), 100)
  assert.match(scoreCaption(assessment, 'social'), /v1.2 · Facebook profile readiness · Posting activity advisory/)
  assert.match(scoreCaption(assessment, 'website'), /v1.2 · Mobile website health/)
  assessment.scores.social.value = 0
  assert.equal(savedChannelScore(assessment, 'business', 'fb', 'social'), 0)
})

test('accepts the reusable-confirmation policy while still requiring exact assessment source IDs', () => {
  const assessment = fixture(); assessment.policyVersion = 'seo-spy-score-v1.3'
  assert.equal(savedChannelScore(assessment, 'business', 'web', 'website'), 78)
  assert.match(scoreCaption(assessment, 'website'), /v1.3/)
  assert.equal(savedChannelScore(assessment, 'business', 'previous-web', 'website'), null)
})

test('rejects unavailable, mismatched, unsupported and malformed channel scores', () => {
  const changes = [a => { a.businessId = 'other' }, a => { a.sources[1].businessId = 'other' }, a => { a.sources[1].reportId = 'old' }, a => { a.sources[1].provider = 'website' }, a => { a.policyVersion = 'unknown' }, a => { a.policyHash = 'invalid' }, a => { a.scores.social.availability = 'unavailable' }, a => { a.scores.social.value = null }, a => { a.scores.social.value = 100.5 }, a => { a.scores.social.value = 101 }, a => { a.scores.social.value = -1 }, a => { a.scores.social.maximum = 10 }]
  for (const change of changes) { const assessment = fixture(); change(assessment); assert.equal(savedChannelScore(assessment, 'business', 'fb', 'social'), null) }
  assert.equal(savedChannelScore(null, 'business', 'fb', 'social'), null)
})
