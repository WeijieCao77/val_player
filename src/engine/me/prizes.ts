import type { StageKey } from '../types'

/**
 * Prize money by competition and placement (USD), the career's own copy.
 *
 * The figures started as the manager game's table in engine/finance.ts. The
 * author wants nothing of the manager mode used here (「不要用任何经理模式的东西，
 * 如果有需要就复制一份」, 2026-09-11), so the career reads this copy and a change
 * made over there can never reach a player's pay.
 */
export const PRIZE_TABLE: Record<string, number[]> = {
  kickoff: [260000, 150000, 90000, 55000, 30000, 30000, 15000, 15000],
  stage1: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  stage2: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  masters1: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  masters2: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  champions: [1500000, 750000, 420000, 280000, 160000, 160000, 100000, 100000],
  challengers1: [90000, 52000, 32000, 20000, 12000, 12000, 6000, 6000],
  challengers2: [130000, 75000, 45000, 30000, 18000, 18000, 10000, 10000],
}

export const prizeFor = (stage: StageKey, place: number): number => PRIZE_TABLE[stage]?.[place] ?? 0

/**
 * The players' part of a club's prize money, split between the roster. The
 * contract used to say 10% (6% below the leagues), a manager-game number; the
 * common arrangement in the real scene is that the players take about eight in
 * ten of what the team wins, contract by contract (Esports Insider, 2024-03).
 */
export const PLAYER_PRIZE_SHARE = 80
