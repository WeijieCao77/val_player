import { clamp } from '../rng'
import { ATTR_CN, ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player } from '../types'
import { baseBonus, recomputeOverall, refreshValue, weightsFor } from '../player'
import { pushLog } from './log'
import type { BottleneckState, LogKind } from './types'
import { compClass, isIntlComp, isQualifier } from './compclass'
import { tallyOf } from './detail'

/**
 * 瓶颈: each of the eight has a ceiling, and hours past it go nowhere.
 *
 * Ported from 破晓's capOf / BREAK_PATHS / breakthrough. Its players said
 * 「属性练不动」 and its batch runs said the attributes were not stuck at all —
 * the player simply could not see the ceiling, or what opens it. So the rule
 * it settled on is the rule here: the ceiling is drawn on the bar, and every
 * attribute says in plain words how its ceiling is broken. Most ways are
 * mechanical — do this much of that and it opens, no dice — and they share one
 * pool per attribute, so grinding can never use up what a trophy is worth:
 * milestones have a pool of their own. And every professional season played
 * loosens the ceilings experience teaches, the way 破晓's 经验顶瓶颈 does.
 *
 * Where the ceilings come from. A new career's are its talent's, as 破晓's are
 * (me/career.ts talentCeilings: each point is +3 on the ceiling as it is on the
 * start), held under TALENT_CAP_MAX so that no path is dead on the first day. A
 * save from before carries the eight its headroom was split into.
 *
 * What a break is worth. 破晓's five dimensions weigh the same, so its +2 on
 * any of them is +0.4 of the overall. Ours are weighted by role: the port's +2
 * on 沟通 was +0.10 of a duelist's 综合 and +2 on 枪法 +0.56, the paths a
 * player reaches first were the cheap ones, and a 2026 全球冠军赛 with the
 * final's MVP moved his 上限 by less than one point (reported 2026-09-12:
 * 「突破的数值提升太小了」「都上海冠军赛 fmvp 了都没突破瓶颈」). So a break is
 * sized in 综合 (BREAK_VALUE) and paid in points: the attribute that broke takes
 * what its weight asks, up to BREAK_POINTS, and what it cannot carry goes to the
 * role's heaviest attributes that still have room. The pools count 综合 too,
 * and shrink as they fill, 破晓's diminishing room.
 *
 * And a break is seen. Reported 2026-09-14: 「复盘，练了六次从0/6到6/6之后就归零了，
 * 始终没有突破……这个存点数我觉得不对」. Two things hid it. A practice pool's last
 * sliver was under what a break needed, so after two breaks the count filled,
 * emptied and opened nothing, week after week, while the card still called the
 * path live. And hours at a ceiling banked up to three points (「存点数」) that
 * filled the new ceiling the moment it opened, so the row went straight back to
 * 卡在瓶颈 and the break looked like nothing. Now, as 破晓 settled it
 * (trialCanPay, btkNote: 「攒满当场兑现……机械池满时也不再静默发 0，直说到头了」):
 * a count that fills opens its own attribute's ceiling by at least a point, or
 * the card has already said, greyed, why it cannot and the count has stopped;
 * hours at a ceiling store nothing, so a break leaves room that practice fills
 * point by point; and a trophy still lifts half of what it opens at once.
 */

export const CAP_HARD = 99
/** the highest a talent alone puts a ceiling — under the hard cap, so a maxed attribute still has a path on the first day (破晓: talent 10 is 95 before its breaks) */
export const TALENT_CAP_MAX = 98
/**
 * What each kind of break is worth, in 综合上限.
 *
 * Re-sized 2026-09-20 against the measured ladder: a career played all the way
 * through ended at 84 — the world's own median VCT starter (85.9), the 47th
 * percentile of them — while the world's top ten sat at 94–96. The author's
 * brief is a game 「比现在游戏容易但是比破晓难度大」 (破晓's diligent player ends
 * above every professional alive), so the target became: a full ordinary career
 * 87–89, a career with real trophies 92–94, the world's very best still above
 * the ordinary one.
 *
 * The weight went on the trophies rather than on the talent, because that is
 * the other half of the same brief — 「明星选手的数值也要增长的高于普通选手」.
 * Winning is what moves a career now; turning up for years moves it less
 * (CAP_EXP_MAX), and grinding one attribute moves it least (MECH_VALUE_MAX).
 */
export const BREAK_VALUE = {
  /** a practice path: three weeks of 枪法, twelve ranked, six reviews, four scrims, eight maps calling */
  grind: 0.9,
  /** a situation that pays once: five clutches, a year among veterans and big stages */
  path: 1.0,
  /** a strong club or a veteran in the room — it comes to everyone who is there, so it is worth less than what is worked for */
  room: 0.4,
  /** the first trophy, and the first in a VCT league (was 0.8) */
  league: 1.2,
  /** a Masters or LOCK//IN, started in (was 1.6) */
  masters: 3.0,
  /** Champions, started in — 破晓's world title is +3.5 and +3.0 on a fifth each, +1.3 (was 2.4) */
  champions: 4.5,
  /** the final's MVP, on top of the title (was 1.0) */
  fmvp: 2.0,
} as const
/**
 * most points one break puts on the attribute that broke; the rest goes where
 * the role needs it. Six let a duelist's 沟通 soak up a strong club's whole
 * break into a ceiling nobody trains to (measured: 沟通 99 over a 60 attribute
 * at 26), so the 综合 it was sized in never showed.
 */
export const BREAK_POINTS = 3
/**
 * 综合 the practice paths can open, per attribute: 破晓's 6 points on a fifth of
 * its overall, 1.2. At 2.0 the steady plan's ten grinds on a low-talent 枪法 and
 * 反应 bought back everything its talent had not given it, and a career that
 * chose its talent and worked every path ended within two points of one that did
 * neither (measured: 88 against 90). 1.4 on 2026-09-20 — a nudge, deliberately
 * short of the 2.0 that made the talent screen meaningless, because the brief
 * was to reward winning rather than grinding.
 */
