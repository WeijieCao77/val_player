import { wageBill } from './roster'
import { skillMod } from './manager'
import { PRIZE, weeklyStipend, weeklyUpkeep } from './budget'
import type { Competition, GameState } from './types'

/**
 * The manager's books: his club's balance and its ledger.
 *
 * The world keeps one number a club (engine/budget.ts) — what it can afford.
 * The manager game keeps a balance and a line-by-line ledger on top of it for
 * the club a person runs, written from his desk (engine/managerDesk.ts): the
 * prize money with the players' contracted cut taken off, and the week's books
 * — the sponsors he works harder for, the league's stipend, the wages and the
 * running costs. Debt costs the board's confidence.
 */

export { PRIZE, weeklyUpkeep }

/** A season of running costs, as the finance screen projects it. */
export const seasonUpkeep = (state: GameState, teamId: string): number =>
  weeklyUpkeep(state, teamId) * 48

/**
 * A competition's prize money in the managed club's books.
 *
 * The world has already paid the prize into the club's budget. Here the
 * players take their contracted cut before the club banks the rest — the
 * manager game's contracts carry a prize share — and the ledger says so.
 */
export function prizeLedger(state: GameState, comp: Competition): void {
  const team = state.teams[state.myTeam]
  const i = comp.finished.indexOf(state.myTeam)
  const amount = i >= 0 ? PRIZE[comp.stage]?.[i] ?? 0 : 0
  if (!team || !amount) return
  let share = 0
  for (const pid of team.roster) {
    const c = state.players[pid]?.contract
    if (c?.bonusShare) share += (amount * c.bonusShare) / 100 / Math.max(1, team.roster.length)
  }
  share = Math.round(share)
  team.budget -= share
  team.seasonPrize -= share
  state.finances.balance += amount - share
  state.finances.log.push({ day: state.day, label: `奖金 · ${comp.stage} 第${i + 1}名`, amount: amount - share })
  if (share > 0) {
    state.finances.log.push({ day: state.day, label: '选手奖金分成', amount: -share })
  }
}

/**
 * The managed club's week, in its books.
 *
 * The world has already moved the club's budget (engine/budget.ts
 * weeklyBudgets). A manager who works his sponsors gets more out of them — 商务
 * — and that goes into the budget as well, and every line is written down.
 * 「资金为负会持续削弱董事会信任度」 is printed on the finance page: debt costs
 * confidence, scaled to how deep it is.
 */
export function weeklyLedger(state: GameState): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  const wages = Math.round(wageBill(state, team.id) / 48)
  const perSeason = team.sponsors.reduce((s, x) => s + x.perSeason, 0)
  const sponsor = Math.round(perSeason / 48 * skillMod(state.manager, 'business', 0.005))
  // the world paid the plain figure; what the manager's pull adds is his
  team.budget += sponsor - Math.round(perSeason / 48)
  const upkeep = weeklyUpkeep(state, team.id)
  const stipend = weeklyStipend(team.tier)
  const net = sponsor + stipend - wages - upkeep
  state.finances.balance += net
  if (state.finances.balance < 0) {
    const depth = Math.min(3, -state.finances.balance / Math.max(1, wages * 4))
    const hit = 0.5 + depth * 1.5
    state.boardConfidence = Math.max(0, state.boardConfidence - hit)
  }
  state.finances.log.push({ day: state.day, label: '赞助收入', amount: sponsor })
  state.finances.log.push({ day: state.day, label: '联盟津贴', amount: stipend })
  state.tally ??= { signed: 0, hired: 0, earned: 0, commercial: 0 }
  state.tally.commercial += sponsor
  state.finances.log.push({ day: state.day, label: '选手薪资', amount: -wages })
  state.finances.log.push({ day: state.day, label: '运营开支', amount: -upkeep })
  if (state.finances.log.length > 200) {
    state.finances.log.splice(0, state.finances.log.length - 200)
  }
}

export const seasonWageBill = (state: GameState, teamId: string) => wageBill(state, teamId)

export const sponsorIncome = (state: GameState, teamId: string) =>
  state.teams[teamId]?.sponsors.reduce((s, x) => s + x.perSeason, 0) ?? 0
