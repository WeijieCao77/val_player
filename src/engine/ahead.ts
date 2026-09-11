import raw from '../data/circuit.json'
import type { CEvent, CNode, CUnit, Slot } from './circuit'
import { WORLD_END } from './era'
import { aheadHosts } from './hosts'
import type { Region, StageKey } from './types'

/**
 * VCT from 2027: the format Riot announced for it, with what Riot has not
 * announced yet 暂定 — the author's call, 2026-09-11, 「确认，按照你的推荐做」 —
 * and marked 暂定 in game until it does.
 *
 * Announced, and followed: the season runs Kickoff → Masters → Cup 1 →
 * Masters → Cup 2 → Champions. A Kickoff in the Americas, EMEA and the Pacific
 * is eight partners and four sides from the open qualifiers; China's is eight
 * partners, two visitors and two sides from its National Competition. A partner
 * is not promised a Cup — the bottom of each event drops into the Open
 * Playoffs. The open qualifiers run in sixteen regions, from November.
 *
 * 暂定, until Riot says otherwise:
 *  1. the eight partners are this world's best of the two seasons before, and
 *     China's two visitors the top two of its Ascension (engine/leagues.ts)
 *  2. Kickoff's open places: North America, LATAM North, LATAM South and Brazil
 *     one each; Europe two, Türkiye and MENA one each; the Pacific's eight
 *     regional winners play off for four; China's National Competition, two
 *  3. a Cup is twelve: the event before's top eight, and the top four of its
 *     Open Playoffs — the event before's bottom four against the regions' open
 *     qualifiers, in double elimination — played in 2026 Stage 1's format. China's
 *     partners and visitors are in both Cups; its other two places are played for
 *  4. Masters in 2026's format: each league's top three of Kickoff, then of Cup 1
 *  5. Champions in 2026's format: each league's top four of Cup 2, and no points
 *  6. 2026's dates; host cities drawn from cities with the scene for it, and
 *     Champions 2027 in the Americas as announced (engine/hosts.ts aheadHosts)
 *  7. 2028 as 2027; from 2029 the partners are chosen again every two years,
 *     at most two new clubs a league each time (engine/leagues.ts)
 *
 * Every graph is a real one, retimed: 2026's Kickoffs, Stage 1s and Americas
 * play-ins, Santiago and London, Champions 2025. An open qualifier's last stage
 * is two GSL groups, the way Champions plays its groups, and a final. None of
 * it reads a save: engine/circuit.ts seats each event from its `plan` the day
 * before it opens (planSeeds).
 */

export type League = 'Americas' | 'EMEA' | 'Pacific' | 'China'
export const LEAGUES: League[] = ['Americas', 'EMEA', 'Pacific', 'China']

/** The first season of the new format. */
export const FIRST_AHEAD = 2027

/** 暂定 7: the partners are chosen for 2027, kept for 2028, and chosen again every two years after. */
export const reselects = (year: number): boolean => year >= FIRST_AHEAD && (year - FIRST_AHEAD) % 2 === 0

/**
 * How one place in an event is filled: the league's k-th partner (best of the
 * season before first), China's k-th visitor, the league's k-th side from the
 * November open qualifiers, whoever placed k-th (from 0) in an earlier event —
 * `league` the league that place belongs to — or the k-th best club that entered.
 */
export type Seat =
  | { from: 'partner'; k: number }
  | { from: 'visitor'; k: number }
  | { from: 'qualified'; k: number }
  | { from: 'place'; event: string; k: number; league?: League }
  | { from: 'pool'; k: number }

export interface Plan {
  kind: 'kickoff' | 'cup' | 'open' | 'masters' | 'champions' | 'oq' | 'oqFinal' | 'ascension'
  league?: League
  /** an open qualifier's region — OQ_POOLS */
  pool?: string
  /** 1 or 2: the Cup an open qualifier or Open Playoffs leads to; 0: next season's Kickoff */
  cup?: 0 | 1 | 2
  seats: Seat[]
}

/* ------------------------------------------------------------------ */
/*  the sixteen open-qualifier regions                                  */
/* ------------------------------------------------------------------ */

