import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Player, Team } from '../types'
import { importBlock } from '../imports'
import { hasPlace } from '../timeline'
import { formatOf, regionIn } from '../era'
import { readDraws } from '../circuit'
import type { Invite, PitchOut, PitchReply, PitchWhy } from './types'
import { pushLog } from './log'
import { pop, push } from './pending'
import { buyoutDue, makeDeal } from './contract'
import { payOf } from './paytable'
import { money as fmtMoney } from './moneyfmt'
import { gradeOf } from './tryout'
import { INVITE_DAYS, INVITE_FANS, abroadClub, declinedNow, expectOf, makeInvite, tryoutSkill } from './prepro'
import { rankAt } from './rank'
import type { Rank } from './rank'
import { dateCn, lockDoing, lockLifts, moveBlock, nextPeriodAbs, todayAbs, windowAt } from './window'
import type { WindowState } from './window'
import { pitchBook, pitchBookMut, tallyOf } from './pitchbook'
import { countOffer, countPitchWhy } from './telemetry'

/**
 * 自荐 and 主动接触: writing to a club instead of waiting to be called.
 *
 * Reported 2026-09-14: 「不只是被动的等待试训邀请而是加入自荐的机制，就类似lol breaker的转会」. The author
 * approved the design the same day (策划稿「自荐：不用干等试训邀请」). The mechanism follows 破晓's 毛遂自荐
 * and 主动接触; the words, the odds and the reasons are this game's, read off its own rosters and bars.
 *
 *  - Without a contract (on the ladder, or a free agent): a 自荐 to a club I name. At most PITCH_MAX a
 *    transfer period, one to a club, none to a club that has said no this season.
 *  - Under a contract: a 主动接触, once a transfer period, with both windows open and neither roster
 *    locked. The manager hears of it (gmTrust −CONTACT_TRUST). A yes is the other club coming to talk a
 *    transfer with mine — terms on the table, or a tryout when I am near their bar, as a VCT club that
 *    comes for a Challengers man does (me/transfer.ts approach).
 *  - Either costs PITCH_AP action points on the spot, as a practice duel does (me/duel.ts), and no money.
 *    托管 never sends one; what comes back is answered by 托管's existing rules.
 *  - The answer comes REPLY_MIN–REPLY_MAX days later and is drawn on the chance the button showed.
 *    A yes is an invitation (via 'self') into the existing tryout, grade and contract; a no names the one
 *    real thing that weighed most against me (pitchWhy).
 *
 * Every gate goes through me/window.ts (windowAt, moveBlock, nextPeriodAbs): the rules of the window are
 * that file's, and a club's window must stay open PITCH_LEAD more days for an answer to come inside it.
 */

/** action points a 自荐 or a contact costs, spent when it is sent */
export const PITCH_AP = 2
/** 自荐 a transfer period, without a contract */
export const PITCH_MAX = 3
/** a club's window must stay open this many more days: the answer has to come inside it */
export const PITCH_LEAD = 7
/** the answer comes this many days later */
export const REPLY_MIN = 3
export const REPLY_MAX = 7
/** what the manager's trust loses when he hears I contacted a club */
export const CONTACT_TRUST = 4
/** a registered roster's full size, and the size under which a club has a place open (me/transfer.ts VCT_SQUAD) */
export const ROSTER_FULL = 7
export const PITCH_SQUAD = 6

