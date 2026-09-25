import type { Attrs, Region, Role, SquadRole } from '../types'
import type { CompClass } from './compclass'
import type { Cur } from './currency'
import type { CareerEventState } from './eventState'

/** What a week's action points can be spent on. */
export type MeAction =
  | 'aim' | 'vod' | 'util' | 'ranked' | 'scrim' | 'duo' | 'stream' | 'content' | 'rest' | 'duel'

/** An in-round decision is judged on one of the eight attributes, or on nerve. */
export type NodeDim = keyof Attrs | 'mental'

export type LogKind = 'match' | 'train' | 'team' | 'money' | 'info' | 'good' | 'bad' | 'season' | 'event' | 'cup' | 'deal'

/** The rows a dollar can land on — see me/money.ts for what each one means. */
export type MoneyKind =
  | 'salary' | 'prize' | 'sign' | 'media' | 'biz' | 'inother'
  | 'agent' | 'living' | 'upkeep' | 'gear' | 'course' | 'relax' | 'life' | 'family' | 'public' | 'asset' | 'fee' | 'fine' | 'outother'

/** The nights that are not matches - see me/ceremony.ts, and me/nights.ts for the last five. */
export type CerKind = 'draw' | 'depart' | 'final' | 'media' | 'rehab' | 'farewell'
  | 'awards' | 'retire' | 'patch' | 'showmatch' | 'tryout'
export type CerTier = 'gold' | 'silver' | 'bronze'

export interface Ceremony {
  kind: CerKind
  /** 0 story, 1 the little game, 2 the result */
  step: number
  tier?: CerTier
  /** the competition, the city, the injury - whatever this night is about */
  about?: string
  detail?: { tone?: string; score?: number; ms?: number; hits?: number; pick?: string; stumbles?: number; aces?: number }
}

/** A category I was read out for at a year's awards night - see me/nights.ts. */
export interface MeAward {
  year: number
  key: 'mvp' | 'rookie' | 'role'
  name: string
  /** what it was judged over: a league, or a region's tier in the open era */
  league: string
  won: boolean
  winner: string
  winnerTeam: string
  /** everyone read out, me included, best first */
  nominees: string[]
  /** the same people by player id, and their clubs as read out — absent for a night from before (ui/me/MomentQueue.tsx faces) */
  nomineeIds?: string[]
  nomineeTeams?: string[]
  /** my season rating, as it was judged */
  rating: number
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
  /** map win estimate, percent: `before` at the moment of the call, `after` once
      the round it was about had been played — the score that round left, so the
      two are what happened, not a projection. Equal until that round is played.
      (Matches saved before 2026-09-12 hold a projection in `after`.) */
  before: number
  after: number
  /** my value on the attribute the call was judged on, and the other side's
      average on the same one — so the line can say 反应 78 对 71 */
  mine?: number
  theirs?: number
  /** the one-line story of what the call did, written into that round once it
      had been played */
  hl?: string
  /** the node and the option, so the line can be looked up again */
  id?: string
  opt?: number
  /** how the round it was about went: taken or not, and my kills in it */
  won?: boolean
  kills?: number
  /** the call was the round itself — a 1v2 with me the last one standing — so it settled it */
  decided?: boolean
  /** this round's win chance, percent, had the call landed and had it not — what the button said */
  qok?: number
  qfail?: number
  /** the option the hint favoured, and which pool line was read out when it came from the pool (me/nodes.ts NODE_HINTS) */
  fav?: number
  hk?: number
  /** the fact the hint stated ('pool' for a pool line, which states none) and the line itself (me/hints.ts); absent before 2026-09-12 */
  fact?: string
  hint?: string
  /** taken by 快进 or 托管: the coach's pick, with nobody in the chair */
  auto?: boolean
  /** a call that landed on a round we were favoured to take, and it was lost anyway: the
      team-mate on the floor whose form was worst, when it was poor */
  mate?: string
  mateForm?: number
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
  /** Active evaluation role when this match opened; absent for historical records. */
  role?: Role
  /** Absent on historical records, which retain their original evaluation. */
  performanceVersion?: 1
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
  /** where I ranked on my own side by 评分 (ACS between equal ratings), as the box score sorts it; 1 = best, 0 when I did not play */
  rank: number
  /** the rounds that were about me — engine highlights with my name on them.
      Until 2026-09-18 it also held what my own calls did, as text; those are
      read off `nodes` now, with the round's result beside each */
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
  /** that matchup lost and the series with it — the line is drawn as a bad night. The screen used to find
      this by reading 「上了一课」 in the line, which no longer says it (2026-09-18) */
  starBeatBad?: boolean
  /** per map: what the win estimate was when it began, and how it went */
  mapLog?: { map: string; before: number; won: boolean }[]
  /** a cup or exhibition rather than a league fixture */
  friendly?: boolean
  /** the one line about a rival or my direct counterpart — see me/rivals.ts */
  rivalNote?: { t: string; ok: boolean }
}