export interface OqPool { key: string; cn: string; en: string; league: League; regions: Region[] }

export const OQ_POOLS: OqPool[] = [
  { key: 'na', cn: '北美', en: 'North America', league: 'Americas', regions: ['North America'] },
  { key: 'latn', cn: '拉美北', en: 'LATAM North', league: 'Americas', regions: ['LATAM'] },
  { key: 'lats', cn: '拉美南', en: 'LATAM South', league: 'Americas', regions: ['LATAM'] },
  { key: 'br', cn: '巴西', en: 'Brazil', league: 'Americas', regions: ['Brazil'] },
  { key: 'eu', cn: '欧洲', en: 'Europe', league: 'EMEA', regions: ['Europe', 'CIS'] },
  { key: 'tr', cn: '土耳其', en: 'Türkiye', league: 'EMEA', regions: ['Turkey'] },
  { key: 'mena', cn: '中东北非', en: 'MENA', league: 'EMEA', regions: ['MENA'] },
  { key: 'kr', cn: '韩国', en: 'Korea', league: 'Pacific', regions: ['Korea'] },
  { key: 'jp', cn: '日本', en: 'Japan', league: 'Pacific', regions: ['Japan'] },
  { key: 'th', cn: '泰国', en: 'Thailand', league: 'Pacific', regions: ['Thailand'] },
  { key: 'id', cn: '印尼', en: 'Indonesia', league: 'Pacific', regions: ['Indonesia'] },
  { key: 'vn', cn: '越南', en: 'Vietnam', league: 'Pacific', regions: ['Vietnam'] },
  { key: 'sea', cn: '东南亚', en: 'SEA', league: 'Pacific', regions: ['SEA', 'Malaysia & Singapore', 'Philippines', 'Hong Kong & Taiwan'] },
  { key: 'sa', cn: '南亚', en: 'South Asia', league: 'Pacific', regions: ['South Asia'] },
  { key: 'oce', cn: '大洋洲', en: 'Oceania', league: 'Pacific', regions: ['Oceania'] },
  { key: 'cn', cn: '中国全国大赛', en: 'China National Competition', league: 'China', regions: ['China'] },
]

const LATAM_SOUTH = new Set(['ar', 'cl', 'uy', 'py', 'bo'])

/**
 * The open qualifier a club enters: its region's. Latin America is one region
 * to the roster book and two to the qualifiers — a club with a Challengers
 * league plays in that league's half, and one without in the half most of its
 * people are from.
 */
export function oqPoolOf(region: Region, nats: (string | null | undefined)[], scene?: string): string | null {
  if (region === 'LATAM') {
    if (scene === 'LATAM South') return 'lats'
    if (scene === 'LATAM North') return 'latn'
    const known = nats.filter((n): n is string => !!n)
    return known.length && known.filter((n) => LATAM_SOUTH.has(n)).length * 2 >= known.length ? 'lats' : 'latn'
  }
  const hit = OQ_POOLS.find((p) => p.regions.includes(region))
  if (hit) return hit.key
  return region === 'Americas' ? 'na' : region === 'EMEA' ? 'eu' : region === 'Pacific' ? 'sea' : null
}

/** 暂定 2: each league's Kickoff open places — an event of the November before, and the place in it (from 0). */
export const KICKOFF_OPEN: Record<League, [string, number][]> = {
  Americas: [['oq0:na', 0], ['oq0:latn', 0], ['oq0:lats', 0], ['oq0:br', 0]],
  EMEA: [['oq0:eu', 0], ['oq0:eu', 1], ['oq0:tr', 0], ['oq0:mena', 0]],
  Pacific: [['oqFinal:Pacific', 0], ['oqFinal:Pacific', 1], ['oqFinal:Pacific', 2], ['oqFinal:Pacific', 3]],
  China: [['oq0:cn', 0], ['oq0:cn', 1]],
}

/* ------------------------------------------------------------------ */
/*  the graphs                                                          */
/* ------------------------------------------------------------------ */

const CIRCUIT = raw as unknown as Record<string, CEvent[]>

/** The season every graph here is taken from: the last one Riot has played. */
const SHAPE_YEAR = FIRST_AHEAD - 1

