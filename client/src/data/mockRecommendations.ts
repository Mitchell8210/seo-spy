import type { Recommendation } from '../types/dashboard'

export const mockRecommendations: Recommendation[] = [
  {
    id: 'align-hours', findingId: 'business-details', severity: 'Critical', source: 'Website + Facebook',
    title: 'Align your business hours',
    explanation: 'Confirm your correct hours, then use the same details on your website and Facebook Page.',
    status: 'Needs review',
  },
  {
    id: 'describe-images', findingId: 'image-alt', severity: 'Medium', source: 'Website',
    title: 'Add helpful image descriptions',
    explanation: 'Write short, meaningful descriptions for images that communicate information.',
    status: 'Needs review',
  },
  {
    id: 'rewrite-summary', findingId: 'meta-description', severity: 'Low', source: 'Website',
    title: 'Clarify your search summary',
    explanation: 'Describe your tax and accounting services clearly in the homepage meta description.',
    status: 'Needs review',
  },
]