/**
 * The career's running totals — what has to outlive the one-year detail window
 * (me/detail.ts), added up the moment each match is written down instead of
 * counted off a list that only reaches back a year. Official matches I started,
 * nothing else. Absent in saves from before it, and read off their detail once.
 */
export interface MeTally {
  /** 比赛 MVP */
  mvp: number
  /** lost, and still the best line on my side */
  carried: number
  /** finals lost as a starter */
  finalLost: number
  /** 大师赛 / 冠军赛 / LOCK//IN matches started */
  intl: number
  /** defeats in a row right now, and the longest run of the career */
  skid: number
  skidBest: number
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
  /** qualifiers won that season — 出线, not titles; absent in older saves */
  quals?: string[]
  /**
   * The 大师赛 / 冠军赛 / LOCK//IN my club played that season and how far it got,
   * in words — see me/intl.ts. Absent in older saves and in a season with none.
   */
  intl?: string[]
  /**
   * 这个赛季改写的历史 (me/worldline.ts): the season's ledger as it stood on its last day, before the year's events
   * were cleared — its heaviest few (at most KEEP), worded that day; absent in a season with none. `retitled`: how
   * many trophies in the whole ledger went to another side than they really did. Both absent in a season written
   * before 2026-09-18, which says nothing rather than 「暂无」.
   */
  rewrites?: MeRewrite[]
  retitled?: number
}

/** One entry of a season's history ledger as the season's row keeps it (me/worldline.ts keptOf). */
export interface MeRewrite {
  /** heaviest first: an international's title, a qualification place, a regional title, my club's placing */
  kind: 'intl' | 'qual' | 'region' | 'place'
  /** the competition's stored name (me/compname.ts puts it into words) */
  comp: string
  /** what came out otherwise, one fact a line: 「真实历史里是 X；这个世界里是 Y」 — my club's placing only where I was there */
  lines: string[]
  /** the same in one line with the year in front, for the career's pages and the share card */
  one: string
  /** its title went to another side than it really did */
  title?: 1
  /** I was on my club's roster for its matches: started one, or started none */
  there?: 'started' | 'bench'
  /** the title went to my club at the event, and I was on its roster there */
  ours?: 1
}

/** One 大师赛 / 冠军赛 campaign of my club's, written down the day it ended — see me/intl.ts. */
export interface MeIntlRun {
  year: number
  /** `year:compKey`, so a campaign is written down once */
  key: string
  /** the competition's stored name (me/compname.ts turns it into words) */
  comp: string
  /**
   * What the line says, kept apart from the prose so campaigns can be ranked without
   * reading it back: the competition's class as me/compclass.ts reads it — 冠军赛 above
   * 大师赛, the same rule the trophy wall ranks by — and the placing, 夺冠 being 1.
   * `place` is absent where the club finished unranked, which is what the line says in
   * words; both are absent in a save written before they existed, and nothing is derived
   * from the line to fill them in.
   */
  cls?: CompClass
  place?: number
  /** the line the season's row and the 赛季结束 card show, rendered as authored */
  line: string
  matches: number
  starts: number
  wins: number
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
  /** given up on a round's day instead of played (me/cups.ts forfeitCup) */
  forfeit?: boolean
  /** each round as it went, 「八强 负 1-2」 (me/cups.ts endRun); a run from before 2026-09-18 has none */
  results?: string[]
}

