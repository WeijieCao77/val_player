import { clamp, hashStr } from '../rng'
import type { GameState, Region } from '../types'

/**
 * The ranked ladder as the client shows it: a tier, a division and RR, and from
 * 神话 up a place on the server's own leaderboard, where 辐能战魂 is its top 500.
 *
 * The author, 2026-09-14: 「现在段位会显示辐能战魂但不知道多少名，而且辐能不是一共就
 * 只有500个吗」. He was right — a ladder score of 52–62 read 「辐能战魂」 with no
 * place at all, and the places it did print disagreed with the tier names and
 * the 前一百 achievement. What the real game does, from Riot's own pages:
 *
 * - Nine tiers, 黑铁 to 神话 in three divisions and 辐能战魂 alone. 100 RR a
 *   division below 神话; from 神话 up RR has no ceiling
 *   (wiki.playvalorant.com/en-us/Competitive).
 * - A leaderboard per region since Episode 2 Act I, January 2021: every 神话 and
 *   辐能战魂 is on it, 辐能战魂 is the top 500, and for them the rank bar gives
 *   way to the leaderboard place ("VALORANT Episode 2 Act I Competitive Changes").
 * - 辐能战魂 also asks a floor in RR: 300 on NA, EU and AP, 200 on BR, 100 on KR
 *   and LATAM (the wiki). Patch 12.05 (2026-03-17) moved the 神话 2 / 神话 3 /
 *   辐能战魂 floors "for parity" without printing them, so the wiki's stand.
 * - 神话 was one rank until patch 3.05 (2021-09-08); 超凡入圣 came with 5.0,
 *   Episode 5 Act I (2022-06-22). The China server opened 2023-07-12; before it
 *   a Chinese player queued on 亚服.
 *
 * The engine keeps one number, `pre.ladder` 0–100 (me/prepro.ts), and every rule
 * that reads the ladder — invitations, tryouts, the talks, the following, the
 * events — keeps reading that number. This file only says what the number is:
 * how much of the ranked population stands above it, which division and RR
 * that makes, and from 神话 up the place on this server's board.
 */

export type ServerKey = 'CN' | 'AP' | 'NA' | 'EU' | 'KR' | 'BR' | 'LATAM'

export interface Server {
  key: ServerKey
  name: string
  /**
   * Ranked players in an act, roughly. Riot publishes none of these: KR, BR and
   * LATAM follow the trackers' counts, the big four are set so that each fills
   * its 500 辐能战魂 places above its RR floor, as their boards do.
   */
  pop: number
  /** the RR 辐能战魂 asks as well as the top 500 */
  radiantRR: number
}

export const SERVERS: Record<ServerKey, Server> = {
  CN: { key: 'CN', name: '国服', pop: 3_000_000, radiantRR: 300 },
  EU: { key: 'EU', name: '欧服', pop: 2_400_000, radiantRR: 300 },
  AP: { key: 'AP', name: '亚服', pop: 2_100_000, radiantRR: 300 },
  NA: { key: 'NA', name: '北美服', pop: 1_900_000, radiantRR: 300 },
  KR: { key: 'KR', name: '韩服', pop: 300_000, radiantRR: 100 },
  BR: { key: 'BR', name: '巴西服', pop: 220_000, radiantRR: 200 },
  LATAM: { key: 'LATAM', name: '拉美服', pop: 200_000, radiantRR: 100 },
}

/** 辐能战魂 places on every server's board */
export const RADIANT_SLOTS = 500

/** Which server a scene queues on: Japan, Oceania and South Asia are AP; Turkey, CIS and MENA are EU. */
const SHARD: Record<Region, ServerKey> = {
  Americas: 'NA', EMEA: 'EU', Pacific: 'AP', China: 'CN',
  'North America': 'NA', Europe: 'EU', Turkey: 'EU', CIS: 'EU', Brazil: 'BR', LATAM: 'LATAM',
  Korea: 'KR', Japan: 'AP', SEA: 'AP', 'Malaysia & Singapore': 'AP', Indonesia: 'AP',
  Thailand: 'AP', Philippines: 'AP', Vietnam: 'AP', 'Hong Kong & Taiwan': 'AP',
  MENA: 'EU', 'South Asia': 'AP', Oceania: 'AP',
}

const dayOfYear = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000)
const since = (year: number, day: number, y: number, m: number, d: number) => year > y || (year === y && day >= dayOfYear(y, m, d))

/** 国服 opened 2023-07-12 */
export const cnServerOpen = (year: number, day: number): boolean => since(year, day, 2023, 7, 12)