export const MECH_VALUE_MAX = 1.4
/**
 * 综合 milestones can open, per attribute — apart, so the grind cannot eat a
 * trophy's share. Raised from 3.0 on 2026-09-20 to leave room for the trophies
 * above (BREAK_VALUE): at 3.0 a Masters and a Champions filled the 残局 pool
 * between them and the third trophy of a career opened nothing.
 */
export const MILE_VALUE_MAX = 5.0
/**
 * Professional seasons that each loosen the experience ceilings by one. Five
 * until 2026-09-20; seven so that a long career is worth something on its own,
 * without making it worth as much as winning.
 */
export const CAP_EXP_MAX = 7
/** a club this strong teaches by being in the room: the weakest tenth of a new world's VCT clubs (engine/ruler.ts) */
export const STRONG_TEAM = 80
/** old enough to have seen most of it */
export const VET_AGE = 27

type K = keyof Attrs

/** The overall before recomputeOverall rounds it. */
function rawOverall(p: Player): number {
  const w = weightsFor(p)
  return ATTR_KEYS.reduce((s, k) => s + p.attrs[k] * w[k], baseBonus(p))
}

/** The eight, heaviest first for his role. */
const byWeight = (p: Pick<Player, 'role'>): K[] => {
  const w = weightsFor(p)
  return ATTR_KEYS.slice().sort((a, b) => w[b] - w[a])
}

/** The attribute a trophy opens beside 残局 and 沟通: the heaviest his role has. */
const mainOf = (p: Pick<Player, 'role'>): K => byWeight(p).find((k) => k !== 'clutch' && k !== 'communication') ?? 'aim'

/**
 * Lay `room` points of overall headroom across the eight by √weight, as whole
 * points. A ceiling that would pass 99 stops there and its share goes to the
 * others, so an old save with 99 枪法 keeps the 上限 it had.
 */
export function splitCeilings(p: Player, room: number): Record<K, number> {
  const w = weightsFor(p)
  const share = (k: K, lam: number) => Math.min(CAP_HARD - p.attrs[k], lam * Math.sqrt(w[k]))
  const reach = (lam: number) => ATTR_KEYS.reduce((s, k) => s + w[k] * share(k, lam), 0)
  let lo = 0
  let hi = 400
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid) < room) lo = mid
    else hi = mid
  }
  const out = {} as Record<K, number>
  for (const k of ATTR_KEYS) out[k] = clamp(Math.round(p.attrs[k] + Math.max(0, share(k, hi))), p.attrs[k], CAP_HARD)
  return out
}

/** Ceilings for a player who has none yet, topped up so the 上限 he had is the 上限 he keeps. */
function firstCeilings(p: Player): Record<K, number> {
  const caps = splitCeilings(p, Math.max(0, p.potential - rawOverall(p)))
  const w = weightsFor(p)
  const order = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a])
  for (let i = 0; i < 24 && ceilingPotential(p, caps) < p.potential; i++) {
    const k = order[i % order.length]
    if (caps[k] < CAP_HARD) caps[k]++
  }
  return caps
}

/** His eight ceilings — the saved ones, or the ones the next settlement will give a save from before them. */
export function ceilingsOf(p: Player): Record<K, number> {
  return p.caps ?? firstCeilings(p)
}

/** Sitting at the ceiling: more hours go into what breaks it, not into the bar. */
export const atCeiling = (p: Player, k: K): boolean => p.attrs[k] >= ceilingsOf(p)[k]

/** The overall the eight ceilings add up to — what the attribute card calls 上限. */
export function ceilingPotential(p: Pick<Player, 'role' | 'attrs' | 'stageBonus' | 'isIgl'>, caps: Record<K, number> = ceilingsOf(p as Player)): number {
  const w = weightsFor(p)
  const v = ATTR_KEYS.reduce((s, k) => s + Math.max(p.attrs[k], caps[k]) * w[k], baseBonus(p))
  return Math.round(clamp(v, 30, 99))
}

/** Weighted room left under the ceilings: the headroom a player with ceilings trains against (growth.ts gainBase). */
export function ceilingRoom(p: Player): number {
  const caps = ceilingsOf(p)
  const w = weightsFor(p)
  return ATTR_KEYS.reduce((s, k) => s + Math.max(0, caps[k] - p.attrs[k]) * w[k], 0)
}

function freshBook(p: Player): BottleneckState {
  return {
    mech: {}, mile: {}, mechV: {}, mileV: {}, exp: 0, seen: [], count: {}, aimStreak: 0,
    clutchMark: p.career.clutches, mapsMark: p.career.maps,
    pinned: ATTR_KEYS.filter((k) => !!p.caps && p.attrs[k] >= p.caps[k]),
    pot: p.potential,
  }
}

/** A book from before breaks were valued counted points: what those points were worth to his 综合. */
function valuePools(p: Player, bn: BottleneckState): void {
  if (bn.mechV && bn.mileV) return
  const w = weightsFor(p)
  bn.mechV = {}
  bn.mileV = {}
  for (const k of ATTR_KEYS) {
    if (bn.mech[k]) bn.mechV[k] = (bn.mech[k] ?? 0) * w[k]
    if (bn.mile[k]) bn.mileV[k] = (bn.mile[k] ?? 0) * w[k]
  }
}

/** 综合 a pool has opened for one attribute. */
function usedOf(p: Player, bn: BottleneckState, pool: 'mech' | 'mile', k: K): number {
  const v = pool === 'mile' ? bn.mileV : bn.mechV
  if (v) return v[k] ?? 0
  return ((pool === 'mile' ? bn.mile : bn.mech)[k] ?? 0) * weightsFor(p)[k]
}

/**
 * The career's player gets his ceilings if he has none — a save from before
 * they existed — and the book that counts toward breaking them. Safe to call
 * every week. A book from an older build is brought forward once: its pools
 * valued, what it banked at a ceiling dropped (dropBank), and the title breaks
 * that build missed paid (lookBack).
 */
