import { useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  function handleNavigate() {
    setMobileOpen(false)
    mainRef.current?.focus()
  }

  return (
    <div className="min-h-dvh bg-canvas" onKeyDown={(event) => {
      if (event.key === 'Escape' && mobileOpen) {
        setMobileOpen(false)
        document.querySelector<HTMLButtonElement>('[aria-controls="primary-navigation"]')?.focus()
      }
    }}>
      <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white focus:not-sr-only">Skip to content</a>
      <Header mobileOpen={mobileOpen} onToggleNavigation={() => setMobileOpen((open) => !open)} />
      <Sidebar mobileOpen={mobileOpen} onNavigate={handleNavigate} />
      <main ref={mainRef} id="main-content" tabIndex={-1} className="min-w-0 px-5 py-10 focus:outline-none sm:px-8 lg:ml-64 lg:px-10 lg:py-12">
        <div key={pathname} className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
