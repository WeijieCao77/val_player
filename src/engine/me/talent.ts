import { clamp } from '../rng'
import type { Rng } from '../rng'
import { ATTR_KEYS } from '../types'
import type { Attrs, Player, Role } from '../types'
import type { EntryBands } from '../ruler'
import { recomputeOverall, weightsFor } from '../player'
import { originOf } from './origins'
import { TALENT_CAP_MAX, ceilingPotential } from './bottleneck'

/**
 * The new-career screen's numbers: the three doors, the twenty talent points,
 * and what a spread of them opens on and reaches. me/career.ts makes the career
 * and re-exports all of this; it lives apart because career.ts reaches the whole
 * world — every roster book, every circuit — and the page a new player opens on
 * must not fetch all of that before anyone has pressed 开始生涯 (reported
 * 2026-09-18, an outside audit: the home page downloaded about 8 MB before any
 * career was opened). What the screen needs from the world itself — which places
 * a year opens in, how many clubs a door is placed among, where that year's
 * starters stand — is worked out from the world when the site is built
 * (me/startSheet.ts).
 */

export const TALENT_POINTS = 20
export const TALENT_MAX = 8

export type StartPoint = 'pre' | 'chal' | 't1'
/**
 * A club start is a door, not a club to pick (asked 2026-09-12: 「这个出身选择就应该是直接从二队有俱乐部开始」):
 * the game assigns the club (me/career.ts pickClub), and the club shows once the career has started.
 */
/**
 * A door's card on the new-career screen: its name, one word for how hard it is, one line.
 *
 * The word is the whole of what the screen says about the difficulty (asked 2026-09-16:
 * 「开局的身份选择上不要写的那么多」). Measured over six seasons, the three doors differ in when you
 * reach a stage, not in how good you can get — the ceiling is the 天赋 and 出身: a ladder start is the
 * only one that opens with no club and took some five seasons to reach a VCT side, a 替补 start opens
 * on a league roster and took its first title in its first season. The detail is in 帮助「开局怎么选」.
 */
export interface StartCopy { name: string; tag: string; blurb: string }

export const START_CN: Record<StartPoint, StartCopy> = {
  pre: { name: '从天梯开始', tag: '挑战', blurb: '17 岁，没有队伍。排位、杯赛、试训，先拿到第一份合同。最长的路，也是完整的路。' },
  chal: { name: 'Challengers 二队', tag: '中等', blurb: '18 岁，一支俱乐部二队的首发：一线队的 Academy，赛区里没有就是一支 Challengers 俱乐部。' },
  t1: { name: 'VCT 替补', tag: '轻松', blurb: '18 岁，一级俱乐部的第六人。名单上有你，首发没有。' },
}

/** 2021 had no leagues and no academies to start in: the same three doors, as they were then. */
export const START_CN_2021: Record<StartPoint, StartCopy> = {
  pre: { name: '从天梯开始', tag: '挑战', blurb: '17 岁，没有队伍。2021 年没有联赛也没有青训体系：排位、网吧赛、试训，哪家看上你哪家就给合同。' },
  chal: { name: '二线队首发', tag: '中等', blurb: '18 岁，一支还没打出名堂的俱乐部的首发，开放海选一场场打上去。' },
  t1: { name: '强队替补', tag: '轻松', blurb: '18 岁，一支打进过赛区决赛的俱乐部的第六人。名单上有你，首发没有。' },
}

export const startCnOf = (year: number): Record<StartPoint, StartCopy> =>
  (year <= 2021 ? START_CN_2021 : START_CN)

export function emptyTalents(): Record<keyof Attrs, number> {
  return { aim: 3, reaction: 3, awareness: 3, utility: 3, clutch: 2, teamwork: 2, communication: 2, igl: 2 }
}

/** Nothing spent: the new-career screen opens here and the player spends all twenty (asked 2026-09-14: 「要把这个留给玩家去自己点天赋」). */
export function zeroTalents(): Record<keyof Attrs, number> {
  return { aim: 0, reaction: 0, awareness: 0, utility: 0, clutch: 0, teamwork: 0, communication: 0, igl: 0 }
}

/**
 * The new-career screen's starting builds, 破晓's 天赋预设: pick what kind of
 * player first, then tune. Each spends all twenty under TALENT_MAX. 均衡型 is
 * emptyTalents, the spread every script's career is built on.
 */
