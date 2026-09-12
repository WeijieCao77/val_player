import type { GameState } from '../types'
import { dateLabel } from '../season'
import { onTimeline, stageNameIn } from '../era'
import { isIntlComp } from './compclass'
import { ladderLabel } from './prepro'
import { hallAchCount, readHall } from './hall'
import type { Phase } from './types'

/**
 * The home page's card for the career to continue, kept beside the save.
 *
 * A save is about 2.4 MB of JSON; reading it only to draw one card makes the
 * front page wait. So every autosave (me/save.ts) also writes this summary — a
 * few hundred bytes under its own key — and the page draws the card from it at
 * once, the way 破晓's cover shows 「上次的存档」 (its save.ts continueCard).
 *
 * Only a picture of the save: nothing reads it back into a career, and a
 * summary that is missing, broken, or for another point in the career than the
 * save beside it is simply not used — continuing always reads the save itself.
 */

export const META_KEY = 'val_player:save:meta'

export interface SaveMetaClub {
  id: string
  /** whose crest to draw: the club my club carried on as, when history renamed it (dossier.ts crestUrl) */
  crest: string
  name: string
  tag: string
  tier: 1 | 2
  /** 'VCT EMEA', 'Challengers Japan'… — empty when the world does not say */
  league: string
  seat: 'starter' | 'bench' | 'trial'
}

export interface SaveMetaMatch {
  opp: string
  oppTag: string
  score: string
  result: 'W' | 'L' | 'D'
  /** the competition, as the match record has it */
  event: string
  started: boolean
}

export interface SaveMeta {
  v: 1
  /** real time of the save, ms */
  at: number
  /** where in the career: matched against the save's owner record before the summary is trusted */
  year: number
  day: number
  ign: string
  role: string
  age: number
  phase: Phase
  /** null on the ladder, between clubs, or retired */
  club: SaveMetaClub | null
  /** on the ladder: the rank, in words */
  ladder: string
  /** 2026年3月4日 */
  date: string
  stage: string
  overall: number
  titles: number
  /** of which international */
  intl: number
  fans: number
  money: number
  last: SaveMetaMatch | null
  /** this career's achievements */
  ach: number
  /** the hall's, when the save was written */
  hall: number
  /** a finished career's ending */
  ending: string
}

/** The crest a club is drawn with: the newest name my club carried on as, else its own (the same rule as dossier.ts crestUrl). */
function crestOf(state: GameState, id: string): string {
  const carried = Object.keys(state.heirs ?? {}).filter((to) => state.heirs![to] === id)
  return carried.length ? carried[carried.length - 1] : id
}

export function buildSaveMeta(state: GameState): SaveMeta | null {
  const me = state.me
  const p = me && state.players[me.id]
  if (!me || !p) return null
  const t = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const m = me.matches[me.matches.length - 1]
  const h = readHall()
  return {
    v: 1,
    at: Date.now(),
    year: state.year,
    day: state.day,
    ign: p.ign,
    role: p.roles?.[0] ?? p.role,
    age: p.age,
    phase: me.phase,
    club: t ? {
      id: t.id, crest: crestOf(state, t.id), name: t.name, tag: t.tag, tier: t.tier === 1 ? 1 : 2, league: t.league ?? '',
      seat: me.trial ? 'trial' : t.starters.includes(me.id) ? 'starter' : 'bench',
    } : null,
    ladder: me.phase === 'pre' ? ladderLabel(me.pre.ladder) : '',
    date: dateLabel(state),
    stage: stageNameIn(state.year, state.stage, onTimeline(state)),
    overall: Math.round(p.overall),
    titles: me.titles.length,
    intl: me.titles.filter((x) => isIntlComp(x.title)).length,
    fans: Math.round(me.fans),
    money: Math.round(me.money),
    last: m ? { opp: m.opp, oppTag: m.oppTag, score: m.score, result: m.drawn ? 'D' : m.won ? 'W' : 'L', event: m.comp, started: m.started } : null,
    ach: me.achievements.length,
    hall: h ? hallAchCount(h) : 0,
    ending: me.ending?.title ?? '',
  }
}

/** Written after every autosave. Never throws: a summary that cannot be written is removed, and the card falls back. */
export function writeSaveMeta(state: GameState): void {
  try {
    const meta = buildSaveMeta(state)
    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta))
    else localStorage.removeItem(META_KEY)
  } catch {
    try { localStorage.removeItem(META_KEY) } catch { /* storage blocked */ }
  }
}

const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null)
const PHASES: Phase[] = ['pre', 'pro', 'free', 'retired']

/** Anything read back is washed: known fields, sane values; a record that is not one reads as none. */
export function cleanSaveMeta(raw: unknown): SaveMeta | null {
  const o = obj(raw)
  if (!o || o.v !== 1) return null
  const year = num(o.year)
  const day = num(o.day)
  const at = num(o.at)
  if (year === null || year < 2020 || year > 2100 || day === null || day < 0 || day > 400 || at === null) return null
  const ign = str(o.ign, 24)
  const phase = PHASES.find((x) => x === o.phase)
  if (!ign || !phase) return null
  const c = obj(o.club)
  const club: SaveMetaClub | null = c && str(c.id, 24) && str(c.name, 60) ? {
    id: str(c.id, 24), crest: str(c.crest, 24) || str(c.id, 24), name: str(c.name, 60), tag: str(c.tag, 12),
    tier: c.tier === 1 ? 1 : 2, league: str(c.league, 48),
    seat: c.seat === 'trial' || c.seat === 'bench' ? c.seat : 'starter',
  } : null
  const l = obj(o.last)
  const last: SaveMetaMatch | null = l && str(l.score, 12) ? {
    opp: str(l.opp, 60), oppTag: str(l.oppTag, 12), score: str(l.score, 12),
    result: l.result === 'W' || l.result === 'D' ? l.result : 'L', event: str(l.event, 80), started: l.started !== false,
  } : null
  const n = (x: unknown) => Math.max(0, Math.round(num(x) ?? 0))
  return {
    v: 1, at, year, day, ign, role: str(o.role, 8), age: n(o.age), phase, club,
    ladder: str(o.ladder, 24), date: str(o.date, 24), stage: str(o.stage, 40),
    overall: n(o.overall), titles: n(o.titles), intl: n(o.intl), fans: n(o.fans),
    money: Math.round(num(o.money) ?? 0), last, ach: n(o.ach), hall: n(o.hall), ending: str(o.ending, 24),
  }
}

/** The summary as stored; null when there is none or it does not read. */
export function readSaveMeta(): SaveMeta | null {
  let raw: string | null
  try { raw = localStorage.getItem(META_KEY) } catch { return null }
  if (!raw) return null
  try { return cleanSaveMeta(JSON.parse(raw)) } catch { return null }
}
