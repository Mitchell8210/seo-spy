export type ScoreTone = 'poor' | 'improvement' | 'good' | 'excellent'

const statuses = {
  poor: { label: 'Poor', light: 'text-red-700', dark: 'text-red-400' },
  improvement: { label: 'Needs improvement', light: 'text-amber-700', dark: 'text-amber-300' },
  good: { label: 'Good', light: 'text-emerald-700', dark: 'text-emerald-400' },
  excellent: { label: 'Excellent', light: 'text-blue-700', dark: 'text-blue-400' },
} as const

// Presentation thresholds only; this does not calculate a business score.
export function getScoreStatus(value: number) {
  const tone: ScoreTone = value < 50 ? 'poor' : value < 70 ? 'improvement' : value < 85 ? 'good' : 'excellent'
  return { tone, ...statuses[tone] }
}
