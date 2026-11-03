// Illustrative analytics only. These records are never presented as provider measurements.
const users = [24,31,28,35,39,22,19,33,41,38,46,43,29,25,42,48,45,51,56,36,31,49,57,53,61,64,44,39,58,67]
export const mockAnalysis = {
  source: 'demo' as const,
  period: 'Illustrative 30-day sample',
  daily: users.map((value, index) => ({ day: index + 1, users: value, sessions: value + 18, conversions: index % 7 === 0 ? 2 : index % 3 === 0 ? 1 : 0 })),
  channels: [
    { label: 'Organic Search', value: 790 }, { label: 'Direct', value: 510 },
    { label: 'Referral', value: 270 }, { label: 'Social', value: 224 },
  ],
  devices: [{ label: 'Desktop', value: 510 }, { label: 'Mobile', value: 700 }, { label: 'Tablet', value: 44 }],
  pages: [{ path: '/', users: 640 }, { path: '/services/tax-preparation', users: 380 }, { path: '/about', users: 210 }, { path: '/contact', users: 175 }, { path: '/blog', users: 120 }],
}
