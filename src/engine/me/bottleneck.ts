import { clamp } from '../rng'
import { ATTR_CN, ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player } from '../types'
import { CEILING_BANK, recomputeOverall, refreshValue, weightsFor } from '../player'
import { pushLog } from './log'
import type { BottleneckState, LogKind } from './types'
import { compClass, isIntlComp } from './compclass'

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
 * And a break is seen. Hours at a ceiling bank up to BANK_POINTS, which land
 * the moment it opens; a trophy lifts half of what it opens at once.
 */

export const CAP_HARD = 99
/** the highest a talent alone puts a ceiling — under the hard cap, so a maxed attribute still has a path on the first day (破晓: talent 10 is 95 before its breaks) */
export const TALENT_CAP_MAX = 97
/** What each kind of break is worth, in 综合上限. */
export const BREAK_VALUE = {
  /** a practice path: three weeks of 枪法, twelve ranked, six reviews, four scrims, eight maps calling */
  grind: 0.9,
  /** a situation that pays once: five clutches, a year among veterans and big stages */
  path: 1.0,
  /** a strong club or a veteran in the room — it comes to everyone who is there, so it is worth less than what is worked for */
  room: 0.4,
  /** the first trophy, and the first in a VCT league */
  league: 0.8,
  /** a Masters or LOCK//IN, started in */
  masters: 1.6,
  /** Champions, started in — 破晓's world title is +3.5 and +3.0 on a fifth each, +1.3 */
  champions: 2.4,
  /** the final's MVP, on top of the title */
  fmvp: 1.0,
} as const
/**
 * most points one break puts on the attribute that broke; the rest goes where
 * the role needs it. Six let a duelist's 沟通 soak up a strong club's whole
 * break into a ceiling nobody trains to (measured: 沟通 99 over a 60 attribute
 * at 26), so the 综合 it was sized in never showed.
 */
export const BREAK_POINTS = 3
/** 综合 the practice paths can open, per attribute: 破晓's 6 points on a fifth of its overall is 1.2 */
export const MECH_VALUE_MAX = 2.0
/** 综合 milestones can open, per attribute — apart, so the grind cannot eat a trophy's share */
export const MILE_VALUE_MAX = 3.0
/** professional seasons that each loosen the experience ceilings by one */
export const CAP_EXP_MAX = 5
/** points an attribute at its ceiling banks, landing when the ceiling opens */
export const BANK_POINTS = CEILING_BANK / 100
/** a club this strong teaches by being in the room: the weakest tenth of a new world's VCT clubs (engine/ruler.ts) */
export const STRONG_TEAM = 80
/** old enough to have seen most of it */
export const VET_AGE = 27

type K = keyof Attrs

