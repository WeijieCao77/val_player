import bridgeRaw from '../data/bridge_2026.json'
import { canonAgents } from './content'
import { regionIn } from './era'
import { refreshValue } from './player'
import { freeAgentPool } from './prospects'
import { Rng, hashStr } from './rng'
import { WORLD_TEAMS } from './teams'
import { lastYearOf, reachOf, releaseForHistory, signForHistory } from './timeline'
import type { GameState, Player, Region, Role } from './types'
import { WORLD_PLAYERS, autoStarters, ensureCaller, playerFromRaw, teamFromRaw } from './world'
import type { RawPlayer } from './world'

/**
 * 2026: a career that entered in 2021 arrives in the world the game ships.
 *
 * The timeline (engine/timeline.ts) carries a world to the end of 2025 by
 * vlr.gg ids. The season after that is the one the 2026 entrance plays — the
 * same clubs, the same people, but kept as P0…P523 and T0…T77 by the builder
 * that made them, with their coaches, photographs, logos and prospects keyed
 * that way. scripts/build_bridge_2026.py wrote who is who.
 *
 * So at the turn into 2026 the world is re-keyed onto today's ids, every id in
 * the save at once, and then brought to 2026 as it really opened — out of the
 * player's reach, as everywhere else in the timeline:
 *
 *  - every club of today takes its 2026 name, league, tier, coach and roster;
 *    one the timeline never held is founded
 *  - every person of today takes the ratings today's world gives him
 *  - a club today's world does not hold goes quiet, and anyone who never played
 *    again leaves the scene
 *  - the player's club, the people on it and the player are his, as ever
 *
 * From there the modern season runs as it does for a career that began in 2026.
 */

interface Bridge { players: Record<string, string>; teams: Record<string, string | null> }
const BRIDGE = bridgeRaw as unknown as Bridge

/** Every value and key in the save that is one of these ids, as the other. */
function rekey(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v
  if (Array.isArray(v)) return v.map((x) => rekey(x, map))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[map.get(k) ?? k] = rekey(x, map)
    return out
  }
  return v
}

/** Today's record of someone history kept out of the player's reach. */
function takeToday(p: Player, rp: RawPlayer): void {
  p.ign = rp.ign
  p.attrs = { ...rp.attrs }
  p.overall = rp.overall
  p.potential = Math.max(rp.potential, rp.overall)
  p.role = rp.role as Role
  p.roles = (rp.roles as Role[] | undefined) ?? [p.role]
  p.flex = rp.flex ?? p.roles.length > 1
  if (rp.traits) p.traits = rp.traits.map((t) => ({ ...t }))
  if (rp.agentPool?.length) p.agentPool = canonAgents(rp.agentPool)
  p.isIgl = rp.isIgl
  p.iglSource = rp.iglSource
  p.nat = rp.nat || p.nat
  p.realName = rp.realName ?? p.realName
  p.birth = rp.birth ?? p.birth
  p.ageEstimated = rp.ageEstimated
  p.age = rp.age
  p.rounds = Math.max(p.rounds ?? 0, rp.rounds ?? 0)
  if (rp.vlr) p.vlr = { ...rp.vlr }
  p.region = rp.region as Region
  refreshValue(p)
}

export interface Bridged { founded: string[]; quiet: number; retire: string[] }

