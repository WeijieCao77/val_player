import { hashStr } from '../rng'
import { REGION_CN } from '../types'
import type { GameState, Region } from '../types'
import { regionIn } from '../era'
import { ACHIEVEMENTS, ACH_BY_KEY } from './achievements'
import { compClass } from './compclass'
import type { CompClass } from './compclass'
import type { MeState } from './types'

/**
 * 成就殿堂: what every career on this device has done, kept outside the save.
 *
 * The 94 achievements stay the career's own (me/achievements.ts): unlocked,
 * paid and shown per career, from zero in every new one. The hall only writes
 * them down — which career first had each, in which season, on which day, and
 * how many careers have had it — and keeps a card for every career that ended.
 *
 * On top of the cards sit a handful of 殿堂成就 that one career cannot finish:
 * each asks for careers that differ — the other entry year, another start,
 * another role, another league, a life with no trophy beside one with the
 * biggest. What they give is a 称号 on the career card and nothing else: as in
 * 破晓, the hall gives no numbers and unlocks nothing for the next career (two
 * unlockable origin cards were taken out on the author's word, 2026-09-11).
 * No number anywhere in a career reads the hall.
 *
 * One localStorage record under its own key. Every read and write is caught:
 * a browser that stores nothing (private mode, storage off, quota full) has no
 * hall, and the career runs exactly as it would have. A record that does not
 * parse is started over rather than left to block every write after it.
 *
 * Written from one place (PlayerGame's commit): each commit notes the career's
 * unlocks, and once it has ended, its card. Both are keyed by the career's id,
 * so a save loaded twice, or a finished career opened again, adds nothing.
 */

export const HALL_KEY = 'val_player.hall'
/** careers remembered per achievement, for the 「几局拿到过」 count */
const IDS_CAP = 40
/** a card is about a kilobyte; a player who finishes this many careers has spent some hundreds of hours */
const CARDS_CAP = 120

export type HallStart = 'pre' | 'chal' | 't1'
export const START_SHORT: Record<HallStart, string> = { pre: '天梯', chal: '二线', t1: '替补' }

/** A career at a moment: which one, under what ID, in which season, on which real day. */
export interface HallMark {
  id: string
  who: string
  year: number
  /** YYYY-MM-DD, this device's calendar */
  at: string
}

export interface HallAch {
  first: HallMark
  /** careers that have had it */
  n: number
  /** the latest of those careers, by id — what keeps a reload from counting twice */
  ids: string[]
}

export interface HallTrophy { year: number; name: string; cls: CompClass; started: boolean }

/** One finished career, as the hall keeps it. */
export interface HallCard {
  id: string
  name: string
  role: string
  /** 2021 or 2026 */
  entry: number
  start: HallStart
  origin: string
  /** the region the career started from */
  home: string
  from: number
  to: number
  /** professional seasons */
  seasons: number
  clubs: string[]
  titles: HallTrophy[]
  /** the season with the most to show for it */
  best?: { year: number; team: string; titles: number; acs: number }
  /** the best season ACS over a real sample */
  acs?: { year: number; value: number }
  ending: { key: string; title: string }
  peak: number
  mvps: number
  /** achievement keys held at the end */
  ach: string[]
  at: string
  /** 殿堂成就 this career completed */
  hx?: string[]
}

export interface Hall {
  v: 1
  ach: Record<string, HallAch>
  cards: HallCard[]
  /** 殿堂成就 by key: the career that completed each */
  hx: Record<string, HallMark>
}

export const emptyHall = (): Hall => ({ v: 1, ach: {}, cards: [], hx: {} })

const INTL: CompClass[] = ['champions', 'masters', 'lockin']
export const isIntlClass = (c: CompClass): boolean => INTL.includes(c)

/* ------------------------------------------------------------------ */
/*  殿堂成就                                                            */
/* ------------------------------------------------------------------ */

export interface HallMilestone {
  key: string
  /** also the 称号 it gives */
  name: string
  desc: string
  /** what counts so far, part by part */
  parts: (cards: HallCard[]) => { label: string; ok: boolean }[]
  /** the whole of it, when that is more than every part holding (two parts that must be two careers) */
  done?: (cards: HallCard[]) => boolean
}