/** The overall before recomputeOverall rounds it. */
function rawOverall(p: Player): number {
  const w = weightsFor(p)
  return ATTR_KEYS.reduce((s, k) => s + p.attrs[k] * w[k], p.stageBonus ?? 0)
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

/** Sitting at the ceiling: more hours only fill the bank. */
export const atCeiling = (p: Player, k: K): boolean => p.attrs[k] >= ceilingsOf(p)[k]

/** The overall the eight ceilings add up to — what the attribute card calls 上限. */
export function ceilingPotential(p: Pick<Player, 'role' | 'attrs' | 'stageBonus'>, caps: Record<K, number> = ceilingsOf(p as Player)): number {
  const w = weightsFor(p)
  const v = ATTR_KEYS.reduce((s, k) => s + Math.max(p.attrs[k], caps[k]) * w[k], p.stageBonus ?? 0)
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
 * valued, and the title breaks that build missed paid (lookBack).
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
  if (bn.rev !== 2) lookBack(state, p, bn)
  return bn
}

function say(state: GameState, kind: LogKind, text: string): void {
  pushLog(state, kind, text)
  state.me!.weekNotes.push(text)
}

/** What banked while it waited at the ceiling turns into points the moment the ceiling moves. */
function rollBanked(p: Player, k: K): number {
  let n = 0
  while (p.caps && (p.xp[k] ?? 0) >= 100 && p.attrs[k] < p.caps[k]) {
    p.xp[k] = (p.xp[k] ?? 0) - 100
    p.attrs[k] += 1
    n++
  }
  if (n) recomputeOverall(p)
  return n
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
    for (const k of ATTR_KEYS) p.caps[k] = Math.min(CAP_HARD, p.caps[k] + lift)
    for (const k of ATTR_KEYS) rollBanked(p, k)
    say(state, 'good', `冬训后教练组重新评估了你：八项的瓶颈各松了 ${lift} 点。`)
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

const counted = (s: GameState, k: K) => s.me!.bottleneck?.count[k] ?? 0
const upTo = (n: number, need: number) => `${Math.min(n, need)}/${need}`

function veteranOf(state: GameState): Player | undefined {
  const me = state.me!
  if (me.phase !== 'pro') return undefined
  return (state.teams[state.myTeam]?.roster ?? [])
    .map((id) => state.players[id])
    .find((q) => !!q && q.id !== me.id && q.age >= VET_AGE)
}
const strongClub = (state: GameState) => state.me!.phase === 'pro' && (state.teams[state.myTeam]?.rating ?? 0) >= STRONG_TEAM
const playedIntl = (state: GameState) => state.me!.matches.some((m) => m.started && isIntlComp(state.comps[m.comp]?.name ?? m.comp))

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
    reason: '连着三周把时间砸在练枪软件和死斗里，手上的东西磨出来了。',
    prog: (s) => `本周练了 ${s.me!.plan.aim ?? 0} 次（要 2 次）· 已连续 ${upTo(s.me!.bottleneck?.aimStreak ?? 0, 3)} 周`,
    done: (s) => (s.me!.bottleneck?.aimStreak ?? 0) >= 3,
  },
  reaction: {
    how: '卡在瓶颈上以后，打满 12 次排位', value: BREAK_VALUE.grind,
    reason: '一把接一把的对枪，把你的反应逼快了。',
    prog: (s) => `已打 ${upTo(counted(s, 'reaction'), 12)} 次`,
    done: (s) => counted(s, 'reaction') >= 12,
  },
  awareness: {
    how: '卡在瓶颈上以后，复盘满 6 次', value: BREAK_VALUE.grind,
    reason: '泡在录像里的这些天，你看比赛的方式变了。',
    prog: (s) => `已复盘 ${upTo(counted(s, 'awareness'), 6)} 次`,
    done: (s) => counted(s, 'awareness') >= 6,
  },
  utility: {
    how: '卡在瓶颈上以后，练满 6 次道具与跑图', value: BREAK_VALUE.grind,
    reason: '每个点位的道具都丢过上百遍，现在闭着眼也知道落在哪。',
    prog: (s) => `已练 ${upTo(counted(s, 'utility'), 6)} 次`,
    done: (s) => counted(s, 'utility') >= 6,
  },
  clutch: {
    how: '卡在瓶颈上以后，在正赛里赢下 5 个残局；或者拿一次冠军', value: BREAK_VALUE.path, key: 'clutch',
    reason: '最后一个人交到你手上的时候，你已经不慌了。',
    prog: (s) => `残局 ${upTo(counted(s, 'clutch'), 5)}`,
    done: (s) => counted(s, 'clutch') >= 5 || s.me!.titles.some((t) => t.started),
  },
  teamwork: {
    how: '卡在瓶颈上以后，打满 4 次跟队训练赛', value: BREAK_VALUE.grind, pro: true,
    reason: '一起打了这么多训练赛，你知道队友下一步会站在哪。',
    prog: (s) => `已打 ${upTo(counted(s, 'teamwork'), 4)} 次`,
    done: (s) => counted(s, 'teamwork') >= 4,
  },
  communication: {
    how: `和 ${VET_AGE} 岁以上的老将同队、待在强队，或者打过国际赛`, value: BREAK_VALUE.path, pro: true, key: 'commenv',
    reason: '这一年你身边的人和场面，把你说话的方式改了。',
    prog: (s) => {
      const v = veteranOf(s)
      return v ? `队里有 ${v.ign}` : strongClub(s) ? '待在强队' : playedIntl(s) ? '打过国际赛' : '还没有'
    },
    done: (s) => !!veteranOf(s) || strongClub(s) || playedIntl(s),
  },
  igl: {
    how: '卡在瓶颈上以后，以队里指挥的身份打满 8 张图', value: BREAK_VALUE.grind, pro: true,
    reason: '喊了这么多回合，你知道什么时候该开口、说到哪一句就够了。',
    prog: (s) => (s.players[s.me!.id]?.isIgl ? `已打 ${upTo(counted(s, 'igl'), 8)} 张图` : '你现在不是队里的指挥'),
    done: (s) => counted(s, 'igl') >= 8,
  },
}