/** The chance, in percent points, before any clamp. Initial values, to be calibrated on the batch (scripts/probe_selfpitch.ts). */
export type PitchGroup = 'vct' | 'strong' | 'mid' | 'weak' | 'academy'
export const GROUP_BASE: Record<PitchGroup, number> = { academy: 30, weak: 30, mid: 18, strong: 10, vct: 4 }
const GROUP_ORDER: Record<PitchGroup, number> = { vct: 0, strong: 1, mid: 2, weak: 3, academy: 4 }
/** per point of 试训实力 over or under a club's bar (me/prepro.ts tryoutSkill, expectOf), and how far that can move it */
export const GAP_STEP = 2.5
export const GAP_UP = 25
export const GAP_DOWN = 30
/** the club's need of me, the largest that applies: nobody in my job, a starter in it I out-rate, a place under six */
export const NEED_BONUS = { hole: 15, beat: 10, place: 5 } as const
/** what makes a name: 神话 or 辐能战魂 as the ladder screen shows them, a following past the invitation line, a professional past */
export const FAME = { immortal: 3, radiant: 6, fans: 3, pro: 4 } as const
/** a buyer whose budget does not cover my buyout */
export const BUYOUT_SHORT = 30
export const ODDS_MIN = 2
export const ODDS_MAX = 75
/**
 * a man who has never played professionally, writing to a first-tier club. The design's first value was 5%; the
 * batch (scripts/probe_selfpitch.ts vct, a ladder player writing to the best first-tier club he could every time)
 * answered yes on 3.6% of 359 answers from 2026 and 3.8% of 158 from 2021 — over the design's line of 3% — with
 * most of the 2021 answers held at the cap. At 3% the same answers' chances come to about 2.3% and 2.7%.
 */
export const NEVPRO_TOP = 3

/** The chance in words, for the screens with 数值 off. */
export const oddsWord = (pct: number): string => (pct >= 50 ? '很有希望' : pct >= 25 ? '有机会' : pct >= 10 ? '希望不大' : '几乎不可能')

const clubName = (state: GameState, id: string | undefined): string => (id && state.teams[id]?.name) || '那家俱乐部'
const topWord = (state: GameState): string => (state.year >= 2023 ? 'VCT' : '一线')

/** A group's name on the screens: VCT (一线 before 2023), Challengers 强队 / 中游 / 弱队 (二线 in the open years), 二队. */
export function groupCn(state: GameState, g: PitchGroup): string {
  if (g === 'vct') return topWord(state)
  if (g === 'academy') return '二队'
  return `${formatOf(state.year) === 'open' ? '二线' : 'Challengers'} ${g === 'strong' ? '强队' : g === 'mid' ? '中游' : '弱队'}`
}

/* ------------------------------------------------------------------ */
/*  who can be written to                                              */
/* ------------------------------------------------------------------ */

/** Clubs a 自荐 can go to: somewhere to play this year, not dormant, not mine, not a cup's pickup side. */
export function pitchPool(state: GameState): Team[] {
  return Object.values(state.teams).filter((t) => t.id !== state.myTeam && !t.id.startsWith('CUP_') && !t.dormant && hasPlace(state, t))
}

const ACADEMY = /\s+(?:global\s+)?academy$/i
const squash = (s: string): string => [...s.normalize('NFD')]
  .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f).join('')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const GROUPS = new WeakMap<GameState, { at: string; of: Map<string, PitchGroup> }>()
/**
 * A club's group. A first-tier club is VCT. A second team — 「… Academy」 of a first-tier club in this
 * world, the rule me/career.ts isAcademy reads the roster book with — is 二队. The rest of the second
 * tier is split in thirds by rating within its own league: read off the clubs as they stand, so it moves
 * when the league does. Read once a day.
 */
export function groupOf(state: GameState, team: Team): PitchGroup {
  if (team.tier === 1) return 'vct'
  const at = `${state.year}:${state.day}`
  let hit = GROUPS.get(state)
  if (!hit || hit.at !== at) {
    const of = new Map<string, PitchGroup>()
    const firsts = Object.values(state.teams).filter((t) => t.tier === 1)
    const names = new Set<string>()
    const long: string[] = []
    for (const t of firsts) { names.add(squash(t.name)); names.add(squash(t.tag)); long.push(squash(t.name)) }
    const leagues = new Map<string, Team[]>()
    for (const t of pitchPool(state)) {
      if (t.tier === 1) continue
      if (ACADEMY.test(t.name)) {
        const base = squash(t.name.replace(ACADEMY, ''))
        if (base && (names.has(base) || long.some((n) => n.startsWith(`${base} `)))) { of.set(t.id, 'academy'); continue }
      }
      const key = regionIn(t.region, state.year)
      const list = leagues.get(key) ?? []
      list.push(t)
      leagues.set(key, list)
    }
    for (const list of leagues.values()) {
      list.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
      list.forEach((t, i) => of.set(t.id, i < list.length / 3 ? 'strong' : i < (list.length * 2) / 3 ? 'mid' : 'weak'))
    }
    hit = { at, of }
    GROUPS.set(state, hit)
  }
  return hit.of.get(team.id) ?? 'mid'
}