const ROLES = ['决斗者', '先锋', '控场', '哨卫']
const LEAGUES: Region[] = ['Americas', 'EMEA', 'Pacific', 'China']
/** the league a career's home server sits under today: a 2021 start from Thailand is Pacific */
const leagueOf = (c: HallCard): string => regionIn(c.home as Region, 2030)
const titled = (c: HallCard) => c.titles.some((t) => t.started)
const noTitle = (c: HallCard) => c.titles.length === 0
const champs = (c: HallCard) => c.titles.some((t) => t.started && t.cls === 'champions')
const has = (key: string) => (c: HallCard) => c.ach.includes(key)
/** one career where f holds, and a different one where g does */
const apart = (cards: HallCard[], f: (c: HallCard) => boolean, g: (c: HallCard) => boolean): boolean =>
  cards.some((a) => f(a) && cards.some((b) => b.id !== a.id && g(b)))

/** Each needs careers that differ from each other; none can be finished inside one save. */
export const MILESTONES: HallMilestone[] = [
  { key: 'eras', name: '跨时代', desc: '2021 和 2026 两个入口，各打完一局',
    parts: (cs) => [2021, 2026].map((y) => ({ label: String(y), ok: cs.some((c) => c.entry === y) })) },
  { key: 'doors', name: '条条大路', desc: '天梯、二线、替补三种开局，各首发拿过冠军',
    parts: (cs) => (['pre', 'chal', 't1'] as HallStart[]).map((k) => ({ label: START_SHORT[k], ok: cs.some((c) => c.start === k && titled(c)) })) },
  { key: 'roles', name: '全位置', desc: '决斗者、先锋、控场、哨卫，各打过职业赛季',
    parts: (cs) => ROLES.map((r) => ({ label: r, ok: cs.some((c) => c.role === r && c.seasons > 0) })) },
  { key: 'leagues', name: '四海', desc: '从四大赛区的服务器各出发一次，都打上职业',
    parts: (cs) => LEAGUES.map((r) => ({ label: REGION_CN[r], ok: cs.some((c) => leagueOf(c) === r && c.seasons > 0) })) },
  { key: 'lives', name: '两种人生', desc: '一局没有冠军，另一局首发捧起冠军赛奖杯',
    parts: (cs) => [{ label: '无冠', ok: cs.some(noTitle) }, { label: '冠军赛', ok: cs.some(champs) }] },
  { key: 'stay_go', name: '去留', desc: '一局在一队待满五季，另一局在外赛区打满两季',
    parts: (cs) => [{ label: '一队五年', ok: cs.some(has('loyal5')) }, { label: '他乡两年', ok: cs.some(has('abroad2')) }],
    done: (cs) => apart(cs, has('loyal5'), has('abroad2')) },
]

export const MILESTONE_BY_KEY: Record<string, HallMilestone> = Object.fromEntries(MILESTONES.map((m) => [m.key, m]))

export function milestoneDone(m: HallMilestone, cards: HallCard[]): boolean {
  try { return m.done ? m.done(cards) : m.parts(cards).every((p) => p.ok) } catch { return false }
}

/* ------------------------------------------------------------------ */
/*  storage                                                             */
/* ------------------------------------------------------------------ */

/** null only when this browser cannot store; a broken record reads as an empty hall. */
export function readHall(): Hall | null {
  let raw: string | null
  try { raw = localStorage.getItem(HALL_KEY) } catch { return null }
  if (!raw) return emptyHall()
  try { return cleanHall(JSON.parse(raw)) } catch { return emptyHall() }
}

function writeHall(h: Hall): boolean {
  try { localStorage.setItem(HALL_KEY, JSON.stringify(h)); return true } catch { return false }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CAREER_ID = /^c[0-9a-z]{1,8}$/
const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
const int = (x: unknown): number => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0)
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' ? x as Record<string, unknown> : null)

function cleanMark(x: unknown): HallMark | null {
  const o = obj(x)
  if (!o || !CAREER_ID.test(str(o.id, 12))) return null
  const at = str(o.at, 10)
  return { id: str(o.id, 12), who: str(o.who, 24), year: int(o.year), at: DAY.test(at) ? at : '' }
}

