import { useRef, useState } from 'react'
import { Check, Link2, Plus, Search, Share2, ShoppingBag } from 'lucide-react'
import { StatusBadge } from '../common/StatusBadge'
import { ConnectionPicker } from './ConnectionPicker'
import { PlatformIcon } from './PlatformIcon'
import { mockSettingsAssets } from '../../data/mockSettings'
import { connectionGroups, mockConnectionOptions } from '../../data/mockConnectionOptions'

const groupIcons = { meta: Link2, social: Share2, commerce: ShoppingBag }

export function ConnectedAssetsSettings() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const [message, setMessage] = useState('')
  return <>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-sm leading-6 text-secondary">Connect and manage your websites, online stores, social channels, and marketing accounts in one place.</p><p className="mt-2 text-xs leading-5 text-muted">Demo connections · No accounts are being accessed or synced.</p></div>
      <button type="button" aria-haspopup="dialog" onClick={event => { returnFocusRef.current = event.currentTarget; dialogRef.current?.showModal() }} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-blue-500 bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-950/25 hover:bg-blue-700"><Plus size={18} aria-hidden="true" />Add Connection</button>
    </div>
    <div aria-label="Currently connected assets" className="mt-6 grid gap-4 md:grid-cols-2">{mockSettingsAssets.filter(asset => asset.status === 'Connected').map(asset => <article key={asset.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-line bg-elevated p-4">
      <PlatformIcon platform={asset.kind} />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{asset.name}</h3><StatusBadge label={asset.status} tone="success" /></div><p className="mt-2 break-words text-sm leading-6 text-secondary [overflow-wrap:anywhere]">{asset.kind === 'website' ? new URL(asset.detail).hostname : asset.detail}</p>{asset.checkedAt && <p className="mt-2 text-[11px] leading-5 text-muted">{asset.timeLabel} (mock): <time dateTime={asset.checkedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(asset.checkedAt))} Pacific</time></p>}</div>
    </article>)}</div>
    <section aria-labelledby="available-connections-title" className="mt-7 border-t border-line pt-6">
      <h3 id="available-connections-title" className="text-base font-semibold text-ink">Available Connections</h3>
      <p className="mt-2 text-sm leading-6 text-secondary">Connect additional platforms to unlock more insights, AI suggestions, and growth opportunities.</p>
      <div className="mt-5 grid items-stretch gap-4 min-[1400px]:grid-cols-[1fr_1fr_1.15fr]">{connectionGroups.filter(group => group.overview && !group.secondary).map(group => {
        const Icon = groupIcons[group.id as keyof typeof groupIcons]
        return <section key={group.id} aria-labelledby={`available-${group.id}`} className="min-w-0 rounded-xl border border-line bg-elevated/50 p-3 sm:p-4">
          <h4 id={`available-${group.id}`} className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink"><Icon size={19} className="shrink-0 text-blue-300" aria-hidden="true" />{group.title}</h4>
          <p className="mt-1 min-h-10 text-xs leading-5 text-muted">{group.description}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">{group.overview?.map(id => {
            const option = mockConnectionOptions.find(item => item.id === id)!
            const connected = option.state === 'connected-demo' && mockSettingsAssets.some(asset => asset.kind === option.id && asset.status === 'Connected')
            return <button key={id} type="button" aria-label={`${option.name} (${connected ? 'connected in demo' : 'demo connection option'})`} onClick={() => setMessage(connected ? `${option.name} is already shown as connected in this demo. No live account is being accessed.` : `${option.name}: Demo connection option only. No account or store has been connected.`)} className="flex min-h-24 min-w-0 cursor-pointer flex-col items-center gap-2 rounded-lg border border-transparent px-1 py-3 text-center hover:border-blue-400/30 hover:bg-blue-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
              <PlatformIcon platform={option.icon} /><span className="w-full break-words text-[11px] font-medium leading-4 text-secondary">{option.shortName ?? option.name}</span>{connected && <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300"><Check size={11} aria-hidden="true" />Connected</span>}
            </button>
          })}</div>
        </section>
      })}</div>
      <div data-testid="secondary-connections" className="mt-6 space-y-6 border-t border-line pt-5">{connectionGroups.filter(group => group.secondary).map(group => {
        const Icon = group.id === 'google' ? Search : ShoppingBag
        return <section key={group.id} aria-labelledby={`available-${group.id}`}>
          <h4 id={`available-${group.id}`} className="flex items-center gap-2 text-sm font-semibold text-secondary"><Icon size={17} aria-hidden="true" className="text-muted" />{group.overviewTitle}</h4>
          <p className="mt-2 text-xs leading-5 text-muted">{group.description}</p>
          <div className={`mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 ${group.id === 'google' ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>{group.overview?.map(id => {
            const option = mockConnectionOptions.find(item => item.id === id)!
            return <button key={id} type="button" aria-label={`${option.name} (${option.id === 'lighthouse' ? 'demo tool option' : 'demo connection option'})`} onClick={() => setMessage(option.id === 'lighthouse' ? 'Lighthouse: Analysis tool preview only. No sign-in is required and no analysis has been started.' : `${option.name}: Demo connection option only. No account or store has been connected.`)} className="flex min-h-20 min-w-0 cursor-pointer flex-col items-center gap-2 rounded-lg border border-transparent px-1 py-2 text-center hover:border-blue-400/30 hover:bg-blue-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
              <PlatformIcon platform={option.icon} /><span className="w-full break-words text-[11px] font-medium leading-4 text-secondary">{option.shortName ?? option.name}</span>
            </button>
          })}</div>
        </section>
      })}</div>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-xs leading-5 text-blue-300">{message || 'Available platforms are demo options. Selecting one does not authorize or connect an account.'}</p>
    </section>
    <ConnectionPicker dialogRef={dialogRef} onClose={() => returnFocusRef.current?.focus()} />
  </>
}
