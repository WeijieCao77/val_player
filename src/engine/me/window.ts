import type { Competition, GameState, Team } from '../types'
import { onTimeline, regionIn, stagesOf } from '../era'
import { datesKnown, drawOutlook, eventOf, eventsOf, floorOf, gameOf, phaseOnlyOf, roundAheadOf } from '../circuit'
import type { CEvent } from '../circuit'
import { inVctLeague, sceneFor } from '../timeline'

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
 * The author's direction then: 「转会窗口开的时间要多一些，特别是完整的联赛成立之前，其实大家的转会
 * 都很随意，没有特定的时间，基本只要不是大赛比赛期间都是到处转的」 — about the years before the
 * leagues, and carried past them: from 2023 a VCT league club had Riot's windows, from after Champions
 * to a week before its league's Stage 2 playoffs, shut only by internationals and stage playoffs, and a
 * club below the leagues locked only for its own playoffs and its ways up. Reported the same day, off a
 * screen reading 「转会窗口开放中 · 到 2026年8月7日（还剩 275 天）（暂定）」: 「转会窗口太长了，在有vct
 * 联赛之后，联赛赛事期间都应该没办法转会，只有赛事间隔休息期才开转会窗口」. By year:
 *
 *  - 2021–2022, the open circuit: no set window. A club is closed only while it
 *    plays a major event — an international, a Last Chance Qualifier, 2021's
 *    regional Masters and Challengers Finals — from the event's first day to the
 *    day it is out, or the event's last.
 *  - 2023 on, every club, VCT league or Challengers alike: closed from the first day
 *    to the last day of every event it plays that season — its league's Kickoff,
 *    Stage 1 and Stage 2 (from 2027 its Cups, Open Playoffs and open qualifiers), a
 *    Challengers league's splits and stages, Masters and Champions, a Last Chance
 *    Qualifier, an Ascension, an open qualifier or play-in it enters — and open only in
 *    the gaps between them. The offseason is one: from the day after its last event of
 *    the season to the day before its first of the next. Riot's published windows are
 *    not read. Where it could go either way it leans closed (「赛事期间都应该没办法转会」):
 *      · on an event's floor — seeded into its own matches, or sent on to them by its
 *        qualifier (circuit.ts floorOf): from the event's first day, its qualifiers'
 *        days included, to its last, whether it is out early or not — a Masters' Swiss
 *        stage lost, a league stage whose playoffs it did not reach, an Ascension's
 *        groups: a roster registered for it. The line says it is out;
 *      · in a phase kept as its result — an open or closed qualifier, a regular season,
 *        a promotion series, played as history had it — and no further (circuit.ts
 *        phaseOnlyOf): from that phase's first day to its last, the day it went out not
 *        being on record;
 *      · the player's club in its decider for a place (circuit.ts offerPlayIn,
 *        planPlayIn): from the first day of the qualifier it enters (a seat's decider:
 *        the decider's own day) to the decider's day, lost; won, to the event's last
 *        day. Before it is played the day it lifts is 暂定;
 *      · an event opening before 1 January: from 1 January, the day its season goes on
 *        the books — the days before it hold only its qualifiers, history's;
 *      · an event not drawn yet holds nobody until its draw, the day before it opens.
 *        The dates the screen gives — open until, open again from — read the club's
 *        place in each such event as its draw stands today (circuit.ts drawOutlook): a
 *        seat counts for the event's days, a phase history booked it into for that
 *        phase's, an open qualifier the player's club will enter for its days up to the
 *        decider, 暂定; a place it may still earn — a Masters, Champions, an LCQ — does
 *        not, and makes a date after it 暂定. So do an event whose days nobody has
 *        announced (circuit.ts datesKnown) and next season's first event, which is not
 *        drawn until the season turns. Unknown future events are 暂定.
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

/** 2023 on, on the timeline: every event a club plays shuts its window, whatever its tier (see the header). */
const byEvents = (state: GameState): boolean => state.year >= 2023 && onTimeline(state)

/**
 * The day as the books stand: its date, and how many events are on them, drawn and over — an event drawn,
 * or one finished, since the morning changes who is held and what is ahead. The day's caches key on it.
 */
function dayKey(state: GameState): string {
  let n = 0
  let drawn = 0
  let over = 0
  for (const c of Object.values(state.comps)) {
    n++
    if (c.circuit?.mode) drawn++
    if (c.champion || c.circuit?.done) over++
  }
  return `${state.year}:${state.day}:${n}:${drawn}:${over}`
}

/** A cache that lives for one day of one state (dayKey). */
function daily<T>(book: WeakMap<GameState, { at: string; of: Map<string, T> }>, state: GameState, at: string, key: string, make: () => T): T {
  let hit = book.get(state)
  if (hit?.at !== at) {
    hit = { at, of: new Map() }
    book.set(state, hit)
  }
  if (!hit.of.has(key)) hit.of.set(key, make())
  return hit.of.get(key) as T
}

/* ------------------------------------------------------------------ */
/*  roster locks                                                       */
/* ------------------------------------------------------------------ */

export interface RosterLock {
  /** the event, by the name the screens use */
  event: string
  comp: string
  /** its last day this year: the lock lifts after it — 2021–2022, or once the club is out */
  until: number
  /**
   * `major`: 2021–2022, and the old 2026 world. From 2023: `event`, an event the club is on the floor of;
   * `phase`, a phase kept as its result the club played and went no further from; `decider`, the player's
   * club's decider for a place, to play or lost
   */
  kind: 'major' | 'event' | 'phase' | 'decider'
  /** 2023 on: out of it — knocked out, or its decider lost — and held to `until` all the same (windowOfClub reads it for the club asked about) */
  out?: boolean
  /** 2023 on: its decider still to play — lost, the lock lifts the day after it, so `until` is 暂定 */
  pending?: boolean
}

/** 2021's regional events that fed an international (engine/circuit.ts TOP): its Masters and its Challengers Finals. */
const OPEN_MAJORS = new Set<string>(['s1masters', 's2finals', 's3finals'])

/** 2021–2022, and the old 2026 world: the days a major locks a club playing it. Null for any other event. */
function majorSpan(state: GameState, comp: Competition): { from: number; until: number } | null {
  const c = comp.circuit
  if (!c) {
    // the old 2026 world: its internationals, on its own calendar
    if (comp.region || !['masters1', 'masters2', 'champions'].includes(comp.stage)) return null
    const s = stagesOf(state.year, false).find((x) => x.key === comp.stage)
    return s ? { from: s.start, until: s.end } : null
  }
  const ev = eventOf(c.id)
  if (!ev) return null
  return ev.region === null || ev.stage === 'lcq' || (!!ev.stage && OPEN_MAJORS.has(ev.stage)) ? { from: c.start, until: c.end } : null
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

function majorLock(state: GameState, comp: Competition, id: string): RosterLock | null {
  if (!state.teams[id]) return null
  const span = majorSpan(state, comp)
  if (!span || state.day < span.from || state.day > span.until || !stillIn(state, comp, id)) return null
  return { event: comp.name, comp: comp.key, until: span.until, kind: 'major' }
}

interface Hold { from: number; until: number; kind: 'event' | 'phase' | 'decider'; pending?: boolean }

const HOLDS = new WeakMap<GameState, { at: string; of: Map<string, Map<string, Hold>> }>()
/**
 * 2023 on: whom a drawn event holds, from which day to which (see the header), 1 January at the
 * earliest: its floor for the event's days; a club in a phase kept as its result and no further, that
 * phase's; the player's club in its decider, from the first day of its qualifier to the decider's
 * day, or once it is won to the event's last. Read once a day, and again once the decider is played.
 */
function holdsOf(state: GameState, comp: Competition): Map<string, Hold> {
  const c = comp.circuit!
  const decider = c.playin ? state.fixtures.find((f) => f.id === c.playin!.fixture) : undefined
  const key = `${comp.key}:${c.mode}:${decider ? (gameOf(decider)?.w ?? (decider.played ? '=' : '-')) : ''}:${c.seeds.join(',')}`
  return daily(HOLDS, state, `${state.year}:${state.day}`, key, () => {
    const out = new Map<string, Hold>()
    for (const [id, [a, b]] of phaseOnlyOf(state, comp)) out.set(id, { from: Math.max(0, a), until: b, kind: 'phase' })
    const from = Math.max(0, c.start)
    for (const id of floorOf(state, comp)) out.set(id, { from, until: c.end, kind: 'event' })
    if (decider) {
      const club = decider.teamA
      // an open qualifier's place: the club is in that qualifier from its first day; a seat's decider is its own day
      const ui = /^(\d+):/.exec(c.playin!.key)
      const first = ui ? eventOf(c.id)?.units[Number(ui[1])]?.first ?? c.start : decider.day
      const start = Math.max(0, Math.min(first, decider.day))
      if (!decider.played) out.set(club, { from: start, until: c.end, kind: 'decider', pending: true })
      else if (gameOf(decider)?.w === club) out.set(club, { from: start, until: c.end, kind: 'event' })
      else out.set(club, { from: start, until: decider.day, kind: 'decider' })
    }
    return out
  })
}

/** 2023 on: the lock a drawn event puts on a club today, if it holds the club today. */
function eventLock(state: GameState, comp: Competition, id: string): RosterLock | null {
  const c = comp.circuit
  if (!c || !c.mode || c.done || state.day > c.end || state.day < c.start - 1) return null
  const h = holdsOf(state, comp).get(id)
  if (!h || state.day < h.from || state.day > h.until) return null
  return { event: comp.name, comp: comp.key, until: h.until, kind: h.kind, ...(h.pending ? { pending: true } : {}) }
}

/** Of two events holding a club at once, the one that holds it longer. */
const longer = (a: RosterLock | null, b: RosterLock | null): RosterLock | null => (!a ? b : !b || b.until <= a.until ? a : b)

/** A club's lock now, read fresh: my own match today may have been played since the morning. */
export function lockNow(state: GameState, id: string): RosterLock | null {
  if (byEvents(state)) {
    let best: RosterLock | null = null
    for (const comp of Object.values(state.comps)) best = longer(best, eventLock(state, comp, id))
    return best
  }
  for (const comp of Object.values(state.comps)) {
    if (!under(state, comp) || !heldBy(comp).includes(id)) continue
    const l = majorLock(state, comp, id)
    if (l) return l
  }
  return null
}

/** Every club under a lock today, read once a day: by the time anyone else is asked about, the day's matches are played. */
const TODAY = new WeakMap<GameState, { at: string; locks: Map<string, RosterLock> }>()
function locksToday(state: GameState): Map<string, RosterLock> {
  const events = byEvents(state)
  // from 2023 an event drawn since the morning holds its field at once
  const at = events ? dayKey(state) : `${state.year}:${state.day}`
  const hit = TODAY.get(state)
  if (hit?.at === at) return hit.locks
  const locks = new Map<string, RosterLock>()
  for (const comp of Object.values(state.comps)) {
    if (events) {
      const c = comp.circuit
      if (!c || !c.mode || c.done || state.day > c.end || state.day < c.start - 1) continue
      for (const id of holdsOf(state, comp).keys()) {
        const l = longer(locks.get(id) ?? null, eventLock(state, comp, id))
        if (l) locks.set(id, l)
      }
      continue
    }
    if (!under(state, comp)) continue
    for (const id of heldBy(comp)) {
      if (locks.has(id)) continue
      const l = majorLock(state, comp, id)
      if (l) locks.set(id, l)
    }
  }
  TODAY.set(state, { at, locks })
  return locks
}

/** 2023 on: out of the event that holds it — knocked out, or its decider lost. History's events, and a phase played as history, are not read for it. */
function outOf(state: GameState, lock: RosterLock, id: string): boolean {
  const comp = state.comps[lock.comp]
  const c = comp?.circuit
  if (!comp || !c || lock.kind === 'phase') return false
  if (lock.kind === 'decider') {
    const f = c.playin ? state.fixtures.find((x) => x.id === c.playin!.fixture) : undefined
    return !!f?.played && gameOf(f)?.w !== id
  }
  if (comp.champion) return comp.champion !== id
  return c.mode === 'sim' && !stillIn(state, comp, id)
}

/* ------------------------------------------------------------------ */
/*  calendars                                                          */
/* ------------------------------------------------------------------ */

interface Cal { open: boolean; closesOn?: number; nextOpens?: number; tentative?: boolean }

/** The old 2026 world's four spans, the manager game's calendar. */
const LEGACY: [number, number][] = [[0, 20], [63, 90], [165, 198], [323, 363]]
function legacyCal(state: GameState): Cal {
  const d = state.day
  const at = LEGACY.find(([a, b]) => d >= a && d <= b)
  if (at) return { open: true, closesOn: absDay(state.year, at[1]) }
  const next = LEGACY.find(([a]) => a > d)
  return { open: false, nextOpens: next ? absDay(state.year, next[0]) : absDay(state.year + 1, 0) }
}

/** 2023 on: days an event holds a club, absolute, by the event's name; `tentative` when a date here is 暂定. */
interface Busy { from: number; until: number; name: string; tentative: boolean }

const OUTLOOK = new WeakMap<GameState, { at: string; of: Map<string, ReturnType<typeof drawOutlook>> }>()
const PHASES = new WeakMap<GameState, { at: string; of: Map<string, Map<string, [number, number]>> }>()
const SCENES = new WeakMap<GameState, { at: string; of: Map<string, string | undefined> }>()

/** The latest day an open qualifier not drawn yet plays the player's club's decider: its open phases' last day, or its draw's eve (me/nextup.ts deciderBy). */
const deciderDay = (comp: Competition, ev: CEvent): number =>
  Math.max(comp.circuit!.start - 1, ...ev.units.filter((u) => u.type === 'open').map((u) => u.last ?? 0))

/**
 * Whether an event not drawn yet can have anything of the club's, before its draw is read — each read
 * draws the event's field, and from 2027 one read of an event of the new format can take tens of
 * milliseconds: an international; one history booked the club into; its Challengers league's; one whose
 * regions take in the club's.
 */
function concerns(state: GameState, ev: CEvent, comp: Competition, team: Team, at: string): boolean {
  if (ev.region === null || comp.teams.includes(team.id)) return true
  // a read: the scene it works out is not kept on the club (timeline.ts sceneFor)
  if (ev.scene) return daily(SCENES, state, at, team.id, () => sceneFor(state, team, false)) === ev.scene
  const league = regionIn(team.region, state.year)
  return (ev.layer ?? [ev.region]).some((r) => r === team.region || r === league)
}

/**
 * 2023 on: the days an event of this season holds the club, or will as its draw stands today;
 * `maybe` for a place it may still earn (see the header).
 */
function busyIn(state: GameState, comp: Competition, team: Team, at: string): Busy | 'maybe' | null {
  const c = comp.circuit
  const ev = c && eventOf(c.id)
  if (!c || !ev || c.done || comp.champion) return null
  const y = state.year
  const tentative = !datesKnown(ev)
  if (c.mode) {
    const h = holdsOf(state, comp).get(team.id)
    return h ? { from: absDay(y, h.from), until: absDay(y, h.until), name: comp.name, tentative: tentative || !!h.pending } : null
  }
  if (!concerns(state, ev, comp, team, at)) return null
  const o = daily(OUTLOOK, state, at, `${comp.key}:${team.id}`, () => drawOutlook(state, comp, team.id))
  if (o?.standing === 'seated') return { from: absDay(y, Math.max(0, c.start)), until: absDay(y, c.end), name: comp.name, tentative }
  // a phase history booked it into and no further (circuit.ts phaseOnlyOf)
  const phase = daily(PHASES, state, at, comp.key, () => phaseOnlyOf(state, comp)).get(team.id)
  if (phase) return { from: absDay(y, Math.max(0, phase[0])), until: absDay(y, phase[1]), name: comp.name, tentative }
  // an open qualifier the player's club will enter (circuit.ts offerPlayIn, planPlayIn): its days up to the decider, the rest up to the result
  if (o?.standing === 'entry' && state.me?.phase === 'pro' && team.id === state.myTeam) {
    const last = deciderDay(comp, ev)
    const first = Math.min(last, ...ev.units.filter((u) => u.type === 'open').map((u) => u.first ?? c.start))
    return { from: absDay(y, Math.max(0, first)), until: absDay(y, last), name: comp.name, tentative: true }
  }
  return o?.standing === 'maybe' || o?.standing === 'entry' ? 'maybe' : null
}

const FIRST_OF = new Map<string, CEvent | null>()
/** A season's first event that `pick` takes, read once for each `key`. */
function firstOf(y: number, key: string, pick: (ev: CEvent) => boolean): CEvent | null {
  const at = `${y}:${key}`
  if (!FIRST_OF.has(at)) {
    const evs = eventsOf(y).filter((ev) => ev.start != null && ev.end != null && pick(ev)).sort((a, b) => a.start! - b.start!)
    FIRST_OF.set(at, evs[0] ?? null)
  }
  return FIRST_OF.get(at)!
}

/**
 * Next season's first event for the club, not drawn until the season turns (暂定): the earlier of its
 * league's Kickoff and the first event history books it into; for a club outside the leagues with no
 * booking — a year nobody has played — the first event of its Challengers league with matches of its own.
 */
function firstNextSeason(state: GameState, team: Team): Busy | null {
  const y = state.year + 1
  const league = inVctLeague(state, team) ? regionIn(team.region, y) : null
  const vlr = team.id.startsWith('V21T') ? team.id.slice(4) : null
  const heirs = Object.entries(state.heirs ?? {}).filter(([, to]) => to === team.id).map(([from]) => from.slice(4))
  const own = new Set([...(vlr ? [vlr] : []), ...heirs])
  const booked = own.size ? firstOf(y, `booked:${[...own].sort().join('+')}`, (ev) => !ev.projected && ev.seeds.some((v) => own.has(v))) : null
  const kickoff = league ? firstOf(y, `kickoff:${league}`, (ev) => !ev.scene && ev.region === league && ev.stage === 'kickoff') : null
  let best: CEvent | undefined = [booked, kickoff].filter((ev): ev is CEvent => !!ev).sort((a, b) => a.start! - b.start!)[0]
  if (!best && !league) {
    const scene = sceneFor(state, team, false)
    best = (scene ? firstOf(y, `scene:${scene}`, (ev) => ev.scene === scene && ev.units.some((u) => u.type !== 'open')) : null) ?? undefined
  }
  return best ? { from: absDay(y, Math.max(0, best.start!)), until: absDay(y, best.end!), name: best.cn, tentative: true } : null
}

const BUSY = new WeakMap<GameState, { at: string; of: Map<string, Busy | null> }>()
/**
 * 2023 on: the first days on or after `from` (absolute) that an event holds the club, as known
 * today, clipped to start there — this season's events, and past its last, next season's first.
 * 暂定 when a place the club may still earn opens before them.
 */
function busyFrom(state: GameState, team: Team, from: number, at: string): Busy | null {
  return daily(BUSY, state, at, `${team.id}:${from}`, () => {
    const y = state.year
    const comps = Object.values(state.comps)
      .filter((x) => !!x.circuit && !x.circuit.done && !x.champion && absDay(y, x.circuit.end) >= from)
      .sort((a, b) => a.circuit!.start - b.circuit!.start || a.key.localeCompare(b.key))
    let best: Busy | null = null
    const maybes: number[] = []
    for (const comp of comps) {
      // an event opening after the days found holds nothing sooner: a decider comes on its eve at the earliest
      if (best && absDay(y, comp.circuit!.start - 1) > best.from) break
      const b = busyIn(state, comp, team, at)
      if (b === 'maybe') { maybes.push(absDay(y, Math.max(0, comp.circuit!.start - 1))); continue }
      if (!b || b.until < from) continue
      const start = Math.max(b.from, from)
      if (!best || start < best.from) best = { ...b, from: start }
    }
    if (best) return maybes.some((d) => d <= best!.from) ? { ...best, tentative: true } : best
    const next = firstNextSeason(state, team)
    return next && next.until >= from ? { ...next, from: Math.max(next.from, from) } : null
  })
}

/** 2023 on: the first day after `until` (absolute) that no event holds the club, as known today, and the events that follow with no day between. */
function freeAfter(state: GameState, team: Team, until: number, at: string): { at: number; tentative: boolean; then: string[] } {
  let day = until + 1
  let tentative = false
  const then: string[] = []
  for (let i = 0; i < 16; i++) {
    const b = busyFrom(state, team, day, at)
    if (!b || b.from > day) break
    day = b.until + 1
    tentative ||= b.tentative
    if (!then.includes(b.name)) then.push(b.name)
  }
  return { at: day, tentative, then }
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
  /** open, 2023 on: the event that shuts it after `closesOn` */
  closer?: string
  /** shut: the day it opens again, or the day after the lock (absolute) */
  nextOpens?: number
  lock?: RosterLock
  /** shut, 2023 on: the events after the lock's that hold the club with no day between */
  then?: string[]
  /** a date here nobody has published */
  tentative?: boolean
}

/**
 * One club's window. `fresh` reads its lock now rather than off the day's list; `dates` works out,
 * from 2023, how long it stays open or when it opens again — a read of the events ahead that
 * clubOpen, which only asks open or shut, goes without.
 */
export function windowOfClub(state: GameState, team: Team, fresh = false, dates = true): WindowState {
  const rule = ruleOf(state, team)
  const lock = fresh ? lockNow(state, team.id) : locksToday(state).get(team.id) ?? null
  if (byEvents(state)) {
    if (!dates) return lock ? { open: false, rule, club: team.id, lock } : { open: true, rule, club: team.id }
    const T = todayAbs(state)
    const at = dayKey(state)
    if (lock) {
      const ev = eventOf(state.comps[lock.comp]?.circuit?.id ?? '')
      const free = freeAfter(state, team, absDay(state.year, lock.until), at)
      return {
        open: false, rule, club: team.id, lock: { ...lock, out: outOf(state, lock, team.id) }, nextOpens: free.at,
        then: free.then.length ? free.then : undefined, tentative: free.tentative || !!lock.pending || (!!ev && !datesKnown(ev)),
      }
    }
    const next = busyFrom(state, team, T, at)
    return next
      ? { open: true, rule, club: team.id, closesOn: Math.max(T, next.from - 1), closer: next.name, tentative: next.tentative }
      : { open: true, rule, club: team.id }
  }
  const cal: Cal = rule === 'legacy' ? legacyCal(state) : { open: true }
  if (lock) {
    const after = absDay(state.year, lock.until + 1)
    const next = cal.open ? after : Math.max(after, cal.nextOpens ?? after)
    return { open: false, rule, club: team.id, lock, nextOpens: next, tentative: cal.tentative }
  }
  return { ...cal, rule, club: team.id }
}

/**
 * Can a move be made today: my club's window, when I have a club, and the other
 * club's, when there is one. The first that is shut is the answer. `dates`: as
 * windowOfClub — a caller that only asks open or shut goes without.
 */
export function windowAt(state: GameState, teamId?: string, dates = true): WindowState {
  const me = state.me
  const mine = me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const other = teamId && teamId !== mine?.id ? state.teams[teamId] : undefined
  const a = mine ? windowOfClub(state, mine, true, dates) : null
  if (a && !a.open) return { ...a, side: 'mine' }
  const b = other ? windowOfClub(state, other, false, dates) : null
  if (b && !b.open) return { ...b, side: 'other' }
  if (a && b) {
    const first = [a, b].filter((x) => x.closesOn != null).sort((x, y) => x.closesOn! - y.closesOn!)[0]
    return { ...a, closesOn: first?.closesOn, closer: first?.closer, tentative: first ? first.tentative : a.tentative || b.tentative }
  }
  return a ?? b ?? { open: true, rule: ruleOf(state, undefined) }
}

/** One club's window alone — a buyer's, a seller's — read off the day's list. */
export function clubOpen(state: GameState, teamId: string | null | undefined): boolean {
  const t = teamId ? state.teams[teamId] : undefined
  return !t || windowOfClub(state, t, false, false).open
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

function openWhy(state: GameState, w: WindowState): string {
  if (w.rule === 'open') return '这两年没有固定窗口，不打大赛的日子都能转'
  if (byEvents(state)) return '眼下没有要打的赛事'
  return w.rule === 'chal' ? 'Challengers 俱乐部不设窗口' : ''
}

/** What a locked club is doing, in the screens' words: 「正在打 X」, or out of it and held all the same. */
export function lockDoing(lock: RosterLock): string {
  if (!lock.out) return `正在打 ${lock.event}`
  return lock.kind === 'decider' ? `在 ${lock.event} 的决胜局出局` : `已在 ${lock.event} 出局，名单锁到赛事结束`
}

/** The last day of a lock (absolute): its event's, or, from 2023, that of the last event after it with no day between. */
export function lockLifts(state: GameState, w: WindowState): number {
  return w.then?.length && w.nextOpens != null ? w.nextOpens - 1 : absDay(state.year, w.lock?.until ?? state.day)
}

/** The last day of the lock a move agreed under it waits for (absolute), read now (me/contract.ts settleMove makes it the day after). */
export function moveLifts(state: GameState): number | null {
  const m = state.me?.moveAfter
  if (!m) return null
  const w = windowAt(state, m.deal.teamId)
  return w.lock ? lockLifts(state, w) : absDay(m.year ?? state.year, m.until)
}

/**
 * The window in one line, for the transfer screen and the week page:
 * 「转会窗口开放中 · 到 3月25日（还剩 12 天） · 之后打 美洲联赛 · 第一赛段」
 * 「名单锁定 · 你的俱乐部正在打 LOCK//IN 圣保罗 · 3月4日后解除」
 * 「名单锁定 · 你的俱乐部已在 马德里大师赛 出局，名单锁到赛事结束 · 3月24日后解除」
 * 「名单锁定 · 你的俱乐部正在打 EMEA 联赛 · 揭幕赛，接着打 曼谷大师赛 · 3月1日后解除（暂定）」
 * 「转会窗口关闭 · 赛季进行中 · 下次开启：6月15日（约 9 周后）」（the old 2026 world）
 */
export function windowLine(state: GameState, teamId?: string): string {
  const w = windowAt(state, teamId)
  const T = todayAbs(state)
  const soft = w.tentative ? '（暂定）' : ''
  if (w.lock) {
    const who = w.side === 'other' ? (state.teams[w.club ?? '']?.name ?? '对方俱乐部') : '你的俱乐部'
    const then = w.then?.length ? `，接着打 ${w.then.join('、')}` : ''
    return `名单锁定 · ${who}${lockDoing(w.lock)}${then} · ${dateCn(lockLifts(state, w), state.year)}后解除${soft}`
  }
  if (w.open) {
    if (w.closesOn != null) return `转会窗口开放中 · 到 ${dateCn(w.closesOn, state.year)}（还剩 ${w.closesOn - T} 天）${soft}${w.closer ? ` · 之后打 ${w.closer}` : ''}`
    const why = openWhy(state, w)
    return `转会窗口开放中${why ? ` · ${why}` : ''}`
  }
  const club = w.club ? state.teams[w.club] : undefined
  const who = w.side === 'other' && club ? `${club.name}：` : ''
  const next = w.nextOpens != null ? ` · 下次开启：${dateCn(w.nextOpens)}（约 ${Math.max(1, Math.round((w.nextOpens - T) / 7))} 周后）${soft}` : ''
  return `转会窗口关闭 · ${who}赛季进行中${next}`
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
 * Why no move can reach me today because I signed in this transfer period, or null: the one gate for
 * every way a club comes for me — a tryout invitation, an offer (on the bench or listed, too), a VCT
 * club, a story's promised terms — and for putting myself on the market. The author's rule, applied
 * to every move (2026-09-14): 「如果玩家在同一个转会期签约了，那就不发了，只能等下一个转会期让他又
 * 跳槽的可能」. A renewal from my own club is not a move. `what` is what waits for the next period.
 */
export function moveBlock(state: GameState, what = '才会有俱乐部来邀请试训或报价'): string | null {
  if (!signedThisPeriod(state)) return null
  return `这个转会期刚签约，下个转会期（${dateCn(nextPeriodAbs(state), state.year)}起）${what}`
}

/**
 * Why no club can ask me to a tryout today, or null while one can — the one gate every invitation
 * passes (me/prepro.ts rollInvites, cupInvite; me/transfer.ts vctApproach): a move already agreed;
 * a signing in this transfer period (moveBlock); or the window, mine when I have a club and `teamId`'s
 * when given (windowAt). The screens grey the invitations with this line instead of hiding them.
 */
export function inviteBlock(state: GameState, teamId?: string): string | null {
  const me = state.me
  if (me?.moveAfter) return `已经和 ${state.teams[me.moveAfter.deal.teamId]?.name ?? '下一家'} 谈妥，不再去别家试训`
  return moveBlock(state) ?? windowBlock(state, teamId)
}

/**
 * Why I cannot put myself on the market today, or null while I can (me/transfer.ts listSelf): no
 * contract, a move already agreed, the period I signed in (moveBlock), the window, a listing already
 * made this year. The transfer screen's button can grey itself with this same line.
 */
export function listBlock(state: GameState): string | null {
  const me = state.me
  if (!me || me.phase !== 'pro') return '你现在没有合同可挂'
  if (me.moveAfter) return '已经谈妥了下一家，等名单锁定解除'
  const signed = moveBlock(state, '才能挂牌')
  if (signed) return signed
  const shut = windowBlock(state)
  if (shut) return `${shut}。挂牌没人看`
  if (me.listedYear === state.year) return '今年已经挂过牌了'
  return null
}

/** The year's rule in plain words, for the help page and the tour. */
export function windowRuleLines(state: GameState): string[] {
  const y = state.year
  const out: string[] = []
  if (y <= 2022) {
    out.push(`${y} 年还没有联盟，也没有固定的转会窗口：俱乐部只要不在打大赛——国际赛、最后机会资格赛${y === 2021 ? '、赛区大师赛和挑战者决赛' : ''}——随时能签人。大赛开打那天锁名单，出局或打完就解除。`)
  } else if (onTimeline(state)) {
    out.push('有了 VCT 联赛以后，VCT 联赛俱乐部和 Challengers 俱乐部一个规矩：俱乐部打的每一项赛事，从第一天到最后一天都锁名单——联赛的揭幕赛、第一赛段、第二赛段（2027 年起是杯赛、公开季后赛和公开资格赛），Challengers 联赛的各个赛段，大师赛、冠军赛、最后机会资格赛、晋升赛，打的海选、资格赛和升降级赛也算。提前出局、没打进季后赛，也要等这项赛事结束才解锁；只打了海选或资格赛、没打进正赛的，那一轮结束解锁。你的俱乐部报名打决胜局的，从那轮海选第一天锁，输了第二天解锁，赢了锁到赛事结束。')
    out.push('转会窗口只在两项赛事之间的空档开。休赛期也是空档：从这个赛季最后一项赛事的第二天，到下个赛季第一项赛事的前一天。还没抽签的赛事按眼下的形势算；大师赛、冠军赛这类还要看打不打得进的，还有没公布日期的赛事，窗口的日期标「暂定」。')
  } else {
    out.push(`VCT 联赛俱乐部每年四段转会窗口：${LEGACY.map(([a, b]) => `${dateCn(absDay(y, a), y)}–${dateCn(absDay(y, b), y)}`).join('、')}；Challengers 俱乐部不设窗口。打国际赛期间名单锁定。`)
  }
  out.push('一笔转会要两边俱乐部的窗口都开着。开着的时候，赛段结束、6 月中和 11 月下旬的两个转会日、平常的每周都可能来报价，每半个赛季最多来一轮。')
  out.push('试训邀请也只在窗口开着时来。在一个转会期里刚签约的，这个转会期不会再有俱乐部来请你试训或报价，外区的邀约顺延，自己也不能挂牌，要等下个转会期；自己俱乐部的续约不受影响。')
  out.push('谈妥时有一边名单锁定的，锁定解除才正式转会。')
  return out
}
