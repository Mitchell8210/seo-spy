import { Menu, X } from 'lucide-react'

type HeaderProps = {
  mobileOpen: boolean
  onToggleNavigation: () => void
}

export function Header({ mobileOpen, onToggleNavigation }: HeaderProps) {
  return (
    <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8 lg:ml-64 lg:px-10">
      <span className="text-xl font-bold tracking-tight text-slate-950 lg:hidden">
        SEO <span className="text-blue-700">Spy</span>
      </span>
      <span className="hidden text-sm font-medium text-slate-600 lg:block">Business intelligence</span>
      <button
        type="button"
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
        onClick={onToggleNavigation}
        className="flex size-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
      >
        {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
    </header>
  )
}
