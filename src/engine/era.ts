import { REGION_CN } from './types'
import type { Region, StageKey } from './types'

/**
 * What the circuit looked like in a given year.
 *
 * The design decision this file exists to serve: **this is one timeline, not
 * two rule-sets.** The player picks where to *enter* — 2021 to change history,
 * 2026 to make the future — and the rules underneath change by year on their
 * own, the way they really did.
 *
 * So nothing here is keyed on "which mode". Everything is keyed on the year,
 * and a save just remembers which year it started in.
 *
 * Every figure below is checked against Riot's own announcements and
 * Liquipedia's VCT 2021/2022/2023 pages, plus the 270 events we scraped. See
 * 策划稿-2021纪元与真实赛制.md for the sources, line by line.
 */

/* ------------------------------------------------------------------ */
/*  入口                                                               */
/* ------------------------------------------------------------------ */

/** The two years a career can begin in. Decided 2026-09-10. */
export const ENTRY_YEARS = [2021, 2026] as const
export type EntryYear = (typeof ENTRY_YEARS)[number]

export const ENTRY_CN: Record<EntryYear, { name: string; tag: string; blurb: string }> = {
  2021: {
    name: '2021 · 改变历史',
    tag: '从过去开始',
    blurb: '这项运动刚有职业比赛的那一年。没有联盟，没有席位——Challengers 是开放海选，'
      + '凑齐五个人就能报名。接下来六年赛制会变三次，而你正好活在这段变化里。',
  },
  2026: {
    name: '2026 · 创造未来',
    tag: '从现在开始',
    blurb: '三大联盟加中国赛区，席位固定，签进去就有比赛打。过去五年已经写好，'
      + '奖杯柜上都是别人的名字——接下来的由你写。',
  },
}

/* ------------------------------------------------------------------ */
/*  赛制世代                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which family of rules a year belongs to.
 *
 *  - `open`      2021–2022: no leagues, open qualifiers, a dozen-plus regions
 *  - `partnered` 2023–:     three partnered leagues, Ascension underneath
 *
 * The dividing line is 2023, and it is the real one: that is the year the
 * 「报名就能打」 road closed for good.
 */
export type FormatEra = 'open' | 'partnered'

export const formatOf = (year: number): FormatEra => (year <= 2022 ? 'open' : 'partnered')

/* ------------------------------------------------------------------ */
/*  赛区                                                               */
/* ------------------------------------------------------------------ */

/** 2021: sixteen separate circuits, each running its own Challengers. */
const REGIONS_2021: Region[] = [
  'North America', 'Europe', 'Turkey', 'CIS', 'Brazil', 'LATAM',
  'Korea', 'Japan', 'SEA', 'Malaysia & Singapore', 'Indonesia',
  'Thailand', 'Philippines', 'Vietnam', 'Hong Kong & Taiwan', 'China',
]

/**
 * 2022: the consolidation begins. Turkey and CIS are folded into EMEA;
 * the smaller Asian circuits are folded into APAC (which we model as SEA,
 * the name the qualifying event actually carried).
 */
const REGIONS_2022: Region[] = [
  'North America', 'Europe', 'Brazil', 'LATAM', 'Korea', 'Japan', 'SEA', 'China',
]

/** 2023 onward: the modern three, plus China outside them until 2024. */
const REGIONS_MODERN: Region[] = ['Americas', 'EMEA', 'Pacific', 'China']

export function regionsOf(year: number): Region[] {
  if (year <= 2021) return REGIONS_2021
  if (year === 2022) return REGIONS_2022
  return REGIONS_MODERN
}

/**
 * Where a region's teams went when it was folded into a bigger one.
 *
 * A career that starts in Turkey in 2021 is in EMEA by 2023 whether the
 * player likes it or not, and the game has to be able to say so.
 */
