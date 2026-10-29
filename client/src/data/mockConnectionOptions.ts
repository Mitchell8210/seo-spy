import type { ConnectionOption } from '../types/settings'

// Product-preview options only. Selecting one never creates a connected asset.
export const mockConnectionOptions: ConnectionOption[] = [
  { id: 'website', category: 'websites', name: 'Website', description: 'Add another business website for SEO Spy to analyze.', action: 'Add Website' },
  { id: 'facebook', category: 'meta', name: 'Facebook', description: 'Connect a Facebook Page', action: 'Connect' },
  { id: 'instagram', category: 'meta', name: 'Instagram', description: 'Connect an Instagram business account', action: 'Connect' },
  { id: 'threads', category: 'meta', name: 'Threads', description: 'Connect a Threads business presence.', action: 'Connect' },
  { id: 'whatsapp', category: 'meta', name: 'WhatsApp Business', description: 'Connect a WhatsApp Business account.', action: 'Connect' },
  { id: 'tiktok', category: 'social', name: 'TikTok', description: 'Connect a TikTok business account', action: 'Connect' },
  { id: 'linkedin', category: 'social', name: 'LinkedIn', description: 'Connect a LinkedIn company page', action: 'Connect' },
  { id: 'youtube', category: 'social', name: 'YouTube', description: 'Connect a YouTube channel', action: 'Connect' },
  { id: 'x', category: 'social', name: 'X / Twitter', description: 'Connect an X business account', action: 'Connect' },
  { id: 'pinterest', category: 'social', name: 'Pinterest', description: 'Connect a Pinterest business account.', action: 'Connect' },
  { id: 'snapchat', category: 'social', name: 'Snapchat', description: 'Connect a Snapchat business account.', action: 'Connect' },
  { id: 'reddit', category: 'social', name: 'Reddit', description: 'Connect a Reddit business presence.', action: 'Connect' },
  { id: 'search', category: 'google', name: 'Google Search Console', description: 'See how customers find your website in Google Search.', action: 'Connect' },
  { id: 'analytics', category: 'google', name: 'Google Analytics (GA4)', description: 'See website traffic and visitor behavior.', action: 'Connect' },
]
