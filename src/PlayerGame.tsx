import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { GameCtx } from './ui/ctx'
import { autosave, claimAutosave, hasAutosave, loadAutosave } from './engine/save'
import { dateLabel, stageName } from './engine/season'
import { ATTR_CN, ATTR_KEYS } from './engine/types'
import type { Fixture, GameState } from './engine/types'
import { advanceWeek } from './engine/me/week'
import { MeMatch } from './engine/me/matchplay'
import { Crest, money } from './ui/common'
import NewCareer from './ui/me/NewCareer'
import Week from './ui/me/Week'
import MatchPlay from './ui/me/MatchPlay'
import MeScreen from './ui/me/MeScreen'
import TeamScreen from './ui/me/TeamScreen'
import LogScreen from './ui/me/LogScreen'
import Schedule from './ui/Schedule'
import Standings from './ui/Standings'
import MatchModal from './ui/MatchModal'
import PlayerModal from './ui/PlayerModal'
import ThemeToggle from './ui/ThemeToggle'

const SCREENS: { key: string; label: string }[] = [
  { key: 'week', label: '本周' },
  { key: 'me', label: '我的' },
  { key: 'team', label: '队伍' },
  { key: 'schedule', label: '赛程' },
  { key: 'standings', label: '积分榜' },
  { key: 'log', label: '日志' },
]

/**
 * The player career, whole. The world and its engine are the manager game's;
 * this shell only knows about weeks, my club's matches and me.
 */
export default function PlayerGame() {
  const gameRef = useRef<GameState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [screen, setScreen] = useState('week')
  const [booted, setBooted] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [live, setLive] = useState<MeMatch | null>(null)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => { setBooted(true) }, [])
  useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [screen])

  const commit = useCallback(() => {
    bump()
    const g = gameRef.current
    if (!g) return
    try { autosave(g) } catch { /* storage full or blocked; the game goes on in memory */ }
  }, [])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3200)
  }, [])

  const start = useCallback((g: GameState) => {
    gameRef.current = g
    claimAutosave(g)
    setScreen('week')
    commit()
  }, [commit])

  /** Run the week until it stops on my match, the week's end, or the end of the road. */
  const advance = useCallback(() => {
    const g = gameRef.current
    if (!g?.me) return
    const stop = advanceWeek(g)
    commit()
    if (stop.kind === 'match') {
      setLive(new MeMatch(g, stop.fixture))
    } else if (stop.kind === 'week-end') {
      setScreen('week')
      toast(`新的一周 · ${dateLabel(g)}`)
    }
  }, [commit, toast])

  const ctxValue = useMemo(() => ({
    game: gameRef.current!,
    commit,
    toast,
    openPlayer: (id: string) => setPlayerId(id),
    loadSlot: () => {},
    openMatch: setFixture,
    playLive: () => {},
    go: setScreen,
    startTutorial: () => {},
    openDraw: () => {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [commit, toast, gameRef.current, screen])

  if (!booted) return null
  const game = gameRef.current
  if (!game || !game.me) {
    return (
      <NewCareer
        onStart={start}
        canContinue={hasAutosave()}
        onContinue={() => {
          const g = loadAutosave()
          if (g?.me) start(g)
          else toast('没有找到可用的存档。')
        }}
      />
    )
  }

  const me = game.me
  const p = game.players[me.id]
  const team = game.teams[game.myTeam]
  const starter = team.starters.includes(me.id)

  const Screen = screen === 'me' ? MeScreen
    : screen === 'team' ? TeamScreen
      : screen === 'schedule' ? Schedule
        : screen === 'standings' ? Standings
          : screen === 'log' ? LogScreen
            : null

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app">
        <header className="topbar">
          <button className="brand as-link" onClick={() => setScreen('week')}>
            VAL<span>选手生涯</span><em className="by">demo</em>
          </button>
          <div className="chip own" title="你">
            <b>{p.ign}</b> <span className="muted">{p.role} · {p.age} 岁</span>
          </div>
          <div className="chip brand-club" title="所属俱乐部">
            <Crest id={game.myTeam} size={20} />
            <b>{team.name}</b>
            <span className={`tag ${team.tier === 1 ? 't1' : 't2'}`}>{team.tier === 1 ? 'VCT' : 'CHAL'}</span>
          </div>
          <div className="chip">{dateLabel(game)}</div>
          <div className="chip">{stageName(game.stage)}</div>
          <div className="chip" title="本周教练的名单">
            {me.trial ? <b style={{ color: 'var(--accent)' }}>试用中</b> : starter ? <b style={{ color: 'var(--win)' }}>首发</b> : <b style={{ color: 'var(--loss)' }}>替补</b>}
          </div>
          <div className="spacer" />
          <div className="chip" title="行动点"><span aria-hidden="true">⚡</span> <b>{me.ap}/{me.apMax}</b></div>
          <div className="chip" title="粉丝"><span aria-hidden="true">👥</span> <b>{Math.round(me.fans)}</b></div>
          <div className="chip" title="存款"><span aria-hidden="true">💰</span> <b>{money(me.money)}</b></div>
        </header>
        <div className="pinbar" role="status" aria-label="属性">
          {ATTR_KEYS.map((k) => (
            <span key={k} className="pin"><span>{ATTR_CN[k]}</span><b>{p.attrs[k]}</b></span>
          ))}
          <span className="sep" />
          <span className="pin"><span>综合</span><b>{p.overall}</b></span>
          <span className="pin"><span>心态</span><b>{Math.round(me.mental)}</b></span>
          <span className="pin"><span>体质</span><b>{Math.round(me.body)}</b></span>
          <span className="sep" />
          <span className={`pin ${p.form >= 78 ? 'up' : p.form <= 60 ? 'dn' : ''}`}><span>状态</span><b>{Math.round(p.form)}</b></span>
          <span className={`pin ${p.fatigue >= 60 ? 'dn' : ''}`}><span>疲劳</span><b>{Math.round(p.fatigue)}</b></span>
          <span className={`pin ${me.tilt >= 55 ? 'dn' : ''}`}><span>气压</span><b>{Math.round(me.tilt)}</b></span>
        </div>

        <div className="body">
          <nav className="nav">
            {SCREENS.map((s) => (
              <div key={s.key}>
                <button className={`nav-item ${screen === s.key ? 'active' : ''}`} onClick={() => setScreen(s.key)}>{s.label}</button>
              </div>
            ))}
            <div className="nav-foot"><ThemeToggle compact /></div>
          </nav>
          <main className="main" id="main" ref={mainRef}>
            {Screen ? <Screen /> : <Week onAdvance={advance} />}
            {game.gameOver && (
              <div className="panel alert" style={{ marginTop: 16 }}>
                <div className="panel-head"><h2>生涯结束</h2></div>
                <div className="panel-body">
                  <p className="small">{game.gameOver}</p>
                  <button onClick={() => { gameRef.current = null; bump() }}>重新开始</button>
                </div>
              </div>
            )}
          </main>
        </div>

        {playerId && <PlayerModal playerId={playerId} onClose={() => setPlayerId(null)} />}
        {fixture && <MatchModal fixture={fixture} onClose={() => setFixture(null)} />}
        {live && (
          <MatchPlay
            key={live.fixture.id}
            mm={live}
            onDone={() => {
              setLive(null)
              commit()
              // the week goes on from the day after the match
              window.setTimeout(advance, 0)
            }}
          />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
