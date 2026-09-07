import type { Attrs } from '../types'

/** What a week's action points can be spent on. */
export type MeAction = 'aim' | 'vod' | 'util' | 'ranked' | 'scrim' | 'duo' | 'stream' | 'rest' | 'duel'

/** An in-round decision is judged on one of the eight attributes, or on nerve. */
export type NodeDim = keyof Attrs | 'mental'

export type LogKind = 'match' | 'train' | 'team' | 'money' | 'info' | 'good' | 'bad' | 'season'

export interface MeLog { day: number; year: number; kind: LogKind; text: string }

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
}

export interface MeSeason {
  year: number
  team: string
  matches: number
  starts: number
  wins: number
  acs: number
  overallFrom: number
  overallTo: number
  titles: string[]
}

export interface MeState {
  /** my player id in state.players */
  id: string
  origin: string
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
  /** confirmed as a starter: selection reads my full rating, not the rookie discount */
  proven: boolean
  coachTrust: number
  gmTrust: number
  fans: number
  heat: number
  money: number
  log: MeLog[]
  matches: MeMatchRecord[]
  /** engine digest lines collected during the week, shown on the week screen */
  weekNotes: string[]
  /** a fixture the week stopped on, still to be played */
  pendingFixture?: string
  seasons: MeSeason[]
  seasonStart: { year: number; overall: number; matches: number; starts: number; wins: number; acsSum: number }
  lastLineupIn?: boolean
}
