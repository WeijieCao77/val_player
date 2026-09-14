import type { Competition, GameState, Team } from '../types'
import { onTimeline, regionIn, stagesOf, vctWindowOf } from '../era'
import { eventOf, eventsOf, roundAheadOf } from '../circuit'
import type { CEvent } from '../circuit'
import { inVctLeague } from '../timeline'

/**
 * 转会窗口: one function says whether a move can be made today (windowAt).
 *
 * Reported 2026-09-14: 「23年的档，第一把比赛在三四月但是中间的时间转会窗口一直不开」.
 * The career kept the manager game's four day-of-year spans for its screen and
 * moved a player on only two days of them (6/16, 11/21), whatever the year, the
 * calendar, the club's tier or whether it was playing. From New Year to mid-June
 * no club called; the screen said 开着 in January and March while nothing came;
 * 6/16 fell inside Masters in 2023–2026; the real 2023 windows gave nothing.
 *
 * The author's direction: 「转会窗口开的时间要多一些，特别是完整的联赛成立之前，其实大家的转会
 * 都很随意，没有特定的时间，基本只要不是大赛比赛期间都是到处转的」. By year and club:
 *
 *  - 2021–2022, the open circuit: no set window. A club is closed only while it
 *    plays a major event — an international, a Last Chance Qualifier, 2021's
 *    regional Masters and Challengers Finals — from the event's first day to the
 *    day it is out, or the event's last.
 *  - 2023 on, a club outside the VCT leagues: no set window either. It locks only
 *    while it plays its own playoffs, or the whole of an Ascension or an open
 *    qualifier or play-off into a league event — not its whole split. Riot's
 *    Challengers rules closed more than that (vlr.gg/146151); this leans open on
 *    purpose, as the author asked. Majors lock it as they lock anyone.
 *  - 2023 on, a VCT league club: Riot's windows (engine/era.ts VCT_WINDOWS), and a
 *    roster lock while it plays an international, an LCQ or its league's stage
 *    playoffs — 2024's Kickoff and stage playoffs locks are 暂定.
 *  - A world off the timeline (a save handed to the old 2026 world): a VCT club
 *    keeps that world's four spans; everyone locks for its internationals.
 *
 * A move needs both clubs open: mine, when I have one, and the other side. The
 * market around me is not asked: it turns over at its own two moments
 * (MARKET_DAYS, me/market.ts), and in the book's years history moves the clubs out
 * of my reach (engine/timeline.ts).
 */

