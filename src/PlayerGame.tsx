import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { GameCtx } from './ui/me/ctx'
import { autosave, checkSaveHeld, claimAutosave, flushAutosave, flushAutosaveNow, onSaveStorage } from './engine/me/save'
import { setSaveNamespace } from './engine/save'
import { dateLabel } from './engine/season'
import { formatOf, onTimeline, stageNameIn } from './engine/era'
import { ATTR_CN, ATTR_KEYS } from './engine/types'
import type { Fixture, GameState } from './engine/types'
import { advanceTurn, carriesOn, staminaLeft, weekCalendar, weekInDays, weekMatches } from './engine/me/week'
import { MeMatch } from './engine/me/matchplay'
import { isCupRound } from './engine/me/cups'
import { advanceUntil, leftToMe, runAutoPilot, stopLine } from './engine/me/auto'
import type { AdvanceUntil } from './engine/me/auto'
import { noteHall } from './engine/me/hall'
import { unseenAch } from './engine/me/achievements'
import Changelog from './ui/me/Changelog'
import UpdateNudge from './ui/me/UpdateNudge'
import SaveNotice, { SaveTakenNotice, useSaveLost, useSaveTrouble } from './ui/me/SaveNotice'
import { ladderLabel } from './engine/me/prepro'
import { rankAt } from './engine/me/rank'
import { fanTier, fansCn } from './engine/me/fans'
import { Crest, Modal, money } from './ui/me/common'
import { RankBadge } from './ui/me/art/emblem'
import Week, { advanceOf } from './ui/me/Week'
import MatchPlay from './ui/me/MatchPlay'
import MeScreen from './ui/me/MeScreen'
import TeamScreen from './ui/me/TeamScreen'
import LogScreen from './ui/me/LogScreen'
import TransferScreen from './ui/me/TransferScreen'
import EconomyScreen from './ui/me/EconomyScreen'
import AchievementsScreen from './ui/me/AchievementsScreen'
import AchPop from './ui/me/AchPop'
import { Held, heldNow, holdCard } from './ui/me/hold'
import MomentQueue from './ui/me/MomentQueue'
import HallPage from './ui/me/HallScreen'
import AutoScreen from './ui/me/AutoScreen'
import PendingModal from './ui/me/Modals'
import Poster from './ui/me/Poster'
import { LookPicker } from './ui/me/looks'
import Schedule from './ui/me/Schedule'
import Standings from './ui/me/Standings'
import MatchModal from './ui/me/MatchModal'
import PlayerCard from './ui/me/PlayerCard'
import ThemeToggle from './ui/me/ThemeToggle'
import SoundToggle from './ui/me/SoundToggle'
import { attrWord, useNumbers } from './ui/me/words'
import { ceilingsOf } from './engine/me/bottleneck'
import HelpScreen from './ui/me/HelpScreen'
import Tour from './ui/me/Tour'
import { openTour, useOpenTour, weekTourOf } from './ui/me/guide'
import { countScreen, countTurn } from './engine/me/telemetry'
import { openSavedCareer, turnShape } from './engine/me/opening'

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

// the shared engine's save slots (engine/save.ts) under the player's name, as App.tsx used to set them on every render
// before it stopped importing the engine; the career's own save has its own keys (engine/me/save.ts)
setSaveNamespace('player')

/**
 * The player career, whole: a game of its own, drawn only from src/ui/me/
 * (scripts/check_boundary.ts keeps it that way). This shell knows about weeks,
 * whatever is waiting on me, and my club's matches. It opens on the career the
 * home page hands it (开始生涯, 继续: src/App.tsx, which fetches this module and
 * the world with it through src/game.ts only then) and hands it back on 回到首页.
 */