export function ensureCeilings(state: GameState): BottleneckState | null {
  const me = state.me
  const p = me ? state.players[me.id] : undefined
  if (!me || !p) return null
  if (!p.caps) {
    p.caps = firstCeilings(p)
    p.potential = ceilingPotential(p)
    refreshValue(p)
  }
  if (!me.bottleneck) me.bottleneck = freshBook(p)
  const bn = me.bottleneck
  valuePools(p, bn)
  if (!bn.noBank) dropBank(state, p, bn)
  if (bn.rev !== 2) lookBack(state, p, bn)
  return bn
}

function say(state: GameState, kind: LogKind, text: string): void {
  pushLog(state, kind, text)
  state.me!.weekNotes.push(text)
}

/**
 * 「存点数」 is gone (2026-09-14). A save from before may still hold it: up to
 * three points of practice (300 xp) on an attribute at its ceiling, or more than
 * a full bar under one where the winter's ageing took a point from under the
 * bank. The choice: what was banked is dropped, not paid — landing it now would
 * be the very jump the author asked to remove, the moment the save is read — and
 * the whole points dropped are said once, in the log and the week's notes.
 * Nothing else goes with it: under a ceiling the progress toward the next point
 * stays (only what is past a full bar was banked); at one there is no progress
 * to keep, so all of it was bank; the counts toward a break are not touched.
 */
function dropBank(state: GameState, p: Player, bn: BottleneckState): void {
  bn.noBank = true
  const caps = p.caps
  if (!caps) return
  const lost: string[] = []
  for (const k of ATTR_KEYS) {
    const xp = p.xp[k] ?? 0
    const keep = p.attrs[k] >= caps[k] ? 0 : xp >= 100 ? xp % 100 : xp
    if (keep === xp) continue
    p.xp[k] = keep
    const pts = Math.floor((xp - keep) / 100)
    if (pts > 0) lost.push(`${ATTR_CN[k]} ${pts} 点`)
  }
  if (lost.length) say(state, 'info', `「存点数」取消了：卡在瓶颈时存下的练习（${lost.join('、')}）作废，不会一次涨上去。以后卡在瓶颈上的练习直接算进「我的」页上的「怎么破」。`)
}

/**
 * The ceilings moved: the one number follows, and the price on him with it.
 * The winter's re-rating of the young (engine/training.ts seasonRollover) may
 * have raised that number in the meantime; it opens all eight by as much
 * first, or deriving would quietly undo it.
 */
function settle(state: GameState, p: Player, bn: BottleneckState): void {
  if (p.caps && p.potential > bn.pot) {
    const lift = p.potential - bn.pot
    const all = ATTR_KEYS.every((k) => p.caps![k] + lift <= CAP_HARD)
    for (const k of ATTR_KEYS) p.caps[k] = Math.min(CAP_HARD, p.caps[k] + lift)
    say(state, 'good', `冬训后教练组重新评估了你：${all ? '八项' : `除了到 ${CAP_HARD} 的几项，其余`}的瓶颈各松了 ${lift} 点。`)
  }
  p.potential = ceilingPotential(p)
  bn.pot = p.potential
  refreshValue(p)
}

export interface BreakPath {
  /** the rule, in the words the attribute card uses */
  how: string
  /** what it opens, in 综合上限 (BREAK_VALUE) */
  value: number
  /** needs a club before it can even start */
  pro?: boolean
  /** a source that pays once a career */
  key?: string
  /** what the log says when it opens */
  reason: string
  /** how far along, in the card's words */
  prog: (state: GameState) => string
  done: (state: GameState) => boolean
}

/** What each counted path needs: sessions, clutches or maps at the ceiling. */
const NEED: Partial<Record<K, number>> = { reaction: 12, awareness: 6, utility: 6, clutch: 5, teamwork: 4, igl: 8 }

export interface BreakCount {
  /** counted at the settlements so far — the number the break is judged on */
  have: number
  need: number
  /** what this week's settlement will add: what has already been done this week, the clutches and maps played since the last one */
  week: number
}

/**
 * A counted path's count: the one number the attribute card, the week board's
 * note and the settlement all read. The card used to show only what earlier
 * settlements had counted, so the six reviews a player had just done read
 * 「4/6」 until the settlement that broke it read 「0/6」 (reported
 * 2026-09-14); the week's share is said beside it now. Null for the paths that
 * count nothing: 枪法's streak and 沟通's company.
 */
export function breakCount(state: GameState, k: K): BreakCount | null {
  const need = NEED[k]
  const me = state.me
  if (!need || !me) return null
  const p = state.players[me.id]
  const bn = me.bottleneck
  const pro = me.phase === 'pro'
  const week = k === 'reaction' ? me.plan.ranked ?? 0
    : k === 'awareness' ? me.plan.vod ?? 0
      : k === 'utility' ? me.plan.util ?? 0
        : k === 'teamwork' ? (pro ? me.plan.scrim ?? 0 : 0)
          : k === 'clutch' ? (bn ? Math.max(0, p.career.clutches - bn.clutchMark) : 0)
            : bn && pro && p.isIgl ? Math.max(0, p.career.maps - bn.mapsMark) : 0
  return { have: bn?.count[k] ?? 0, need, week }
}

const counted = (s: GameState, k: K) => s.me!.bottleneck?.count[k] ?? 0
const upTo = (n: number, need: number) => `${Math.min(n, need)}/${need}`
/** 「已复盘 4/6 次 · 这周又复盘了 2 次，周结算时算进去」 —— the hours are done the moment they are clicked (me/week.ts doAction); it is the count that is judged at the settlement, with 枪法's weeks in a row */
function tally(s: GameState, k: K, head: string, unit: string, soon: string): string {
  const c = breakCount(s, k)!
  const more = c.week > 0 && chasing(s, k) ? ` · ${soon.replace('#', String(c.week))}，周结算时算进去` : ''
  return `${head} ${upTo(c.have, c.need)} ${unit}${more}`
}

