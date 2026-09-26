import { Rng, hashStr } from '../rng'
import { bondBetween, duoBonded } from '../bonds'
import type { Competition, Fixture, GameState } from '../types'
import type { EffectSpec, MeMatchRecord, PendingItem } from './types'
import { applyEffect } from './fx'
import { addAxis } from './traits'
import { pushLog } from './log'
import { pop, push, pushFront } from './pending'
import { compCn } from './compname'
import { isFinal, isIntlComp } from './compclass'
import { rivalOnTeam, stokeRival } from './rivals'
import { activeAbsence } from './absence'
import { ALL, BANK, POST } from './interviewBank'
import type { Ans, IvKind, IvOutcome, Q } from './interviewBank'
import MOMENTS from '../../data/interview_moments.json'

export type { IvKind, IvOutcome } from './interviewBank'

/**
 * 赛前 / 赛后采访 on the key matches (the author's plan, approved 2026-09-26).
 *
 * Only where a match is one the career will remember: the first start, the first international, a series lost
 * is the way out, an upper-bracket final, a grand final, a Masters' or Champions' playoffs, and a night against a
 * former club, a former team-mate or a declared rival (me/rivals.ts). At most IV_CAP a season, like the nights
 * (me/cerbudget.ts): a crowded season lets the smaller ones go first. Never from the bench (the five named for the
 * day), never hurt or away.
 *
 * Before: one question, three answers — 稳 (a little of the coach's trust, no risk), 狠 (a claim: this match's calls
 * land a little more often, and the result will be read against it), 态度 (call out the other side, or stand by a
 * team-mate). After: what was said comes back. A claim made good is 说到做到, a big night for the following; a claim
 * that fell over is 打脸, and the question is asked again — 认错, 嘴硬 or 甩锅. The match's MVP gets asked whose
 * night it was. 托管 and the × take the first answer, which costs nothing.
 *
 * Bounded on purpose: only 心态, 状态, followers, heat, trust and the room move, and the one thing that touches a
 * match — 狠's calls — is a few points on the calls of that one match (IV_BOLD_NODE; scripts/check_interviews.ts
 * measures the series on paired simulations). The key rounds still decide the match.
 *
 * The questions and answers are ours (me/interviewBank.ts); no question comes twice in a season, and one comes
 * again only once everything that fits the moment has been asked. Real lines are in data/interview_moments.json,
 * each with its source: the one said at this very point of this very event is quoted when the world gets there,
 * and otherwise one said at a moment like this one (a final, a way out, a former club…) is quoted as 类似的时刻 —
 * each once a career until every line for that kind of moment has been shown. Anything another real player says
 * in reply is reported, never quoted: 「对面指挥赛后回应了你」.
 */

export type IvTone = 'steady' | 'bold' | 'att'

/** The pre-match interview, from the question to the result it is read against. */
export interface IvPre {
  fx: string
  kind: IvKind
  q: string
  /** the question's own words, as asked */
  ask: string
  year: number
  day: number
  opp: string
  /** 「多伦多大师赛 总决赛」 */
  about: string
  /** the other side's man the 态度 answer names, and my team-mate it backs */
  foe?: string
  pal?: string
  /** a real line: said at this very point of this event, or (`like`) at a moment like it */
  moment?: string
  like?: 1
  /** answered: which way, in which words */
  tone?: IvTone
  line?: string
  /** 托管 or the × answered it */
  auto?: 1
}

/** The post-match card, as it was the night it was played. */
export interface IvPost {
  fx: string
  kind: IvKind
  out: IvOutcome
  ask: string
  /** which of the outcome's answer sets (me/interviewBank.ts POST); absent in a card from before the sets */
  set?: number
  score: string
  won: boolean
  mvp: boolean
  about: string
  opp: string
  pal?: string
  foe?: string
  /** what the result already did to a claim, before anything is said */
  base: string[]
  moment?: string
  like?: 1
}

export interface IvBook {
  /** this season's count against IV_CAP */
  year: number
  n: number
  total: number
  pre?: IvPre
  post?: IvPost
  /** 狠: the calls of this one match */
  edge?: { fx: string; node: number; until: number }
  /** keys already used — one a comp or a foe a season; capped */
  seen: string[]
  /** the questions asked lately — kept for saves from before `hist`, no longer read */
  asked?: string[]
  /** every question and answer set asked, with when: year × 10000 + a running count (askOrder) */
  hist?: Record<string, number>
  seq?: number
  /** the real lines shown as 类似的时刻, oldest first */
  real?: string[]
  /** the week report's line */
  last?: { year: number; day: number; text: string }
  /** the most famous thing said, for the career's page */
  best?: { line: string; year: number; about: string; tag: string; score: number }
}

