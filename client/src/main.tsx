import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { connectWordPressBrowser } from './services/wordpressFix'

// Consume a scoped one-use link before routing, even when there are no findings.
if (window.location.hash.startsWith('#wordpress-session=')) void connectWordPressBrowser().catch(() => { /* Protected controls remain manual when authorization fails. */ })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
