import { Rng, clamp, hashStr } from './rng'
import { OPEN_TO_ALL, skillMod } from './manager'
import { squadOf } from './roster'
import type { GameState, ManagerContract, Team } from './types'

/**
 * The manager's own career, from their side of the table.
 *
 * Clubs approaching you already existed; going after a job yourself did not,
 * which left the manager oddly passive about the one contract they actually
 * own. Applying is the counterpart: you can knock on any door, but a club that
 * is happy with its season will not open it, and reaching too far above your
 * standing gets a polite no rather than a negotiation.
 */

/** What a club would pay a manager of this standing. */
export function managerSalaryFor(team: Team, reputation: number): number {
  const base = 60_000 + Math.pow(Math.max(0, team.reputation - 40), 2) * 95
  return Math.round(base * (0.75 + reputation / 200))
}

export function defaultContract(state: GameState): ManagerContract {
  const team = state.teams[state.myTeam]
  return {
    salary: team ? managerSalaryFor(team, state.manager?.reputation ?? 50) : 80_000,
    years: 2,
    since: state.year,
  }
}

/**
 * How receptive a club is to an unsolicited approach.
 *
 * Two things open a door: being better known than the job, and the job being
 * in trouble. A mid-table club having a fine season is the hardest to join,
 * because nothing is wrong and nobody is leaving.
 */
export function openness(state: GameState, team: Team): { odds: number; note: string } {
  const rep = state.manager?.reputation ?? 50
  if (team.id === state.myTeam) return { odds: 0, note: '这是你现在的战队' }

  const squad = squadOf(state, team.id)
  if (!squad.length) return { odds: 0, note: '这支战队没有可用阵容' }

  const reach = rep - team.reputation
  if (reach < -14) return { odds: 0, note: '远高于你目前的声望，不会考虑你' }

  // a club below where it should be is a club with a vacancy coming
  const table = Object.values(state.comps)
    .find((c) => c.teams?.includes(team.id) && c.region === team.region)
  const placing = table?.teams?.indexOf(team.id) ?? -1
  const size = table?.teams?.length ?? 12
  const struggling = placing >= 0 && placing >= size * 0.6

  let odds = 0.1 + reach * 0.011 + state.honours.length * 0.03
  if (struggling) odds += 0.16
  if (team.reputation <= OPEN_TO_ALL) odds += 0.12
  odds = clamp(odds * skillMod(state.manager, 'negotiation', 0.008), 0.02, 0.72)

  const note = struggling
    ? '战绩不佳，正在考虑换人'
    : reach >= 8 ? '你的声望高过这个位置，有机会'
      : reach >= -6 ? '够得着，但需要一点运气' : '偏高，希望不大'
  return { odds, note }
}

/** Send an application. The club answers in its own time. */
export function applyForJob(
  state: GameState, teamId: string, salary: number, years: number,
): string {
  const team = state.teams[teamId]
  if (!team) return '找不到这支战队。'
  if (state.jobApplications?.some((a) => a.teamId === teamId && !a.answer)) {
    return `已经在等 ${team.name} 的答复了。`
  }
  const { odds, note } = openness(state, team)
  if (odds <= 0) return `${team.name} 不会考虑你的申请：${note}。`

  const rng = new Rng(hashStr(`apply:${state.seed}:${state.day}:${teamId}`))
  state.jobApplications = [...(state.jobApplications ?? []), {
    id: `JA${state.day}_${teamId}`,
    teamId,
    day: state.day,
    replyOn: state.day + rng.int(3, 10),
    salary,
    years,
  }]
  return `已向 ${team.name} 提交执教申请，等待答复。`
}

