import { Check, Globe, Share2 } from 'lucide-react'
import type { Connection } from '../../types/dashboard'

export function ConnectionCard({ connection }: { connection: Connection }) {
  const Icon = connection.platform === 'website' ? Globe : Share2
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Icon size={18} className="shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 basis-40 break-words text-sm font-medium text-ink">
        {connection.platform === 'facebook' ? `Facebook — ${connection.identity}` : connection.identity}
      </span>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300"><Check size={14} aria-hidden="true" />{connection.status}</span>
    </li>
  )
}
