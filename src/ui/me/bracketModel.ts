import { eventOf, eventSoFar } from '../../engine/circuit'
import { labelOf, roundCn } from '../../engine/eventTable'
import { DOUBLE_8, MASTERS_8, STAGE_8, TRIPLE_12, championsGroups, doubleFor } from '../../engine/bracket'
import type { Wave } from '../../engine/bracket'
import { drawRules } from '../../engine/ruleset'
import type { Competition, Fixture, GameState } from '../../engine/types'

export interface TreeSide { id?: string | null; name?: string; source: string; from?: string; outcome?: 'w' | 'l' }
export interface TreeMatch {
  id: string; round: string; column: number; bo: number; day?: number
  sides: [TreeSide, TreeSide]; scores?: [number, number]; winner?: string | null
  walk?: boolean; fixture?: Fixture
}
export interface TreeSection { id: string; title: string; tree: boolean; matches: TreeMatch[] }
const won = (f?: Fixture) => !f?.result || f.result.mapsWonA === f.result.mapsWonB ? undefined
  : f.result.mapsWonA > f.result.mapsWonB ? f.teamA : f.teamB
const result = (f?: Fixture): Pick<TreeMatch, 'fixture' | 'scores' | 'winner'> => ({ fixture: f,
  scores: f?.result ? [f.result.mapsWonA, f.result.mapsWonB] : undefined, winner: won(f) })

/** Read-only projection. Never use a future historical node's teams, winner or score. */
export function circuitTrees(state: GameState, comp: Competition): TreeSection[] {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  if (!ev || comp.circuit?.done) return []
  const view = eventSoFar(state, comp)
  const fixtures = new Map(state.fixtures.filter(f => f.comp === comp.key && f.node != null).map(f => [f.node!, f]))
  let base = 0
  return ev.units.flatMap((u, ui) => {
    const start = base; base += u.nodes?.length ?? 0
    if (!u.nodes?.length) return [] // Result-only qualifiers have no recoverable match tree.
    const shape = u.seats?.shape
    const tree = u.type === 'bracket' && !u.follow && shape !== 'swiss' && shape !== 'rr' && shape !== 'robin' && shape !== 'cross'
    const columns = new Map<string, number>()
    const matches: TreeMatch[] = u.nodes.map((n, i) => {
      const at = start + i, g = view?.games.get(at), f = fixtures.get(at)
      const ids = view?.sides(at) ?? [undefined, undefined]
      const slots = u.follow?.[i] ?? [n.a, n.b]
      const sides = slots.map((s, k): TreeSide => ({
        id: ids[k], name: ids[k] ? view?.names.get(ids[k]!) : undefined,
        source: s[0] === 'w' || s[0] === 'l' ? `#${s[1] + 1} ${s[0] === 'w' ? '胜者' : '败者'}`
          : s[0] === 'g' ? `${ev.units[s[1]]?.label ?? '上一阶段'}第 ${s[2] ?? '?'} 名` : '抽签/参赛名额待定',
        ...(tree && (s[0] === 'w' || s[0] === 'l') ? { from: `${ui}:${s[1]}`, outcome: s[0] } : {}),
      })) as [TreeSide, TreeSide]
      if (!columns.has(n.round)) columns.set(n.round, columns.size)
      return { id: `${ui}:${i}`, round: roundCn(n.round), column: columns.get(n.round)!,
        bo: f?.bo ?? (n.bo === 2 && u.type !== 'rr' && !u.follow ? 3 : n.bo), day: f?.day ?? n.day,
        sides, scores: g && !view?.walks.has(at) ? [g.mapsA, g.mapsB] : undefined,
        winner: g?.w, walk: view?.walks.has(at), fixture: f }
    })
    const label = labelOf(u)
    return [{ id: `c:${ui}`, title: [label.phase, label.group].filter(Boolean).join(' · ') || `阶段 ${ui + 1}`, tree, matches }]
  })
}

function templateTree(state: GameState, comp: Competition, waves: Wave[], seeds: string[], title: string): TreeSection {
  const own = state.fixtures.filter(f => f.comp === comp.key && f.label.startsWith('KO:'))
  const byRound = new Map<string, Fixture[]>()
  own.forEach(f => { const name = f.label.split(':').slice(2).join(':'); byRound.set(name, [...byRound.get(name) ?? [], f]) })
  const matches: TreeMatch[] = []
  waves.forEach((wave, column) => wave.forEach(r => r.slots.forEach((slot, index) => {
    const f = byRound.get(r.name)?.[index]
    const sides = [slot.a, slot.b].map((s, k): TreeSide => {
      const id = f ? k === 0 ? f.teamA : f.teamB : undefined
      if ('seed' in s) return { id: id ?? seeds[s.seed - 1], source: `种子 ${s.seed} / 抽签待定` }
      const outcome = 'w' in s ? 'w' : 'l', [round, ix] = 'w' in s ? s.w : s.l
      const prev = byRound.get(round)?.[ix], winner = won(prev)
      return { id: id ?? (winner ? outcome === 'w' ? winner : winner === prev?.teamA ? prev.teamB : prev?.teamA : undefined),
        source: `${round}第 ${ix + 1} 场${outcome === 'w' ? '胜者' : '败者'}`, from: `${round}:${ix}`, outcome }
    }) as [TreeSide, TreeSide]
    matches.push({ id: `${r.name}:${index}`, round: r.name, column, bo: f?.bo ?? slot.bo ?? 3, day: f?.day, sides, ...result(f) })
  })))
  return { id: title, title, tree: true, matches }
}

