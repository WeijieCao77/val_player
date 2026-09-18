import { drawOutlook, eventOf, nextSeasonFor, outlookAsMine, roundAheadOf } from '../circuit'
import type { DrawStanding, RoundAhead } from '../circuit'
import { formatOf, onTimeline, stagesOf } from '../era'
import { nextInEvent, upcomingInternational } from '../qualify'
import { nextRealFixtureFor } from '../season'
import type { Competition, Fixture, GameState, Team } from '../types'

/** The latest day an event not drawn yet can play a club's decider: its open qualifiers' last day, or its draw's (circuit.ts offerPlayIn, planPlayIn). */
const deciderBy = (c: Competition): number =>
  Math.max(c.circuit!.start - 1, ...(eventOf(c.circuit!.id)?.units ?? []).filter((u) => u.type === 'open').map((u) => u.last ?? 0))

/**
 * My club's next match, whether or not its tie is written yet: what the week's
 * 「下一场」 panel names, the rows the schedule page draws for us before a tie
 * exists, and what a month's fast-forward asks about (me/auto.ts quietAhead).
 *
 * Reported 2026-09-14: 「我在赛程里看到我打了一场比赛说明联赛都开始了，但是在本周
 * 栏目里显示没有安排好的比赛」. The panel read only the ties already written
 * (season.ts nextRealFixtureFor), and a real event writes a tie only once both
 * of its sides are known (circuit.ts playOn). A club that had just lost the
 * first Swiss round of a league stage, or sat seeded into a playoff while the
 * groups feeding it were still on, knew its round and its day, and the panel
 * said nothing was scheduled — for up to twenty days (scripts/probe_nextup.ts).
 * Between two events it said the same with the next one already holding the
 * club's place, and the week offered to run a month three weeks before a
 * Masters the club had qualified for.
 */

/** What a round with no tie yet still waits on: see circuit.ts RoundAhead; `draw` is an international's draw. */
export type Wait = RoundAhead['wait'] | 'draw'

/** The panel's line under a round with no tie yet. */
export const WAIT_CN: Record<Wait, string> = {
  match: '对手待定：要等另一场比赛打完。',
  group: '对手待定：要等小组赛打完。',
  qualifier: '对手待定：从资格赛打上来的队伍。',
  entry: '对手待定：要等报名决胜局打完。',
  draw: '对阵待抽签。',
}

export type NextUp =
  /** a tie written: its opponent and its day */
  | { kind: 'fixture'; day: number; fixture: Fixture }
  /** a round that is mine, its tie not written yet: the other side is known once `wait` is over */
  | { kind: 'round'; day: number; name: string; round: string; bo?: number; opponent: string | null; wait: Wait; comp?: Competition }
  /** in an event under way, whether there is a next round of mine waits on a phase still being played; `round` is where it would be */
  | { kind: 'waiting'; day: number; name: string; round: string; comp: Competition }
  /**
   * nothing of mine sooner: the next event, its draw as things stand seating my club (`sure`) or open for it to
   * enter. `day` is my club's first tie there as the draw stands — later than the day the event `opens` for a seat
   * in a later phase — or, open to enter, the day it opens; `stage` is the old 2026 world's next stage
   */
  | { kind: 'event'; day: number; opens: number; name: string; sure: boolean; stage?: boolean; out?: string }
  /** nothing known; `out` is the event under way that my club is out of */
  | { kind: 'none'; out?: string }

export type Ahead = Extract<NextUp, { kind: 'round' } | { kind: 'waiting' }>

/** How far ahead the next event is named: each event in between has its whole field drawn to see (circuit.ts drawStanding). */
export const EVENT_DAYS = 120

const holds = (c: Competition, club: string): boolean =>
  c.teams.includes(club) || !!c.circuit?.seeds.includes(club) || Object.values(c.circuit?.fill ?? {}).includes(club)

/**
 * My club's rounds with no tie written yet, earliest first. In a real event
 * under way they are read off its graph (circuit.ts roundAheadOf); in the old
 * 2026 world's brackets and internationals, the way its schedule page reads
 * them (qualify.ts nextInEvent, upcomingInternational).
 */