export const MERGED_INTO: Partial<Record<Region, { into: Region; year: number }>> = {
  Turkey: { into: 'EMEA', year: 2023 },
  CIS: { into: 'EMEA', year: 2023 },
  Europe: { into: 'EMEA', year: 2023 },
  'North America': { into: 'Americas', year: 2023 },
  Brazil: { into: 'Americas', year: 2023 },
  LATAM: { into: 'Americas', year: 2023 },
  Korea: { into: 'Pacific', year: 2023 },
  Japan: { into: 'Pacific', year: 2023 },
  SEA: { into: 'Pacific', year: 2023 },
  'Malaysia & Singapore': { into: 'SEA', year: 2022 },
  Indonesia: { into: 'SEA', year: 2022 },
  Thailand: { into: 'SEA', year: 2022 },
  Philippines: { into: 'SEA', year: 2022 },
  Vietnam: { into: 'SEA', year: 2022 },
  'Hong Kong & Taiwan': { into: 'SEA', year: 2022 },
  MENA: { into: 'EMEA', year: 2023 },
  'South Asia': { into: 'Pacific', year: 2023 },
  Oceania: { into: 'Pacific', year: 2023 },
}

/** Follow the mergers forward: 'Thailand' in 2026 is 'Pacific'. */
export function regionIn(region: Region, year: number): Region {
  let r = region
  for (let guard = 0; guard < 6; guard++) {
    const m = MERGED_INTO[r]
    if (!m || year < m.year) return r
    r = m.into
  }
  return r
}

/* ------------------------------------------------------------------ */
/*  头顶有几扇门                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a region could reach in a given year, in one line.
 *
 * This is the single most important sentence on a tryout offer: signing for a
 * Thai side and signing for Sentinels are not the same game, and the player
 * has to be told which one they are accepting **before** they accept it.
 */
export function doorsOf(region: Region, year: number): string {
  if (year >= 2024) return 'VCT 正赛：赛段 → 大师赛 → 冠军赛'
  if (year === 2023) {
    return region === 'China'
      ? '中国还没有联盟席位。只有冠军赛中国区资格赛这一条外卡路'
      : '联盟内赛段 → 大师赛 → 冠军赛（前提是你的俱乐部拿到了合作席位）'
  }
  if (year === 2022) {
    return region === 'China'
      ? '国内只有 FGC。世界大赛要等一张外卡邀请，进东亚 LCQ 打一场定生死'
      : '赛区 Challengers → 两站国际大师赛 → 冠军赛'
  }
  // 2021
  switch (region) {
    case 'China':
      return '没有。全年只有虎牙胖虎杯和 FGC 邀请赛，一扇国际赛的门都没有'
    case 'North America':
    case 'Europe':
      return '赛区决赛 → 雷克雅未克 / 柏林 / 冠军赛'
    case 'Turkey':
    case 'CIS':
      return '并入 EMEA Playoffs 争名额，才谈国际赛'
    case 'Brazil':
    case 'LATAM':
    case 'Korea':
    case 'Japan':
    case 'SEA':
      return '赛区决赛 → 雷克雅未克 / 柏林'
    default:
      return '先打进 SEA 区域赛，才谈国际赛'
  }
}

/** How many international slots this region had that year — 0 means no door. */
export function intlSlotsOf(region: Region, year: number): number {
  if (year !== 2021) return region === 'China' && year <= 2023 ? 0 : 1
  const berlin: Partial<Record<Region, number>> = {
    Europe: 4, 'North America': 3, Brazil: 2, Korea: 2, Japan: 2, SEA: 2, LATAM: 1,
  }
  return berlin[region] ?? 0
}

/* ------------------------------------------------------------------ */
/*  赛历                                                               */
/* ------------------------------------------------------------------ */

export interface StageDef {
  key: StageKey
  name: string
  start: number
  end: number
}

/**
 * The 2021 calendar, read off the real match days in circuit.json.
 *
 * Regions ran a few days apart, so a regional boundary sits where most of
 * them turned over; every international sits wholly inside its own window,
 * and scripts/check_era.ts holds that against the data.
 *
 * Three stages, each 「开放海选 → 赛区决赛 → 大师赛」. Stage 1's Masters is
 * regional only — no international — but it still pays circuit points, and for
 * a side that never leaves its region it is the biggest event of the year.
 */