export function legacyTrees(state: GameState, comp: Competition): TreeSection[] {
  const own = state.fixtures.filter(f => f.comp === comp.key)
  const sections: TreeSection[] = []
  const swiss = own.filter(f => f.label.startsWith('SW:'))
  if (swiss.length) sections.push({ id: 'swiss', title: '瑞士轮 · 已确定的配对', tree: false,
    matches: swiss.map(f => ({ id: f.id, round: `第 ${f.label.split(':')[1]} 轮`, column: Number(f.label.split(':')[1]) - 1,
      sides: [{ id: f.teamA, source: '' }, { id: f.teamB, source: '' }], bo: f.bo, day: f.day, ...result(f) })) })
  if (comp.format === 'champions') {
    const group = templateTree(state, comp, championsGroups(), comp.groups?.flat() ?? comp.teams, '小组赛')
    for (const letter of ['A', 'B', 'C', 'D']) sections.push({ ...group, id: letter, title: `${letter} 组`, matches: group.matches.filter(m => m.round.startsWith(`${letter}组`)) })
  }
  let template: Wave[] | undefined
  if (comp.format === 'triple') template = TRIPLE_12
  else if (comp.format === 'double') template = comp.grouped ? STAGE_8 : doubleFor(comp.seeds?.length ?? 8).template
  else if (comp.format === 'masters' || comp.format === 'champions') template = drawRules(state) ? MASTERS_8 : DOUBLE_8
  if (template) sections.push(templateTree(state, comp, template, comp.seeds ?? [], '淘汰赛'))
  else {
    const ko = own.filter(f => f.label.startsWith('KO:'))
    const first = ko.filter(f => f.label.startsWith('KO:1:'))
    if (first.length) {
      const matches: TreeMatch[] = first.map(f => ({ id: f.id, round: f.label.split(':').slice(2).join(':'), column: 0,
        sides: [{ id: f.teamA, source: '参赛名额' }, { id: f.teamB, source: '参赛名额' }], bo: f.bo, day: f.day, ...result(f) }))
      const firstTeams = new Set(first.flatMap(f => [f.teamA, f.teamB]))
      // advanceBracket clears comp.byes after round 1; recorded round 2 preserves those entrants.
      const byes = comp.byes ?? [...new Set(ko.filter(f => f.label.startsWith('KO:2:')).flatMap(f => [f.teamA, f.teamB]))].filter(id => !firstTeams.has(id))
      let previous = [...matches], wave = 2
      while (previous.length > 1 || wave === 2 && byes.length) {
        const entrants: TreeSide[] = [...(wave === 2 ? byes.map(id => ({ id, source: '首轮轮空' })) : []),
          ...previous.map(m => ({ id: m.winner, source: `${m.round}胜者`, from: m.id, outcome: 'w' as const }))]
        if (entrants.length < 2 || entrants.length % 2) break // corrupt old saves: never invent a missing entrant
        const fixtures = ko.filter(f => f.label.startsWith(`KO:${wave}:`))
        const next: TreeMatch[] = []
        for (let i = 0; i < entrants.length / 2; i++) {
          const f = fixtures[i], sides: [TreeSide, TreeSide] = [{ ...entrants[i] }, { ...entrants[entrants.length - 1 - i] }]
          if (f) { sides[0].id = f.teamA; sides[1].id = f.teamB }
          const round = ({ 2: '决赛', 4: '半决赛', 8: '四分之一决赛', 16: '八分之一决赛' } as Record<number, string>)[entrants.length] ?? `${entrants.length}强`
          next.push({ id: f?.id ?? `future:${wave}:${i}`, round, column: wave - 1, bo: f?.bo ?? (entrants.length === 2 ? 5 : 3), day: f?.day, sides, ...result(f) })
        }
        matches.push(...next); previous = next; wave++
      }
      sections.push({ id: 'single', title: '淘汰赛', tree: true, matches })
    }
  }
  return sections
}

export const CARD_W = 212, CARD_H = 152, COL_GAP = 64, ROW_GAP = 20
/** Layer by actual source edges; unrelated matches never acquire invented connections. */
export function layoutTree(section: TreeSection) {
  const map = new Map(section.matches.map(m => [m.id, m]))
  const depths = new Map<string, number>()
  const depth = (id: string, seen = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const m = map.get(id)!
    const sources = m.sides.map(s => s.from).filter((s): s is string => !!s && map.has(s))
    const d = section.tree ? Math.max(0, ...sources.map(s => depth(s, new Set(seen)) + 1)) : m.column
    depths.set(id, d); return d
  }
  section.matches.forEach(m => depth(m.id))
  const positions = new Map<string, { x: number; y: number }>()
  const cols = [...new Set(depths.values())].sort((a, b) => a - b)
  cols.forEach(col => {
    let bottom = 8
    section.matches.filter(m => depths.get(m.id) === col).forEach(m => {
      const parents = m.sides.flatMap(s => s.from && positions.has(s.from) ? [positions.get(s.from)!.y] : [])
      const y = Math.max(bottom, parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 8)
      positions.set(m.id, { x: 8 + col * (CARD_W + COL_GAP), y }); bottom = y + CARD_H + ROW_GAP
    })
  })
  return { positions, width: Math.max(1, cols.length ? Math.max(...cols) + 1 : 1) * (CARD_W + COL_GAP) - COL_GAP + 16,
    height: Math.max(CARD_H + 16, ...[...positions.values()].map(p => p.y + CARD_H + 8)) }
}
