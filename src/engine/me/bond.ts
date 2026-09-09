import { clamp } from '../rng'
import { ATTR_KEYS } from '../types'
import type { GameState, Player } from '../types'
import { bondBetween } from '../bonds'
import { pushLog } from './log'
import type { BondEntry, BondRole } from './types'

/**
 * The ledger of who you played with.
 *
 * Ported from 破晓's bond.ts. The arc it is about already runs in the numbers:
 * young teammates improve every season, old ones decline, and the box score
 * measures the gap between you and the four around you every single match.
 * What was missing was not a mechanic — it was memory. The moment a teammate
 * left the roster the game forgot he had ever been there, so the most it could
 * say at the end of a career was "your teammates". Not who.
 *
 * So this module changes no number at all. It only does three things:
 *
 *  - remembers   every person who shared a roster with you, how long, what you
 *                won together, and how they left. Entries are never deleted.
 *  - recognises  which of you was carrying, on two axes — older or younger,
 *                stronger or weaker — which is exactly the four stages of a
 *                career: 被带 → 并肩 → 扛旗 / 带人 → 被带飞.
 *  - tells       the lines that go on the team screen and the career card.
 *
 * Strength uses the average of the eight attributes, not match rating: rating
 * carries your own in-match decisions with it, so it says you were better than
 * your teammates most of the time and the axis stops separating anybody.
 */

/** how far apart two averages must be before either is "the stronger one" */
export const BOND_OVR = 2.0
/** a stage with fewer than this many matches does not get to define a role */
export const BOND_MIN_MATCHES = 3
/** ledger cap; only people who left and barely played are ever dropped */
export const BOND_MAX = 80

export const BOND_ROLE_TEXT: Record<BondRole, string> = {
  carried: '被带',
  anchor: '扛旗',
  passed: '被带飞',
  mentor: '带人',
  equal: '并肩',
}

function book(state: GameState): Record<string, BondEntry> {
  const me = state.me!
  if (!me.mates) me.mates = {}
  return me.mates
}

/** the key for the stage in progress — one role verdict per stage */
const stageKey = (state: GameState): string => `${state.year}-${state.stage}`

const avgAttrs = (p: Player): number =>
  ATTR_KEYS.reduce((s, k) => s + p.attrs[k], 0) / ATTR_KEYS.length

export function bondOf(state: GameState, id: string): BondEntry | null {
  return book(state)[id] ?? null
}

/** Register or refresh one teammate. Only people seen on the roster get one. */
function see(state: GameState, p: Player): BondEntry {
  const b = book(state)
  let e = b[p.id]
  if (!e) {
    e = b[p.id] = {
      id: p.id, ign: p.ign, role: p.role,
      firstYear: state.year, lastYear: state.year,
      team: state.teams[state.myTeam]?.name ?? '', stages: 0, matches: 0,
      titles: [], peakBond: 0, roles: {},
    }
    trim(state)
  }
  e.lastYear = state.year
  // back on the roster: he is not gone any more
  delete e.gone
  delete e.goneYear
  const bd = bondBetween(state, state.me!.id, p.id)
  if (bd > (e.peakBond ?? 0)) e.peakBond = Math.round(bd)
  return e
}

/** Keep the save from growing without bound — but never forget anyone who mattered. */
function trim(state: GameState): void {
  const b = book(state)
  const ids = Object.keys(b)
  if (ids.length <= BOND_MAX) return
  const droppable = ids
    .filter((k) => b[k].gone && (b[k].stages ?? 0) < 2)
    .sort((x, y) => (b[x].stages ?? 0) - (b[y].stages ?? 0))
  let need = ids.length - BOND_MAX
  for (const k of droppable) {
    if (need-- <= 0) break
    delete b[k]
  }
}

/**
 * Called each week with the current roster: everyone on it is registered,
 * everyone missing is marked as gone — marked, not deleted.
 */
export function bondSync(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  const team = state.teams[state.myTeam]
  if (!team) return
  const here = new Set<string>()
  for (const id of team.roster) {
    if (id === me.id) continue
    const p = state.players[id]
    if (!p) continue
    here.add(id)
    see(state, p)
  }
  const b = book(state)
  for (const k of Object.keys(b)) {
    if (!here.has(k) && !b[k].gone) {
      b[k].gone = 'left'
      b[k].goneYear = state.year
    }
  }
}

/** A teammate retired rather than moved on — worth telling apart. */
export function bondRetired(state: GameState, id: string): void {
  const e = bondOf(state, id)
  if (!e) return
  e.gone = 'retired'
  e.goneYear = state.year
}

/** Count the matches shared, so a stage of two games cannot define a role. */
export function bondNoteMatch(state: GameState, mateIds: string[]): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  const b = book(state)
  for (const id of mateIds) {
    if (id === me.id) continue
    const e = b[id]
    if (e) e.matches = (e.matches ?? 0) + 1
  }
  me.bondStageMatches = (me.bondStageMatches ?? 0) + 1
}

/** Which of the two of us was carrying, right now. */
export function bondRoleVs(state: GameState, p: Player): BondRole {
  const me = state.me!
  const mine = state.players[me.id]
  const younger = p.age < mine.age
  const d = avgAttrs(p) - avgAttrs(mine)
  if (Math.abs(d) < BOND_OVR) return 'equal'
  const stronger = d > 0
  if (stronger) return younger ? 'passed' : 'carried'
  return younger ? 'mentor' : 'anchor'
}

