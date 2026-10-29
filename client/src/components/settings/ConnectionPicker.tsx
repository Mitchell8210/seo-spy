import { useState } from 'react'
import type { RefObject } from 'react'
import { AtSign, BriefcaseBusiness, Camera, ChartColumn, Ghost, Globe, MessageCircle, MessagesSquare, Music2, Pin, Play, Search, X } from 'lucide-react'
import type { ConnectionOption } from '../../types/settings'
import { mockConnectionOptions } from '../../data/mockConnectionOptions'
import { FacebookMark } from '../common/FacebookMark'

const groups = [
  { id: 'websites', title: 'Websites' },
  { id: 'meta', title: 'Meta' },
  { id: 'social', title: 'Social' },
  { id: 'google', title: 'Google & Analytics' },
] as const

const icons = { website: Globe, facebook: Globe, instagram: Camera, tiktok: Music2, linkedin: BriefcaseBusiness, youtube: Play, x: X, threads: AtSign, whatsapp: MessageCircle, pinterest: Pin, snapchat: Ghost, reddit: MessagesSquare, search: Search, analytics: ChartColumn }
const tones: Record<ConnectionOption['id'], string> = {
  website: 'border-blue-400/25 bg-blue-400/10 text-blue-300',
  facebook: 'border-blue-400/25 bg-blue-400/10 text-blue-300',
  instagram: 'border-pink-400/25 bg-pink-400/10 text-pink-300',
  tiktok: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300',
  linkedin: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  youtube: 'border-red-400/25 bg-red-400/10 text-red-300',
  x: 'border-slate-400/25 bg-slate-400/10 text-ink',
  threads: 'border-slate-400/25 bg-slate-400/10 text-ink',
  whatsapp: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  pinterest: 'border-red-400/25 bg-red-400/10 text-red-300',
  snapchat: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-300',
  reddit: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  search: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  analytics: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
}

export function ConnectionPicker({ dialogRef, onClose }: { dialogRef: RefObject<HTMLDialogElement | null>; onClose: () => void }) {
  const [message, setMessage] = useState('')
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="connection-picker-title"
      aria-describedby="connection-picker-description"
      onClose={() => { setMessage(''); onClose() }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl shadow-black/40 backdrop:bg-black/75 open:flex open:flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
        <div className="min-w-0"><h2 id="connection-picker-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Add a Connection</h2><p id="connection-picker-description" className="mt-2 text-sm leading-6 text-secondary">Choose what you want SEO Spy to analyze for your business.</p></div>
        <button type="button" aria-label="Close connection picker" onClick={() => dialogRef.current?.close()} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-elevated text-secondary hover:text-ink"><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
        <p className="text-xs leading-6 text-muted">Demo connection options · Add multiple websites and accounts in the full product. Nothing connects in this preview.</p>
        {groups.map((group) => <section key={group.id} aria-labelledby={`connection-group-${group.id}`}>
          <h3 id={`connection-group-${group.id}`} className="mb-3 text-sm font-semibold text-secondary">{group.title}</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{mockConnectionOptions.filter((option) => option.category === group.id).map((option) => {
            const Icon = icons[option.id]
            return <article key={option.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-elevated p-4">
              <div className="mb-3">{option.id === 'facebook' ? <span className="[&>span]:size-12 [&_svg]:size-8"><FacebookMark /></span> : <span className={`flex size-12 items-center justify-center rounded-xl border ${tones[option.id]}`}><Icon size={26} aria-hidden="true" /></span>}</div>
              <h4 className="text-sm font-semibold text-ink">{option.name}</h4>
              <p className="mt-1 flex-1 text-xs leading-6 text-secondary">{option.description}</p>
              <button type="button" aria-label={`${option.action === 'Add Website' ? 'Add Website' : `Connect ${option.name}`} (demo)`} onClick={() => setMessage(option.id === 'website' ? 'Website connections are available in the full product. No website has been added.' : `${option.name}: Demo connection — integration will be available in the full product. No account has been connected.`)} className="mt-4 min-h-11 rounded-lg border border-blue-400/30 bg-blue-400/5 px-3 text-sm font-semibold text-blue-300 hover:bg-blue-400/15">{option.action}</button>
            </article>
          })}</div>
        </section>)}
      </div>
      <div className="shrink-0 border-t border-line bg-elevated px-5 py-4 sm:px-6"><p role="status" aria-live="polite" className="min-h-6 text-sm leading-6 text-blue-300">{message || 'Product preview only. No sign-in or credentials are needed.'}</p></div>
    </dialog>
  )
}
