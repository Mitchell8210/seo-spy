import { useRef } from 'react'
import { ChartColumn, Globe, Plus, Search } from 'lucide-react'
import { FacebookMark } from '../common/FacebookMark'
import { StatusBadge } from '../common/StatusBadge'
import { ConnectionPicker } from './ConnectionPicker'
import { mockSettingsAssets } from '../../data/mockSettings'

const icons = { website: Globe, facebook: Globe, search: Search, analytics: ChartColumn }

export function ConnectedAssetsSettings() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="mt-2 text-sm leading-6 text-secondary">Connect and manage your websites, social pages, and marketing accounts in one place.</p><p className="mt-3 text-xs leading-6 text-muted">Mock connections only. No accounts are being accessed or synced.</p></div>
        <button ref={addButtonRef} type="button" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-blue-500 bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-950/25 hover:bg-blue-700"><Plus size={18} aria-hidden="true" />Add Connection</button>
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">{mockSettingsAssets.filter((asset) => asset.status === 'Connected').map((asset) => {
        const Icon = icons[asset.kind]
        const connected = asset.status === 'Connected'
        return (
          <article key={asset.id} className="flex min-w-0 flex-col rounded-2xl border border-line bg-elevated p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              {asset.kind === 'facebook' ? <span className="[&>span]:size-14 [&_svg]:size-9"><FacebookMark /></span> : asset.kind === 'search' ? <span className="flex size-14 items-center justify-center rounded-xl bg-white" aria-hidden="true"><svg viewBox="0 0 24 24" className="size-9"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.7 4.7 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H2.9v2.6A10.1 10.1 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.9a6 6 0 0 1 0-3.8V7.5H2.9a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10.1 10.1 0 0 0-9.1 5.5l3.4 2.6C7.1 7.7 9.4 5.9 12 5.9Z"/></svg></span> : <span className={`flex size-14 shrink-0 items-center justify-center rounded-xl border ${asset.kind === 'analytics' ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-blue-400/25 bg-blue-500/15 text-blue-300'}`}><Icon size={30} aria-hidden="true" /></span>}
              <StatusBadge label={asset.status} tone={connected ? 'success' : 'neutral'} />
            </div>
            <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-ink">{asset.name}</h3><p className="mt-1 break-words text-sm leading-6 text-secondary [overflow-wrap:anywhere]">{asset.kind === 'website' ? new URL(asset.detail).hostname : asset.detail}</p>{asset.checkedAt && <p className="mt-2 text-xs leading-5 text-muted">{asset.timeLabel} (mock): <time dateTime={asset.checkedAt}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(asset.checkedAt))} Pacific</time></p>}</div>
            <div className="mt-4">{!connected && <button type="button" aria-label={`Connect ${asset.name}`} onClick={() => dialogRef.current?.showModal()} className="min-h-11 rounded-lg border border-blue-400/30 px-4 text-sm font-semibold text-blue-300 hover:bg-blue-400/10">Connect</button>}</div>
          </article>
        )
      })}</div>
      <ConnectionPicker dialogRef={dialogRef} onClose={() => addButtonRef.current?.focus()} />
    </>
  )
}