/**
 * Freeze this stage's verdict for everyone still on the roster. Called when a
 * stage ends, so a role is a season's worth of evidence rather than one night.
 */
export function bondCloseStage(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  if ((me.bondStageMatches ?? 0) < BOND_MIN_MATCHES) { me.bondStageMatches = 0; return }
  const key = stageKey(state)
  const team = state.teams[state.myTeam]
  const b = book(state)
  for (const id of team?.roster ?? []) {
    const p = state.players[id]
    const e = b[id]
    if (!p || !e || id === me.id) continue
    e.roles[key] = bondRoleVs(state, p)
    e.stages = (e.stages ?? 0) + 1
  }
  me.bondStageMatches = 0
}

/** A trophy is shared by whoever was in the room. */
export function bondNoteTitle(state: GameState, title: string): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  const team = state.teams[state.myTeam]
  const b = book(state)
  for (const id of team?.roster ?? []) {
    if (id === me.id) continue
    const e = b[id]
    if (e && !e.titles.includes(title)) e.titles.push(title)
  }
}

export function bondRoleCount(e: BondEntry, role: BondRole): number {
  return Object.values(e.roles).filter((r) => r === role).length
}

/** What I mostly was, next to this person. */
export function bondMainRole(e: BondEntry): BondRole | null {
  const tally: Partial<Record<BondRole, number>> = {}
  for (const r of Object.values(e.roles)) tally[r] = (tally[r] ?? 0) + 1
  let best: BondRole | null = null
  let n = 0
  for (const [r, c] of Object.entries(tally) as [BondRole, number][]) {
    if (c > n) { n = c; best = r }
  }
  return best
}

/** Everyone I have shared a roster with, longest first. */
export function bondAll(state: GameState): BondEntry[] {
  return Object.values(book(state)).sort(
    (a, b2) => (b2.stages ?? 0) - (a.stages ?? 0) || (b2.matches ?? 0) - (a.matches ?? 0),
  )
}

/** The one I played beside longest. */
export function bondLongest(state: GameState): BondEntry | null {
  return bondAll(state)[0] ?? null
}

/**
 * The person I brought up: someone I was 带人 to for at least two stages, who
 * by now has passed me. This is the line the whole module exists for.
 */
export function bondProtege(state: GameState): BondEntry | null {
  const me = state.me!
  const mine = state.players[me.id]
  let best: BondEntry | null = null
  let gap = 0
  for (const e of bondAll(state)) {
    if (bondRoleCount(e, 'mentor') < 2) continue
    const p = state.players[e.id]
    if (!p) continue
    const d = avgAttrs(p) - avgAttrs(mine)
    if (d > gap) { gap = d; best = e }
  }
  return best
}

/**
 * Two or three lines for the career card. Written from the ledger, so every
 * one of them names somebody.
 */
export function bondCardLines(state: GameState): string[] {
  const out: string[] = []
  const longest = bondLongest(state)
  if (longest && (longest.stages ?? 0) >= 2) {
    const years = Math.max(1, longest.lastYear - longest.firstYear + 1)
    out.push(`和 ${longest.ign} 同队 ${years} 年${longest.titles.length ? `，一起拿过 ${longest.titles.length} 个冠军` : ''}。`)
  }
  const protege = bondProtege(state)
  if (protege) {
    out.push(`你带过 ${protege.ign}。现在他比你强了。`)
  }
  const carried = bondAll(state).find((e) => bondRoleCount(e, 'carried') >= 2 && e.gone)
  if (carried) {
    out.push(carried.gone === 'retired'
      ? `刚来的时候是 ${carried.ign} 带你。他已经退役了。`
      : `刚来的时候是 ${carried.ign} 带你。后来他走了。`)
  }
  return out
}

/** A line for a teammate leaving, so a departure is not just a roster diff. */
export function bondFarewell(state: GameState, id: string): string | null {
  const e = bondOf(state, id)
  if (!e || (e.stages ?? 0) < 1) return null
  const role = bondMainRole(e)
  const years = Math.max(1, e.lastYear - e.firstYear + 1)
  if (role === 'carried') return `${e.ign} 走了。刚进队那阵子是他带的你。`
  if (role === 'mentor') return `${e.ign} 走了。你带了他 ${years} 年。`
  if (role === 'passed') return `${e.ign} 走了。最后这段时间，是他在带你。`
  if (role === 'anchor') return `${e.ign} 走了。这几年是你在扛，他在旁边。`
  return `${e.ign} 走了。你们并肩打了 ${years} 年。`
}

/** Log the goodbyes for anyone who left this week. */
export function bondReportDepartures(state: GameState, before: string[]): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  const now = new Set(state.teams[state.myTeam]?.roster ?? [])
  for (const id of before) {
    if (id === me.id || now.has(id)) continue
    const line = bondFarewell(state, id)
    if (line) pushLog(state, 'team', line)
  }
}

/** How close we got, 0–100, for the team screen. */
export function bondCloseness(state: GameState, id: string): number {
  return clamp(Math.round(bondBetween(state, state.me!.id, id)), 0, 100)
}
