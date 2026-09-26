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
import MOMENTS from '../../data/interview_moments.json'

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
 * The questions and answers are ours, written in the spirit of real ones. Real lines said at the same point of the
 * same event are in data/interview_moments.json, each with its source, and are quoted — short, and attributed —
 * when this world reaches that event and round. Anything another real player says in reply is reported, never
 * quoted: 「对面指挥赛后回应了你」.
 */

export type IvKind = 'debut' | 'intl_debut' | 'final' | 'ubf' | 'elim' | 'intl_po' | 'rival' | 'mate' | 'club'
export type IvTone = 'steady' | 'bold' | 'att'
export type IvOutcome = 'kept' | 'ate' | 'mvp' | 'won' | 'lost' | 'out'

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
  /** a real line from the same point of the same event (data/interview_moments.json) */
  moment?: string
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
  /** the questions asked lately, so the same one does not come twice in a row */
  asked: string[]
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
/** the same attitude as the real line at this point of this event */
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

export interface IvMoment {
  id: string
  date: string
  year: number
  stage: string
  event: string
  round: string
  teams: string[]
  who: string
  team: string
  when: 'pre' | 'post'
  tone: IvTone
  quote: string
  cn: string
  result: string
  note?: string
  source: string[]
}
export const IV_MOMENTS = MOMENTS as IvMoment[]

const roundOf = (f: Fixture): string => f.label.replace(/^(KO|SW|GS?):\d+:/, '').trim()

/** A real line said at this point of this event: the same match first, the same round of it otherwise. */
export function momentFor(state: GameState, f: Fixture, when: 'pre' | 'post'): IvMoment | undefined {
  const comp = state.comps[f.comp]
  if (!comp) return undefined
  const round = roundOf(f)
  const here = IV_MOMENTS.filter((m) => m.when === when && m.year === state.year && m.stage === comp.stage && m.round === round)
  if (!here.length) return undefined
  const tags = [state.teams[f.teamA]?.tag, state.teams[f.teamB]?.tag]
  return here.find((m) => m.teams.every((t) => tags.includes(t))) ?? here.find((m) => tags.includes(m.team)) ?? here[0]
}

const monthDay = (date: string): string => {
  const [, m, d] = date.split('-').map(Number)
  return `${m} 月 ${d} 日`
}

/** 「真实历史里，…」: the line, short and attributed, with the words it was said in. */
export function momentLine(state: GameState, m: IvMoment, f?: { teamA: string; teamB: string }): string {
  const same = f && m.teams.every((t) => [state.teams[f.teamA]?.tag, state.teams[f.teamB]?.tag].includes(t))
  const when = m.when === 'pre' ? '前' : '后'
  const where = same ? `就是这一场（${m.teams.join(' 对 ')}）` : `这一轮是 ${m.teams.join(' 对 ')}`
  const said = m.cn === m.quote ? `「${m.cn}」` : `「${m.cn}」（原话：“${m.quote}”）`
  return `真实历史里，${m.year} 年 ${monthDay(m.date)}，${where}。赛${when}，${m.who}（${m.team}）说：${said}`
}

// ------------------------------------------------------------------ the book

function book(state: GameState): IvBook {
  const me = state.me!
  const b = (me.iv ??= { year: state.year, n: 0, total: 0, seen: [], asked: [] })
  if (b.year !== state.year) { b.year = state.year; b.n = 0 }
  b.seen ??= []
  b.asked ??= []
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
  const m = momentFor(state, f, 'pre')
  b.pre = {
    fx: f.id, kind: k.kind, q: q.id, ask: fill(state, q.q, { oppId, foe, pal }),
    year: state.year, day: state.day, opp: oppId, about, foe, pal, ...(m ? { moment: m.id } : {}),
  }
  b.post = undefined
  b.edge = undefined
  b.asked.push(q.id)
  if (b.asked.length > 12) b.asked.splice(0, b.asked.length - 12)
  push(state, { kind: 'interview', id: `pre:${f.id}` })
  return true
}

