import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { GameCtx } from './ui/ctx'
import { autosave, claimAutosave, hasAutosave, loadAutosave } from './engine/save'
import { dateLabel } from './engine/season'
import { formatOf, stageNameIn } from './engine/era'
import { ATTR_CN, ATTR_KEYS } from './engine/types'
import type { Fixture, GameState } from './engine/types'
import { advanceWeek } from './engine/me/week'
import { MeMatch } from './engine/me/matchplay'
import { advanceUntil, runAutoPilot } from './engine/me/auto'
import type { AdvanceUntil } from './engine/me/auto'
import Changelog from './ui/Changelog'
import { CHANGELOG_ME, LATEST_ME } from './data/changelog_me'
import { ladderLabel } from './engine/me/prepro'
import { fanTier, fansCn } from './engine/me/fans'
import { Crest, Modal, money } from './ui/common'
import NewCareer from './ui/me/NewCareer'
import Week from './ui/me/Week'
import MatchPlay from './ui/me/MatchPlay'
import MeScreen from './ui/me/MeScreen'
import TeamScreen from './ui/me/TeamScreen'
import LogScreen from './ui/me/LogScreen'
import TransferScreen from './ui/me/TransferScreen'
import EconomyScreen from './ui/me/EconomyScreen'
import AchievementsScreen from './ui/me/AchievementsScreen'
import AutoScreen from './ui/me/AutoScreen'
import PendingModal from './ui/me/Modals'
import Poster from './ui/me/Poster'
import Schedule from './ui/Schedule'
import Standings from './ui/Standings'
import MatchModal from './ui/MatchModal'
import PlayerModal from './ui/PlayerModal'
import ThemeToggle from './ui/ThemeToggle'

const SCREENS: { key: string; label: string; pro?: boolean; sep?: boolean }[] = [
  { key: 'week', label: '本周' },
  { key: 'me', label: '我的' },
  { key: 'team', label: '队伍', pro: true },
  { key: 'transfer', label: '转会' },
  { key: 'economy', label: '经济' },
  { key: 'schedule', label: '赛程', pro: true },
  { key: 'standings', label: '积分榜' },
  { key: 'awards', label: '成就' },
  { key: 'log', label: '日志' },
  { key: 'auto', label: '托管', sep: true },
]

