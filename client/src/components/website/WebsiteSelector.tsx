import type { ConnectedWebsite } from '../../types/website'

export function WebsiteSelector({ websites, selectedId, onSelect }: { websites: ConnectedWebsite[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="min-w-0 sm:max-w-md">
      <label htmlFor="selected-website" className="mb-2 block text-sm font-medium text-secondary">Selected website</label>
      <select id="selected-website" value={selectedId} onChange={(event) => onSelect(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink">
        {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
      </select>
    </div>
  )
}