/** key-match interviews a season — the nights' own cap is 7 (me/cerbudget.ts) */
export const IV_CAP = 7
/** places each kind leaves free for the bigger ones when the season is crowded */
const RESERVE: Record<IvKind, number> = { final: 0, debut: 0, intl_debut: 1, ubf: 1, elim: 2, intl_po: 2, rival: 3, mate: 3, club: 3 }
/** 狠 before a match: what the calls of that match gain (me/matchplay.ts optionOdds) */
export const IV_BOLD_NODE = 0.03
/** a claim made good / fallen over: what the result does to the following, before anything is said */
export const IV_KEPT: EffectSpec = { fans: 60, heat: 25 }
export const IV_KEPT_BIG: EffectSpec = { fans: 90, heat: 35 }
export const IV_ATE: EffectSpec = { fans: -30, heat: -8, mental: -1, tilt: 6 }
/** the same attitude as the real line quoted on the card */
export const IV_MOMENT_BONUS: EffectSpec = { heat: 6, fans: 15 }
/** grudge nights keep this far apart */
const GRUDGE_GAP = 14
/** days back an interview keeps the generic press cards (me/events.ts interview, after_upset) away */
export const IV_QUIET_DAYS = 28

export const KIND_CN: Record<IvKind, string> = {
  debut: '职业首秀', intl_debut: '国际赛首秀', final: '总决赛', ubf: '胜者组决赛', elim: '输了就出局',
  intl_po: '国际赛季后赛', rival: '宿敌对决', mate: '对阵老队友', club: '对阵老东家',
}
const KIND_W: Record<IvKind, number> = { final: 6, ubf: 4, intl_po: 4, elim: 3, intl_debut: 3, debut: 2, club: 2, mate: 2, rival: 2 }

// ------------------------------------------------------------------ the real lines

export type IvSituation =
  | 'final' | 'elim' | 'comeback' | 'intl_debut' | 'vs_former' | 'heavy_loss' | 'mvp' | 'retire' | 'rookie'
  | 'rivalry' | 'upset' | 'champion' | 'runner_up' | 'any_win' | 'any_loss' | 'pressure'

export interface IvMoment {
  id: string
  date: string
  dateNote?: string
  year: number
  stage: string
  event: string
  round: string
  teams: string[]
  who: string
  team: string
  when: 'pre' | 'post'
  tone: IvTone
  /** the kinds of moment it was said at, for 类似的时刻 */
  tags: IvSituation[]
  quote: string
  cn: string
  /** how the words reached print, where they are not the original (an interview in Japanese, printed in English) */
  via?: string
  result: string
  note?: string
  source: string[]
}
export const IV_MOMENTS = MOMENTS as IvMoment[]

const roundOf = (f: Fixture): string => f.label.replace(/^(KO|SW|GS?):\d+:/, '').trim()

/** A real line said at this very point of this event: the same match first, the same round of it otherwise. */
export function momentFor(state: GameState, f: Fixture, when: 'pre' | 'post'): IvMoment | undefined {
  const comp = state.comps[f.comp]
  if (!comp) return undefined
  const round = roundOf(f)
  const here = IV_MOMENTS.filter((m) => m.when === when && m.year === state.year && m.stage === comp.stage && m.round === round)
  if (!here.length) return undefined
  const tags = [state.teams[f.teamA]?.tag, state.teams[f.teamB]?.tag]
  return here.find((m) => m.teams.length === 2 && m.teams.every((t) => tags.includes(t))) ?? here.find((m) => tags.includes(m.team)) ?? here[0]
}

/**
 * A real line for a moment like this one, when history has none for this very match: the first situation in the
 * list that still has a line this career has not been shown, the same side of the match first. Once every line
 * for the moment has been shown the oldest shown comes round again. Marks what it picks.
 */
export function likeMoment(state: GameState, sits: IvSituation[], when: 'pre' | 'post', salt: string): IvMoment | undefined {
  const b = book(state)
  const shown = (b.real ??= [])
  const pool = IV_MOMENTS.filter((m) => m.tags?.some((t) => sits.includes(t)))
  if (!pool.length) return undefined
  const rank = (m: IvMoment): number => Math.min(...m.tags.map((t) => (sits.includes(t) ? sits.indexOf(t) : 99)))
  const fresh = pool.filter((m) => !shown.includes(m.id))
  let pick: IvMoment | undefined
  if (fresh.length) {
    const best = Math.min(...fresh.map(rank))
    const top = fresh.filter((m) => rank(m) === best)
    const side = top.filter((m) => m.when === when)
    const from = side.length ? side : top
    pick = from[new Rng(hashStr(`iv:like:${state.seed}:${salt}`)).int(0, from.length - 1)]
  } else {
    // the whole pool has been shown: the one shown longest ago
    pick = pool.slice().sort((a, c) => shown.indexOf(a.id) - shown.indexOf(c.id))[0]
  }
  if (pick) {
    const i = shown.indexOf(pick.id)
    if (i >= 0) shown.splice(i, 1)
    shown.push(pick.id)
    if (shown.length > 150) shown.splice(0, shown.length - 150)
  }
  return pick
}

const monthDay = (date: string): string => {
  const [, m, d] = date.split('-').map(Number)
  return `${m} 月 ${d} 日`
}
const hasCjk = (s: string): boolean => /[一-鿿]/.test(s)

/** The words as the card quotes them: the original where it is Chinese, the translation with the original beside it otherwise. */
export function saidOf(m: IvMoment): string {
  if (hasCjk(m.quote)) return `「${m.quote}」`
  return `「${m.cn}」（${m.via ?? '原话'}：“${m.quote}”）`
}

