import type { GameState } from '../types'
import type { PendingItem } from './types'
import { countOffer } from './telemetry'

/** Put something in front of me; the clock stops on it. */
export function push(state: GameState, item: Omit<PendingItem, 'day'>): void {
  const me = state.me
  if (!me) return
  if (me.pending.some((x) => x.kind === item.kind && x.id === item.id)) return
  me.pending.push({ ...item, day: state.day })
  // An offer or an invitation arrived. Every one of the thirteen places that
  // makes one pushes its card here on the next line, so this is the one door
  // they all come through — and each is counted once by its id, because an
  // offer set aside and reopened from the 转会 page comes through it twice
  // (me/aside.ts reopen).
  if (item.kind === 'deal') countOffer('deal_in', item.id)
  else if (item.kind === 'invite') countOffer('invite_in', item.id)
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