function veteranOf(state: GameState): Player | undefined {
  const me = state.me!
  if (me.phase !== 'pro') return undefined
  return (state.teams[state.myTeam]?.roster ?? [])
    .map((id) => state.players[id])
    .find((q) => !!q && q.id !== me.id && q.age >= VET_AGE)
}
const strongClub = (state: GameState) => state.me!.phase === 'pro' && (state.teams[state.myTeam]?.rating ?? 0) >= STRONG_TEAM
// ever, not just this year: the detail only reaches back a year (me/detail.ts), so the career's own
// count answers it, with the detail still there as a floor for a save whose records hold a comp key
const playedIntl = (state: GameState) => tallyOf(state.me!).intl > 0
  || state.me!.matches.some((m) => m.started && isIntlComp(state.comps[m.comp]?.name ?? m.comp))

/**
 * Every attribute's own way through, 破晓's BREAK_PATHS on this game's eight.
 * The practice ones follow the week board — each attribute breaks on the
 * action that trains it — and count only once the ceiling is reached, the fix
 * 破晓 had to make after 「操作 80/92 随便练三周也弹突破」. 枪法 is the grind,
 * as 操作 was: weeks in a row. 残局 and 沟通 are situations, as 心态 and 指挥
 * were, and pay once; after that their ceilings open on milestones and on what
 * other breaks carry over.
 */
export const BREAK_PATHS: Record<K, BreakPath> = {
  aim: {
    how: '每周至少练 2 次枪法训练，连续 3 周', value: BREAK_VALUE.grind,
    reason: '连着三周，泡在练枪软件和死斗里。',
    prog: (s) => `本周练了 ${s.me!.plan.aim ?? 0} 次（要 2 次）· 已连续 ${upTo(s.me!.bottleneck?.aimStreak ?? 0, 3)} 周`,
    done: (s) => (s.me!.bottleneck?.aimStreak ?? 0) >= 3,
  },
  reaction: {
    how: `卡在瓶颈上以后，打满 ${NEED.reaction} 次排位`, value: BREAK_VALUE.grind,
    reason: '又是一晚上的对枪。',
    prog: (s) => tally(s, 'reaction', '已打', '次', '这周又打了 # 次排位'),
    done: (s) => counted(s, 'reaction') >= NEED.reaction!,
  },
  awareness: {
    how: `卡在瓶颈上以后，复盘满 ${NEED.awareness} 次`, value: BREAK_VALUE.grind,
    reason: '录像看到第几遍，已经数不清了。',
    prog: (s) => tally(s, 'awareness', '已复盘', '次', '这周又复盘了 # 次'),
    done: (s) => counted(s, 'awareness') >= NEED.awareness!,
  },
  utility: {
    how: `卡在瓶颈上以后，练满 ${NEED.utility} 次道具与跑图`, value: BREAK_VALUE.grind,
    reason: '每个点位的道具都丢过上百遍，现在闭着眼也知道落在哪。',
    prog: (s) => tally(s, 'utility', '已练', '次', '这周又练了 # 次道具与跑图'),
    done: (s) => counted(s, 'utility') >= NEED.utility!,
  },
  clutch: {
    how: `卡在瓶颈上以后，在正赛里赢下 ${NEED.clutch} 个残局；或者拿一次冠军`, value: BREAK_VALUE.path, key: 'clutch',
    reason: '残局又一次落到你手上。手没抖。',
    prog: (s) => tally(s, 'clutch', '残局', '个', '这周比赛里又赢了 # 个'),
    done: (s) => counted(s, 'clutch') >= NEED.clutch! || s.me!.titles.some((t) => t.started),
  },
  teamwork: {
    how: `卡在瓶颈上以后，打满 ${NEED.teamwork} 次跟队训练赛`, value: BREAK_VALUE.grind, pro: true,
    reason: '训练赛打到后来，报点只要报一半。',
    prog: (s) => tally(s, 'teamwork', '已打', '次', '这周又打了 # 次训练赛'),
    done: (s) => counted(s, 'teamwork') >= NEED.teamwork!,
  },
  communication: {
    how: `和 ${VET_AGE} 岁以上的老将同队、待在强队，或者打过国际赛`, value: BREAK_VALUE.path, pro: true, key: 'commenv',
    reason: '这一年，语音里你开口的次数多了。',
    prog: (s) => {
      const v = veteranOf(s)
      return v ? `队里有 ${v.ign}` : strongClub(s) ? '待在强队' : playedIntl(s) ? '打过国际赛' : '还没有'
    },
    done: (s) => !!veteranOf(s) || strongClub(s) || playedIntl(s),
  },
  igl: {
    how: `卡在瓶颈上以后，以队里指挥的身份打满 ${NEED.igl} 张图`, value: BREAK_VALUE.grind, pro: true,
    reason: '喊了这么多回合，一句话说到哪就停，你心里有数了。',
    prog: (s) => (s.players[s.me!.id]?.isIgl ? tally(s, 'igl', '已打', '张图', '这周又打了 # 张图') : '你现在不是队里的指挥'),
    done: (s) => counted(s, 'igl') >= NEED.igl!,
  },
}

/** What a break would open, laid out and not made: points by attribute, the 综合 they cost the pool, and what the pool could give. */
interface BreakPlan { plan: Map<K, number>; paid: number; want: number }

