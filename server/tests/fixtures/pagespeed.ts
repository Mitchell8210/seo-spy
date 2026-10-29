export function pageSpeedFixture() {
  return { lighthouseResult: {
    requestedUrl: 'https://www.guzmantaxaccounting.com/', finalUrl: 'https://www.guzmantaxaccounting.com/',
    fetchTime: '2026-10-28T18:00:00.000Z', lighthouseVersion: '13.0.0', configSettings: { formFactor: 'mobile' },
    categories: {
      performance: { score: 0.72, auditRefs: [{ id: 'first-contentful-paint' }] },
      accessibility: { score: 0.91, auditRefs: [{ id: 'image-alt' }, { id: 'manual-check' }, { id: 'error-check' }] },
      'best-practices': { score: 1, auditRefs: [] }, seo: { score: 0, auditRefs: [] },
    },
    audits: {
      'first-contentful-paint': { title: 'First Contentful Paint', score: 0.8, scoreDisplayMode: 'numeric', numericValue: 1800, displayValue: '1.8 s' },
      'largest-contentful-paint': { title: 'Largest Contentful Paint', score: 0.6, scoreDisplayMode: 'numeric', numericValue: 3200 },
      'total-blocking-time': { title: 'Total Blocking Time', score: 0.9, scoreDisplayMode: 'numeric', numericValue: 150 },
      'cumulative-layout-shift': { title: 'Cumulative Layout Shift', score: 1, scoreDisplayMode: 'numeric', numericValue: 0.02 },
      'speed-index': { title: 'Speed Index', score: 0.8, scoreDisplayMode: 'numeric', numericValue: 2400 },
      'image-alt': { title: 'Images need text alternatives', description: 'Provide text alternatives for informative images.', score: 0, scoreDisplayMode: 'binary' },
      'manual-check': { title: 'Manual review', score: null, scoreDisplayMode: 'manual' },
      'error-check': { title: 'Unavailable check', score: null, scoreDisplayMode: 'error' },
    }, runWarnings: ['Lab measurements can vary between runs.'],
  } };
}