/**
 * 暂定 6. The leagues and internationals keep 2026's own days. The open
 * qualifiers go in the weeks their clubs are free — while the first Masters is
 * played, after Cup 1, and in November — and Champions takes 2026's announced dates.
 */
const OQ_DAY: Record<0 | 1 | 2, number> = { 0: 305, 1: 60, 2: 146 }
const OPEN_DAYS: Record<1 | 2, [number, number]> = { 1: [76, 86], 2: [175, 186] }
const OQ_FINAL_DAY = 322
const ASCENSION_DAY = 283
const CHAMPIONS_DAYS: [number, number] = [266, 290]

const LEAGUE_CN: Record<League, string> = { Americas: '美洲联赛', EMEA: 'EMEA 联赛', Pacific: '太平洋联赛', China: '中国联赛' }

function shapeOf(year: number, stage: StageKey, region: League | null): CEvent {
  const e = (CIRCUIT[String(year)] ?? []).find((x) => x.stage === stage && (x.region ?? null) === region && !x.scene)
  if (!e) throw new Error(`circuit.json 没有 ${year} 年${region ?? '国际赛'}的 ${stage}`)
  return e
}

const node = (day: number, round: string, a: Slot, b: Slot): CNode =>
  ({ day, round, bo: 3, a, b, winner: null, teams: ['', ''], score: [null, null] })

/** A real graph on other days: every match keeps its place in the order, spread over the new window. */
function retime(units: CUnit[], to: [number, number]): CUnit[] {
  const days = units.flatMap((u) => (u.nodes ?? []).map((n) => n.day))
  const [f0, f1] = [Math.min(...days), Math.max(...days)]
  const at = (d: number): number => (f1 > f0 ? Math.round(to[0] + ((d - f0) * (to[1] - to[0])) / (f1 - f0)) : to[0])
  return units.map((u) => {
    const nodes = (u.nodes ?? []).map((n): CNode => ({ ...n, day: at(n.day), winner: null, teams: ['', ''], score: [null, null] }))
    const on = nodes.map((n) => n.day)
    return { ...u, ranked: undefined, nodes, first: on.length ? Math.min(...on) : u.first, last: on.length ? Math.max(...on) : u.last }
  })
}

/** A GSL group of four, as Champions plays its groups: two through. */
function gsl(group: string, s: number, day: number): CUnit {
  const nodes = [
    node(day, `${group}组 首轮`, ['s', s], ['s', s + 1]),
    node(day, `${group}组 首轮`, ['s', s + 2], ['s', s + 3]),
    node(day + 2, `${group}组 胜者赛`, ['w', 0], ['w', 1]),
    node(day + 2, `${group}组 败者赛`, ['l', 0], ['l', 1]),
    node(day + 4, `${group}组 决胜赛`, ['l', 2], ['w', 3]),
  ]
  return { label: `小组赛 · ${group}组`, type: 'bracket', size: 4, upperFirst: true, phase: 'Group Stage|groups', nodes, first: day, last: day + 4 }
}

/**
 * An open qualifier's last stage: the eight who entered in two GSL groups, and —
 * where a single place is played for — a final between the group winners.
 */
function qualifierUnits(day: number, final: boolean): CUnit[] {
  const units = [gsl('A', 0, day), gsl('B', 4, day + 1)]
  if (final) {
    units.push({
      label: '决赛', type: 'bracket', size: 2, upperFirst: true, phase: 'Final|',
      nodes: [node(day + 7, '决赛', ['g', 0, 1], ['g', 1, 1])], first: day + 7, last: day + 7,
    })
  }
  return units
}

/** Eight who entered, seeded into two groups so that the best two can meet only in the final. */
const SNAKE = [0, 7, 3, 4, 1, 6, 2, 5]

/**
 * The Open Playoffs: 2026's Americas Stage 2 play-ins — twelve sides in double
 * elimination, four through. The four who start a round later are the event
 * before's bottom four (places 0–3); the eight who open it came through the
 * regions' open qualifiers (places 4–11).
 */