function cleanCard(x: unknown): HallCard | null {
  const o = obj(x)
  const e = obj(o?.ending)
  if (!o || !e || !CAREER_ID.test(str(o.id, 12)) || !str(e.key, 24)) return null
  const best = obj(o.best)
  const acs = obj(o.acs)
  const at = str(o.at, 10)
  const hx = list(o.hx).filter((k): k is string => typeof k === 'string' && !!MILESTONE_BY_KEY[k])
  return {
    id: str(o.id, 12), name: str(o.name, 24), role: str(o.role, 8), entry: int(o.entry),
    start: o.start === 'chal' || o.start === 't1' ? o.start : 'pre',
    origin: str(o.origin, 24), home: str(o.home, 32), from: int(o.from), to: int(o.to),
    seasons: Math.max(0, int(o.seasons)),
    clubs: list(o.clubs).map((c) => str(c, 48)).filter(Boolean).slice(0, 24),
    titles: list(o.titles).flatMap((t) => {
      const r = obj(t)
      const name = str(r?.name, 60)
      return r && name ? [{ year: int(r.year), name, cls: compClass(name), started: !!r.started }] : []
    }).slice(0, 80),
    best: best ? { year: int(best.year), team: str(best.team, 48), titles: int(best.titles), acs: int(best.acs) } : undefined,
    acs: acs ? { year: int(acs.year), value: int(acs.value) } : undefined,
    ending: { key: str(e.key, 24), title: str(e.title, 16) },
    peak: int(o.peak), mvps: Math.max(0, int(o.mvps)),
    ach: [...new Set(list(o.ach).filter((k): k is string => typeof k === 'string' && !!ACH_BY_KEY[k]))],
    at: DAY.test(at) ? at : '',
    ...(hx.length ? { hx } : {}),
  }
}

/** Anything read back — this device's record or a pasted one — is washed: known keys, sane values, the rest dropped. */
export function cleanHall(raw: unknown): Hall {
  const h = emptyHall()
  const o = obj(raw)
  if (!o) return h
  for (const [key, v] of Object.entries(obj(o.ach) ?? {})) {
    const r = obj(v)
    const first = cleanMark(r?.first)
    if (!r || !ACH_BY_KEY[key] || !first) continue
    const ids = [...new Set(list(r.ids).filter((x): x is string => typeof x === 'string' && CAREER_ID.test(x)))].slice(-IDS_CAP)
    h.ach[key] = { first, n: Math.max(1, ids.length, Math.min(9999, int(r.n))), ids }
  }
  const seen = new Set<string>()
  for (const c of list(o.cards)) {
    const card = cleanCard(c)
    if (card && !seen.has(card.id)) { seen.add(card.id); h.cards.push(card) }
  }
  h.cards = h.cards.slice(-CARDS_CAP)
  for (const [key, v] of Object.entries(obj(o.hx) ?? {})) {
    const m = cleanMark(v)
    if (m && MILESTONE_BY_KEY[key]) h.hx[key] = m
  }
  return h
}

/* ------------------------------------------------------------------ */
/*  reading a career                                                    */
/* ------------------------------------------------------------------ */

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const entryOf = (state: GameState): number => state.me?.entryYear ?? state.me?.seasons[0]?.year ?? state.year
const roleOf = (state: GameState): string => {
  const p = state.players[state.me!.id]
  return p?.roles?.[0] ?? p?.role ?? ''
}

/** Only what is fixed the day the career is made. */
function idHash(state: GameState): number {
  const me = state.me!
  return hashStr([state.seed, entryOf(state), state.players[me.id]?.ign ?? '', me.originKey, roleOf(state), me.region].join('|')) || 1
}

/** The career's id, without writing it down. */
export function peekCareerId(state: GameState): string {
  return 'c' + ((state.me!.flags.hallId || idHash(state)) >>> 0).toString(36)
}

/**
 * The career's id, kept in the save once worked out. A save from before the
 * entry year was recorded reads its first season for it, which moves while that
 * season is still under way — kept, it cannot move.
 */
export function careerIdOf(state: GameState): string {
  const me = state.me!
  if (!me.flags.hallId) me.flags.hallId = idHash(state)
  return peekCareerId(state)
}

/**
 * Where it started. New careers say so (career.ts); an older save is read: a
 * ladder run shows in its cups, a club start is at a club in its first season.
 * A ladder start from before the flag that signed before playing any cup reads
 * as a club start — the one case the save cannot tell apart.
 */
function startOf(state: GameState): HallStart {
  const me = state.me!
  if (me.flags.fromLadder) return 'pre'
  if (me.flags.startTier === 1) return 't1'
  if (me.flags.startTier === 2) return 'chal'
  if (!me.pre.wasPro && me.pre.cups.length > 0) return 'pre'
  const first = me.seasons[0]
  return first?.tier === 1 ? 't1' : first?.tier === 2 ? 'chal' : 'pre'
}

