import type { ConsistencyResults, MainSpyResults, SocialResults, WebsiteResults } from '../types/dashboard'

// All values are illustrative fixtures, not measurements or frontend scoring rules.
export const mockWebsiteResults: WebsiteResults = {
  categories: [
    { id: 'performance', label: 'Performance', value: 71, maximum: 100, description: 'Page loading and responsiveness.' },
    { id: 'accessibility', label: 'Accessibility', value: 86, maximum: 100, description: 'Usability for people with different access needs.' },
    { id: 'best-practices', label: 'Best Practices', value: 73, maximum: 100, description: 'Common website quality checks.' },
    { id: 'seo', label: 'SEO', value: 92, maximum: 100, description: 'Search engine discoverability checks.' },
  ],
  overall: { id: 'website-score', label: 'SEO Spy Website Score', value: 78, maximum: 100, description: 'Overall website health.' },
  issues: 8,
  checksPassed: 34,
}

export const mockSocialResults: SocialResults = {
  account: 'Facebook · Guzman Tax Accounting',
  metrics: [
    { id: 'followers', label: 'Followers', value: '1,284' },
    { id: 'reach', label: 'Reach — 30 days', value: '8,420' },
    { id: 'engagement', label: 'Engagement Rate', value: '4.8%' },
    { id: 'interactions', label: 'Interactions — 30 days', value: '406' },
  ],
  secondary: [
    { label: 'Likes', value: '286' },
    { label: 'Comments', value: '78' },
    { label: 'Shares', value: '42' },
  ],
}

export const mockConsistency: ConsistencyResults = {
  score: { id: 'consistency', label: 'Business Consistency Score', value: 74, maximum: 100, description: 'Agreement across business channels.' },
  channels: 'Website ↔ Facebook',
  checks: [
    { id: 'hours', label: 'Business hours differ', matches: false, website: 'Mon–Fri, 9am–5pm', social: 'Mon–Fri, 9am–6pm' },
    { id: 'phone', label: 'Phone formatting differs', matches: false, website: '(555) 010-0123', social: '+1 555-010-0123' },
    { id: 'name', label: 'Business name matches', matches: true, website: 'Guzman Tax Accounting', social: 'Guzman Tax Accounting' },
    { id: 'url', label: 'Website URL matches', matches: true, website: 'guzmantaxaccounting.com', social: 'guzmantaxaccounting.com' },
  ],
}

export const mockMainSpyResults: MainSpyResults = {
  overall: { id: 'main-spy', label: 'Main Spy Score', value: 79, maximum: 100, description: 'Overall digital presence.' },
  components: [
    { ...mockWebsiteResults.overall, label: 'Website' },
    { id: 'social-score', label: 'Social Media', value: 82, maximum: 100, description: 'Social media performance.' },
    { ...mockConsistency.score, label: 'Business Consistency' },
  ],
  priorityOpportunities: 6,
}