export function roundsAhead(state: GameState): Ahead[] {
  const club = state.myTeam
  const out: Ahead[] = []
  if (!club || !state.teams[club]) return out
  for (const comp of Object.values(state.comps)) {
    const c = comp.circuit
    if (!c || c.mode !== 'sim' || comp.champion || c.done || !holds(comp, club)) continue
    const r = roundAheadOf(state, comp, club)
    if (!r) continue
    out.push(r.waiting
      ? { kind: 'waiting', day: r.day, name: comp.name, round: r.round, comp }
      : { kind: 'round', day: r.day, name: comp.name, round: r.round, bo: r.bo, opponent: r.opponent, wait: r.wait, comp })
  }
  const inEv = nextInEvent(state)
  if (inEv) out.push({ kind: 'round', day: inEv.day, name: inEv.comp.name, round: inEv.round, opponent: null, wait: 'match', comp: inEv.comp })
  // the schedule page draws this one outside the open era only (ui/me/Schedule.tsx)
  const up = formatOf(state.year) === 'open' ? null : upcomingInternational(state)
  if (up) out.push({ kind: 'round', day: up.day, name: up.name, round: up.swiss ? '瑞士轮 第1轮' : '季后赛', opponent: null, wait: 'draw' })
  return out.sort((a, b) => a.day - b.day)
}

type Outlook = { standing: DrawStanding; day?: number; via?: 'fill' | 'route' } | null
/** My club's standing with each event, read once a day: each read draws the event's whole field. */
const STANDING = new WeakMap<GameState, { at: string; of: Map<string, Outlook> }>()

/** My club's standing with an event not drawn yet, off the day's book (STANDING). */
function outlookOf(state: GameState, club: string, c: Competition): Outlook {
  const at = `${state.year}:${state.day}:${club}`
  let book = STANDING.get(state)
  if (book?.at !== at) {
    book = { at, of: new Map() }
    STANDING.set(state, book)
  }
  let o = book.of.get(c.key)
  if (o === undefined) {
    o = drawOutlook(state, c, club)
    book.of.set(c.key, o)
  }
  return o
}

/** An event not drawn yet that seats my club as its draw stands (`sure`), or is open for it to enter, and the day my club would first play there. */
interface Soon { comp: Competition; sure: boolean; day: number }

/**
 * The events not drawn yet whose first tie comes by `until`, read earliest
 * first: of those whose draw as things stand seats my club, or that are open
 * for it to enter, the one it would play first (`first`) — by its seat's first
 * tie there, or by the day its decider is surely played — and the first the
 * club has any standing with, history's booking or a place its results may
 * still earn included (`any`).
 *
 * Read by the day each event opens, the first one seating the club was named,
 * whenever its seat played: 2026's Challengers EMEA Last Chance Qualifier opens
 * on June 4 with a play-in, and was named for a month over the club's Stage 3
 * group of June 22, the club's own seat in its groups playing on July 7
 * (scripts/check_nextup.ts, seed 11).
 */
function eventsAhead(state: GameState, club: string, until: number): { first?: Soon; any?: Competition } {
  // an event's first tie can come on the eve of its first day: a qualifier's decider is written and played with the draw (circuit.ts begin)
  const future = Object.values(state.comps)
    .filter((c) => !!c.circuit && !c.circuit.mode && !c.champion && !c.circuit.done && c.circuit.start > state.day && c.circuit.start - 1 <= until)
    .sort((a, b) => a.circuit!.start - b.circuit!.start || a.key.localeCompare(b.key))
  const out: { first?: Soon; any?: Competition } = {}
  for (const c of future) {
    // an event opening later has nothing of the club's sooner: not even a decider comes before its eve
    if (out.first && c.circuit!.start - 1 >= out.first.day) break
    const o = outlookOf(state, club, c)
    if (o && !out.any) out.any = c
    if (o?.standing !== 'seated' && o?.standing !== 'entry') continue
    const sure = o.standing === 'seated'
    const day = sure ? Math.max(o.day ?? c.circuit!.start, state.day + 1) : deciderBy(c)
    if (!out.first || day < out.first.day) out.first = { comp: c, sure, day }
  }
  return out
}

