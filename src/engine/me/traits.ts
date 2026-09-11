import type { GameState } from '../types'
import type { Axis, MeState } from './types'
import { pushLog } from './log'
import { push } from './pending'

export const TRAIT_NEED = 5
export const AXIS_CN: Record<Axis, string> = { hard: '硬', warm: '暖', grind: '苦', show: '秀' }

export interface TraitDef { key: string; name: string; axis: Axis; blurb: string; gain: string; cost: string }

/**
 * What the choices add up to. Every trait costs something — otherwise it is
 * a reward, not a character — and the opposite pairs exclude each other.
 */
export const TRAITS: TraitDef[] = [
  { key: 'edge', name: '刺头', axis: 'hard', blurb: '不服就顶，输了也顶。', gain: '涨粉 ×1.18，逆风时临场决策 +3%', cost: '队友信任涨幅 ×0.80' },
  { key: 'glue', name: '队内粘合剂', axis: 'warm', blurb: '谁都愿意和你双排。', gain: '羁绊与信任涨幅 ×1.35', cost: '涨粉 ×0.90' },
  { key: 'grinder', name: '劳模', axis: 'grind', blurb: '别人下播你还在练。', gain: '训练收益 ×1.14', cost: '休息回体力 ×0.88' },
  { key: 'star', name: '话题人物', axis: 'show', blurb: '有你就有热度。', gain: '涨粉 ×1.28', cost: '每个赛段教练信任 −2' },
]
export const TRAIT_OPP: Record<string, string> = { edge: 'glue', glue: 'edge', grinder: 'star', star: 'grinder' }
export const traitOf = (key: string) => TRAITS.find((t) => t.key === key)

/** A choice on an axis; the fifth on the same axis becomes who I am. */
export function addAxis(state: GameState, axis: Axis, n = 1): string | null {
  const me = state.me!
  me.axes[axis] = (me.axes[axis] ?? 0) + n
  const t = TRAITS.find((x) => x.axis === axis)
  if (!t || me.traits.includes(t.key) || me.traits.includes(TRAIT_OPP[t.key])) return null
  if (me.axes[axis] < TRAIT_NEED) return null
  me.traits.push(t.key)
  push(state, { kind: 'trait', id: t.key })
  pushLog(state, 'event', `你成了这样的人：${t.name}。${t.gain}；${t.cost}。`)
  return t.key
}

export function traitMul(me: MeState, kind: 'fan' | 'trust' | 'train' | 'rest'): number {
  let m = 1
  const has = (k: string) => me.traits?.includes(k)
  if (kind === 'fan') { if (has('edge')) m *= 1.18; if (has('glue')) m *= 0.9; if (has('star')) m *= 1.28 }
  if (kind === 'trust') { if (has('edge')) m *= 0.8; if (has('glue')) m *= 1.35 }
  if (kind === 'train') { if (has('grinder')) m *= 1.14 }
  if (kind === 'rest') { if (has('grinder')) m *= 0.88 }
  return m
}
