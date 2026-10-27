import type { Severity } from '../types/dashboard'

// Finding priority is independent of numerical score performance.
export const findingStatuses = {
  Critical: { tone: 'critical', icon: 'text-red-400' },
  Medium: { tone: 'medium', icon: 'text-amber-300' },
  Low: { tone: 'low', icon: 'text-emerald-400' },
  Passed: { tone: 'blue', icon: 'text-blue-400' },
  Verified: { tone: 'blue', icon: 'text-blue-400' },
} as const satisfies Record<Severity, { tone: string; icon: string }>