export function bridgeTo2026(state: GameState, notes: string[]): Bridged {
  const out: Bridged = { founded: [], quiet: 0, retire: [] }
  const before = reachOf(state)

  // ---- 1. today's ids
  const map = new Map<string, string>()
  for (const [T, vlr] of Object.entries(BRIDGE.teams)) {
    if (!vlr) continue
    const old = `V21T${vlr}`
    // the club the player's club carried on as is the player's club (engine/timeline.ts inherit)
    const id = state.heirs?.[old] ?? old
    if (state.teams[id] && ![...map.values()].includes(T) && !map.has(id)) map.set(id, T)
  }
  for (const [P, vlr] of Object.entries(BRIDGE.players)) {
    const old = `V${vlr}`
    if (state.players[old]) map.set(old, P)
  }
  const next = rekey(state, map) as GameState
  for (const k of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[k]
  Object.assign(state, next)

  const mine = before.club ? map.get(before.club) ?? before.club : null
  const people = new Set([...before.people].map((id) => map.get(id) ?? id))
  const rng = new Rng(hashStr(`bridge:${state.seed}`))
  const today = new Set(WORLD_TEAMS.map((t) => t.id))

  // ---- 2. the people of today
  for (const rp of WORLD_PLAYERS as RawPlayer[]) {
    const p = state.players[rp.id]
    if (!p) state.players[rp.id] = { ...playerFromRaw({ ...rp, teamId: null }, 2026, state.seed), contractYears: 0 }
    else if (!people.has(rp.id)) takeToday(p, rp)
  }

  // ---- 3. the clubs of today, and the rosters they opened 2026 with
  for (const rt of WORLD_TEAMS) {
    let t = state.teams[rt.id]
    if (!t) {
      t = teamFromRaw({ ...rt, roster: [] }, state.seed)
      state.teams[rt.id] = t
      out.founded.push(rt.name)
    }
    t.dormant = false
    t.scene = undefined
    // the club as it stands in 2026 — the player's too: today's name, league and tier are where it
    // plays. Only its people are left alone
    t.name = rt.name
    t.tag = rt.tag
    t.region = rt.region as Region
    t.tier = rt.tier as 1 | 2
    t.league = rt.league
    if (rt.id === mine) {
      if (!t.coach && rt.coach) t.coach = { ...rt.coach }
      continue
    }
    t.coach = rt.coach ? { ...rt.coach } : null
    t.reputation = rt.reputation
    const want = rt.roster.map((id) => state.players[id]).filter((p): p is Player => !!p && !people.has(p.id))
    const keep = new Set(want.map((p) => p.id))
    for (const pid of [...t.roster]) if (!keep.has(pid)) releaseForHistory(state, state.players[pid])
    for (const p of want) if (p.teamId !== t.id) signForHistory(state, p, t, 2026, rng)
  }

  // ---- 4. everyone else: a club today does not hold goes quiet; the player's does not
  for (const t of Object.values(state.teams)) {
    if (today.has(t.id) || t.dormant) continue
    if (t.id === mine) {
      t.region = regionIn(t.region, 2026)
      t.scene = undefined
      continue
    }
    for (const pid of [...t.roster]) releaseForHistory(state, state.players[pid])
    t.dormant = true
    out.quiet++
  }
  const seat = state.seat
  if (seat && mine && state.teams[mine]) {
    state.teams[mine].tier = 1
    state.teams[mine].league = `VCT ${seat.league}`
    const displaced = state.teams[seat.displaced]
    if (displaced && displaced.id !== mine) {
      displaced.tier = 2
      displaced.league = `Challengers ${displaced.region}`
    }
  }
  for (const p of Object.values(state.players)) {
    p.region = regionIn(p.region, 2026)
    if (people.has(p.id) || p.teamId) continue
    const last = lastYearOf(p)
    if (last != null && last < 2026) out.retire.push(p.id)
  }
  // today's free agents, as a career that began in 2026 has them
  for (const p of freeAgentPool(2026)) if (!state.players[p.id]) state.players[p.id] = p

  // this world's Champions 2025 is who sits out next year's first round
  const champs = Object.values(state.comps).find((c) => c.stage === 'champions' && c.format === 'circuit')
  if (champs?.teams.length) state.lastChampionsTeams = champs.teams.filter((id) => today.has(id))

  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    ensureCaller(state, t.id)
    if (t.id !== mine) t.starters = autoStarters(state, t.id)
    const top = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
    if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
  }
  state.bridged = 2026
  const line = `📜 2026：世界接上了现在——${WORLD_TEAMS.length} 家俱乐部按 2026 年真实的名单、教练和能力开季`
    + (out.founded.length ? `，新成立 ${out.founded.join('、')}` : '') + '。'
  notes.push(line)
  state.news.push({ day: state.day, kind: 'league', important: true, text: line })
  return out
}