/** 「真实历史里，…」: the line, short and attributed — this very match, or a moment like this one. */
export function momentLine(state: GameState, m: IvMoment, f?: { teamA: string; teamB: string }, like = false): string {
  const when = m.when === 'pre' ? '前' : '后'
  if (like) {
    const where = `${m.event}${m.round ? ` ${m.round}` : ''}`
    return `真实历史里，类似的时刻：${m.year} 年 ${monthDay(m.date)}，${where}，${m.who}（${m.team}）赛${when}说：${saidOf(m)}`
  }
  const same = f && m.teams.length === 2 && m.teams.every((t) => [state.teams[f.teamA]?.tag, state.teams[f.teamB]?.tag].includes(t))
  const where = same ? `就是这一场（${m.teams.join(' 对 ')}）` : `这一轮是 ${m.teams.join(' 对 ')}`
  return `真实历史里，${m.year} 年 ${monthDay(m.date)}，${where}。赛${when}，${m.who}（${m.team}）说：${saidOf(m)}`
}

// ------------------------------------------------------------------ the book

function book(state: GameState): IvBook {
  const me = state.me!
  const b = (me.iv ??= { year: state.year, n: 0, total: 0, seen: [] })
  if (b.year !== state.year) { b.year = state.year; b.n = 0 }
  b.seen ??= []
  return b
}

const now = (s: { year: number; day: number }): number => s.year * 400 + s.day

/** Nothing of this kind waiting, and none in the last four weeks: the generic press cards may come. */
export function ivQuiet(state: GameState): boolean {
  const me = state.me
  if (!me) return true
  if (me.pending.some((x) => x.kind === 'interview')) return false
  const last = me.iv?.last
  return !last || now(state) - now(last) > IV_QUIET_DAYS
}

/** When an id was last asked: year × 10000 + a running count, so the older of two reads smaller. */
function asked(state: GameState, id: string): void {
  const b = book(state)
  const hist = (b.hist ??= {})
  b.seq = ((b.seq ?? 0) + 1) % 10000
  hist[id] = state.year * 10000 + b.seq
}

/**
 * Of the ids that fit, one to ask now: never asked before, else not asked this season and asked longest ago, else
 * asked longest ago. Among the never-asked the weight decides (a question sharp to the moment before a general one).
 */
function freshest<T>(state: GameState, items: T[], idOf: (x: T) => string, weight: (x: T) => number, salt: string): T {
  const hist = book(state).hist ?? {}
  const rng = new Rng(hashStr(`iv:pick:${state.seed}:${salt}`))
  const never = items.filter((x) => hist[idOf(x)] === undefined)
  if (never.length) {
    const w = never.map(weight)
    return rng.weighted(never, w)
  }
  const old = (x: T): number => hist[idOf(x)]
  const notThisYear = items.filter((x) => Math.floor(old(x) / 10000) !== state.year)
  const from = notThisYear.length ? notThisYear : items
  return from.slice().sort((a, c) => old(a) - old(c))[0]
}

// ------------------------------------------------------------------ which matches

const INTL_ROUND = /^[A-D]组|小组/

function swissLosses(state: GameState, comp: Competition): number {
  const club = state.myTeam
  return state.fixtures.filter((f) => f.comp === comp.key && f.label.startsWith('SW:') && f.result && (f.teamA === club || f.teamB === club)
    && ((f.result.mapsWonA > f.result.mapsWonB) !== (f.teamA === club))).length
}

/** Lose this and the event is over for my club. */
export function isElim(state: GameState, f: Fixture): boolean {
  const comp = state.comps[f.comp]
  const name = roundOf(f)
  if (/败者组|败者赛|决胜赛/.test(name)) return true
  if (comp && f.label.startsWith('SW:')) return swissLosses(state, comp) >= 1
  // a single-elimination bracket: a Challengers stage's 半决赛, a qualifier's 四分之一决赛
  return !!comp && f.label.startsWith('KO:') && !/胜者组|中段组/.test(name) && !INTL_ROUND.test(name)
    && !['double', 'triple', 'masters', 'champions'].includes(comp.format ?? '')
}

/** the clubs I have played for, by name — the club where I met each team-mate, and each season's */
function formerClubs(state: GameState): Set<string> {
  const me = state.me!
  const cur = state.teams[state.myTeam]?.name
  const out = new Set<string>()
  for (const s of me.seasons) if (s.tier > 0 && s.team) out.add(s.team)
  for (const e of Object.values(me.mates ?? {})) if (e.team) out.add(e.team)
  if (cur) out.delete(cur)
  return out
}

/** a man on the other five I shared a roster with for a while */
function formerMate(state: GameState, oppId: string): string | undefined {
  const me = state.me!
  const opp = state.teams[oppId]
  if (!opp) return undefined
  const mine = state.teams[state.myTeam]?.roster ?? []
  return opp.starters
    .map((id) => me.mates?.[id])
    .filter((e): e is NonNullable<typeof e> => !!e && e.matches >= 8 && !mine.includes(e.id))
    .sort((a, b) => b.matches - a.matches)[0]?.id
}

const startsSoFar = (state: GameState): number => state.me!.seasons.reduce((n, s) => n + s.starts, 0) + state.me!.seasonStart.starts

