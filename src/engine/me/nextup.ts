import { drawOutlook, eventOf, outlookAsMine, roundAheadOf } from '../circuit'
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

/** My club's standing with each event, read once a day: each read draws the event's whole field. */
const STANDING = new WeakMap<GameState, { at: string; of: Map<string, { standing: DrawStanding; day?: number } | null> }>()

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
  const at = `${state.year}:${state.day}:${club}`
  let book = STANDING.get(state)
  if (book?.at !== at) {
    book = { at, of: new Map() }
    STANDING.set(state, book)
  }
  const known = book.of
  // an event's first tie can come on the eve of its first day: a qualifier's decider is written and played with the draw (circuit.ts begin)
  const future = Object.values(state.comps)
    .filter((c) => !!c.circuit && !c.circuit.mode && !c.champion && !c.circuit.done && c.circuit.start > state.day && c.circuit.start - 1 <= until)
    .sort((a, b) => a.circuit!.start - b.circuit!.start || a.key.localeCompare(b.key))
  const out: { first?: Soon; any?: Competition } = {}
  for (const c of future) {
    // an event opening later has nothing of the club's sooner: not even a decider comes before its eve
    if (out.first && c.circuit!.start - 1 >= out.first.day) break
    let o = known.get(c.key)
    if (o === undefined) {
      o = drawOutlook(state, c, club)
      known.set(c.key, o)
    }
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
