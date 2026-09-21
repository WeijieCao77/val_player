import { eventOf, eventsOf, isPlacementRound } from '../circuit'
import type { CEvent } from '../circuit'
import type { GameState } from '../types'
import type { MeMatchRecord } from './types'
import type { FmvpTitle } from './fmvpRead'
import { isQualifier } from './compclass'

const finalLabel = (label: string): boolean => /^(?:总决赛|决赛|Grand Finals?|Finals?)$/i.test(label.replace(/^(?:KO|SW):\d+:/, '').trim())
function decider(ev: CEvent): { index: number; round: string } | null {
  const flat = ev.units.flatMap((u, ui) => (u.nodes ?? []).map((node, local) => ({ node, ui, local })))
  const main = ev.units.map((u, i) => ({ u, i })).filter(x => x.u.type === 'bracket' && !x.u.side && (x.u.nodes?.length ?? 0) > 0).at(-1)
  if (!main) return null
  const ends = flat.map((x, index) => ({ ...x, index })).filter(x => x.ui === main.i && !isPlacementRound(x.node.round) &&
    !flat.some(y => y.ui === x.ui && !isPlacementRound(y.node.round) && [y.node.a, y.node.b].some(slot => (slot[0] === 'w' || slot[0] === 'l') && slot[1] === x.local)))
  return ends.length === 1 ? { index: ends[0].index, round: ends[0].node.round } : null
}

/** Never equate the last win, an upper final, or a qualification tie with a title final. */
export function isTitleFinal(s: GameState, r: MeMatchRecord): boolean {
  if (r.friendly || isQualifier(r.comp)) return false
  const f = r.year === s.year ? s.fixtures.find(x => x.id === r.fixtureId) : undefined
  const comp = f ? s.comps[f.comp] : undefined
  if (comp?.circuit) {
    const ev = eventOf(comp.circuit.id), end = ev ? decider(ev) : null
    return !!end && f?.node === end.index
  }
  // An old record can still be checked against its year's actual tournament graph.
  const events = eventsOf(r.year).filter(e => e.cn === r.comp)
  if (events.length === 1) {
    const end = decider(events[0])
    return !!end && finalLabel(r.label) && finalLabel(end.round) && r.label.replace(/^(?:KO|SW):\d+:/, '').trim().toLowerCase() === end.round.trim().toLowerCase()
  }
  // Legacy/non-timeline fixtures retain their unambiguous round label.
  return finalLabel(r.label)
}

/** Undefined means the remaining record cannot answer, never an invented "no". */
export function fmvpEvidence(s: GameState, t: FmvpTitle): boolean | undefined {
  if (!t.started || isQualifier(t.title)) return false
  const rows = s.me!.matches.filter(r => !r.friendly && r.year === t.year && r.comp === t.title)
  const finals = rows.filter(r => isTitleFinal(s, r))
  if (finals.length === 1) return finals[0].started && finals[0].won && finals[0].mvp
  if (finals.length > 1) return undefined
  // A retained non-final is not evidence for an award, even if it was the last win.
  // The old reward key is usable only for an event with an identifiable real final.
  const events = eventsOf(t.year).filter(e => e.cn === t.title)
  if (!rows.length && events.length === 1 && decider(events[0]) && s.me!.bottleneck?.seen.includes(`fmvp:${t.year}:${t.title}`)) return true
  return undefined
}

/** Called before detail trimming on load and when a new trophy is booked. */
export function rememberFMVPs(s: GameState): void {
  if (!s.me) return
  for (const t of s.me.titles) {
    if (typeof t.fmvp !== 'boolean') delete t.fmvp
    if (!t.started || isQualifier(t.title)) { if (t.fmvp !== undefined) t.fmvp = false; continue }
    if (t.fmvp === undefined) {
      const evidence = fmvpEvidence(s, t)
      if (evidence !== undefined) t.fmvp = evidence
    }
  }
}