export const TALENT_PRESETS: { key: string; name: string; blurb: string; t: Record<keyof Attrs, number> }[] = [
  { key: 'gun', name: '枪法型', blurb: '对枪赢下来，这回合就是你的', t: { aim: 7, reaction: 6, awareness: 2, utility: 1, clutch: 3, teamwork: 1, communication: 0, igl: 0 } },
  { key: 'util', name: '道具型', blurb: '道具交得准，队友才打得进去', t: { aim: 3, reaction: 0, awareness: 5, utility: 7, clutch: 0, teamwork: 3, communication: 2, igl: 0 } },
  { key: 'clutch', name: '残局型', blurb: '一打多的时候比谁都冷静', t: { aim: 5, reaction: 3, awareness: 4, utility: 1, clutch: 7, teamwork: 0, communication: 0, igl: 0 } },
  { key: 'igl', name: '指挥型', blurb: '开麦报点、拿主意，全队跟着你的节奏', t: { aim: 2, reaction: 0, awareness: 4, utility: 1, clutch: 0, teamwork: 3, communication: 4, igl: 6 } },
  { key: 'even', name: '均衡型', blurb: '哪一项都不短，也没有一项特别突出', t: emptyTalents() },
]

/**
 * What a spread of talent means, in the screen's words (破晓's 「当前加点路线」):
 * judged by the share of the points spent that sit in the two biggest. Only
 * what the engine does is said: 综合 is the role's weighted sum with no penalty
 * for a short board, and a key round and a practice duel score the option's own
 * attribute against the other side's (me/nodes.ts, me/duel.ts). 指挥 and 沟通
 * are what the coach names his caller on, and the caller's 指挥 is what the
 * whole five plays on (me/igl.ts); 协同 and 沟通 are how the room takes a player
 * — how his bonds hold, whether a loss turns into an argument, his form, and a
 * close call for a place (engine/bonds.ts ease, me/room.ts). Rewritten
 * 2026-09-14 with both; the role weights are a separate task.
 */
export function talentShape(talents: Record<keyof Attrs, number>): { label: string; line: string } | null {
  const spent = ATTR_KEYS.reduce((s, k) => s + (talents[k] ?? 0), 0)
  if (!spent) return null
  const share = ATTR_KEYS.map((k) => talents[k] ?? 0).sort((a, b) => b - a).slice(0, 2).reduce((s, v) => s + v, 0) / spent
  const social = (talents.teamwork ?? 0) + (talents.communication ?? 0)
  const notes = [
    (talents.igl ?? 0) >= 4 && (talents.communication ?? 0) >= 3
      ? '指挥、沟通点得多：站稳首发、在队里待满一个赛段、教练信任你，他会让你当主指挥，全队按你的指挥来打；指挥本身几乎不算进综合'
      : '',
    social <= 2
      ? '协同、沟通几乎没点：和队友的关系掉得快，输了容易起争执，状态受影响，能力接近时教练先用合得来的人'
      : social >= 10 ? '协同、沟通点得多：和队友的关系稳，少起争执，状态好，能力接近时教练先用你' : '',
  ].filter(Boolean)
  const tail = notes.map((n) => `；${n}`).join('')
  if (share >= 0.7) return { label: '高度专精', line: `综合冲得最快；但关键回合和对位练习赛里，用到短板那一项的选项很难成功${tail}。` }
  if (share >= 0.45) return { label: '有侧重', line: `长项撑住综合，短板也不至于太短，关键回合里多数选项都能用${tail}。` }
  return { label: '很均衡', line: `哪一项都不拖后腿，关键回合里哪个选项都能用；代价是综合比专精的路线低一些${tail}。` }
}

/** The talent panel's line on the three that 综合 hardly counts, in what the engine does with them. */
export const TALENT_TEAM_HINT = '指挥：当上主指挥才上场起作用，全队按主指挥的指挥来打。协同、沟通：关键回合的配合选项、和队友的关系、输了比赛会不会起争执、状态，教练在能力接近的人里选首发时也看。'

/** The eight, the way the new-career screen previews them. */
export function buildAttrs(role: Role, talents: Record<keyof Attrs, number>, originKey: string, rng?: Rng): Attrs {
  const w = weightsFor({ role })
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 2)
  // no background picked yet (the new-career page previews before one is): none of a background's numbers
  const o = originKey ? originOf(originKey) : undefined
  const attrs = {} as Attrs
  for (const k of ATTR_KEYS) {
    // 52, not 58: a fresh player starts a clear step under every club's bar
    // and has to climb to it, the way 破晓 opens — see prepro.expectOf
    attrs[k] = clamp(52 + (talents[k] ?? 0) * 3 + (top.includes(k) ? 3 : 0) + (o?.attrs?.[k] ?? 0) + (rng ? rng.int(-1, 1) : 0), 40, 90)
  }
  // a rookie's 指挥 opens under a Challengers caller's (2026: p10 72): 62 until 2026-09-14, when the coach
  // could start naming him caller (me/igl.ts) and four talent points and eight were still the same 62
  attrs.igl = Math.min(attrs.igl, 66)
  return attrs
}