// ------------------------------------------------------------------ the questions

interface Ans { t: string; to?: 'opp' | 'mate' }
interface Q {
  id: string
  k: IvKind[]
  /** only when: the last official match lost, three won, the first final, the other side is stronger / weaker */
  if?: 'lost' | 'streak' | 'firstFinal' | 'under' | 'over' | 'swiss'
  q: string
  /** 稳, 狠, 态度 */
  a: [string, string, Ans]
}

const ALL: IvKind[] = ['debut', 'intl_debut', 'final', 'ubf', 'elim', 'intl_po', 'rival', 'mate', 'club']

/**
 * The bank: {opp} their club, {club} the same as a former club, {foe} their man, {pal} my team-mate, {comp} the event.
 * Original lines in the spirit of real ones — nothing here is a real player's words.
 */
const BANK: Q[] = [
  // 职业首秀
  { id: 'debut_nerves', k: ['debut'], q: '第一次首发，紧张吗？', a: ['紧张肯定有，把训练里的东西打出来就行。', '不紧张。今天之后，大家会记住这个 ID。', { t: '有 {pal} 在旁边，我什么都不怕。', to: 'mate' }] },
  { id: 'debut_name', k: ['debut'], q: '很多人第一次听说你的名字，想对他们说什么？', a: ['先记住我们队，我慢慢来。', '今天就会记住的。', { t: '我是来帮 {pal} 分担火力的。', to: 'mate' }] },
  { id: 'debut_coach', k: ['debut'], q: '教练把你放进首发，你觉得他看中了你什么？', a: ['训练态度吧，我会对得起这个位置。', '看中我能赢比赛。', { t: '看中我敢跟 {foe} 对枪。', to: 'opp' }] },
  { id: 'debut_vets', k: ['debut'], if: 'under', q: '对面都是老将，你怎么看这场？', a: ['向他们学习，打好自己。', '老将也会失误，我等着。', { t: '{foe} 应该还没看过我的录像。', to: 'opp' }] },
  // 国际赛首秀
  { id: 'intl_first', k: ['intl_debut'], q: '第一次站上国际赛的舞台，是什么感觉？', a: ['很荣幸，先把第一场打好。', '我们不是来观光的。', { t: '赛区的脸面在我们身上，{pal} 和我都憋了很久。', to: 'mate' }] },
  { id: 'intl_filler', k: ['intl_debut'], q: '外面说你们赛区是来凑数的，你怎么回应？', a: ['用比赛回答，不用说太多。', '凑数的队，会把别人送回家。', { t: '{opp} 可以先担心自己。', to: 'opp' }] },
  { id: 'intl_crowd', k: ['intl_debut'], q: '这里的观众大多不认识你，想让他们记住什么？', a: ['记住我们队的配合。', '记住我的名字，很快还会再听到。', { t: '记住 {pal}，他值得。', to: 'mate' }] },
  { id: 'intl_jetlag', k: ['intl_debut'], q: '时差倒过来了吗？', a: ['差不多了，身体准备好了。', '该睡不着的是对面。', { t: '{pal} 每天拉着我早起训练，没问题。', to: 'mate' }] },
  // 总决赛
  { id: 'final_msg', k: ['final'], q: '明天就是总决赛了，有什么想对 {opp} 说的？', a: ['很尊重他们，决赛不会轻松。', '奖杯是我们的，他们来陪跑。', { t: '{foe}，决赛对位见。', to: 'opp' }] },
  { id: 'final_one', k: ['final'], q: '离冠军只差一场，你现在在想什么？', a: ['什么都不想，只想第一张图的第一个回合。', '在想奖杯举起来有多重。', { t: '在想 {pal}，他为这一天等了很多年。', to: 'mate' }] },
  { id: 'final_under', k: ['final'], if: 'under', q: '很多人不看好你们能赢下决赛，你怎么看？', a: ['我们不在乎外面的声音。', '不看好的人，记得准时看比赛。', { t: '{opp} 也没那么可怕。', to: 'opp' }] },
  { id: 'final_over', k: ['final'], if: 'over', q: '你们是夺冠热门，压力大吗？', a: ['压力是好事，说明我们走到了这里。', '压力给对面。', { t: '压力我们五个人一起扛，{pal} 扛得最多。', to: 'mate' }] },
  { id: 'final_thanks', k: ['final'], q: '如果拿下冠军，你最想感谢谁？', a: ['全队和教练组，谁都少不了。', '先拿了再说——但它会是我们的。', { t: '{pal}。没有他就没有这个赛季。', to: 'mate' }] },
  { id: 'final_first', k: ['final'], if: 'firstFinal', q: '这是你第一次打总决赛，会紧张吗？', a: ['会，但紧张不会让我手抖。', '决赛就是为我这样的人准备的。', { t: '该紧张的是 {opp}。', to: 'opp' }] },
  // 胜者组决赛
  { id: 'ubf_life', k: ['ubf'], q: '胜者组决赛，赢了直通总决赛，输了还有一条命，你们怎么想？', a: ['当成淘汰赛打，不留后路。', '我们不打算去败者组。', { t: '{opp} 可以去败者组好好练练。', to: 'opp' }] },
  { id: 'ubf_hide', k: ['ubf'], q: '总决赛很可能还会碰上，今天要藏东西吗？', a: ['不藏，能打的都打出来。', '不用藏，今天就让他们没信心。', { t: '藏也没用，我们太了解 {foe} 了。', to: 'opp' }] },
  { id: 'ubf_hard', k: ['ubf'], q: '上一轮赢得很艰难，今天状态如何？', a: ['复盘过了，今天会更稳。', '难打的已经打完了。', { t: '{pal} 上一场扛住了，今天轮到我。', to: 'mate' }] },
  // 输了就出局
  { id: 'elim_home', k: ['elim'], q: '输了就回家，这场你们怎么准备？', a: ['当作最后一场打，每个回合都打好。', '回家的会是 {opp}。', { t: '我不想让 {pal} 的赛季在这里结束。', to: 'mate' }] },
  { id: 'elim_drop', k: ['elim'], if: 'lost', q: '刚输了一场掉下来，心态有影响吗？', a: ['输了就输了，今天是新的比赛。', '掉下来一次，我们会从下面一路打回去。', { t: '上一场不怪任何人，我和 {pal} 会一起扛过去。', to: 'mate' }] },
  { id: 'elim_long', k: ['elim'], q: '一路从败者组打上来，累吗？', a: ['累，但打得越多手越热。', '越打越顺，谁碰上我们谁倒霉。', { t: '{pal} 每场都在带我们，我跟着就行。', to: 'mate' }] },
  { id: 'elim_wall', k: ['elim'], q: '这是你们这个赛段最后一道坎吗？', a: ['现在只想这一场。', '不是最后一道坎，是最后一个挡路的。', { t: '{opp} 挡不住我们。', to: 'opp' }] },
  { id: 'elim_odds', k: ['elim'], if: 'under', q: '外面说你们今天大概率出局，你怎么看？', a: ['不在乎概率，打完再说。', '概率是给看比赛的人算的。', { t: '我倒想看看 {opp} 顶不顶得住压力。', to: 'opp' }] },
  { id: 'elim_swiss', k: ['elim'], if: 'swiss', q: '瑞士轮再输一场就出局，今天这场对你意味着什么？', a: ['一场定生死，我们有准备。', '我们不会一轮游。', { t: '为了 {pal}，也得赢。', to: 'mate' }] },
  // 国际赛季后赛
  { id: 'po_goal', k: ['intl_po'], q: '进了季后赛，你们的目标是什么？', a: ['先赢下眼前这一场。', '目标只有冠军。', { t: '让大家看到 {pal} 有多强。', to: 'mate' }] },
  { id: 'po_giant', k: ['intl_po'], if: 'under', q: '对手 {opp} 是世界级强队，你们的机会在哪？', a: ['把自己的东西打出来，机会自己会来。', '世界级？今天之后就不一定了。', { t: '{foe} 的习惯，我们研究透了。', to: 'opp' }] },
  { id: 'po_stats', k: ['intl_po'], q: '你这届的数据很亮眼，有信心保持吗？', a: ['数据是队友喂出来的，我照常打。', '今天会更好看。', { t: '数据是我的，功劳是 {pal} 的。', to: 'mate' }] },
  { id: 'po_prove', k: ['intl_po'], q: '在这个舞台上，你想证明什么？', a: ['证明我们配得上这个舞台。', '证明我是这个位置最好的。', { t: '证明 {foe} 不是唯一的明星。', to: 'opp' }] },
  // 对阵老东家
  { id: 'club_mood', k: ['club'], q: '今天对阵老东家 {opp}，心情怎么样？', a: ['很感谢在那里的日子，但今天只是一场比赛。', '我会让他们后悔放我走。', { t: '有些话，我放在比赛里说。', to: 'opp' }] },
  { id: 'club_know', k: ['club'], q: '{opp} 的人你都很熟，这是优势吗？', a: ['互相都熟，看谁准备得更好。', '他们的每个习惯我都知道。', { t: '现在我的队友是 {pal} 他们，这才是我的队。', to: 'mate' }] },
  { id: 'club_grudge', k: ['club'], q: '离开 {opp} 的时候外面说法很多，今天会带着情绪吗？', a: ['过去了，我只想打好比赛。', '情绪会有，全打在对面身上。', { t: '谁心里有数，谁自己知道。', to: 'opp' }] },
  { id: 'club_hello', k: ['club'], q: '赛后会和老东家的人打招呼吗？', a: ['当然会，比赛归比赛。', '赛后再说，先让他们输。', { t: '我现在只惦记着身边这几个人，{pal} 是其中一个。', to: 'mate' }] },
  // 对阵老队友
  { id: 'mate_talk', k: ['mate'], q: '对面有你的老队友 {foe}，你们赛前聊过吗？', a: ['聊过，互相祝好运。', '聊了，我告诉他今天会很难受。', { t: '今天不聊，对位里再说。', to: 'opp' }] },
  { id: 'mate_target', k: ['mate'], q: '你最了解 {foe} 的打法，今天会针对他吗？', a: ['针对的是整个队，不是一个人。', '会。他知道我会去找他。', { t: '他那几个习惯，今天会让他吃亏。', to: 'opp' }] },
  { id: 'mate_duel', k: ['mate'], q: '你和 {foe} 以前是队友，今天这场对位谁会赢？', a: ['看临场，我们都太了解对方了。', '我。没什么好犹豫的。', { t: '以前的队友，今天的对手——我尊重他，也会赢他。', to: 'opp' }] },
  // 宿敌
  { id: 'rival_hype', k: ['rival'], q: '又碰上 {foe}，你们的对位大家都很期待，你怎么看？', a: ['他很强，所以我会准备得更好。', '期待的话，就看我怎么赢他。', { t: '上次的账，今天算。', to: 'opp' }] },
  { id: 'rival_hardest', k: ['rival'], q: '记者问：{foe} 是不是你最难对付的对手？', a: ['是之一，每次都得全力打。', '今天之后就不是了。', { t: '难对付的是他，不是我。', to: 'opp' }] },
  { id: 'rival_enjoy', k: ['rival'], q: '你和 {foe} 的对抗已经成了话题，你享受吗？', a: ['享受，这让比赛更有意思。', '我享受赢他的感觉。', { t: '话题是别人说的，我只管在对位里赢他。', to: 'opp' }] },
  { id: 'rival_back', k: ['rival'], if: 'lost', q: '上次输给了 {foe} 他们，这次有什么不一样？', a: ['我们复盘了很多遍。', '这次不会再输。', { t: '这次 {pal} 状态好，我们有底气。', to: 'mate' }] },
  // 任何一种
  { id: 'any_lost', k: ALL.filter((k) => k !== 'debut'), if: 'lost', q: '上一场输了，今天会受影响吗？', a: ['输了就放下，今天从零开始。', '上一场输掉的，这一场要拿回来。', { t: '上一场不怪 {pal}，今天我们一起拿回来。', to: 'mate' }] },
  { id: 'any_streak', k: ALL.filter((k) => k !== 'debut'), if: 'streak', q: '连胜势头很好，今天还能延续吗？', a: ['连胜不代表什么，每场都从零开始。', '能，而且会赢得更轻松。', { t: '{opp} 会是下一个。', to: 'opp' }] },
]
export const IV_BANK_SIZE = BANK.length

