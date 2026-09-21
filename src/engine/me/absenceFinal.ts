import type { Fixture, GameState } from '../types'
import { eventOf, isPlacementRound } from '../circuit'
import { DOUBLE_8, GF, championsGroups } from '../bracket'
import { activeAbsence } from './absence'
import { ensureCareerEvents, recordCareerEvent } from './eventState'
import type { MissedFinal } from './eventState'
import type { MeMatchRecord } from './types'

/** A genuine global championship decider, read from its graph, not a translated title. */
export function internationalFinal(state: GameState, f: Fixture): { eventId: string; competition: string } | null {
  const comp = state.comps[f.comp]
  if (!comp || !comp.teams.includes(state.myTeam) || (f.teamA !== state.myTeam && f.teamB !== state.myTeam)) return null
  if (comp.circuit) {
    const ev = eventOf(comp.circuit.id)
    if (!ev || ev.region !== null || !['masters1', 'masters2', 's1masters', 's2finals', 's3finals', 'champions'].includes(ev.stage ?? '')) return null
    if (f.node == null || f.node < 0) return null
    const flat = ev.units.flatMap((unit, ui) => (unit.nodes ?? []).map((node, local) => ({ node, ui, local })))
    const main = ev.units.map((u, i) => ({ u, i })).filter(x => x.u.type === 'bracket' && !x.u.side && (x.u.nodes?.length ?? 0) > 0).at(-1)
    if (!main || flat[f.node]?.ui !== main.i) return null
    // The champion's node has no winner/loser feeding another competitive node.
    // A bronze/access series is not a champion's node even when scheduled last.
    const terminal = flat.map((x, index) => ({ ...x, index })).filter(x =>
      x.ui === main.i && !isPlacementRound(x.node.round) &&
      !flat.some(y => y.ui === x.ui && !isPlacementRound(y.node.round) && [y.node.a, y.node.b].some(slot => (slot[0] === 'w' || slot[0] === 'l') && slot[1] === x.local)))
    if (terminal.length !== 1 || terminal[0].index !== f.node) return null
    return { eventId: ev.id, competition: comp.name }
  }
  // Pre-timeline saves use the engine's fixed eight-team global finals template.
  if (comp.region || !['masters1', 'masters2', 'champions'].includes(comp.stage) || !['masters', 'champions'].includes(comp.format ?? '')) return null
  const exact = `KO:${DOUBLE_8.length + (comp.format === 'champions' ? championsGroups().length : 0)}:${GF}`
  if (f.label !== exact || f.bo !== 5) return null
  return { eventId: comp.key, competition: comp.name }
}

/** Record the counterfactual before lineup removal; it survives reload on the match day. */
export function prepareMedicalFinal(state: GameState, f: Fixture, reason: MissedFinal['reason']): void {
  if (f.played || !internationalFinal(state, f)) return
  const leave = activeAbsence(state)
  if (leave?.reason === 'family') return
  const book = ensureCareerEvents(state)
  book.pendingMedicalFinal = { fixtureId: f.id, year: state.year, day: state.day, clubId: state.myTeam, reason }
}

/** Only the actually completed result can award a missed final, never an arbitrary bench record. */
export function finishMedicalFinal(state: GameState, f: Fixture, rec: MeMatchRecord): void {
  const book = state.me?.careerEvents
  const proof = book?.pendingMedicalFinal
  if (!book || !proof || proof.fixtureId !== f.id) return
  delete book.pendingMedicalFinal
  const event = internationalFinal(state, f)
  const me = state.me!
  const leave = activeAbsence(state)
  const medicallyOut = proof.reason === 'injury'
    ? !leave && state.players[me.id].injuredUntil > state.day
    : !!leave && leave.reason === proof.reason && leave.clubId === state.myTeam
  const tookPart = rec.started || !!f.result?.maps.some(m => !!m.lines[me.id]?.rounds)
  if (!event || rec.friendly || !f.played || tookPart || !medicallyOut || proof.year !== state.year || proof.day !== state.day || proof.clubId !== state.myTeam) return
  if (book.missedFinals.some(x => x.year === state.year && x.fixtureId === f.id)) return
  book.missedFinals.push({ year: state.year, day: state.day, fixtureId: f.id, eventId: event.eventId, competition: event.competition, clubId: state.myTeam, reason: proof.reason })
  recordCareerEvent(state, 'medical', `因医疗缺阵错过了 ${event.competition} 的冠军决赛。`)
}
