import type { BusinessProfile, ContentTone, FixPreferences, SettingsAsset } from '../types/settings'
import { mockBusiness, mockConnections } from './mockBusiness'

export const mockBusinessProfile: BusinessProfile = {
  name: mockBusiness.name,
  website: mockBusiness.website,
  industry: 'Accounting & Tax Services',
  location: 'Las Vegas, NV, USA',
  description: 'Professional tax and accounting services for individuals and small businesses.',
}

export const mockIndustries = ['Accounting & Tax Services', 'Professional Services', 'Retail', 'Other']
export const mockToneOptions: ContentTone[] = ['Professional', 'Friendly', 'Conversational']
export const mockFixPreferences: FixPreferences = { aiSuggestions: true, requireApproval: true, tone: 'Professional' }

export const mockSettingsAssets: SettingsAsset[] = [
  { id: 'settings-website', kind: 'website', name: 'Website', detail: mockBusiness.website, status: 'Connected', checkedAt: '2026-10-27T17:00:00Z', timeLabel: 'Last checked' },
  { id: 'settings-facebook', kind: 'facebook', name: 'Facebook Page', detail: mockConnections.find((item) => item.platform === 'facebook')!.identity, status: 'Connected', checkedAt: '2026-10-27T17:00:00Z', timeLabel: 'Last synced' },
  { id: 'settings-search', kind: 'search', name: 'Google Search Console', detail: 'Connect to see your Google search performance.', status: 'Coming soon' },
  { id: 'settings-analytics', kind: 'analytics', name: 'Google Analytics (GA4)', detail: 'Connect to see website traffic and visitor behavior.', status: 'Coming soon' },
]
