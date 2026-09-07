import { clamp } from '../rng'
import type { GameState } from '../types'
import { traitMul } from './traits'

/** heat leaves a tenth a week; the following only climbs toward what results allow */
export const HEAT_DECAY = 0.90

export const FAN_TIERS: { at: number; name: string }[] = [
  { at: 3500, name: '这个项目的门面' },
  { at: 2000, name: '出圈了' },
  { at: 900, name: '全网知名' },
  { at: 350, name: '平台头部' },
  { at: 120, name: '有固定观众' },
  { at: 45, name: '直播间几十个人' },
  { at: 0, name: '无人问津' },
]

export const fanTier = (fans: number) => FAN_TIERS.find((t) => fans >= t.at) ?? FAN_TIERS[FAN_TIERS.length - 1]

/** the number people would actually say — 万 */
export const fansWan = (fans: number): number => Math.pow(Math.max(0, fans), 1.548) / 551

export const fansCn = (fans: number): string => {
  const w = fansWan(fans)
  return w >= 100 ? `${Math.round(w)} 万` : w >= 1 ? `${w.toFixed(1)} 万` : `${Math.round(w * 10000)} 人`
}

/** What results allow: a ceiling the following creeps toward. */
export function fanCap(state: GameState): number {
  const me = state.me!
  const regional = me.titles.filter((t) => !/Masters|Champions/.test(t.title)).length
  const masters = me.titles.filter((t) => /Masters/.test(t.title)).length
  const champs = me.titles.filter((t) => /Champions/.test(t.title)).length
  const cups = me.pre.cups.reduce((s, c) => s + (c.won ? 35 : c.reached * 8), 0)
  const starts = me.seasons.reduce((s, x) => s + x.starts, 0) + me.seasonStart.starts
  let cap = 120 + me.pre.ladderPeak * 1.5 + cups + Math.min(starts, 200) * 2.0 +
    regional * 520 + masters * 1150 + champs * 2300 + (me.stream.deal ? 180 : 0)
  if (me.abroad) cap *= 0.82
  return cap
}

export function fanWeek(state: GameState): void {
  const me = state.me!
  const cap = fanCap(state)
  const pro = me.phase === 'pro'
  let rate = (pro ? 0.012 : 0.055) + clamp(me.heat / 900, 0, 0.045)
  rate *= traitMul(me, 'fan')
  if (me.stream.deal) rate *= 1.25
  const gap = cap - me.fans
  me.fans = Math.max(0, me.fans + gap * (gap > 0 ? rate : 0.02))
  me.heat = Math.max(0, me.heat * HEAT_DECAY)
}

export function addHeat(state: GameState, n: number): void {
  const me = state.me!
  me.heat = Math.max(0, me.heat + n)
  if (n < 0) me.fans = Math.max(0, me.fans + n * 0.3)
}