export interface PitchNeed {
  /** nobody in my job, a starter in it I out-rate, a place under six — or none of them */
  kind: 'hole' | 'beat' | 'place' | null
  /** the weakest starter in my job */
  mate?: Player
}

/** What the club is short of, as a VCT club that comes for a man reads it (me/transfer.ts vctNeeds). */
export function needOf(state: GameState, team: Team): PitchNeed {
  const me = state.me!
  const p = state.players[me.id]
  const mate = team.starters.map((id) => state.players[id])
    .filter((q): q is Player => !!q && q.id !== me.id && (q.roles ?? [q.role]).includes(p.role))
    .sort((a, b) => a.overall - b.overall)[0]
  if (!mate) return { kind: 'hole' }
  if (p.overall > mate.overall) return { kind: 'beat', mate }
  if (team.roster.length < PITCH_SQUAD) return { kind: 'place', mate }
  return { kind: null, mate }
}

/** Never played professionally: on the ladder from the start, never signed. */
export const neverPro = (state: GameState): boolean => state.me!.phase !== 'pro' && !state.me!.pre.wasPro

/* ------------------------------------------------------------------ */
/*  the chance                                                         */
/* ------------------------------------------------------------------ */

export interface PitchPart {
  key: 'base' | 'gap' | 'hole' | 'beat' | 'place' | 'rank' | 'fans' | 'pro' | 'buyout'
  label: string
  /** percent points */
  v: number
}

export interface PitchOdds {
  /** the chance the answer is drawn on, percent */
  pct: number
  parts: PitchPart[]
  /** the parts' sum before the floor, the ceiling and the never-professional cap */
  raw: number
  capped: 'floor' | 'ceiling' | 'nevpro' | null
  group: PitchGroup
  /** their bar and my 试训实力, as the row shows them, and the gap between */
  expect: number
  skill: number
  gap: number
  need: PitchNeed
  /** never played professionally, writing to a first-tier club */
  nevpro: boolean
  /** what they would pay my club to take me now (me/contract.ts buyoutDue, the world's dollars), and whether their budget covers it */
  fee: number
  short: boolean
}

interface OddsCtx { skill: number; rank: Rank; fans: boolean; never: boolean; fee: number; role: string; overall: number }
const ctxOf = (state: GameState): OddsCtx => {
  const me = state.me!
  const p = state.players[me.id]
  return { skill: Math.round(tryoutSkill(state)), rank: rankAt(state), fans: me.fans >= INVITE_FANS, never: neverPro(state), fee: me.phase === 'pro' ? buyoutDue(state) : 0, role: p.role, overall: p.overall }
}

/**
 * The chance a club says yes, each part a whole number of percent points, summed, held to
 * ODDS_MIN–ODDS_MAX, and for a man who has never played professionally writing to a first-tier club
 * to NEVPRO_TOP. The button prints this number and the answer is drawn on it.
 */
