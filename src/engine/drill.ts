import { Rng, clamp } from './rng'
import { coachOr, squadOf } from './roster'
import { duoBonded } from './bonds'
import { analystEdge, staffBonus } from './staff'
import { AGENTS, mapCn } from './content'
import { FAM_DRILL, learnComp } from './comp'
import { sheetFor } from './match'
import { addXp, PHYSIO_COST } from './training'
import type { GameState, Player, Team } from './types'

/**
 * The manager's training ground: the squad-wide drill he confirms, the pair he
 * keeps behind, and the physio he pays for.
 *
 * All of it the manager game's, moved out of engine/training.ts, which is the
 * world's: every club's weekly practice, form, fatigue and injuries. A player's
 * career plans its own week (engine/me/growth.ts) and never runs any of this.
 */

/**
 * Two players staying behind to drill together.
 *
 * Runs alongside the main session rather than instead of it: a pair working on
 * trades does not stop the other three doing anything. It costs those two extra
 * condition, which is the trade-off.
 */
function runDuo(state: GameState, team: Team, rng: Rng): void {
  const duo = state.duo
  if (!duo) return
  const coachDev = (coachOr(team, 'development') - 55) / 100
  const facility = (team.facilities - 55) / 130
  const gain = (base: number) => base * (1 + coachDev + facility) * rng.range(0.8, 1.2)

  for (const id of [duo.a, duo.b]) {
    const p = state.players[id]
    if (!p || p.teamId !== team.id || p.injuredUntil > state.day) continue
    addXp(p, 'teamwork', gain(10))
    addXp(p, 'communication', gain(8))
    addXp(p, 'reaction', gain(5))
    p.fatigue = clamp(p.fatigue + rng.range(5, 10), 0, 100)
    p.morale = clamp(p.morale + rng.range(0, 2), 0, 100)
  }
  // the direct lever on a feud: make the two of them work together
  duoBonded(state, duo.a, duo.b, rng.range(3, 6))
}

/**
 * Run the confirmed plan once its seven days are up.
 *
 * The drill used to settle on the calendar week (day % 7) while the lock
 * lasted one turn — a single day in season. So the panel reopened every
 * morning, six days of picks were placebo, and only whatever was confirmed
 * last before the boundary counted. Now confirming starts a seven-day clock:
 * the lock IS the settlement date, the panel stays locked until it runs, and
 * tearing the plan up forfeits the progress and starts the count over.
 */
export function drillTick(state: GameState, rng: Rng, notes: string[]): void {
  if (state.drillLock == null || state.day < state.drillLock) return
  runDrill(state, rng, notes)
  state.drillLock = undefined
}

/**
 * What one settled 复盘 is worth to the IGL's 指挥, in experience.
 *
 * It was a flat 7, which at ordinary coaching is nine or ten experience — one
 * point of 指挥 every eleven weeks, for a drill whose entire reason to exist is
 * that it is the only way to train the caller. Setting the same player's
 * personal focus to 指挥 was strictly better, so the headline feature of the
 * card was the weakest thing on it. That is what got reported.
 *
 * Bigger, and shaped: a manager who has just handed the armband to somebody is
 * teaching a man his job and the obvious ground goes quickly, while a veteran
 * caller at 90 is refining and does not. So the gain rides how far the player
 * is from being a finished IGL rather than sitting flat.
 *
 * Measured: a caller in the fifties takes about two rounds a point, the
 * seventies about four, the high eighties about five, and the ceiling on the
 * curve is deliberately low enough that the fastest anyone learns is a point a
 * fortnight.
 */
const REVIEW_IGL_BASE = 36

export function reviewIglXp(state: GameState, p: Player): number {
  const rates = drillRates(state)
  const learning = clamp((90 - p.attrs.igl) / 18, 0.15, 1.5)
  return REVIEW_IGL_BASE * rates.dev * rates.review * learning
}

/**
 * What the numbers printed on the training cards get multiplied by.
 *
 * Exported because the panel has to be able to say how long something will
 * actually take, and a second copy of these three lines in the UI is how a
 * screen and its engine quietly stop agreeing. `dev` applies to every drill,
 * `review` on top of it to tape work only.
 */
export function drillRates(state: GameState): { dev: number; review: number } {
  const team = state.teams[state.myTeam]
  if (!team) return { dev: 1, review: 1 }
  const coachDev = (coachOr(team, 'development') - 55 + staffBonus(state, 'development')) / 100
  const coachTac = (coachOr(team, 'tactics') - 55 + staffBonus(state, 'tactics')) / 100
  const facility = (team.facilities - 55) / 130
  return {
    dev: 1 + coachDev + facility,
    // 复盘专家: tape work is what an analyst is for
    review: (1 + coachTac) * (1 + analystEdge(state, 'review')),
  }
}

