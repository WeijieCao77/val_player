import RAW from '../../data/world.json'
import RAW_2021 from '../../data/world_2021.json'
import { autoStarters, createWorld } from '../world'
import { RULER, REGIONAL_RULER, rulerShift, rulerTeamRating2021, shiftPlayer } from '../ruler'
import { bookClubsAt, openWorldAt } from '../timeline'
import { realName } from '../names'
import { arrive2026 } from '../today'
import { setupSeason } from '../season'
import { STAFF_STAMP } from '../staffStints'
import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS, REGION_CN, emptyStats } from '../types'
import type { Attrs, GameState, Player, Region, Role } from '../types'
import { expectedSalary, recomputeOverall, refreshValue } from '../player'
import { AP_SEASON } from './actions'
import { AP_PRE, ladderLabel } from './prepro'
import { fansCn } from './fans'
import type { MeState } from './types'
import { beginWeek } from './week'
import { pushLog } from './log'
import { originName, originOf } from './origins'
import { serverOf } from './rank'
import { makeDeal, joinClub } from './contract'
import { MERGED_INTO, onTimeline, regionsOf, stageNameIn } from '../era'
import type { EntryYear } from '../era'
import { initLedger } from './money'
import { SEASON_LOOSENS, ceilingPotential, ensureCeilings } from './bottleneck'
import { cupFor } from './cups'
import { cny } from './moneyfmt'
import { CNY_FLAG } from './cnyMigrate'
import { TALENT_MAX, buildAttrs, talentCeilings, zeroTalents } from './talent'
import type { StartPoint } from './talent'
import { repairPlayerCountries, repairPlayerTeamNames } from './playerDataRepair'
import { repairPlayerBios } from './playerBioRepair'

/**
 * The new-career screen's numbers — the doors, the talent points, the ceilings
 * they open on — live in me/talent.ts, which the screen reads without the world
 * this module reaches; they are said here as well.
 */
export * from './talent'

export const ME_ID = 'ME'

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

/** Every club a career could open beside that year, in every region and tier. */
function clubsOf(year: number): (ClubChoice & { region: string })[] {
  // 2026 opens on the one timeline: its clubs are the roster book's, as 2026 really opened
  if (year >= 2026) {
    return bookClubsAt(year).map((t) => ({ id: t.id, name: t.name, tag: t.tag, rating: t.rating, roster: t.roster, tier: t.tier, region: t.region }))
  }
  return ((year <= 2021 ? RAW_2021.teams : RAW.teams) as BookClub[]).map((t) => {
    // world_2021.json has vlr's names of today; January 2021 had its own (engine/names.ts)
    const real = year <= 2021 ? realName(t.id.replace(/^V21T/, ''), 2021, 0) : null
    // a new career's world is on engine/ruler.ts, and so is the club it is placed at
    const rating = (year <= 2021 ? rulerTeamRating2021(t.id) : null) ?? t.rating
    return { id: t.id, name: real?.name ?? t.name, tag: real?.tag ?? t.tag, rating, roster: t.roster.length, tier: t.tier, region: t.region }
  })
}

export function candidateClubs(region: Region, tier: 1 | 2, year = 2026): ClubChoice[] {
  return clubsOf(year)
    .filter((t) => t.region === region && t.tier === tier)
    .map(({ id, name, tag, rating, roster, tier: k }) => ({ id, name, tag, rating, roster, tier: k }))
    .sort((a, b) => a.rating - b.rating)
}

const ACADEMY = /\s+(?:global\s+)?academy$/i
/** LEVIATÁN and Leviatan alike: accents dropped (the combining marks U+0300–U+036F after NFD), case and punctuation too */
const squash = (s: string): string => [...s.normalize('NFD')]
  .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f).join('')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * A top club's second team, as that year's book has it: a club named after a
 * first-division club of the same year with 「Academy」 after it — MIBR Academy,
 * ZETA DIVISION Academy, Gen.G Global Academy, DFM Academy (DetonatioN FocusMe
 * goes by DFM). 「FUTURE ACADEMY TEAM」 is not one, and neither is an academy
 * whose first team is not in the top tier that year.
 */