const STAGES_2021: StageDef[] = [
  { key: 'preseason', name: '季前', start: 0, end: 19 },
  { key: 's1chal', name: '第一赛段 · 挑战者赛', start: 20, end: 68 },
  { key: 's1masters', name: '第一赛段 · 赛区大师赛', start: 69, end: 81 },
  { key: 's2chal', name: '第二赛段 · 挑战者赛', start: 82, end: 116 },
  { key: 's2finals', name: '第二赛段 · 挑战者决赛', start: 117, end: 142 },
  { key: 'masters1', name: '雷克雅未克大师赛', start: 143, end: 173 },
  { key: 's3chal', name: '第三赛段 · 挑战者赛', start: 174, end: 213 },
  { key: 's3finals', name: '第三赛段 · 挑战者决赛', start: 214, end: 243 },
  { key: 'masters2', name: '柏林大师赛', start: 244, end: 281 },
  { key: 'lcq', name: '最后机会资格赛', start: 282, end: 303 },
  { key: 'champions', name: '冠军赛', start: 304, end: 345 },
  { key: 'offseason', name: '休赛期', start: 346, end: 363 },
]

/** 2022: two internationals instead of three, and an LCQ that matters more. */
const STAGES_2022: StageDef[] = [
  { key: 'preseason', name: '季前', start: 0, end: 8 },
  { key: 's1chal', name: '第一赛段 · 挑战者赛', start: 9, end: 98 },
  { key: 'masters1', name: '雷克雅未克大师赛', start: 99, end: 118 },
  { key: 's2chal', name: '第二赛段 · 挑战者赛', start: 119, end: 189 },
  { key: 'masters2', name: '哥本哈根大师赛', start: 190, end: 210 },
  { key: 'lcq', name: '最后机会资格赛', start: 211, end: 241 },
  { key: 'champions', name: '冠军赛', start: 242, end: 260 },
  { key: 'offseason', name: '休赛期', start: 261, end: 363 },
]

/**
 * 2023: LOCK//IN São Paulo opens the partnered era — all thirty clubs and
 * China's two invitees in one bracket — then one long league season, Masters
 * Tokyo, the Last Chance Qualifiers and Champions in Los Angeles. China has
 * no league: its FGC acts and its Champions qualifier run through the spring
 * and summer (their events carry their own stages). Read off circuit.json.
 */
const STAGES_2023: StageDef[] = [
  { key: 'preseason', name: '季前', start: 0, end: 42 },
  { key: 'kickoff', name: 'LOCK//IN 圣保罗', start: 43, end: 63 },
  { key: 'stage1', name: '联赛', start: 64, end: 159 },
  { key: 'masters1', name: '东京大师赛', start: 160, end: 176 },
  { key: 'lcq', name: '最后机会资格赛', start: 177, end: 206 },
  { key: 'champions', name: '冠军赛', start: 207, end: 240 },
  { key: 'offseason', name: '休赛期', start: 241, end: 363 },
]

/** 2024: four leagues, each with its Kickoff; Madrid after Kickoff, Shanghai after Stage 1. */
const STAGES_2024: StageDef[] = [
  { key: 'preseason', name: '季前', start: 0, end: 45 },
  { key: 'kickoff', name: '揭幕赛', start: 46, end: 64 },
  { key: 'masters1', name: '马德里大师赛', start: 65, end: 88 },
  { key: 'stage1', name: '第一赛段', start: 89, end: 140 },
  { key: 'masters2', name: '上海大师赛', start: 141, end: 163 },
  { key: 'stage2', name: '第二赛段', start: 164, end: 210 },
  { key: 'champions', name: '冠军赛', start: 211, end: 240 },
  { key: 'offseason', name: '休赛期', start: 241, end: 363 },
]

