import RAW from '../../data/world.json'
import { createNewGame } from '../world'
import { setupSeason } from '../season'
import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS, defaultContract, emptyStats } from '../types'
import type { Attrs, GameState, Player, Region, Role } from '../types'
import { expectedSalary, recomputeOverall, refreshValue, weightsFor } from '../player'
import { AP_SEASON } from './actions'
import type { MeState } from './types'
import { beginWeek } from './week'
import { pushLog } from './log'

export const ME_ID = 'ME'
export const TALENT_POINTS = 20
export const TALENT_MAX = 8

export const NAT_DEFAULT: Record<Region, string> = { China: 'cn', Pacific: 'kr', Americas: 'us', EMEA: 'gb' }

export interface CareerOpts {
  name: string
  region: Region
  role: Role
  /** 0..TALENT_MAX per attribute, TALENT_POINTS in all */
  talents: Record<keyof Attrs, number>
  teamId?: string
  seed?: number
  age?: number
  nat?: string
}

export interface ClubChoice { id: string; name: string; tag: string; rating: number; roster: number }

/** Tier-one clubs in a region that have a seat on the bench for a rookie. */
export function candidateClubs(region: Region): ClubChoice[] {
  return RAW.teams
    .filter((t) => t.region === region && t.tier === 1)
    .map((t) => ({ id: t.id, name: t.name, tag: t.tag, rating: t.rating, roster: t.roster.length }))
    .sort((a, b) => a.rating - b.rating)
}

function pickClub(region: Region, rng: Rng): string {
  const pool = candidateClubs(region).filter((t) => t.roster <= 6)
  const list = pool.length ? pool : candidateClubs(region)
  // the weaker the club, the likelier it takes a chance on an unknown —
  // squared, so a 74 is about five times as likely as an 88
  const w = list.map((t) => Math.max(4, 100 - t.rating) ** 2)
  return rng.weighted(list, w).id
}

export function emptyTalents(): Record<keyof Attrs, number> {
  return { aim: 3, reaction: 3, awareness: 3, utility: 3, clutch: 2, teamwork: 2, communication: 2, igl: 2 }
}

/** A new career: the manager game's world, with me added to one club's bench. */
export function createCareer(o: CareerOpts): GameState {
  const seed = o.seed ?? (hashStr(o.name + o.region + o.role + String(Date.now())) >>> 0)
  const rng = new Rng(seed ^ 0x3e11)
  const teamId = o.teamId ?? pickClub(o.region, rng)
  const state = createNewGame(teamId, o.name, seed)
  // the world file is a roster book; the calendar is drawn here
  setupSeason(state)
  const team = state.teams[teamId]

  const w = weightsFor({ role: o.role })
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 2)
  const attrs = {} as Attrs
  for (const k of ATTR_KEYS) {
    attrs[k] = clamp(60 + (o.talents[k] ?? 0) * 3 + (top.includes(k) ? 3 : 0) + rng.int(-1, 1), 40, 90)
  }
  attrs.igl = Math.min(attrs.igl, 62)

  const model = Object.values(state.players).find((p) => p.role === o.role && p.region === o.region && (p.agentPool?.length ?? 0) >= 3)
    ?? Object.values(state.players).find((p) => p.role === o.role && (p.agentPool?.length ?? 0) >= 3)

  const p: Player = {
    id: ME_ID, ign: o.name, teamId, region: o.region, nat: o.nat ?? NAT_DEFAULT[o.region],
    realName: null, birth: null, ageEstimated: false,
    role: o.role, roles: [o.role], flex: false, age: o.age ?? 18,
    isIgl: false, iglSource: 'inferred',
    attrs, overall: 0, potential: 0, form: 70, morale: 75, fatigue: 10,
    salary: 0, value: 0, contractYears: 1,
    loyalty: 38, ambition: 70, trust: 62,
    agentPool: model ? [...model.agentPool] : [],
    season: emptyStats(), career: emptyStats(), injuredUntil: 0, xp: {},
    rounds: 400, joinedYear: state.year,
    clubHist: [{ team: teamId, from: state.year, to: state.year }], titles: [],
  }
  recomputeOverall(p)
  p.potential = clamp(p.overall + 14 + rng.int(0, 6), p.overall + 4, 95)
  p.salary = Math.round(expectedSalary(p, team.tier) * 0.6 / 1000) * 1000
  p.contract = { ...defaultContract(p.salary, 1), promisedRole: 'rotation', bonusShare: 8 }
  refreshValue(p)

  state.players[ME_ID] = p
  team.roster.push(ME_ID)
  state.training[ME_ID] = 'rest'
  state.startingSquad = [...team.roster]
  state.manager = undefined

  const me: MeState = {
    id: ME_ID, origin: '新人', week: 0, weekDay: 0, ap: AP_SEASON, apMax: AP_SEASON, plan: {},
    mental: 50, body: 55, tilt: 0, edge: 0, duelsThisWeek: 0, scrimRounds: 0,
    badStreak: 0, proven: false, coachTrust: 55, gmTrust: 55,
    fans: 20, heat: 10, money: 8000, log: [], matches: [], weekNotes: [], seasons: [],
    seasonStart: { year: state.year, overall: p.overall, matches: 0, starts: 0, wins: 0, acsSum: 0 },
  }
  state.me = me
  beginWeek(state)
  pushLog(state, 'info', `${state.year} 年 1 月，你以 ${p.age} 岁的年纪签进 ${team.name}，一年合同，年薪 $${p.salary.toLocaleString()}，位置是${o.role}。名单上有 ${team.roster.length} 个人，首发只有五个。`)
  return state
}