/** The panel's line for an event not drawn yet: my club's first tie there, or, open to enter, the day it opens. */
const eventUp = (s: Soon): Extract<NextUp, { kind: 'event' }> =>
  ({ kind: 'event', day: s.sure ? s.day : s.comp.circuit!.start, opens: s.comp.circuit!.start, name: s.comp.name, sure: s.sure })

/** The event under way that my club is out of: a match of mine played in it, no tie and no round of mine left there. */
function outOf(state: GameState, club: string, ahead: Ahead[]): string | undefined {
  const busy = new Set(ahead.map((a) => a.comp?.key))
  for (const f of state.fixtures) if (!f.played && (f.teamA === club || f.teamB === club)) busy.add(f.comp)
  let best: { name: string; day: number } | undefined
  for (const f of state.fixtures) {
    if (!f.played || busy.has(f.comp) || (f.teamA !== club && f.teamB !== club)) continue
    const c = state.comps[f.comp]
    if (!c || c.champion || c.circuit?.done || (!c.circuit && !c.finished.includes(club))) continue
    if (!best || f.day > best.day) best = { name: c.name, day: f.day }
  }
  return best?.name
}

/**
 * What the week's 「下一场」 names: the earliest of my club's written tie, its
 * rounds with no tie yet, and, in an event not drawn yet, its first tie as the
 * draw stands or its decider in one open for it to enter; with none of those
 * known, the event it is out of as well. A booking of history's, or a place
 * results may still earn, is not named: those were the wrong event more often
 * than not. `none` only when nothing is known.
 */
export function nextUp(state: GameState): NextUp {
  const club = state.myTeam
  if (state.me?.phase !== 'pro' || !club || !state.teams[club]) return { kind: 'none' }
  const fixture = nextRealFixtureFor(state, club)
  const ahead = roundsAhead(state)
  const tie: NextUp | undefined = fixture && (!ahead.length || fixture.day <= ahead[0].day) ? { kind: 'fixture', day: fixture.day, fixture } : ahead[0]
  if (tie) {
    // An event not drawn yet where my club plays sooner: its seat's first tie as the draw stands, or a decider surely
    // played before (circuit.ts offerPlayIn, planPlayIn). Seen 2026-09-14 (scripts/check_nextup.ts, seed 11): a
    // Challengers club seated into both EMEA's Stage 3 and its Last Chance Qualifier had the qualifier's group round,
    // and then its tie, named for eighteen days while its Stage 3 group, not drawn yet, came fifteen days sooner; and
    // a club booked into two leagues' third stages at once, the round of one while the other's decider came four days
    // sooner. A seat's first tie is read, not the day its event opens: a seat in a later phase plays after the round.
    const soon = onTimeline(state) ? eventsAhead(state, club, tie.day - 1).first : undefined
    return soon && soon.day < tie.day ? eventUp(soon) : tie
  }
  const out = outOf(state, club, ahead)
  if (!onTimeline(state)) {
    // the old 2026 world has no real events on its books: its next stage, from the calendar
    const s = stagesOf(state.year, false).find((x) => x.start > state.day && x.key !== 'offseason')
    return s ? { kind: 'event', day: s.start, opens: s.start, name: s.name, sure: false, stage: true, out } : { kind: 'none', out }
  }
  const first = eventsAhead(state, club, state.day + EVENT_DAYS).first
  return first ? { ...eventUp(first), out } : { kind: 'none', out }
}

/** A call's reading of a club, once a day: each event's draw read once for every club asked (circuit.ts outlookAsMine). */
const PLAYS = new WeakMap<GameState, { at: string; readers: Map<string, ReturnType<typeof outlookAsMine>>; of: Map<string, number | null> }>()

