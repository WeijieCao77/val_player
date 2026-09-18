import { onTimeline, stageNameIn } from '../era'
import type { GameState } from '../types'
import type { LedgerBook, MoneyKind } from './types'

/**
 * The one door every yuan goes through (me/money.ts says why), on its own:
 * money.ts re-exports all of it. Apart since 2026-09-18 because the rest of
 * money.ts reads every circuit's prize tables, and an achievement that pays out
 * (me/achievements.ts) must not make the 成就殿堂 on the home page fetch the
 * whole world (an outside audit: the home page downloaded about 8 MB before any
 * career was opened).
 */

export const emptyBook = (): LedgerBook => ({ in: {}, out: {} })

export function initLedger(state: GameState, label = ''): void {
  const me = state.me!
  me.ledger = { cur: emptyBook(), prev: null, label, prevLabel: '', lifetimeIn: 0, lifetimeOut: 0 }
}

/**
 * The only way money changes hands. Positive is income, negative is spending;
 * `kind` picks the row it lands on. Returns the amount actually moved so the
 * caller can print it.
 */
export function addMoney(state: GameState, kind: MoneyKind, amount: number): number {
  const me = state.me
  if (!me) return 0
  const n = Math.round(amount || 0)
  if (!n) return 0
  if (!me.ledger) initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state)))
  me.money += n
  const led = me.ledger!
  const side = n > 0 ? led.cur.in : led.cur.out
  side[kind] = (side[kind] ?? 0) + Math.abs(n)
  if (n > 0) led.lifetimeIn += n
  else led.lifetimeOut += -n
  return n
}
