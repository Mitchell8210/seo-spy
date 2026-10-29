import type { ConnectedWebsite, WebsiteAudit } from '../types/website'
import { mockBusiness, mockConnections } from './mockBusiness'
import { mockWebsiteResults } from './mockResults'
import { mockFindings } from './mockFindings'

const websiteConnection = mockConnections.find((connection) => connection.platform === 'website')!
const root = mockBusiness.website

export const mockWebsites: ConnectedWebsite[] = [
  { id: websiteConnection.id, domain: new URL(root).hostname, url: root, status: websiteConnection.status },
]

// Fictional evidence for UI demonstration. No scan or Lighthouse run took place.
export const mockWebsiteAudits: WebsiteAudit[] = [{
  id: 'audit-guzman-demo-001',
  websiteId: websiteConnection.id,
  analyzedAt: '2026-10-27T17:00:00Z',
  results: mockWebsiteResults,
  findings: [
    { id: 'web-meta', title: 'Meta description needs improvement', category: 'Metadata', severity: 'Low', source: 'Website', explanation: mockFindings.find((finding) => finding.id === 'meta-description')!.explanation, evidence: 'The sample title is present, but the description reads “Welcome to our website” and does not describe the services.', pageId: 'page-home', status: 'Needs review' },
    { id: 'web-headings', title: 'Heading hierarchy skips a level', category: 'Content', severity: 'Medium', source: 'Website', explanation: 'A clear heading order helps visitors understand how the page is organized.', evidence: 'The sample services page moves directly from an H1 to an H3 heading.', pageId: 'page-services', status: 'Needs review' },
    { id: 'web-alt', title: 'Missing image alt text', category: 'Accessibility', severity: 'Medium', source: 'Website', explanation: mockFindings.find((finding) => finding.id === 'image-alt')!.explanation, evidence: 'Two informative images in the homepage sample have empty alt attributes.', pageId: 'page-home', status: 'Needs review' },
    { id: 'web-links', title: 'An internal link leads to a missing page', category: 'Technical SEO', severity: 'Critical', source: 'Website', explanation: 'A broken link can prevent customers from reaching information they need.', evidence: 'The sample “Tax preparation” link points to /tax-preparation, which has a mock 404 response.', pageId: 'page-services', status: 'Needs review' },
    { id: 'web-canonical', title: 'Canonical points to a different page', category: 'Technical SEO', severity: 'Medium', source: 'Website', explanation: 'Each distinct service page should identify its preferred URL clearly.', evidence: 'The sample services page uses the homepage URL as its canonical target.', pageId: 'page-services', status: 'Needs review' },
    { id: 'web-schema', title: 'Business structured data is incomplete', category: 'Technical SEO', severity: 'Low', source: 'Website', explanation: 'Complete business details help search engines interpret the information on your site.', evidence: 'The sample LocalBusiness data includes a name but no telephone or opening hours.', pageId: 'page-home', status: 'Needs review' },
    { id: 'web-accessibility', title: 'Contact form field has no visible label', category: 'Accessibility', severity: 'Medium', source: 'Website', explanation: 'A visible label makes a form easier to understand and use.', evidence: 'The sample email field uses placeholder text only; no associated label was found in the fixture.', pageId: 'page-contact', status: 'Needs review' },
    { id: 'web-performance', title: 'Large homepage image may delay loading', category: 'Performance', severity: 'Medium', source: 'Website', explanation: 'A smaller image can help visitors see your page content sooner.', evidence: 'The sample hero image is 2.4 MB and is not served in a modern compressed format.', pageId: 'page-home', status: 'Needs review' },
  ],
  pages: [
    { id: 'page-home', url: `${root}/`, findingIds: ['web-meta', 'web-alt', 'web-schema', 'web-performance'] },
    { id: 'page-services', url: `${root}/services/tax-preparation-and-accounting-for-small-businesses`, findingIds: ['web-headings', 'web-links', 'web-canonical'] },
    { id: 'page-contact', url: `${root}/contact`, findingIds: ['web-accessibility'] },
  ],
  passedChecks: [
    { id: 'check-https', title: 'HTTPS enabled', evidence: 'The sample homepage uses a secure HTTPS URL.', status: 'Passed', url: root },
    { id: 'check-sitemap', title: 'Sitemap detected', evidence: 'The fixture contains a sitemap listing the business pages.', status: 'Passed', url: `${root}/sitemap.xml` },
    { id: 'check-robots', title: 'robots.txt detected', evidence: 'The sample robots.txt allows access to the public pages.', status: 'Passed', url: `${root}/robots.txt` },
    { id: 'check-viewport', title: 'Viewport configured', evidence: 'The sample HTML includes a device-width viewport declaration.', status: 'Verified', url: root },
    { id: 'check-title', title: 'Page title present', evidence: 'The sample homepage has a non-empty title tag.', status: 'Passed', url: root },
    { id: 'check-canonical', title: 'Homepage canonical present', evidence: 'The sample homepage canonical points to the homepage itself.', status: 'Verified', url: root },
  ],
  recommendations: [
    { id: 'fix-meta', findingId: 'web-meta', action: 'Write a specific homepage summary describing your tax and accounting services.' },
    { id: 'fix-headings', findingId: 'web-headings', action: 'Use an H2 for the main services section before introducing H3 subsections.' },
    { id: 'fix-alt', findingId: 'web-alt', action: 'Add short, meaningful descriptions to the two informative images.' },
    { id: 'fix-links', findingId: 'web-links', action: 'Update the broken service link to the correct existing page and check the destination.' },
    { id: 'fix-canonical', findingId: 'web-canonical', action: 'Set the service page canonical to its preferred service URL.' },
    { id: 'fix-schema', findingId: 'web-schema', action: 'Complete the business structured data with confirmed phone and opening-hour details.' },
    { id: 'fix-accessibility', findingId: 'web-accessibility', action: 'Add a visible email label and associate it with the input field.' },
    { id: 'fix-performance', findingId: 'web-performance', action: 'Resize and compress the hero image, using a suitable modern image format.' },
  ],
}]