function fill(state: GameState, text: string, who: { oppId: string; foe?: string; pal?: string }): string {
  const opp = state.teams[who.oppId]
  return text
    .replace(/\{opp\}/g, opp?.name ?? '对面')
    .replace(/\{foe\}/g, (who.foe && state.players[who.foe]?.ign) || '对面的人')
    .replace(/\{pal\}/g, (who.pal && state.players[who.pal]?.ign) || '队友')
}

function pickQuestion(state: GameState, f: Fixture, kind: IvKind, foe: boolean, pal: boolean): Q {
  const me = state.me!
  const b = book(state)
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
    && (pal || !q.a.some((a, i) => (i === 2 ? (a as Ans).t : a as string).includes('{pal}')))
    && (foe || !q.a.some((a, i) => (i === 2 ? (a as Ans).t : a as string).includes('{foe}')) && !q.q.includes('{foe}')))
  const fresh = fits.filter((q) => !b.asked.includes(q.id))
  const pool = fresh.length ? fresh : fits.length ? fits : BANK.filter((q) => q.k.includes(kind))
  // a situational question where the situation is there, the kind's own otherwise
  const sharp = pool.filter((q) => q.if)
  const from = sharp.length && new Rng(hashStr(`iv:sharp:${state.seed}:${f.id}`)).chance(0.6) ? sharp : pool
  return from[new Rng(hashStr(`iv:${state.seed}:${f.id}`)).int(0, from.length - 1)]
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
  /** a real line from the same point of the same event */
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
  if (m) for (const o of opts) if (o.tone === m.tone) o.notes.push('和真实历史里那句话一个态度')
  const opp = state.teams[pre.opp]
  const ctx = [`${pre.about} · 对手 ${opp?.name ?? '对面'}`, situation(state, pre)]
  return { id: `pre:${pre.fx}`, pre: true, title: '赛前采访', about: KIND_CN[pre.kind], ctx: ctx.filter(Boolean), q: pre.ask, opts, ...(m ? { moment: momentLine(state, m, f) } : {}) }
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

