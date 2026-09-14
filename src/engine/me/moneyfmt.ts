import { CUR_SIGN, FX_LAST, convert, fxTentative, fxYear, perUsd, toCny } from './currency'
import type { Cur } from './currency'

/**
 * The one way an amount of money is written for the player.
 *
 * Every amount on a screen, in the diary, on the share card goes through here
 * (scripts/check_money.ts holds the code to it). An RMB amount is written as
 * RMB and nothing else; any other amount is followed by what it comes to in
 * RMB — 「年薪 €80,000（约 ¥64 万）」 — because the players are Chinese and the
 * wallet is in yuan (me/currency.ts).
 *
 * Big RMB amounts read the way Chinese does: ¥8,500 · ¥1.6 万 · ¥64 万 · ¥1.26 亿.
 */

const group = (n: number): string => Math.round(n).toLocaleString('en-US')
const trim = (s: string): string => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')

/** a magnitude in 万/亿, no sign: 8,500 · 1.6 万 · 64 万 · 1.26 亿 */
function wan(a: number): string {
  if (a >= 1e8) return `${trim((a / 1e8).toFixed(2))} 亿`
  if (a >= 1e5) return `${Math.round(a / 1e4)} 万`
  if (a >= 1e4) return `${trim((a / 1e4).toFixed(1))} 万`
  return group(a)
}

/** RMB, short: ¥8,500 · ¥1.6 万 · ¥64 万 · ¥1.26 亿. Negative as -¥800. */
export function cny(n: number): string {
  const v = Math.round(n || 0)
  return `${v < 0 ? '-' : ''}¥${wan(Math.abs(v))}`
}

/** RMB to the yuan: ¥12,345 — for a ledger row, where the last digits add up. */
export function cnyExact(n: number): string {
  const v = Math.round(n || 0)
  return `${v < 0 ? '-' : ''}¥${group(Math.abs(v))}`
}

/** A signed RMB change: +¥1.2 万 · −¥800. */
export const cnySigned = (n: number): string => `${n < 0 ? '−' : '+'}${cny(Math.abs(n))}`

/** An amount in its own currency, as written: $50,000 · €80,000 · ₩6,700 万 (won are counted in 万 like yuan). */
export function bare(n: number, cur: Cur): string {
  if (cur === 'CNY') return cny(n)
  const v = Math.round(n || 0)
  const a = Math.abs(v)
  return `${v < 0 ? '-' : ''}${CUR_SIGN[cur]}${cur === 'KRW' ? wan(a) : group(a)}`
}

/**
 * An amount in any of the four currencies, as the player reads it: RMB as RMB;
 * anything else with its RMB beside it at `year`'s rate — €80,000（约 ¥64 万）.
 */
export function money(n: number, cur: Cur, year: number): string {
  if (cur === 'CNY') return cny(n)
  return `${bare(n, cur)}（约 ${cny(toCny(n, cur, year))}）`
}

/** Dollars the world keeps (a club's budget, a transfer fee), written in that club's currency with RMB beside it. */
export const worldMoney = (usd: number, cur: Cur, year: number): string => money(Math.round(convert(usd, 'USD', cur, year)), cur, year)

/** The rates the page shows: 1 美元 = ¥7.13 · 1 欧元 = ¥8.05 · 1 万韩元 = ¥50.14（2025 年均；2026 起暂定） */
export function rateLine(year: number): string {
  const y = fxYear(year)
  const per = (cur: Cur, units = 1) => ((perUsd('CNY', y) / perUsd(cur, y)) * units).toFixed(2)
  const basis = fxTentative(year) ? `${FX_LAST} 年均，${FX_LAST + 1} 年起暂定` : `${y} 年均`
  return `汇率：1 美元 = ¥${per('USD')} · 1 欧元 = ¥${per('EUR')} · 1 万韩元 = ¥${per('KRW', 10000)}（${basis}）`
}
