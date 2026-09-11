import type { Attrs, Region, SquadRole } from '../types'

/** What a week's action points can be spent on. */
export type MeAction =
  | 'aim' | 'vod' | 'util' | 'ranked' | 'scrim' | 'duo' | 'stream' | 'content' | 'rest' | 'duel'

/** An in-round decision is judged on one of the eight attributes, or on nerve. */
export type NodeDim = keyof Attrs | 'mental'

export type LogKind = 'match' | 'train' | 'team' | 'money' | 'info' | 'good' | 'bad' | 'season' | 'event' | 'cup' | 'deal'

/** The rows a dollar can land on — see me/money.ts for what each one means. */
export type MoneyKind =
  | 'salary' | 'prize' | 'sign' | 'media' | 'inother'
  | 'agent' | 'living' | 'upkeep' | 'gear' | 'course' | 'relax' | 'fee' | 'fine' | 'outother'

/** The nights that are not matches - see me/ceremony.ts. */
export type CerKind = 'draw' | 'depart' | 'final' | 'media' | 'rehab' | 'farewell'
export type CerTier = 'gold' | 'silver' | 'bronze'

export interface Ceremony {
  kind: CerKind
  /** 0 story, 1 the little game, 2 the result */
  step: number
  tier?: CerTier
  /** the competition, the city, the injury - whatever this night is about */
  about?: string
  detail?: { tone?: string; score?: number; ms?: number; hits?: number }
}

export interface LedgerBook {
  in: Partial<Record<MoneyKind, number>>
  out: Partial<Record<MoneyKind, number>>
}

export interface Ledger {
  /** this stage */
  cur: LedgerBook
  /** the stage before, kept so the screen can compare */
  prev: LedgerBook | null
  label: string
  prevLabel: string
  lifetimeIn: number
  lifetimeOut: number
}

export interface MeLog { day: number; year: number; kind: LogKind; text: string }

/** Where the career is: chasing a contract, under one, between two, or done. */
export type Phase = 'pre' | 'pro' | 'free' | 'retired'

/** The ledger of one in-round call: what it was, the odds at the time, how it went. */
export interface NodeLogEntry {
  map: string
  round: number
  q: string
  pick: string
  dim: NodeDim
  /** success chance at the moment of the call, percent */
  p: number
  ok: boolean
  /** map win estimate before and after, percent */
  before: number
  after: number
  /** my value on the attribute the call was judged on, and the other side's
      average on the same one — so the line can say 反应 78 对 71 */
  mine?: number
  theirs?: number
  /** the one-line story of what the call did, written into that round */
  hl?: string
}

/** One player's line on the all-ten table after a series. */
export interface BoxRow {
  id: string
  ign: string
  role: string
  mine: boolean
  me: boolean
  k: number
  d: number
  a: number
  acs: number
  rating: number
  firstKills: number
  clutches: number
  rounds: number
}

/** Which of us was carrying, on the older/younger × stronger/weaker axes. */
export type BondRole = 'carried' | 'anchor' | 'passed' | 'mentor' | 'equal'

/** One person I shared a roster with. Written once, kept for the whole career. */
export interface BondEntry {
  id: string
  ign: string
  role: string
  firstYear: number
  lastYear: number
  /** the club we met at */
  team: string
  /** stages we finished together */
  stages: number
  /** matches played alongside */
  matches: number
  /** trophies won while both of us were on the roster */
  titles: string[]
  /** the closest we ever got */
  peakBond: number
  /** stage key → what I was to him that stage */
  roles: Record<string, BondRole>
  gone?: 'left' | 'retired'
  goneYear?: number
}

/** One scene of a practice duel, answered. */
export interface DuelSceneLog {
  r: number
  t: string
  dim: string
  p: number
  ok: boolean
  mine: number
  his: number
  /** landed on a high-risk option — the coaching staff writes those down */
  flash: boolean
  line: string
}

/** A practice duel against the starter in my slot, played a scene at a time. */
export interface DuelLive {
  himId: string
  sc: [number, number]
  round: number
  /** scene indices drawn for this duel */
  pool: number[]
  rounds: DuelSceneLog[]
  flash: number
  done: boolean
  verdict?: string
  trial?: boolean
  edge?: number
}

export interface MeMatchRecord {
  fixtureId: string
  day: number
  year: number
  comp: string
  label: string
  opp: string
  oppTag: string
  started: boolean
  won: boolean
  /** a level Bo2 — `won` is false and so is a loss */
  drawn?: boolean
  score: string
  maps: number
  rounds: number
  kills: number
  deaths: number
  assists: number
  firstKills: number
  clutches: number
  acs: number
  rating: number
  mvp: boolean
  /** lost, but posted the best line on my side — the scouts read that */
  carried: boolean
  nodes: NodeLogEntry[]
  /** where I ranked by ACS on my own side, 1 = best; 0 when I did not play */
  rank: number
  /** the rounds that were about me — engine highlights with my name on them,
      plus what my own calls did */
  highlights?: string[]
  /** why it went that way: the engine's own terms, ours minus theirs */
  edge?: { key: string; label: string; diff: number; advice: string }[]
  /** the honest one-liner, including "the numbers were ours and we lost" */
  verdict?: string
  /** where it went wrong on my own five, when that can be said */
  blame?: string | null
  /** all ten, from the engine's real lines — kept only for recent matches */
  box?: BoxRow[]
  /** how the direct matchup with a name went, if there was one */
  starBeat?: string
  /** per map: what the win estimate was when it began, and how it went */
  mapLog?: { map: string; before: number; won: boolean }[]
  /** a cup or exhibition rather than a league fixture */
  friendly?: boolean
}