/** What each post-match answer is, by what the night was. The first is always the one that costs nothing. */
const POST: Record<IvOutcome, { qs: string[]; a: [IvOpt['t'], EffectSpec, string?][]; to: ('mate' | 'opp' | null)[] }> = {
  kept: {
    qs: ['赛前你说「{said}」，做到了。现在想说什么？', '放出去的话，你们打回来了。有人说你太狂，你怎么看？'],
    a: [['是队友帮我把话圆上的。', { coachTrust: 1 }], ['说到做到，下一场也一样。', { heat: 12, fans: 20 }], ['狂？赢了就不叫狂。', { heat: 18, coachTrust: -1 }]],
    to: ['mate', null, null],
  },
  ate: {
    qs: ['赛前你说「{said}」，结果输了。现在还这么想吗？', '赛前的话被翻出来了，弹幕在刷「打脸」。你想说什么？'],
    a: [['话说大了，这场是我们没打好。', { mental: 1, tilt: -5, fans: 12, coachTrust: 1 }, '认错'], ['我不收回，下次见。', { heat: 12, fans: -10, tilt: 3 }, '嘴硬'], ['有些位置今天没跟上。', { heat: 10, coachTrust: -3 }, '甩锅']],
    to: [null, null, 'mate'],
  },
  mvp: {
    qs: ['你是今天的 MVP，这场的功劳最想给谁？', '今天的 MVP 是你。说说这一场？'],
    a: [['全队的，每个人都做了该做的。', {}], ['教练组的，今天的准备全都打中了。', { coachTrust: 2 }], ['给我自己，今天手感就是好。', { heat: 12, fans: 25 }]],
    to: ['mate', null, 'mate'],
  },
  won: {
    qs: ['赢下这场，现在什么感觉？', '这场赢得不容易，最关键的是哪一下？'],
    a: [['一场一场来，还没结束。', { coachTrust: 1 }], ['这只是开始。', { heat: 8, fans: 10 }], ['对面今天打得不像他们自己。', { heat: 10 }]],
    to: [null, null, 'opp'],
  },
  lost: {
    qs: ['输掉这场，问题出在哪里？', '这场输了，接下来怎么调整？'],
    a: [['回去复盘，问题我们自己清楚。', { tilt: -4 }], ['下次碰上，结果会不一样。', { heat: 6, mental: 1 }], ['我想替 {pal} 说一句，他今天尽力了。', {}]],
    to: [null, null, 'mate'],
  },
  out: {
    qs: ['这场之后你们出局了，这项赛事对你意味着什么？', '赛事到这里结束了，想对支持你们的人说什么？'],
    a: [['会回来的，先回去休息。', { tilt: -6 }], ['下次我们会更强地回来。', { heat: 6, fans: 8 }], ['谢谢 {pal}，一起走到这里不容易。', {}]],
    to: [null, null, 'mate'],
  },
}

