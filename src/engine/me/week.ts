import { Rng, clamp, hashStr } from '../rng'
import { advanceDay, continuePastFive } from '../season'
import { contractLength, expectedSalary } from '../player'
import { ROLES } from '../types'
import type { Player } from '../types'
import { coachStarters, refreshMyRounds, runDuel, weeklyLineup } from './coach'
import type { Fixture, GameState } from '../types'
import { ACTION_BY_KEY, AP_HURT, AP_SEASON, DUELS_PER_WEEK } from './actions'
import type { MeAction } from './types'
import { primaryFocus, settleTraining } from './growth'
import type { DuelResult } from './coach'
import { MeMatch } from './matchplay'
import { pushLog } from './log'

export type WeekStop =
  | { kind: 'match'; fixture: Fixture }
  | { kind: 'week-end' }
  | { kind: 'game-over' }

export function apFor(state: GameState): number {
  const p = state.players[state.me!.id]
  return p && p.injuredUntil > state.day ? AP_HURT : AP_SEASON
}

/** The week opens: the coach names his five, the duel count resets. */
export function beginWeek(state: GameState): void {
  const me = state.me!
  me.duelsThisWeek = 0
  weeklyLineup(state)
}

/** Put a point on (or take one off) an action. Returns a reason when it cannot be done. */
export function setPlan(state: GameState, action: MeAction, delta: 1 | -1): string | null {
  const me = state.me!
  const def = ACTION_BY_KEY[action]
  const cur = me.plan[action] ?? 0
  if (delta < 0) {
    if (cur <= 0) return null
    me.plan[action] = cur - 1
    me.ap += def.cost
    return null
  }
  if (action === 'duel') return '对位挑战是当场打的，用下面的按钮。'
  if (me.ap < def.cost) return '行动点不够了。'
  me.plan[action] = cur + 1
  me.ap -= def.cost
  return null
}

/** A practice duel happens now, not at the settlement. */
export function doDuel(state: GameState): DuelResult | string {
  const me = state.me!
  const def = ACTION_BY_KEY.duel
  const team = state.teams[state.myTeam]
  if (team.starters.includes(me.id)) return '你已经是首发了，不用挑战谁。'
  if (me.trial) return '你正在试用期，先把正赛打好。'
  if (me.benchLock && me.benchLock > state.day) return `教练两周内不会再看你（还有 ${me.benchLock - state.day} 天）。`
  if (me.duelsThisWeek >= DUELS_PER_WEEK) return `每周最多 ${DUELS_PER_WEEK} 次对位挑战。`
  if (me.ap < def.cost) return '行动点不够了。'
  const rng = new Rng(hashStr(`duel:${state.seed}:${state.year}:${state.day}:${me.duelsThisWeek}`))
  const r = runDuel(state, rng)
  if (!r) return '现在没有可以挑战的首发。'
  me.ap -= def.cost
  me.plan.duel = (me.plan.duel ?? 0) + 1
  return r
}

const sacked = (s: string) => s.includes('解除你的职务')

/**
 * Seven days, or until my club's next match. A player has no board: the
 * manager game's dismissal cannot apply to him, so a sacking is undone on
 * the spot and the confidence that drives it is kept off the floor.
 */
export function advanceWeek(state: GameState): WeekStop {
  const me = state.me!
  const p = state.players[me.id]
  // a match the week stopped on that nobody played: play it the steady way
  if (me.pendingFixture) {
    const f = state.fixtures.find((x) => x.id === me.pendingFixture)
    if (f && !f.played) new MeMatch(state, f).runOut()
    me.pendingFixture = undefined
  }
  if (me.weekDay === 0) {
    state.training[me.id] = primaryFocus(me, p)
    // last week's digest made way for this week's
    me.weekNotes = []
  }
  while (me.weekDay < 7) {
    if (state.midReview) continuePastFive(state)
    const yearBefore = state.year
    const r = advanceDay(state, { deferMine: true, autoScrims: true, autoResolveDrawDecisions: true })
    me.weekDay++
    for (const n of r.notes) if (keep(n)) me.weekNotes.push(n)
    if (state.gameOver && sacked(state.gameOver)) {
      state.gameOver = undefined
      state.onNotice = false
      state.missedStreak = 0
      state.boardConfidence = 55
    }
    if (r.seasonEnded || state.year !== yearBefore) onSeasonEnd(state, yearBefore)
    if (state.gameOver) return { kind: 'game-over' }
    if (r.pendingMine) {
      me.pendingFixture = r.pendingMine.id
      return { kind: 'match', fixture: r.pendingMine }
    }
  }
  settleWeek(state)
  return { kind: 'week-end' }
}

/** engine digest lines worth showing a player; the manager's paperwork is not */
function keep(n: string): boolean {
  if (/董事会|行动力|赞助|商务|联盟|捆绑|报价|问价|教练组|分析师|申请|工作邀请|设施/.test(n)) return false
  return true
}