export function isAcademy(c: Pick<ClubChoice, 'id' | 'name'>, year: number): boolean {
  if (!ACADEMY.test(c.name)) return false
  const base = squash(c.name.replace(ACADEMY, ''))
  if (!base) return false
  return clubsOf(year).some((t) => t.tier === 1 && t.id !== c.id
    && (squash(t.name) === base || squash(t.tag) === base || squash(t.name).startsWith(`${base} `)))
}

/**
 * The clubs a club start is assigned from: a VCT 替补 start any first-division
 * club of the region; a second-team start the region's top-club academies where
 * that year has any, else its Challengers clubs. Clubs with a place on the roster
 * first. Empty when the region has no such club on New Year's Day.
 */
export function startPool(region: Region, start: StartPoint, year = 2026): ClubChoice[] {
  if (start === 'pre') return []
  const tier: 1 | 2 = start === 't1' ? 1 : 2
  const all = candidateClubs(region, tier, year)
  const academies = tier === 2 ? all.filter((t) => isAcademy(t, year)) : []
  const base = academies.length ? academies : all
  const room = base.filter((t) => t.roster <= 6)
  return room.length ? room : base
}

/**
 * The regions a career can open in that year: the ones its world has clubs in — 2026's busiest first,
 * 2021's in the order of its circuits, as the new-career screen lists them. 2021's SEA is a stage its
 * sub-regions played up to, not a place a club was based, so it is not one. 2026 is the one timeline's
 * 2026: its clubs are based where they really are, not in the four leagues' names.
 */
