import type { GameState } from '../types'
import type { PendingItem } from './types'

/** Put something in front of me; the clock stops on it. */
export function push(state: GameState, item: Omit<PendingItem, 'day'>): void {
  const me = state.me
  if (!me) return
  if (me.pending.some((x) => x.kind === item.kind && x.id === item.id)) return
  me.pending.push({ ...item, day: state.day })
}

export function head(state: GameState): PendingItem | undefined {
  return state.me?.pending[0]
}

export function pop(state: GameState, kind?: PendingItem['kind'], id?: string): void {
  const me = state.me
  if (!me) return
  const i = me.pending.findIndex((x) => (!kind || x.kind === kind) && (!id || x.id === id))
  if (i >= 0) me.pending.splice(i, 1)
}