function intlStarted(state: GameState): boolean {
  const me = state.me!
  if (me.flags.ivIntl) return true
  return me.matches.some((m) => m.started && !m.friendly && isIntlComp(m.comp)) || (me.intlRuns ?? []).some((r) => r.starts > 0)
}

/** What makes this match a key one, if anything does — the biggest reason first. */
export function keyKind(state: GameState, f: Fixture): { kind: IvKind; key: string; foe?: string } | null {
  const me = state.me!
  const comp = state.comps[f.comp]
  if (!comp || f.scrim || f.comp === 'scrim') return null
  const name = roundOf(f)
  const oppId = f.teamA === state.myTeam ? f.teamB : f.teamA
  const intl = isIntlComp(comp.name)
  if (!me.flags.ivDebut && startsSoFar(state) === 0) return { kind: 'debut', key: 'debut' }
  if (isFinal(name)) return { kind: 'final', key: `final:${f.id}` }
  if (intl && !intlStarted(state)) return { kind: 'intl_debut', key: 'intl_debut' }
  if (name === '胜者组决赛') return { kind: 'ubf', key: `ubf:${state.year}:${comp.key}` }
  if (isElim(state, f)) return { kind: 'elim', key: `elim:${state.year}:${comp.key}` }
  if (intl && f.label.startsWith('KO:') && !INTL_ROUND.test(name)) return { kind: 'intl_po', key: `intl_po:${state.year}:${comp.key}` }
  const rival = rivalOnTeam(state, oppId)
  if (rival && state.teams[oppId]?.starters.includes(rival.id)) return { kind: 'rival', key: `rival:${state.year}:${rival.id}`, foe: rival.id }
  const mate = formerMate(state, oppId)
  if (mate) return { kind: 'mate', key: `mate:${state.year}:${mate}`, foe: mate }
  const opp = state.teams[oppId]
  if (opp && formerClubs(state).has(opp.name)) return { kind: 'club', key: `club:${state.year}:${oppId}` }
  return null
}

/** the man across the floor a 态度 answer names: a rival, a former team-mate, my opposite number, their best */
function foeOf(state: GameState, oppId: string, given?: string): string | undefined {
  if (given) return given
  const opp = state.teams[oppId]
  if (!opp) return undefined
  const five = opp.starters.map((id) => state.players[id]).filter(Boolean)
  const role = state.players[state.me!.id]?.role
  return (five.find((p) => p.role === role) ?? five.sort((a, b) => b.overall - a.overall)[0])?.id
}

/** the team-mate a 态度 answer stands by: the one I am closest to on the five */
function palOf(state: GameState): string | undefined {
  const me = state.me!
  const five = (state.teams[state.myTeam]?.starters ?? []).filter((id) => id !== me.id && state.players[id])
  return five.sort((a, b) => bondBetween(state, me.id, b) - bondBetween(state, me.id, a) || (a < b ? -1 : 1))[0]
}

/** near the end: the season I said would be my last, or an age a career rarely goes past */
const lastYears = (state: GameState): boolean => state.me!.flags.farewellYear === state.year || (state.players[state.me!.id]?.age ?? 0) >= 31

/** The kinds of moment a pre-match interview is, for a real line said at one like it. */
function preSits(state: GameState, kind: IvKind): IvSituation[] {
  const base: Record<IvKind, IvSituation[]> = {
    debut: ['rookie'], intl_debut: ['intl_debut', 'rookie'], final: ['final', 'pressure'], ubf: ['pressure', 'final'],
    elim: ['elim', 'pressure'], intl_po: ['pressure', 'upset'], rival: ['rivalry'], mate: ['vs_former', 'rivalry'], club: ['vs_former', 'rivalry'],
  }
  return lastYears(state) ? ['retire', ...base[kind]] : base[kind]
}

/**
 * My match today, before the doors open (me/week.ts runDays, beside the final's walk-out): if it is a key one and
 * I am on the five, the pre-match interview is the next card.
 */
export function interviewBeforeMatch(state: GameState, f: Fixture): boolean {
  const me = state.me
  if (!me || me.phase !== 'pro' || activeAbsence(state)) return false
  const b = book(state)
  if (b.pre?.fx === f.id) return false
  const p = state.players[me.id]
  if (!p || p.injuredUntil > state.day) return false
  if (!state.teams[state.myTeam]?.starters.includes(me.id)) return false
  const k = keyKind(state, f)
  if (!k) return false
  if (b.seen.includes(k.key)) return false
  if (b.n >= IV_CAP - RESERVE[k.kind]) return false
  if (RESERVE[k.kind] >= 3 && b.last && now(state) - now(b.last) < GRUDGE_GAP) return false
  b.seen.push(k.key)
  if (b.seen.length > 60) b.seen.splice(0, b.seen.length - 60)
  if (k.kind === 'debut') me.flags.ivDebut = state.year
  const comp = state.comps[f.comp]
  if (comp && isIntlComp(comp.name)) me.flags.ivIntl = state.year
  b.n++
  b.total++
  const oppId = f.teamA === state.myTeam ? f.teamB : f.teamA
  const about = `${compCn(comp?.name ?? f.comp)} ${roundOf(f)}`
  const foe = foeOf(state, oppId, k.foe)
  const pal = palOf(state)
  const q = pickQuestion(state, f, k.kind, !!foe, !!pal)
  asked(state, q.id)
  // this very match's real line, else one said at a moment like it
  const exact = momentFor(state, f, 'pre')
  const like = exact ? undefined : likeMoment(state, preSits(state, k.kind), 'pre', `pre:${f.id}`)
  const m = exact ?? like
  b.pre = {
    fx: f.id, kind: k.kind, q: q.id, ask: fill(state, q.q, { oppId, foe, pal }),
    year: state.year, day: state.day, opp: oppId, about, foe, pal,
    ...(m ? { moment: m.id } : {}), ...(like ? { like: 1 as const } : {}),
  }
  b.post = undefined
  b.edge = undefined
  push(state, { kind: 'interview', id: `pre:${f.id}` })
  return true
}

