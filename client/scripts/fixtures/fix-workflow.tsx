// Browser test entry only. Uses the actual modal, service and protected backend.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { FixWithAIButton } from '../../src/components/recommendations/FixWithAIButton'
import { connectWordPressBrowser } from '../../src/services/wordpressFix'
import type { FixReviewRequest } from '../../src/types/fixReview'
const config = await fetch('/api/fix-fixture').then(response => response.json()) as { bootstrap: string; review: FixReviewRequest }
window.history.replaceState(null, '', window.location.pathname + new URL(config.bootstrap).hash)
await connectWordPressBrowser()
export default function Fixture() {
  const [receipt, setReceipt] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => { void fetch('/api/fix-fixture/receipts').then(response => response.json()).then(value => setReceipt(JSON.stringify(value, null, 2))) }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <main className="min-h-screen bg-canvas p-6 text-ink"><h1 className="mb-4 text-xl font-semibold">Offline Fix with AI browser fixture</h1><p className="mb-5 text-secondary">Actual application modal and protected API. WordPress and Muse transports are mocked; no live account is connected.</p>
    <FixWithAIButton review={config.review} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-white" />
    <pre className="mt-6 whitespace-pre-wrap text-xs text-secondary">{receipt}</pre>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