/** The season an achievement came in, off the career's own log line; the current one when the log has lost it. */
function unlockYear(me: MeState, name: string, fallback: number): number {
  const head = `成就：${name}——`
  return me.log.find((l) => l.text.startsWith(head))?.year ?? fallback
}

function cardOf(state: GameState, id: string): HallCard {
  const me = state.me!
  const p = state.players[me.id]
  const pro = me.seasons.filter((x) => x.tier > 0)
  const clubs = [...new Set(pro.map((x) => x.team))]
  if (!clubs.length) {
    for (const c of p?.clubHist ?? []) {
      const n = state.teams[c.team]?.name ?? c.team
      if (!clubs.includes(n)) clubs.push(n)
    }
  }
  const played = pro.filter((x) => x.starts > 0)
  const best = [...played].sort((a, b) => b.titles.length - a.titles.length || b.wins - a.wins || b.acs - a.acs)[0]
  const steady = played.filter((x) => x.starts >= 10)
  const acs = [...(steady.length ? steady : played)].sort((a, b) => b.acs - a.acs)[0]
  const entry = entryOf(state)
  return {
    id, name: p?.ign ?? '', role: roleOf(state), entry, start: startOf(state), origin: me.originKey, home: me.region,
    from: entry, to: me.ending?.year ?? state.year, seasons: pro.length, clubs,
    titles: me.titles.map((t) => ({ year: t.year, name: t.title, cls: compClass(t.title), started: t.started })),
    best: best ? { year: best.year, team: best.team, titles: best.titles.length, acs: best.acs } : undefined,
    acs: acs?.acs ? { year: acs.year, value: acs.acs } : undefined,
    ending: { key: me.ending?.key ?? '', title: me.ending?.title ?? '' },
    peak: Math.max(p?.overall ?? 0, ...me.seasons.map((x) => x.overallTo)),
    mvps: p?.career?.mvps ?? 0,
    ach: me.achievements.filter((k) => !!ACH_BY_KEY[k]),
    at: today(),
  }
}

/** 殿堂成就 the cards now complete, credited to the newest card: the one that completed them. */
function sweep(h: Hall): HallMilestone[] {
  const last = h.cards[h.cards.length - 1]
  if (!last) return []
  const fresh = MILESTONES.filter((m) => !h.hx[m.key] && milestoneDone(m, h.cards))
  if (!fresh.length) return []
  for (const m of fresh) h.hx[m.key] = { id: last.id, who: last.name, year: last.to, at: today() }
  last.hx = [...(last.hx ?? []), ...fresh.map((m) => m.key)]
  return fresh
}

/* ------------------------------------------------------------------ */
/*  writing                                                             */
/* ------------------------------------------------------------------ */

/** what the last note saw, so a commit that changed nothing the hall keeps does not touch storage */
let noted = ''

/**
 * Note a career: whatever it has unlocked that the hall has not seen from it,
 * and its card once it has ended. Returns the 殿堂成就 that card completed.
 * Safe to call on every commit and on every load; `force` skips the shortcut.
 */
export function noteHall(state: GameState, force = false): HallMilestone[] {
  try {
    const me = state.me
    if (!me) return []
    const id = careerIdOf(state)
    const sig = `${id}|${me.achievements.length}|${me.phase}|${me.ending?.key ?? ''}`
    if (!force && sig === noted) return []
    noted = sig
    const h = readHall()
    if (!h) return []
    const who = state.players[me.id]?.ign ?? ''
    let changed = false
    for (const key of me.achievements) {
      const a = ACH_BY_KEY[key]
      const r = h.ach[key]
      if (!a || r?.ids.includes(id)) continue
      if (!r) h.ach[key] = { first: { id, who, year: unlockYear(me, a.name, state.year), at: today() }, n: 1, ids: [id] }
      else { r.ids = [...r.ids, id].slice(-IDS_CAP); r.n += 1 }
      changed = true
    }
    let fresh: HallMilestone[] = []
    if (me.phase === 'retired' && me.ending && !h.cards.some((c) => c.id === id)) {
      h.cards.push(cardOf(state, id))
      if (h.cards.length > CARDS_CAP) h.cards.splice(0, h.cards.length - CARDS_CAP)
      fresh = sweep(h)
      changed = true
    }
    if (!changed) return []
    return writeHall(h) ? fresh : []
  } catch {
    return []
  }
}