function openPlayoffs(window: [number, number]): CUnit {
  const shape = shapeOf(SHAPE_YEAR, 'stage2', 'Americas').units.find((u) => /Play-Ins/.test(u.phase ?? ''))
  if (!shape?.nodes) throw new Error('circuit.json 没有 2026 美洲第二赛段的附加赛')
  let bye = 0
  let first = 4
  const entry = (s: Slot) => s[0] === 's' || s[0] === 'g'
  const nodes = shape.nodes.map((n): CNode => {
    if (entry(n.a) && entry(n.b)) return { ...n, a: ['s', first++], b: ['s', first++] }
    if (entry(n.a)) return { ...n, a: ['s', bye++] }
    if (entry(n.b)) return { ...n, b: ['s', bye++] }
    return n
  })
  return retime([{ ...shape, label: '公开季后赛', phase: 'Open Playoffs|', nodes }], window)[0]
}

/* ------------------------------------------------------------------ */
/*  who sits where                                                      */
/* ------------------------------------------------------------------ */

const P = (k: number): Seat => ({ from: 'partner', k })
const V = (k: number): Seat => ({ from: 'visitor', k })
const Q = (k: number): Seat => ({ from: 'qualified', k })
const at = (event: string, k: number): Seat => ({ from: 'place', event, k })
const pool = (k: number): Seat => ({ from: 'pool', k })

/** Kickoff: the four best partners wait in round two, the other four open against the sides from outside. */
function kickoffSeats(L: League): Seat[] {
  return L === 'China'
    ? [P(4), Q(1), P(5), Q(0), P(6), V(1), P(7), V(0), P(0), P(1), P(2), P(3)]
    : [P(4), Q(3), P(5), Q(2), P(6), Q(1), P(7), Q(0), P(0), P(1), P(2), P(3)]
}

/** A Cup: the event before's top four each open against an Open Playoffs side. China's partners and visitors are in by right. */
function cupSeats(L: League, before: string, open: string): Seat[] {
  const O = (k: number) => at(open, k)
  if (L === 'China') return [P(0), O(1), P(1), O(0), P(2), V(1), P(3), V(0), P(4), P(7), P(5), P(6)]
  const D = (k: number) => at(before, k)
  return [D(0), O(3), D(1), O(2), D(2), O(1), D(3), O(0), D(4), D(7), D(5), D(6)]
}

/** The Open Playoffs: the event before's bottom four, and the regions' qualifiers paired so no region meets itself first. */
function openSeats(year: number, L: Exclude<League, 'China'>, before: string, cup: 1 | 2): Seat[] {
  const q = (key: string, k: number) => at(`F${year}:oq${cup}:${key}`, k)
  const regional: Record<Exclude<League, 'China'>, Seat[]> = {
    Americas: [q('na', 0), q('br', 1), q('br', 0), q('latn', 1), q('latn', 0), q('lats', 1), q('lats', 0), q('na', 1)],
    EMEA: [q('eu', 0), q('mena', 1), q('eu', 1), q('tr', 1), q('tr', 0), q('eu', 3), q('mena', 0), q('eu', 2)],
    Pacific: [q('kr', 0), q('sa', 0), q('jp', 0), q('oce', 0), q('th', 0), q('vn', 0), q('id', 0), q('sea', 0)],
  }
  return [at(before, 8), at(before, 9), at(before, 10), at(before, 11), ...regional[L]]
}

/** China's Open Playoffs: its two sides from outside the league last time, and the best of its other clubs. */
function chinaOpenSeats(year: number, cup: 1 | 2): Seat[] {
  const through = (k: number) => (cup === 1 ? Q(k) : at(`F${year}:open1:China`, k))
  return [through(0), pool(5), pool(1), pool(2), through(1), pool(4), pool(0), pool(3)]
}

/** Santiago's twelve as their places came in: seconds and thirds in the Swiss, the four winners waiting in the playoffs. */
const MASTERS_SEATS: [League, number][] = [
  ['EMEA', 1], ['China', 2], ['China', 1], ['Americas', 2], ['Pacific', 1], ['EMEA', 2],
  ['Americas', 1], ['Pacific', 2], ['Pacific', 0], ['Americas', 0], ['China', 0], ['EMEA', 0],
]

