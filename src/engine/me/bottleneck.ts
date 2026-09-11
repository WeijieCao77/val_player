import { clamp } from '../rng'
import { ATTR_CN, ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player } from '../types'
import { recomputeOverall, refreshValue, weightsFor } from '../player'
import { pushLog } from './log'
import type { BottleneckState, LogKind } from './types'

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
 * What is ours. Attributes here are whole points, so ceilings are whole points.
 * And this game already priced every career on one number, `potential` — the
 * overall he can reach. The eight ceilings are that headroom split across the
 * attributes by √weight of the role, so a duelist's 枪法 gets the most room
 * and his 指挥 the least; the overall ceiling is where it was. What changes is
 * that it can no longer all be poured into one attribute: measured before the
 * port, the steady plan had a duelist's 枪法 at 99 by 21 while his 沟通 had
 * moved one point. `potential` stays the engine's number and is re-derived
 * from the ceilings whenever one moves, so scouting, wages and the club's own
 * training keep reading what they always read.
 */

export const CAP_HARD = 99
/** points a path you work at can open, per attribute (破晓's CAP_MECH_MAX) */
export const CAP_MECH_MAX = 6
/** points milestones can open, per attribute — apart, so the grind cannot eat a trophy's share */
export const CAP_MILE_MAX = 7
/** professional seasons that each loosen all eight by one */
export const CAP_EXP_MAX = 5
/** a club this strong teaches by being in the room */
export const STRONG_TEAM = 84
/** old enough to have seen most of it */
export const VET_AGE = 27

type K = keyof Attrs

/** The overall before recomputeOverall rounds it. */
function rawOverall(p: Player): number {
  const w = weightsFor(p)
  return ATTR_KEYS.reduce((s, k) => s + p.attrs[k] * w[k], p.stageBonus ?? 0)
}

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

/** Sitting at the ceiling: more hours only fill the bar. */
export const atCeiling = (p: Player, k: K): boolean => p.attrs[k] >= ceilingsOf(p)[k]

/** The overall the eight ceilings add up to — what the attribute card calls 上限. */
export function ceilingPotential(p: Player, caps: Record<K, number> = ceilingsOf(p)): number {
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
    mech: {}, mile: {}, exp: 0, seen: [], count: {}, aimStreak: 0,
    clutchMark: p.career.clutches, mapsMark: p.career.maps,
    pinned: ATTR_KEYS.filter((k) => !!p.caps && p.attrs[k] >= p.caps[k]),
    pot: p.potential,
  }
}