export interface Invite {
  id: string
  teamId: string
  /** how they heard of me — 'self': I wrote to them (me/selfpitch.ts) */
  via: 'cup' | 'rank' | 'fans' | 'scout' | 'free' | 'self'
  day: number
  expires: number
  /** the year `day` and `expires` count in: a winter call runs past the year's last day (me/aside.ts yearOf) */
  year?: number
  /** a run of several weeks has already handed the week back once for it running out while set aside (me/aside.ts) */
  warned?: 1
  /** seen enough to skip the tryout */
  direct: boolean
  /** a club of another region that called on top of another club's call because I speak the language (me/prepro.ts LANG_EXTRA): it holds no place in the queue */
  lang?: boolean
}

/** A 自荐, or with a contract a 主动接触, waiting on its answer (me/selfpitch.ts). */
export interface PitchOut {
  id: string
  teamId: string
  /** 'pitch' sent without a contract, 'contact' made under one */
  kind: 'pitch' | 'contact'
  /** the day it went out */
  year: number
  day: number
  /** the absolute day the answer comes (me/window.ts absDay) */
  due: number
  /** the chance, percent, as the button said it: the answer is drawn on exactly this */
  odds: number
}

/** Why a club said no, by the one real factor that weighed most against me (me/selfpitch.ts pitchWhy). */
export type PitchWhy = 'full' | 'import' | 'nevpro' | 'buyout' | 'gap' | 'starter' | 'luck'

/** A no, kept for its card. */
export interface PitchReply {
  id: string
  teamId: string
  kind: 'pitch' | 'contact'
  odds: number
  why: PitchWhy
  /** 'gap': the points short of their bar; 'starter': the man in my job */
  gap?: number
  mate?: string
  year: number
  day: number
}

/** 自荐 and 主动接触 over a career (me/selfpitch.ts, me/pitchbook.ts). Absent in older saves. */
export interface PitchBook {
  /** the transfer period `sent` and `contacted` count in (me/window.ts periodKey) */
  period: number
  /** clubs pitched this period, without a contract */
  sent: string[]
  /** the club contacted this period, under a contract */
  contacted: string[]
  /** clubs that answered no, each with its season: no more from me that season */
  rejected: { team: string; year: number }[]
  out?: PitchOut
  /** the noes waiting on their cards */
  replies: PitchReply[]
  /** the career's count: sent, answered, answered yes, called off by a signing, and the chances the answered ones carried (percent, summed) */
  tally?: { sent: number; replied: number; ok: number; cancelled: number; odds: number }
}

export interface TryoutDayLog { day: number; pick: string; dim: string; p: number; ok: boolean }

export interface Tryout {
  /** Persist self-pitch provenance even if the invitation is later cleaned up. */
  selfPitched?: true
  /** Role-specific assessment; absent keeps an already-started old tryout. */
  assessmentVersion?: 1
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
  /** the club's league currency (me/currency.ts): salary, signing fee and buyout are all written in it */
  cur: Cur
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
  /** the year `day` and `expires` count in: a winter offer runs past the year's last day (me/aside.ts yearOf) */
  year?: number
  /** a run of several weeks has already handed the week back once for it running out while set aside (me/aside.ts) */
  warned?: 1
  /** a move abroad — language and distance come with it */
  abroad: boolean
  /** terms a club brought after I contacted it (me/selfpitch.ts) */
  via?: 'contact'
  /** Originated from a self-pitch or contact; absent on legacy and unsolicited offers. */
  selfPitched?: true
}

/** The contract I am on, as signed, in its club's league currency (me/paytable.ts payOf). */
export interface PayTerms {
  cur: Cur
  salary: number
  sign: number
  buyout: number
  /** the year it was signed, whose rate the world's dollar books were written at */
  year: number
  /** the club's tier when it signed me: its band (me/paytable.ts), even if the club has moved since */
  tier?: 1 | 2
}

