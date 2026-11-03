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

export type ConnectionPlatform = 'monday' | 'google-calendar' | 'apple-calendar' | 'jira' | 'github' | 'website' | 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'youtube' | 'x' | 'threads' | 'whatsapp' | 'pinterest' | 'snapchat' | 'reddit' | 'search' | 'analytics' | 'shopify' | 'woocommerce' | 'lightspeed' | 'wix' | 'bigcommerce' | 'square' | 'business-profile' | 'google-ads' | 'merchant-center' | 'lighthouse' | 'amazon' | 'ebay' | 'etsy' | 'tiktok-shop' | 'facebook-marketplace'

export interface ConnectionOption {
  id: ConnectionPlatform
  icon: ConnectionPlatform
  state: 'demo-only' | 'connected-demo'
  shortName?: string
  category: 'websites' | 'meta' | 'social' | 'commerce' | 'google' | 'marketplaces'
  name: string
  description: string
  action: 'Add Website' | 'Connect' | 'Preview Tool'
}
