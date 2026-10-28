import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { navigation } from './components/layout/navigation'
import { Dashboard } from './pages/Dashboard/Dashboard'
import { Website } from './pages/Website/Website'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
        {navigation.map(({ path, label }) => (
          <Route
            key={path}
            path={path}
            element={path === '/dashboard' ? <Dashboard /> : path === '/website' ? <Website /> : <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{label}</h1>}
          />
        ))}
        <Route path="*" element={<h1 className="text-2xl font-semibold text-ink">Page not found</h1>} />
      </Route>
    </Routes>
  )
}

export default App