export interface PreState {
  /** how many years I have been chasing a contract, 1-based */
  year: number
  /** 0-100 ladder score: my RR, read on the board by me/rank.ts. Only ranked moves it. */
  ladder: number
  /** the best place held, as the score that holds that place on the board as it stands (me/rank.ts standingOf) */
  ladderPeak: number
  /**
   * How far, in RR, the board has climbed past my score in the weeks I did not play ranked
   * (me/rank.ts boardWeek): from 神话 up the place reads that much further down, and a little of
   * it settles back every week; the score and RR do not move. Absent in a save from before it:
   * nothing climbed.
   */
  rise?: number
  cups: CupRun[]
  /** how many times a club's people wrote my name down */
  scoutSeen: number
  /**
   * How many weeks running I have stood at or over the line where the ladder's calls open, up to
   * SCOUT_WEEKS_MAX (me/prepro.ts noteWatched): the longer somebody has been watching, the likelier
   * the phone. Absent in a save from before it: nobody has been watching yet.
   */
  scoutWeeks?: number
  invites: Invite[]
  /** `${year}:${key}` milestones already offered */
  seen: string[]
  /** 战术素养 0-60: what playing with a five teaches that ranked cannot */
  tac: number
  mates: PickupMate[]
  /**
   * the cup in progress, if any: the round to play, and the day it is played on
   * — a round a week (me/cups.ts). `next` and `year` are absent in a save from
   * before the rounds had days; resumeCup gives them today.
   */
  cup?: { key: string; round: number; alive: boolean; mates: PickupMate[]; results: string[]; next?: number; year?: number; club?: string }
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
  /** an answer the career has to remember: written into me.flags as the year it was said, and read at the end (me/events_more.ts vet_staff) */
  flag?: string
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
  /** 综合 opened from each pool, by the attribute that broke (me/bottleneck.ts BREAK_VALUE); absent in saves from before breaks were valued */
  mechV?: Partial<Record<keyof Attrs, number>>
  mileV?: Partial<Record<keyof Attrs, number>>
  /** 2 once the book has had the one-time look back for the title breaks an older build missed */
  rev?: number
  /** true once what a save from before banked at its ceilings (「存点数」, gone 2026-09-14) has been dropped (me/bottleneck.ts dropBank) */
  noBank?: boolean
  /** sessions events have handed each counted path since its last break, against evtCap (me/bottleneck.ts ceilingXp); absent in older saves */
  evt?: Partial<Record<keyof Attrs, number>>
}

/** What can be wrong with me - see me/injury.ts. */
export type InjuryKind = 'wrist' | 'back' | 'eyes' | 'ill' | 'burnout'

/** The lay-off I am in, as the player layer tracks it; `injuredUntil` on the player stays the engine's clock. */
export interface MeInjury {
  kind: InjuryKind
  /** the day it began, this season: the key a lay-off is said and held under */
  from: number
  /** the match I told the coach I would play through */
  play?: string
  /** told the coach I sit out until it heals: not asked again */
  sit?: boolean
  /** the coach has said he will not play me on it */
  benched?: boolean
  /** matches played through it */
  played: number
}

/**
 * 指挥 at my club (me/igl.ts): how long I have been here, what the coach has asked and when, and
 * the day he handed me the calls, with what I brought to them that day. Absent in older saves.
 */
export interface IglBook {
  /** the club the clock below runs at */
  club: string
  /** weeks as a professional at it */
  weeks: number
  /** offers made at this club */
  asked: number
  /** career week (MeState.week) of the last offer here, and of the last time the calls were taken back */
  lastOffer?: number
  lastRevoke?: number
  /** the career's counts */
  offers: number
  declines: number
  revokes: number
  /** weeks I have called, over the career */
  calledWeeks: number
  /**
   * calling now: since when, whom I took it from, and where I stood on each gate that day —
   * with the starts and wins since, counted as they happen because the detail only reaches
   * back a year (me/detail.ts) and a man can call for longer than that. Absent in older saves.
   */
  since?: { year: number; day: number; week: number; prev?: string; igl: number; comm: number; trust: number; weeks: number; n?: number; w?: number }
  /** the last year I called for a club, kept across clubs — what a club reads when it signs a caller */
  lastYear?: number
}