/** Where every talent ceiling starts; each point of talent is +3 on it, as on the start. */
export const CAP_BASE = 68

/**
 * The eight ceilings a talent gives, 破晓's 天赋上限 (cap = 57 + 4.3 × talent) on
 * this game's eight: +3 a point, the role's two heaviest +3, the origin's lean
 * on top, a late start a little lower. Held under TALENT_CAP_MAX, so a maxed
 * 枪法 still has a path to break on the first day. The random head a new
 * career used to roll is gone: the screen that sets the talent can say exactly
 * where it leads.
 */
export function talentCeilings(role: Role, talents: Record<keyof Attrs, number>, originKey: string): Record<keyof Attrs, number> {
  const w = weightsFor({ role })
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 2)
  const o = originOf(originKey)
  const caps = {} as Record<keyof Attrs, number>
  for (const k of ATTR_KEYS) {
    caps[k] = clamp(CAP_BASE + (talents[k] ?? 0) * 3 + (top.includes(k) ? 3 : 0) + (o.attrs?.[k] ?? 0) - (o.flags?.late ? 4 : 0), 50, TALENT_CAP_MAX)
  }
  return caps
}

/**
 * 综合 a career that works at its ceilings opens on top of its talent: practice
 * paths, a strong club, its seasons, a trophy. Measured over twelve seasons from
 * 2026 (three starts, the steady plan and a player who chases every path): the
 * eight ceilings ended 8 to 11 above where the talent put them.
 */
export const BREAK_REACH = 9

export interface CeilingPreview {
  /** the 综合 he starts on */
  start: number
  /** what his talent's eight ceilings add up to */
  talent: number
  /** and where breaking them takes a career that works at it */
  reach: number
  /** where the starters of the entry year stand, on the world's ruler (engine/ruler.ts) */
  bands: EntryBands
}

/**
 * The new-career screen's ceiling, computed rather than typed in. `bands` is the
 * entry year's (engine/ruler.ts entryBands), as the site was built with it
 * (me/startSheet.ts): the screen does not load the world to read them.
 */
export function ceilingPreview(role: Role, talents: Record<keyof Attrs, number>, originKey: string, bands: EntryBands): CeilingPreview {
  const attrs = buildAttrs(role, talents, originKey)
  const start = recomputeOverall({ role, attrs, stageBonus: 0 } as Player)
  const caps = talentCeilings(role, talents, originKey)
  const talent = ceilingPotential({ role, attrs, stageBonus: 0 }, caps)
  return { start, talent, reach: Math.min(99, talent + BREAK_REACH), bands }
}

/**
 * What the talent panel says about it: in words when `word` is given (the
 * default screen), in figures under the 数值 switch. The ceiling is never put
 * beside a starter's number on its own — what breaking it adds is part of it
 * (reported 2026-09-12: 「上限79但是首发选手中位数为81，这儿明显不合理，那玩家还玩什么」).
 */
export function ceilingLines(c: CeilingPreview, year: number, word?: (v: number) => string): { tag: string; hint: string } {
  const top = year <= 2021 ? '打进过赛区决赛的俱乐部' : '一级联赛'
  const sub = year <= 2021 ? '只打过海选的俱乐部' : 'Challengers '
  if (word) {
    return {
      tag: `起点${word(c.start)} · 天赋能摸到${word(c.talent)}，破瓶颈能到${word(c.reach)}`,
      hint: `每点天赋起点 +3、天花板 +3。${top}首发大多${word(c.bands.top)}，${sub}首发大多${word(c.bands.sub)}，世界前十是${word(c.bands.star)}。天花板之上靠破瓶颈：苦练、强队、打满赛季、冠军和决赛 MVP。`,
    }
  }
  return {
    tag: `起点 ${c.start} · 天赋上限 ${c.talent} · 破瓶颈能到 ${c.reach}`,
    hint: `每点天赋起点 +3、天花板 +3。${top}首发中位数 ${c.bands.top}，${sub}首发中位数 ${c.bands.sub}，世界前十从 ${c.bands.star} 起（${year <= 2021 ? 2021 : 2026} 年开季的真实数据）。天花板之上靠破瓶颈：苦练、强队、打满赛季、冠军和决赛 MVP。`,
  }
}
