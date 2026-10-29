import type { LucideIcon } from 'lucide-react'

export function SettingSwitch({ id, label, description, checked, onChange, icon: Icon, violet = false }: { id: string; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; icon: LucideIcon; violet?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-elevated p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl border ${violet ? 'border-violet-400/25 bg-violet-400/10 text-violet-300' : 'border-blue-400/25 bg-blue-500/15 text-blue-300'}`}><Icon size={26} aria-hidden="true" /></span>
        <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} onClick={() => onChange(!checked)} className="flex min-h-11 shrink-0 items-center gap-2 rounded-md">
          <span className="text-xs font-semibold text-secondary">{checked ? 'On' : 'Off'}</span>
          <span aria-hidden="true" className={`flex h-8 w-14 items-center rounded-full border p-1 shadow-inner ${checked ? 'border-blue-400 bg-blue-600' : 'border-slate-500 bg-surface'}`}><span className={`size-5 rounded-full bg-white shadow-sm ${checked ? 'translate-x-6' : ''}`} /></span>
        </button>
      </div>
      <h3 id={`${id}-label`} className="text-base font-semibold leading-6 text-ink">{label}</h3><p id={`${id}-description`} className="mt-2 text-sm leading-6 text-secondary">{description}</p>
    </div>
  )
}
