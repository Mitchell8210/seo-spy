type BadgeTone = 'neutral' | 'blue' | 'success' | 'critical' | 'medium' | 'low'

const tones: Record<BadgeTone, { light: string; dark: string }> = {
  neutral: { light: 'border-line bg-canvas text-secondary', dark: 'border-line bg-elevated text-secondary' },
  blue: { light: 'border-blue-200 bg-blue-950 text-blue-300', dark: 'border-blue-800 bg-blue-950 text-blue-300' },
  success: { light: 'border-emerald-200 bg-emerald-50 text-emerald-800', dark: 'border-emerald-800 bg-emerald-950 text-emerald-300' },
  critical: { light: 'border-red-200 bg-red-50 text-red-800', dark: 'border-red-800 bg-red-950 text-red-300' },
  medium: { light: 'border-amber-200 bg-amber-50 text-amber-900', dark: 'border-amber-800 bg-amber-950 text-amber-300' },
  low: { light: 'border-emerald-200 bg-emerald-50 text-emerald-800', dark: 'border-emerald-800 bg-emerald-950 text-emerald-300' },
}

export function StatusBadge({ label, tone = 'neutral', theme = 'dark', size = 'default' }: { label: string; tone?: BadgeTone; theme?: 'light' | 'dark'; size?: 'default' | 'small' }) {
  const sizing = size === 'small' ? 'px-1.5 py-0 text-[10px] leading-4' : 'px-2 py-0.5 text-xs'
  return <span className={`inline-flex items-center rounded-md border font-medium ${sizing} ${tones[tone][theme]}`}>{label}</span>
}
