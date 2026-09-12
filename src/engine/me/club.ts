import type { Rng } from '../rng'
import { contractLength, expectedSalary, marketValue, refreshValue } from '../player'
import { defaultContract, ROLES } from '../types'
import type { GameState, Player, Role, Team } from '../types'
import { squadOf } from '../roster'
import { importBlock } from '../imports'
import { releaseForHistory, signForHistory } from '../timeline'
import { autoStarters, ensureCaller } from '../world'
import { coachStarters } from './coach'
import { pushLog } from './log'

/**
 * The club around a player: who comes in, who goes, and the five on the floor.
 *
 * 破晓's team.ts and the part of its market.ts that touches the player's club,
 * on this world. Nobody in a player's save runs his club, so it does what 破晓's
 * clubs do: it keeps five besides him, renews the men it still uses before their
 * deals run out, replaces whoever leaves from the free agents at his job,
 * reinforces a job that is clearly weak once a season — never his — and lets a
 * surplus man go in the winter. A move is a move: nobody bids, lists or
 * negotiates, and no ledger or trust is written. What a club can afford is its
 * one budget, the world's (engine/budget.ts).
 *
 * The player's own moves — interest, offers, renewals, free agency — are
 * me/transfer.ts and me/contract.ts; the world beyond his club is me/market.ts.
 */

/** How many the club keeps on the books: a five, plus me. */
export const CLUB_FLOOR = 6
/** And how many at most — the registered roster. */
export const CLUB_CEILING = 7
/** A man on the bench this far under the club's rating is clearly surplus: nobody renews him, and the winter lets him go. */
const SURPLUS = 10
/** A job is clearly weak when its best man in the five is this far under the club's rating… */
const WEAK = 4
/** …and the free agent brought in for it is at least this much better than that man. */
const UPGRADE = 6

const jobsOf = (p: Player): Role[] => p.roles ?? [p.role]

/** What a club asks for a man under contract: what he is worth, and the years left on his deal. */
export function feeOf(p: Player): number {
  if (!p.teamId) return 0
  return Math.round((marketValue(p) * (1 + Math.max(0, p.contractYears) * 0.18)) / 1000) * 1000
}

/** Why this club cannot let anyone else go: five is the least a club can field. */
export function floorBlock(state: GameState, teamId: string): string | null {
  return squadOf(state, teamId).length > 5
    ? null
    : '阵容只剩五人了——再放走一个就凑不出首发，比赛只能少人上场。先补人再说。'
}

/** A club's five after its roster changed: the coach's eye at mine (me/coach.ts), the world's rule everywhere else. */
function repick(state: GameState, team: Team): void {
  if (team.id === state.myTeam && state.me?.phase === 'pro') {
    if (team.starters.length < 5 || !team.starters.every((id) => team.roster.includes(id))) {
      team.starters = coachStarters(state)
    }
  } else {
    team.starters = autoStarters(state, team.id)
  }
  ensureCaller(state, team.id)
}

/**
 * Onto a club: a contract and a wage the way the world writes them, a line in
 * his record (engine/timeline.ts signForHistory), and the five re-picked on
 * both sides.
 */
export function joinRoster(state: GameState, p: Player, team: Team, rng: Rng): void {
  const from = p.teamId ? state.teams[p.teamId] : undefined
  signForHistory(state, p, team, state.year, rng)
  p.contract = defaultContract(p.salary, p.contractYears)
  p.expiredYear = undefined
  p.grievance = 0
  refreshValue(p)
  repick(state, team)
  if (from && from.id !== team.id) repick(state, from)
}

/** Off his club: a free agent. */
export function leaveRoster(state: GameState, p: Player): void {
  const from = p.teamId ? state.teams[p.teamId] : undefined
  releaseForHistory(state, p)
  p.expiredYear = undefined
  if (from) repick(state, from)
}