export function settleWeek(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  const rng = new Rng(hashStr(`me:${state.seed}:${state.year}:${state.day}`))
  const notes: string[] = []
  settleTraining(state, rng, notes)

  // pay, then fans: what people do all week feeds the heat, the heat feeds
  // the following — and the following only climbs toward what results allow
  me.money += Math.round(p.salary / 52)
  const s = me.seasonStart
  const cap = 120 + s.starts * 8 + s.wins * 6 + state.honours.filter((h) => h.year >= state.year - 1).length * 400
  const rate = 0.012 + clamp(me.heat / 900, 0, 0.045)
  const gap = cap - me.fans
  me.fans = Math.max(0, me.fans + gap * (gap > 0 ? rate : 0.02))
  me.heat = Math.max(0, me.heat * 0.9)

  // the coach's regard settles back toward neutral; a substitute he never sees drifts down
  me.coachTrust = clamp(me.coachTrust + (60 - me.coachTrust) * 0.03, 0, 100)
  const starter = state.teams[state.myTeam].starters.includes(me.id)
  if (!starter && !(me.plan.scrim ?? 0) && !(me.plan.duel ?? 0)) me.coachTrust = clamp(me.coachTrust - 1, 0, 100)
  if (me.benchLock && me.benchLock <= state.day) me.benchLock = undefined

  // a player has no board behind him
  state.boardConfidence = Math.max(state.boardConfidence, 45)
  state.onNotice = false
  state.jobOffers = []

  clubUpkeep(state, rng)
  for (const n of notes) me.weekNotes.push(n)
  me.week++
  me.weekDay = 0
  me.plan = {}
  me.duoWith = undefined
  me.ap = apFor(state)
  me.apMax = me.ap
  refreshMyRounds(state)
  beginWeek(state)
}

/** The winter: my season on the record, and the contract question answered for now. */
function onSeasonEnd(state: GameState, year: number): void {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  const s = me.seasonStart
  const titles = state.honours.filter((h) => h.year === year).map((h) => h.title)
  me.seasons.push({
    year, team: team?.name ?? '?', matches: s.matches, starts: s.starts, wins: s.wins,
    acs: s.starts ? Math.round(s.acsSum / s.starts) : 0,
    overallFrom: s.overall, overallTo: p.overall, titles,
  })
  pushLog(state, 'season', `${year} 赛季结束：出场 ${s.starts}/${s.matches}，首发胜 ${s.wins} 场，综合 ${s.overall} → ${p.overall}${titles.length ? `，随队夺得 ${titles.join('、')}` : ''}。`)
  me.seasonStart = { year: state.year, overall: p.overall, matches: 0, starts: 0, wins: 0, acsSum: 0 }

  if (p.teamId === state.myTeam && (p.expiredYear != null || p.contractYears <= 0)) {
    const years = me.proven ? 2 : 1
    const salary = Math.round(expectedSalary(p, team.tier) * (me.proven ? 0.9 : 0.7) / 1000) * 1000
    p.contractYears = years
    p.expiredYear = undefined
    p.salary = salary
    if (p.contract) { p.contract.salary = salary; p.contract.years = years; p.contract.promisedRole = me.proven ? 'starter' : 'rotation' }
    pushLog(state, 'money', `合同到期，俱乐部续了 ${years} 年，年薪 $${salary.toLocaleString()}。（合同谈判在这个 demo 里还是自动的）`)
  }
  // scrimmage rounds the coach saw last year are last year's news
  me.scrimRounds = Math.round(me.scrimRounds * 0.5)
  clubUpkeep(state, new Rng(hashStr(`gm:${state.seed}:${state.year}`)))
}

/** how many the club keeps on the books: a five, plus me */
const CLUB_FLOOR = 6

/**
 * The general manager the engine gives every AI club, done for mine.
 *
 * ensureMinimumRosters skips the human's club because in the manager game
 * signing is the human's job. Here it is nobody's, so when a contract runs out
 * or a man retires the club refills from the free-agent pool the way its
 * rivals do — the missing job first, then the best available.
 */
export function clubUpkeep(state: GameState, rng: Rng): void {
  const me = state.me!
  const team = state.teams[state.myTeam]
  if (!team) return
  let guard = 0
  while (team.roster.length < CLUB_FLOOR && guard++ < 6) {
    const others = team.roster.filter((id) => id !== me.id).map((id) => state.players[id]).filter((p): p is Player => !!p)
    const have = new Set(others.flatMap((p) => p.roles ?? [p.role]))
    const missing = ROLES.filter((r) => r !== '自由人' && !have.has(r))
    const free = Object.values(state.players).filter((p) => p.teamId === null && !p.retiring && p.id !== me.id)
    if (!free.length) break
    const score = (p: Player) =>
      p.overall + (p.region === team.region ? 6 : 0) +
      ((p.roles ?? [p.role]).some((r) => missing.includes(r)) ? 12 : 0)
    const target = free.sort((a, b) => score(b) - score(a))[0]
    target.teamId = team.id
    target.contractYears = contractLength(target, rng, others)
    target.salary = expectedSalary(target, team.tier)
    target.joinedYear = state.year
    team.roster.push(target.id)
    const line = `俱乐部签下自由人 ${target.ign}（${target.role} ${target.overall}）补进名单。`
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 免费签下自由人 ${target.ign}（${target.overall}）。` })
    pushLog(state, 'team', line)
    me.weekNotes.push(line)
  }
  if (team.starters.length < 5 || !team.starters.every((id) => team.roster.includes(id))) {
    team.starters = coachStarters(state)
  }
}