export function pitchOdds(state: GameState, team: Team, ctx: OddsCtx = ctxOf(state)): PitchOdds {
  const group = groupOf(state, team)
  const expect = Math.round(expectOf(team))
  const gap = ctx.skill - expect
  const parts: PitchPart[] = [{ key: 'base', label: groupCn(state, group), v: GROUP_BASE[group] }]
  const gv = Math.round(clamp(gap * GAP_STEP, -GAP_DOWN, GAP_UP))
  if (gv) parts.push({ key: 'gap', label: gap > 0 ? `实力高出 ${gap}` : `实力差 ${-gap}`, v: gv })
  const need = needOf(state, team)
  if (need.kind === 'hole') parts.push({ key: 'hole', label: `缺${ctx.role}`, v: NEED_BONUS.hole })
  else if (need.kind === 'beat') parts.push({ key: 'beat', label: `比首发 ${need.mate?.ign} 强`, v: NEED_BONUS.beat })
  else if (need.kind === 'place') parts.push({ key: 'place', label: `名单不到 ${PITCH_SQUAD} 人`, v: NEED_BONUS.place })
  if (ctx.rank.radiant) parts.push({ key: 'rank', label: '辐能战魂', v: FAME.radiant })
  else if (ctx.rank.tier === '神话') parts.push({ key: 'rank', label: ctx.rank.name, v: FAME.immortal })
  if (ctx.fans) parts.push({ key: 'fans', label: '粉丝过邀请线', v: FAME.fans })
  if (!ctx.never) parts.push({ key: 'pro', label: '打过职业', v: FAME.pro })
  const short = ctx.fee > 0 && team.budget < ctx.fee
  if (short) parts.push({ key: 'buyout', label: '付不起违约金', v: -BUYOUT_SHORT })
  const raw = parts.reduce((s, x) => s + x.v, 0)
  let pct = clamp(raw, ODDS_MIN, ODDS_MAX)
  let capped: PitchOdds['capped'] = raw < ODDS_MIN ? 'floor' : raw > ODDS_MAX ? 'ceiling' : null
  const nevpro = ctx.never && team.tier === 1
  if (nevpro && pct > NEVPRO_TOP) { pct = NEVPRO_TOP; capped = 'nevpro' }
  return { pct, parts, raw, capped, group, expect, skill: ctx.skill, gap, need, nevpro, fee: ctx.fee, short }
}

/** The sum as a line: 「中游 18 · 实力差 2 −5 · 缺控场 +15 · 神话 3 +3 = 31%」, and the clamp that applied. */
export function oddsLine(state: GameState, o: PitchOdds): string {
  const sum = o.parts.map((x, i) => `${x.label} ${i === 0 ? x.v : x.v > 0 ? `+${x.v}` : `−${-x.v}`}`).join(' · ')
  const cap = o.capped === 'nevpro' ? `（没打过职业的人投 ${topWord(state)} 最多 ${NEVPRO_TOP}%）`
    : o.capped === 'floor' ? `（最低 ${ODDS_MIN}%）` : o.capped === 'ceiling' ? `（最高 ${ODDS_MAX}%）` : ''
  return `${sum} = ${o.pct}%${cap}`
}

/**
 * 为什么是这个把握: plain-language paragraphs explaining the chance in the row.
 * Reuses the odds object o, no recalculation, no state. When `numbers` is false,
 * no exact numbers or percentages appear; team/player names may contain digits.
 */
export function pitchExplanation(o: PitchOdds, numbers: boolean): string[] {
  const out: string[] = []
  const gap = o.gap
  const need = o.need

  // 球队试训门槛与当前同位首发不是同一条线
  out.push(`这家俱乐部的试训门槛是看试训实力，${need.mate ? `他们现在同位置的首发是 ${need.mate.ign}` : '目前没有同位置首发'}，门槛跟首发不是一条线。`)

  // 实力差距
  if (gap > 0) {
    out.push(`你的试训实力高出他们的门槛${numbers ? ` ${gap} 点` : '一截'}，这是加分项。`)
  } else if (gap < 0) {
    out.push(`你的试训实力还差他们的门槛${numbers ? ` ${-gap} 点` : '一截'}，这是减分项。`)
  } else {
    out.push('你的试训实力正好在他们的门槛上。')
  }

  // 需求
  switch (need.kind) {
    case 'hole':
      out.push('他们当前首发里缺少这个位置，你是补缺，这会有额外加分。')
      break
    case 'beat':
      out.push('你比他们现在的首发强，这代表你有机会竞争首发，但只是需求加分，并不保证录取。')
      break
    case 'place':
      out.push('他们的名单还没满六人，有空位，有空位也会加分，但这不等于他们会随便签人。')
      break
    default:
      out.push('他们现在没有明显的岗位需求，这不会加分。')
  }

  // 首次职业投一线
  if (o.nevpro) {
    out.push(numbers ? `从未打过职业时，自荐一级俱乐部最多 ${NEVPRO_TOP}%，其他加分也不能超过这条限制。` : '从未打过职业时，自荐一级俱乐部存在额外的把握上限；高综合也不能跳过职业履历。')
  }

  // 预算/违约金
  if (o.short) {
    out.push('他们的预算付不起你的违约金，这会大幅降低把握。')
  } else if (o.fee > 0) {
    out.push('他们的预算付得起你的违约金，这不是问题。')
  }

  return out
}