/**
 * The player career, whole. The world and its engine are the manager game's;
 * this shell knows about weeks, whatever is waiting on me, and my club's matches.
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
  // what a multi-week run did on my behalf, shown once it stops
  const [summary, setSummary] = useState<{ until: AdvanceUntil; weeks: number; notes: string[]; ended: boolean } | null>(null)
  // the attribute strip under the overview; off is remembered per browser
  const [pins, setPinsRaw] = useState<boolean>(() => { try { return localStorage.getItem('val_player.pins') !== '0' } catch { return true } })
  const setPins = (f: (v: boolean) => boolean) => setPinsRaw((v) => { const n = f(v); try { localStorage.setItem('val_player.pins', n ? '1' : '0') } catch { /* private mode */ } return n })
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

  /** Run the week until it stops on my match, something waiting, the week's end, or the end of the road. */
  const advance = useCallback(() => {
    const g = gameRef.current
    if (!g?.me) return
    // whatever the dials cover is answered before the clock moves
    const did = runAutoPilot(g)
    if (did.length) toast(`托管：${did.slice(0, 2).join('；')}${did.length > 2 ? '…' : ''}`)
    if (g.me.pending.length) { commit(); return }
    const stop = advanceWeek(g)
    runAutoPilot(g)
    commit()
    if (stop.kind === 'match') {
      setLive(new MeMatch(g, stop.fixture))
    } else if (stop.kind === 'week-end') {
      setScreen((s) => (s === 'week' ? s : s))
      toast(`新的一周 · ${dateLabel(g)}`)
    }
  }, [commit, toast])

  /**
   * Run several weeks. Everything waiting is answered the steady way and
   * every match on the road is played by the numbers; what was done comes
   * back as a summary. "到下一场比赛" is the one run that hands me the match.
   */
  const advanceMany = useCallback((until: AdvanceUntil) => {
    const g = gameRef.current
    if (!g?.me) return
    const { stop, weeks, notes } = advanceUntil(g, until)
    commit()
    if (stop.kind === 'match') {
      if (notes.length) toast(`推进了 ${weeks} 周，替你处理了 ${notes.length} 件事，到你的比赛了。`)
      setLive(new MeMatch(g, stop.fixture))
      return
    }
    setSummary({ until, weeks, notes, ended: stop.kind === 'game-over' })
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
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const starter = !!team && team.starters.includes(me.id)
  const pending = !live ? me.pending[0] : undefined

  const Screen = screen === 'me' ? MeScreen
    : screen === 'team' && pro ? TeamScreen
      : screen === 'transfer' ? TransferScreen
        : screen === 'economy' ? EconomyScreen
          : screen === 'schedule' && pro ? Schedule
            : screen === 'standings' ? Standings
              : screen === 'awards' ? AchievementsScreen
                : screen === 'log' ? LogScreen
                  : screen === 'auto' ? AutoScreen
                    : null

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app">
        <header className="topbar">
          <button className="brand as-link" onClick={() => setScreen('week')}>
            VAL<span>选手生涯</span><em className="by">demo</em>
          </button>
          <div className="spacer" />
          <div className="chip" title="行动点"><span aria-hidden="true">⚡</span> <b>{me.ap}/{me.apMax}</b> <span className="muted">行动点</span></div>
        </header>

        {/* the corner: what changed in this build, and the numbers switch */}
        <Changelog entries={CHANGELOG_ME} latest={LATEST_ME} seenKey="valplayer.changelog.seen" foot="选手生涯 demo · 每一版改了什么都在这里，回看用" />
        <button className={`support-fab pins-fab${pins ? ' on' : ''}`} onClick={() => setPins((v) => !v)} title="显示或收起属性数字" aria-pressed={pins}>
          <span className="ico" aria-hidden="true">🔢</span>
          <span className="lbl">数值 {pins ? '开' : '关'}</span>
        </button>

        {/* who I am, where I am, and the six numbers that matter — the rest of
            the numbers live one row down and can be switched off */}
        <section className="hero" aria-label="总览">
          <div className="hero-row">
            <div className="hero-who">
              <b className="hero-name">{p.ign}</b>
              <span className="muted">{p.role} · {p.age} 岁</span>
            </div>
            <div className="hero-club">
              {team ? (
                <>
                  <span className="muted">效力</span>
                  <Crest id={game.myTeam} size={20} />
                  <b>{team.name}</b>
                  <span className={`tag ${team.tier === 1 ? 't1' : 't2'}`}>{formatOf(game.year) === 'open' ? (team.tier === 1 ? '一线' : '二线') : team.tier === 1 ? 'VCT' : '挑战者联赛'}</span>
                  <span className="muted">·</span>
                  {me.trial ? <b style={{ color: 'var(--accent)' }}>试用中</b> : starter ? <b style={{ color: 'var(--win)' }}>首发</b> : <b style={{ color: 'var(--loss)' }}>替补</b>}
                  <span className="muted">· 本季首发 {me.seasonStart.starts}/{me.seasonStart.matches} · 胜 {me.seasonStart.wins}</span>
                </>
              ) : (
                <b>{me.phase === 'retired' ? '已退役' : me.phase === 'free' ? '自由人' : '自由身'}</b>
              )}
            </div>
          </div>
          <div className="hero-stage">
            <small>{game.year}</small>
            <b>{stageNameIn(game.year, game.stage)}</b>
            <span className="muted">{dateLabel(game)} · 第 {Math.floor(game.day / 7)} 周</span>
          </div>
          <div className="tiles">
            <div className="tile"><small>冠军</small><b>{me.seasons.reduce((s, x) => s + x.titles.length, 0)}</b></div>
            <div className="tile"><small>段位</small><b>{me.phase === 'retired' ? '—' : ladderLabel(me.pre?.ladder ?? 0)}</b></div>
            <div className="tile"><small>粉丝</small><b>{fanTier(me.fans).name}<em>{fansCn(me.fans)}</em></b></div>
            <div className="tile"><small>资金</small><b>{money(me.money)}</b></div>
            <div className={`tile ${p.fatigue >= 60 ? 'dn' : ''}`}><small>体力</small><b>{Math.round(100 - p.fatigue)}<em>/100</em></b></div>
            <div className={`tile ${p.form >= 78 ? 'up' : p.form <= 60 ? 'dn' : ''}`}><small>状态</small><b>{p.form >= 78 ? '火热' : p.form >= 68 ? '正常' : p.form >= 60 ? '一般' : '低迷'}<em>{Math.round(p.form)}</em></b></div>
          </div>
        </section>

        {game.timelinePause && (
          <div className="small" style={{ margin: '10px 0', padding: '10px 14px', border: '1px solid var(--accent)', borderRadius: 8 }}>
            <b>时间线暂停</b> · {game.timelinePause}
          </div>
        )}

        {pins && (
          <div className="pinbar" role="status" aria-label="属性">
            {ATTR_KEYS.map((k) => (
              <span key={k} className="pin"><span>{ATTR_CN[k]}</span><b>{p.attrs[k]}</b></span>
            ))}
            <span className="sep" />
            <span className="pin"><span>综合</span><b>{p.overall}</b></span>
            <span className="pin"><span>心态</span><b>{Math.round(me.mental)}</b></span>
            <span className="pin"><span>体质</span><b>{Math.round(me.body)}</b></span>
            <span className="sep" />
            <span className={`pin ${p.fatigue >= 60 ? 'dn' : ''}`}><span>疲劳</span><b>{Math.round(p.fatigue)}</b></span>
            <span className={`pin ${me.tilt >= 55 ? 'dn' : ''}`}><span>气压</span><b>{Math.round(me.tilt)}</b></span>
          </div>
        )}

        <div className="body">
          <nav className="nav">
            {SCREENS.filter((s) => !s.pro || pro).map((s) => (
              <div key={s.key}>
                {s.sep && <div className="nav-group">—</div>}
                <button className={`nav-item ${screen === s.key ? 'active' : ''}`} onClick={() => setScreen(s.key)}>{s.label}</button>
              </div>
            ))}
            <div className="nav-foot"><ThemeToggle compact /></div>
          </nav>
          <main className="main" id="main" ref={mainRef}>
            {me.phase === 'retired' ? (
              <>
                <Poster />
                <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                  <button onClick={() => { gameRef.current = null; bump() }}>再来一局</button>
                </div>
                {Screen && screen !== 'week' && <div style={{ marginTop: 16 }}><Screen /></div>}
              </>
            ) : Screen ? <Screen /> : <Week onAdvance={advance} onAdvanceUntil={advanceMany} />}
          </main>
        </div>

        {playerId && <PlayerModal playerId={playerId} onClose={() => setPlayerId(null)} />}
        {fixture && <MatchModal fixture={fixture} onClose={() => setFixture(null)} />}
        {summary && (
          <Modal title={`推进总结 · ${summary.weeks} 周 · 到${summary.until === 'season' ? '赛季末' : summary.until === 'stage' ? '赛段末' : '这里'}`} onClose={() => setSummary(null)} onBgClose={() => setSummary(null)}>
            <p className="small muted" style={{ marginTop: 0 }}>
              现在是 {dateLabel(game)} · {stageNameIn(game.year, game.stage)}。{summary.ended ? (game.timelinePause ?? '生涯到头了。') : '这几周里没手动安排的都按推荐排了；下面是替你做的决定和打过的比赛。'}
            </p>
            {summary.notes.length === 0
              ? <p className="muted">一路没有需要拿主意的事。</p>
              : <ul className="diary">{summary.notes.map((n, i) => <li key={i}><span>{n}</span></li>)}</ul>}
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="primary" onClick={() => setSummary(null)}>继续</button>
            </div>
          </Modal>
        )}
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
        {pending && (
          <PendingModal
            key={`${pending.kind}:${pending.id ?? ''}:${pending.day}`}
            item={pending}
            onDone={() => {
              commit()
              // a week that stopped on this goes on once it is answered
              const g = gameRef.current
              if (g?.me && !g.me.pending.length && g.me.weekDay > 0 && g.me.weekDay < 7) window.setTimeout(advance, 0)
              else bump()
            }}
          />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