/**
 * Lay out a break without making it. The pool of the attribute that broke opens
 * less the fuller it is — 破晓's diminishing room, never under two fifths for a
 * milestone — unless `flat`, for what an older build owed. The attribute that
 * broke takes what its weight asks, up to BREAK_POINTS; the rest goes to the
 * role's heaviest with room.
 *
 * A practice path's break (`mech`) always puts its first point on the attribute
 * that broke, while the pool can carry half of one — 破晓's trialCanPay,
 * 「付不出这一格就不开」. It asked for 0.05 of 综合 before anything: two breaks
 * into a pool left it at 1.16 of 1.2, a third wanted 0.04, and it opened nothing
 * while pathDead, reading 1.18, still called the path live — so the count filled
 * and emptied for ever. And a heavy attribute's point costs more than a thin
 * break's share: a sentinel's 意识 (0.22) broke, and only 枪法's ceiling moved.
 */
function planBreak(p: Player, bn: BottleneckState, k: K, value: number, kind: 'mech' | 'mile', flat = false): BreakPlan {
  const w = weightsFor(p)
  const caps = ceilingsOf(p)
  const max = kind === 'mile' ? MILE_VALUE_MAX : MECH_VALUE_MAX
  const used = usedOf(p, bn, kind, k)
  const room = flat ? 1 : clamp(1 - used / max, kind === 'mile' ? 0.4 : 0.12, 1)
  const want = Math.min(value * room, max - used)
  const plan = new Map<K, number>()
  const owed = kind === 'mech' && max - used >= w[k] / 2
  if (want < 0.05 && !owed) return { plan, paid: 0, want }
  let left = want
  const put = (j: K, first: boolean) => {
    let n = 0
    while ((left >= w[j] / 2 || (first && n === 0)) && caps[j] + (plan.get(j) ?? 0) < CAP_HARD && n < BREAK_POINTS) {
      plan.set(j, (plan.get(j) ?? 0) + 1)
      left -= w[j]
      n++
    }
  }
  put(k, owed)
  for (const j of byWeight(p)) if (j !== k && left >= 0.05) put(j, false)
  // what the points are really worth, rounding included, is what the pool spends
  const paid = [...plan.entries()].reduce((s, [j, n]) => s + n * w[j], 0)
  return { plan, paid, want }
}

/** Why this attribute's own path can no longer open anything, or null — said on the card, never left to be found out. */
export function pathDead(state: GameState, k: K): string | null {
  const me = state.me!
  const p = state.players[me.id]
  if (ceilingsOf(p)[k] >= CAP_HARD) return `已经到 ${CAP_HARD}，这是所有人的终点，没有再往上的路`
  const bn = me.bottleneck
  const P = BREAK_PATHS[k]
  if (P.key && bn?.seen.includes(P.key)) return '这条路已经走过一次——再往上靠冠军、决赛 MVP，或者别的瓶颈破开时连带'
  // the question the break itself asks: can it still put a point on this attribute (planBreak)
  if (bn && !planBreak(p, bn, k, P.value, 'mech').plan.get(k)) return '练出来的那一截已经到头——再往上靠冠军、决赛 MVP，或者别的瓶颈破开时连带'
  return null
}

/**
 * Is this attribute's path live right now: at the ceiling, still able to
 * pay, and possible where I am. The card, the steady plan and the weekly
 * count all ask this one question — 破晓 had three places each asking their
 * own, and the loosest one kept scolding the player for a greyed-out button.
 */
export function chasing(state: GameState, k: K): boolean {
  const me = state.me!
  const p = state.players[me.id]
  if (!p || !atCeiling(p, k) || pathDead(state, k)) return false
  return !BREAK_PATHS[k].pro || me.phase === 'pro'
}

export interface BreakInfo { how: string; prog: string; dead: string | null; locked: boolean }

/** One line of the attribute card's 「怎么破」. */
export function breakInfo(state: GameState, k: K): BreakInfo {
  const P = BREAK_PATHS[k]
  const dead = pathDead(state, k)
  return { how: P.how, prog: P.prog(state), dead, locked: !dead && !!P.pro && state.me!.phase !== 'pro' }
}

/**
 * 事件里的练习，落在已经卡在瓶颈上的一项上。
 *
 * An option that says 「练枪 +10」 was worth exactly nothing there: addXp
 * (me/growth.ts) drops xp at a ceiling, the bar is already empty, and the card
 * had promised progress anyway — so a player read the cards as noise and started
 * answering at random (reported 2026-09-16). Nothing is banked, that rule stands
 * (「卡在瓶颈时不再存点」), so the hours go where the week's own hours go: into
 * the count that breaks the ceiling, which the 「怎么破」 card shows.
 *
 * Only on the paths a player could have planned himself — breakCount reads the
 * week board for these four: 排位, 复盘, 道具与跑图, 训练赛. 残局 and 指挥 count
 * what a match gave (clutches won, maps called), and 枪法 counts weeks in a row,
 * not sessions; an event cannot honestly add to those, so it says so and takes
 * nothing.
 */
export const EVT_PATHS: K[] = ['reaction', 'awareness', 'utility', 'teamwork']
/** the word for one session of each, as the count is read out */
const EVT_CN: Partial<Record<K, string>> = { reaction: '排位', awareness: '复盘', utility: '道具与跑图', teamwork: '训练赛' }
/** xp an event has to carry to be worth one session of the path it joins */
export const EVT_XP_PER = 10
/** the most of a path's count events may ever hand it, as a share of what it needs — a third, so an event can help and never replace the practice */
export const EVT_SHARE = 1 / 3
export const evtCap = (need: number): number => Math.max(1, Math.round(need * EVT_SHARE))

export interface CeilingXp {
  /** sessions this xp adds to the path's count; 0 = nothing happens */
  add: number
  /** the one sentence the option's button says before and the result line says after */
  text: string
}

/**
 * What an event's xp does to an attribute that is already at its ceiling,
 * worked out without changing anything — so what the player reads before
 * choosing is what happens after (me/events.ts describeEffect, me/fx.ts).
 * Empty text for an attribute with room under it: that xp is ordinary progress.
 */