// ------------------------------------------------------------------ the questions

function fill(state: GameState, text: string, who: { oppId: string; foe?: string; pal?: string }): string {
  const opp = state.teams[who.oppId]
  return text
    .replace(/\{opp\}/g, opp?.name ?? '对面')
    .replace(/\{foe\}/g, (who.foe && state.players[who.foe]?.ign) || '对面的人')
    .replace(/\{pal\}/g, (who.pal && state.players[who.pal]?.ign) || '队友')
}

const texts = (q: Q): string[] => [q.q, q.a[0], q.a[1], (q.a[2] as Ans).t]

function pickQuestion(state: GameState, f: Fixture, kind: IvKind, foe: boolean, pal: boolean): Q {
  const me = state.me!
  const last = me.matches.filter((m) => !m.friendly && m.started).slice(-3)
  const mine = state.teams[state.myTeam]
  const opp = state.teams[f.teamA === state.myTeam ? f.teamB : f.teamA]
  const gap = (opp?.rating ?? 0) - (mine?.rating ?? 0)
  const cond: Record<NonNullable<Q['if']>, boolean> = {
    lost: !!last.length && !last[last.length - 1].won,
    streak: last.length === 3 && last.every((m) => m.won),
    firstFinal: !me.matches.some((m) => m.started && isFinal(m.label)),
    under: gap >= 4,
    over: gap <= -4,
    swiss: f.label.startsWith('SW:'),
  }
  const fits = BANK.filter((q) => q.k.includes(kind) && (!q.if || cond[q.if])
    && (pal || !texts(q).some((t) => t.includes('{pal}')))
    && (foe || !texts(q).some((t) => t.includes('{foe}'))))
  const pool = fits.length ? fits : BANK.filter((q) => q.k.includes(kind))
  // sharp to the moment first, the kind's own next, the general ones after
  return freshest(state, pool, (q) => q.id, (q) => (q.if ? 3 : q.k.length === ALL.length - 1 ? 1 : 2), `q:${f.id}`)
}

// ------------------------------------------------------------------ the cards

export interface IvOpt {
  t: string
  tone: IvTone
  e: EffectSpec
  notes: string[]
  /** what kind of answer it is, said first on the button: 认错 / 嘴硬 / 甩锅 */
  tag?: string
}
export interface IvCard {
  id: string
  pre: boolean
  title: string
  about: string
  ctx: string[]
  q: string
  opts: IvOpt[]
  /** a real line from this very point of this event, or from a moment like it */
  moment?: string
}

const PRE_EFFECT: Record<IvTone, EffectSpec> = {
  steady: { coachTrust: 1 },
  bold: {},
  att: { heat: 6 },
}
/** a named man's bond or rivalry moves by this much on a 态度 answer */
const ATT_MATE = 5
const ATT_FOE = 6
const SAME_TONE = '和真实历史里那句话一个态度'

function preCard(state: GameState, pre: IvPre): IvCard {
  const q = BANK.find((x) => x.id === pre.q) ?? BANK[0]
  const who = { oppId: pre.opp, foe: pre.foe, pal: pre.pal }
  const att = q.a[2]
  const foeIgn = pre.foe ? state.players[pre.foe]?.ign : undefined
  const palIgn = pre.pal ? state.players[pre.pal]?.ign : undefined
  const opts: IvOpt[] = [
    { t: fill(state, q.a[0], who), tone: 'steady', e: PRE_EFFECT.steady, notes: ['没有风险'] },
    { t: fill(state, q.a[1], who), tone: 'bold', e: PRE_EFFECT.bold, notes: ['这场关键回合更敢打', '赢了涨一波粉，输了会被翻出来'] },
    {
      t: fill(state, att.t, who), tone: 'att', e: PRE_EFFECT.att,
      notes: [att.to === 'mate' ? (palIgn ? `和 ${palIgn} 近一点` : '队里近一点') : (foeIgn ? `和 ${foeIgn} 的火药味更重` : '对面听得懂')],
    },
  ]
  const m = pre.moment ? IV_MOMENTS.find((x) => x.id === pre.moment) : undefined
  const f = state.fixtures.find((x) => x.id === pre.fx)
  if (m) for (const o of opts) if (o.tone === m.tone) o.notes.push(SAME_TONE)
  const opp = state.teams[pre.opp]
  const ctx = [`${pre.about} · 对手 ${opp?.name ?? '对面'}`, situation(state, pre)]
  return {
    id: `pre:${pre.fx}`, pre: true, title: '赛前采访', about: KIND_CN[pre.kind], ctx: ctx.filter(Boolean), q: pre.ask, opts,
    ...(m ? { moment: momentLine(state, m, f, !!pre.like) } : {}),
  }
}

