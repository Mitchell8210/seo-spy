import { useState } from 'react'
import { Bot, FileText, ShieldCheck } from 'lucide-react'
import type { ContentTone } from '../../types/settings'
import { mockFixPreferences, mockToneOptions } from '../../data/mockSettings'
import { SettingSwitch } from './SettingSwitch'

export function FixPreferencesSettings() {
  const [preferences, setPreferences] = useState({ ...mockFixPreferences })
  return (
    <>
      <p className="mt-2 text-sm leading-6 text-secondary">Control how SEO Spy uses AI to generate content and suggest changes.</p>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <SettingSwitch icon={Bot} violet id="ai-suggestions" label="AI Suggestions" description="Get personalized recommendations using Meta AI." checked={preferences.aiSuggestions} onChange={(aiSuggestions) => setPreferences((current) => ({ ...current, aiSuggestions }))} />
        <SettingSwitch icon={ShieldCheck} id="require-approval" label="Require Approval for Changes" description="SEO Spy will suggest changes, but you'll approve them before anything is updated." checked={preferences.requireApproval} onChange={(requireApproval) => setPreferences((current) => ({ ...current, requireApproval }))} />
        <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-elevated p-5 sm:flex-row sm:items-center xl:col-span-2"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/15 text-blue-300"><FileText size={26} aria-hidden="true" /></span><div className="min-w-0 flex-1"><label htmlFor="content-tone" className="text-sm font-semibold text-ink">Content Tone</label><p id="tone-description" className="mt-1 text-sm leading-6 text-secondary">Choose the tone for AI-generated content such as titles, descriptions, and posts.</p></div><select id="content-tone" value={preferences.tone} onChange={(event) => setPreferences((current) => ({ ...current, tone: event.target.value as ContentTone }))} aria-describedby="tone-description" className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink sm:w-44 sm:shrink-0">{mockToneOptions.map((tone) => <option key={tone}>{tone}</option>)}</select></div>
      </div>
      <p className="mt-4 flex items-start gap-3 rounded-xl border border-blue-400/20 bg-elevated p-4 text-sm leading-6 text-secondary"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />Demo preferences only. No AI services are called. External changes still require explicit approval.</p>
    </>
  )
}