/* ------------------------------------------------------------------ */
/*  gates                                                              */
/* ------------------------------------------------------------------ */

/**
 * A shut window in the row's words: 「VCT 窗口 9月11日开」「正在打 LOCK//IN 圣保罗，名单锁到 3月4日」.
 * From 2023 a shut window is a roster lock (me/window.ts): the day it lifts is the last day of the last
 * event holding the club with no day between (lockLifts), and a club already out of the event it is held
 * by says so the way the window's own line does (lockDoing).
 */
export function shutWords(state: GameState, w: WindowState): string {
  if (w.lock) {
    const until = dateCn(lockLifts(state, w), state.year)
    const then = w.then?.length ? `，接着打 ${w.then.join('、')}` : ''
    return w.lock.out ? `${lockDoing(w.lock)}${then}，${until}后解除` : `正在打 ${w.lock.event}${then}，名单锁到 ${until}`
  }
  const which = w.rule === 'vct' ? 'VCT ' : ''
  const soft = w.tentative ? '（暂定）' : ''
  return w.nextOpens != null ? `${which}窗口 ${dateCn(w.nextOpens, state.year)}开${soft}` : `${which}窗口关着`
}

/**
 * Why no 自荐 (no contact, under a contract) can go out today whatever the club, or null: a move agreed,
 * the transfer period I signed in (me/window.ts moveBlock), one already waiting on its answer, a tryout
 * or an invitation to answer first, this period's count, my own club's window, the week's action points.
 */
export function pitchBlock(state: GameState): string | null {
  const me = state.me
  if (!me || me.phase === 'retired') return '生涯已经结束'
  const pro = me.phase === 'pro'
  const what = pro ? '主动接触' : '自荐'
  if (me.moveAfter) return `已经和 ${clubName(state, me.moveAfter.deal.teamId)} 谈妥，不再${what}别家`
  const signed = moveBlock(state, `才能${what}`)
  if (signed) return signed
  const book = pitchBook(state)
  const out = book.out
  if (out) return `${out.kind === 'contact' ? '已经接触了' : '已经给'} ${clubName(state, out.teamId)}${out.kind === 'contact' ? '' : ' 发了自荐'}，${dateCn(out.due, state.year)}前回复`
  if (me.tryout) return `正在 ${clubName(state, me.tryout.teamId)} 试训，打完再说`
  const inv = me.pre.invites[0]
  if (inv) return `先答复 ${clubName(state, inv.teamId)} 的试训邀请`
  const next = dateCn(nextPeriodAbs(state), state.year)
  if (pro) {
    if (book.contacted.length) return `这个转会期已经接触过 ${clubName(state, book.contacted[0])}，下个转会期（${next}起）再说`
    const w = windowAt(state)
    if (!w.open) return `你的俱乐部${w.lock ? '' : '的'}${shutWords(state, w)}`
  } else if (book.sent.length >= PITCH_MAX) {
    return `这个转会期的 ${PITCH_MAX} 次用完了，下个转会期（${next}起）再投`
  }
  if (me.ap < PITCH_AP) return `本周行动点不够（需 ${PITCH_AP}，剩 ${me.ap}）`
  return null
}

/**
 * Why this club cannot be written to today, or null: another 赛区 without the language, a no from it
 * this season, a club turned down or turning me down this year (me/prepro.ts declinedNow), a full
 * roster or a full import list, one already sent to it this period, its window shut or closing inside
 * PITCH_LEAD days.
 */