function postCard(state: GameState, post: IvPost): IvCard {
  const pre = state.me!.iv?.pre
  const said = pre?.fx === post.fx ? pre.line ?? '' : ''
  const def = POST[post.out]
  const ask = post.ask
  const palIgn = post.pal ? state.players[post.pal]?.ign : undefined
  const foeIgn = post.foe ? state.players[post.foe]?.ign : undefined
  const opts: IvOpt[] = def.a.map(([t, e, tag], i) => {
    const to = def.to[i]
    const notes: string[] = []
    if (i === 0) notes.push('没有风险')
    if (post.out === 'ate' && i === 2) notes.push(palIgn ? `和 ${palIgn} 远一点` : '队里有人会听到')
    else if (to === 'mate' && palIgn) notes.push(`和 ${palIgn} 近一点`)
    if (to === 'opp' && foeIgn) notes.push(`和 ${foeIgn} 的火药味更重`)
    return { t: t.replace(/\{pal\}/g, palIgn ?? '队友'), tone: i === 0 ? 'steady' : i === 1 ? 'bold' : 'att', e, notes, ...(tag ? { tag } : {}) }
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
  if (m) {
    const kind = m.tone === 'steady' ? 0 : m.tone === 'bold' ? 1 : 2
    opts[kind]?.notes.push('和真实历史里那句话一个态度')
  }
  return {
    id: `post:${post.fx}`, pre: false, title: '赛后采访', about: KIND_CN[post.kind], ctx,
    q: ask.replace('{said}', said.length > 16 ? `${said.slice(0, 15)}…` : said), opts,
    ...(m ? { moment: momentLine(state, m, f) } : {}),
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
  const ask = def.qs[new Rng(hashStr(`iv:post:${state.seed}:${rec.fixtureId}`)).int(0, def.qs.length - 1)]
  const m = f ? momentFor(state, f, 'post') : undefined
  b.post = {
    fx: rec.fixtureId, kind: pre.kind, out, ask, score: rec.score, won: rec.won, mvp: rec.mvp,
    about: pre.about, opp: pre.opp, pal: pre.pal, foe: pre.foe, base, ...(m ? { moment: m.id } : {}),
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
