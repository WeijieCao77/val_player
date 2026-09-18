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

/** A card already waiting, brought to the head of the list: the next one on screen. */
export function toFront(state: GameState, kind: PendingItem['kind'], id?: string): void {
  const me = state.me
  if (!me) return
  const i = me.pending.findIndex((x) => x.kind === kind && x.id === id)
  if (i > 0) me.pending.unshift(...me.pending.splice(i, 1))
}

/**
 * The card that follows from the one just answered, in that card's place at the head of the list instead of at
 * the back of it: 去试训 opens the tryout, a tryout passed opens its contract, 看合同 opens the contract.
 *
 * Found 2026-09-18 walking a ladder career, two clubs calling the same day (a call and the language's extra one,
 * me/prepro.ts callFrom): 去试训 on the first put the second club's invitation in front of the tryout, and its own
 * 去试训 did nothing — startTryout refuses a second tryout, and the card stayed up with no word — until it was
 * closed or turned down. And a tryout passed, or a 免试训 offer taken, left its contract behind that same
 * invitation: the contract the player had just earned was not the next thing on screen.
 */
export function pushFront(state: GameState, item: Omit<PendingItem, 'day'>): void {
  push(state, item)
  toFront(state, item.kind, item.id)
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
