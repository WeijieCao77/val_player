import type { GameState, Region, Team } from '../types'
import { clamp } from '../rng'
import { convert, leagueCurOf, roundPay, toCny, toUsd } from './currency'
import type { Cur } from './currency'
import type { PayTerms } from './types'

/**
 * What a club really pays, by league, tier and era — the career's own wages.
 *
 * The world's wage formula (engine/player.ts expectedSalary) is one dollar
 * scale for every region and every year. Measured against what was reported
 * (2026-09-14, 14 careers × 6 seasons), it paid a Chinese first-team contract
 * about twice the reported level, a 2021 Chinese first team ¥92–107 万 in a
 * year the game had no Chinese release, and a 2021 rookie at a Chinese second
 * team ¥3.8k a month. The shape of the formula stays — 综合, role, grade,
 * renewal, the asks — and each league moves it to its own level, in its own
 * currency, with a floor and a cap.
 *
 * Sources (the ones marked 暂定 have none; the author decides them):
 *  - Riot's partner-league minimum wage from 2023: US$50,000 Americas, €50,000
 *    EMEA, ₩67,000,000 Pacific (Dexerto, 2022-10-31). China's league has a floor
 *    and a team cap, amounts unpublished (Dexerto 2023-12-14; 新快网 2023-12-15).
 *  - Reported monthly wages, 2026 (VZone 2026-08-19, via a Russian Telegram
 *    channel — second-hand): Americas $10–12k, EMEA $8–10k, China and Pacific
 *    $6–8k; Challengers $1–2k, and $500 is good news in Europe.
 *  - North America before partnership: $5–20k a month on average, stars $25k
 *    (ShahZaM via ONE Esports, 2022-02-05).
 *  - China: ¥8–12k a month for a professional (游侠网 2024-05-15, unsourced);
 *    academy ¥10–12 万 a year, youth about ¥4,000 a month (VLR forum, rumour).
 */

/** a club's scene, for the level of its wages — finer than its currency */
export type PayGroup = 'NA' | 'LATAM' | 'EU' | 'KRJP' | 'SEA' | 'CN'

export function payGroupOf(region: Region | string | null | undefined): PayGroup {
  const r = String(region ?? '')
  if (r === 'China') return 'CN'
  if (r === 'North America' || r === 'Americas') return 'NA'
  if (r === 'Brazil' || r === 'LATAM') return 'LATAM'
  if (r === 'Korea' || r === 'Japan' || r === 'Pacific') return 'KRJP'
  const cur = leagueCurOf(r)
  return cur === 'EUR' ? 'EU' : cur === 'KRW' ? 'SEA' : cur === 'CNY' ? 'CN' : 'NA'
}

export interface PayBand {
  cur: Cur
  /** on the world's dollar wage */
  mul: number
  /** a year's wage, in `cur` */
  floor: number
  cap: number
  /** the floor is not a published figure */
  floorTbd: boolean
}

/** first team, 2023 on (China's league from 2024): multiplier, floor, cap */
const T1_PARTNER: Record<PayGroup, [number, number, number]> = {
  NA: [0.8, 50_000, 500_000],
  LATAM: [0.8, 50_000, 500_000],
  // 0.9 put EMEA's 2023–25 median at €14.5 万, over the reported €8–11 万 (2026-09-14)
  EU: [0.55, 50_000, 500_000],
  // 0.7 put Pacific's 2023–25 median at ₩1.51 亿, over the reported ₩0.9–1.3 亿 (2026-09-14)
  KRJP: [0.45, 67_000_000, 670_000_000],
  SEA: [0.45, 67_000_000, 670_000_000],
  // floor 暂定: the league has one, unpublished
  CN: [0.55, 300_000, 3_000_000],
}
/** first team before partnership (2021–22), and China's 2023 with no league: no floor. All 暂定 but North America. */
const T1_OPEN: Record<PayGroup, number> = { NA: 1.0, LATAM: 0.35, EU: 0.6, KRJP: 0.55, SEA: 0.3, CN: 0.18 }
const CN_2023 = 0.3
/**
 * second team, every year: multiplier on the world's dollar wage, a month's floor and cap (the caps 暂定).
 * China's floor is ¥6,000 in every year, 2021–22 too (the author, 2026-09-14: a 2021 rookie at Suning
 * signed for ¥4.8 万 on the ¥4,000 floor). EMEA's wage is moved down: at 1 its median was about €2.2k a
 * month, over the reported €500–1,500 (VZone 2026, THESPIKE 2025, Strafe 2024).
 */
