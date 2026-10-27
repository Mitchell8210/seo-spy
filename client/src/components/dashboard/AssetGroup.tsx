import { Plus } from 'lucide-react'
import type { Connection } from '../../types/dashboard'
import { ConnectionCard } from './ConnectionCard'

export function AssetGroup({ title, action, connections }: { title: string; action: string; connections: Connection[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <h3 className="text-sm font-semibold text-ink">{title}<span className="ml-2 rounded-md bg-elevated px-2 py-0.5 text-xs text-secondary">{connections.length}</span></h3>
        <button disabled type="button" title="Not available in this demo" className="inline-flex min-h-9 items-center gap-1 rounded-md text-xs font-medium text-muted disabled:cursor-not-allowed"><Plus size={14} aria-hidden="true" />{action}</button>
      </div>
      <ul className="divide-y divide-line">{connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} />)}</ul>
    </section>
  )
}