/** Champions 2025's four groups, one side of each league in each; its points places read as third and fourth. */
const CHAMPIONS_SEATS: [League, number][] = [
  ['Pacific', 0], ['China', 3], ['EMEA', 1], ['Americas', 2],
  ['EMEA', 0], ['Pacific', 3], ['Americas', 1], ['China', 2],
  ['Americas', 0], ['EMEA', 3], ['China', 1], ['Pacific', 2],
  ['China', 0], ['Americas', 3], ['Pacific', 1], ['EMEA', 2],
]

/** The Pacific's eight regional winners, two groups of four. */
const PACIFIC_FINAL = ['kr', 'sa', 'th', 'id', 'jp', 'oce', 'vn', 'sea']

/* ------------------------------------------------------------------ */
/*  the calendar                                                        */
/* ------------------------------------------------------------------ */

interface Draft { name: string; cn: string; region: string | null; layer: string[] | null; stage: StageKey; units: CUnit[]; plan: Plan }

function make(year: number, key: string, d: Draft): CEvent {
  const days = d.units.flatMap((u) => (u.nodes ?? []).map((n) => n.day))
  return {
    id: `F${year}:${key}`, name: d.name, cn: d.cn, region: d.region, layer: d.layer, scene: null, stage: d.stage,
    start: Math.min(...days), end: Math.max(...days),
    // no real side ever held these places: `N:` is what engine/circuit.ts reads as nobody this world holds
    seeds: d.plan.seats.map((_, i) => `N:seat${i}`),
    units: d.units, places: [], names: {}, rosters: {},
    projected: { year, base: '' },
    plan: d.plan,
  }
}

function openQualifier(year: number, p: OqPool, cup: 0 | 1 | 2): CEvent {
  return make(year, `oq${cup}:${p.key}`, {
    name: cup ? `VCT ${year}: ${p.en} Open Qualifier · Cup ${cup}` : `VCT ${year + 1}: ${p.en} Open Qualifier`,
    cn: cup ? `杯赛 ${cup} 公开资格赛 · ${p.cn}` : `${year + 1} 揭幕赛公开资格赛 · ${p.cn}`,
    region: p.regions[0], layer: p.regions.length > 1 ? p.regions : null, stage: 'ascension',
    units: qualifierUnits(OQ_DAY[cup], true),
    plan: { kind: 'oq', league: p.league, pool: p.key, cup, seats: SNAKE.map((k) => pool(k)) },
  })
}