function runDrill(state: GameState, rng: Rng, notes: string[]): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  runDuo(state, team, rng)
  const drill = state.drill
  if (!drill || drill.kind === 'none') return
  const squad = squadOf(state, state.myTeam).filter(
    (p) => p.injuredUntil <= state.day && (state.commercialDays?.[p.id] ?? 0) < 4,
  )
  if (!squad.length) return

  const rates = drillRates(state)
  const gain = (base: number) => base * rates.dev * rng.range(0.8, 1.2)

  switch (drill.kind) {
    case 'map': {
      // Running a map raises comfort on it and pulls the side together. A
      // week has room for two maps, each at the full rate: the 7-map pool
      // turns over twice a season, and one map a week could not keep up.
      // 图池分析: a map specialist makes running the map worth far more
      const mapEdge = 1 + analystEdge(state, 'maps') * 0.6
      const maps = Array.from(new Set([drill.map, drill.map2].filter((m): m is string => !!m)))
      for (const map of maps) {
        const before = team.mapPrefs[map] ?? 50
        // kept as a float: rounding every week swallowed the whole bonus, since
        // +2.0 and +2.4 both land on +2 and the remainder never carried forward
        team.mapPrefs[map] = clamp(before + gain(2.35) * mapEdge, 0, 95)
        // and the sheet planned for this map is what the week rehearses —
        // the five agents, not just the map. See engine/comp.ts.
        const fam = learnComp(state, map, sheetFor(state, state.myTeam, map).agents, FAM_DRILL)
        if (Math.round(team.mapPrefs[map]) > Math.round(before)) {
          notes.push(`🗺 ${mapCn(map)} 熟练度提升到 ${Math.round(team.mapPrefs[map])}，这套阵容熟练度 ${Math.round(fam)}。`)
        } else if (before >= 94.5) {
          notes.push(`🗺 ${mapCn(map)} 熟练度已到上限 95，继续跑图只能保持手感——换张图练吧。`)
        }
      }
      for (const p of squad) {
        addXp(p, 'teamwork', gain(9))
        addXp(p, 'awareness', gain(5))
        p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
      }
      break
    }
    case 'review': {
      // tape work is worth what the coach is worth
      for (const p of squad) {
        addXp(p, 'awareness', gain(6) * rates.review)
        // the rng lives here, so reviewIglXp is the expectation the card prints
        if (p.isIgl) addXp(p, 'igl', reviewIglXp(state, p) * rng.range(0.8, 1.2))
        addXp(p, 'communication', gain(3))
        p.fatigue = clamp(p.fatigue - rng.range(1, 4), 0, 100)
      }
      notes.push(team.coach ? `🎬 ${team.coach.name} 带队复盘，全队意识提升。` : '🎬 全队复盘录像。')
      break
    }
    case 'agent': {
      const p = state.players[drill.playerId]
      // A learner who was sold, released or retired kept being coached from
      // afar; one who is injured was coached from the treatment table. The
      // other drills all filter their squad — this one never did.
      if (!p || p.teamId !== state.myTeam) {
        state.drill = { kind: 'none' }
        notes.push('⚠️ 原定的「练新特工」对象已经不在队中，本轮团队训练没有产生效果。')
        break
      }
      if (p.injuredUntil > state.day) {
        notes.push(`⚠️ ${p.ign} 伤停中，本轮「练新特工」没有进行。`)
        break
      }
      // Learning a position is a grind, not a switch. A quick learner still
      // needs the better part of a season, which is what makes buying a real
      // specialist worth the money.
      const aptitude = 0.7 + (p.attrs.awareness + p.attrs.utility) / 400 + (p.flex ? 0.2 : 0)
      const before = p.rolePro?.[drill.role] ?? 0
      const now = clamp(before + gain(2.6) * aptitude, 0, 100)
      p.rolePro = { ...(p.rolePro ?? {}), [drill.role]: now }
      addXp(p, 'utility', gain(4))
      p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)

      // agents come in along the way, so progress is visible before it pays off
      const earned = Math.floor(now / 34) - Math.floor(before / 34)
      for (let i = 0; i < earned; i++) {
        const pool = AGENTS[drill.role].filter((a) => !p.agentPool.includes(a))
        if (pool.length) p.agentPool = [...p.agentPool, rng.pick(pool)]
      }
      if (now >= 100 && before < 100) {
        const roles = p.roles?.length ? p.roles : [p.role]
        if (!roles.includes(drill.role)) {
          p.roles = [...roles, drill.role]
          p.flex = true
        }
        notes.push(`🎓 ${p.ign} 练成了${drill.role}，现在可以兼任这个位置。`)
        state.drill = { kind: 'none' }
      }
      break
    }
    default:
      break
  }
}

/**
 * A paid physio session for one player.
 *
 * Fatigue is the whole injury model's gate, so this is the lever the players
 * asked for by name: pay a little, get condition back. It also shaves an
 * active injury — treatment shortens recovery, it does not skip it. Once a
 * week per player, because a credit card is not a medical staff.
 */
export function physioBlock(state: GameState, pid: string): string | null {
  const p = state.players[pid]
  if (!p || p.teamId !== state.myTeam) return '他不是我们的人。'
  const last = state.physioOn?.[pid]
  // a booking recorded after today is a leftover from before the calendar
  // reset — stale, not binding
  if (last !== undefined && last <= state.day && state.day - last < 7) {
    return `本周已做过理疗（${7 - (state.day - last)} 天后可再约）。`
  }
  if (state.finances.balance < PHYSIO_COST) return '资金不足。'
  return null
}

export function doPhysio(state: GameState, pid: string): string | null {
  if (physioBlock(state, pid)) return null
  const p = state.players[pid]
  state.finances.balance -= PHYSIO_COST
  state.finances.log.push({ day: state.day, label: `理疗 · ${p.ign}`, amount: -PHYSIO_COST })
  state.physioOn = { ...(state.physioOn ?? {}), [pid]: state.day }
  p.fatigue = clamp(p.fatigue - 35, 0, 100)
  if (p.injuredUntil > state.day) {
    const left = p.injuredUntil - state.day
    const cut = Math.max(2, Math.round(left * 0.3))
    p.injuredUntil = Math.max(state.day + 1, p.injuredUntil - cut)
    return `${p.ign} 完成理疗：体能恢复，伤情好转，预计提前 ${cut} 天复出。`
  }
  return `${p.ign} 完成理疗：体能大幅恢复。`
}