export interface MeSeason {
  year: number
  team: string
  tier: 1 | 2 | 0
  matches: number
  starts: number
  wins: number
  acs: number
  overallFrom: number
  overallTo: number
  titles: string[]
}

/** A generated team-mate for a cup run — five strangers, one of them me. */
export interface PickupMate {
  id: string
  ign: string
  role: string
  overall: number
}

export interface CupRun {
  key: string
  year: number
  /** rounds won */
  reached: number
  rounds: number
  won: boolean
  prize: number
}

export interface Invite {
  id: string
  teamId: string
  /** how they heard of me */
  via: 'cup' | 'rank' | 'fans' | 'scout' | 'free'
  day: number
  expires: number
  /** seen enough to skip the tryout */
  direct: boolean
}

export interface TryoutDayLog { day: number; pick: string; dim: string; p: number; ok: boolean }

export interface Tryout {
  inviteId: string
  teamId: string
  startDay: number
  /** which of the four days is next, 0-3; 4 = finished */
  step: number
  score: number
  log: TryoutDayLog[]
  grade?: string
}

/** Contract terms on the table — from a tryout, a rival club, or my own club. */
export interface Deal {
  id: string
  teamId: string
  kind: 'sign' | 'transfer' | 'renew'
  tier: 1 | 2
  role: SquadRole
  salary: number
  signBonus: number
  years: number
  buyout: number
  /** what I already asked for */
  asks: string[]
  /** how many times they pushed back */
  blown: number
  leverage: number
  grade: string
  day: number
  expires: number
  /** a move abroad — language and distance come with it */
  abroad: boolean
}

export interface PreState {
  /** how many years I have been chasing a contract, 1-based */
  year: number
  /** 0-100 ladder score */
  ladder: number
  ladderPeak: number
  cups: CupRun[]
  /** how many times a club's people wrote my name down */
  scoutSeen: number
  invites: Invite[]
  /** `${year}:${key}` milestones already offered */
  seen: string[]
  /** 战术素养 0-60: what playing with a five teaches that ranked cannot */
  tac: number
  mates: PickupMate[]
  /** the cup in progress, if any */
  cup?: { key: string; round: number; alive: boolean; mates: PickupMate[]; results: string[] }
  /** a former pro on the market keeps his record but starts here again */
  wasPro: boolean
}

export interface StreamDealMe {
  platform: string
  /** signed with the club's partner platform */
  club: boolean
  guarantee: number
  clubCut: number
  minPerStage: number
  untilYear: number
}

export interface StreamOffer {
  id: string
  tier: 'B' | 'S'
  platform: string
  clubPlatform: string
  sign: number
  guarantee: number
  day: number
  expires: number
}

export interface Quest {
  id: string
  title: string
  kind: 'stream' | 'train' | 'ranked' | 'win' | 'scrim'
  need: number
  done: number
  deadline: number
  rewardText: string
  penaltyText: string
  reward: EffectSpec
  penalty: EffectSpec
}

/** A bundle of consequences, applied by fx.apply — the same shape events, quests and traits use. */
export interface EffectSpec {
  money?: number
  heat?: number
  fans?: number
  tilt?: number
  mental?: number
  body?: number
  fatigue?: number
  form?: number
  morale?: number
  coachTrust?: number
  gmTrust?: number
  /** a random team-mate's bond with me */
  bond?: number
  /** progress on the eight, in xp */
  xp?: Partial<Record<keyof Attrs, number>>
  ladder?: number
  scoutSeen?: number
  quest?: string
  note?: string
}

export type Axis = 'hard' | 'warm' | 'grind' | 'show'

/** Where the eight ceilings stand and what already counts toward breaking them — see me/bottleneck.ts. */
export interface BottleneckState {
  /** ceiling points opened by the paths you work at, per attribute */
  mech: Partial<Record<keyof Attrs, number>>
  /** ceiling points opened by milestones, per attribute — a pool of its own */
  mile: Partial<Record<keyof Attrs, number>>
  /** professional seasons that have loosened all eight */
  exp: number
  /** one-off sources already paid */
  seen: string[]
  /** sessions, clutches or maps counted while an attribute sat at its ceiling */
  count: Partial<Record<keyof Attrs, number>>
  /** weeks in a row with at least two 枪法训练 */
  aimStreak: number
  /** career clutches and maps at the last count, so only what came after counts */
  clutchMark: number
  mapsMark: number
  /** attributes at their ceiling at the last settlement, so reaching one is said once */
  pinned: (keyof Attrs)[]
  /** the potential last derived from the ceilings — anything above it is the winter's re-rating */
  pot: number
}

