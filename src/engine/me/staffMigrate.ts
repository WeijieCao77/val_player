import { REMOVED_STAMP, removedPlayerIds, scrubNames } from '../removedPlayers'
import { Rng, hashStr } from '../rng'
import { ensureMinimumRosters } from '../season'
import { STAFF_STAMP, dateOf, offPoolOn, staffPeople, staffPersonOf, staffStintOn } from '../staffStints'
import { releaseForHistory } from '../timeline'
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
 * names leaves the player pool if, on the save's day, he is off it — he never
 * played professionally at all, he had already gone to a staff for good, or a
 * stint of his covers the day (engine/staffStints.ts offPoolOn, the one
 * predicate every path asks). A player of the book on a day he is none of those
 * stays: Reita in 2024 is Murash Gaming's player, and in 2026 their coach.
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
    if (!offPoolOn(vlr, today)) continue
    const stint = staffStintOn(vlr, today)
    const team = p.teamId ? state.teams[p.teamId] : undefined
    if (team && team.id === myClub) {
      leaveRoster(state, p)
      out.mine.push(p.ign)
      pushLog(state, 'team', stint
        ? `${p.ign} 在真实历史里这时是 ${stint.club} 的${ROLE_CN[stint.role] ?? '教练组成员'}，不是职业选手，已经从队伍名单上拿掉；俱乐部会从自由市场补人。`
        : staffPersonOf(vlr)?.played
          ? `${p.ign} 在真实历史里这时已经转做教练，不再是职业选手，已经从队伍名单上拿掉；俱乐部会从自由市场补人。`
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

export interface RemovedMove {
  /** everyone who left the player pool, by handle */
  gone: string[]
  /** of them, the player's own team-mates */
  mine: string[]
  /** AI clubs that signed a free agent to a seat left empty */
  filled: string[]
  /** strings in the save's records that named one of them, now REMOVED_LABEL */
  renamed: number
  /** news items and log lines about one of them, let go */
  dropped: number
}

/**
 * A career saved while the game still had a man the author has since taken out of it
 * (src/data/removed_players.json, engine/removedPlayers.ts; decided 2026-09-25), brought up to
 * the list once as it loads.
 *
 * The way migrateStaff takes a coach out of the pool, and more quietly still: he is not
 * retired — no farewell card, no line in the news — and nothing says who he was. An AI club
 * that loses him fills the seat from the free agents the way the season's turn does
 * (season.ts ensureMinimumRosters, quiet), and the caller and the five are picked again there.
 * At the player's own club he leaves the way any team-mate leaves (me/club.ts leaveRoster), one
 * line in 日志 says a seat has come free, and the club signs a free agent to it (clubWeek).
 *
 * What he was in the save besides a player goes with him: his place in the bonds, training,
 * map sheets, a practice duel against him, the book's signings still to come to my club. What
 * the save remembers — box scores, trophy rosters, awards, career moments — keeps its shape and
 * says REMOVED_LABEL where it named him; a news item or a log line about him is let go. Run once
 * per change of the list (WorldState.removedSync).
 */
export function migrateRemoved(state: GameState): RemovedMove | null {
  if (state.removedSync === REMOVED_STAMP) return null
  const me = state.me
  const myClub = me?.phase === 'pro' && state.myTeam ? state.myTeam : null
  const out: RemovedMove = { gone: [], mine: [], filled: [], renamed: 0, dropped: 0 }
  const ids = new Set(removedPlayerIds().filter((id) => id !== me?.id))
  const touched = new Set<string>()
  let mineLeft = false
  for (const id of ids) {
    const p = state.players[id]
    if (!p) continue
    const team = p.teamId ? state.teams[p.teamId] : undefined
    if (team && team.id === myClub) {
      leaveRoster(state, p)
      out.mine.push(p.ign)
      mineLeft = true
    } else if (team) {
      releaseForHistory(state, p)
      touched.add(team.id)
    }
    delete state.players[id]
    out.gone.push(p.ign)
  }
  // a club that still names him — on a roster, in the five, as its caller — without the man himself
  for (const t of Object.values(state.teams)) {
    const had = t.roster.some((id) => ids.has(id)) || t.starters.some((id) => ids.has(id)) || (!!t.igl && ids.has(t.igl))
    if (!had) continue
    t.roster = t.roster.filter((id) => !ids.has(id))
    t.starters = t.starters.filter((id) => !ids.has(id))
    if (t.igl && ids.has(t.igl)) t.igl = null
    if (t.id === myClub) mineLeft = true
    else touched.add(t.id)
  }
  // what he was to the rest of the save, by his id
  const pairOf = (k: string) => k.split('|').some((x) => ids.has(x))
  for (const m of [state.bonds, state.feudSaid, state.argueSaid]) {
    if (m) for (const k of Object.keys(m)) if (pairOf(k)) delete m[k]
  }
  for (const id of ids) delete state.training?.[id]
  for (const sheet of [...Object.values(state.mapAgents ?? {}), ...Object.values(state.agentPicks ?? {})]) {
    for (const id of ids) delete sheet[id]
  }
  if (state.retireFeed) state.retireFeed = state.retireFeed.filter((r) => !ids.has(r.id))
  if (me) {
    for (const id of ids) delete me.mates?.[id]
    if (me.clubDepartures) me.clubDepartures = me.clubDepartures.filter((d) => !ids.has(d.playerId))
    if (me.historyArrivals) me.historyArrivals.ids = me.historyArrivals.ids.filter((id) => !ids.has(id))
    if (me.historyArrivals?.rot?.sub && ids.has(me.historyArrivals.rot.sub)) me.historyArrivals.rot.sub = null
    if (me.mateHurt) me.mateHurt.ids = me.mateHurt.ids.filter((id) => !ids.has(id))
    if (me.duelLive && ids.has(me.duelLive.himId)) me.duelLive = undefined
  }
  // what the save remembers: his handle out of every record, and the news and log lines about him gone
  const named = scrubNames(state, [state.news, me?.log])
  out.renamed = named.renamed
  out.dropped = named.dropped
  const rng = new Rng(hashStr(`removed:${state.seed}:${state.year}:${state.day}`))
  if (touched.size) {
    const before = new Map([...touched].map((id) => [id, state.teams[id]?.roster.length ?? 0]))
    ensureMinimumRosters(state, rng, touched, true)
    for (const id of touched) {
      const t = state.teams[id]
      if (!t) continue
      if (t.roster.length > (before.get(id) ?? 0)) out.filled.push(t.name)
      const top = t.roster.map((pid) => state.players[pid]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
      if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
    }
  }
  if (mineLeft && myClub) {
    pushLog(state, 'team', '队伍名单上空出一个位置：一名队友已从游戏中移出。俱乐部会从自由市场补人。')
    clubWeek(state, rng)
  }
  state.removedSync = REMOVED_STAMP
  return out
}
