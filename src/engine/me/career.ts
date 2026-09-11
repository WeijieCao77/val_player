import RAW from '../../data/world.json'
import RAW_2021 from '../../data/world_2021.json'
import { createNewGame } from '../world'
import { bookClubsAt, openWorldAt } from '../timeline'
import { realName } from '../names'
import { arrive2026 } from '../today'
import { setupSeason } from '../season'
import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS, emptyStats } from '../types'
import type { Attrs, GameState, Player, Region, Role } from '../types'
import { recomputeOverall, refreshValue, weightsFor } from '../player'
import { AP_SEASON } from './actions'
import { AP_PRE } from './prepro'
import type { MeState } from './types'
import { beginWeek } from './week'
import { pushLog } from './log'
import { originOf } from './origins'
import { makeDeal, joinClub } from './contract'
import { onTimeline, regionIn, stageNameIn } from '../era'
import type { EntryYear } from '../era'
import { initLedger } from './money'
import { ensureCeilings } from './bottleneck'
import { cupFor } from './cups'

export const ME_ID = 'ME'
export const TALENT_POINTS = 20
export const TALENT_MAX = 8

/**
 * Where a player from this region is assumed to be from, when nothing better
 * is known. The historical regions are single countries, so most of these are
 * exact rather than a guess.
 */
export const NAT_DEFAULT: Record<Region, string> = {
  China: 'cn', Pacific: 'kr', Americas: 'us', EMEA: 'gb',
  'North America': 'us', Europe: 'gb', Turkey: 'tr', CIS: 'ru',
  Brazil: 'br', LATAM: 'ar', Korea: 'kr', Japan: 'jp', SEA: 'sg',
  'Malaysia & Singapore': 'my', Indonesia: 'id', Thailand: 'th',
  Philippines: 'ph', Vietnam: 'vn', 'Hong Kong & Taiwan': 'tw',
  MENA: 'sa', 'South Asia': 'in', Oceania: 'au',
}

export type StartPoint = 'pre' | 'chal' | 't1'
export const START_CN: Record<StartPoint, { name: string; blurb: string }> = {
  pre: { name: '从天梯开始', blurb: '17 岁，没有队伍。排位、杯赛、试训，先拿到第一份合同。最长的路，也是完整的路。' },
  chal: { name: 'Challengers 青训', blurb: '18 岁，一支二级联赛俱乐部的首发。Ascension 升级，或者被一级俱乐部挖走。' },
  t1: { name: 'VCT 替补', blurb: '18 岁，一级俱乐部的第六人。名单上有你，首发没有。' },
}

/** 2021 had no leagues and no academies to start in: the same three doors, as they were then. */
export const START_CN_2021: Record<StartPoint, { name: string; blurb: string }> = {
  pre: { name: '从天梯开始', blurb: '17 岁，没有队伍。2021 年没有联赛也没有青训体系：排位、网吧赛、试训——哪家俱乐部看上你，哪家就给你合同。' },
  chal: { name: '二线队首发', blurb: '18 岁，一支还没打出名堂的俱乐部的首发。开放海选一场场打上去，打进赛区决赛才有人记住你。' },
  t1: { name: '强队替补', blurb: '18 岁，一支打进过赛区决赛的俱乐部的第六人。名单上有你，首发没有。' },
}

export const startCnOf = (year: number): Record<StartPoint, { name: string; blurb: string }> =>
  (year <= 2021 ? START_CN_2021 : START_CN)

export interface CareerOpts {
  name: string
  region: Region
  role: Role
  /** 0..TALENT_MAX per attribute, TALENT_POINTS in all */
  talents: Record<keyof Attrs, number>
  originKey: string
  start: StartPoint
  teamId?: string
  seed?: number
  nat?: string
  /** where on the one timeline the career begins — 2021 or 2026, see engine/era.ts */
  year?: EntryYear
}

export interface ClubChoice { id: string; name: string; tag: string; rating: number; roster: number; tier: number }

/** Clubs in a region, by tier. */
type BookClub = { id: string; name: string; tag: string; region: string; tier: number; rating: number; roster: string[] }

export function candidateClubs(region: Region, tier: 1 | 2, year = 2026): ClubChoice[] {
  // 2026 opens on the one timeline: its clubs are the roster book's, as 2026 really opened
  if (year >= 2026) {
    return bookClubsAt(year).filter((t) => t.region === region && t.tier === tier)
      .map((t) => ({ id: t.id, name: t.name, tag: t.tag, rating: t.rating, roster: t.roster, tier: t.tier }))
      .sort((a, b) => a.rating - b.rating)
  }
  return ((year <= 2021 ? RAW_2021.teams : RAW.teams) as BookClub[])
    .filter((t) => t.region === region && t.tier === tier)
    .map((t) => {
      // world_2021.json has vlr's names of today; January 2021 had its own (engine/names.ts)
      const real = year <= 2021 ? realName(t.id.replace(/^V21T/, ''), 2021, 0) : null
      return { id: t.id, name: real?.name ?? t.name, tag: real?.tag ?? t.tag, rating: t.rating, roster: t.roster.length, tier: t.tier }
    })
    .sort((a, b) => a.rating - b.rating)
}