function situation(state: GameState, pre: IvPre): string {
  const foe = pre.foe ? state.players[pre.foe]?.ign : undefined
  switch (pre.kind) {
    case 'debut': return '你的第一场职业首发。'
    case 'intl_debut': return '你的第一场国际赛。'
    case 'final': return '赢了就是冠军。'
    case 'ubf': return '赢了直通总决赛，输了掉进败者组。'
    case 'elim': return '输了，这项赛事就结束了。'
    case 'intl_po': return '国际赛的季后赛，镜头比平时多一倍。'
    case 'rival': return foe ? `${foe} 在对面首发。你们之间的账还没算完。` : '宿敌在对面。'
    case 'mate': return foe ? `${foe} 以前是你的队友，今天在对面。` : '对面有你的老队友。'
    case 'club': return '对面是你的老东家。'
  }
}

function postCard(state: GameState, post: IvPost): IvCard {
  const pre = state.me!.iv?.pre
  const said = pre?.fx === post.fx ? pre.line ?? '' : ''
  const def = POST[post.out]
  const set = def.sets[post.set ?? 0] ?? def.sets[0]
  const palIgn = post.pal ? state.players[post.pal]?.ign : undefined
  const foeIgn = post.foe ? state.players[post.foe]?.ign : undefined
  const opts: IvOpt[] = set.map((t, i) => {
    const to = def.to[i]
    const notes: string[] = []
    if (i === 0) notes.push('没有风险')
    if (post.out === 'ate' && i === 2) notes.push(palIgn ? `和 ${palIgn} 远一点` : '队里有人会听到')
    else if (to === 'mate' && palIgn) notes.push(`和 ${palIgn} 近一点`)
    if (to === 'opp' && foeIgn) notes.push(`和 ${foeIgn} 的火药味更重`)
    const tag = def.tag?.[i]
    return {
      t: t.replace(/\{pal\}/g, palIgn ?? '队友').replace(/\{foe\}/g, foeIgn ?? '对面'),
      tone: i === 0 ? 'steady' : i === 1 ? 'bold' : 'att', e: def.e[i], notes, ...(tag ? { tag } : {}),
    }
  })
  const ctx: string[] = [`${post.about} · ${post.score} ${post.won ? '赢了' : '输了'}${post.mvp ? '，你是这场的 MVP' : ''}`]
  if (said && (post.out === 'kept' || post.out === 'ate' || pre?.tone)) ctx.push(`赛前你说：「${said}」`)
  if (post.base.length) ctx.push(`${post.out === 'kept' ? '说到做到' : '打脸'}：${post.base.join('、')}`)
  // what the other side made of it, reported — never a real man's words made up
  if (pre?.fx === post.fx && pre.tone === 'att' && pre.foe && BANK.find((x) => x.id === pre.q)?.a[2].to === 'opp') {
    ctx.push(post.won ? `赛后有记者把你的话转给了 ${foeIgn ?? '对面'}，他没多说。` : `${state.teams[post.opp]?.name ?? '对面'} 的人在赛后采访里回应了你的话。`)
  }
  const m = post.moment ? IV_MOMENTS.find((x) => x.id === post.moment) : undefined
  const f = state.fixtures.find((x) => x.id === post.fx)
  if (m) opts[m.tone === 'steady' ? 0 : m.tone === 'bold' ? 1 : 2]?.notes.push(SAME_TONE)
  return {
    id: `post:${post.fx}`, pre: false, title: '赛后采访', about: KIND_CN[post.kind], ctx,
    q: post.ask.replace('{said}', said.length > 16 ? `${said.slice(0, 15)}…` : said), opts,
    ...(m ? { moment: momentLine(state, m, f, !!post.like) } : {}),
  }
}

/** The card for a pending interview, or null when it no longer stands (the answer came another way). */
export function ivCard(state: GameState, id: string): IvCard | null {
  const b = state.me?.iv
  if (!b) return null
  if (id.startsWith('pre:') && b.pre && `pre:${b.pre.fx}` === id && !b.pre.tone) return preCard(state, b.pre)
  if (id.startsWith('post:') && b.post && `post:${b.post.fx}` === id) return postCard(state, b.post)
  return null
}

// ------------------------------------------------------------------ answers

function score(kind: IvKind, mul: number, intl: boolean): number {
  return KIND_W[kind] * mul * (intl ? 1.3 : 1)
}

function remember(state: GameState, line: string, about: string, tag: string, s: number): void {
  const b = book(state)
  if (!line) return
  if (!b.best || s > b.best.score) b.best = { line, year: state.year, about, tag, score: Math.round(s * 10) / 10 }
}

function said(state: GameState, text: string): void {
  book(state).last = { year: state.year, day: state.day, text }
}