/** Applications answered today. */
export function resolveApplications(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const a of state.jobApplications ?? []) {
    if (a.answer || a.replyOn > state.day) continue
    const team = state.teams[a.teamId]
    if (!team) { a.answer = 'reject'; continue }

    const { odds } = openness(state, team)
    // asking for more than the job is worth is its own way to be turned down
    const fair = managerSalaryFor(team, state.manager?.reputation ?? 50)
    const greed = clamp(1 - (a.salary / Math.max(1, fair) - 1) * 0.8, 0.35, 1.15)
    const ok = rng.chance(clamp(odds * greed, 0.01, 0.85))

    a.answer = ok ? 'accept' : 'reject'
    if (!ok) {
      a.reason = a.salary > fair * 1.25 ? '你要的薪资超出了他们的预算'
        : '他们决定继续信任现在的教练组'
      notes.push(`❌ ${team.name} 婉拒了你的执教申请：${a.reason}`)
    } else {
      notes.push(`✅ ${team.name} 接受了你的执教申请，你可以随时上任。`)
      state.news.push({
        day: state.day, kind: 'club', important: true,
        text: `📩 ${team.name} 同意与你签约，等待你确认。`,
      })
    }
  }
  state.jobApplications = (state.jobApplications ?? [])
    .filter((a) => !a.answer || a.replyOn > state.day - 21)
  return notes
}

/**
 * Ask your current club for a better deal.
 *
 * Leverage is results: a board that trusts you and a manager with offers on the
 * table gets a raise; one who has just been warned does not.
 */
export function renegotiate(state: GameState, salary: number, years: number): string {
  const team = state.teams[state.myTeam]
  if (!team || !state.manager) return '现在无法谈判。'
  const current = state.managerContract ?? defaultContract(state)
  const fair = managerSalaryFor(team, state.manager.reputation)

  if (salary <= current.salary) {
    state.managerContract = { salary, years, since: state.year }
    return '合同已更新。'
  }
  const rng = new Rng(hashStr(`renew:${state.seed}:${state.day}:${state.myTeam}`))
  const ask = salary / Math.max(1, fair)
  let odds = 0.5 - (ask - 1) * 1.1 + (state.boardConfidence - 55) * 0.008
  odds += (state.jobOffers?.length ?? 0) * 0.14      // other clubs want you
  odds += state.honours.length * 0.04
  if (state.onNotice) odds -= 0.45
  odds = clamp(odds * skillMod(state.manager, 'negotiation', 0.01), 0.02, 0.92)

  if (!rng.chance(odds)) {
    return state.onNotice
      ? '董事会刚刚警告过你，现在不是谈涨薪的时候。'
      : '董事会拒绝了这个数字，先拿出成绩再谈。'
  }
  state.managerContract = { salary, years, since: state.year }
  state.news.push({
    day: state.day, kind: 'club', important: false,
    text: `${team.name} 与经理续约 ${years} 年。`,
  })
  return `谈成了：年薪 ${Math.round(salary / 1000)}K，${years} 年。`
}

/** Take up a job whose application was accepted. */
export function takeAcceptedJob(state: GameState, applicationId: string): string {
  const a = state.jobApplications?.find((x) => x.id === applicationId)
  if (!a || a.answer !== 'accept') return '这份工作已经不在了。'
  const salary = a.salary
  const years = a.years
  const msg = moveToClub(state, a.teamId)
  // the terms you asked for are the terms you get
  state.managerContract = { salary, years, since: state.year }
  return msg
}

/**
 * Clubs coming after the manager.
 *
 * This is the reward for a career going well, and the only route to the jobs
 * that were locked at creation: reputation earned by winning opens doors that
 * choosing never could. Asked as each stage opens (engine/managerDesk.ts).
 */
