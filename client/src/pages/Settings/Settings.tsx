import { useRef, useState } from 'react'
import { Building2, Crown, Link2, Sparkles } from 'lucide-react'
import { BusinessProfileSettings } from '../../components/settings/BusinessProfileSettings'
import { ConnectedAssetsSettings } from '../../components/settings/ConnectedAssetsSettings'
import { FixPreferencesSettings } from '../../components/settings/FixPreferencesSettings'
import { PlanSettings } from '../../components/settings/PlanSettings'

const sections = [
  { id: 'business', label: 'Business Profile', icon: Building2 },
  { id: 'assets', label: 'Connected Assets', icon: Link2 },
  { id: 'preferences', label: 'AI & Fix Preferences', icon: Sparkles },
  { id: 'plan', label: 'Plan', icon: Crown },
] as const

type SettingsSection = typeof sections[number]['id']

export function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('business')
  const headings = useRef<Partial<Record<SettingsSection, HTMLHeadingElement | null>>>({})
  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1><p className="mt-2 text-sm leading-6 text-secondary">Manage your business information, connected accounts, and preferences.</p></div>
      <div className="grid items-start gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="rounded-xl border border-line bg-surface p-3 shadow-sm xl:sticky xl:top-6">
          <ul className="space-y-1">{sections.map(({ id, label, icon: Icon }) => <li key={id}><button type="button" aria-current={activeSection === id ? 'true' : undefined} aria-controls={`settings-${id}`} onClick={() => {
            setActiveSection(id)
            requestAnimationFrame(() => {
              headings.current[id]?.focus({ preventScroll: true })
              document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' })
            })
          }} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${activeSection === id ? 'bg-blue-600 text-white shadow-md shadow-blue-950/20' : 'text-secondary hover:bg-elevated hover:text-ink'}`}><Icon size={23} className="shrink-0" aria-hidden="true" />{label}</button></li>)}</ul>
        </nav>
        <div className="min-w-0 space-y-7">
          <p className="mb-4 text-xs leading-6 text-muted">Demo settings · Changes apply only in this view</p>
          {sections.map(({ id, label, icon: Icon }) => <section key={id} id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/10 sm:p-7">
            <div className="mb-5 flex items-center gap-3"><span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl border ${id === 'plan' ? 'border-amber-300/25 bg-amber-300/10 text-amber-300' : 'border-blue-400/25 bg-blue-500/15 text-blue-300'}`}><Icon size={29} aria-hidden="true" /></span><h2 ref={(element) => { headings.current[id] = element }} id={`settings-${id}-title`} tabIndex={-1} className="rounded-sm text-xl font-semibold tracking-tight text-ink">{label}</h2></div>
            {id === 'business' && <BusinessProfileSettings />}
            {id === 'assets' && <ConnectedAssetsSettings />}
            {id === 'preferences' && <FixPreferencesSettings />}
            {id === 'plan' && <PlanSettings />}
          </section>)}
        </div>
      </div>
    </div>
  )
}
