import { Rng, hashStr } from '../rng'
import { ensureMinimumRosters } from '../season'
import { STAFF_STAMP, dateOf, staffPeople, staffStintOn } from '../staffStints'
import { lastYearOf, releaseForHistory } from '../timeline'
import type { GameState } from '../types'
import { clubWeek, leaveRoster } from './club'
import { pushLog } from './log'

/**
 * A career saved while the roster book still had coaches as players, brought up
 * to src/data/staff_stints.json once as it loads (reported 2026-09-14: Muggle,
 * EDward Gaming's coach, playing matches as one of its five).
 *
 * A save carries its own copy of every person, so the corrected book reaches the
 * seasons still to come — nobody from inside a staff stint is signed, rated or
 * kept on — and not the people a save already holds. Here each person the file
 * names leaves the player pool if, on the save's day, he is on a staff, or the
 * book no longer has him as a player in any year (he only ever stood in). A
 * player of the book in a year he is on nobody's staff stays: Reita in 2024 is
 * Murash Gaming's player, and in 2026 their coach.
 *
 * Quietly: he is not retired — no farewell card, no line in the news — he was
 * never a professional to take his leave. An AI club short of five fills the
 * seat from the free agents as the season's turn does (season.ts
 * ensureMinimumRosters), with no news line for it. At the player's own club he
 * leaves the way any team-mate leaves (me/club.ts leaveRoster), a line in 日志
 * says why, and the club signs a free agent to his seat the way it replaces
 * anyone who goes (clubWeek). Run once per change of the file (WorldState.staffSync).
 */

const ROLE_CN: Record<string, string> = {
  coach: '教练', 'head coach': '主教练', 'assistant coach': '助理教练', analyst: '分析师',
  manager: '经理', 'performance coach': '体能教练', staff: '工作人员',
}

export interface StaffMove {
  /** everyone who left the player pool, by handle */
  gone: string[]
  /** of them, the player's own team-mates */
  mine: string[]
  /** AI clubs that signed a free agent to a seat left empty */
  filled: string[]
}

/** The one-time read, or null for a save already brought up to this file. */
export function migrateStaff(state: GameState): StaffMove | null {
  if (state.staffSync === STAFF_STAMP) return null
  const me = state.me
  const today = dateOf(state.year, state.day)
  const myClub = me?.phase === 'pro' && state.myTeam ? state.myTeam : null
  const out: StaffMove = { gone: [], mine: [], filled: [] }
  const touched = new Set<string>()
  for (const vlr of staffPeople()) {
    const p = state.players[`V${vlr}`]
    if (!p || p.id === me?.id) continue
    const stint = staffStintOn(vlr, today)
    if (!stint && lastYearOf(p) !== undefined) continue
    const team = p.teamId ? state.teams[p.teamId] : undefined
    if (team && team.id === myClub) {
      leaveRoster(state, p)
      out.mine.push(p.ign)
      pushLog(state, 'team', stint
        ? `${p.ign} 在真实历史里这时是 ${stint.club} 的${ROLE_CN[stint.role] ?? '教练组成员'}，不是职业选手，已经从队伍名单上拿掉；俱乐部会从自由市场补人。`
        : `${p.ign} 在真实历史里是教练组成员，只替补上过场，不是职业选手，已经从队伍名单上拿掉；俱乐部会从自由市场补人。`)
    } else if (team) {
      releaseForHistory(state, p)
      touched.add(team.id)
    }
    if (me?.mates) delete me.mates[p.id]
    delete state.players[p.id]
    out.gone.push(p.ign)
  }
  const rng = new Rng(hashStr(`staff:${state.seed}:${state.year}:${state.day}`))
  if (touched.size) {
    const before = new Map([...touched].map((id) => [id, state.teams[id]?.roster.length ?? 0]))
    // the caller and the five are picked again there too
    ensureMinimumRosters(state, rng, touched, true)
    for (const id of touched) {
      const t = state.teams[id]
      if (!t) continue
      if (t.roster.length > (before.get(id) ?? 0)) out.filled.push(t.name)
      const top = t.roster.map((pid) => state.players[pid]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
      if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
    }
  }
  if (out.mine.length) clubWeek(state, rng)
  state.staffSync = STAFF_STAMP
  return out
}