export interface PendingItem {
  /** 'pitch': a club's no to a 自荐 or a contact (me/selfpitch.ts) */
  kind: 'cup' | 'invite' | 'tryout' | 'deal' | 'stream' | 'event' | 'trait' | 'season' | 'ending' | 'released' | 'ceremony' | 'folding' | 'hurt' | 'igl' | 'pitch'
  id?: string
  day: number
}

/**
 * A big moment waiting for its full-screen card (me/moments.ts, ui/me/MomentQueue.tsx): what
 * happened, kept as it was that day, so the card says it even when the club or the board has
 * moved on by the time it is shown.
 */
export interface MomentItem {
  kind: 'title' | 'sign' | 'award' | 'rank' | 'qualify'
  /** one card per key */
  key: string
  year: number
  day: number
  /** title: the competition as the timeline names it, and whether I was the final's MVP */
  comp?: string
  fmvp?: boolean
  /** sign: the club I joined and the one I left, my first pro contract, the terms as signed; title: the club that won it (absent before 2026-09-18) */
  teamId?: string
  fromId?: string
  first?: boolean
  years?: number
  pay?: string
  role?: string
  /** title: won from the bench — the event card rather than the full screen (decided 2026-09-14) */
  bench?: boolean
  /** award: the category, the league, who was up for it (handles, player ids and clubs, best first) */
  award?: string
  league?: string
  nominees?: string[]
  nomineeIds?: string[]
  nomineeTeams?: string[]
  /** rank: 「神话 1」, its tier and division, the server, the place on its board */
  rank?: string
  tier?: string
  div?: number
  server?: string
  pos?: number | null
}

/**
 * What a week started from, kept so any one of its sessions can be taken off
 * again (me/undo.ts). Narrow on purpose: the fields an action can move, plus
 * the lengths of the lists it only ever appends to.
 */
export interface WeekStart {
  week: number
  me: Record<string, unknown>
  /** list name → how long it was, cut back to that on a rewind */
  cut: Record<string, number>
  player: Record<string, unknown>
  /** only the bonds I am in — the only ones a session can move */
  bonds: Record<string, number>
  /** the club's programme for me that morning */
  training?: string
  /** the career kept no book of who it gets on with: a rewind takes the book away again */
  noBonds?: true
}

export interface GrowthWeek {
  week: number
  year: number
  day: number
  complete: boolean
  attrs: Attrs
  xp: Partial<Attrs>
}
export interface GrowthWeekResult {
  week: number
  year: number
  complete: boolean
  changes: Record<keyof Attrs, { points: number; progress: number; capped: boolean }>
}