/** The regions a career can open in that year: the ones its world has clubs in, busiest first. */
export function careerRegions(year: number): Region[] {
  if (year < 2026) return []
  const count = new Map<Region, number>()
  for (const t of bookClubsAt(year)) count.set(t.region, (count.get(t.region) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r)
}

/**
 * 2026's world, on the one timeline: 2021's roster book brought up to 2026 as it
 * really opened (engine/timeline.ts openWorldAt), with the coaches and the
 * professionals below the leagues that 2026's own files know of (engine/today.ts).
 */
function createWorldAt(teamId: string, name: string, seed: number, year: number): GameState {
  const state = createNewGame((RAW_2021.teams as BookClub[])[0].id, name, seed, undefined, 2021)
  // nobody's club yet: history moves every club while the world is brought up
  state.myTeam = ''
  openWorldAt(state, year)
  if (year === 2026) arrive2026(state, [])
  state.news = []
  state.training = {}
  state.myTeam = teamId
  const club = state.teams[teamId]
  state.finances = { balance: club?.budget ?? 0, log: [] }
  state.startingSquad = [...(club?.roster ?? [])]
  state.startTier = club?.tier
  state.startFacilities = club?.facilities
  return state
}

function pickClub(region: Region, tier: 1 | 2, rng: Rng, year = 2026): string {
  const pool = candidateClubs(region, tier, year).filter((t) => t.roster <= 6)
  const list = pool.length ? pool : candidateClubs(region, tier, year)
  // China's second tier plays its first event of 2026 in the summer: on New Year's Day there is no such club to sign for
  if (!list.length) throw new Error(`${year} 年开季时 ${region} 没有${tier === 1 ? '一线' : '二线'}俱乐部可以签`)
  // the weaker the club, the likelier it takes a chance on an unknown —
  // squared, so a 74 is about five times as likely as an 88
  const w = list.map((t) => Math.max(4, 100 - t.rating) ** 2)
  return rng.weighted(list, w).id
}

export function emptyTalents(): Record<keyof Attrs, number> {
  return { aim: 3, reaction: 3, awareness: 3, utility: 3, clutch: 2, teamwork: 2, communication: 2, igl: 2 }
}

/** The eight, the way the new-career screen previews them. */
export function buildAttrs(role: Role, talents: Record<keyof Attrs, number>, originKey: string, rng?: Rng): Attrs {
  const w = weightsFor({ role })
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 2)
  const o = originOf(originKey)
  const attrs = {} as Attrs
  for (const k of ATTR_KEYS) {
    // 52, not 58: a fresh player starts a clear step under every club's bar
    // and has to climb to it, the way 破晓 opens — see prepro.expectOf
    attrs[k] = clamp(52 + (talents[k] ?? 0) * 3 + (top.includes(k) ? 3 : 0) + (o.attrs?.[k] ?? 0) + (rng ? rng.int(-1, 1) : 0), 40, 90)
  }
  attrs.igl = Math.min(attrs.igl, 62)
  return attrs
}

