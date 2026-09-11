/**
 * The team screen, at whatever point in a career you ask for.
 *
 *   npm run dev  →  /team-preview.html?seasons=9&seed=7
 *
 * 话语权 only opens after eight or nine seasons, so looking at it by playing
 * there is not practical. Dev only; the build's only entry is index.html.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { cloutBreakdown } from '../src/engine/me/clout'
import TeamScreen from '../src/ui/me/TeamScreen'
import { GameCtx } from '../src/ui/me/ctx'
import '../src/ui/me/base.css'
import '../src/me.css'

const q = new URLSearchParams(location.search)
const seasons = Number(q.get('seasons') ?? 9)
const seed = Number(q.get('seed') ?? 7)

const state = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
})
const y0 = state.year
let guard = 0
while (state.year - y0 < seasons && guard++ < 60 * seasons) {
  if (autoWeek(state).kind === 'game-over') break
}
// force the gates open so both panels can be looked at
if (q.get('force') === '1') {
  state.me!.coachTrust = 82
  state.me!.gmTrust = 88
}

function Harness() {
  const [, setN] = useState(0)
  const [toast, setToast] = useState('')
  const { total } = cloutBreakdown(state)
  return (
    <GameCtx.Provider value={{
      game: state,
      commit: () => setN((k) => k + 1),
      toast: (t: string) => setToast(t),
      openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
    }}>
      <div style={{ padding: 16, maxWidth: 1180, margin: '0 auto' }}>
        <p className="small">
          {state.year} · {state.me!.seasons.length} 季 · 威望 {total} · 教练 {Math.round(state.me!.coachTrust)} · 经理 {Math.round(state.me!.gmTrust)}
          {toast && <b style={{ marginLeft: 12, color: 'var(--accent)' }}>{toast}</b>}
        </p>
        <TeamScreen />
      </div>
    </GameCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