/**
 * A signing at a club already carrying its registered seven: the weakest man
 * off the five is let go to make room (me/contract.ts joinClub, when I sign).
 * A club that renews whoever it still uses sits at seven more often, and a
 * player who signed on top of that made eight.
 */
export function makeRoom(state: GameState, team: Team): void {
  const me = state.me
  let guard = 0
  while (team.roster.length >= CLUB_CEILING && guard++ < 3) {
    const squad = squadOf(state, team.id).filter((p) => p.id !== me?.id)
    const bench = squad.filter((p) => !team.starters.includes(p.id))
    const out = (bench.length ? bench : squad).sort((a, b) => a.overall - b.overall)[0]
    if (!out) return
    leaveRoster(state, out)
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 与 ${out.ign} 解约，该选手成为自由人。` })
    pushLog(state, 'team', `${team.name} 和 ${out.ign} 解约，给你腾出名单位置。`)
  }
}

/** Five besides me: whoever left is replaced from the free agents, the missing job first. */
function fillSquad(state: GameState, team: Team, rng: Rng): void {
  const me = state.me!
  let guard = 0
  while (team.roster.length < CLUB_FLOOR && guard++ < 6) {
    const others = team.roster.filter((id) => id !== me.id).map((id) => state.players[id]).filter((p): p is Player => !!p)
    const have = new Set(others.flatMap(jobsOf))
    const missing = ROLES.filter((r) => r !== '自由人' && !have.has(r))
    const free = Object.values(state.players)
      .filter((p) => p.teamId === null && !p.retiring && p.id !== me.id && !importBlock(state, team.id, p))
    if (!free.length) break
    const score = (p: Player) =>
      p.overall + (p.region === team.region ? 6 : 0) + (jobsOf(p).some((r) => missing.includes(r)) ? 12 : 0)
    const target = free.sort((a, b) => score(b) - score(a))[0]
    joinRoster(state, target, team, rng)
    const line = `俱乐部签下自由人 ${target.ign}（${target.role}）补进名单。`
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 免费签下自由人 ${target.ign}。` })
    pushLog(state, 'team', line)
    me.weekNotes.push(line)
  }
}

/**
 * The club's week around me: whoever has gone — a contract the club did not
 * renew, a retirement, history — is replaced, so there are five besides me.
 * Once the winter window is open (`winter`, me/week.ts) the club also renews
 * the men it still uses before their deals run out (clubRenewals). The
 * team-mates' programme is the world's, as at every club nobody manages
 * (engine/training.ts weeklyTick).
 */
export function clubWeek(state: GameState, rng: Rng, winter = false): void {
  const me = state.me!
  const team = state.teams[state.myTeam]
  if (!team || me.phase !== 'pro') return
  fillSquad(state, team, rng)
  if (winter) clubRenewals(state, team, rng)
  if (team.starters.length < 5 || !team.starters.every((id) => team.roster.includes(id))) {
    team.starters = coachStarters(state)
  }
}

/**
 * The winter's renewals: 破晓's squad does not come apart at New Year, and
 * neither does mine.
 *
 * The world's rule (engine/season.ts endSeason) renews a man whose deal has run
 * out seven times in ten if he is within six of his club, and lets everyone
 * else go. Around a player that was most of the churn: in four careers of four
 * seasons, eight of the eleven team-mates who left walked at New Year — three
 * of them starters — and each was replaced from the free agents. So before the
 * deals run out the club renews whoever it still uses: the five, and anyone on
 * the bench who is not clearly surplus. A man who has said this season is his
 * last is let go, and replaced at his job when he goes (fillSquad).
 */
