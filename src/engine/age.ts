import { clamp } from './rng'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player } from './types'

/**
 * 年龄：长得多快，和什么时候开始掉。
 *
 * One file, on purpose. The author, 2026-09-20:
 *
 *  - 「我需要一些数值随年龄下降的更明显一些，不能三十岁了还是枪法大师这样。
 *     然后开始下滑的年龄早一些」
 *  - 「如果练习的勤奋或者在对应项目的天赋好那就下滑慢一点或者稳定住，
 *     但是随着年龄增大怎么样最终都会是下滑的」
 *  - 「年轻的时候提升的快一点，老了就慢一点」
 *
 * Those are one shape, not three rules: what a week of work buys falls away
 * (TRAIN_KNOTS) while what time takes grows (FALL_AT_TURN, FALL_RAMP), each
 * attribute on its own clock (TURN). A career peaks where the two cross and
 * comes down after it. Everything either curve is made of is a named constant
 * at the top of this file, so the shape can be re-tuned without hunting
 * through the engine; the two places that used to carry their own copy of the
 * age table (engine/training.ts trainPlayer, engine/me/growth.ts gainBase) now
 * read this one.
 *
 * What it replaced, for the record: a single number for all eight
 * (ageDrift: ≤21 +1.0 · ≤24 +0.65 · ≤26 +0.3 · 27–28 −0.25 · 29–30 −0.9 ·
 * 31+ −1.6), and a four-step training table that went flat at 0.45 from 27
 * onward — so being 34 was worth exactly as much as being 27, and a 33-year-old
 * kept the hands of a 26-year-old (measured 2026-09-20: 枪法 lost 3.5 points
 * between 27 and 33).
 */

type K = keyof Attrs

const lerp = (knots: [number, number][], x: number): number => {
  if (x <= knots[0][0]) return knots[0][1]
  const last = knots[knots.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]
    if (x > x1) continue
    const [x0, y0] = knots[i - 1]
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return last[1]
}

// ---------------------------------------------------------------- 长：一周的训练，在这个年龄值多少

/**
 * What one week of practice is worth at this age.
 *
 * Peaks at 17 and under (1.75), halves at 24 (0.82), a quarter of the peak at
 * 28½ (0.44), and reaches zero at 33 — past there nothing a body is told
 * sticks, and only what a career already knows keeps rising (LATE_GAIN).
 *
 * Calibrated 2026-09-20 to move the same total earlier rather than to take it
 * away: the area under 18–30 was 11.55 on the old four-step table
 * (≤20 1.35 · ≤23 1.1 · ≤26 0.8 · 27+ 0.45, flat forever) and is 10.97 here,
 * 5% less. What changed is the tilt — 17 is worth 30% more than it was, 31 is
 * worth a third of what it was.
 */
export const TRAIN_KNOTS: [number, number][] = [[17, 1.75], [20, 1.30], [24, 0.82], [28, 0.37], [31, 0.15], [33, 0]]

/** 17: 1.75 · 20: 1.30 · 24: 0.82 · 27: 0.45 · 30: 0.22 · 33 and past it: 0 */
export const trainAgeMul = (age: number): number => lerp(TRAIN_KNOTS, age)

// ---------------------------------------------------------------- 掉：每一项自己的拐点

/**
 * The winter an attribute starts going the other way.
 *
 * The hands go first and reading the game goes last, which is the shape of
 * every real career: 「不能三十岁了还是枪法大师」. Reaction is the earliest
 * because it is the one nobody trains back.
 *
 * Moved a year earlier on the author's call the same day — 「下滑的太晚了，统一
 * 减少一岁」 — keeping the order and the spacing. The old single turn for all
 * eight was 27.
 */
export const TURN: Record<K, number> = {
  reaction: 24, aim: 25, clutch: 26, teamwork: 27, utility: 27, awareness: 29, communication: 29, igl: 30,
}

/** points the attribute loses in the winter it turns (an expectation, not a roll) */
export const FALL_AT_TURN: Record<K, number> = {
  reaction: 0.55, aim: 0.50, clutch: 0.35, teamwork: 0.28, utility: 0.28, awareness: 0.22, communication: 0.20, igl: 0.16,
}

/** and how much steeper each further year is — the reason a career ends rather than plateaus */
export const FALL_RAMP: Record<K, number> = {
  reaction: 0.28, aim: 0.26, clutch: 0.16, teamwork: 0.13, utility: 0.13, awareness: 0.11, communication: 0.10, igl: 0.08,
}

