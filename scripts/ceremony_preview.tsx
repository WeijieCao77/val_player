/**
 * Play one ceremony on demand.
 *
 *   npm run dev  →  /ceremony-preview.html?k=draw
 *   (draw|depart|final|media|rehab|farewell|awards|showmatch|patch|tryout|retire)
 *   &weeks=N  run that many weeks first (retire reads the seasons behind it)
 *   &won=0    awards: nominated, not won
 *
 * Builds a career, forces the ceremony open, and mounts the real modal with
 * the real game context — so what is on screen is what a player would get.
 * Dev only; the build's only entry is index.html.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { cerStart } from '../src/engine/me/ceremony'
import CeremonyModal from '../src/ui/me/Ceremony'
import PendingModal from '../src/ui/me/Modals'
import { startTryout } from '../src/engine/me/tryout'
import { GameCtx } from '../src/ui/me/ctx'
import type { CerKind } from '../src/engine/me/types'
import '../src/styles.css'
import '../src/me.css'

const KINDS: CerKind[] = ['draw', 'depart', 'final', 'media', 'rehab', 'farewell', 'awards', 'showmatch', 'patch', 'tryout', 'retire']

const q = new URLSearchParams(location.search)
const kind = (q.get('k') ?? 'draw') as CerKind
const about = q.get('about') ?? ({
  draw: '2027 冠军赛', depart: '柏林', final: '冠军赛 总决赛', media: '第一赛段', rehab: '腱鞘炎复发', farewell: '2035 赛季',
  awards: 'Challengers EMEA', showmatch: '巴黎', patch: '', tryout: '', retire: '',
} as Record<CerKind, string>)[kind] ?? ''

// 2026 opens on the real 2026, whose Chinese second-tier clubs play their first event in the summer
const state = createCareer({
  name: 'Probe', region: 'Europe', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7,
})
const weeks = Number(q.get('weeks') ?? 30)
for (let i = 0; i < weeks; i++) if (autoWeek(state).kind === 'game-over') break
state.me!.cer = undefined
state.me!.pending = []
// ?modal=tryout puts the four-day tryout on screen instead of a ceremony
const asTryout = q.get('modal') === 'tryout'
const trialClub = Object.values(state.teams).find((t) => t.tier === 2 && t.id !== state.myTeam)!.id
if (asTryout) {
  const inv = state.me!.pre.invites[0]
  const teamId = inv?.teamId ?? trialClub
  state.me!.tryout = { inviteId: inv?.id ?? 'probe', teamId, startDay: state.day, step: 0, score: 0, log: [] }
  state.me!.pending = [{ kind: 'tryout', id: inv?.id ?? 'probe', day: state.day }]
  void startTryout
} else {
  if (kind === 'awards') {
    const won = q.get('won') !== '0'
    state.me!.awards = [
      { year: state.year, key: 'role', name: '最佳决斗者', league: about, won, winner: won ? 'Probe' : 'kozzy', winnerTeam: '', nominees: won ? ['Probe', 'kozzy', 'runneR'] : ['kozzy', 'Probe', 'runneR'], rating: 1.21 },
      { year: state.year, key: 'mvp', name: '年度最佳选手', league: about, won: false, winner: 'kozzy', winnerTeam: '', nominees: ['kozzy', 'Probe', 'Lime'], rating: 1.21 },
    ]
  }
  if (kind === 'tryout') {
    state.me!.tryout = { inviteId: 'probe', teamId: trialClub, startDay: state.day, step: 0, score: 0, log: [] }
  }
  cerStart(state, kind, kind === 'tryout' ? state.teams[trialClub].name : about)
}

function Harness() {
  const [n, setN] = useState(0)
  const [log, setLog] = useState<string[]>([])
  return (
    <GameCtx.Provider value={{
      game: state,
      commit: () => setN((k) => k + 1),
      toast: (t: string) => setLog((l) => [...l, t]),
      openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
    }}>
      <div style={{ padding: 20 }}>
        <p className="small">仪式 <b>{kind}</b> · 第 {n} 次提交 · 换一个：
          {KINDS.map((k) => (
            <a key={k} href={`?k=${k}`} style={{ marginLeft: 8 }}>{k}</a>
          ))}
        </p>
        {asTryout && state.me!.pending[0]
          ? <PendingModal item={state.me!.pending[0]} onDone={() => setN((x) => x + 1)} />
          : state.me!.cer
          ? <CeremonyModal onDone={() => setN((x) => x + 1)} />
          : <div className="card">
            <p>仪式已结束。日志最后三条：</p>
            <ul>{state.me!.log.slice(-3).map((l, i) => <li key={i} dangerouslySetInnerHTML={{ __html: l.text }} />)}</ul>
            <p className="tiny muted">{log.join(' · ')}</p>
          </div>}
      </div>
    </GameCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
