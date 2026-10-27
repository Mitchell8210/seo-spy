import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { navigation } from './components/layout/navigation'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        {navigation.map(({ path, label }) => (
          <Route
            key={path}
            path={path}
            element={<h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{label}</h1>}
          />
        ))}
        <Route path="*" element={<h1 className="text-2xl font-semibold text-slate-950">Page not found</h1>} />
      </Route>
    </Routes>
  )
}

export default App