export interface PendingItem {
  kind: 'cup' | 'invite' | 'tryout' | 'deal' | 'stream' | 'event' | 'trait' | 'season' | 'ending' | 'released' | 'ceremony' | 'folding'
  id?: string
  day: number
}

export interface MeState {
  /** my player id in state.players */
  id: string
  originKey: string
  phase: Phase
  /** career weeks completed */
  week: number
  /** days already advanced inside the current week, 0-7 */
  weekDay: number
  ap: number
  apMax: number
  plan: Partial<Record<MeAction, number>>
  /** who the 双排 goes to */
  duoWith?: string
  /** 心态 0-100: nerve in the big moments, resistance to tilt */
  mental: number
  /** 体质 0-100: recovery and injury resistance */
  body: number
  /** 0-100, climbs with defeats, drags on play above 55 */
  tilt: number
  /** starter-competition capital earned in practice duels */
  edge: number
  duelsThisWeek: number
  /** practice rounds the coach has seen, added to my sample for selection */
  scrimRounds: number
  trial?: { left: number; displaced: string; forgiven: boolean }
  /** day until which the coach will not consider me after a benching */
  benchLock?: number
  badStreak: number
  /** losses with me near the bottom, in a row — the coach starts trying other fives */
  rotateHeat?: number
  /** everyone who ever shared a roster with me — see me/bond.ts, never pruned */
  mates?: Record<string, BondEntry>
  /** matches played this stage, so a two-game stage cannot define a role */
  bondStageMatches?: number
  /** a practice duel in progress, scene by scene */
  duelLive?: DuelLive
  /** confirmed as a starter: selection reads my full rating, not the rookie discount */
  proven: boolean
  coachTrust: number
  gmTrust: number
  fans: number
  heat: number
  money: number
  /** 话语权的两个动作各自的冷却，按赛段计 — see me/clout.ts */
  cloutCd?: { list: number; sign: number }
  /** the eight ceilings' book; absent in saves from before them, filled at the next settlement */
  bottleneck?: BottleneckState
  /** the ceremony on screen right now */
  cer?: Ceremony
  /** ceremonies already held, as keys - each fires once */
  cerSeen?: string[]
  /** 出征 changed how fast the body comes back, until this day */
  cerRest?: { until: number; mul: number }
  /** 决赛入场 left something on the next match */
  cerMatch?: { fixture: string; nudge: number; node: number; until: number }
  /** every dollar in and out, by stage — see me/money.ts, written only by addMoney() */
  ledger?: Ledger
  /** competitions whose prize share has already been paid, as `year:compKey` */
  prizePaid?: string[]
  /** weekly outgoing the background left me with */
  upkeep: number
  log: MeLog[]
  matches: MeMatchRecord[]
  /** engine digest lines collected during the week, shown on the week screen */
  weekNotes: string[]
  /** a fixture the week stopped on, still to be played */
  pendingFixture?: string
  /** my match today that the clock stopped in front of — for a decision, or as the week turned into days — opened on the next press (me/week.ts dueToday) */
  dueFixture?: string
  /** things waiting on me before the clock moves */
  pending: PendingItem[]
  seasons: MeSeason[]
  seasonStart: { year: number; overall: number; matches: number; starts: number; wins: number; acsSum: number }
  lastLineupIn?: boolean
  /** stages this season I sat out entirely — the scouts count those */
  benchedStages: number
  startedThisStage: number
  playedThisStage: number

  pre: PreState
  tryout?: Tryout
  deals: Deal[]
  /** clubs that wrote me down at a stage's end */
  intents: { teamId: string; day: number }[]
  /** clubs that offered this year and were turned down */
  declined: string[]
  /** the year I asked to be listed */
  listedYear?: number
  /** seasons at the current club */
  tenure: number
  /** years spent with no club as a former pro */
  freeYears: number
  region: Region
  /** playing outside my home region */
  abroad: boolean

  stream: {
    /** index into STREAM_CUTS */
    cut: number
    deal?: StreamDealMe
    offer?: StreamOffer
    thisStage: number
    total: number
  }
  gear: Record<string, number>
  courses: string[]
  agentTier: number
  relaxUsed: number

  axes: Record<Axis, number>
  traits: string[]
  eventCounts: Record<string, number>
  pendingEvent?: string
  quests: Quest[]
  eventsSeen: number

  auto: { buy: boolean; biz: boolean; daily: boolean; career: boolean }
  autoNotes: string[]

  achievements: string[]
  titles: { year: number; title: string; started: boolean }[]
  ending?: { key: string; title: string; text: string; year: number }
  retireAsk?: boolean
  flags: Record<string, number>
}