/** 2025: the same shape moved earlier — Kickoff in January, Bangkok, Toronto, Champions in Paris. */
const STAGES_2025: StageDef[] = [
  { key: 'preseason', name: '季前', start: 0, end: 8 },
  { key: 'kickoff', name: '揭幕赛', start: 9, end: 47 },
  { key: 'masters1', name: '曼谷大师赛', start: 48, end: 64 },
  { key: 'stage1', name: '第一赛段', start: 65, end: 150 },
  { key: 'masters2', name: '多伦多大师赛', start: 151, end: 177 },
  { key: 'stage2', name: '第二赛段', start: 178, end: 250 },
  { key: 'champions', name: '冠军赛', start: 251, end: 281 },
  { key: 'offseason', name: '休赛期', start: 282, end: 363 },
]

/**
 * 2026 onward: the shape the game already ships. Kept here rather than
 * imported from season.ts so that every calendar lives in one file — but the
 * numbers are season.ts's, unchanged, so existing saves keep their dates.
 */
const STAGES_MODERN: StageDef[] = [
  { key: 'preseason', name: '季前准备', start: 0, end: 20 },
  { key: 'kickoff', name: '揭幕赛', start: 21, end: 62 },
  { key: 'masters1', name: '第一站大师赛', start: 63, end: 98 },
  { key: 'stage1', name: '第一赛段', start: 99, end: 164 },
  { key: 'masters2', name: '第二站大师赛', start: 165, end: 214 },
  { key: 'stage2', name: '第二赛段', start: 215, end: 280 },
  { key: 'champions', name: '冠军赛', start: 281, end: 322 },
  { key: 'offseason', name: '休赛期', start: 323, end: 363 },
]

export function stagesOf(year: number): StageDef[] {
  if (year <= 2021) return STAGES_2021
  if (year === 2022) return STAGES_2022
  if (year === 2023) return STAGES_2023
  if (year === 2024) return STAGES_2024
  if (year === 2025) return STAGES_2025
  return STAGES_MODERN
}

export const stageAtIn = (year: number, day: number): StageKey =>
  stagesOf(year).find((s) => day >= s.start && day <= s.end)?.key ?? 'offseason'

/**
 * Tier-2 splits and Ascension run beside the partnered calendar rather than
 * being a slice of it, so they have names but no dates. They did not exist
 * before 2023: an open-era year has no 挑战者联赛第一赛段 to name.
 */
const OFF_CALENDAR: Partial<Record<StageKey, string>> = {
  challengers1: '挑战者联赛第一赛段', challengers2: '挑战者联赛第二赛段', challengers3: '挑战者联赛第三赛段',
  ascension: '晋升赛',
}

export const stageNameIn = (year: number, key: StageKey): string =>
  stagesOf(year).find((s) => s.key === key)?.name
  ?? (formatOf(year) === 'partnered' ? OFF_CALENDAR[key] : undefined)
  ?? key

/* ------------------------------------------------------------------ */
/*  赛区积分（2021）                                                    */
/* ------------------------------------------------------------------ */

/**
 * The real 2021 circuit point table, read off Riot's own chart
 * (`04_Circuit_Point_Awards_March_26_21.jpg`).
 *
 * Two things in here are worth keeping rather than smoothing out:
 *
 *  1. **Winning a Challengers Playoff pays nothing.** The winner goes to
 *     Masters instead; the points are the consolation for everyone who did
 *     not. So the table quietly rewards the side that keeps just missing —
 *     which is exactly the mid-table player's story.
 *  2. **An international is worth four regional titles.** A side that never
 *     leaves its region tops out at 100 + 50 + 75 = 225 for the whole year;
 *     one win at Masters is 400. The ceiling gap is written into the points.
 */
export const CIRCUIT_POINTS_2021: Record<string, number[]> = {
  // 1st 2nd 3rd 4th 5th 6th 7th 8th …
  s1masters: [100, 70, 50, 35, 20, 20, 10, 10],
  s2finals: [0, 50, 40, 35, 30, 25, 20, 20],
  masters1: [400, 350, 300, 250, 200, 200, 175, 175, 150, 150],
  s3finals: [0, 75, 60, 50, 45, 40, 40, 40],
  masters2: [0, 375, 325, 325, 275, 275, 275, 275, 225, 225, 225, 225, 175, 175, 175, 175],
}

