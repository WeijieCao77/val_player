import { lazy, Suspense } from 'react'
import { setSaveNamespace } from './engine/save'
import { setCurrentRuleset } from './engine/ruleset'

/**
 * The site is the player career and nothing else. The manager game and the
 * card mode this project was forked from are no longer routed or built; their
 * sources stay in the repo only until the engine split is done. An old
 * /manager or /cards link opens the career (server.js sends it to /).
 */
const PlayerGame = lazy(() => import('./PlayerGame'))

export default function App() {
  setSaveNamespace('player')
  setCurrentRuleset('vct-2025')
  const loading = <div className="wrap" style={{ padding: 40 }}><p className="muted">载入中…</p></div>
  return <Suspense fallback={loading}><PlayerGame /></Suspense>
}