export interface MeState {
  /** One secondary position, independently trained; only the protagonist uses this metadata. */
  positionTraining?: import('./secondaryRole').PositionTraining
  qualifyAlerts?: import('./qualifyAlerts').QualifyAlertPrefs
  /** Small normalized local JPEG; no upload or original image is stored. */
  avatar?: string
  /** Personal weekly growth baseline, independent from action undo checkpoints. */
  growthWeek?: GrowthWeek
  lastGrowthWeek?: GrowthWeekResult
  /** Recent deliberate same-club departures; dates use the 364-day simulation calendar. */
  clubDepartures?: { teamId: string; playerId: string; until: number }[]
  /** Suppress repeated notices while waiting on the same blocked free-agent pool. */
  clubDepartureWait?: string
  /**
   * This career's own id in the save (me/save.ts claimAutosave): made the first time the career is opened into the
   * save, so two careers are never taken for one — the record beside the save names it, and a page holding another
   * career stops writing. Not the hall's id (me/hall.ts careerIdOf), which is worked out from how the career began.
   * A save from before it gets one when it is next opened.
   */
  saveId?: string
  /** the year this save began on the one timeline; older saves read it off their first season (stars.ts savedFrom) */
  entryYear?: number
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
  /**
   * What has already been done this week, action by action — not what is
   * planned. Since 2026-09-19 a card resolves the moment it is clicked
   * (me/week.ts doAction), so this is the week's tally, and the injuries, the
   * ceilings, the ladder and the coach all read it as the week's work.
   */
  plan: Partial<Record<MeAction, number>>
  /** the result lines this week's clicks left, for the week board's 本周流水; cleared at the settlement */
  weekLog?: string[]
  /** this week's actions in the order they were clicked; cleared at the settlement, which copies it to lastWeekDone */
  weekDone?: MeAction[]
  /** last week's, as it happened — what 重复上一周 replays (me/week.ts repeatLastWeek); absent in older saves */
  lastWeekDone?: MeAction[]
  /** what this week started from, so a card's 「−」 can play it again without it (me/undo.ts); gone once the week settles */
  weekStart?: WeekStart
  /** where in weekDone the replay starts: everything before it cannot be replayed (a duel that was sat through) */
  undoFrom?: number
  /** this week's training base, rolled once and kept so every session of the week is worth the same (me/growth.ts weekGain) */
  trainWeek?: { week: number; g: number }
  /** stream and content money earned this week, against the platform's weekly cap (me/stream.ts payMedia); cleared at the settlement */
  mediaWeek?: number
  /** the talent points the career was made with — me/career.ts talentsOf; a save from before they were kept has them read once off its ceilings */
  talents?: Record<keyof Attrs, number>
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
  /** 指挥 at my club — see me/igl.ts; absent until my first professional week */
  igl?: IglBook
  /** everyone who ever shared a roster with me — see me/bond.ts, never pruned */
  mates?: Record<string, BondEntry>
  /** 宿敌, read off what happened in this save — see me/rivals.ts; absent until the first pro week */
  rivals?: import('./rivals').RivalBook
  /** birthdays, milestones and runs already said — see me/life.ts; absent in older saves */
  life?: import('./life').LifeBook
  /** matches played this stage, so a two-game stage cannot define a role */
  bondStageMatches?: number
  /** a practice duel in progress, scene by scene */
  duelLive?: DuelLive
  /** confirmed as a starter: selection reads my full rating, not the rookie discount */
  proven: boolean
  /**
   * The men history signed onto my club while I was on it (engine/timeline.ts followBook), by club. One who
   * plays my position does not take my seat while I hold it (`seat`, me/coach.ts heldSeat): he is the 替补
   * and rotates in (me/coach.ts rotationCall), counted from `since`, the week I started holding it. Absent
   * in older saves and at a club history has not signed anyone for.
   */
  historyArrivals?: { club: string; ids: string[]; seat?: boolean; since?: number; rot?: { week: number; sub: string | null; why: 'tired' | 'form' | 'turn' } }
  /** official starts at this club since I joined it — with the coach's trust, how a starter becomes his own (me/coach.ts earnProven); absent in older saves */
  startsHere?: number
  /** official starts left, after a title won as a starter, in which a bad run costs no place (me/coach.ts coachAfterTitle) */
  graceMatches?: number
  /**
   * Official matches my club has played since the promise on my contract was made — whether
   * I was on the floor or watching from the bench; a cup or an exhibition is not one of them.
   * The promised standing is a floor of me/coach.ts PROMISE_FLOOR matches rather than a
   * standing guarantee, and this is what is counted against it. Set at 0 when I join a club
   * and when I leave one, and again when a renewal changes what was promised. Absent in a
   * save from before the floor, where it reads as already spent: a career in progress keeps
   * the place it has, and from its next match the coach decides.
   */
  promiseMatches?: number
  coachTrust: number
  gmTrust: number
  /** Last manual manager conversation, in absolute career weeks; absent in older saves. */
  managerTalkWeek?: number
  fans: number
  heat: number
  /** the wallet, in RMB (me/currency.ts) */
  money: number
  /** my contract as signed, in its league's currency; the world's copy (player.salary) is in dollars */
  pay?: PayTerms
  /** 话语权的两个动作各自的冷却，按赛段计 — see me/clout.ts */
  cloutCd?: { list: number; sign: number }
  /** the eight ceilings' book; absent in saves from before them, filled at the next settlement */
  bottleneck?: BottleneckState
  /** the ceremony on screen right now */
  cer?: Ceremony
  /** ceremonies already held, as keys - each fires once */
  cerSeen?: string[]
  /** this season's nights so far, against its cap (me/cerbudget.ts); absent in older saves */
  cerYear?: { year: number; n: number; media: number }
  /** 出征 changed how fast the body comes back, until this day */
  cerRest?: { until: number; mul: number }
  /** 决赛入场 left something on the next match */
  cerMatch?: { fixture: string; nudge: number; node: number; until: number }
  /** categories I was up for at awards nights; absent in older saves */
  awards?: MeAward[]
  /** the lay-off I am in, by kind - see me/injury.ts; absent when healthy and in saves from before it */
  injury?: MeInjury
  /** Major life events retain facts separately from temporary absence and old event flags. */
  careerEvents?: CareerEventState
  /** team-mates out hurt when the week last opened, so a lay-off is said when it starts and when it ends */
  mateHurt?: { club: string; ids: string[] }
  /** every dollar in and out, by stage — see me/money.ts, written only by addMoney() */
  ledger?: Ledger
  /** competitions whose prize share has already been paid, as `year:compKey` */
  prizePaid?: string[]
  /** weekly outgoing the background left me with */
  upkeep: number
  /** 钱的出口：家用、见面会、奖学金、休赛期、直播间、网咖 — see me/outlets.ts; absent in older saves and until the first is used */
  out?: import('./outlets').OutletBook
  log: MeLog[]
  /** per-match detail, the last year of it — the rule and why it is a year are in me/detail.ts */
  matches: MeMatchRecord[]
  /** what has to outlive that year, added up as it happens (me/detail.ts); absent in older saves */
  tally?: MeTally
  /** engine digest lines collected during the week, shown on the week screen */
  weekNotes: string[]
  /** a fixture the week stopped on, still to be played */
  pendingFixture?: string
  /** my match today that the clock stopped in front of — for a decision, or as the week turned into days — opened on the next press (me/week.ts dueToday) */
  dueFixture?: string
  /** things waiting on me before the clock moves */
  pending: PendingItem[]
  /** big moments waiting for their full-screen card — me/moments.ts; absent in older saves */
  moments?: MomentItem[]
  /** my club's 大师赛 / 冠军赛 campaigns, each written down the day it ended — see me/intl.ts; absent in older saves */
  intlRuns?: MeIntlRun[]
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
  /** a move agreed while a club was under a roster lock: made the day the lock lifts (me/contract.ts settleMove) */
  moveAfter?: { deal: Deal; event: string; until: number; year: number }
  /** clubs that wrote me down at a stage's end */
  intents: { teamId: string; day: number }[]
  /** clubs turned down this year, or that turned me down, each with its year: it stays away until the year turns (me/prepro.ts declinedNow) */
  declined: { team: string; year: number }[]
  /** 自荐 and 主动接触 — see me/selfpitch.ts; absent until the first is sent, and in older saves */
  pitch?: PitchBook
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
  /** 伏笔: choices that come back later, by key — see me/story.ts; absent in older saves */
  seeds?: Record<string, import('./story').SeedRec>
  /** the countdown chain under way, if any — see me/story.ts */
  chain?: import('./story').ChainLive
  /** chains that ran their course, newest last, capped */
  chainsDone?: { id: string; wk: number; end: import('./story').ChainEnd; steps: number }[]
  quests: Quest[]
  eventsSeen: number

  auto: { buy: boolean; biz: boolean; daily: boolean; career: boolean }
  autoNotes: string[]

  achievements: string[]
  /** achievement rewards already paid (by key), how far the unlock card has shown, the 称号 picked — me/achievements.ts; absent in older saves */
  achState?: { paid: string[]; seen: number; worn?: string }
  /** `teamId` / `team`: the club it was lifted with and its name that day (me/week.ts syncTitles); older saves have them
   * where me/trophies.ts stampTitleClubs could tell, and nothing where it could not */
  titles: { year: number; title: string; started: boolean; fmvp?: boolean; teamId?: string; team?: string }[]
  /** qualifiers won — 出线, not titles (me/compclass.ts isQualifier); absent in older saves */
  quals?: { year: number; title: string; started: boolean }[]
  ending?: { key: string; title: string; text: string; year: number; marks?: import('./careerMarks').CareerMark[] }
  retireAsk?: boolean
  flags: Record<string, number>
}