/** What a club's next match can turn on within a day: the day, the draws made, the events over, the ties written and played. */
function worldAt(state: GameState): string {
  let drawn = 0
  let over = 0
  for (const c of Object.values(state.comps)) {
    if (c.circuit?.mode) drawn++
    if (c.champion || c.circuit?.done) over++
  }
  let played = 0
  for (const f of state.fixtures) if (f.played) played++
  return `${state.year}:${state.day}:${drawn}:${over}:${state.fixtures.length}:${played}`
}

/**
 * The first day a club I am not at would play by `until` if I were on it, or null: 「下一场」's own reading (nextUp) of
 * a club — a tie of its own already written, a round of its own with no tie yet in an event this world plays, or an
 * event not drawn yet whose draw as it stands seats it (its first tie there) or that is open for it to enter (the
 * day its decider is surely played, deciderBy). An event this world replays as history takes nobody new, and a
 * place results may still earn is no match yet. For a call's draw (me/prepro.ts inviteWeight). A read: nothing is
 * kept on the club or the save.
 */
export function firstPlayBy(state: GameState, team: Team, until: number): number | null {
  const at = `${worldAt(state)}:${until}`
  let memo = PLAYS.get(state)
  if (memo?.at !== at) {
    memo = { at, readers: new Map(), of: new Map() }
    PLAYS.set(state, memo)
  }
  const hit = memo.of.get(team.id)
  if (hit !== undefined) return hit
  let best: number | null = null
  const keep = (day: number): void => { if (day <= until && (best == null || day < best)) best = day }
  const tie = nextRealFixtureFor(state, team.id)
  if (tie) keep(tie.day)
  for (const comp of Object.values(state.comps)) {
    const c = comp.circuit
    if (!c || comp.champion || c.done) continue
    if (c.mode) {
      // under way here: a round of its own with no tie yet (roundsAhead); one replayed as history has nothing for me
      if (c.mode === 'sim' && holds(comp, team.id)) {
        const r = roundAheadOf(state, comp, team.id)
        if (r) keep(r.day)
      }
      continue
    }
    // not drawn yet: its first tie can come on its eve (eventsAhead)
    if (c.start <= state.day || c.start - 1 > until || (best != null && c.start - 1 >= best)) continue
    let read = memo.readers.get(comp.key)
    if (read === undefined) {
      read = outlookAsMine(state, comp)
      memo.readers.set(comp.key, read)
    }
    const o = read?.(team)
    if (o) keep(o.standing === 'seated' ? Math.max(o.day ?? c.start, state.day + 1) : deciderBy(comp))
  }
  memo.of.set(team.id, best)
  return best
}

/**
 * Anything of my club's by `until` that no written tie shows: a round with no
 * tie yet, a phase of mine still being played, an event opening that holds the
 * club's place, is open to it, or may still take it. An event counts by the
 * day it opens, even where nextUp reads the club's first tie there later: its
 * draw is made on its eve. For me/auto.ts quietAhead, which would rather keep a
 * month's run off the menu than offer it with a match inside the month.
 */
export function mineBy(state: GameState, until: number): boolean {
  const club = state.myTeam
  if (state.me?.phase !== 'pro' || !club || !state.teams[club]) return false
  if (roundsAhead(state).some((r) => r.day <= until)) return true
  return !!eventsAhead(state, club, until).any
}

/* ------------------------------------------------------------------ */
/*  past what 「下一场」 names                                           */
/* ------------------------------------------------------------------ */

/**
 * What lies ahead of my club when nothing is named within EVENT_DAYS (nextUp's `none`): the rest of the season read
 * the way nextUp reads its first four months, and past it the next season's calendar.
 *
 *  - next: this season's first event whose draw as it stands seats the club (`sure`), or that is open for it to
 *    enter — the day of its first tie there, or the day it opens
 *  - booked: before it, an event history lists the club in with nothing for it to play — its open qualifier, which
 *    this world replays as it went (circuit.ts drawOutlook `booked`)
 *  - maybe: before it, a place the club may still get: one the draw fills for a side it is missing (`fill`,
 *    circuit.ts fillGaps), or one results elsewhere may earn (`route`)
 *  - later: with nothing this season, next season's first event for the club (circuit.ts nextSeasonFor): its seat by
 *    history's booking or its league (`seat`), or a way in for a club not in the draw (`open`) — nothing drawn yet
 *
 * Reported 2026-09-18 (the hx-wait probe): on the day a ladder player joined his club, the week's 「下一场」 said
 * nothing at all in 58 of 82 long 2021 waits and 43 of 74 long 2026 waits — history's open-qualifier list, an event
 * more than four months off (2026's November open qualifiers for 2027's Kickoff), or a season whose doors had shut.
 */
