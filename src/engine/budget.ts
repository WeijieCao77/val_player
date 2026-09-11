import { squadOf, wageBill } from './roster'
import type { GameState, StageKey, Team } from './types'

/**
 * Every club's money, as the world keeps it: one number a club.
 *
 * What the AI clubs can afford to sign, and what a player's club can pay when
 * he asks it to go and get somebody, is `team.budget` and nothing else. It
 * moves by the week — sponsors and the league's stipend in, wages and running
 * costs out — and by what a club wins. The manager game keeps a ledger on top
 * of it for the club a person runs (engine/finance.ts, on the manager's desk);
 * the world keeps no ledger, no board and no players' cut (the author's rules
 * 1 and 2, 2026-09-11: a player's share of a prize is his own career's
 * business, engine/me/prizes.ts, and is not taken off the club twice).
 */

/** Prize money by competition and placement (USD). */
// Raised across the board after the group's "赚不到钱" week: a Challengers
// title paid $40k against a season's wage bill, and winning the biggest event
// in the game paid one million — trophies should move a balance sheet.
export const PRIZE: Record<string, number[]> = {
  kickoff: [260000, 150000, 90000, 55000, 30000, 30000, 15000, 15000],
  stage1: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  stage2: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  masters1: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  masters2: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  champions: [1500000, 750000, 420000, 280000, 160000, 160000, 100000, 100000],
  challengers1: [90000, 52000, 32000, 20000, 12000, 12000, 6000, 6000],
  challengers2: [130000, 75000, 45000, 30000, 18000, 18000, 10000, 10000],
}

/** A competition's prize money, into each club's budget by where it finished. */
export function awardPrize(state: GameState, stage: StageKey, order: string[]): void {
  const table = PRIZE[stage]
  if (!table) return
  order.forEach((teamId, i) => {
    const amount = table[i] ?? 0
    const team = state.teams[teamId]
    if (!amount || !team) return
    team.budget += amount
    team.seasonPrize += amount
  })
}

/**
 * What a week of keeping the lights on costs.
 *
 * Exported because the finance screen used to carry its own copy of this sum
 * and had never learned about the tier scale — it showed a profitable
 * Challengers club a red annual loss, sign and all. One formula, two readers.
 */
export function weeklyUpkeep(state: GameState, teamId: string): number {
  const team = state.teams[teamId]
  if (!team) return 0
  // Operating costs scale with the tier the club actually competes in: a
  // Challengers org does not fly to Masters, does not carry a VCT support
  // staff, and does not run a VCT facility.
  const scale = team.tier === 1 ? 1 : 0.35
  return Math.round((team.facilities * 900 + squadOf(state, teamId).length * 1400) / 4 * scale)
}

/** What being in the league pays a club per season, by tier. */
export const LEAGUE_STIPEND: Record<number, number> = { 1: 600_000, 2: 100_000 }

/** The stipend as the weekly books pay it. */
export const weeklyStipend = (tier: number): number =>
  Math.round((LEAGUE_STIPEND[tier] ?? 0) / 48)

/** What a sponsorship in this club's league is actually worth per season. */
export function sponsorWorth(team: Team): number {
  const tierBase = team.tier === 1 ? 320000 : 72000
  return tierBase * (1 + team.reputation / 160)
}

/**
 * The week's books, for every club.
 *
 * The league's stipend is the floor that keeps a decade-old world solvent —
 * sponsorship tops out, wages do not — and running costs scale with the tier a
 * club plays in: the formula was tier-blind once, and 28 of 29 Challengers
 * clubs lost money every season.
 */
export function weeklyBudgets(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    const wages = Math.round(wageBill(state, team.id) / 48)
    const sponsor = Math.round(team.sponsors.reduce((s, x) => s + x.perSeason, 0) / 48)
    team.budget += sponsor + weeklyStipend(team.tier) - wages - weeklyUpkeep(state, team.id)
  }
}