/** 1st at the Berlin Masters skipped the points and went straight to Champions. */
export const MASTERS2_WINNER_QUALIFIES = true

export function circuitPointsFor(stage: StageKey, place: number): number {
  return CIRCUIT_POINTS_2021[stage]?.[place] ?? 0
}

/**
 * The most a side that never reaches an international can earn in 2021.
 * Used by the UI to say 「你这条路最高能攒多少分」 honestly.
 */
export const DOMESTIC_POINT_CEILING_2021 =
  CIRCUIT_POINTS_2021.s1masters[0] + CIRCUIT_POINTS_2021.s2finals[1] + CIRCUIT_POINTS_2021.s3finals[1]

/* ------------------------------------------------------------------ */
/*  2023 合作战队                                                       */
/* ------------------------------------------------------------------ */

/**
 * The thirty clubs Riot partnered in 2023, exactly as it happened.
 *
 * This list is the sharpest edge of the whole era, because it was **not a
 * sporting decision**: Acend won Champions 2021 and is not on it. Neither is
 * G2. Karmine Corp, KOI and Team Heretics are — and none of them were a top
 * VALORANT side in 2021.
 *
 * Decided 2026-09-10 (方案 C): the list stands as history, **except that the
 * player's own club gets one judgement**. Play well enough in 2022 and your
 * club displaces the weakest name here; fall short and you watch from the
 * Challengers League like everyone else. The world bends around the player
 * and nowhere else — which is the rule the whole era runs on.
 */
export const PARTNER_TEAMS_2023: Record<'Americas' | 'EMEA' | 'Pacific', string[]> = {
  Americas: ['100 Thieves', 'Cloud9', 'Evil Geniuses', 'FURIA Esports', 'KRÜ Esports',
    'Leviatán', 'LOUD', 'MIBR', 'NRG', 'Sentinels'],
  EMEA: ['BBL Esports', 'Fnatic', 'FUT Esports', 'Giants', 'Karmine Corp', 'KOI',
    'Natus Vincere', 'Team Heretics', 'Team Liquid', 'Team Vitality'],
  Pacific: ['DetonatioN FocusMe', 'DRX', 'Gen.G', 'Global Esports', 'Paper Rex',
    'Rex Regum Qeon', 'T1', 'TALON', 'Team Secret', 'ZETA DIVISION'],
}

/** China had no league at all until 2024 — that is history and does not bend. */
export const CHINA_LEAGUE_FROM = 2024

/* ------------------------------------------------------------------ */
/*  世界线分叉                                                          */
/* ------------------------------------------------------------------ */

/**
 * How far the player's presence reaches.
 *
 * 「世界线的改变会围绕玩家展开，在玩家够不着的地方原本是什么样就还是什么样。」
 *
 * Layers 0–2 are simulated; layer 3 keeps the real result. The radius grows
 * with the career on its own: a rookie on a Thai side has almost the whole
 * world in layer 3, and by the time he is in VCT proper the internationals
 * have moved into layer 2.
 *
 * This is only possible because we hold six years of real results. 破晓 ships
 * one seed year and simulates everything after it; we can point at a match and
 * say 「真实历史里这场是 Sentinels 赢的，在你的世界线里是你们」.
 */
export type WorldLayer = 0 | 1 | 2 | 3

export function layerOf(opts: {
  /** the player is on one of the two rosters */
  playing: boolean
  /** the event belongs to the player's own region */
  ownRegion: boolean
  /** the player's club is in this event, with or without him on the floor */
  ownClub: boolean
}): WorldLayer {
  if (opts.playing) return 0
  if (opts.ownClub) return 2
  if (opts.ownRegion) return 1
  return 3
}

/** Layer 3 keeps history; everything nearer is simulated. */
export const isHistorical = (layer: WorldLayer): boolean => layer === 3

/** A one-line description of a region for the offer screen. */
export const regionLabel = (region: Region, year: number): string =>
  `${REGION_CN[region]}（${year} 年）`
