import type { Finding } from '../types/dashboard'

export const mockFindings: Finding[] = [
  {
    id: 'business-details', severity: 'Critical', source: 'Website + Facebook',
    title: 'Business information differs between website and Facebook',
    explanation: 'The sample business hours differ across channels. Conflicting details can make it harder for customers to plan a visit.',
    status: 'Needs review',
  },
  {
    id: 'image-alt', severity: 'Medium', source: 'Website',
    title: 'Missing image alt text',
    explanation: 'Some sample images have no text description. Clear descriptions help people using screen readers understand your content.',
    status: 'Needs review',
  },
  {
    id: 'meta-description', severity: 'Low', source: 'Website',
    title: 'Meta description needs improvement',
    explanation: 'The sample homepage summary is too general. A more specific summary can explain your services in search results.',
    status: 'Needs review',
  },
]