/** A new career: the manager game's world, with me in it. */
export function createCareer(o: CareerOpts): GameState {
  const seed = o.seed ?? (hashStr(o.name + o.region + o.role + o.originKey + String(Date.now())) >>> 0)
  const rng = new Rng(seed ^ 0x3e11)
  const origin = originOf(o.originKey)
  const clubTier: 1 | 2 = o.start === 't1' ? 1 : 2
  const year = o.year ?? 2026
  // a league's name is not a place a club is based: in 2026's world a career asked to open in
  // 「Pacific」 opens in the busiest real region the Pacific league draws on
  const region = year >= 2026 && !careerRegions(year).includes(o.region)
    ? careerRegions(year).find((r) => regionIn(r, year) === o.region) ?? o.region
    : o.region
  const teamId = o.start === 'pre'
    ? candidateClubs(region, 2, year)[0]?.id ?? candidateClubs(region, 1, year)[0].id   // a club to watch until I have one
    : (o.teamId ?? pickClub(region, clubTier, rng, year))
  const state = year >= 2026 ? createWorldAt(teamId, o.name, seed, year) : createNewGame(teamId, o.name, seed, undefined, year)
  // the world file is a roster book; the calendar is drawn here
  setupSeason(state)

  const attrs = buildAttrs(o.role, o.talents, o.originKey, rng)
  const model = Object.values(state.players).find((p) => p.role === o.role && p.region === region && (p.agentPool?.length ?? 0) >= 3)
    ?? Object.values(state.players).find((p) => p.role === o.role && (p.agentPool?.length ?? 0) >= 3)
  const age = origin.flags?.late ? 20 : o.start === 'pre' ? 17 : 18

  const p: Player = {
    id: ME_ID, ign: o.name, teamId: null, region: region, nat: o.nat ?? NAT_DEFAULT[region],
    realName: null, birth: null, ageEstimated: false,
    role: o.role, roles: [o.role], flex: false, age,
    isIgl: false, iglSource: 'inferred',
    attrs, overall: 0, potential: 0, form: 70, morale: 75, fatigue: 10,
    salary: 0, value: 0, contractYears: 0,
    loyalty: 38, ambition: 70, trust: 62,
    agentPool: model ? [...model.agentPool] : [],
    season: emptyStats(), career: emptyStats(), injuredUntil: 0, xp: {},
    rounds: o.start === 'pre' ? 150 : 400, joinedYear: state.year,
    clubHist: [], titles: [],
  }
  recomputeOverall(p)
  const head = origin.flags?.late ? 10 : 14
  p.potential = clamp(p.overall + head + rng.int(0, 6), p.overall + 4, 95)
  p.salary = 0
  refreshValue(p)
  state.players[ME_ID] = p
  state.manager = undefined

  const me: MeState = {
    id: ME_ID, originKey: o.originKey, phase: 'pre', week: 0, weekDay: 0, ap: AP_PRE, apMax: AP_PRE, plan: {},
    mental: clamp(50 + (origin.mental ?? 0), 0, 100), body: clamp(55 + (origin.body ?? 0), 0, 100), tilt: 0,
    edge: 0, duelsThisWeek: 0, scrimRounds: 0, badStreak: 0, proven: false, coachTrust: 50, gmTrust: 50,
    fans: Math.max(0, 20 + (origin.fans ?? 0)), heat: 10, money: 3000 + (origin.money ?? 0), upkeep: origin.upkeep ?? 0,
    log: [], matches: [], weekNotes: [], pending: [], seasons: [],
    seasonStart: { year: state.year, overall: p.overall, matches: 0, starts: 0, wins: 0, acsSum: 0 },
    benchedStages: 0, startedThisStage: 0, playedThisStage: 0,
    pre: { year: 1, ladder: 0, ladderPeak: 0, cups: [], scoutSeen: origin.scoutSeen ?? 0, invites: [], seen: [], tac: origin.tac ?? 0, mates: [], wasPro: false },
    deals: [], intents: [], declined: [], tenure: 0, freeYears: 0, region: region, abroad: false,
    stream: { cut: 0, thisStage: 0, total: 0 }, gear: {}, courses: [], agentTier: 0, relaxUsed: 0,
    axes: { hard: 0, warm: 0, grind: 0, show: 0 }, traits: [], eventCounts: {}, quests: [], eventsSeen: 0,
    auto: { buy: false, biz: false, daily: false, career: false }, autoNotes: [],
    achievements: [], titles: [], flags: { ...(origin.flags ?? {}) },
  }
  if (origin.trainMul) me.flags.trainMul = origin.trainMul
  if (origin.flags?.lang) me.courses.push('lang')
  state.me = me
  // the headroom just rolled, split into the eight ceilings (me/bottleneck.ts)
  ensureCeilings(state)
  initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state)))
  // the ladder starts where the skill puts it, less a season of not having played the top
  me.pre.ladder = clamp(45 + (p.overall - 60) * 1.7 - 12 + (origin.ladder ?? 0), 0, 100)
  me.pre.ladderPeak = me.pre.ladder

  pushLog(state, 'info', `${state.year} 年 1 月。你 ${p.age} 岁，${origin.name}：${origin.blurb}`)
  if (o.start === 'pre') {
    state.training[ME_ID] = 'rest'
    pushLog(state, 'info', `没有队伍。天梯 ${Math.round(me.pre.ladder)}，存款 $${me.money.toLocaleString()}。${cupFor(state, 'city')?.name}在第 7 周开打，${cupFor(state, 'premier')?.name}在第 15 周，主播杯要 60 个粉丝才请你。`)
  } else {
    me.ap = AP_SEASON
    me.apMax = AP_SEASON
    p.rounds = 400
    const deal = makeDeal(state, teamId, 'sign', o.start === 'chal' ? 'A' : 'B', rng)
    deal.role = o.start === 'chal' ? 'starter' : 'rotation'
    deal.years = o.start === 'chal' ? 1 : 1
    deal.signBonus = 0
    joinClub(state, deal)
  }
  beginWeek(state)
  return state
}