export function offerJobs(state: GameState, notes: string[]): void {
  const m = state.manager
  if (!m || state.gameOver) return
  state.jobOffers = (state.jobOffers ?? []).filter((o) => o.expiresOn > state.day)

  // a club will not poach a manager their own board just warned
  if (state.onNotice) return
  const rng = new Rng(hashStr(`jobs:${state.seed}:${state.year}:${state.day}`))
  const here = state.teams[state.myTeam]
  if (!here) return

  const candidates = Object.values(state.teams).sort((a, b) => b.reputation - a.reputation)
  for (const t of candidates) {
    if (state.jobOffers.length >= 3) break     // an inbox, not a spreadsheet
    if (t.id === state.myTeam) continue
    if (t.reputation <= here.reputation) continue          // no sideways moves
    if (state.jobOffers.some((o) => o.teamId === t.id)) continue
    // they want someone they can justify hiring
    const reach = m.reputation - t.reputation
    if (reach < -6) continue
    const chance = clamp(0.04 + reach * 0.01 + state.honours.length * 0.015, 0, 0.3)
    if (!rng.chance(chance)) continue

    state.jobOffers.push({
      id: `J${t.id}_${state.day}`,
      teamId: t.id,
      day: state.day,
      expiresOn: state.day + 30,
      pitch: t.tier === 1
        ? `${t.name} 希望你接手一队，预算 ${Math.round(t.budget / 10000) / 100} 千万级别。`
        : `${t.name} 想请你来重建队伍。`,
    })
    notes.push(`📩 ${t.name} 向你发出了执教邀请。`)
    state.news.push({
      day: state.day, kind: 'club', important: true,
      text: `📩 ${t.name} 向你发出执教邀请（声望 ${t.reputation}）。`,
    })
  }
}

/** Take a job elsewhere. The career continues; the club does not. */
export function acceptJob(state: GameState, offerId: string): string {
  const offer = state.jobOffers?.find((o) => o.id === offerId)
  const to = offer ? state.teams[offer.teamId] : null
  if (!offer || !to) return '这份邀请已经失效。'
  return moveToClub(state, to.id)
}

/** Take over at another club, however the job came about. */
export function moveToClub(state: GameState, teamId: string): string {
  const to = state.teams[teamId]
  if (!to) return '找不到这支战队。'

  const from = state.teams[state.myTeam]
  state.tenures ??= []
  const current = state.tenures.find((t) => t.teamId === state.myTeam && !t.toYear)
  if (current) current.toYear = state.year
  else state.tenures.push({ teamId: state.myTeam, fromYear: 2026, toYear: state.year })
  state.tenures.push({ teamId: to.id, fromYear: state.year })

  state.myTeam = to.id
  state.startFacilities = to.facilities
  state.startTier = to.tier
  // The squad you inherited is the squad you inherited HERE. Left pointing at
  // the old club's roster, every badge and ending built on it went wrong the
  // moment you changed jobs: 「大换血」 and 「推倒重来」 fired for free because
  // nobody on the new team was on that list, and 「一起走到最后」 became
  // impossible for the same reason.
  state.startingSquad = [...to.roster]
  // a new squad, and their development starts being yours from today — the
  // stars you walked in on are not something you built
  for (const id of to.roster) {
    const p = state.players[id]
    if (p) p.arrivedOverall = p.overall
  }
  state.jobOffers = []
  state.jobApplications = []
  state.managerContract = undefined
  state.boardConfidence = 62
  state.onNotice = false
  state.missedStreak = 0
  state.objective = undefined
  state.finances = { balance: to.budget, log: [] }
  state.training = {}
  state.drill = { kind: 'none' }
  // ...and everything else that belonged to the old job. A drill lock left
  // running greyed out the new club's training panel for up to a week; a pair
  // drill kept coaching two players who now work somewhere else; and a bid
  // left pending settled later at the OLD club, spending the new club's money
  // to sign a player for the one you just left.
  state.drillLock = undefined
  state.duo = undefined
  state.physioOn = {}
  state.commercialDays = {}
  for (const o of state.offers) {
    if (o.status === 'pending' && (o.toTeam === from?.id || o.fromTeam === from?.id)) {
      o.status = 'rejected'
    }
  }
  state.enquiries = []
  for (const pid of to.roster) state.training[pid] = 'rest'

  state.managerContract = defaultContract(state)
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: `你离开 ${from?.name} 出任 ${to.name} 的经理。`,
  })
  return `你已就任 ${to.name} 的经理。`
}