export function ceilingXp(state: GameState, k: K, xp: number): CeilingXp {
  const me = state.me
  const p = me ? state.players[me.id] : undefined
  if (!me || !p?.caps || !atCeiling(p, k) || xp <= 0) return { add: 0, text: '' }
  const cn = ATTR_CN[k]
  const c = EVT_PATHS.includes(k) ? breakCount(state, k) : null
  if (!c || !chasing(state, k)) return { add: 0, text: `${cn}到头了，先破瓶颈` }
  const room = Math.min(evtCap(c.need) - (me.bottleneck?.evt?.[k] ?? 0), c.need - c.have)
  if (room <= 0) return { add: 0, text: `${cn}到头了：这条路上事件能顶的已经顶满，剩下的要自己练` }
  const add = Math.min(room, Math.max(1, Math.round(xp / EVT_XP_PER)))
  return { add, text: `${cn}卡在瓶颈，这次算进${EVT_CN[k]} ${c.have + add}/${c.need}` }
}

/** Take it: the count moves, the 「怎么破」 card shows it, and the line says the same thing the button did. */
export function takeCeilingXp(state: GameState, k: K, xp: number): string {
  const plan = ceilingXp(state, k, xp)
  if (plan.add <= 0) return plan.text
  const bn = ensureCeilings(state)
  if (!bn) return plan.text
  bn.count[k] = (bn.count[k] ?? 0) + plan.add
  bn.evt = { ...(bn.evt ?? {}), [k]: (bn.evt?.[k] ?? 0) + plan.add }
  return plan.text
}

/** The attribute each week-board action trains and breaks. */
const ACTION_ATTR: Partial<Record<string, K>> = { aim: 'aim', vod: 'awareness', util: 'utility', ranked: 'reaction', scrim: 'teamwork' }

/**
 * What an action's card says once the attribute it trains sits at its ceiling,
 * or null. The weekly line used to say 「这周只练了 1/2 次」 and nothing else,
 * and a player read it as a meter of something he was losing (reported
 * 2026-09-12: 「枪法达到上限后再点练习会显示 1/2 保持，这是什么意思以及枪法是会掉吗」).
 */
export function ceilingNote(state: GameState, action: string): string | null {
  const k = ACTION_ATTR[action]
  const me = state.me
  if (!k || !me) return null
  const p = state.players[me.id]
  if (!p?.caps || !atCeiling(p, k)) return null
  const head = `${ATTR_CN[k]}到瓶颈了：再练${ATTR_CN[k]}不涨，练的时间也不会存着；不练也不会掉。`
  const dead = pathDead(state, k)
  if (dead) return `${head}${dead}。`
  if (BREAK_PATHS[k].pro && me.phase !== 'pro') return `${head}冲击瓶颈要先签下一支队。`
  if (k === 'aim') return `${head}冲击瓶颈：每周练 2 次、连续 3 周（本周 ${me.plan.aim ?? 0} 次，已连续 ${Math.min(3, me.bottleneck?.aimStreak ?? 0)}/3 周）。`
  return `${head}冲击瓶颈：${BREAK_PATHS[k].how}（${BREAK_PATHS[k].prog(state)}）。`
}

/**
 * Open a ceiling by `value` of 综合, as planBreak lays it out. A keyed source
 * counts once. A milestone lifts half of what it opened at once; a practice
 * break leaves the room for practice to fill, and says so. A milestone that
 * finds nothing left to open still says so: a trophy that moves nothing in
 * silence is worse than no line at all.
 */
export function breakthrough(state: GameState, k: K, value: number, reason: string, kind: 'mech' | 'mile', key?: string, flat = false): number {
  const bn = ensureCeilings(state)
  const me = state.me
  if (!bn || !me) return 0
  const p = state.players[me.id]
  const caps = p.caps!
  if (key) {
    if (bn.seen.includes(key)) return 0
    bn.seen.push(key)
  }
  const cn = ATTR_CN[k]
  const { plan, paid, want } = planBreak(p, bn, k, value, kind, flat)
  if (!plan.size) {
    if (kind === 'mile') {
      say(state, 'info', want < 0.05
        ? `${reason}——${cn}的瓶颈已经被经历顶到头了。`
        : `${reason}——${cn}和你位置最看重的几项都已经到 ${CAP_HARD}，没有再往上的空间了。`)
    }
    return 0
  }
  const book = kind === 'mile' ? bn.mileV! : bn.mechV!
  book[k] = (book[k] ?? 0) + paid
  const pts = kind === 'mile' ? bn.mile : bn.mech
  pts[k] = (pts[k] ?? 0) + (plan.get(k) ?? 0)
  const ovr0 = p.overall
  const pot0 = p.potential
  const parts: string[] = []
  for (const [j, n] of plan) {
    const before = caps[j]
    caps[j] = Math.min(CAP_HARD, before + n)
    // a trophy is the night itself: half of what it opens is his at once, under the new ceiling
    if (kind === 'mile') {
      const lift = Math.min(Math.ceil(n / 2), caps[j] - p.attrs[j])
      if (lift > 0) p.attrs[j] += lift
      // a lift that reaches the ceiling keeps nothing over (no 存点数)
      if (p.attrs[j] >= caps[j]) p.xp[j] = 0
    }
    parts.push(`${ATTR_CN[j]}的瓶颈 ${before} → ${caps[j]}`)
  }
  recomputeOverall(p)
  settle(state, p, bn)
  const moved = p.overall > ovr0 ? `，综合 ${ovr0} → ${p.overall}` : ''
  const next = kind === 'mech' && plan.get(k) && p.attrs[k] < caps[k] ? `${cn}照常练就能涨上去。` : ''
  say(state, 'good', `瓶颈松动 · ${reason}${parts[0]}${parts.length > 1 ? `，连带${parts.slice(1).join('、')}` : ''}。综合上限 ${pot0} → ${p.potential}${moved}。${next}`)
  return paid
}

/**
 * The week's hours, counted against whatever sits at its ceiling. Runs at
 * the settlement after the training has landed, so a bar that reached its
 * ceiling this week is already there.
 */
