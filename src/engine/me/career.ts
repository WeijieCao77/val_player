import RAW from '../../data/world.json'
import RAW_2021 from '../../data/world_2021.json'
import { autoStarters, createWorld } from '../world'
import { RULER, rulerShift, rulerTeamRating2021, shiftPlayer } from '../ruler'
import { bookClubsAt, openWorldAt } from '../timeline'
import { realName } from '../names'
import { arrive2026 } from '../today'
import { setupSeason } from '../season'
import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS, emptyStats } from '../types'
import type { Attrs, GameState, Player, Region, Role } from '../types'
import { expectedSalary, recomputeOverall, refreshValue, weightsFor } from '../player'
import { AP_SEASON } from './actions'
import { AP_PRE, ladderLabel } from './prepro'
import { fansCn } from './fans'
import type { MeState } from './types'
import { beginWeek } from './week'
import { pushLog } from './log'
import { originOf } from './origins'
import { makeDeal, joinClub } from './contract'
import { onTimeline, regionIn, stageNameIn } from '../era'
import type { EntryYear } from '../era'
import { initLedger } from './money'
import { TALENT_CAP_MAX, ceilingPotential, ensureCeilings } from './bottleneck'
import { entryBands } from '../ruler'
import type { EntryBands } from '../ruler'
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
      // a new career's world is on engine/ruler.ts, and so is the club it is offered
      return { id: t.id, name: real?.name ?? t.name, tag: real?.tag ?? t.tag, rating: (year <= 2021 ? rulerTeamRating2021(t.id) : null) ?? t.rating, roster: t.roster.length, tier: t.tier }
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
function createWorldAt(teamId: string, seed: number, year: number): GameState {
  const state = ruleOpening(createWorld((RAW_2021.teams as BookClub[])[0].id, seed, 2021))
  // nobody's club yet: history moves every club while the world is brought up
  state.myTeam = ''
  openWorldAt(state, year)
  if (year === 2026) arrive2026(state, [])
  state.news = []
  state.training = {}
  state.myTeam = teamId
  return state
}

/**
 * A new career's world is measured on engine/ruler.ts: January 2021's people
 * move onto it before anything reads them, and every year of the roster book is
 * read on it as it opens (engine/timeline.ts). A save from before keeps the
 * scale it was built on — its world line is under way.
 */