const T2_MONTH: Record<PayGroup, [number, number, number]> = {
  NA: [1, 1_000, 5_000],
  LATAM: [1, 600, 3_000],
  EU: [0.6, 500, 2_500],
  KRJP: [1, 1_500_000, 7_500_000],
  SEA: [1, 550_000, 2_750_000],
  CN: [1, 6_000, 30_000],
}

export function payBand(region: Region | string | null | undefined, tier: number, year: number): PayBand {
  const g = payGroupOf(region)
  const cur = leagueCurOf(region)
  if (tier === 1) {
    const partnered = year >= 2024 || (year === 2023 && g !== 'CN')
    const [, floor, cap] = T1_PARTNER[g]
    if (partnered) return { cur, mul: T1_PARTNER[g][0], floor, cap, floorTbd: g === 'CN' }
    return { cur, mul: g === 'CN' && year === 2023 ? CN_2023 : T1_OPEN[g], floor: 0, cap, floorTbd: false }
  }
  const [mul, floor, cap] = T2_MONTH[g]
  return { cur, mul, floor: floor * 12, cap: cap * 12, floorTbd: true }
}

/** A wage the world would pay in dollars, as this club writes it into a contract: its league's level and currency, floored and capped. */
export function offerOf(team: Pick<Team, 'region' | 'tier'>, year: number, usd: number): { cur: Cur; salary: number } {
  const b = payBand(team.region, team.tier, year)
  const raw = convert(usd * b.mul, 'USD', b.cur, year)
  return { cur: b.cur, salary: roundPay(clamp(raw, b.floor, b.cap), b.cur) }
}

/** An amount already in the club's currency kept inside its band — after an ask, a refusal, a title raise. */
export function keepInBand(team: Pick<Team, 'region' | 'tier'>, year: number, amount: number): number {
  const b = payBand(team.region, team.tier, year)
  return roundPay(clamp(amount, b.floor, b.cap), b.cur)
}

/** What that offer comes to in the world's dollars — a club's budget is checked against this. */
export const offerUsd = (team: Pick<Team, 'region' | 'tier'>, year: number, usd: number): number => {
  const o = offerOf(team, year, usd)
  return toUsd(o.salary, o.cur, year)
}

/** The contract I am on, in the currency it was signed in. */
export type MyPay = PayTerms

/**
 * My contract's terms as signed. Kept on the career (me.pay); a contract the
 * world wrote or rewrote for me since (engine re-registration, an old save) is
 * read off its dollar wage in my club's currency at this year's rate.
 */
export function payOf(state: GameState): MyPay | null {
  const me = state.me
  const p = me && state.players[me.id]
  if (!me || !p || me.phase !== 'pro' || !p.teamId) return null
  const team = state.teams[p.teamId]
  const cur = leagueCurOf(team?.region)
  const pay = me.pay
  if (pay && pay.cur === cur && Math.abs(toUsd(pay.salary, pay.cur, pay.year) - p.salary) <= 1500) return pay
  return {
    cur, year: state.year, tier: team?.tier === 1 ? 1 : 2,
    salary: roundPay(convert(p.salary, 'USD', cur, state.year), cur),
    sign: roundPay(convert(p.contract?.signingBonus ?? 0, 'USD', cur, state.year), cur),
    buyout: roundPay(convert(me.flags.buyout ?? 0, 'USD', cur, state.year), cur),
  }
}

/** A year of my wage in RMB at this year's rate; 0 with no contract. */
export function wageCny(state: GameState): number {
  const pay = payOf(state)
  return pay ? toCny(pay.salary, pay.cur, state.year) : 0
}
