import type { Competition, GameState } from '../types'
import { eventOf, floorOf, gameOf, roundAheadOf } from '../circuit'
import type { CEvent } from '../circuit'
import { stagesOf } from '../era'

/** The four family-visit cards that share the international-tournament guard. */
export const FAMILY_VISIT_EVENTS = ['family_call', 'career_family_leave', 'echo_home', 'cn_newyear'] as const

/**
 * True while a family-visit card must not be drawn or resolved: my club is in an international
 * competition whose schedule owns the player's weeks. The narrative family beats wait until the
 * tournament is over, so the player is not offered to go home mid-event.
 *
 * Guard only in the pro phase and for the player's current team. Iterates every competition
 * independently (no early lockNow-style stopping). For circuit (sim/history) competitions, checks
 * draw mode, dates, floor presence, and (for sim) whether the club is still alive via unplayed
 * fixtures or a roundAheadOf preview. Legacy competitions use stage dates from `stagesOf`.
 */
export function familyVisitBlocked(state: GameState): boolean {
  if (state.me?.phase !== 'pro') return false
  const club = state.myTeam
  const team = state.teams[club]
  const player = state.players[state.me.id]
  if (!team || !player || player.teamId !== club || !team.roster.includes(state.me.id)) return false

  for (const [key, comp] of Object.entries(state.comps)) {
    if (comp.champion || comp.finished.includes(club)) continue
    if (!comp.teams.includes(club)) continue

    if (comp.circuit) {
      const c = comp.circuit
      const ev = eventOf(c.id)
      if (!ev || !c.mode) continue
      const stages = new Set([
        'masters1',
        'masters2',
        'champions',
        'kickoff',
        's1masters',
        's2finals',
        's3finals',
      ])
      if (ev.region !== null || !stages.has(ev.stage ?? '')) continue

      const now = state.day
      if (now < c.start || now > c.end) continue
      if (c.done) continue

      const entryDay = floorOf(state, comp).get(club)
      if (entryDay === undefined) continue
      if (now < entryDay) continue

      if (c.mode === 'sim') {
        const hasUnplayed = state.fixtures.some(
          (f) => f.comp === key && !f.played && (f.teamA === club || f.teamB === club)
        )
        if (hasUnplayed) return true
        const ahead = roundAheadOf(state, comp, club)
        if (ahead && (!ahead.waiting || !provenWinnerOnlyExit(state, comp, ev, club))) return true
      } else {
        // History mode: conservative; the draw is fixed and the club is on the floor.
        return true
      }
    } else {
      // Legacy competition (no circuit): only international stages with stage dates.
      if (comp.region) continue
      if (!['masters1', 'masters2', 'champions'].includes(comp.stage)) continue
      const stage = stagesOf(state.year, false).find((s) => s.key === comp.stage)
      if (!stage) continue
      if (state.day < stage.start || state.day > stage.end) continue
      return true
    }
  }
  return false
}

/** The preview's waiting rank is conservative. Prove only a winner-only forest exit;
 * uncertain formats, empty roots, double elimination and tables keep their protection. */
function provenWinnerOnlyExit(state: GameState, comp: Competition, ev: CEvent, club: string): boolean {
  const c = comp.circuit!
  const last = state.fixtures.filter(f => f.comp === comp.key && f.played &&
    (f.teamA === club || f.teamB === club) && gameOf(f))
    .sort((a, b) => b.day - a.day || (b.node ?? -1) - (a.node ?? -1))[0]
  if (!last || last.node == null || !Number.isInteger(last.node) || last.node < 0) return false
  const game = gameOf(last)!
  if (!game.w || game.w === club) return false
  const flat = ev.units.flatMap((u, ui) => (u.nodes ?? []).map(() => ui))
  const ui = flat[last.node]
  const unit = ev.units[ui]
  if (!unit || unit.type !== 'bracket' || unit.follow || unit.side || !unit.nodes?.length) return false
  const nodes = unit.nodes, used = new Set<number>(), direct = new Set<string>()
  const leaves: Set<string>[] = []
  for (let i = 0; i < nodes.length; i++) {
    const teams = new Set<string>()
    for (const slot of [nodes[i].a, nodes[i].b]) {
      if (slot[0] === 's') {
        const seed = c.seeds[slot[1]]
        if (seed && state.teams[seed]) {
          if (direct.has(seed)) return false
          direct.add(seed); teams.add(seed)
        }
      } else if (slot[0] === 'w') {
        const source = slot[1]
        if (!Number.isInteger(source) || source < 0 || source >= i || used.has(source)) return false
        used.add(source)
        for (const team of leaves[source]) teams.add(team)
      } else return false
    }
    leaves.push(teams)
  }
  const roots = nodes.map((_, i) => i).filter(i => !used.has(i))
  if (!roots.length) return false
  const seen = new Set<string>()
  for (const root of roots) {
    if (!leaves[root].size) return false
    for (const team of leaves[root]) {
      if (seen.has(team)) return false
      seen.add(team)
    }
  }
  if (!seen.has(club)) return false
  for (const [otherIndex, other] of ev.units.entries()) {
    if (otherIndex === ui) continue
    for (const n of other.nodes ?? []) for (const slot of [n.a, n.b]) {
      if (slot[0] === 's' && c.seeds[slot[1]] === club) return false
      if (slot[0] === 'g' && slot[1] === ui &&
        (!Number.isInteger(slot[2]) || slot[2]! < 1 || slot[2]! > roots.length)) return false
    }
  }
  return true
}