export interface Road {
  next?: { name: string; day: number; sure: boolean }
  booked?: { name: string; day: number }
  maybe?: { name: string; day: number; via: 'fill' | 'route' }
  later?: { name: string; year: number; day: number; seat: boolean }
}

export function roadAhead(state: GameState): Road {
  const club = state.myTeam
  const out: Road = {}
  if (state.me?.phase !== 'pro' || !club || !state.teams[club] || !onTimeline(state)) return out
  const first = eventsAhead(state, club, state.day + 400).first
  if (first) out.next = { name: first.comp.name, day: first.sure ? first.day : first.comp.circuit!.start, sure: first.sure }
  const until = first ? first.comp.circuit!.start : Infinity
  const future = Object.values(state.comps)
    .filter((c) => !!c.circuit && !c.circuit.mode && !c.champion && !c.circuit.done && c.circuit.start > state.day && c.circuit.start < until)
    .sort((a, b) => a.circuit!.start - b.circuit!.start || a.key.localeCompare(b.key))
  for (const c of future) {
    const o = outlookOf(state, club, c)
    if (o?.standing === 'booked') out.booked ??= { name: c.name, day: c.circuit!.start }
    else if (o?.standing === 'maybe') out.maybe ??= { name: c.name, day: c.circuit!.start, via: o.via ?? 'route' }
  }
  if (!first) {
    const n = nextSeasonFor(state, state.teams[club])
    if (n) out.later = { name: n.ev.cn || n.ev.name, year: state.year + 1, day: n.day, seat: n.door === 'seat' }
  }
  return out
}

const monthOf = (year: number, day: number): number => new Date(Date.UTC(year, 0, 1 + day)).getUTCMonth() + 1

/** How far off a day is, in the panel's words: 「3 天后」「约 5 周后」「约 4 个月后」. */
function farCn(from: number, day: number): string {
  const d = day - from
  return d < 14 ? `${Math.max(1, d)} 天后` : d < 70 ? `约 ${Math.round(d / 7)} 周后` : `约 ${Math.round(d / 30)} 个月后`
}

/**
 * The week's 「下一场」 with nothing named: why, in words, and what comes next (roadAhead). Never empty for a signed
 * player — a season with nothing left says so, and what the next one holds.
 */
export function roadLines(state: GameState, road = roadAhead(state)): string[] {
  const out: string[] = []
  const y = state.year
  const booked = road.booked ? `${road.booked.name}：你们只在真实历史的海选名单上，这里的海选照真实结果走，没有你们的比赛。` : ''
  // said in the order they come: history's list, or a place that may still come, whichever is first
  const bookedFirst = !!road.booked && (!road.maybe || road.booked.day <= road.maybe.day)
  if (bookedFirst) out.push(booked)
  const maybe = road.maybe
    ? `${road.maybe.name}（${monthOf(y, road.maybe.day)} 月），${road.maybe.via === 'fill' ? '要看有没有空出来的名额轮到你们' : '要看之前比赛的名次和积分'}，抽签前说不准。`
    : ''
  if (road.next) {
    out.push(`四个月内没有你们的比赛。下一站：${road.next.name}，${monthOf(y, road.next.day)} 月${road.next.sure ? '，已经有你们的位置' : '，可以报名'}（${farCn(state.day, road.next.day)}）。`)
    if (maybe) out.push(`在那之前，${maybe}`)
    if (booked && !bookedFirst) out.push(booked)
    return out
  }
  if (maybe) out.push(`下一站：${maybe}`)
  if (booked && !bookedFirst) out.push(booked)
  const left = maybe ? '除此以外，今年' : '今年'
  if (road.later) {
    out.push(`${left}已经没有你们能打的赛事。下一站要等 ${road.later.year} 赛季：${road.later.name}（约 ${monthOf(road.later.year, road.later.day)} 月）${road.later.seat ? '，真实历史里有你们的位置' : '，可以去争公开的名额'}，到时候抽签才定。`)
  } else {
    out.push(`${left}已经没有你们能打的赛事，${y + 1} 赛季的赛程里也还看不到。`)
  }
  return out
}