export function serverAt(region: Region, year: number, day: number): Server {
  const k = SHARD[region] ?? 'AP'
  return SERVERS[k === 'CN' && !cnServerOpen(year, day) ? 'AP' : k]
}

/** The server my ranked is on: where I come from (新生涯页「来自」), on today's date. */
export const serverOf = (state: GameState): Server => serverAt(state.me?.region ?? 'China', state.year, state.day)

/** The rules of the day: 超凡入圣 from Episode 5 (5.0), 神话 1/2/3 from patch 3.05. 2027 on keeps 2026's. */
export function rulesAt(year: number, day: number): { ascendant: boolean; immortalDivs: boolean } {
  return { ascendant: since(year, day, 2022, 6, 22), immortalDivs: since(year, day, 2021, 9, 8) }
}

/**
 * Share of ranked players in each division from 铂金 1 up — esportstales.com,
 * read from Riot's API, V26 Act V (September 2026). 1.42% are 神话 or better.
 */
const SHARE = {
  铂金: [0.0762, 0.0583, 0.0411],
  钻石: [0.0511, 0.0380, 0.0264],
  超凡入圣: [0.0324, 0.0201, 0.0107],
  神话: [0.0098, 0.0022, 0.0017],
  辐能战魂: 0.0005,
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** the share at or above 神话 1 */
const IMM = sum(SHARE.神话) + SHARE.辐能战魂
/** the share at or above the floor of each division of a tier, division 1 first */
const floorsOf = (shares: number[], above: number) => shares.map((_, i) => above + sum(shares.slice(i)))
const ASC = floorsOf(SHARE.超凡入圣, IMM)
const DIA = floorsOf(SHARE.钻石, ASC[0])
const PLA = floorsOf(SHARE.铂金, DIA[0])

/**
 * Ladder score → the log of the share of the population above it. The tier
 * floors sit where the score's tiers always sat (铂金 0, 钻石 16, 超凡入圣 30, 神话
 * 42), and above 神话 the places are set on 国服 as the old tier names had them:
 * 62 the top 500 (where the ladder invitations open, prepro.ts INVITE_LADDER) —
 * 480th, so it stays inside the 500 however the board wanders that week — 72 the
 * top 100 (the 前一百 achievement), 82 the top 10, 96 the first. Straight lines
 * between, in log share.
 */
const LADDER_IMM = 42
const REF = SERVERS.CN.pop
const KNOTS: readonly (readonly [number, number])[] = [
  [0, Math.log(PLA[0])], [16, Math.log(DIA[0])], [30, Math.log(ASC[0])], [LADDER_IMM, Math.log(IMM)],
  [62, Math.log(480 / REF)], [72, Math.log(100 / REF)], [82, Math.log(10 / REF)], [96, Math.log(1 / REF)],
]

function lnAbove(l: number): number {
  const x = clamp(l, 0, 100)
  let i = 1
  while (i < KNOTS.length - 1 && x > KNOTS[i][0]) i++
  const [x0, y0] = KNOTS[i - 1]
  const [x1, y1] = KNOTS[i]
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

function ladderAtLn(y: number): number {
  for (let i = 1; i < KNOTS.length; i++) {
    const [x0, y0] = KNOTS[i - 1]
    const [x1, y1] = KNOTS[i]
    if (y >= y1 || i === KNOTS.length - 1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)
  }
  return 100
}

interface Division { tier: string; div: number; lo: number }
const divisions = (tiers: [string, number[]][]): Division[] =>
  tiers.flatMap(([tier, floors]) => floors.map((q, i) => ({ tier, div: i + 1, lo: ladderAtLn(Math.log(q)) })))
const DIVS_MODERN = divisions([['铂金', PLA], ['钻石', DIA], ['超凡入圣', ASC]])
/** before 超凡入圣, 钻石 ran from its own floor to 神话's, a third of the population ratio a division */
const DIVS_OLD = divisions([['铂金', PLA], ['钻石', [0, 1, 2].map((k) => Math.exp(Math.log(DIA[0]) + (k / 3) * (Math.log(IMM) - Math.log(DIA[0]))))]])

/**
 * RR per unit of log share above 神话 1's floor. 75 puts 国服's 500th at about
 * 330 RR, over its 300 floor, and a win at 神话 near +25 RR, as the client pays.
 */
const THETA = 75
const LN_IMM = Math.log(IMM)
/** 神话 2 and 神话 3 on a big server, where the shares put them: about 88 and 140 RR */
const RR_I2 = THETA * Math.log(IMM / (SHARE.神话[1] + SHARE.神话[2] + SHARE.辐能战魂))
const RR_I3 = THETA * Math.log(IMM / (SHARE.神话[2] + SHARE.辐能战魂))

/** how far a server's size wanders in a month, either way */
const DRIFT = 0.04

/**
 * How many rank on this server this week. The game grew into 2023 and holds
 * there; around that, a slow wander of a few percent, fixed by the save's seed,
 * so the same week always reads the same and one week is never far from the next.
 */
export function boardPop(state: Pick<GameState, 'year' | 'day' | 'seed'>, server: Server): number {
  const t = state.year + state.day / 365
  const growth = clamp(0.75 + (t - 2021) * 0.125, 0.75, 1)
  const w = (state.year - 2021) * 52 + Math.floor(state.day / 7)
  const k = Math.floor(w / 4)
  const f = (w - k * 4) / 4
  const knot = (i: number) => ((hashStr(`ladder:${state.seed}:${server.key}:${i}`) >>> 0) / 4294967296) * 2 - 1
  const n = knot(k) + ((knot(k + 1) - knot(k)) * (1 - Math.cos(Math.PI * f))) / 2
  return server.pop * growth * (1 + DRIFT * n)
}

export interface Rank {
  server: Server
  tier: string
  /** 1–3; 0 for 辐能战魂, and for 神话 before patch 3.05 */
  div: number
  /** 「超凡入圣 2」「神话 3」「辐能战魂」 */
  name: string
  rr: number
  /** the leaderboard place, from 神话 up */
  pos: number | null
  /** how many are on that board */
  board: number | null
  radiant: boolean
  /** grows with the score, for ordering */
  order: number
}

export function rankAt(state: GameState, l: number = state.me?.pre?.ladder ?? 0, server: Server = serverOf(state)): Rank {
  const x = clamp(Number.isFinite(l) ? l : 0, 0, 100)
  const rules = rulesAt(state.year, state.day)
  if (x < LADDER_IMM) {
    const list = rules.ascendant ? DIVS_MODERN : DIVS_OLD
    let i = 0
    while (i + 1 < list.length && x >= list[i + 1].lo) i++
    const d = list[i]
    const hi = i + 1 < list.length ? list[i + 1].lo : LADDER_IMM
    const rr = clamp(Math.floor(((x - d.lo) / (hi - d.lo)) * 100), 0, 99)
    return { server, tier: d.tier, div: d.div, name: `${d.tier} ${d.div}`, rr, pos: null, board: null, radiant: false, order: i * 1000 + rr }
  }
  const ln = lnAbove(x)
  const pop = boardPop(state, server)
  const rr = Math.max(0, Math.floor(THETA * (LN_IMM - ln)))
  // the players above me, and me: first only once nobody is left above
  const pos = Math.max(1, Math.ceil(pop * Math.exp(ln)))
  const board = Math.ceil(pop * IMM)
  const radiant = pos <= RADIANT_SLOTS && rr >= server.radiantRR
  // smaller servers set every floor lower, as Riot sets their 辐能战魂 floor lower
  const scale = server.radiantRR / 300
  const div = radiant || !rules.immortalDivs ? 0 : rr >= RR_I3 * scale ? 3 : rr >= RR_I2 * scale ? 2 : 1
  const tier = radiant ? '辐能战魂' : '神话'
  return { server, tier, div, name: div ? `${tier} ${div}` : tier, rr, pos, board, radiant, order: 100_000 + rr }
}

const place = (r: Rank) => (r.pos === 1 ? `${r.server.name}第一` : `${r.server.name}第 ${(r.pos ?? 0).toLocaleString('en-US')} 名`)

/** The words: 「超凡入圣 2」, and from 神话 up the place, which the client itself puts where the rank bar was. */
export const rankText = (r: Rank): string => (r.pos === null ? r.name : `${r.name} · ${place(r)}`)

/** With the 数值 switch: RR as well. */
export const rankFull = (r: Rank): string => (r.pos === null ? `${r.name} · ${r.rr} RR` : `${r.name} · ${r.rr} RR · ${place(r)}`)

/** For a table cell: 「辐能战魂 第 87」. */
export const rankShort = (r: Rank): string => (r.pos === null ? r.name : `${r.name} 第 ${r.pos.toLocaleString('en-US')}`)

const roundPlace = (n: number) => (n < 20 ? n : n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 50) * 50 : Math.round(n / 500) * 500)

/** A ladder score as a line to aim at, on my server: 「辐能战魂（国服前 500 名左右）」. */
export function rankBar(state: GameState, l: number): string {
  const r = rankAt(state, l)
  if (r.pos === null) return r.name
  return `${r.name}（${r.server.name}前 ${roundPlace(r.pos).toLocaleString('en-US')} 名${r.pos >= 20 ? '左右' : ''}）`
}