export function bottleneckWeek(state: GameState): void {
  const bn = ensureCeilings(state)
  const me = state.me
  if (!bn || !me) return
  const p = state.players[me.id]
  const caps = p.caps!
  if (p.potential > bn.pot) settle(state, p, bn)
  const pinned = (k: K) => p.attrs[k] >= caps[k]

  // 枪法 is the grind, as 操作 was: the streak counts every week and pays at the
  // ceiling. A broken streak is said out loud — silence reads as 「练了没算」 —
  // and in words: 「1/2」 on its own read as something slipping away.
  const aimed = me.plan.aim ?? 0
  const was = bn.aimStreak
  const chaseAim = chasing(state, 'aim')
  bn.aimStreak = aimed >= 2 ? was + 1 : 0
  if (chaseAim && aimed >= 2 && bn.aimStreak < 3) say(state, 'info', `冲击枪法瓶颈：这周练了 ${aimed} 次（每周要 2 次），已经连续 ${bn.aimStreak}/3 周。`)
  else if (chaseAim && aimed < 2 && was > 0) say(state, 'bad', `冲击枪法瓶颈的连续周数断了：这周只练了 ${aimed} 次，要每周至少 2 次、连着 3 周，从头算。枪法本身不会因为少练而掉。`)

  // The rest count while their path is live: at the ceiling, able to pay, possible where I am (chasing).
  // What was counted stays when the ceiling moves out from under it — a break elsewhere that carried over,
  // a season, the winter. It used to start over the week the attribute left its ceiling, and it emptied in
  // silence; only hours at the ceiling are ever added, so nothing counts that was not earned there.
  for (const k of ATTR_KEYS) {
    const c = breakCount(state, k)
    if (c && c.week > 0 && chasing(state, k)) bn.count[k] = c.have + c.week
  }
  bn.clutchMark = p.career.clutches
  bn.mapsMark = p.career.maps

  const fresh = ATTR_KEYS.filter((k) => pinned(k) && !bn.pinned.includes(k) && caps[k] < CAP_HARD)
  if (fresh.length) {
    const ended = fresh.filter((k) => pathDead(state, k))
    say(state, 'info', `${fresh.map((k) => `${ATTR_CN[k]} ${p.attrs[k]}`).join('、')} 练到瓶颈了：属性先停在这里，练的时间也不会存着。${ended.length < fresh.length ? '照「我的」页上的「怎么破」做满，瓶颈当场破开。' : ''}${ended.length ? `${ended.map((k) => ATTR_CN[k]).join('、')}练出来的那一截已经到头，再往上靠冠军这样的时刻。` : ''}`)
  }

  for (const k of ATTR_KEYS) {
    const P = BREAK_PATHS[k]
    if (!chasing(state, k) || !P.done(state)) continue
    const paid = breakthrough(state, k, P.value, P.reason, 'mech', P.key)
    if (paid > 0) {
      if (k === 'aim') bn.aimStreak = 0
      bn.count[k] = 0
      // what events handed this path is spent with it: the next ceiling is worked at from zero (ceilingXp)
      if (bn.evt?.[k]) bn.evt[k] = 0
    } else {
      // chasing asked planBreak first, so this is not expected — said, and the count kept, never emptied in silence
      say(state, 'info', `${ATTR_CN[k]}的「怎么破」做满了，但这次没能破开：${pathDead(state, k) ?? '瓶颈这回没有松动'}。计数留着。`)
    }
  }
  bn.pinned = ATTR_KEYS.filter(pinned)
}

/**
 * A stage at a strong club, or beside someone who has seen it all, loosens a
 * ceiling whether or not it had been reached — 破晓's checkBreakthrough. Each
 * source counts once.
 */
export function bottleneckStage(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || me.playedThisStage <= 0 || !ensureCeilings(state)) return
  const team = state.teams[state.myTeam]
  if (!team) return
  if (team.rating >= STRONG_TEAM) {
    breakthrough(state, 'communication', BREAK_VALUE.room, `在 ${team.name} 这样的队里待着，训练里每个人说话都有分量。`, 'mech', 'strong:communication')
    breakthrough(state, 'awareness', BREAK_VALUE.room * 0.6, '高强度的训练赛把你的判断磨快了。', 'mech', 'strong:awareness')
  }
  const vet = veteranOf(state)
  if (vet) breakthrough(state, 'communication', BREAK_VALUE.room * 0.6, `${vet.ign} 在复盘里把他这些年的东西讲给了你。`, 'mech', `vet:${vet.id}`)
}

/**
 * What a season teaches without anyone practising it. The engine's own ageing
 * says which those are: 「aim and reaction go first」 while reading the game
 * keeps rising (training.ts seasonRollover). So the seasons loosen those five
 * and leave the hands to the practice paths — measured with all eight
 * loosening, careers finished four or five overall above the old ceiling.
 */
export const SEASON_LOOSENS: K[] = ['awareness', 'clutch', 'teamwork', 'communication', 'igl']

/**
 * A professional season behind you loosens the experience ceilings by one, up to CAP_EXP_MAX — 破晓's 经验顶瓶颈.
 * It names the ones that moved: it used to say all five loosened when some were already at 99.
 */
export function bottleneckSeason(state: GameState, played: boolean): void {
  const bn = ensureCeilings(state)
  const me = state.me
  if (!bn || !me || !played || bn.exp >= CAP_EXP_MAX) return
  const p = state.players[me.id]
  bn.exp++
  const moved = SEASON_LOOSENS.filter((k) => p.caps![k] < CAP_HARD)
  for (const k of moved) p.caps![k] += 1
  settle(state, p, bn)
  const top = SEASON_LOOSENS.filter((k) => !moved.includes(k)).map((k) => ATTR_CN[k])
  say(state, 'good', moved.length
    ? `又打完一个职业赛季，越打越老练：${moved.map((k) => ATTR_CN[k]).join('、')}的瓶颈各松了 1 点（第 ${bn.exp} 次，最多 ${CAP_EXP_MAX} 次）${top.length ? `；${top.join('、')}已经到 ${CAP_HARD}` : ''}。枪法、反应和道具要靠练。`
    : `又打完一个职业赛季（第 ${bn.exp} 次，最多 ${CAP_EXP_MAX} 次）：${top.join('、')}的瓶颈都已经到 ${CAP_HARD}，没有再松的地方。`)
}

