/**
 * A 2021 season's standings and schedule, at whatever day you ask for.
 *
 *   npm run dev  →  /circuit-preview.html?day=160&region=China&start=chal&seed=11
 *
 * A career stops the clock at every one of its club's matches, so reaching
 * Berlin by clicking means playing every group game on the way. This runs the
 * headless week loop to the day and renders the two pages that show the real
 * calendar. Dev only; the build's only entry is index.html.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import Standings from '../src/ui/me/Standings'
import Schedule from '../src/ui/me/Schedule'
import { GameCtx } from '../src/ui/me/ctx'
import type { Region } from '../src/engine/types'
import '../src/styles.css'
import '../src/me.css'

const q = new URLSearchParams(location.search)
const day = Number(q.get('day') ?? 160)
const seed = Number(q.get('seed') ?? 11)
const region = (q.get('region') ?? 'China') as Region
const start = (q.get('start') ?? 'chal') as StartPoint

const state = createCareer({
  name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2021,
})
let guard = 0
while (state.year === 2021 && state.day < day && guard++ < 60) {
  if (autoWeek(state).kind === 'game-over') break
}

function Harness() {
  const [, setN] = useState(0)
  const [tab, setTab] = useState<'standings' | 'schedule'>((q.get('tab') as 'schedule') ?? 'standings')
  return (
    <GameCtx.Provider value={{
      game: state,
      commit: () => setN((k) => k + 1),
      toast: () => {},
      openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
    }}>
      <div style={{ padding: 16, maxWidth: 1180, margin: '0 auto' }}>
        <p className="small">
          {state.year} 年第 {state.day} 天 · {state.teams[state.myTeam]?.name}（{region}）·
          <button className={tab === 'standings' ? 'on' : ''} onClick={() => setTab('standings')} style={{ marginLeft: 8 }}>积分榜</button>
          <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')} style={{ marginLeft: 4 }}>赛程</button>
        </p>
        {tab === 'standings' ? <Standings /> : <Schedule />}
      </div>
    </GameCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