/** Answer a pre- or post-match interview. `choice` out of range is the first answer — the one that costs nothing. */
export function ivAnswer(state: GameState, id: string, choice: number, auto = false): string[] {
  const me = state.me
  if (!me) return []
  const card = ivCard(state, id)
  pop(state, 'interview', id)
  if (!card) return []
  const b = book(state)
  const i = Number.isInteger(choice) && choice >= 0 && choice < card.opts.length ? choice : 0
  const opt = card.opts[i]
  const rng = new Rng(hashStr(`iv:answer:${state.seed}:${id}`))
  const lines = applyEffect(state, opt.e, rng)
  if (card.pre) {
    const pre = b.pre!
    pre.tone = opt.tone
    pre.line = opt.t
    if (auto) pre.auto = 1
    const q = BANK.find((x) => x.id === pre.q)
    if (pre.tone === 'bold') {
      b.edge = { fx: pre.fx, node: IV_BOLD_NODE, until: state.day + 3 }
      lines.push('这场关键回合更敢打')
    } else if (pre.tone === 'att') {
      lines.push(...attitude(state, q?.a[2].to ?? 'opp', pre.pal, pre.foe, 1))
    }
    lines.push(...momentBonus(state, pre.moment, pre.tone))
    const trait = auto ? null : addAxis(state, pre.tone === 'steady' ? 'grind' : pre.tone === 'bold' ? 'show' : q?.a[2].to === 'mate' ? 'warm' : 'hard')
    if (trait) lines.push(`你成了「${trait}」`)
    const text = `${pre.about}前的采访，你说：「${pre.line}」`
    pushLog(state, 'event', `${text}${lines.length ? `（${lines.join('，')}）` : ''}`)
    said(state, text)
    // a line that is never read against a result is still a line
    remember(state, pre.line, pre.about, '赛前', score(pre.kind, pre.tone === 'bold' ? 1.5 : pre.tone === 'att' ? 1.3 : 1, !!intlOf(state, pre.fx)))
    return lines
  }
  const post = b.post!
  const def = POST[post.out]
  lines.push(...attitude(state, def.to[i], post.pal, post.foe, post.out === 'ate' && i === 2 ? -1.6 : post.out === 'mvp' && i === 2 ? -0.6 : 1))
  lines.push(...momentBonus(state, post.moment, opt.tone))
  const pre = b.pre?.fx === post.fx ? b.pre : undefined
  const text = post.out === 'kept' ? `${post.about}，赛前的话说到做到。赛后你说：「${opt.t}」`
    : post.out === 'ate' ? `${post.about}，赛前的话被翻了出来。赛后你说：「${opt.t}」`
      : `${post.about}，赛后你说：「${opt.t}」`
  // 'event', not good / bad: the week report carries it once, as its own 🎙️ line (me/press.ts)
  pushLog(state, 'event', `${text}${lines.length ? `（${lines.join('，')}）` : ''}`)
  said(state, text)
  const intl = !!intlOf(state, post.fx)
  if (pre?.line && (post.out === 'kept' || post.out === 'ate')) remember(state, pre.line, pre.about, post.out === 'kept' ? '赛前 · 说到做到' : '赛前 · 打脸', score(post.kind, post.out === 'kept' ? 3 : 2, intl))
  if (i > 0 && (post.out === 'kept' || post.out === 'mvp')) remember(state, opt.t, post.about, post.out === 'mvp' ? '赛后 · MVP' : '赛后', score(post.kind, i === 2 ? 2.2 : 1.8, intl))
  b.post = undefined
  return lines
}

const intlOf = (state: GameState, fx: string): boolean => {
  const f = state.fixtures.find((x) => x.id === fx)
  const comp = f ? state.comps[f.comp] : undefined
  return !!comp && isIntlComp(comp.name)
}

/** 态度: the named team-mate a little closer (or further), the named man across the floor a little hotter. */
function attitude(state: GameState, to: 'mate' | 'opp' | null | undefined, pal: string | undefined, foe: string | undefined, mul: number): string[] {
  const me = state.me!
  const out: string[] = []
  if (to === 'mate' && pal && state.players[pal]) {
    const d = Math.round(ATT_MATE * mul)
    duoBonded(state, me.id, pal, d)
    out.push(`和 ${state.players[pal].ign} 的关系 ${d > 0 ? '+' : ''}${d}`)
  } else if (to === 'opp' && foe && state.players[foe]) {
    stokeRival(state, state.players[foe], ATT_FOE * Math.abs(mul))
    out.push(`和 ${state.players[foe].ign} 的火药味更重了`)
  }
  return out
}

function momentBonus(state: GameState, id: string | undefined, tone: IvTone): string[] {
  const m = id ? IV_MOMENTS.find((x) => x.id === id) : undefined
  if (!m || m.tone !== tone) return []
  const lines = applyEffect(state, IV_MOMENT_BONUS)
  return [`和真实历史里 ${m.who} 那句话一个态度`, ...lines]
}

// ------------------------------------------------------------------ after the match