export function pitchClubBlock(state: GameState, team: Team): string | null {
  const me = state.me!
  const p = state.players[me.id]
  if (abroadClub(state, team) && !me.flags.lang) return '外赛区的俱乐部要会外语才投得了'
  const book = pitchBook(state)
  if (book.rejected.some((r) => r.team === team.id && r.year === state.year)) return '回绝过你，本赛季不再收你的自荐'
  if (declinedNow(state).has(team.id)) return '今年回绝过，今年不再谈'
  if (team.roster.length >= ROSTER_FULL) return `名单满了（${team.roster.length}/${ROSTER_FULL}），这个转会期不加人`
  if (importBlock(state, team.id, p)) return '外援名额已经用满'
  if (book.sent.includes(team.id)) return '这个转会期已经投过这家'
  const w = windowAt(state, team.id)
  if (!w.open) return w.side === 'mine' ? `你的俱乐部${w.lock ? '' : '的'}${shutWords(state, w)}` : shutWords(state, w)
  if (w.closesOn != null) {
    const left = w.closesOn - todayAbs(state)
    if (left < PITCH_LEAD) return left <= 0 ? '窗口今天关，来不及回复' : `窗口 ${left} 天后关，来不及回复`
  }
  return null
}

export interface PitchRow {
  team: Team
  group: PitchGroup
  odds: PitchOdds
  /** why this club cannot be written to today; the panel's own gate (pitchBlock) is said once above the rows */
  why: string | null
  abroad: boolean
}

/**
 * The clubs the transfer screen lists, VCT first, then the second tier strongest group first, each group
 * by chance; another 赛区's clubs after them, with the language. Without it they are counted, not
 * listed: `abroadShut`, said on one greyed line with its reason.
 */
export function pitchTargets(state: GameState): { rows: PitchRow[]; abroadShut: number } {
  const me = state.me!
  const ctx = ctxOf(state)
  const rows: PitchRow[] = []
  let abroadShut = 0
  // every club's window reads the draws of the events ahead of it, and those draws are the same for every club: one
  // read of them for the whole list (circuit.ts readDraws; reported 2026-09-18, the transfer page's first opening
  // froze a 2029 career for nine seconds)
  readDraws(state, () => {
    for (const t of pitchPool(state)) {
      const abroad = abroadClub(state, t)
      if (abroad && !me.flags.lang) { abroadShut++; continue }
      rows.push({ team: t, group: groupOf(state, t), odds: pitchOdds(state, t, ctx), why: pitchClubBlock(state, t), abroad })
    }
  })
  rows.sort((a, b) => Number(a.abroad) - Number(b.abroad) || GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    || Number(!!a.why) - Number(!!b.why) || b.odds.pct - a.odds.pct || a.team.name.localeCompare(b.team.name))
  return { rows, abroadShut }
}

/** The last day of this transfer period (me/window.ts nextPeriodAbs). */
export const periodEndAbs = (state: GameState): number => nextPeriodAbs(state) - 1

/* ------------------------------------------------------------------ */
/*  sending                                                            */
/* ------------------------------------------------------------------ */

/** Write to a club. Null when it went out; otherwise why not, in the line the button greys itself with. */
export function sendPitch(state: GameState, teamId: string): string | null {
  const me = state.me!
  const team = state.teams[teamId]
  if (!team || team.id === state.myTeam || !pitchPool(state).includes(team)) return '这家俱乐部今年没有比赛可打，不收人'
  const why = pitchBlock(state) ?? pitchClubBlock(state, team)
  if (why) return why
  const odds = pitchOdds(state, team)
  const book = pitchBookMut(state)
  const pro = me.phase === 'pro'
  const id = `pitch:${state.year}:${state.day}:${team.id}`
  const delay = new Rng(hashStr(`pitch:delay:${state.seed}:${id}`)).int(REPLY_MIN, REPLY_MAX)
  const out: PitchOut = { id, teamId: team.id, kind: pro ? 'contact' : 'pitch', year: state.year, day: state.day, due: todayAbs(state) + delay, odds: odds.pct }
  me.ap -= PITCH_AP
  book.out = out
  tallyOf(book).sent++
  const label = groupCn(state, odds.group)
  const when = dateCn(out.due, state.year)
  if (pro) {
    book.contacted.push(team.id)
    me.gmTrust = clamp(me.gmTrust - CONTACT_TRUST, 0, 100)
    pushLog(state, 'deal', `主动接触：托人联系了 ${team.name}（${label}），把握${oddsWord(odds.pct)}（${odds.pct}%），${when}前回复。经理听说你在找下家，不太高兴。`)
  } else {
    book.sent.push(team.id)
    pushLog(state, 'deal', `自荐：给 ${team.name}（${label}）发了自荐，把握${oddsWord(odds.pct)}（${odds.pct}%），${when}前回复。`)
  }
  // 自荐 or 主动接触 went out — which of the two, never to whom
  countOffer(pro ? 'contact' : 'pitch')
  return null
}