function clubRenewals(state: GameState, team: Team, rng: Rng): void {
  const me = state.me!
  const squad = squadOf(state, team.id)
  for (const p of squad) {
    // a deal with a season still to run after this one is not up yet
    if (p.id === me.id || p.retiring || p.contractYears > 1) continue
    if (!team.starters.includes(p.id) && p.overall < team.rating - SURPLUS) continue
    const years = Math.max(1, contractLength(p, rng, squad))
    // this season, then the new deal: the world takes a season off every deal when this one ends
    p.contractYears = years + 1
    p.contract = defaultContract(p.salary, p.contractYears)
    p.expiredYear = undefined
    pushLog(state, 'team', `俱乐部和 ${p.ign} 续约 ${years} 年。`)
  }
}

/**
 * A window opens and the club looks for help — 破晓's market as it touches the
 * player's club. Only a job that is clearly weak — its best man in the five
 * WEAK under the club's rating — gets a man clearly better than him, if the
 * free agents have one the club can pay; a full roster lets the weakest man in
 * that job go to make room. Once a season: it used to be every window a better
 * man was free, five signings in four careers of four seasons, each one
 * pushing somebody out sooner or later. Never my job: whether I play is
 * between me and the coach.
 */
export function clubWindow(state: GameState, rng: Rng): void {
  const me = state.me
  const team = me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!me || !team || !rng.chance(0.5) || me.flags.clubSigned === state.year) return
  const myRole = state.players[me.id]?.role
  const five = team.starters.map((id) => state.players[id]).filter((p): p is Player => !!p && p.id !== me.id)
  let need: { role: Role; strength: number } | null = null
  for (const role of ROLES) {
    if (role === '自由人' || role === myRole) continue
    const strength = five.filter((p) => jobsOf(p).includes(role)).reduce((m, p) => Math.max(m, p.overall), 0)
    if (!need || strength < need.strength) need = { role, strength }
  }
  if (!need || need.strength > team.rating - WEAK) return
  const role = need.role
  const wages = squadOf(state, team.id).reduce((s, p) => s + p.salary, 0)
  const room = team.budget - wages * 0.6
  const value = (p: Player) => p.overall + Math.max(0, p.potential - p.overall) * 0.5
  const target = Object.values(state.players)
    .filter((p) => p.teamId === null && !p.retiring && p.id !== me.id && p.role === role
      && p.overall >= need!.strength + UPGRADE && expectedSalary(p, team.tier) < Math.max(40000, room * 0.25)
      && !importBlock(state, team.id, p))
    .sort((a, b) => value(b) - value(a))[0]
  if (!target) return
  if (team.roster.length >= CLUB_CEILING) {
    const out = squadOf(state, team.id)
      .filter((p) => p.id !== me.id && jobsOf(p).includes(role))
      .sort((a, b) => a.overall - b.overall)[0]
    if (!out || floorBlock(state, team.id)) return
    leaveRoster(state, out)
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 与 ${out.ign} 解约，该选手成为自由人。` })
    pushLog(state, 'team', `俱乐部放走了 ${out.ign}，给新人腾出位置。`)
  }
  joinRoster(state, target, team, rng)
  me.flags.clubSigned = state.year
  state.news.push({ day: state.day, kind: 'transfer', important: true, text: `${team.name} 免费签下自由人 ${target.ign}（${target.overall}）。` })
  pushLog(state, 'team', `俱乐部签下自由人 ${target.ign}（${target.role}）。`)
}

/** The winter clear-out: a full bench that nobody plays lets its weakest go. */
export function clubWinter(state: GameState): void {
  const me = state.me!
  const team = state.teams[state.myTeam]
  if (!team || me.phase !== 'pro' || team.roster.length < CLUB_CEILING) return
  const bench = team.roster
    .filter((id) => id !== me.id && !team.starters.includes(id))
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
  const worst = bench.sort((a, b) => a.overall - b.overall)[0]
  if (worst && worst.overall < team.rating - SURPLUS && !floorBlock(state, team.id)) {
    leaveRoster(state, worst)
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 与 ${worst.ign} 解约，该选手成为自由人。` })
    pushLog(state, 'team', `俱乐部放走了 ${worst.ign}。`)
  }
}