function season(year: number): CEvent[] {
  const out: CEvent[] = []
  const id = (key: string) => `F${year}:${key}`
  for (const L of LEAGUES) {
    const kickoff = shapeOf(SHAPE_YEAR, 'kickoff', L)
    const stage1 = shapeOf(SHAPE_YEAR, 'stage1', L)
    const stage2 = shapeOf(SHAPE_YEAR, 'stage2', L)
    out.push(make(year, `kickoff:${L}`, {
      name: `VCT ${year}: ${L} Kickoff`, cn: `${LEAGUE_CN[L]} · 揭幕赛`, region: L, layer: kickoff.layer, stage: 'kickoff',
      units: retime(kickoff.units, [kickoff.start!, kickoff.end!]),
      plan: { kind: 'kickoff', league: L, seats: kickoffSeats(L) },
    }))
    for (const cup of [1, 2] as const) {
      const stage: StageKey = cup === 1 ? 'stage1' : 'stage2'
      const window: [number, number] = cup === 1 ? [stage1.start!, stage1.end!] : [stage2.start!, stage2.end!]
      const before = id(cup === 1 ? `kickoff:${L}` : `cup1:${L}`)
      if (L !== 'China') for (const p of OQ_POOLS) if (p.league === L) out.push(openQualifier(year, p, cup))
      out.push(make(year, `open${cup}:${L}`, {
        name: `VCT ${year}: ${L} Open Playoffs ${cup}`, cn: `${LEAGUE_CN[L]} · 杯赛 ${cup} 公开季后赛`, region: L, layer: kickoff.layer, stage,
        units: L === 'China' ? qualifierUnits(OPEN_DAYS[cup][0], false) : [openPlayoffs(OPEN_DAYS[cup])],
        plan: { kind: 'open', league: L, cup, seats: L === 'China' ? chinaOpenSeats(year, cup) : openSeats(year, L, before, cup) },
      }))
      out.push(make(year, `cup${cup}:${L}`, {
        name: `VCT ${year}: ${L} Cup ${cup}`, cn: `${LEAGUE_CN[L]} · 杯赛 ${cup}`, region: L, layer: kickoff.layer, stage,
        // 2026 Stage 1's format for both Cups, each on its own stage's days
        units: retime(stage1.units, window),
        plan: { kind: 'cup', league: L, cup, seats: cupSeats(L, before, id(`open${cup}:${L}`)) },
      }))
    }
  }
  for (const n of [1, 2] as const) {
    const shape = shapeOf(SHAPE_YEAR, n === 1 ? 'masters1' : 'masters2', null)
    const feeder = n === 1 ? 'kickoff' : 'cup1'
    out.push(make(year, `masters${n}`, {
      name: `Valorant Masters ${year} Stage ${n}`, cn: `${aheadHosts(year)[n === 1 ? 'masters1' : 'masters2']}大师赛`, region: null, layer: null,
      stage: n === 1 ? 'masters1' : 'masters2',
      units: retime(shape.units, [shape.start!, shape.end!]),
      plan: { kind: 'masters', seats: MASTERS_SEATS.map(([L, k]) => ({ from: 'place', event: id(`${feeder}:${L}`), k, league: L })) },
    }))
  }
  const champions = shapeOf(SHAPE_YEAR - 1, 'champions', null)
  out.push(make(year, 'champions', {
    name: `Valorant Champions ${year}`, cn: `${year} 全球冠军赛（${aheadHosts(year).champions}）`, region: null, layer: null, stage: 'champions',
    units: retime(champions.units, CHAMPIONS_DAYS),
    plan: { kind: 'champions', seats: CHAMPIONS_SEATS.map(([L, k]) => ({ from: 'place', event: id(`cup2:${L}`), k, league: L })) },
  }))
  if (year + 1 < WORLD_END) {
    out.push(make(year, 'ascension:China', {
      name: `VCT ${year}: China Ascension`, cn: `中国 · 晋级赛（${year + 1} 访客席位）`, region: 'China', layer: null, stage: 'ascension',
      units: qualifierUnits(ASCENSION_DAY, true),
      plan: { kind: 'ascension', league: 'China', seats: SNAKE.map((k) => pool(k)) },
    }))
  }
  return out
}

/** November: the open qualifiers for next season's Kickoff (暂定 2). */
function winter(year: number): CEvent[] {
  const out = OQ_POOLS.map((p) => openQualifier(year, p, 0))
  out.push(make(year, 'oqFinal:Pacific', {
    name: `VCT ${year + 1}: Pacific Open Qualifier Finals`, cn: `${year + 1} 揭幕赛公开资格赛 · 太平洋决赛`, region: 'Pacific',
    layer: OQ_POOLS.filter((p) => p.league === 'Pacific').flatMap((p) => p.regions), stage: 'ascension',
    units: qualifierUnits(OQ_FINAL_DAY, false),
    plan: { kind: 'oqFinal', league: 'Pacific', cup: 0, seats: PACIFIC_FINAL.map((key) => at(`F${year}:oq0:${key}`, 0)) },
  }))
  return out
}

const DRAWN = new Map<number, CEvent[]>()

/**
 * The events of the new format a year holds: from 2027 its whole partnered
 * season and China's Ascension, and from 2026 November's open qualifiers for
 * the season after — none past the world line's last season.
 */
export function aheadEventsOf(year: number): CEvent[] {
  let hit = DRAWN.get(year)
  if (!hit) {
    hit = [
      ...(year >= FIRST_AHEAD ? season(year) : []),
      ...(year >= SHAPE_YEAR && year + 1 < WORLD_END ? winter(year) : []),
    ]
    DRAWN.set(year, hit)
  }
  return hit
}