/** The kinds of moment a post-match interview is: what the result was, and what kind of night. */
function postSits(state: GameState, kind: IvKind, out: IvOutcome, rec: MeMatchRecord): IvSituation[] {
  const sits: IvSituation[] = []
  const final = kind === 'final'
  const comeback = rec.won && !!rec.mapLog?.length && !rec.mapLog[0].won
  const heavy = !rec.won && /^0-/.test(rec.score)
  if (lastYears(state) && !rec.won) sits.push('retire')
  if (rec.won) {
    if (final) sits.push('champion')
    if (rec.mvp) sits.push('mvp')
    if (comeback) sits.push('comeback')
    if (kind === 'intl_po' || kind === 'rival') sits.push('upset')
    sits.push('any_win')
  } else {
    if (final) sits.push('runner_up')
    if (heavy) sits.push('heavy_loss')
    if (out === 'out' || kind === 'elim') sits.push('elim')
    sits.push('any_loss')
  }
  if (kind === 'club' || kind === 'mate') sits.push('vs_former')
  if (kind === 'rival') sits.push('rivalry')
  return sits
}

/** a post-match card worth a real line of its own: a claim read back, a night's MVP, the end of the road, a final */
const LOUD: IvOutcome[] = ['kept', 'ate', 'mvp', 'out']

/**
 * The match is over (me/matchplay.ts finishInternal, before the coach reads it): if a pre-match interview was
 * answered for it, what was said meets the result, and the post-match card is the next thing on screen.
 */
export function interviewAfterMatch(state: GameState, rec: MeMatchRecord): void {
  const me = state.me
  const b = me?.iv
  if (!me || !b?.pre || b.pre.fx !== rec.fixtureId || !b.pre.tone) return
  const pre = b.pre
  b.edge = undefined
  if (!rec.started) {
    // named the day before and not on the floor: nobody holds a man to what he said about a match he watched
    pushLog(state, 'info', `${pre.about}：你最后没有上场，赛前那句话没人追究。`)
    return
  }
  const f = state.fixtures.find((x) => x.id === rec.fixtureId)
  const elim = f ? pre.kind === 'elim' || pre.kind === 'final' : false
  const out: IvOutcome = pre.tone === 'bold' ? (rec.won ? 'kept' : 'ate') : rec.mvp ? 'mvp' : rec.won ? 'won' : elim ? 'out' : 'lost'
  const base: string[] = []
  if (out === 'kept') base.push(...applyEffect(state, pre.kind === 'final' || intlOf(state, pre.fx) ? IV_KEPT_BIG : IV_KEPT))
  if (out === 'ate') base.push(...applyEffect(state, IV_ATE))
  const def = POST[out]
  // the question and the words of the answers, each the one asked longest ago
  const qi = freshest(state, def.qs.map((_, i) => i), (i) => `post:${out}:${i}`, () => 1, `pq:${rec.fixtureId}`)
  const si = freshest(state, def.sets.map((_, i) => i), (i) => `set:${out}:${i}`, () => 1, `ps:${rec.fixtureId}`)
  asked(state, `post:${out}:${qi}`)
  asked(state, `set:${out}:${si}`)
  const exact = f ? momentFor(state, f, 'post') : undefined
  const like = !exact && (LOUD.includes(out) || pre.kind === 'final') ? likeMoment(state, postSits(state, pre.kind, out, rec), 'post', `post:${rec.fixtureId}`) : undefined
  const m = exact ?? like
  b.post = {
    fx: rec.fixtureId, kind: pre.kind, out, ask: def.qs[qi], set: si, score: rec.score, won: rec.won, mvp: rec.mvp,
    about: pre.about, opp: pre.opp, pal: pre.pal, foe: pre.foe, base,
    ...(m ? { moment: m.id } : {}), ...(like ? { like: 1 as const } : {}),
  }
  pushFront(state, { kind: 'interview', id: `post:${rec.fixtureId}` })
}

// ------------------------------------------------------------------ what the rest of the game reads

/** 狠 before this match: what the calls gain (me/matchplay.ts optionOdds). Nothing on any other match. */
export function ivEdge(state: GameState, fxId: string): number {
  const e = state.me?.iv?.edge
  return e && e.fx === fxId && e.until >= state.day ? e.node : 0
}

/** The pre-match card's line where 狠 is on this match (ui/me/MatchPlay.tsx). */
export function ivMatchLine(state: GameState, fxId: string, nums: boolean): string | null {
  const d = ivEdge(state, fxId)
  if (!d) return null
  return `赛前你放了话：这场关键回合更敢打一点${nums ? `（决策成功率 +${Math.round(d * 100)}%）` : ''}。两队的实力对比不会因此改变。`
}

/** The week report's line, if an interview was this week (me/press.ts weekReport). */
export function ivWeekLine(state: GameState): { year: number; day: number; text: string } | undefined {
  return state.me?.iv?.last
}

/** The most famous thing said, for the career's page. */
export function ivBest(state: GameState): IvBook['best'] {
  return state.me?.iv?.best
}

/** 托管 and the ×: the first answer, which costs nothing. */
export function ivAuto(state: GameState, item: PendingItem): string {
  const card = ivCard(state, item.id ?? '')
  if (!card) { pop(state, 'interview', item.id); return '' }
  ivAnswer(state, card.id, 0, true)
  return `${card.title}：${card.opts[0].t}`
}

/** For the checks: how many key-match interviews this season has had. */
export const ivCount = (state: GameState): number => (state.me?.iv?.year === state.year ? state.me.iv.n : 0)

/** For the checks: the bank's size. */
export const IV_BANK_SIZE = BANK.length