/** Why this attribute's own path can no longer open anything, or null — said on the card, never left to be found out. */
export function pathDead(state: GameState, k: K): string | null {
  const me = state.me!
  const p = state.players[me.id]
  if (ceilingsOf(p)[k] >= CAP_HARD) return `已经到 ${CAP_HARD}，这是所有人的终点，没有再往上的路`
  const bn = me.bottleneck
  if (bn && usedOf(p, bn, 'mech', k) >= MECH_VALUE_MAX - 0.02) return '练出来的那一截已经到头——再往上靠冠军、决赛 MVP，或者别的瓶颈破开时连带'
  const key = BREAK_PATHS[k].key
  if (key && bn?.seen.includes(key)) return '这条路已经走过一次——再往上靠冠军、决赛 MVP，或者别的瓶颈破开时连带'
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
  const banked = Math.min(BANK_POINTS, Math.floor((p.xp[k] ?? 0) / 100))
  const head = `${ATTR_CN[k]}到瓶颈了：再练不涨，最多先存 ${BANK_POINTS} 点（已存 ${banked} 点），瓶颈一开就兑现；不练也不会掉。`
  const dead = pathDead(state, k)
  if (dead) return `${head}${dead}。`
  if (BREAK_PATHS[k].pro && me.phase !== 'pro') return `${head}冲击瓶颈要先签下一支队。`
  if (k === 'aim') return `${head}冲击瓶颈：每周练 2 次、连续 3 周（本周 ${me.plan.aim ?? 0} 次，已连续 ${Math.min(3, me.bottleneck?.aimStreak ?? 0)}/3 周）。`
  return `${head}冲击瓶颈：${BREAK_PATHS[k].how}（${BREAK_PATHS[k].prog(state)}）。`
}