/** Two halls as one: the earliest first unlock, careers counted once, every card and every 殿堂成就 either side has. */
export function mergeHall(into: Hall, from: Hall): Hall {
  for (const [key, f] of Object.entries(from.ach)) {
    const r = into.ach[key]
    if (!r) { into.ach[key] = { first: { ...f.first }, n: f.n, ids: [...f.ids] }; continue }
    if (f.first.at && (!r.first.at || f.first.at < r.first.at)) r.first = { ...f.first }
    const ids = [...r.ids, ...f.ids.filter((x) => !r.ids.includes(x))]
    r.n = Math.max(r.n, f.n, ids.length)
    r.ids = ids.slice(-IDS_CAP)
  }
  for (const c of from.cards) if (!into.cards.some((x) => x.id === c.id)) into.cards.push(c)
  into.cards.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  into.cards = into.cards.slice(-CARDS_CAP)
  for (const [key, m] of Object.entries(from.hx)) {
    const r = into.hx[key]
    if (!r || (m.at && m.at < r.at)) into.hx[key] = { ...m }
  }
  return into
}

const FORMAT = 'VAL_PLAYER_HALL'

/** The hall as text to carry to another device; null when this one stores nothing. */
export function exportHall(): string | null {
  const h = readHall()
  return h ? JSON.stringify({ format: FORMAT, ...h }) : null
}

/** Fold a carried hall into this device's. Never replaces: unlocking only ever adds. */
export function importHall(text: string): 'ok' | 'bad' | 'nostore' {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return 'bad' }
  if (obj(raw)?.format !== FORMAT) return 'bad'
  const h = readHall()
  if (!h) return 'nostore'
  mergeHall(h, cleanHall(raw))
  sweep(h)
  return writeHall(h) ? 'ok' : 'nostore'
}

/* ------------------------------------------------------------------ */
/*  reading the hall                                                    */
/* ------------------------------------------------------------------ */

export const hallAchCount = (h: Hall): number => ACHIEVEMENTS.filter((a) => h.ach[a.key]).length

/** The newest 称号 the hall has given. */
export function hallTitle(h: Hall | null): string {
  if (!h) return ''
  const keys = Object.keys(h.hx).filter((k) => MILESTONE_BY_KEY[k])
  return keys.length ? MILESTONE_BY_KEY[keys[keys.length - 1]].name : ''
}

/** The career card's line: what this career completed in the hall, or else the hall's newest 称号. */
export function hallLine(state: GameState): string {
  if (!state.me) return ''
  const h = readHall()
  if (!h) return ''
  const card = h.cards.find((c) => c.id === peekCareerId(state))
  const mine = (card?.hx ?? []).map((k) => MILESTONE_BY_KEY[k]?.name).filter(Boolean)
  if (mine.length) return `殿堂 · 这一局凑齐「${mine.join('」「')}」`
  const t = hallTitle(h)
  return t ? `殿堂称号 · ${t}` : ''
}

export type HallRecordKey = 'titles' | 'intl' | 'seasons' | 'peak' | 'acs' | 'mvps'
export interface HallRecord { key: HallRecordKey; label: string; n: number; card: HallCard; year: number }

/** The best of every finished career, one line each; the first career to reach a mark keeps it. */
export function hallRecords(h: Hall): HallRecord[] {
  const rows: { key: HallRecordKey; label: string; of: (c: HallCard) => number; year?: (c: HallCard) => number }[] = [
    { key: 'titles', label: '冠军', of: (c) => c.titles.filter((t) => t.started).length },
    { key: 'intl', label: '国际赛冠军', of: (c) => c.titles.filter((t) => t.started && isIntlClass(t.cls)).length },
    { key: 'seasons', label: '职业赛季', of: (c) => c.seasons },
    { key: 'peak', label: '综合巅峰', of: (c) => c.peak },
    { key: 'acs', label: '单季 ACS', of: (c) => c.acs?.value ?? 0, year: (c) => c.acs?.year ?? c.to },
    { key: 'mvps', label: 'MVP', of: (c) => c.mvps },
  ]
  const out: HallRecord[] = []
  for (const r of rows) {
    let card: HallCard | null = null
    let n = 0
    for (const c of h.cards) {
      const v = r.of(c)
      if (v > n) { n = v; card = c }
    }
    if (card) out.push({ key: r.key, label: r.label, n, card, year: r.year ? r.year(card) : card.to })
  }
  return out
}