/**
 * The career's player gets his ceilings if he has none — a new career, or a
 * save from before they existed — and the book that counts toward breaking
 * them. Safe to call every week.
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
  return me.bottleneck
}

function say(state: GameState, kind: LogKind, text: string): void {
  pushLog(state, kind, text)
  state.me!.weekNotes.push(text)
}

/** A bar that filled while it waited at the ceiling turns into its point the moment the ceiling moves. */
function rollBanked(p: Player, k: K): void {
  if (!p.caps || (p.xp[k] ?? 0) < 100 || p.attrs[k] >= p.caps[k]) return
  p.xp[k] = (p.xp[k] ?? 0) - 100
  p.attrs[k] += 1
  recomputeOverall(p)
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
  gain: number
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
const playedIntl = (state: GameState) => state.me!.matches.some((m) => m.started && /Masters|Champions/.test(m.comp))

/**
 * Every attribute's own way through, 破晓's BREAK_PATHS on this game's eight.
 * The practice ones follow the week board — each attribute breaks on the
 * action that trains it — and count only once the ceiling is reached, the fix
 * 破晓 had to make after 「操作 80/92 随便练三周也弹突破」. 枪法 is the grind,
 * as 操作 was: weeks in a row. 残局 and 沟通 are situations, as 心态 and 指挥
 * were, and pay once; after that their ceilings open only on milestones.
 */
export const BREAK_PATHS: Record<K, BreakPath> = {
  aim: {
    how: '连续 3 周，每周至少安排 2 次枪法训练', gain: 2,
    reason: '连着三周把时间砸在练枪软件和死斗里，手上的东西磨出来了。',
    prog: (s) => `连续 ${upTo(s.me!.bottleneck?.aimStreak ?? 0, 3)} 周`,
    done: (s) => (s.me!.bottleneck?.aimStreak ?? 0) >= 3,
  },
  reaction: {
    how: '卡在瓶颈上以后，打满 12 次排位', gain: 2,
    reason: '一把接一把的对枪，把你的反应逼快了。',
    prog: (s) => `${upTo(counted(s, 'reaction'), 12)} 次`,
    done: (s) => counted(s, 'reaction') >= 12,
  },
  awareness: {
    how: '卡在瓶颈上以后，复盘满 6 次', gain: 2,
    reason: '泡在录像里的这些天，你看比赛的方式变了。',
    prog: (s) => `${upTo(counted(s, 'awareness'), 6)} 次`,
    done: (s) => counted(s, 'awareness') >= 6,
  },
  utility: {
    how: '卡在瓶颈上以后，练满 6 次道具与跑图', gain: 2,
    reason: '每个点位的道具都丢过上百遍，现在闭着眼也知道落在哪。',
    prog: (s) => `${upTo(counted(s, 'utility'), 6)} 次`,
    done: (s) => counted(s, 'utility') >= 6,
  },
  clutch: {
    how: '卡在瓶颈上以后，在正赛里赢下 5 个残局；或者拿一次冠军', gain: 3, key: 'clutch',
    reason: '最后一个人交到你手上的时候，你已经不慌了。',
    prog: (s) => `残局 ${upTo(counted(s, 'clutch'), 5)}`,
    done: (s) => counted(s, 'clutch') >= 5 || s.me!.titles.some((t) => t.started),
  },
  teamwork: {
    how: '卡在瓶颈上以后，打满 4 次跟队训练赛', gain: 2, pro: true,
    reason: '一起打了这么多训练赛，你知道队友下一步会站在哪。',
    prog: (s) => `${upTo(counted(s, 'teamwork'), 4)} 次`,
    done: (s) => counted(s, 'teamwork') >= 4,
  },
  communication: {
    how: `和 ${VET_AGE} 岁以上的老将同队、待在实力 ${STRONG_TEAM} 以上的强队，或者打过国际赛`, gain: 2, pro: true, key: 'commenv',
    reason: '这一年你身边的人和场面，把你说话的方式改了。',
    prog: (s) => {
      const v = veteranOf(s)
      return v ? `队里有 ${v.ign}` : strongClub(s) ? '待在强队' : playedIntl(s) ? '打过国际赛' : '还没有'
    },
    done: (s) => !!veteranOf(s) || strongClub(s) || playedIntl(s),
  },
  igl: {
    how: '卡在瓶颈上以后，以队里指挥的身份打满 8 张图', gain: 2, pro: true,
    reason: '喊了这么多回合，你知道什么时候该开口、说到哪一句就够了。',
    prog: (s) => (s.players[s.me!.id]?.isIgl ? `${upTo(counted(s, 'igl'), 8)} 张图` : '你现在不是队里的指挥'),
    done: (s) => counted(s, 'igl') >= 8,
  },
}

/** Why this attribute's own path can no longer open anything, or null — said on the card, never left to be found out. */
export function pathDead(state: GameState, k: K): string | null {
  const me = state.me!
  const p = state.players[me.id]
  if (ceilingsOf(p)[k] >= CAP_HARD) return `已经到 ${CAP_HARD}，这是所有人的终点，没有再往上的路`
  const bn = me.bottleneck
  if ((bn?.mech[k] ?? 0) >= CAP_MECH_MAX) return '练出来的那一截已经到头——再往上要靠冠军这样的时刻'
  const key = BREAK_PATHS[k].key
  if (key && bn?.seen.includes(key)) return '这条路已经走过一次——再往上要靠冠军这样的时刻'
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
 * Open a ceiling. A keyed source counts once. Each pool gives one point less
 * per source once it is half used, 破晓's diminishing room in whole points,
 * so a repeatable grind cannot run the pool through. A milestone that finds
 * nothing left to open still says so: a trophy that moves nothing in silence
 * is worse than no line at all.
 */
export function breakthrough(state: GameState, k: K, n: number, reason: string, kind: 'mech' | 'mile', key?: string): number {
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
  if (caps[k] >= CAP_HARD) {
    if (kind === 'mile') say(state, 'info', `${reason}——${cn}已经到 ${CAP_HARD}，没有再往上的空间了。`)
    return 0
  }
  const pool = kind === 'mile' ? bn.mile : bn.mech
  const max = kind === 'mile' ? CAP_MILE_MAX : CAP_MECH_MAX
  const used = pool[k] ?? 0
  const want = used >= max / 2 ? Math.max(1, n - 1) : n
  const got = Math.max(0, Math.min(want, max - used, CAP_HARD - caps[k]))
  if (got <= 0) {
    if (kind === 'mile') say(state, 'info', `${reason}——${cn}的瓶颈已经被经历顶到头了，再往上的路只属于天赋。`)
    return 0
  }
  const before = caps[k]
  caps[k] += got
  pool[k] = used + got
  rollBanked(p, k)
  settle(state, p, bn)
  say(state, 'good', `瓶颈松动 · ${reason}${cn}的瓶颈 ${before} → ${caps[k]}。`)
  return got
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
  // ceiling. A broken streak is said out loud — silence reads as 「练了没算」.
  const aimed = me.plan.aim ?? 0
  const was = bn.aimStreak
  const chaseAim = chasing(state, 'aim')
  bn.aimStreak = aimed >= 2 ? was + 1 : 0
  if (chaseAim && aimed >= 2 && bn.aimStreak < 3) say(state, 'info', `冲击枪法瓶颈：这周练了 ${aimed} 次，连续 ${bn.aimStreak}/3 周。`)
  else if (chaseAim && aimed < 2 && was > 0) say(state, 'bad', `冲击枪法瓶颈断了：这周只练了 ${aimed}/2 次，连续的周数清零。`)

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
  if (fresh.length) say(state, 'info', `${fresh.map((k) => `${ATTR_CN[k]} ${p.attrs[k]}`).join('、')} 练到瓶颈了：再练只会把那一格攒满。怎么破，「我的」页上写着。`)

  for (const k of ATTR_KEYS) {
    const P = BREAK_PATHS[k]
    if (!chasing(state, k) || !P.done(state)) continue
    breakthrough(state, k, P.gain, P.reason, 'mech', P.key)
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
    breakthrough(state, 'communication', 2, `在 ${team.name} 这样的队里待着，训练里每个人说话都有分量。`, 'mech', 'strong:communication')
    breakthrough(state, 'awareness', 1, '高强度的训练赛把你的判断磨快了。', 'mech', 'strong:awareness')
  }
  const vet = veteranOf(state)
  if (vet) breakthrough(state, 'communication', 1, `${vet.ign} 在复盘里把他这些年的东西讲给了你。`, 'mech', `vet:${vet.id}`)
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

/** A trophy I was on the floor for opens the ceilings that big nights are about, from the milestone pool. */
export function bottleneckTitle(state: GameState, title: string): void {
  if (/Champions/.test(title)) {
    breakthrough(state, 'clutch', 3, '你在世界最高的舞台上赢过一次，没有什么再能让你手抖。', 'mile')
    breakthrough(state, 'communication', 3, '世界冠军喊的每一句，队友都愿意跟。', 'mile')
  } else if (/Masters/.test(title)) {
    breakthrough(state, 'clutch', 2, '大师赛的领奖台你站上去过了，大场面再也吓不到你。', 'mile')
    breakthrough(state, 'communication', 2, '拿过国际冠军的人说话，队友会听。', 'mile')
  } else {
    breakthrough(state, 'clutch', 2, '捧过一次奖杯之后，大场面对你来说不一样了。', 'mile', 'lgtitle')
  }
}
