import { NavLink } from 'react-router'
import { SpyLogo } from '../common/SpyLogo'
import { navigation } from './navigation'

type SidebarProps = {
  mobileOpen: boolean
  onNavigate: () => void
}

export function Sidebar({ mobileOpen, onNavigate }: SidebarProps) {
  return (
    <aside className="border-b border-line bg-shell lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-64 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="hidden h-20 shrink-0 items-center border-b border-line px-7 lg:flex">
        <NavLink to="/dashboard" onClick={onNavigate} className="flex items-center gap-3 rounded-sm text-2xl font-bold tracking-tight text-ink" aria-label="SEO Spy home">
          <SpyLogo /><span>SEO <span className="text-blue-400">Spy</span></span>
        </NavLink>
      </div>
      <nav
        id="primary-navigation"
        aria-label="Primary navigation"
        className={`${mobileOpen ? 'block' : 'hidden'} px-4 py-5 lg:block lg:px-4 lg:py-7`}
      >
        <ul className="space-y-1.5">
          {navigation.map(({ path, label, icon: Icon }) => (
            <li key={path}>
              <NavLink
                to={path}
                end
                onClick={onNavigate}
                className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm ${isActive ? 'bg-blue-950 font-semibold text-blue-300' : 'font-medium text-secondary hover:bg-elevated hover:text-ink'}`}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
