import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PlannerPreferences } from '../../types/planner'
import { primaryAction, secondaryAction } from './plannerVisuals'

export function PlannerSettingsDialog({ preferences, onSave, onClose }: {
  preferences: PlannerPreferences; onSave: (value: Omit<PlannerPreferences, 'useWeekends'>) => Promise<boolean>; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} aria-labelledby="planner-settings-title" onClose={onClose} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-blue-400/30 bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/75 sm:p-6">
    <header className="mb-5 flex items-center justify-between gap-3"><h2 id="planner-settings-title" className="text-lg font-semibold">Planning settings</h2><button type="button" onClick={() => ref.current?.close()} aria-label="Close planning settings" className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line"><X size={18} aria-hidden="true" /></button></header>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (submitting.current) return
      const data = new FormData(event.currentTarget), timeZone = String(data.get('timeZone') ?? '').trim()
      try { new Intl.DateTimeFormat('en-US', { timeZone }).format() } catch { setError('Enter a valid time zone such as America/Los_Angeles.'); return }
      submitting.current = true; setSaving(true); setError('')
      try {
        if (await onSave({ dailyCapacityMinutes: Number(data.get('dailyCapacityMinutes')), maxTasksPerDay: Number(data.get('maxTasksPerDay')), horizonWeeks: Number(data.get('horizonWeeks')), timeZone })) ref.current?.close()
        else setError('Planning settings were not saved. Your entries are kept; review the planner message and retry.')
      } finally { submitting.current = false; setSaving(false) }
    }}>
      <div><label htmlFor="planner-daily-budget" className="text-xs font-medium text-secondary">Work hours per day</label><select id="planner-daily-budget" name="dailyCapacityMinutes" defaultValue={preferences.dailyCapacityMinutes} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm">{Array.from({ length: 16 }, (_, index) => (index + 1) * 30).map(minutes => <option key={minutes} value={minutes}>{minutes / 60} {minutes === 60 ? 'hour' : 'hours'}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-3"><div><label htmlFor="planner-daily-tasks" className="text-xs text-secondary">Maximum tasks per day</label><input id="planner-daily-tasks" name="maxTasksPerDay" type="number" min={1} max={16} step={1} required defaultValue={preferences.maxTasksPerDay} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm" /></div><div><label htmlFor="planner-horizon" className="text-xs text-secondary">Plan ahead (weeks)</label><input id="planner-horizon" name="horizonWeeks" type="number" min={1} max={12} step={1} required defaultValue={preferences.horizonWeeks} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm" /></div></div>
      <div><label htmlFor="planner-time-zone" className="text-xs font-medium text-secondary">Time zone</label><input id="planner-time-zone" name="timeZone" required defaultValue={preferences.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-elevated px-3 text-sm" /><p className="mt-2 text-xs leading-5 text-muted">Confirm this time zone before Auto Plan. Tasks use your 09:00–17:00 calendar window. Existing schedules stay in place when settings change.</p></div>
      <p role="alert" className="text-xs text-red-300">{saving ? 'Saving planning settings…' : error}</p>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving} className={primaryAction}>Save Settings</button><button type="button" onClick={() => ref.current?.close()} className={secondaryAction}>Cancel</button></div>
    </form>
  </dialog>
}