/* ------------------------------------------------------------------ */
/*  the answer                                                         */
/* ------------------------------------------------------------------ */

/** The draw an answer is made on: the chance the button showed, on a stream of the save and the 自荐. */
export function pitchHit(state: GameState, out: PitchOut): boolean {
  return new Rng(hashStr(`pitch:reply:${state.seed}:${out.id}`)).chance(out.odds / 100)
}

/**
 * A day of the week (me/week.ts runDays): the answer, on its day. Called off instead when a move has been
 * agreed meanwhile (a signing calls it off at once, me/pitchbook.ts dropPitch), or the club is gone.
 */
export function pitchDay(state: GameState): void {
  const me = state.me
  const out = me?.pitch?.out
  if (!me || !out || todayAbs(state) < out.due) return
  const book = pitchBookMut(state)
  book.out = undefined
  const team = state.teams[out.teamId]
  const tally = tallyOf(book)
  const what = out.kind === 'contact' ? '接触' : '自荐'
  if (me.phase === 'retired') { tally.cancelled++; return }
  if (!team || team.dormant || state.myTeam === out.teamId) {
    tally.cancelled++
    if (state.myTeam !== out.teamId) pushLog(state, 'deal', `${clubName(state, out.teamId)} 那边出了变故，你的${what}没有回音。`)
    return
  }
  if (me.moveAfter) {
    tally.cancelled++
    pushLog(state, 'deal', `已经和 ${clubName(state, me.moveAfter.deal.teamId)} 谈妥，给 ${team.name} 的${what}作废了。`)
    return
  }
  tally.replied++
  tally.odds += out.odds
  if (pitchHit(state, out)) {
    tally.ok++
    pitchYes(state, team, out)
  } else pitchNo(state, team, out)
}

function pitchYes(state: GameState, team: Team, out: PitchOut): void {
  const me = state.me!
  countOffer('pitch_ok')
  const skill = tryoutSkill(state)
  const where = `${team.name}（${groupCn(state, groupOf(state, team))}）`
  const rng = new Rng(hashStr(`pitch:yes:${state.seed}:${out.id}`))
  if (me.phase === 'pro') {
    const fee = buyoutDue(state)
    const owed = payOf(state)
    const pay = fee ? `${owed ? fmtMoney(owed.buyout, owed.cur, state.year) : fmtMoney(fee, 'USD', state.year)} 的违约金他们来付` : '你的合同今年到期，不用付违约金'
    // clear of their bar by a margin, terms at once; near it, a tryout first — as a VCT club that comes for a man does (me/transfer.ts approach)
    if (skill >= expectOf(team) + 4) {
      const deal = makeDeal(state, team.id, 'transfer', gradeOf(skill - expectOf(team) + 4), rng)
      deal.via = 'contact'
      me.deals.push(deal)
      push(state, { kind: 'deal', id: deal.id })
      pushLog(state, 'deal', `${where} 回应了你的接触：来和 ${clubName(state, state.myTeam)} 谈转会，${pay}，开了报价。`)
      return
    }
    const inv: Invite = { ...makeInvite(state, team, 'self', rng), id: `inv:self:${state.year}:${state.day}:${team.id}`, direct: false }
    me.pre.invites.push(inv)
    push(state, { kind: 'invite', id: inv.id })
    pushLog(state, 'deal', `${where} 回应了你的接触：先请你去试训，签下来的话${pay}。${INVITE_DAYS} 天内答复。`)
    return
  }
  const inv: Invite = { ...makeInvite(state, team, 'self', rng), id: `inv:self:${state.year}:${state.day}:${team.id}` }
  me.pre.invites.push(inv)
  push(state, { kind: 'invite', id: inv.id })
  pushLog(state, 'deal', `${where} 回复了你的自荐：${inv.direct ? '免了试训，直接谈合同' : '请你去试训'}。${INVITE_DAYS} 天内答复。`)
}