/** Did I start a match of this event? A title is judged by the event itself, not by the stage's running count. */
export function startedIn(state: GameState, title: string, year: number): boolean {
  return state.me!.matches.some((m) => !m.friendly && m.year === year && m.comp === title && m.started)
}

/** The final's MVP: my last match of the event, started, won, and the MVP mine. */
export function finalMvp(state: GameState, title: string, year: number): boolean {
  const mine = state.me!.matches.filter((m) => !m.friendly && m.year === year && m.comp === title)
  const last = mine[mine.length - 1]
  return !!last && last.started && last.won && last.mvp
}

const isIntlClass = (title: string): boolean => {
  const c = compClass(title)
  return c === 'champions' || c === 'masters' || c === 'lockin'
}

/**
 * A trophy I started in opens the ceilings big nights are about, from the
 * milestone pool: 残局 and 沟通 as before, and the attribute the role leans on
 * most. The final's MVP opens that one again. A qualifier is a door, not a trophy.
 */
export function bottleneckTitle(state: GameState, title: string, year = state.year, fmvp = false): void {
  const me = state.me
  if (!me) return
  // a qualifier won is 出线: a door opens, no ceiling does (me/compclass.ts isQualifier)
  if (isQualifier(title)) return
  const p = state.players[me.id]
  const kind = compClass(title)
  const main = mainOf(p)
  if (isIntlClass(title)) {
    const big = kind === 'champions'
    const V = big ? BREAK_VALUE.champions : BREAK_VALUE.masters
    breakthrough(state, 'clutch', V * 0.45, big ? '你在世界最高的舞台上赢过一次，没有什么再能让你手抖。' : '大师赛的领奖台你站上去过了，大场面再也吓不到你。', 'mile')
    breakthrough(state, 'communication', V * 0.25, big ? '世界冠军喊的每一句，队友都愿意跟。' : '拿过国际冠军的人说话，队友会听。', 'mile')
    breakthrough(state, main, V * 0.3, big ? '捧起冠军赛奖杯以后，你知道自己的东西放在全世界也够用。' : '在国际赛场上一路赢到最后，你手上的东西更有底了。', 'mile')
  } else if (kind === 'league' || kind === 'chal') {
    breakthrough(state, 'clutch', BREAK_VALUE.league, '捧过一次奖杯之后，大场面对你来说不一样了。', 'mile', 'lgtitle')
    if (kind === 'league' && state.teams[state.myTeam]?.tier === 1) {
      breakthrough(state, main, BREAK_VALUE.league, '一级联赛的奖杯捧过了，你知道自己在这个级别站得住。', 'mile', 'vcttitle')
    }
  }
  // the final's MVP is a milestone where the trophy is one: an international, or a VCT league's — not a Challengers split
  const vct = kind === 'league' && state.teams[state.myTeam]?.tier === 1
  if (fmvp && (isIntlClass(title) || vct)) {
    breakthrough(state, main, isIntlClass(title) ? BREAK_VALUE.fmvp : BREAK_VALUE.fmvp / 2, `${title}决赛的 MVP 是你。`, 'mile', `fmvp:${year}:${title}`)
  }
}

/**
 * Once per book from an older build: the title breaks it missed. Until
 * 2026-09-11 a title was matched with /Champions|Masters/, which no event on
 * the timeline is called (「2026 全球冠军赛」「伦敦大师赛」), so an international
 * paid at most the one-off league break; its 「出场」 was the stage's running
 * count, which the stage change clears the same day the final is played; and
 * breaks were worth a fraction of what they are now. What the started
 * internationals are worth today, less what the milestone pools already hold,
 * is paid now, and a final's MVP still on record with it.
 */
function lookBack(state: GameState, p: Player, bn: BottleneckState): void {
  bn.rev = 2
  const me = state.me!
  for (const t of me.titles) if (!t.started && startedIn(state, t.title, t.year)) t.started = true
  const started = me.titles.filter((t) => t.started)
  if (!started.length) return
  const w = weightsFor(p)
  const intl = started.filter((t) => isIntlClass(t.title))
  const owed = intl.reduce((s, t) => s + (compClass(t.title) === 'champions' ? BREAK_VALUE.champions : BREAK_VALUE.masters), 0)
  const held = ATTR_KEYS.reduce((s, k) => s + (bn.mileV?.[k] ?? 0), 0)
  // the older build paid a first trophy as 2 points of 残局, under 'lgtitle'
  const paid = Math.max(0, held - (bn.seen.includes('lgtitle') ? 2 * w.clutch : 0))
  const due = owed - paid
  const main = mainOf(p)
  if (due > 0.1) {
    const why = '补发：之前拿下的国际赛冠军没有全算进瓶颈。'
    breakthrough(state, 'clutch', due * 0.45, why, 'mile', undefined, true)
    breakthrough(state, 'communication', due * 0.25, why, 'mile', undefined, true)
    breakthrough(state, main, due * 0.3, why, 'mile', undefined, true)
  }
  if (started.some((t) => compClass(t.title) === 'league' || compClass(t.title) === 'chal')) {
    breakthrough(state, 'clutch', BREAK_VALUE.league, '补发：捧过一次奖杯之后，大场面对你来说不一样了。', 'mile', 'lgtitle', true)
  }
  for (const t of intl) {
    if (finalMvp(state, t.title, t.year)) breakthrough(state, main, BREAK_VALUE.fmvp, `补发：${t.title}决赛的 MVP 是你。`, 'mile', `fmvp:${t.year}:${t.title}`, true)
  }
}