/** the most one winter can take off one attribute */
export const FALL_MAX = 3

/**
 * Between LATE_FROM and its own turn, what a season teaches anyway.
 *
 * This is the old 「25 岁以上每年涨意识（会指挥的还涨指挥）」 block from
 * seasonRollover, folded in here so the growing and the falling are one curve
 * instead of two rules arguing: that block had no turn of its own, so a
 * veteran gained 意识 every winter for ever.
 */
export const LATE_GAIN: Partial<Record<K, number>> = {
  awareness: 0.35, communication: 0.25, igl: 0.40, teamwork: 0.20, utility: 0.15,
}

/**
 * The age from which only what a season teaches still rises — the 「他的枪不行了
 * 但他会打」 window. It moved down with the turns (25, not 26), so the window
 * keeps the same shape relative to each of them; 反应 turns at 24, before it, so
 * there is no collision to resolve.
 */
export const LATE_FROM = 25

/** before that, all eight rise together: ≤21 · ≤23 · 24 */
export const GROW: [number, number][] = [[21, 1.00], [23, 0.62], [24, 0.28]]

/**
 * What this winter does to one attribute, in points, before the player's own
 * work and talent are allowed to hold it off (holdOff). Positive is growth.
 * The turn always wins: past TURN[k] the number is negative, whatever the age
 * bands say.
 */
export function attrDrift(p: Pick<Player, 'age' | 'isIgl'>, k: K): number {
  const turn = TURN[k]
  if (p.age >= turn) return -Math.min(FALL_MAX, FALL_AT_TURN[k] + (p.age - turn) * FALL_RAMP[k])
  if (p.age >= LATE_FROM) {
    // 指挥 only keeps rising for the man who actually calls
    if (k === 'igl' && !p.isIgl) return 0
    return LATE_GAIN[k] ?? 0
  }
  for (const [upTo, v] of GROW) if (p.age <= upTo) return v
  return 0
}

// ---------------------------------------------------------------- 压慢，但压不成正的

/** the share of a winter's fall that the work he is putting in holds off */
export const HOLD_WORK = 0.30
/** and the share that being built for it holds off */
export const HOLD_TALENT = 0.40
/**
 * Together, never more than this. Under 1 on purpose: the author's rule is
 * 「下滑慢一点或者稳定住……但随着年龄增大怎么样最终都会是下滑的」, so the slope can
 * be flattened to 30% — years where nothing visibly moves — and can never be
 * turned positive. FALL_RAMP makes it steeper every year regardless, so the
 * hold always loses in the end.
 */
export const HOLD_MAX = 0.70
/** ±9 points around his own average spans the whole 0…1 of 「this is his thing」 */
export const TALENT_SPREAD = 18

/**
 * How much of this winter's fall in `k` this player holds off, 0 to HOLD_MAX.
 *
 * Two signals, both already in the save:
 *  - what he is working on — the club's programme for him, which for the
 *    career's own player is his own week board (me/week.ts writes
 *    state.training[me.id] from me/growth.ts primaryFocus)
 *  - and what he is built for — his own ceilings where he carries them
 *    (me/bottleneck.ts, i.e. the career player's 天赋), his own shape otherwise
 */
export function holdOff(state: GameState, p: Player, k: K): number {
  const work = state.training?.[p.id] === k ? 1 : 0
  const ref = (p.caps ?? p.attrs) as Record<K, number>
  const mean = ATTR_KEYS.reduce((s, j) => s + ref[j], 0) / ATTR_KEYS.length
  const talent = clamp((ref[k] - mean) / TALENT_SPREAD + 0.5, 0, 1)
  return Math.min(HOLD_MAX, HOLD_WORK * work + HOLD_TALENT * talent)
}

/**
 * The eight read as one number, for the lines that only ask 「which way is this
 * age going」: the birthday note (me/life.ts ageSign) and the 我的 page's
 * ageing line (me/growth.ts ageNote). Takes an age alone, so it is the plain
 * average of the eight with nobody's shape in it.
 */
export function ageDrift(p: Pick<Player, 'age'>): number {
  const q = { age: p.age, isIgl: true }
  return ATTR_KEYS.reduce((s, k) => s + attrDrift(q, k), 0) / ATTR_KEYS.length
}

/** The first age at which this attribute is going down — what the help text and the checks quote. */
export const turnOf = (k: K): number => TURN[k]
