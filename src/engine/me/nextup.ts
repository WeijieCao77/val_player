import { drawStanding, roundAheadOf } from '../circuit'
import type { DrawStanding, RoundAhead } from '../circuit'
import { formatOf, onTimeline, stagesOf } from '../era'
import { nextInEvent, upcomingInternational } from '../qualify'
import { nextRealFixtureFor } from '../season'
import type { Competition, Fixture, GameState } from '../types'

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
  /** nothing under way for me: the next event, its draw as things stand seating my club (`sure`) or open for it to enter; `stage` is the old 2026 world's next stage */
  | { kind: 'event'; day: number; name: string; sure: boolean; stage?: boolean; out?: string }
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
const STANDING = new WeakMap<GameState, { at: string; of: Map<string, DrawStanding | null> }>()

/**
 * The events not drawn yet whose first tie comes by `until`, read earliest
 * first until one seats my club: that one (`sure`), the first before it open
 * for the club to enter (`entry`), and the first the club has any standing
 * with — history's booking, or a place its results may still earn (`any`).
 */
function eventsAhead(state: GameState, club: string, until: number): { sure?: Competition; entry?: Competition; any?: Competition } {
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
  const out: { sure?: Competition; entry?: Competition; any?: Competition } = {}
  for (const c of future) {
    let standing = known.get(c.key)
    if (standing === undefined) {
      standing = drawStanding(state, c, club)
      known.set(c.key, standing)
    }
    if (standing && !out.any) out.any = c
    if (standing === 'entry' && !out.entry) out.entry = c
    if (standing === 'seated') { out.sure = c; break }
  }
  return out
}

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
 * What the week's 「下一场」 names: the earliest of my club's written tie and its
 * rounds with no tie yet; with neither, the event it is out of and the next
 * event whose draw as things stand seats it, or, before that, one open for it
 * to enter. A booking of history's, or a place results may still earn, is not
 * named: those were the wrong event more often than not. `none` only when
 * nothing is known.
 */
export function nextUp(state: GameState): NextUp {
  const club = state.myTeam
  if (state.me?.phase !== 'pro' || !club || !state.teams[club]) return { kind: 'none' }
  const fixture = nextRealFixtureFor(state, club)
  const ahead = roundsAhead(state)
  if (fixture && (!ahead.length || fixture.day <= ahead[0].day)) return { kind: 'fixture', day: fixture.day, fixture }
  if (ahead.length) return ahead[0]
  const out = outOf(state, club, ahead)
  if (!onTimeline(state)) {
    // the old 2026 world has no real events on its books: its next stage, from the calendar
    const s = stagesOf(state.year, false).find((x) => x.start > state.day && x.key !== 'offseason')
    return s ? { kind: 'event', day: s.start, name: s.name, sure: false, stage: true, out } : { kind: 'none', out }
  }
  const ev = eventsAhead(state, club, state.day + EVENT_DAYS)
  const pick = ev.entry ?? ev.sure
  return pick ? { kind: 'event', day: pick.circuit!.start, name: pick.name, sure: pick === ev.sure, out } : { kind: 'none', out }
}

/**
 * Anything of my club's by `until` that no written tie shows: a round with no
 * tie yet, a phase of mine still being played, an event opening that holds the
 * club's place, is open to it, or may still take it. For me/auto.ts quietAhead,
 * which would rather keep a month's run off the menu than offer it with a
 * match inside the month.
 */
export function mineBy(state: GameState, until: number): boolean {
  const club = state.myTeam
  if (state.me?.phase !== 'pro' || !club || !state.teams[club]) return false
  if (roundsAhead(state).some((r) => r.day <= until)) return true
  return !!eventsAhead(state, club, until).any
}
