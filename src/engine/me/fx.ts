import { Rng, clamp } from '../rng'
import type { GameState } from '../types'
import { duoBonded } from '../bonds'
import { addXp } from './growth'
import { addMoney } from './money'
import type { EffectSpec } from './types'
import { ATTR_CN } from '../types'

/**
 * One place that turns "what happened" into numbers, so an event, a quest and
 * a trait all change the same things the same way — and every change comes
 * back as a line the player can read.
 */
export function applyEffect(state: GameState, e: EffectSpec, rng?: Rng): string[] {
  const me = state.me
  if (!me) return []
  const p = state.players[me.id]
  const out: string[] = []
  const r = rng ?? new Rng((state.seed ^ state.day ^ 0x9e37) >>> 0)
  const num = (v: number, unit = '') => `${v > 0 ? '+' : ''}${Math.round(v)}${unit}`
  // the lines read the way the option said it would (events.ts describeEffect)
  if (e.money) { addMoney(state, e.money > 0 ? 'inother' : 'outother', e.money); out.push(`${e.money > 0 ? '+' : '−'}$${Math.abs(Math.round(e.money)).toLocaleString('en-US')}`) }
  if (e.heat) { me.heat = Math.max(0, me.heat + e.heat); out.push(e.heat > 0 ? '涨热度' : '热度降') }
  if (e.fans) { me.fans = Math.max(0, me.fans + e.fans); out.push(e.fans > 0 ? '涨粉' : '掉粉') }
  if (e.tilt) { me.tilt = clamp(me.tilt + e.tilt, 0, 100); out.push(e.tilt < 0 ? '放松' : '上火') }
  if (e.mental) { me.mental = clamp(me.mental + e.mental, 0, 100); out.push(`心态 ${num(e.mental)}`) }
  if (e.body) { me.body = clamp(me.body + e.body, 0, 100); out.push(`体质 ${num(e.body)}`) }
  if (e.fatigue && p) { p.fatigue = clamp(p.fatigue + e.fatigue, 0, 100); out.push(`体力 ${num(-e.fatigue)}`) }
  if (e.form && p) { p.form = clamp(p.form + e.form, 30, 99); out.push(`状态 ${num(e.form)}`) }
  if (e.morale && p) { p.morale = clamp(p.morale + e.morale, 10, 100); out.push(e.morale > 0 ? '士气涨' : '士气降') }
  if (e.coachTrust) { me.coachTrust = clamp(me.coachTrust + e.coachTrust, 0, 100); out.push(`教练信任 ${num(e.coachTrust)}`) }
  if (e.gmTrust) { me.gmTrust = clamp(me.gmTrust + e.gmTrust, 0, 100); out.push(`经理信任 ${num(e.gmTrust)}`) }
  if (e.bond && me.phase === 'pro') {
    const mates = (state.teams[state.myTeam]?.roster ?? []).filter((id) => id !== me.id)
    if (mates.length) {
      const who = mates[r.int(0, mates.length - 1)]
      duoBonded(state, me.id, who, e.bond)
      out.push(`和 ${state.players[who]?.ign ?? '队友'} 的关系 ${num(e.bond)}`)
    }
  }
  if (e.xp && p) {
    for (const [k, v] of Object.entries(e.xp) as [keyof typeof ATTR_CN, number][]) {
      const rose = addXp(p, k, v)
      // the bar under each attribute: 100% is one more point
      out.push(rose ? `${ATTR_CN[k]} 涨到 ${p.attrs[k]}` : `${ATTR_CN[k]} ${num(v, '%')}（攒满 100% 涨 1 点）`)
    }
  }
  if (e.ladder) { me.pre.ladder = clamp(me.pre.ladder + e.ladder, 0, 100); out.push(`天梯 ${num(e.ladder)}`) }
  if (e.scoutSeen) { me.pre.scoutSeen += e.scoutSeen; out.push('有俱乐部记下了你') }
  if (e.note) out.push(e.note)
  return out
}