export function careerRegions(year: number): Region[] {
  if (year < 2026) return regionsOf(year).filter((r) => candidateClubs(r, 1, year).length + candidateClubs(r, 2, year).length > 0)
  const count = new Map<Region, number>()
  for (const t of bookClubsAt(year)) count.set(t.region, (count.get(t.region) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r)
}

/**
 * Where a career asked to open in `asked` opens that year: there, when that year's world has clubs
 * there. A name over several places — a league's (Americas, EMEA, Pacific), or 2021's SEA — is not a
 * place a club is based: it opens in the first place under it on that year's list (careerRegions, the
 * new-career screen's order: 2026's busiest first, 2021's circuits as they are listed) that can take
 * this door, in 2021 as in 2026. Anywhere else with no club that year: nowhere (null).
 *
 * Reported 2026-09-14: a 2021 ladder start from 「Americas」 threw a TypeError in createCareer, looking
 * for a club to build the world around. Only 2026 put a league's name on a real region, and the ladder
 * start had no guard where a club start refuses in words (pickClub).
 */
export function startRegion(asked: Region, year: number, start: StartPoint = 'pre'): Region | null {
  const list = careerRegions(year)
  if (list.includes(asked)) return asked
  const under = list.filter((r) => {
    for (let x = MERGED_INTO[r]?.into, guard = 0; x && guard < 6; x = MERGED_INTO[x]?.into, guard++) if (x === asked) return true
    return false
  })
  // 2021's EMEA lists Turkey before CIS, and Turkey had no first-tier club: a 替补 start goes on to one that had
  return under.find((r) => start === 'pre' || startPool(r, start, year).length > 0) ?? under[0] ?? null
}

/**
 * Why a career cannot open at this place and door that year, in the words the new-career screen puts
 * on its start button; null when it can. createCareer, left to pick the club, refuses exactly these
 * (scripts/check_starts.ts).
 */
export function startBlocked(asked: Region, start: StartPoint, year: number): string | null {
  const region = startRegion(asked, year, start)
  if (!region) return `${year} 年开季时${REGION_CN[asked] ?? asked}没有俱乐部`
  if (start !== 'pre' && !startPool(region, start, year).length) return `${year} 年开季时${REGION_CN[region] ?? region}没有${start === 't1' ? '一线' : '二线'}俱乐部`
  return null
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
  state.regionalRuler = REGIONAL_RULER
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

/**
 * The club a club start opens at. A newcomer does not choose his club (asked
 * 2026-09-11: 「为什么玩家在创号的时候就可以选俱乐部？」), and no list of clubs
 * comes for him either (2026-09-12): the game assigns one from startPool, off the
 * career's seed, so the same seed opens at the same club.
 */
function pickClub(region: Region, start: 'chal' | 't1', rng: Rng, year = 2026): string {
  const list = startPool(region, start, year)
  // China's second tier plays its first event of 2026 in the summer: on New Year's Day there is no such club to sign for
  if (!list.length) throw new Error(`${year} 年开季时 ${region} 没有${start === 't1' ? '一线' : '二线'}俱乐部可以签`)
  // the weaker the club, the likelier it takes a chance on an unknown —
  // squared, so a 74 is about five times as likely as an 88
  const w = list.map((t) => Math.max(4, 100 - t.rating) ** 2)
  return rng.weighted(list, w).id
}

/** a career's own stream, off its seed; the club draw is the first thing it rolls */
const CAREER_SALT = 0x3e11

/** The club createCareer opens a club start at for this seed — the same draw, without building the world (scripts/probe_start_clubs.ts). */
export const assignStartClub = (region: Region, start: 'chal' | 't1', seed: number, year = 2026): string =>
  pickClub(region, start, new Rng(seed ^ CAREER_SALT), year)

/**
 * The talent points this career was made with (the steady plan's talent session reads them: me/auto.ts
 * talentPick). A career keeps them from the day it is made. A save from before that has them read back once
 * off its ceilings and kept: what each ceiling stands above the one the same role and background give with no
 * talent (talentCeilings), less what breaks and seasons have opened on it since (me/bottleneck.ts), at +3 a
 * point. What a break spilled onto other attributes and a winter's re-rating are not booked by attribute, so on
 * a long career the estimate leans toward the role's heaviest attributes — toward the plan it had before.
 */
export function talentsOf(state: GameState): Record<keyof Attrs, number> {
  const me = state.me!
  if (me.talents) return me.talents
  const p = state.players[me.id]
  const base = talentCeilings(p.role, zeroTalents(), me.originKey)
  const bn = me.bottleneck
  const t = zeroTalents()
  for (const k of ATTR_KEYS) {
    const opened = (bn?.mech[k] ?? 0) + (bn?.mile[k] ?? 0) + (SEASON_LOOSENS.includes(k) ? bn?.exp ?? 0 : 0)
    t[k] = clamp(Math.round(((p.caps?.[k] ?? base[k]) - opened - base[k]) / 3), 0, TALENT_MAX)
  }
  me.talents = t
  return t
}

/** A new career: the manager game's world, with me in it. */
export function createCareer(o: CareerOpts): GameState {
  const seed = o.seed ?? (hashStr(o.name + o.region + o.role + o.originKey + String(Date.now())) >>> 0)
  const rng = new Rng(seed ^ CAREER_SALT)
  const origin = originOf(o.originKey)
  const clubTier: 1 | 2 = o.start === 't1' ? 1 : 2
  const year = o.year ?? 2026
  // a league's name is not a place a club is based: a career asked to open in 「Pacific」 opens in the
  // first real region under it that the year lists, 2021 and 2026 alike; a place with no club that year
  // is refused in words (startRegion), as a club start with no club to sign for is (pickClub)
  const region = startRegion(o.region, year, o.start)
  if (!region) throw new Error(`${year} 年开季时 ${o.region} 没有俱乐部，这一年不能从这里开始`)
  const teamId = o.start === 'pre'
    ? (candidateClubs(region, 2, year)[0] ?? candidateClubs(region, 1, year)[0]).id   // the world is built around a club; I am not at it
    : (o.teamId ?? pickClub(region, o.start, rng, year))
  const state = year >= 2026 ? createWorldAt(teamId, seed, year) : ruleOpening(createWorld(teamId, seed, year))
  // Nobody's club until I sign for one. The world used to keep a club "watched" for a player on the
  // ladder, and treated it as his: its title raised the world's rivalry, it kept its name when history
  // renamed it, its matches were his in the engine's eyes.
  if (o.start === 'pre') state.myTeam = ''
  // the world file is a roster book; the calendar is drawn here
  setupSeason(state)
  // This world is built from the corrected roster book, so nobody inside a staff stint is in it as a player: it is
  // already up to the staff data and has nothing to be brought up to (me/staffMigrate.ts migrateStaff, written for
  // saves made before that data). Stamped at birth, because the migration is a read-path one: unstamped, the first
  // load of a career would run it over a world that never needed it — taking a man out of the pool and filling his
  // seat from the free agents on the day his real stint began — and a career read back would no longer be the one
  // that was played (scripts/check_reload.ts).
  state.staffSync = STAFF_STAMP

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
    talents: { ...zeroTalents(), ...o.talents },
    mental: clamp(50 + (origin.mental ?? 0), 0, 100), body: clamp(55 + (origin.body ?? 0), 0, 100), tilt: 0,
    edge: 0, duelsThisWeek: 0, scrimRounds: 0, badStreak: 0, proven: false, coachTrust: 50, gmTrust: 50,
    fans: Math.max(0, 20 + (origin.fans ?? 0)), heat: 10, money: 20000 + (origin.money ?? 0), upkeep: origin.upkeep ?? 0,
    log: [], matches: [], weekNotes: [], pending: [], seasons: [],
    seasonStart: { year: state.year, overall: p.overall, matches: 0, starts: 0, wins: 0, acsSum: 0 },
    benchedStages: 0, startedThisStage: 0, playedThisStage: 0,
    pre: { year: 1, ladder: 0, ladderPeak: 0, rise: 0, cups: [], scoutSeen: origin.scoutSeen ?? 0, invites: [], seen: [], tac: origin.tac ?? 0, mates: [], wasPro: false },
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
  // born in RMB: nothing for me/cnyMigrate.ts to convert
  me.flags[CNY_FLAG] = 1
  state.me = me
  // Historical identity corrections never replace the main character or a
  // simulated roster. Apply the same guarded repairs as a subsequently loaded save.
  repairPlayerCountries(state)
  repairPlayerBios(state)
  repairPlayerTeamNames(state)
  // the book that counts toward breaking the eight ceilings (me/bottleneck.ts)
  ensureCeilings(state)
  initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state)))
  // the ladder starts where the skill puts it, less a season of not having played the top
  me.pre.ladder = clamp(45 + (p.overall - 60) * 1.7 - 12 + (origin.ladder ?? 0), 0, 100)
  me.pre.ladderPeak = me.pre.ladder

  // a club start's club is the game's pick, so the first line says where it put me — a club background already names it
  const club = o.start !== 'pre' ? state.teams[state.myTeam] : undefined
  const placed = club && !origin.needsClub
    ? ` 开局分到 ${club.name}${isAcademy(club, year) ? '（二队）' : ''}，${o.start === 't1' ? '一线队的第六人' : '首发'}。`
    : ''
  pushLog(state, 'info', `${state.year} 年 1 月。你 ${p.age} 岁，${originName(origin, serverOf(state))}：${origin.needsClub && club ? origin.blurb.replace('这家俱乐部', club.name) : origin.blurb}${placed}`)
  if (o.start === 'pre') {
    state.training[ME_ID] = 'rest'
    pushLog(state, 'info', `没有队伍。${ladderLabel(state)}，存款 ${cny(me.money)}。${cupFor(state, 'city')?.name}第 7 周报名、之后一周打一轮，${cupFor(state, 'premier')?.name}第 15 周报名，主播杯要粉丝过 ${fansCn(cupFor(state, 'streamer')?.minFans ?? 60)} 才请你。`)
  } else {
    me.ap = AP_SEASON
    me.apMax = AP_SEASON
    p.rounds = 400
    const deal = makeDeal(state, teamId, 'sign', o.start === 'chal' ? 'A' : 'B', rng)
    deal.role = o.start === 'chal' ? 'starter' : 'rotation'
    deal.years = o.start === 'chal' ? 1 : 1
    deal.signBonus = 0
    // the career opens at the club: no signing card on the first screen (me/moments.ts)
    joinClub(state, deal, { quiet: true })
  }
  beginWeek(state)
  return state
}
