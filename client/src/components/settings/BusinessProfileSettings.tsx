import { useState } from 'react'
import { Save, Store } from 'lucide-react'
import type { BusinessProfile } from '../../types/settings'
import { mockBusinessProfile, mockIndustries } from '../../data/mockSettings'

const inputClass = 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-elevated px-3 py-2.5 text-sm text-ink'

export function BusinessProfileSettings() {
  const [profile, setProfile] = useState<BusinessProfile>({ ...mockBusinessProfile })
  const [message, setMessage] = useState('')
  function update(field: keyof BusinessProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }))
    setMessage('')
  }
  return (
    <>
      <p className="mt-2 text-sm leading-6 text-secondary">Tell us about your business so SEO Spy can provide more accurate insights and recommendations.</p>
      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_200px]">
      <form className="min-w-0" onSubmit={(event) => {
        event.preventDefault()
        setMessage('Changes saved in this view only. Reloading resets the demo data.')
      }}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="min-w-0"><label htmlFor="business-name" className="text-sm font-medium text-secondary">Business Name</label><input id="business-name" name="businessName" required value={profile.name} onChange={(event) => update('name', event.target.value)} className={inputClass} /></div>
          <div className="min-w-0"><label htmlFor="business-website" className="text-sm font-medium text-secondary">Website URL</label><input id="business-website" name="websiteUrl" type="url" required value={profile.website} onChange={(event) => update('website', event.target.value)} className={inputClass} /></div>
          <div className="min-w-0"><label htmlFor="business-industry" className="text-sm font-medium text-secondary">Industry</label><select id="business-industry" name="industry" value={profile.industry} onChange={(event) => update('industry', event.target.value)} className={inputClass}>{mockIndustries.map((industry) => <option key={industry}>{industry}</option>)}</select></div>
          <div className="min-w-0"><label htmlFor="business-location" className="text-sm font-medium text-secondary">Business Location</label><input id="business-location" name="location" value={profile.location} onChange={(event) => update('location', event.target.value)} className={inputClass} /></div>
          <div className="min-w-0 md:col-span-2"><label htmlFor="business-description" className="text-sm font-medium text-secondary">Short Description</label><textarea id="business-description" name="description" rows={3} value={profile.description} onChange={(event) => update('description', event.target.value)} className={`${inputClass} resize-y`} /></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5"><button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-500 bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 hover:bg-blue-700"><Save size={16} aria-hidden="true" />Save Changes</button><p className="text-xs leading-5 text-muted">Demo profile · Stored only in this view</p></div>
        <p role="status" className="mt-3 text-sm leading-6 text-blue-300">{message}</p>
      </form>
      <aside className="rounded-2xl border border-blue-400/20 bg-elevated p-5">
        <span className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/15 text-blue-300"><Store size={34} aria-hidden="true" /></span>
        <div><h3 className="text-base font-semibold text-ink">Why this matters</h3><p className="mt-1 text-sm leading-6 text-secondary">This information helps SEO Spy give you personalized recommendations tailored to your business.</p></div>
      </aside>
      </div>
    </>
  )
}
