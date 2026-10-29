import type { SocialAccount, SocialMediaAudit } from '../types/socialMedia'
import { mockBusiness, mockConnections } from './mockBusiness'
import { mockMainSpyResults, mockSocialResults } from './mockResults'

const connection = mockConnections.find((item) => item.platform === 'facebook')!
const metric = (id: string) => mockSocialResults.metrics.find((item) => item.id === id)!.value
const secondary = (label: string) => mockSocialResults.secondary.find((item) => item.label === label)!.value

export const mockSocialAccounts: SocialAccount[] = [{
  id: connection.id, businessId: mockBusiness.id, platform: 'Facebook', name: connection.identity, status: connection.status,
}]

// Demonstration fixtures only. These are not live Facebook measurements or API capabilities.
export const mockSocialMediaAudits: SocialMediaAudit[] = [{
  id: 'social-audit-demo-001', accountId: connection.id, analyzedAt: '2026-10-27T17:00:00Z', periodLabel: 'Last 30 days',
  score: mockMainSpyResults.components.find((item) => item.id === 'social-score')!,
  scoreSummary: 'Your social media is in good shape, but a few things need attention.',
  healthMetrics: [
    { id: 'followers', title: 'Followers', value: metric('followers'), supporting: [
      { id: 'new-followers', label: 'New Followers', value: '37' }, { id: 'unfollowed', label: 'Unfollowed', value: '8' },
    ] },
    { id: 'reach', title: 'People Reached', value: metric('reach'), supporting: [
      { id: 'unique-people', label: 'Unique people', value: '6,180' }, { id: 'video-views', label: 'Video views', value: '1,240' }, { id: 'shares', label: 'Shares', value: secondary('Shares') },
    ] },
    { id: 'contacts', title: 'People Who Contacted You', value: '23', supporting: [
      { id: 'website-clicks', label: 'Website Clicks', value: '86' }, { id: 'address-clicks', label: 'Address Clicks', value: '12' }, { id: 'mentions', label: 'People Mentioning Your Business', value: '4' },
    ] },
    { id: 'interactions', title: 'Interactions', value: metric('interactions'), supporting: [
      { id: 'likes', label: 'Likes', value: secondary('Likes') }, { id: 'comments', label: 'Comments', value: secondary('Comments') }, { id: 'shares', label: 'Shares', value: secondary('Shares') }, { id: 'messages', label: 'Messages', value: '17' },
    ] },
  ],
  findings: [
    { id: 'social-call-to-action', title: 'Missing call to action', category: 'Profile', severity: 'Critical', status: 'Needs review', explanation: 'The sample Page has no main button telling visitors how to contact the business.', evidence: 'No Contact Us, Call Now, or Message button is configured in this mock profile.', impact: 'Visitors may leave without knowing how to reach you.', affectedArea: 'Facebook profile · Main action button', recommendation: { id: 'social-fix-action', action: 'Choose a main contact button and confirm that it leads to the correct phone number or contact page.' } },
    { id: 'social-posting', title: 'Post more consistently', category: 'Content', severity: 'Medium', status: 'Needs review', explanation: 'There is a long gap between posts in the sample content history.', evidence: 'The mock history contains two posts in 30 days, with a three-week gap between them.', impact: 'Regular, helpful updates give customers a reason to return to your Page.', affectedArea: 'Facebook Page · Posts', recommendation: { id: 'social-fix-posting', action: 'Plan a simple weekly update with a useful tip, reminder, or answer to a common customer question.' } },
    { id: 'social-photos', title: 'Add more photos', category: 'Visibility', severity: 'Medium', status: 'Needs review', explanation: 'The sample photo collection has few images showing the business.', evidence: 'Only a profile picture, cover photo, and one office image appear in the mock collection.', impact: 'Current photos can help people recognize your business and feel comfortable contacting you.', affectedArea: 'Facebook Page · Photos', recommendation: { id: 'social-fix-photos', action: 'Add recent photos of your office and team, using images you have permission to share.' } },
    { id: 'social-description', title: 'Improve profile description', category: 'Business Information', severity: 'Low', status: 'Needs review', explanation: 'The sample description does not clearly explain the services offered.', evidence: 'The mock About text reads “Here to help with your business needs.”', impact: 'A clear description helps visitors decide whether your business offers what they need.', affectedArea: 'Facebook profile · About', recommendation: { id: 'social-fix-description', action: 'Briefly describe your main services, who you help, and how customers can get in touch.' } },
    { id: 'social-pinned-post', title: 'Create a pinned post', category: 'Engagement', severity: 'Low', status: 'Needs review', explanation: 'The sample Page has no pinned welcome or information post.', evidence: 'No featured or pinned post is present in the mock Page content.', impact: 'A pinned post keeps useful information easy for new visitors to find.', affectedArea: 'Facebook Page · Featured content', recommendation: { id: 'social-fix-pinned', action: 'Pin a short welcome post with your services, contact details, and a clear next step.' } },
  ],
  passedChecks: [
    { id: 'social-check-profile', title: 'Profile picture looks good', status: 'Passed', checked: 'Profile picture clarity and fit.', evidence: 'The mock profile uses a clear business logo without visible cropping.', whyHealthy: 'A recognizable picture helps customers identify your business.' },
    { id: 'social-check-cover', title: 'Cover photo looks good', status: 'Passed', checked: 'Cover photo readability and presentation.', evidence: 'The sample cover image is clear and its main content fits inside the visible area.', whyHealthy: 'Visitors can understand the first visual impression of your Page.' },
    { id: 'social-check-name', title: 'Page name is optimized', status: 'Verified', checked: 'Page name clarity and agreement with the business name.', evidence: `The mock Page name matches ${mockBusiness.name}.`, whyHealthy: 'A consistent name makes it easier for people to find the right business.' },
    { id: 'social-check-website', title: 'Website link is present', status: 'Verified', checked: 'Website link in the profile.', evidence: `The sample profile lists ${mockBusiness.website}.`, whyHealthy: 'Visitors have a clear route to learn more about your services.' },
    { id: 'social-check-public', title: 'Page is public', status: 'Passed', checked: 'Sample Page visibility setting.', evidence: 'The fixture marks the Page as public.', whyHealthy: 'Public visibility allows new customers to discover the Page.' },
    { id: 'social-check-warnings', title: 'No obvious account warnings', status: 'Passed', checked: 'Warnings in the mock account summary.', evidence: 'No warning flags are included in this fixture; no live account was inspected.', whyHealthy: 'The sample account summary has no listed issues requiring a separate account review.' },
  ],
}]

// Fictional comparison for the visual demo; not measured against real businesses.
export const mockSocialBenchmark = { percentile: 68 }