/**
 * A club's next match or event in one line, as 「下一场」 would read it if I were on it — for a club asking me to a
 * tryout or offering terms (ui/me/Modals.tsx), and the day I join (ui/me/MomentQueue.tsx). 「这家俱乐部下一场：
 * 3 月 · 挑战者联赛 · 北美 · 第二赛段（可以报名）」, 「这家俱乐部今年已经没有能打的赛事，下一站是 2022 赛季的 …」.
 *
 * Read as the club's player would read it, because the world moves for the player's club: a decider in an event
 * open to it is offered to his club only (circuit.ts offerPlayIn). The club is his for the read and given back.
 */
const CLUB_LINE = new WeakMap<GameState, { at: string; of: Map<string, string> }>()
export function clubNextLine(state: GameState, teamId: string, who: 'club' | 'we' = 'club'): string {
  const me = state.me
  if (!me || !state.teams[teamId]) return ''
  const at = `${state.year}:${state.day}:${me.phase}:${state.myTeam}:${who}`
  let book = CLUB_LINE.get(state)
  if (book?.at !== at) {
    book = { at, of: new Map() }
    CLUB_LINE.set(state, book)
  }
  const hit = book.of.get(teamId)
  if (hit != null) return hit
  const phase = me.phase
  const mine = state.myTeam
  let line = ''
  try {
    me.phase = 'pro'
    state.myTeam = teamId
    line = clubLine(state, who === 'we' ? '你们' : '这家俱乐部', who === 'we' ? '你们' : '它')
  } finally {
    me.phase = phase
    state.myTeam = mine
  }
  book.of.set(teamId, line)
  return line
}

function clubLine(state: GameState, who: string, it: string): string {
  const y = state.year
  const up = nextUp(state)
  const when = (day: number) => `${monthOf(y, day)} 月`
  if (up.kind === 'fixture') return `${who}下一场：${when(up.day)} · ${state.comps[up.fixture.comp]?.name ?? up.fixture.comp}`
  if (up.kind === 'round' || up.kind === 'waiting') return `${who}下一场：${when(up.day)} · ${up.name}${up.kind === 'waiting' ? '（要看这一阶段的名次）' : ''}`
  if (up.kind === 'event') return `${who}下一场：${when(up.day)} · ${up.name}${up.stage || up.sure ? '' : '（可以报名）'}`
  const road = roadAhead(state)
  const booked = road.booked ? `（${road.booked.name} 里只有海选名单上的位置，没有${it}的比赛）` : ''
  if (road.next) return `${who}四个月内没有比赛${booked}，下一站：${when(road.next.day)} · ${road.next.name}${road.next.sure ? '' : '（可以报名）'}`
  // a place that may come this season, and failing it, next season's first
  const later = road.later ? `，下一站是 ${road.later.year} 赛季的 ${road.later.name}（约 ${monthOf(road.later.year, road.later.day)} 月）` : `，${y + 1} 赛季的赛程里也还看不到`
  if (road.maybe) return `${who}下一站要看 ${road.maybe.name}（${when(road.maybe.day)}）${road.maybe.via === 'fill' ? `空出来的名额能不能轮到${it}` : '之前比赛的名次和积分'}${booked}；不然今年已经没有能打的赛事${later}`
  return `${who}今年已经没有能打的赛事${booked}${later}`
}