export default function Career({ opened, onHome }: {
  /** the career to open: a new one, or the save read back */
  opened: GameState
  /** back to the home page, once the save has gone in */
  onHome: () => void
}) {
  const gameRef = useRef<GameState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [screen, setScreen] = useState('week')
  const [booted, setBooted] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [live, setLive] = useState<MeMatch | null>(null)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  // what a multi-week run did on my behalf, shown once it stops
  const [summary, setSummary] = useState<{ until: AdvanceUntil; weeks: number; notes: string[]; ended: boolean; why?: string; aside?: boolean; card?: boolean } | null>(null)
  // numbers or words (世界级 · 顶级 · 一流) on every attribute; remembered per browser, see ui/me/words.ts
  const [nums, setNums] = useNumbers()
  const mainRef = useRef<HTMLElement>(null)
  // a phone's 更多: the screens that are not on its tab bar, opened over it (me.css)
  const [more, setMore] = useState(false)
  // the tour walking: the update notice waits for it, and hears it from here — its own module must stay off the
  // home page, which reaches no world (ui/me/UpdateNudge.tsx, scripts/check_boundary.ts)
  const touring = !!useOpenTour().kind
  // the latest progress not in this browser (engine/me/save.ts): a bar says so until a save lands (ui/me/SaveNotice.tsx)
  const trouble = useSaveTrouble()
  // another page took the save (engine/me/save.ts holds): this one writes nothing more and says so (SaveTakenNotice)
  const lost = useSaveLost()
  // 回到首页 waits for the save to land
  const [leaving, setLeaving] = useState(false)
  const liveRef = useRef<MeMatch | null>(null)
  useEffect(() => { liveRef.current = live }, [live])

  // a page going out of sight or away can be frozen before a background write lands: the newest career goes in at once where it fits
  // ...and one coming back asks whether another page took the save meanwhile: a page frozen in the background, or
  // kept whole by the back button, may not have heard it happen (engine/me/save.ts checkSaveHeld)
  useEffect(() => {
    const away = () => flushAutosaveNow()
    const hidden = () => { if (document.visibilityState === 'hidden') flushAutosaveNow(); else checkSaveHeld() }
    const back = () => { checkSaveHeld() }
    window.addEventListener('pagehide', away)
    window.addEventListener('pageshow', back)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', away)
      window.removeEventListener('pageshow', back)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  // Another page of the game wrote the save or took it (reported 2026-09-18, an outside audit): this page hears it at
  // once, and stops writing if it held the save. The home page draws its card again on the same event (App.tsx).
  useEffect(() => {
    const heard = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return
      onSaveStorage(e.key)
    }
    window.addEventListener('storage', heard)
    return () => window.removeEventListener('storage', heard)
  }, [])
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    // a phone scrolls the page itself (me.css): the new screen opens at its own top, the overview left scrolled away if it was
    const body = mainRef.current?.parentElement
    if (!body || window.scrollY <= body.offsetTop) return
    const bar = document.querySelector('.app.career > .pinbar')?.getBoundingClientRect().height ?? 0
    window.scrollTo(0, body.offsetTop - bar)
  }, [screen])

  const commit = useCallback(() => {
    bump()
    const g = gameRef.current
    if (!g) return
    // the 成就殿堂, outside the save: this career's unlocks, and its card once it has ended (me/hall.ts)
    noteHall(g)
    // taken now, written in the background and in order (engine/me/save.ts); a write that does not go in is said on screen (SaveNotice)
    autosave(g)
  }, [])

  /** Save now and wait for the write: before a reload (ui/me/UpdateNudge.tsx) and from the notice's 再试一次. false when it did not go in. */
  const saveNow = useCallback((): Promise<boolean> => {
    commit()
    return flushAutosave()
  }, [commit])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3200)
  }, [])

  /**
   * Every nav switch goes through here, so a screen is counted once and rolled
   * up per key rather than a row a click (engine/me/telemetry.ts countScreen).
   * The two resets — a career opening, and 回到首页 — set the screen directly:
   * neither is somebody navigating.
   */
  const goScreen = useCallback((key: string) => {
    countScreen(key)
    setScreen(key)
  }, [])

  const start = useCallback((g: GameState) => {
    gameRef.current = g
    claimAutosave(g)
    setScreen('week')
    // a career read back: its first autosave writes the summary a save from before it lacks
    commit()
  }, [commit])

  /**
   * The save as it is now, opened in place: 「载入最新存档」 on a page another one took the save from (the home
   * page's 继续 opens it through App.tsx, with the same read: engine/me/opening.ts). false when there is none, or it
   * cannot be read.
   */
  const openSave = useCallback(async (): Promise<boolean> => {
    const g = await openSavedCareer()
    if (!g) return false
    // whatever was up over the career it replaces goes with it: a match in progress, a card, a run's summary
    holdCard(null)
    setLive(null)
    setFixture(null)
    setPlayerId(null)
    setSummary(null)
    setMore(false)
    // and its first autosave writes the summary a save from before it lacks
    start(g)
    return true
  }, [start])

  // the career the home page opened (a new one, or the save read back), taken as this mounts; a
  // career opened after 回到首页 mounts a new shell (App.tsx keys it), so this runs once a career
  useEffect(() => {
    start(opened)
    setBooted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // one press of 推进一周, and how deep the career is by it
    countTurn(turnShape(g))
    commit()
    if (stop.kind === 'match') {
      setLive(new MeMatch(g, stop.fixture))
    } else if (stop.kind === 'week-end') {
      toast(`新的一周 · ${dateLabel(g)}${weekInDays(g) ? ` · 这周 ${weekMatches(g).length} 场比赛，一天一推` : ''}`)
    } else if (stop.kind === 'day') {
      // a big moment's card is what stopped the day, and it says where we are itself
      // (me/week.ts runDays, ui/me/MomentQueue.tsx): a line under it about the week's
      // matches would be answering a question nobody asked
      if (g.me.moments?.length) return
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
   * Run several weeks. The small things waiting are answered the steady way
   * and every match on the road is played by the numbers; a decision no dial
   * of mine hands over stops it (engine/me/auto.ts leftToMe); what was done
   * comes back as a summary. "到下一场比赛" and a month hand me the match.
   */
  const advanceMany = useCallback((until: AdvanceUntil) => {
    const g = gameRef.current
    if (!g?.me) return
    const { stop, weeks, notes, aside } = advanceUntil(g, until)
    // a multi-week run is not the same act as a single press: counted apart, or
    // an average over both would say nothing about either
    countTurn({ ...turnShape(g), many: true })
    commit()
    if (stop.kind === 'match') {
      if (notes.length) toast(`推进了 ${weeks} 周，替你处理了 ${notes.length} 件事，到你的比赛了。`)
      setLive(new MeMatch(g, stop.fixture))
      return
    }
    // a round of my cup on the road, handed over the way a match is: its card opens as this returns (engine/me/cups.ts)
    if (stop.kind === 'pending' && isCupRound(g, stop.item)) {
      toast(`${weeks ? `推进了 ${weeks} 周，` : ''}${stopLine(g, stop.item)}。`)
      return
    }
    // stopped in front of a decision that is mine: the summary says which, and its card comes after it — or for
    // an offer I set aside that is about to run out, which has no card and waits on the 转会 page (me/aside.ts)
    const why = stop.kind === 'pending' && leftToMe(g, stop.item) ? stopLine(g, stop.item) : aside
    // it never started: the card is already in front
    if (why && !weeks && !notes.length) { toast(`没有推进：${why}。`); return }
    // a big moment raised on the road stopped the run on its own day (engine/me/auto.ts
    // advanceUntil): the summary says so, and the card is under it
    const card = !why && !!g.me.moments?.length
    setSummary({ until, weeks, notes, ended: stop.kind === 'game-over', why, aside: !!aside, card })
  }, [commit, toast])

  /**
   * Back to the home page (asked 2026-09-14): the save is written first and
   * stays where it is, so the home page's card shows it and 「继续」 brings the
   * career back; 「开新生涯」 there still asks before anything replaces it.
   * A match being played lives only in memory, so it finishes first.
   */
  const toHome = useCallback(async () => {
    if (!gameRef.current || leaving) return
    if (live) { toast('这场比赛打完再回首页。'); return }
    commit()
    // the write comes after the commit (engine/me/save.ts): the career closes only once it is in, or this stretch would be gone
    setLeaving(true)
    const saved = await flushAutosave()
    setLeaving(false)
    if (!saved) { toast('最新进度没存进浏览器，先不回首页：现在回去，这段进度就没了。'); return }
    // a match started while it was saving lives only in memory
    if (liveRef.current) { toast('这场比赛打完再回首页。'); return }
    // an answer's result still up goes with the career (ui/me/hold.tsx)
    holdCard(null)
    // the home page takes over (App.tsx): this shell and everything open in it close with the career
    onHome()
  }, [commit, leaving, live, onHome, toast])

  const ctxValue = useMemo(() => ({
    game: gameRef.current!,
    commit,
    toast,
    openPlayer: (id: string) => setPlayerId(id),
    openMatch: setFixture,
    go: goScreen,
    // the week screen's tour for where the career is now (ui/me/guide.ts); 帮助 opens the others
    startTutorial: () => openTour(weekTourOf(gameRef.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [commit, toast, gameRef.current, screen])

  // The shell — rail down the left, tab bar along the bottom of a phone —
  // is marked on the document while it is up, so a fixed thing outside this
  // component (the music window) can step out of its way with one CSS rule.
  // Above the early returns: a hook after one of those is a hook that is
  // sometimes not called, which React refuses. (Val Manager's ManagerGame, as it is.)
  const shell = booted && !!gameRef.current?.me
  useEffect(() => {
    if (!shell) return
    document.documentElement.dataset.shell = '1'
    return () => { delete document.documentElement.dataset.shell }
  }, [shell])

  if (!booted) return null
  const game = gameRef.current
  // the home page (App.tsx) draws the cover; this shell is only ever up with a career in it
  if (!game || !game.me) return null

  const me = game.me
  const p = game.players[me.id]
  const caps = ceilingsOf(p)
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const starter = !!team && team.starters.includes(me.id)
  // 体力 now — the same number the 本周行动 panel's bar shows (engine/me/week.ts staminaLeft). It used to carry
  // 「安排后 N」 beside it for what the week's plan would cost at the settlement; a card is paid for as it is
  // clicked now (me/week.ts doAction), so this figure is already the answer.
  const stamina = staminaLeft(game)
  // where I stand on the ladder today, for the overview's badge; a retired man's reads 「—」
  const rank = me.phase === 'retired' ? null : rankAt(game)
  // a run's summary first, then what just unlocked, then the card it stopped on — 破晓's order: the unlock card
  // under a card's scrim could not be pressed (z45 against z50), and the tour's veil covered it too
  // the big moments first (me/moments.ts), then the achievements they unlocked, then the cards the clock stopped on
  const moments = !live && !summary ? (me.moments?.length ?? 0) : 0
  const unlocks = !live && !summary && !moments ? unseenAch(me).length : 0
  // an answer's result still up (ui/me/hold.tsx) goes before the next card too
  const pending = !live && !summary && !moments && !unlocks && !heldNow() ? me.pending[0] : undefined

  const Screen = screen === 'me' ? MeScreen
    : screen === 'team' && pro ? TeamScreen
      : screen === 'transfer' ? TransferScreen
        : screen === 'economy' ? EconomyScreen
          : screen === 'schedule' && pro ? Schedule
            : screen === 'standings' ? Standings
              : screen === 'awards' ? AchievementsScreen
                : screen === 'hall' ? HallPage
                : screen === 'log' ? LogScreen
                  : screen === 'auto' ? AutoScreen
                    : screen === 'help' ? HelpScreen
                      : null

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app career">
        {/* The top of a career, two lines (asked 2026-09-18: 「上面这个信息栏太大了，弄得操作空间特别局促」 — at
            1280×667 the wordmark bar, this card and the line under it took 302px of 667). The wordmark and 回到首页 ride
            the first line with who I am, where, and the day, the way 破晓 folds its title into a strip once a career is
            open; the five numbers are label and value on the second. 体力 went down a line, beside the week's action
            points, where the two budgets of a week stay on screen together (me.css .pinbar). The same evening the author
            found it gone too far (「太小了，连段位图标都不显示」): the name is large again, the numbers are blocks with the
            label over the figure, and 段位 has its tier's badge — about 180px on a monitor where it had been 279 and 117. */}
        <header className="hero" aria-label="总览">
          <div className="hero-row">
            <button className="brand as-link" onClick={() => goScreen('week')}>
              VAL<span>选手生涯</span><em className="by">demo</em>
            </button>
            {/* before who I am in the page's order, so a phone can hold it at the right of the wordmark's line; a monitor
                puts it back at the end of the line (me.css .hero-home) */}
            <button className="sm ghost hero-home" onClick={toHome} disabled={leaving} title="回到存档首页：存档留着，点「继续」接着打">{leaving ? '存档中…' : '回到首页'}</button>
            <div className="hero-id">
              <div className="hero-who">
                <b className="hero-name">{p.ign}</b>
                <span className="muted">{p.role} · {p.age} 岁</span>
              </div>
              <div className="hero-club">
                {team ? (
                  <>
                    <Crest id={game.myTeam} size={22} />
                    <b>{team.name}</b>
                    <span className={`tag ${team.tier === 1 ? 't1' : 't2'}`}>{formatOf(game.year) === 'open' ? (team.tier === 1 ? '一线' : '二线') : team.tier === 1 ? 'VCT' : '挑战者联赛'}</span>
                    <span className="muted">·</span>
                    {me.trial ? <b style={{ color: 'var(--accent)' }}>试用中</b> : starter ? <b style={{ color: 'var(--win)' }}>首发</b> : <b style={{ color: 'var(--loss)' }}>替补</b>}
                  </>
                ) : (
                  <b>{me.phase === 'retired' ? '已退役' : me.phase === 'free' ? '自由人' : '自由身'}</b>
                )}
              </div>
              <div className="hero-stage">
                <b>{stageNameIn(game.year, game.stage, onTimeline(game))}</b>
                <span className="muted">{dateLabel(game)}</span>
              </div>
            </div>
          </div>
          {/* the week's button, mirrored where the page opens — shown on a phone only (me.css .hero-go), where the
              real one is a long scroll down at the end of the week's panel; 破晓's HUD carries the same copy */}
          {!Screen && me.phase !== 'retired' && (() => {
            const go = advanceOf(game)
            return <button className="primary hero-go" onClick={advance} title={go.title}>{go.label}</button>
          })()}
          <div className="tiles">
            {/* the trophies themselves (me.titles), not the finished seasons' rows: a season's row is written the
                night the year turns (me/week.ts), so a trophy lifted in the season being played was not counted
                until the winter — a career that had just won a Masters and a Champions read 「冠军 0」 while the
                成就 page's 本局奖杯 listed five (2026-09-19, beside ui/me/TrophyCase.tsx) */}
            <div className="tile"><small>冠军</small><b>{me.titles.length}</b></div>
            {/* the tier's badge beside the words (asked 2026-09-18: 「连段位图标都不显示」); the words are as they were */}
            <div className={`tile${rank ? ' rank' : ''}`}>
              {rank && <RankBadge tier={rank.tier} div={rank.div} size={40} />}
              <small>段位</small>
              <b>{rank ? ladderLabel(game) : '—'}{nums && rank && <em>{rank.rr} RR</em>}</b>
            </div>
            <div className="tile" title={`${fanTier(me.fans).name} · ${fansCn(me.fans)}`}><small>粉丝</small><b>{fanTier(me.fans).name}<em>{fansCn(me.fans)}</em></b></div>
            <div className="tile"><small>资金</small><b>{money(me.money)}</b></div>
            {/* 气压 has no tile of its own: past 55 it is the only state worth saying */}
            <div className={`tile ${me.tilt >= 55 || p.form <= 60 ? 'dn' : p.form >= 78 ? 'up' : ''}`}><small>状态</small><b>{me.tilt >= 55 ? '心态崩了' : p.form >= 78 ? '火热' : p.form >= 68 ? '正常' : p.form >= 60 ? '一般' : '低迷'}{nums && <em>{Math.round(p.form)}</em>}</b></div>
          </div>
        </header>

        {game.timelinePause && (
          <div className="small" style={{ margin: '10px 0', padding: '10px 14px', border: '1px solid var(--accent)', borderRadius: 8 }}>
            <b>时间线暂停</b> · {game.timelinePause}
          </div>
        )}

        {/* One line under the tiles, not a row of every dimension (asked 2026-09-11: 「段位下方有足足13个维度」).
            The eight, 心态, 体质, 疲劳 and 气压 all still drive every sum; they are read in full on 我的. */}
        {/* The numbers switch rides the end of this line on every screen, 我的 included, the way 破晓 keeps 「数值」 on its attribute bar. */}
        {/* The week's two budgets lead it, on every screen (asked 2026-09-18: 「行动点应该是冻结一直出现在界面里，不然往下划一点就不知道还有多少行动点了」):
            what is left of the week's action points, and 体力 — the same two figures as the 本周行动 panel's title
            and bar, which scroll away with the cards under them. 破晓 puts 行动 first on its bar. */}
        <div className="pinbar" role="group" aria-label="本周行动与能力">
          {/* the readings wrap among themselves on a narrow phone, and the two buttons keep the line's end */}
          <div className="pin-list">
            {me.phase !== 'retired' && (
              // read out when it changes, as a card is clicked; the rest of the line is not
              <span className={`chip ap-chip${me.ap > 0 ? '' : ' spent'}`} role="status" title={me.ap > 0 ? '这周还能用的行动点，点一张卡当场花掉；推进以后没用完的作废' : '这周的行动点用完了'}>
                本周行动<b>剩 {me.ap} 点</b>
              </span>
            )}
            <span className={`pin stamina${p.fatigue >= 60 ? ' dn' : ''}`}>
              <span>体力</span><b>{stamina}</b>
            </span>
            {screen !== 'me' && (
              <>
                <span className="sep" aria-hidden="true" />
                <span className="pin"><span>综合</span><b>{nums ? p.overall : attrWord(p.overall)}</b></span>
                {ATTR_KEYS.some((k) => p.attrs[k] >= caps[k]) && (
                  <span className="pin cap" title="怎么破看「我的」"><span>卡在瓶颈</span><b>{ATTR_KEYS.filter((k) => p.attrs[k] >= caps[k]).map((k) => ATTR_CN[k]).join('、')}</b></span>
                )}
              </>
            )}
          </div>
          {screen !== 'me' && <button className="sm ghost to-me" onClick={() => goScreen('me')}>看八项属性 →</button>}
          <button className={`sm ghost num-switch${nums ? ' on' : ''}`} onClick={() => setNums(!nums)} title={nums ? '切回文字描述：世界级、顶级、一流……' : '显示具体数值'} aria-pressed={nums}>
            数值 {nums ? '开' : '关'}
          </button>
        </div>

        <div className="body">
          <nav className={`nav${more ? ' more-open' : ''}`}>
            {(() => {
              const shown = SCREENS.filter((s) => !s.pro || pro)
              // a phone's tab bar holds the first four and 更多; the screen I am on takes the fourth place when it is one of the rest (破晓's rule)
              const at = shown.findIndex((s) => s.key === screen)
              const bar = new Set((at >= 4 ? [...shown.slice(0, 3), shown[at]] : shown.slice(0, 4)).map((s) => s.key))
              return shown.map((s) => (
                <div key={s.key} className={bar.has(s.key) ? 'nav-bar' : 'nav-rest'}>
                  {s.sep && <div className="nav-group">—</div>}
                  <button className={`nav-item ${screen === s.key ? 'active' : ''}`} onClick={() => { goScreen(s.key); setMore(false) }}>{s.label}</button>
                </div>
              ))
            })()}
            <div className="nav-more">
              <button className={`nav-item${more ? ' active' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>更多</button>
            </div>
            {/* the ground and the chime (off until turned on, ui/me/sfx.ts) — on a phone both sit in 更多 */}
            <div className="nav-foot"><ThemeToggle compact /><SoundToggle /></div>
          </nav>
          <main className="main" id="main" ref={mainRef}>
            {me.phase === 'retired' ? (
              <>
                <Poster />
                <LookPicker game={game} />
                <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                  <button onClick={onHome}>再来一局</button>
                </div>
                {Screen && screen !== 'week' && <div style={{ marginTop: 16 }}><Screen /></div>}
              </>
            ) : Screen ? <Screen /> : <Week onAdvance={advance} onAdvanceUntil={advanceMany} />}
          </main>
        </div>
        {/* what changed in this build: the bottom-right corner, where 破晓 keeps its corner tools (me.css .log-fab) */}
        <Changelog />
        {more && <div className="nav-scrim" aria-hidden="true" onClick={() => setMore(false)} />}

        {playerId && <PlayerCard playerId={playerId} onClose={() => setPlayerId(null)} />}
        {fixture && <MatchModal fixture={fixture} onClose={() => setFixture(null)} />}
        {/* an old save just read onto the new ruler (me/rulerMigrate.ts): said once, as asked 2026-09-14, then the flag goes */}
        {me.flags.rulerNotice !== undefined && !live && (
          <Modal
            title="能力标尺更新"
            onClose={() => { delete me.flags.rulerNotice; commit() }}
            onBgClose={() => { delete me.flags.rulerNotice; commit() }}
          >
            <p style={{ marginTop: 0 }}>
              老存档里整个圈子一年比一年涨，到后来国际赛几乎人人 90 以上。这次读档，所有人按新标尺一起重读了一遍，你也在内
              {me.flags.rulerNotice < 0 ? `，综合往下挪了 ${-me.flags.rulerNotice} 点` : me.flags.rulerNotice > 0 ? `，综合往上挪了 ${me.flags.rulerNotice} 点` : ''}。
            </p>
            <p className="small muted">你在世界里的位置没变，拿到的荣誉、成就和破开的瓶颈都在。以后每个冬天都按这把尺子读，世界不会再越涨越高。</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="primary" onClick={() => { delete me.flags.rulerNotice; commit() }}>知道了</button>
            </div>
          </Modal>
        )}
        {summary && (
          <Modal title={`推进总结 · ${summary.weeks} 周 · ${summary.why || summary.card ? '停在这里' : `到${summary.until === 'season' ? '赛季末' : summary.until === 'stage' ? '赛段末' : summary.until === 'month' ? '一个月后' : '这里'}`}`} onClose={() => setSummary(null)} onBgClose={() => setSummary(null)}>
            {/* why the run stopped short: a decision it leaves to me, whose card opens when this closes */}
            {summary.why && <div className="node-line" style={{ marginTop: 0 }}>没推完就停了：{summary.why}。</div>}
            {/* or a big moment of the career's, whose card is right behind this one (ui/me/MomentQueue.tsx) */}
            {!summary.why && summary.card && <div className="node-line" style={{ marginTop: 0 }}>没推完就停了：路上有一件大事。</div>}
            <p className="small muted" style={{ marginTop: summary.why || summary.card ? undefined : 0 }}>
              现在是 {dateLabel(game)} · {stageNameIn(game.year, game.stage, onTimeline(game))}。{summary.ended ? (game.timelinePause ?? '生涯到头了。') : ''}
            </p>
            {summary.notes.length === 0
              ? <p className="muted">{summary.why || summary.card ? '路上没替你处理什么。' : '一路没有需要拿主意的事。'}</p>
              : <ul className="diary">{summary.notes.map((n, i) => <li key={i}><span>{n}</span></li>)}</ul>}
            <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 12 }}>
              {/* stopped for an offer set aside: the page it is waiting on, one press away (engine/me/aside.ts) */}
              {summary.aside && <button onClick={() => { setSummary(null); goScreen('transfer') }}>去「转会」页</button>}
              <button className="primary" onClick={() => setSummary(null)}>{summary.aside ? '接着推进' : summary.why ? '去处理' : '继续'}</button>
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
            onDone={(aside) => {
              // set aside, not answered (engine/me/aside.ts): the week waits for the next press instead of running
              // on by itself — it was closed to think it over — and the line saying where it went stays on screen
              if (aside) {
                const g = gameRef.current
                if (g?.me) answerDials(g)
                commit()
                return
              }
              // a week that stopped on this goes on once it is answered — a week of days only to close the week or play today's match
              afterStop()
            }}
          />
        )}
        {/* first week and first club: coach marks over the real screen, behind anything the clock stopped on */}
        {/* an answer's result, up until it is closed (ui/me/hold.tsx) */}
        <Held />
        <Tour screen={screen} go={goScreen} blocked={!!live || !!pending || !!summary || !!playerId || !!fixture || moments > 0 || unlocks > 0 || heldNow()} />
        {/* a title, a signing, an award, a new tier: a card each, before anything else takes its turn (ui/me/MomentQueue.tsx) */}
        {!live && !summary && <MomentQueue />}
        {/* what just unlocked waits for the match, the run's summary and those cards, and goes before any card (unlocks above) */}
        {!live && !summary && !moments && <AchPop />}
        {/* the latest progress did not go into this browser: said until a save lands, with 再试一次 (ui/me/SaveNotice.tsx) */}
        {trouble && !lost && <SaveNotice trouble={trouble} onRetry={saveNow} />}
        {/* another page took the save: nothing more is written from here, said until a career is opened here again (ui/me/SaveNotice.tsx) */}
        {lost && <SaveTakenNotice onLoad={openSave} />}
        {/* a build that went live under this tab: the page saves and takes it by itself (ui/me/UpdateNudge.tsx). A match being
            played lives only in memory, so while one is on the page only says so and waits for it; and while a save is not going
            in, or another page took it, the save notice has this corner and the update says nothing. It waits for the tour too */}
        <UpdateNudge busy={!!live} hushed={!!trouble || lost || touring} onBeforeReload={saveNow} />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
