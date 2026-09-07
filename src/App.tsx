import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { setSaveNamespace } from './engine/save'
import { setCurrentRuleset } from './engine/ruleset'

/**
 * `/` is the player career. The manager game and the card mode this project
 * was forked from stay reachable at `/manager` and `/cards` for reference;
 * they keep their own save namespaces.
 */
const PlayerGame = lazy(() => import('./PlayerGame'))
const ManagerGame = lazy(() => import('./ManagerGame'))
const CardMode = lazy(() => import('./ui/CardMode'))

type Mode = 'player' | 'manager' | 'cards'
const PATHS: Record<Mode, string> = { player: '/', manager: '/manager', cards: '/cards' }

const modeOf = (): Mode => {
  if (typeof location === 'undefined') return 'player'
  const p = location.pathname.replace(/\/+$/, '')
  if (p.endsWith('/cards')) return 'cards'
  if (p.endsWith('/manager')) return 'manager'
  return 'player'
}

export default function App() {
  const [mode, setModeRaw] = useState<Mode>(modeOf)
  if (mode === 'player') { setSaveNamespace('player'); setCurrentRuleset('vct-2025') }
  else { setSaveNamespace(''); setCurrentRuleset('vct-2025') }
  const setMode = useCallback((m: Mode) => {
    try {
      const to = PATHS[m]
      if (location.pathname !== to) history.pushState({}, '', to)
    } catch { /* sandboxed */ }
    setModeRaw(m)
  }, [])
  useEffect(() => {
    const onPop = () => setModeRaw(modeOf())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const loading = <div className="wrap" style={{ padding: 40 }}><p className="muted">载入中…</p></div>
  const page = mode === 'cards' ? <CardMode onExit={() => setMode('player')} />
    : mode === 'manager' ? <ManagerGame onHome={() => setMode('player')} />
      : <PlayerGame />
  return <Suspense fallback={loading}>{page}</Suspense>
}