function pitchNo(state: GameState, team: Team, out: PitchOut): void {
  const book = pitchBookMut(state)
  const r = pitchWhy(state, team)
  // the no, and the one reason that weighed most — one of seven (me/types.ts PitchWhy)
  countOffer('pitch_no')
  countPitchWhy(r.why)
  const reply: PitchReply = { id: out.id, teamId: team.id, kind: out.kind, odds: out.odds, why: r.why, year: state.year, day: state.day }
  if (r.gap != null) reply.gap = r.gap
  if (r.mate) reply.mate = r.mate
  book.rejected = book.rejected.filter((x) => x.team !== team.id)
  book.rejected.push({ team: team.id, year: state.year })
  book.replies.push(reply)
  if (book.replies.length > 6) {
    for (const gone of book.replies.splice(0, book.replies.length - 6)) pop(state, 'pitch', gone.id)
  }
  push(state, { kind: 'pitch', id: out.id })
  const what = out.kind === 'contact' ? '接触' : '自荐'
  pushLog(state, 'deal', `${team.name} 回复了你的${what}：没成——${whyText(state, reply)}。这家本赛季不再收你的${what}。`)
}

/**
 * Why a club said no: the one real thing that weighed most against me, read on the day of the answer.
 * A full roster or a full import list first (a club can fill up while I wait); then the largest of the
 * parts that pulled the chance down — the gap to their bar, a buyout their budget does not cover, the
 * cap on a man who never played professionally — or a starter in my job who is steadier than me (the
 * need I did not meet, weighed as the bonus for beating him). When nothing weighed against me, the
 * answer says so, with the chance it was.
 */
export function pitchWhy(state: GameState, team: Team): { why: PitchWhy; gap?: number; mate?: string } {
  const me = state.me!
  const p = state.players[me.id]
  if (team.roster.length >= ROSTER_FULL) return { why: 'full' }
  if (importBlock(state, team.id, p)) return { why: 'import' }
  const o = pitchOdds(state, team)
  const cands: [number, { why: PitchWhy; gap?: number; mate?: string }][] = []
  const g = o.parts.find((x) => x.key === 'gap')
  if (g && g.v < 0) cands.push([-g.v, { why: 'gap', gap: -o.gap }])
  if (o.short) cands.push([BUYOUT_SHORT, { why: 'buyout' }])
  if (o.nevpro && o.raw > NEVPRO_TOP) cands.push([Math.min(o.raw, ODDS_MAX) - NEVPRO_TOP, { why: 'nevpro' }])
  if (!o.need.kind && o.need.mate) cands.push([NEED_BONUS.beat, { why: 'starter', mate: o.need.mate.ign }])
  cands.sort((a, b) => b[0] - a[0])
  return cands[0]?.[1] ?? { why: 'luck' }
}

/** A no in words. `say` turns the gap and the chance into words for a screen with 数值 off. */
export function whyText(state: GameState, r: Pick<PitchReply, 'why' | 'gap' | 'mate' | 'odds'>, say?: { gap: (n: number) => string; odds: (n: number) => string }): string {
  const p = state.players[state.me!.id]
  switch (r.why) {
    case 'full': return '名单满了，这个转会期不加人'
    case 'import': return '外援名额满了'
    case 'nevpro': return `${topWord(state)} 俱乐部只从打过职业比赛的人里挑`
    case 'buyout': return '你的违约金他们付不起'
    case 'gap': return say ? `实力还不够（${say.gap(r.gap ?? 0)}）` : `实力还差一截（差 ${r.gap ?? 0}）`
    case 'starter': return `${p?.role ?? ''}位置上的首发 ${r.mate ?? ''} 比你稳`
    case 'luck': return `挑不出你哪里不够，只是这次没轮到你（把握${say ? say.odds(r.odds) : `${oddsWord(r.odds)}，${r.odds}%`}）`
  }
  return ''
}

/** A no's card answered: off the list, and out of the book. */
export function closePitchReply(state: GameState, id: string): void {
  const me = state.me!
  pop(state, 'pitch', id)
  if (me.pitch) me.pitch.replies = me.pitch.replies.filter((x) => x.id !== id)
}