/**
 * Open a ceiling by `value` of 综合. A keyed source counts once. The pool of
 * the attribute that broke opens less the fuller it is — 破晓's diminishing
 * room, never under two fifths for a milestone — unless `flat`, for what an
 * older build owed. The attribute that broke takes what its weight asks, up to
 * BREAK_POINTS; the rest goes to the role's heaviest with room. What banked at
 * a ceiling lands, and a milestone lifts half of what it opened at once. A
 * milestone that finds nothing left to open still says so: a trophy that moves
 * nothing in silence is worse than no line at all.
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
  const w = weightsFor(p)
  const cn = ATTR_CN[k]
  const book = kind === 'mile' ? bn.mileV! : bn.mechV!
  const max = kind === 'mile' ? MILE_VALUE_MAX : MECH_VALUE_MAX
  const used = book[k] ?? 0
  const room = flat ? 1 : clamp(1 - used / max, kind === 'mile' ? 0.4 : 0.12, 1)
  const want = Math.min(value * room, max - used)
  if (want < 0.05) {
    if (kind === 'mile') say(state, 'info', `${reason}——${cn}的瓶颈已经被经历顶到头了。`)
    return 0
  }
  const plan = new Map<K, number>()
  let left = want
  const put = (j: K) => {
    let n = 0
    while (left >= w[j] / 2 && caps[j] + (plan.get(j) ?? 0) < CAP_HARD && n < BREAK_POINTS) {
      plan.set(j, (plan.get(j) ?? 0) + 1)
      left -= w[j]
      n++
    }
  }
  put(k)
  for (const j of byWeight(p)) if (j !== k && left >= 0.05) put(j)
  if (!plan.size) {
    if (kind === 'mile') say(state, 'info', `${reason}——${cn}和你位置最看重的几项都已经到 ${CAP_HARD}，没有再往上的空间了。`)
    return 0
  }
  // what the points are really worth, rounding included, is what the pool has spent
  const paid = [...plan.entries()].reduce((s, [j, n]) => s + n * w[j], 0)
  book[k] = used + paid
  const pts = kind === 'mile' ? bn.mile : bn.mech
  pts[k] = (pts[k] ?? 0) + (plan.get(k) ?? 0)
  const ovr0 = p.overall
  const pot0 = p.potential
  const parts: string[] = []
  for (const [j, n] of plan) {
    const before = caps[j]
    caps[j] = Math.min(CAP_HARD, before + n)
    rollBanked(p, j)
    // a trophy is the night itself: half of what it opens is his at once, under the new ceiling
    if (kind === 'mile') {
      const lift = Math.min(Math.ceil(n / 2), caps[j] - p.attrs[j])
      if (lift > 0) p.attrs[j] += lift
    }
    parts.push(`${ATTR_CN[j]}的瓶颈 ${before} → ${caps[j]}`)
  }
  recomputeOverall(p)
  settle(state, p, bn)
  const moved = p.overall > ovr0 ? `，综合 ${ovr0} → ${p.overall}` : ''
  say(state, 'good', `瓶颈松动 · ${reason}${parts[0]}${parts.length > 1 ? `，连带${parts.slice(1).join('、')}` : ''}。综合上限 ${pot0} → ${p.potential}${moved}。`)
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

  // the rest count only while the ceiling is there: leave it and the count starts over
  const add = (k: K, n: number) => {
    if (!pinned(k)) { bn.count[k] = 0; return }
    if (n > 0) bn.count[k] = (bn.count[k] ?? 0) + n
  }
  add('reaction', me.plan.ranked ?? 0)
  add('awareness', me.plan.vod ?? 0)
  add('utility', me.plan.util ?? 0)
  add('teamwork', me.phase === 'pro' ? me.plan.scrim ?? 0 : 0)
  add('clutch', Math.max(0, p.career.clutches - bn.clutchMark))
  add('igl', me.phase === 'pro' && p.isIgl ? Math.max(0, p.career.maps - bn.mapsMark) : 0)
  bn.clutchMark = p.career.clutches
  bn.mapsMark = p.career.maps

  const fresh = ATTR_KEYS.filter((k) => pinned(k) && !bn.pinned.includes(k) && caps[k] < CAP_HARD)
  if (fresh.length) say(state, 'info', `${fresh.map((k) => `${ATTR_CN[k]} ${p.attrs[k]}`).join('、')} 练到瓶颈了：再练不涨，最多先存 ${BANK_POINTS} 点，瓶颈一开就兑现。怎么破，「我的」页上写着。`)

  for (const k of ATTR_KEYS) {
    const P = BREAK_PATHS[k]
    if (!chasing(state, k) || !P.done(state)) continue
    breakthrough(state, k, P.value, P.reason, 'mech', P.key)
    if (k === 'aim') bn.aimStreak = 0
    bn.count[k] = 0
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

/** A professional season behind you loosens the experience ceilings by one, up to CAP_EXP_MAX — 破晓's 经验顶瓶颈. */
export function bottleneckSeason(state: GameState, played: boolean): void {
  const bn = ensureCeilings(state)
  const me = state.me
  if (!bn || !me || !played || bn.exp >= CAP_EXP_MAX) return
  const p = state.players[me.id]
  bn.exp++
  for (const k of SEASON_LOOSENS) p.caps![k] = Math.min(CAP_HARD, p.caps![k] + 1)
  for (const k of SEASON_LOOSENS) rollBanked(p, k)
  settle(state, p, bn)
  say(state, 'good', `又打完一个职业赛季，越打越老练：${SEASON_LOOSENS.map((k) => ATTR_CN[k]).join('、')}的瓶颈各松了 1 点（第 ${bn.exp} 次，最多 ${CAP_EXP_MAX} 次）。枪法、反应和道具要靠练。`)
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
