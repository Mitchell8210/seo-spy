export interface BusinessProfile {
  name: string
  website: string
  industry: string
  location: string
  description: string
}

export type ContentTone = 'Professional' | 'Friendly' | 'Conversational'

export interface FixPreferences {
  aiSuggestions: boolean
  requireApproval: boolean
  tone: ContentTone
}

export interface SettingsAsset {
  id: string
  kind: 'website' | 'facebook' | 'search' | 'analytics'
  name: string
  detail: string
  status: 'Connected' | 'Coming soon'
  checkedAt?: string
  timeLabel?: string
}

export interface ConnectionOption {
  id: 'website' | 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'youtube' | 'x' | 'threads' | 'whatsapp' | 'pinterest' | 'snapchat' | 'reddit' | 'search' | 'analytics'
  category: 'websites' | 'meta' | 'social' | 'google'
  name: string
  description: string
  action: 'Add Website' | 'Connect'
}
