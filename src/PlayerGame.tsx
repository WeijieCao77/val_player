import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { GameCtx } from './ui/ctx'
import { autosave, claimAutosave, hasAutosave, loadAutosave } from './engine/save'
import { dateLabel, resumeTimeline } from './engine/season'
import { formatOf, onTimeline, stageNameIn } from './engine/era'
import { ATTR_CN, ATTR_KEYS } from './engine/types'
import type { Fixture, GameState } from './engine/types'
import { advanceTurn, carriesOn, weekCalendar, weekInDays, weekMatches } from './engine/me/week'
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
import AchPop from './ui/me/AchPop'
import AutoScreen from './ui/me/AutoScreen'
import PendingModal from './ui/me/Modals'
import Poster from './ui/me/Poster'
import Schedule from './ui/Schedule'
import Standings from './ui/Standings'
import MatchModal from './ui/MatchModal'
import PlayerModal from './ui/PlayerModal'
import ThemeToggle from './ui/ThemeToggle'
import { attrWord, useNumbers } from './ui/me/words'
import { ceilingsOf, ensureCeilings } from './engine/me/bottleneck'
import HelpScreen from './ui/me/HelpScreen'
import Tour from './ui/me/Tour'
import { openTour, weekTourOf } from './ui/me/guide'

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
  { key: 'help', label: '帮助' },
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
  // numbers or words (世界级 · 顶级 · 一流) on every attribute; remembered per browser, see ui/me/words.ts
  const [nums, setNums] = useNumbers()
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

  /** Whatever the dials cover is answered, and said so, before the clock moves. */
  const answerDials = useCallback((g: GameState) => {
    const did = runAutoPilot(g)
    if (did.length) toast(`托管：${did.slice(0, 2).join('；')}${did.length > 2 ? '…' : ''}`)
  }, [toast])

  /**
   * One press: the rest of the week, or one day of a match week (engine/me/week.ts
   * weekInDays) — until it stops on my match, something waiting, the end of the
   * day or the week, or the end of the road.
   */
  const advance = useCallback(() => {
    const g = gameRef.current
    if (!g?.me) return
    answerDials(g)
    if (g.me.pending.length) { commit(); return }
    const inDays = weekInDays(g)
    const stop = advanceTurn(g)
    runAutoPilot(g)
    commit()
    if (stop.kind === 'match') {
      setLive(new MeMatch(g, stop.fixture))
    } else if (stop.kind === 'week-end') {
      toast(`新的一周 · ${dateLabel(g)}${weekInDays(g) ? ` · 这周 ${weekMatches(g).length} 场比赛，一天一推` : ''}`)
    } else if (stop.kind === 'day') {
      // the week turned under the run: say why it stopped on a day with nothing in it
      if (!inDays) { toast(`这周排进了第 ${weekMatches(g).length} 场比赛，接下来一天一推${weekCalendar(g).some((d) => d.next && d.day === g.day) ? '，今天就有一场' : ''}。`); return }
      const tomorrow = weekCalendar(g).find((d) => d.day === g.day + 1)?.matches[0]
      const opp = tomorrow && g.teams[tomorrow.teamA === g.myTeam ? tomorrow.teamB : tomorrow.teamA]
      toast(`${dateLabel(g)}${opp ? ` · 明天打 ${opp.tag}` : ''}`)
    }
  }, [answerDials, commit, toast])

  /** A match or a decision the clock stopped on is done: the week goes on by itself, or waits for the next press. */
  const afterStop = useCallback(() => {
    const g = gameRef.current
    if (!g?.me) return
    answerDials(g)
    commit()
    if (carriesOn(g)) window.setTimeout(advance, 0)
  }, [advance, answerDials, commit])

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
    // the week screen's tour for where the career is now (ui/me/guide.ts); 帮助 opens the others
    startTutorial: () => openTour(weekTourOf(gameRef.current)),
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
          // a save that stopped at the edge of the timeline carries on from the same day once this build can play the year
          // a save from before the eight ceilings gets them now, not at the end of its first week
          if (g?.me) { resumeTimeline(g); ensureCeilings(g); start(g) }
          else toast('没有找到可用的存档。')
        }}
      />
    )
  }

  const me = game.me
  const p = game.players[me.id]
  const caps = ceilingsOf(p)
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
                    : screen === 'help' ? HelpScreen
                      : null

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app career">
        <header className="topbar">
          <button className="brand as-link" onClick={() => setScreen('week')}>
            VAL<span>选手生涯</span><em className="by">demo</em>
          </button>
          <div className="spacer" />
        </header>

        {/* the corner: what changed in this build, and the numbers switch */}
        <Changelog entries={CHANGELOG_ME} latest={LATEST_ME} seenKey="valplayer.changelog.seen" foot="选手生涯 demo · 每一版改了什么都在这里，回看用" />
        <button className={`support-fab pins-fab${nums ? ' on' : ''}`} onClick={() => setNums(!nums)} title={nums ? '切回文字描述：世界级、顶级、一流……' : '显示具体数值'} aria-pressed={nums}>
          <span className="ico" aria-hidden="true">🔢</span>
          <span className="lbl">数值 {nums ? '开' : '关'}</span>
        </button>

        {/* who I am, where I am, and the six numbers that matter — the rest
            live one row down, as numbers or as words */}
        <section className="hero" aria-label="总览">
          <div className="hero-row">
            <div className="hero-who">
              <b className="hero-name">{p.ign}</b>
              <span className="muted">{p.role} · {p.age} 岁</span>
            </div>
            <div className="hero-club">
              {team ? (
                <>
                  <Crest id={game.myTeam} size={20} />
                  <b>{team.name}</b>
                  <span className={`tag ${team.tier === 1 ? 't1' : 't2'}`}>{formatOf(game.year) === 'open' ? (team.tier === 1 ? '一线' : '二线') : team.tier === 1 ? 'VCT' : '挑战者联赛'}</span>
                  <span className="muted">·</span>
                  {me.trial ? <b style={{ color: 'var(--accent)' }}>试用中</b> : starter ? <b style={{ color: 'var(--win)' }}>首发</b> : <b style={{ color: 'var(--loss)' }}>替补</b>}
                </>
              ) : (
                <b>{me.phase === 'retired' ? '已退役' : me.phase === 'free' ? '自由人' : '自由身'}</b>
              )}
            </div>
          </div>
          <div className="hero-stage">
            <b>{stageNameIn(game.year, game.stage, onTimeline(game))}</b>
            <span className="muted">{dateLabel(game)}</span>
          </div>
          <div className="tiles">
            <div className="tile"><small>冠军</small><b>{me.seasons.reduce((s, x) => s + x.titles.length, 0)}</b></div>
            <div className="tile"><small>段位</small><b>{me.phase === 'retired' ? '—' : ladderLabel(me.pre?.ladder ?? 0)}</b></div>
            <div className="tile" title={`${fanTier(me.fans).name} · ${fansCn(me.fans)}`}><small>粉丝</small><b>{fanTier(me.fans).name}<em>{fansCn(me.fans)}</em></b></div>
            <div className="tile"><small>资金</small><b>{money(me.money)}</b></div>
            <div className={`tile ${p.fatigue >= 60 ? 'dn' : ''}`}><small>体力</small><b>{Math.round(100 - p.fatigue)}</b></div>
            {/* 气压 has no tile of its own: past 55 it is the only state worth saying */}
            <div className={`tile ${me.tilt >= 55 || p.form <= 60 ? 'dn' : p.form >= 78 ? 'up' : ''}`}><small>状态</small><b>{me.tilt >= 55 ? '心态崩了' : p.form >= 78 ? '火热' : p.form >= 68 ? '正常' : p.form >= 60 ? '一般' : '低迷'}{nums && <em>{Math.round(p.form)}</em>}</b></div>
          </div>
        </section>

        {game.timelinePause && (
          <div className="small" style={{ margin: '10px 0', padding: '10px 14px', border: '1px solid var(--accent)', borderRadius: 8 }}>
            <b>时间线暂停</b> · {game.timelinePause}
          </div>
        )}

        {/* One line under the tiles, not a row of every dimension (asked 2026-09-11: 「段位下方有足足13个维度」).
            The eight, 心态, 体质, 疲劳 and 气压 all still drive every sum; they are read in full on 我的. */}
        {screen !== 'me' && (
        <div className="pinbar" role="status" aria-label="能力">
          <span className="pin"><span>综合</span><b>{nums ? p.overall : attrWord(p.overall)}</b></span>
          {ATTR_KEYS.some((k) => p.attrs[k] >= caps[k]) && (
            <span className="pin cap" title="怎么破看「我的」"><span>卡在瓶颈</span><b>{ATTR_KEYS.filter((k) => p.attrs[k] >= caps[k]).map((k) => ATTR_CN[k]).join('、')}</b></span>
          )}
          <button className="sm ghost" onClick={() => setScreen('me')}>看八项属性 →</button>
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
          <Modal title={`推进总结 · ${summary.weeks} 周 · 到${summary.until === 'season' ? '赛季末' : summary.until === 'stage' ? '赛段末' : summary.until === 'month' ? '一个月后' : '这里'}`} onClose={() => setSummary(null)} onBgClose={() => setSummary(null)}>
            <p className="small muted" style={{ marginTop: 0 }}>
              现在是 {dateLabel(game)} · {stageNameIn(game.year, game.stage, onTimeline(game))}。{summary.ended ? (game.timelinePause ?? '生涯到头了。') : ''}
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
              // a week run as a week goes on from the day after the match; a week of days waits on this one
              afterStop()
            }}
          />
        )}
        {pending && (
          <PendingModal
            key={`${pending.kind}:${pending.id ?? ''}:${pending.day}`}
            item={pending}
            onDone={() => {
              // a week that stopped on this goes on once it is answered — a week of days only to close the week or play today's match
              afterStop()
            }}
          />
        )}
        {/* first week and first club: coach marks over the real screen, behind anything the clock stopped on */}
        <Tour screen={screen} go={setScreen} blocked={!!live || !!pending || !!summary || !!playerId || !!fixture} />
        <AchPop />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
