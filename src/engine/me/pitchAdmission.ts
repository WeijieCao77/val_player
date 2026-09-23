import type { GameState, Player, Team } from '../types'
import { abroadClub, expectOf, tryoutSkill } from './prepro'
import { importBlock } from '../imports'
import { hasPlace } from '../timeline'
import { expectedSalary } from '../player'
import { offerUsd } from './paytable'

const ROSTER_FULL = 7

/**
 * The self-pitched admission check, called before a selfPitched deal is
 * accepted or finalised. It reads the current rosters and returns a reason and
 * an explicit bench replacement when the target is full.
 *
 * `fee` is the buyout due in USD, supplied by contract.ts because buyoutDue
 * lives there. `salaryUsd` and `signBonusUsd` are the final offered amounts in
 * USD, when known at acceptance.
 */
export function pitchAdmission(
  state: GameState,
  team: Team,
  opts: { fee: number; salaryUsd?: number; signBonusUsd?: number }
): { reason: string | null; replaceId?: string } {
  const me = state.me
  const p = me && state.players[me.id]
  if (!me || !p || me.phase === 'retired') return { reason: '当前无法完成自荐签约。' }

  if (!team || team.dormant || !hasPlace(state, team) || team.id === state.myTeam) {
    return { reason: '这家俱乐部当前无法接收你的自荐。' }
  }

  // A malformed roster over seven cannot be repaired by one dismissal; reject.
  if (team.roster.length > ROSTER_FULL) {
    return { reason: '对方名单人数超过七人，不能解约一人后完成签约。' }
  }

  // Keep the language gate from me/selfpitch.ts pitchClubBlock for final admission.
  if (abroadClub(state, team) && !me.flags.lang) {
    return { reason: '外赛区的俱乐部要会外语才签得了。' }
  }

  // Import policy is evaluated against the current roster, never after a
  // hypothetical release (no import rule expansion).
  const importReason = importBlock(state, team.id, p)
  if (importReason) return { reason: importReason }

  const full = team.roster.length >= ROSTER_FULL
  const fee = opts.fee

  if (full) {
    const bench = team.roster
      .map((id) => state.players[id])
      .filter((x): x is Player => !!x && x.id !== me.id && x.teamId === team.id && !team.starters.includes(x.id))
      .sort((a, b) => a.overall - b.overall)

    if (bench.length === 0) {
      return { reason: '对方名单已满，没有可以替换的替补。' }
    }

    const replace = bench[0]
    if (p.overall < replace.overall + 5) {
      return { reason: '对方名单已满，你的综合实力还不足以让俱乐部为一个替补解约。' }
    }
    if (tryoutSkill(state) < expectOf(team) + 4) {
      return { reason: '对方名单已满，你的试训实力还不足以让俱乐部为一个替补解约。' }
    }

    // A full roster must also cover the fee, the final offered annual salary,
    // and the signing bonus in USD. The caller passes the actual deal terms at
    // acceptance; when absent, only the fee is checked.
    const need = fee + (opts.salaryUsd ?? offerUsd(team, state.year, expectedSalary(p, team.tier))) + (opts.signBonusUsd ?? 0)
    if (!Number.isFinite(team.budget) || team.budget <= 0 || team.budget < need) {
      return { reason: '对方预算不够支付违约金和新合同的薪水，不能完成这笔签约。' }
    }

    return { reason: null, replaceId: replace.id }
  }

  // Open roster: keep existing policy — the budget must cover the fee when
  // there is one; no additional salary check is imposed here.
  if (fee > 0 && fee > team.budget) {
    return { reason: '对方预算不够支付你的违约金。' }
  }

  return { reason: null }
}
