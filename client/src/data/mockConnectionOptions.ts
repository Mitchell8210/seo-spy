import type { ConnectionOption } from '../types/settings'

// Product-preview options only. Selecting one never creates a connected asset.
export const mockConnectionOptions: ConnectionOption[] = [
  { id: 'website', icon: 'website', state: 'demo-only', category: 'websites', name: 'Website', description: 'Add another business website for SEO Spy to analyze.', action: 'Add Website' },
  { id: 'facebook', icon: 'facebook', state: 'connected-demo', category: 'meta', name: 'Facebook', description: 'Connect a Facebook Page', action: 'Connect' },
  { id: 'instagram', icon: 'instagram', state: 'demo-only', category: 'meta', name: 'Instagram', description: 'Connect an Instagram business account', action: 'Connect' },
  { id: 'threads', icon: 'threads', state: 'demo-only', category: 'meta', name: 'Threads', description: 'Connect a Threads business presence.', action: 'Connect' },
  { id: 'whatsapp', shortName: 'WhatsApp', icon: 'whatsapp', state: 'demo-only', category: 'meta', name: 'WhatsApp Business', description: 'Connect a WhatsApp Business account.', action: 'Connect' },
  { id: 'tiktok', icon: 'tiktok', state: 'demo-only', category: 'social', name: 'TikTok', description: 'Connect a TikTok business account', action: 'Connect' },
  { id: 'linkedin', icon: 'linkedin', state: 'demo-only', category: 'social', name: 'LinkedIn', description: 'Connect a LinkedIn company page', action: 'Connect' },
  { id: 'youtube', icon: 'youtube', state: 'demo-only', category: 'social', name: 'YouTube', description: 'Connect a YouTube channel', action: 'Connect' },
  { id: 'x', shortName: 'X', icon: 'x', state: 'demo-only', category: 'social', name: 'X / Twitter', description: 'Connect an X business account', action: 'Connect' },
  { id: 'pinterest', icon: 'pinterest', state: 'demo-only', category: 'social', name: 'Pinterest', description: 'Connect a Pinterest business account.', action: 'Connect' },
  { id: 'snapchat', icon: 'snapchat', state: 'demo-only', category: 'social', name: 'Snapchat', description: 'Connect a Snapchat business account.', action: 'Connect' },
  { id: 'reddit', icon: 'reddit', state: 'demo-only', category: 'social', name: 'Reddit', description: 'Connect a Reddit business presence.', action: 'Connect' },
  ...(['shopify', 'woocommerce', 'lightspeed', 'wix', 'bigcommerce', 'square'] as const).map((id, index): ConnectionOption => ({
    id, icon: id, state: 'demo-only', category: 'commerce',
    name: ['Shopify', 'WooCommerce', 'Lightspeed', 'Wix', 'BigCommerce', 'Square'][index],
    description: `Connect your ${['Shopify', 'WooCommerce', 'Lightspeed', 'Wix', 'BigCommerce', 'Square'][index]} store.`, action: 'Connect',
  })),
  { id: 'search', icon: 'search', state: 'demo-only', category: 'google', name: 'Google Search Console', description: 'See how customers find your website in Google Search.', action: 'Connect' },
  { id: 'analytics', shortName: 'Google Analytics', icon: 'analytics', state: 'demo-only', category: 'google', name: 'Google Analytics (GA4)', description: 'See website traffic and visitor behavior.', action: 'Connect' },
  { id: 'business-profile', icon: 'business-profile', state: 'demo-only', category: 'google', name: 'Google Business Profile', description: 'Review how your business appears on Google.', action: 'Connect' },
  { id: 'google-ads', icon: 'google-ads', state: 'demo-only', category: 'google', name: 'Google Ads', description: 'Bring your advertising visibility into one place.', action: 'Connect' },
  { id: 'merchant-center', icon: 'merchant-center', state: 'demo-only', category: 'google', name: 'Google Merchant Center', description: 'Review your store’s product visibility on Google.', action: 'Connect' },
  { id: 'lighthouse', icon: 'lighthouse', state: 'demo-only', category: 'google', name: 'Lighthouse', description: 'Preview Lighthouse website analysis. No account authorization is required.', action: 'Preview Tool' },
  ...([['monday', 'monday.com'], ['google-calendar', 'Google Calendar'], ['apple-calendar', 'Apple Calendar'], ['jira', 'Jira'], ['github', 'GitHub']] as const).map(([id, name]): ConnectionOption => ({ id, icon: id, state: 'demo-only', category: 'google', name, description: `Explore ${name} connection options.`, action: 'Connect' })),
  ...([['amazon', 'Amazon'], ['ebay', 'eBay'], ['etsy', 'Etsy'], ['tiktok-shop', 'TikTok Shop'], ['facebook-marketplace', 'Facebook Marketplace']] as const).map(([id, name]): ConnectionOption => ({ id, icon: id, state: 'demo-only', category: 'marketplaces', name, description: `Explore ${name} marketplace connection options.`, action: 'Connect' })),
]

export const connectionGroups: { id: ConnectionOption['category']; title: string; description: string; overview?: ConnectionOption['id'][]; secondary?: boolean; overviewTitle?: string }[] = [
  { id: 'websites', title: 'Websites', description: 'Your business websites.' },
  { id: 'meta', title: 'Meta Platforms', description: 'Connect your Meta business accounts.', overview: ['facebook', 'instagram', 'whatsapp', 'threads'] },
  { id: 'social', title: 'Other Social Platforms', description: 'Connect popular social media platforms.', overview: ['tiktok', 'linkedin', 'youtube', 'x'] },
  { id: 'commerce', title: 'E-commerce Platforms', description: 'Connect your online store or e-commerce platform.', overview: ['shopify', 'woocommerce', 'lightspeed', 'wix', 'bigcommerce', 'square'] },
  { id: 'google', title: 'Google & SEO', overviewTitle: 'Other Connections', secondary: true, description: 'Connect additional Google and SEO tools for deeper visibility and performance insights.', overview: ['analytics', 'search', 'business-profile', 'google-ads', 'merchant-center', 'lighthouse', 'monday', 'google-calendar', 'apple-calendar', 'jira', 'github'] },
  { id: 'marketplaces', title: 'Marketplaces', overviewTitle: 'Marketplace Connections', secondary: true, description: 'Connect the marketplaces where you sell to bring additional commerce and visibility signals into SEO Spy.', overview: ['amazon', 'ebay', 'etsy', 'tiktok-shop', 'facebook-marketplace'] },
]
