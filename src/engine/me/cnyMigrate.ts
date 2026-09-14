import type { GameState } from '../types'
import { convert, leagueCurOf, perUsd, roundPay } from './currency'

/** Set once a career's money is in RMB: a new career is born with it (me/career.ts), an old save is given it here. */
export const CNY_FLAG = 'cny'

/**
 * A save from before the four currencies (2026-09-14) kept every amount in
 * dollars. Once, when it is loaded:
 *  - the wallet and everything the career counted in money — the ledger, the
 *    weekly upkeep, what was sent home and what the café paid, a streaming
 *    deal's guarantee, an offer's terms, the cups' prizes on record — into RMB
 *    at the save year's rate;
 *  - contracts on the table into their club's league currency at that rate;
 *  - the contract I am on into my club's league currency at the rate of the
 *    year it was signed, so its wage reads as it was agreed.
 * The flag keeps it from ever being applied twice. The world's books (every
 * club's budget, player.salary) stay in dollars and are not touched.
 */
export function migrateToCny(state: GameState): boolean {
  const me = state.me
  if (!me || me.flags[CNY_FLAG]) return false
  const y = state.year
  const k = perUsd('CNY', y)
  const c = (n: number | undefined): number => Math.round((n ?? 0) * k)
  const book = (b: { in: Record<string, number | undefined>; out: Record<string, number | undefined> } | null | undefined) => {
    if (!b) return
    for (const side of [b.in, b.out]) for (const key of Object.keys(side)) side[key] = c(side[key])
  }

  me.money = c(me.money)
  me.upkeep = c(me.upkeep)
  if (me.ledger) {
    book(me.ledger.cur)
    book(me.ledger.prev)
    me.ledger.lifetimeIn = c(me.ledger.lifetimeIn)
    me.ledger.lifetimeOut = c(me.ledger.lifetimeOut)
  }
  if (me.out) {
    me.out.familySent = c(me.out.familySent)
    if (me.out.cafe) me.out.cafe.paid = c(me.out.cafe.paid)
  }
  if (me.stream?.deal) me.stream.deal.guarantee = c(me.stream.deal.guarantee)
  if (me.stream?.offer) {
    me.stream.offer.sign = c(me.stream.offer.sign)
    me.stream.offer.guarantee = c(me.stream.offer.guarantee)
  }
  for (const run of me.pre?.cups ?? []) run.prize = c(run.prize)

  for (const d of me.deals ?? []) {
    const cur = leagueCurOf(state.teams[d.teamId]?.region)
    const to = (n: number) => roundPay(convert(n ?? 0, 'USD', cur, y), cur)
    d.cur = cur
    d.salary = to(d.salary)
    d.signBonus = to(d.signBonus)
    d.buyout = to(d.buyout)
  }

  const p = state.players[me.id]
  const team = p?.teamId ? state.teams[p.teamId] : undefined
  if (me.phase === 'pro' && p && team) {
    const cur = leagueCurOf(team.region)
    // a deal of N years with M left was signed N − M seasons ago — and not before I joined the club
    const signed = Math.max(p.joinedYear ?? y, Math.min(y, y - ((p.contract?.years ?? 1) - (p.contractYears ?? 0))))
    const to = (n: number) => roundPay(convert(n ?? 0, 'USD', cur, signed), cur)
    me.pay = { cur, salary: to(p.salary), sign: to(p.contract?.signingBonus ?? 0), buyout: to(me.flags.buyout ?? 0), year: signed, tier: team.tier === 1 ? 1 : 2 }
  }

  me.flags[CNY_FLAG] = 1
  return true
}
