import { Menu, X } from 'lucide-react'
import { SpyLogo } from '../common/SpyLogo'

type HeaderProps = {
  mobileOpen: boolean
  onToggleNavigation: () => void
}

export function Header({ mobileOpen, onToggleNavigation }: HeaderProps) {
  return (
    <header className="flex h-20 items-center justify-between border-b border-line bg-shell px-5 sm:px-8 lg:ml-64 lg:px-10">
      <span className="flex items-center gap-3 text-xl font-bold tracking-tight text-ink lg:hidden">
        <SpyLogo /><span>SEO <span className="text-blue-400">Spy</span></span>
      </span>
      <span className="hidden text-sm font-medium text-secondary lg:block">Business intelligence</span>
      <button
        type="button"
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
        onClick={onToggleNavigation}
        className="flex size-11 items-center justify-center rounded-lg border border-line text-secondary hover:bg-canvas lg:hidden"
      >
        {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
    </header>
  )
}