function ruleOpening(state: GameState): GameState {
  state.ruler = RULER
  for (const p of Object.values(state.players)) {
    if (!/^V\d+$/.test(p.id)) continue
    shiftPlayer(p, rulerShift(2021, p.id.slice(1)))
    const t = p.teamId ? state.teams[p.teamId] : undefined
    if (t) p.salary = expectedSalary(p, t.tier === 1 ? 1 : 2)
    refreshValue(p)
  }
  for (const t of Object.values(state.teams)) {
    const top = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
    if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
    if (t.roster.length) t.starters = autoStarters(state, t.id)
  }
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

export interface StartOffer extends ClubChoice {
  /** where the club stands among its tier in the region, in words */
  standing: '强队' | '中游' | '弱队'
}

/**
 * Who comes for a new player who starts at a club. The new-career screen used
 * to list every club of the tier and let an 18-year-old pick one — the reigning
 * champions included (asked 2026-09-11: 「为什么玩家在创号的时候就可以选俱乐部？」).
 * A newcomer does not choose his club; the clubs that want him ask. Two or three
 * of the region's clubs at that tier with room on the roster, drawn the way
 * pickClub signs one (the weaker, the likelier to take a chance), and he signs
 * with one of those.
 */
export function startOffers(region: Region, tier: 1 | 2, year: number, seed: number, n = 3): StartOffer[] {
  const all = candidateClubs(region, tier, year)
  const room = all.filter((t) => t.roster <= 6)
  const left = [...(room.length ? room : all)]
  const rng = new Rng(seed ^ 0x51a7)
  const out: StartOffer[] = []
  // a tier of three clubs does not all come knocking: at least one of them is not interested
  const want = Math.min(n, Math.max(1, left.length - 1))
  while (out.length < want && left.length) {
    const c = rng.weighted(left, left.map((t) => Math.max(4, 100 - t.rating) ** 2))
    left.splice(left.indexOf(c), 1)
    // all is weakest first
    const at = all.length > 1 ? all.findIndex((t) => t.id === c.id) / (all.length - 1) : 0.5
    out.push({ ...c, standing: at >= 2 / 3 ? '强队' : at >= 1 / 3 ? '中游' : '弱队' })
  }
  return out.sort((a, b) => b.rating - a.rating)
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

/** Where every talent ceiling starts; each point of talent is +3 on it, as on the start. */
export const CAP_BASE = 70

/**
 * The eight ceilings a talent gives, 破晓's 天赋上限 (cap = 57 + 4.3 × talent) on
 * this game's eight: +3 a point, the role's two heaviest +3, the origin's lean
 * on top, a late start a little lower. Held under TALENT_CAP_MAX, so a maxed
 * 枪法 still has a path to break on the first day. The random head a new
 * career used to roll is gone: the screen that sets the talent can say exactly
 * where it leads.
 */
export function talentCeilings(role: Role, talents: Record<keyof Attrs, number>, originKey: string): Record<keyof Attrs, number> {
  const w = weightsFor({ role })
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 2)
  const o = originOf(originKey)
  const caps = {} as Record<keyof Attrs, number>
  for (const k of ATTR_KEYS) {
    caps[k] = clamp(CAP_BASE + (talents[k] ?? 0) * 3 + (top.includes(k) ? 3 : 0) + (o.attrs?.[k] ?? 0) - (o.flags?.late ? 4 : 0), 50, TALENT_CAP_MAX)
  }
  return caps
}

/** 综合 a career that works at its ceilings opens on top of its talent: practice paths, a strong club, its seasons, a trophy (measured, .cache/probe_career.ts) */
export const BREAK_REACH = 8

export interface CeilingPreview {
  /** the 综合 he starts on */
  start: number
  /** what his talent's eight ceilings add up to */
  talent: number
  /** and where breaking them takes a career that works at it */
  reach: number
  /** where the starters of the entry year stand, on the world's ruler (engine/ruler.ts) */
  bands: EntryBands
}

/** The new-career screen's ceiling, computed rather than typed in. */
export function ceilingPreview(role: Role, talents: Record<keyof Attrs, number>, originKey: string, year: number): CeilingPreview {
  const attrs = buildAttrs(role, talents, originKey)
  const start = recomputeOverall({ role, attrs, stageBonus: 0 } as Player)
  const caps = talentCeilings(role, talents, originKey)
  const talent = ceilingPotential({ role, attrs, stageBonus: 0 }, caps)
  return { start, talent, reach: Math.min(99, talent + BREAK_REACH), bands: entryBands(year) }
}

/**
 * What the talent panel says about it: in words when `word` is given (the
 * default screen), in figures under the 数值 switch. The ceiling is never put
 * beside a starter's number on its own — what breaking it adds is part of it
 * (reported 2026-09-12: 「上限79但是首发选手中位数为81，这儿明显不合理，那玩家还玩什么」).
 */
export function ceilingLines(c: CeilingPreview, year: number, word?: (v: number) => string): { tag: string; hint: string } {
  const top = year <= 2021 ? '打进过赛区决赛的俱乐部' : '一级联赛'
  const sub = year <= 2021 ? '只打过海选的俱乐部' : 'Challengers '
  if (word) {
    return {
      tag: `起点${word(c.start)} · 天赋能摸到${word(c.talent)}，破瓶颈能到${word(c.reach)}`,
      hint: `每点天赋起点 +3、天花板 +3。${top}首发大多${word(c.bands.top)}，${sub}首发大多${word(c.bands.sub)}，世界前十是${word(c.bands.star)}。天花板之上靠破瓶颈：苦练、强队、打满赛季、冠军和决赛 MVP。`,
    }
  }
  return {
    tag: `起点 ${c.start} · 天赋上限 ${c.talent} · 破瓶颈能到 ${c.reach}`,
    hint: `每点天赋起点 +3、天花板 +3。${top}首发中位数 ${c.bands.top}，${sub}首发中位数 ${c.bands.sub}，世界前十从 ${c.bands.star} 起（${year <= 2021 ? 2021 : 2026} 年开季的真实数据）。天花板之上靠破瓶颈：苦练、强队、打满赛季、冠军和决赛 MVP。`,
  }
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
    ? candidateClubs(region, 2, year)[0]?.id ?? candidateClubs(region, 1, year)[0].id   // the world is built around a club; I am not at it
    : (o.teamId ?? pickClub(region, clubTier, rng, year))
  const state = year >= 2026 ? createWorldAt(teamId, seed, year) : ruleOpening(createWorld(teamId, seed, year))
  // Nobody's club until I sign for one. The world used to keep a club "watched" for a player on the
  // ladder, and treated it as his: its title raised the world's rivalry, it kept its name when history
  // renamed it, its matches were his in the engine's eyes.
  if (o.start === 'pre') state.myTeam = ''
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
  // the ceilings are the talent's, as 破晓's are — never under where he starts
  const caps = talentCeilings(o.role, o.talents, o.originKey)
  for (const k of ATTR_KEYS) caps[k] = Math.max(caps[k], p.attrs[k])
  p.caps = caps
  p.potential = ceilingPotential(p)
  p.salary = 0
  refreshValue(p)
  state.players[ME_ID] = p

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
    achievements: [], titles: [], flags: { ...(origin.flags ?? {}) }, entryYear: year,
  }
  if (origin.trainMul) me.flags.trainMul = origin.trainMul
  // the ladder start, remembered: a few achievements are about having come that way (me/achievements.ts)
  if (o.start === 'pre') me.flags.fromLadder = 1
  // and a club start's door, for the 成就殿堂's career card (me/hall.ts)
  else me.flags.startTier = clubTier
  if (origin.flags?.lang) me.courses.push('lang')
  state.me = me
  // the book that counts toward breaking the eight ceilings (me/bottleneck.ts)
  ensureCeilings(state)
  initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state)))
  // the ladder starts where the skill puts it, less a season of not having played the top
  me.pre.ladder = clamp(45 + (p.overall - 60) * 1.7 - 12 + (origin.ladder ?? 0), 0, 100)
  me.pre.ladderPeak = me.pre.ladder

  pushLog(state, 'info', `${state.year} 年 1 月。你 ${p.age} 岁，${origin.name}：${origin.needsClub && o.start !== 'pre' ? origin.blurb.replace('这家俱乐部', state.teams[state.myTeam]?.name ?? '这家俱乐部') : origin.blurb}`)
  if (o.start === 'pre') {
    state.training[ME_ID] = 'rest'
    pushLog(state, 'info', `没有队伍。${ladderLabel(me.pre.ladder)}，存款 $${me.money.toLocaleString()}。${cupFor(state, 'city')?.name}在第 7 周开打，${cupFor(state, 'premier')?.name}在第 15 周，主播杯要粉丝过 ${fansCn(cupFor(state, 'streamer')?.minFans ?? 60)} 才请你。`)
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
