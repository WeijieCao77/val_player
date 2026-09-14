import type { Region } from '../types'
import { regionIn } from '../era'

/**
 * The career's four currencies: one per VCT league.
 *
 * The author, 2026-09-14: 「只有四个赛区所以货币四种比较好，太细节了玩家也看不懂然后货币
 * 后面跟一个换算（换成人民币），这样玩家能看懂，也有参与感，我们的玩家都是中国人」.
 *
 *  - China ¥ CNY · Americas $ USD · EMEA € EUR · Pacific ₩ KRW. Riot's Pacific
 *    minimum wage is written in won (Dexerto, 2022-10-31), so every Pacific club
 *    pays in won — Japan's and Southeast Asia's too.
 *  - The wallet, the ledger and every price are in RMB, and stay in RMB, so a
 *    balance never moves by itself when a year's rate changes.
 *  - A contract is signed in its club's league currency and paid into the
 *    wallet week by week at that year's rate; a prize is converted the week it
 *    is paid.
 *
 * The world's own books — every club's budget, every other player's wage — are
 * kept in dollars as before (engine/budget.ts): only the career's money moved.
 */
export type Cur = 'CNY' | 'USD' | 'EUR' | 'KRW'
export const CURS: Cur[] = ['CNY', 'USD', 'EUR', 'KRW']
export const CUR_SIGN: Record<Cur, string> = { CNY: '¥', USD: '$', EUR: '€', KRW: '₩' }
export const CUR_CN: Record<Cur, string> = { CNY: '人民币', USD: '美元', EUR: '欧元', KRW: '韩元' }

/**
 * Units of each currency per US dollar, yearly average: the IRS table of yearly
 * average currency exchange rates (irs.gov, page updated 2026-02-24), checked
 * against the Federal Reserve's G.5A annual release for 2021 (CNY 6.4508,
 * EUR $1.1830, KRW 1144.89) and 2025 (CNY 7.1875, EUR $1.1306, KRW 1421.40).
 * 2026 has no yearly average yet: 2026 and every year after it use 2025's, 暂定.
 */
export const FX: Record<Exclude<Cur, 'USD'>, Record<number, number>> = {
  CNY: { 2021: 6.452, 2022: 6.730, 2023: 7.075, 2024: 7.189, 2025: 7.129 },
  EUR: { 2021: 0.846, 2022: 0.951, 2023: 0.924, 2024: 0.924, 2025: 0.886 },
  KRW: { 2021: 1144.883, 2022: 1291.729, 2023: 1306.686, 2024: 1364.153, 2025: 1421.779 },
}
export const FX_FIRST = 2021
/** the last year with a published yearly average; later years borrow it, 暂定 */
export const FX_LAST = 2025

export const fxYear = (year: number): number => Math.min(FX_LAST, Math.max(FX_FIRST, Math.floor(year)))
export const fxTentative = (year: number): boolean => year > FX_LAST
export const perUsd = (cur: Cur, year: number): number => (cur === 'USD' ? 1 : FX[cur][fxYear(year)])

/** An amount from one currency into another at a year's average rate. Not rounded. */
export function convert(amount: number, from: Cur, to: Cur, year: number): number {
  if (from === to || !amount) return amount || 0
  return (amount / perUsd(from, year)) * perUsd(to, year)
}

/** Into the wallet's RMB, to the yuan. */
export const toCny = (amount: number, cur: Cur, year: number): number => Math.round(convert(amount, cur, 'CNY', year))
/** Into dollars, to the dollar — the world's books. */
export const toUsd = (amount: number, cur: Cur, year: number): number => Math.round(convert(amount, cur, 'USD', year))

/**
 * The currency a region's clubs are paid in: its league's. A region that was
 * folded into a league later is read as that league's (Japan in 2021 is a
 * Pacific club, Turkey an EMEA one), so a club's currency never changes.
 */
export function leagueCurOf(region: Region | string | null | undefined): Cur {
  if (!region) return 'USD'
  const league = regionIn(region as Region, 9999)
  if (league === 'China') return 'CNY'
  if (league === 'EMEA') return 'EUR'
  if (league === 'Pacific') return 'KRW'
  return 'USD'
}

/** A wage or a fee rounded the way a contract writes it: to the thousand, the won to the million. */
export const roundPay = (amount: number, cur: Cur): number => {
  const unit = cur === 'KRW' ? 1_000_000 : 1000
  return Math.round(amount / unit) * unit
}