/* ------------------------------------------------------------------ */
/*  days                                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000
/** A calendar day as one number: 1 January of `year` is its day 0 (engine/season.ts dateLabel, me/life.ts dayNo). */
export const absDay = (year: number, day: number): number => Math.round(Date.UTC(year, 0, 1) / DAY_MS) + day
export const todayAbs = (state: Pick<GameState, 'year' | 'day'>): number => absDay(state.year, state.day)
const isoAbs = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
const ymdOf = (n: number): { y: number; m: number; d: number } => {
  const t = new Date(n * DAY_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
/** 「3月25日」, with the year in front unless it is `year`. */
export function dateCn(n: number, year?: number): string {
  const { y, m, d } = ymdOf(n)
  return `${y === year ? '' : `${y}年`}${m}月${d}日`
}

/* ------------------------------------------------------------------ */
/*  the world's market, and the career's transfer periods              */
/* ------------------------------------------------------------------ */

/**
 * The world market's two moments — the mid-season break and the winter
 * (me/market.ts marketWindow) — on the days the career always opened them. They
 * are the market's, not the player's window: the market turns over on these days
 * whatever any window says.
 */
export const MARKET_DAYS: readonly number[] = [166, 324]
/** From this day the club renews the men it keeps before their deals run out (me/club.ts clubWeek). */
export const WINTER_RENEWALS = 323
export const marketDay = (state: Pick<GameState, 'day'>): boolean => MARKET_DAYS.includes(state.day)

/**
 * A transfer period: the half-season that ends on a market day — from the day after
 * the winter market to day 166, then 167 to 324. The career used to be offered a
 * move once in each, on its market day. Now that round of calls can come on any day
 * of the period the window is open (me/transfer.ts windowRoll), still at most once,
 * and a period is what `dryWindows` counts.
 */
export function periodKey(year: number, day: number): number {
  return day <= MARKET_DAYS[0] ? year * 2 : day <= MARKET_DAYS[1] ? year * 2 + 1 : (year + 1) * 2
}

export type RollKind = 'market' | 'stage' | 'week'
/** Each kind of moment's share of a period's round of calls, before it is spread over the period. */
export const ROLL_BASE: Record<RollKind, number> = { market: 3, stage: 2, week: 0.2 }
const BUDGET = new Map<string, number>()
/**
 * How much of a period's round of calls one moment carries: its kind's share over
 * the period's whole budget — its market day, each stage that opens inside it
 * (the season's turn is not rolled), each week. A period open from end to end adds
 * up to one round, the chance its market day alone used to carry; a period the
 * window shuts for part of gets that part less.
 */
export function rollWeight(state: GameState, kind: RollKind): number {
  const key = periodKey(state.year, state.day)
  const timeline = onTimeline(state)
  const at = `${key}:${timeline}`
  let budget = BUDGET.get(at)
  if (budget == null) {
    const y = Math.floor(key / 2)
    const spans: [number, number, number][] = key % 2 === 0
      ? [[y - 1, MARKET_DAYS[1] + 1, 363], [y, 0, MARKET_DAYS[0]]]
      : [[y, MARKET_DAYS[0] + 1, MARKET_DAYS[1]]]
    let stages = 0
    let days = 0
    for (const [yy, a, b] of spans) {
      days += b - a + 1
      stages += stagesOf(yy, timeline).filter((s) => s.start > 0 && s.start >= a && s.start <= b).length
    }
    budget = ROLL_BASE.market + ROLL_BASE.stage * stages + ROLL_BASE.week * Math.floor(days / 7)
    BUDGET.set(at, budget)
  }
  return ROLL_BASE[kind] / budget
}

/** The first market day after an absolute day. */
export function nextMarketAbs(from: number): number {
  const { y } = ymdOf(from)
  for (const year of [y, y + 1]) for (const d of MARKET_DAYS) if (absDay(year, d) > from) return absDay(year, d)
  return absDay(y + 1, MARKET_DAYS[0])
}
export const weeksToMarket = (state: GameState): number => Math.max(1, Math.ceil((nextMarketAbs(todayAbs(state)) - todayAbs(state)) / 7))

/* ------------------------------------------------------------------ */
/*  whose rules                                                        */
/* ------------------------------------------------------------------ */

export type WindowRule = 'open' | 'chal' | 'vct' | 'legacy'

export function ruleOf(state: GameState, team: Team | undefined): WindowRule {
  if (state.year <= 2022) return 'open'
  if (!team || !inVctLeague(state, team)) return 'chal'
  return onTimeline(state) ? 'vct' : 'legacy'
}

/* ------------------------------------------------------------------ */
/*  roster locks                                                       */
/* ------------------------------------------------------------------ */

export interface RosterLock {
  /** the event, by the name the screens use */
  event: string
  comp: string
  /** its last day this year: the lock lifts after it, or once the club is out */
  until: number
  kind: 'major' | 'playoffs' | 'entry'
}

/** 2021's regional events that fed an international (engine/circuit.ts TOP): its Masters and its Challengers Finals. */
const OPEN_MAJORS = new Set<string>(['s1masters', 's2finals', 's3finals'])
const LEAGUES = new Set<string>(['Americas', 'EMEA', 'Pacific', 'China'])

/**
 * The first day of an event's playoffs, off its matches: the units named for them
 * (Playoffs, Finals, 季后赛, 决赛), not a play-in's own. Null for an event that is one
 * bracket from its first match — a Kickoff's Main Event — or has no playoffs.
 */
export function playoffsFrom(ev: CEvent): number | null {
  let first: number | null = null
  for (const u of ev.units) {
    if (u.type === 'open') continue
    const name = `${(u.phase ?? '').split('|')[0]} ${u.label}`
    if (!/Playoffs|Finals|季后赛|决赛/i.test(name) || /Play-?Ins?|附加赛/i.test(name)) continue
    for (const n of u.nodes ?? []) if (first == null || n.day < first) first = n.day
  }
  return first
}

interface Span { from: number; until: number; kind: RosterLock['kind'] }

/** The days an event locks a club playing it, by that club's rules. Null when it does not lock it. */
function spanOf(state: GameState, comp: Competition, rule: WindowRule): Span | null {
  const c = comp.circuit
  if (!c) {
    // the old 2026 world: its internationals, on its own calendar
    if (comp.region || !['masters1', 'masters2', 'champions'].includes(comp.stage)) return null
    const s = stagesOf(state.year, false).find((x) => x.key === comp.stage)
    return s ? { from: s.start, until: s.end, kind: 'major' } : null
  }
  const ev = eventOf(c.id)
  if (!ev) return null
  if (ev.region === null || ev.stage === 'lcq' || (!!ev.stage && OPEN_MAJORS.has(ev.stage))) return { from: c.start, until: c.end, kind: 'major' }
  if (state.year <= 2022) return null
  if (rule === 'vct' || rule === 'legacy') {
    const league = !ev.scene && LEAGUES.has(ev.region ?? '') && ['kickoff', 'stage1', 'stage2'].includes(ev.stage ?? '') && !/Open Playoffs/i.test(ev.name)
    const from = league ? playoffsFrom(ev) : null
    return from == null ? null : { from, until: c.end, kind: 'playoffs' }
  }
  // below the leagues: the whole of a way up — an Ascension, an open qualifier or play-off into a league event — and any other event's playoffs
  if (ev.stage === 'ascension' || /Ascension|Promotion|Open Playoffs|Open Qualifier/i.test(ev.name)) return { from: c.start, until: c.end, kind: 'entry' }
  const from = playoffsFrom(ev)
  return from == null ? null : { from, until: c.end, kind: 'playoffs' }
}

/** Still in it: a match of its own to play, or a round of the event still its own (engine/circuit.ts roundAheadOf). */
function stillIn(state: GameState, comp: Competition, id: string): boolean {
  const c = comp.circuit
  if (!c) return comp.teams.includes(id) && !comp.finished.includes(id)
  // drawn the day before it opens (engine/circuit.ts begin); before that its list is history's booking
  if (!c.mode) return false
  // played as history: in it for the event's days, its real way out not read (暂定)
  if (c.mode === 'history') return comp.teams.includes(id)
  if (state.fixtures.some((f) => f.comp === comp.key && !f.played && (f.teamA === id || f.teamB === id))) return true
  return roundAheadOf(state, comp, id) !== null
}

const under = (state: GameState, comp: Competition): boolean => {
  if (comp.champion || comp.circuit?.done) return false
  const c = comp.circuit
  return c ? state.day >= c.start && state.day <= c.end : !comp.region
}
const heldBy = (comp: Competition): string[] => {
  const c = comp.circuit
  return c ? [...new Set([...comp.teams, ...c.seeds.filter((x): x is string => !!x), ...Object.values(c.fill ?? {})])] : comp.teams
}

function lockIn(state: GameState, comp: Competition, id: string): RosterLock | null {
  const team = state.teams[id]
  if (!team) return null
  const span = spanOf(state, comp, ruleOf(state, team))
  if (!span || state.day < span.from || state.day > span.until || !stillIn(state, comp, id)) return null
  return { event: comp.name, comp: comp.key, until: span.until, kind: span.kind }
}

/** A club's lock now, read fresh: my own match today may have been played since the morning. */
export function lockNow(state: GameState, id: string): RosterLock | null {
  for (const comp of Object.values(state.comps)) {
    if (!under(state, comp) || !heldBy(comp).includes(id)) continue
    const l = lockIn(state, comp, id)
    if (l) return l
  }
  return null
}

/** Every club under a lock today, read once a day: by the time anyone else is asked about, the day's matches are played. */
const TODAY = new WeakMap<GameState, { at: string; locks: Map<string, RosterLock> }>()
function locksToday(state: GameState): Map<string, RosterLock> {
  const at = `${state.year}:${state.day}`
  const hit = TODAY.get(state)
  if (hit?.at === at) return hit.locks
  const locks = new Map<string, RosterLock>()
  for (const comp of Object.values(state.comps)) {
    if (!under(state, comp)) continue
    for (const id of heldBy(comp)) {
      if (locks.has(id)) continue
      const l = lockIn(state, comp, id)
      if (l) locks.set(id, l)
    }
  }
  TODAY.set(state, { at, locks })
  return locks
}

/* ------------------------------------------------------------------ */
/*  calendars                                                          */
/* ------------------------------------------------------------------ */

interface Cal { open: boolean; closesOn?: number; nextOpens?: number; tentative?: boolean }
interface Open { from: number; to: number; tentative: boolean }

const CLOSE = new Map<string, { at: number; tentative: boolean }>()
/**
 * One week before a league's Stage 2 playoffs, off that league's event (暂定 by
 * league); with none on the books, three weeks before its Stage 2 ends.
 */
function stage2Close(league: string, season: number): { at: number; tentative: boolean } {
  const key = `${league}:${season}`
  let hit = CLOSE.get(key)
  if (!hit) {
    let po: number | null = null
    try {
      const ev = eventsOf(season).find((e) => e.stage === 'stage2' && !e.scene && e.region === league && !/Open Playoffs/i.test(e.name))
      po = ev ? playoffsFrom(ev) : null
    } catch { po = null }
    const s2 = stagesOf(season, true).find((s) => s.key === 'stage2')
    hit = { at: absDay(season, po != null ? po - 7 : (s2?.end ?? 250) - 21), tentative: true }
    CLOSE.set(key, hit)
  }
  return hit
}

function vctOpens(team: Team, season: number): Open[] {
  const w = vctWindowOf(season)
  if (!w) return []
  const close = w.closes === 'stage2' ? stage2Close(regionIn(team.region, season), season) : { at: isoAbs(w.closes), tentative: false }
  const out: Open[] = [{ from: isoAbs(w.opens), to: close.at, tentative: !!w.tentative || close.tentative }]
  if (w.mid) out.push({ from: isoAbs(w.mid[0]), to: isoAbs(w.mid[1]), tentative: !!w.tentative })
  return out
}

function vctCal(state: GameState, team: Team): Cal {
  const T = todayAbs(state)
  const spans = [state.year, state.year + 1, state.year + 2].flatMap((s) => vctOpens(team, s))
  const inside = spans.filter((s) => T >= s.from && T <= s.to).sort((a, b) => b.to - a.to)[0]
  if (inside) return { open: true, closesOn: inside.to, tentative: inside.tentative }
  const ahead = spans.filter((s) => s.from > T).sort((a, b) => a.from - b.from)[0]
  return { open: false, nextOpens: ahead?.from, tentative: ahead?.tentative }
}

/** The old 2026 world's four spans, the manager game's calendar. */
const LEGACY: [number, number][] = [[0, 20], [63, 90], [165, 198], [323, 363]]
function legacyCal(state: GameState): Cal {
  const d = state.day
  const at = LEGACY.find(([a, b]) => d >= a && d <= b)
  if (at) return { open: true, closesOn: absDay(state.year, at[1]) }
  const next = LEGACY.find(([a]) => a > d)
  return { open: false, nextOpens: next ? absDay(state.year, next[0]) : absDay(state.year + 1, 0) }
}

/* ------------------------------------------------------------------ */
/*  the answer                                                         */
/* ------------------------------------------------------------------ */

export interface WindowState {
  open: boolean
  rule: WindowRule
  /** whose window shut it: my club's, or the other club's */
  side?: 'mine' | 'other'
  /** the club it was read for */
  club?: string
  /** open: its last day, when it has one (absolute) */
  closesOn?: number
  /** shut: the day it opens again, or the day after the lock (absolute) */
  nextOpens?: number
  lock?: RosterLock
  /** a date here nobody has published */
  tentative?: boolean
}

/** One club's window. `fresh` reads its lock now rather than off the day's list. */
export function windowOfClub(state: GameState, team: Team, fresh = false): WindowState {
  const rule = ruleOf(state, team)
  const lock = fresh ? lockNow(state, team.id) : locksToday(state).get(team.id) ?? null
  const cal: Cal = rule === 'vct' ? vctCal(state, team) : rule === 'legacy' ? legacyCal(state) : { open: true }
  if (lock) {
    const after = absDay(state.year, lock.until + 1)
    const next = cal.open ? after : Math.max(after, cal.nextOpens ?? after)
    return { open: false, rule, club: team.id, lock, nextOpens: next, tentative: cal.tentative }
  }
  return { ...cal, rule, club: team.id }
}

/**
 * Can a move be made today: my club's window, when I have a club, and the other
 * club's, when there is one. The first that is shut is the answer.
 */
export function windowAt(state: GameState, teamId?: string): WindowState {
  const me = state.me
  const mine = me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const other = teamId && teamId !== mine?.id ? state.teams[teamId] : undefined
  const a = mine ? windowOfClub(state, mine, true) : null
  if (a && !a.open) return { ...a, side: 'mine' }
  const b = other ? windowOfClub(state, other) : null
  if (b && !b.open) return { ...b, side: 'other' }
  if (a && b) {
    const closes = [a.closesOn, b.closesOn].filter((x): x is number => x != null)
    return { ...a, closesOn: closes.length ? Math.min(...closes) : undefined, tentative: a.tentative || b.tentative }
  }
  return a ?? b ?? { open: true, rule: ruleOf(state, undefined) }
}

/** One club's window alone — a buyer's, a seller's — read off the day's list. */
export function clubOpen(state: GameState, teamId: string | null | undefined): boolean {
  const t = teamId ? state.teams[teamId] : undefined
  return !t || windowOfClub(state, t).open
}

/** Weeks until a move can be made: 0 while it can. */
export function weeksToWindow(state: GameState, teamId?: string): number {
  const w = windowAt(state, teamId)
  if (w.open) return 0
  const T = todayAbs(state)
  return Math.max(1, Math.ceil(((w.nextOpens ?? T + 7) - T) / 7))
}

/* ------------------------------------------------------------------ */
/*  words                                                              */
/* ------------------------------------------------------------------ */

const OPEN_WHY: Record<WindowRule, string> = {
  open: '这两年没有固定窗口，不打大赛的日子都能转',
  chal: 'Challengers 俱乐部只在打季后赛、晋级赛时锁名单',
  vct: '',
  legacy: '',
}

function shutWhy(state: GameState, w: WindowState): string {
  const club = w.club ? state.teams[w.club] : undefined
  const who = w.side === 'other' && club ? `${club.name}：` : ''
  if (w.rule === 'legacy') return `${who}赛季进行中`
  const T = todayAbs(state)
  const win = vctWindowOf(state.year)
  const champs = stagesOf(state.year, onTimeline(state)).find((s) => s.key === 'champions')
  if (win?.championsLock && win.closes !== 'stage2' && T > isoAbs(win.closes) && T <= absDay(state.year, champs?.end ?? 363)) {
    return `${who}${state.year} 赛季窗口 ${dateCn(isoAbs(win.closes), state.year)}已关，进冠军赛的队伍 ${dateCn(isoAbs(win.championsLock), state.year)}锁定最终名单`
  }
  return `${who}${champs && state.day > champs.end ? 'VCT 休赛期窗口还没开' : 'VCT 联赛赛季中'}`
}

/**
 * The window in one line, for the transfer screen and the week page:
 * 「转会窗口开放中 · 到 3月25日（还剩 12 天）」
 * 「转会窗口关闭 · VCT 联赛赛季中 · 下次开启：2023年9月11日（约 24 周后）」
 * 「名单锁定 · 你的俱乐部正在打 LOCK//IN 圣保罗 · 3月4日后解除」
 */
export function windowLine(state: GameState, teamId?: string): string {
  const w = windowAt(state, teamId)
  const T = todayAbs(state)
  const soft = w.tentative ? '（暂定）' : ''
  if (w.lock) {
    const who = w.side === 'other' ? (state.teams[w.club ?? '']?.name ?? '对方俱乐部') : '你的俱乐部'
    return `名单锁定 · ${who}正在打 ${w.lock.event} · ${dateCn(absDay(state.year, w.lock.until), state.year)}后解除`
  }
  if (w.open) {
    if (w.closesOn != null) return `转会窗口开放中 · 到 ${dateCn(w.closesOn, state.year)}（还剩 ${w.closesOn - T} 天）${soft}`
    const why = OPEN_WHY[w.rule]
    return `转会窗口开放中${why ? ` · ${why}` : ''}`
  }
  const next = w.nextOpens != null ? ` · 下次开启：${dateCn(w.nextOpens)}（约 ${Math.max(1, Math.round((w.nextOpens - T) / 7))} 周后）${soft}` : ''
  return `转会窗口关闭 · ${shutWhy(state, w)}${next}`
}

/** Why a move cannot be made today, for a greyed button; null while it can. */
export function windowBlock(state: GameState, teamId?: string): string | null {
  return windowAt(state, teamId).open ? null : windowLine(state, teamId)
}

/** The first day of the next transfer period (absolute): the day after the market day that closes this one (periodKey). */
export function nextPeriodAbs(state: Pick<GameState, 'year' | 'day'>): number {
  return nextMarketAbs(todayAbs(state) - 1) + 1
}

/**
 * Signed in this transfer period (me/contract.ts joinClub marks the period): no club asks me to a
 * tryout again until the next. The author, 2026-09-14: 「现在玩家在加入战队之后依然能收到战队试训
 * 邀请，把这个试训邀请改成只在转会期发，如果玩家在同一个转会期签约了，那就不发了，只能等下一个转会期
 * 让他又跳槽的可能」. Reproduced that day: signed on a period's first day at a Challengers club, a
 * week later the VCT clubs of his league sent 12 tryout invitations in 8 draws (me/transfer.ts vctApproach).
 */
export function signedThisPeriod(state: GameState): boolean {
  const at = state.me?.flags.signedPeriod
  return !!at && at === periodKey(state.year, state.day)
}

/**
 * Why no club can ask me to a tryout today, or null while one can — the one gate every invitation
 * passes (me/prepro.ts rollInvites, cupInvite; me/transfer.ts vctApproach): a move already agreed;
 * a signing in this transfer period; or the window, mine when I have a club and `teamId`'s when
 * given (windowAt). The screens grey the invitations with this line instead of hiding them.
 */
export function inviteBlock(state: GameState, teamId?: string): string | null {
  const me = state.me
  if (me?.moveAfter) return `已经和 ${state.teams[me.moveAfter.deal.teamId]?.name ?? '下一家'} 谈妥，不再去别家试训`
  if (signedThisPeriod(state)) return `这个转会期刚签约，下个转会期（${dateCn(nextPeriodAbs(state), state.year)}起）才会有俱乐部来邀请试训`
  return windowBlock(state, teamId)
}

/** This season's VCT windows in dates. */
function vctWindowsCn(state: GameState): string {
  const y = state.year
  const w = vctWindowOf(y)
  const next = vctWindowOf(y + 1)
  if (!w) return ''
  const mine = state.me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const closes = w.closes === 'stage2'
    ? (mine && inVctLeague(state, mine) ? `${dateCn(stage2Close(regionIn(mine.region, y), y).at, y)}（你所在联赛第二赛段季后赛前一周，暂定）` : '各联赛第二赛段季后赛开打前一周（暂定）')
    : dateCn(isoAbs(w.closes), y)
  const mid = w.mid ? `、${dateCn(isoAbs(w.mid[0]), y)}–${dateCn(isoAbs(w.mid[1]), y)}` : ''
  const lock = w.championsLock ? `，进冠军赛的队伍 ${dateCn(isoAbs(w.championsLock), y)}锁定最终名单` : ''
  const after = next ? `；下个赛季的窗口 ${dateCn(isoAbs(next.opens), y)}开${next.tentative ? '（暂定）' : ''}` : ''
  return `${dateCn(isoAbs(w.opens), y)}–${closes}${mid}${w.tentative ? '（暂定）' : ''}${lock}${after}`
}

/** The year's rule in plain words, for the help page and the tour. */
export function windowRuleLines(state: GameState): string[] {
  const y = state.year
  const out: string[] = []
  if (y <= 2022) {
    out.push(`${y} 年还没有联盟，也没有固定的转会窗口：俱乐部只要不在打大赛——国际赛、最后机会资格赛${y === 2021 ? '、赛区大师赛和挑战者决赛' : ''}——随时能签人。大赛开打那天锁名单，出局或打完就解除。`)
  } else {
    out.push(`VCT 联赛俱乐部照 Riot 的转会窗口：${vctWindowsCn(state)}。打国际赛、最后机会资格赛和本联赛季后赛期间名单锁定。`)
    out.push('Challengers 和其他联赛外的俱乐部不设固定窗口，只在打季后赛、晋级赛这类升级赛时锁名单——比 Riot 的规定宽，是有意的。')
  }
  out.push('一笔转会要两边俱乐部的窗口都开着。开着的时候，赛段结束、6 月中和 11 月下旬的两个转会日、平常的每周都可能来报价，每半个赛季最多来一轮。')
  out.push('试训邀请也只在窗口开着时来。在一个转会期里刚签约的，这个转会期不会再有俱乐部来请你试训，一线俱乐部也不会来挖人，要等下个转会期。')
  out.push('谈妥时有一边名单锁定的，比赛打完才正式转会。')
  return out
}
