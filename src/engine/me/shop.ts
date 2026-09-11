import { clamp } from '../rng'
import type { GameState } from '../types'
import { pushLog } from './log'
import { addMoney } from './money'

/**
 * Where the money goes. The rule from 破晓: nothing here turns money into the
 * eight directly — gear and courses buy training speed, calm and access, and
 * even those stop at the second tier.
 */
export const GEAR_SLOTS: { key: string; name: string }[] = [
  { key: 'mouse', name: '鼠标' }, { key: 'keyboard', name: '键盘' }, { key: 'headset', name: '耳机' },
  { key: 'monitor', name: '显示器' }, { key: 'chair', name: '椅子' },
]
/** price by tier (1, 2) */
export const GEAR_PRICE = [0, 900, 4200]
export const GEAR_TIER_CN = ['入门', '职业级', '旗舰']

/**
 * What each tier is on the desk: kit VCT players really buy, not a tier word —
 * 「这些外设没有代入感，要用一些真实的品牌和型号」 (2026-09-11). The effect is the
 * tier's; the name is what the player sees.
 */
export const GEAR_MODELS: Record<string, [string, string, string]> = {
  mouse: ['罗技 G102', '罗技 G PRO X SUPERLIGHT 2', '雷蛇 毒蝰 V3 Pro'],
  keyboard: ['雷柏 V500 PRO', '罗技 G PRO X TKL', 'Wooting 60HE+'],
  headset: ['HyperX Cloud Stinger 2', 'HyperX Cloud III', '罗技 G PRO X 2'],
  monitor: ['AOC 24G2 144Hz', 'ZOWIE XL2546K 240Hz', 'ZOWIE XL2586X 540Hz'],
  chair: ['西昊 M57', 'Secretlab TITAN Evo', 'Herman Miller × 罗技 G Embody'],
}
export const gearModel = (slot: string, tier: number): string => GEAR_MODELS[slot]?.[tier] ?? GEAR_TIER_CN[tier] ?? ''

export interface Course { key: string; name: string; price: number; blurb: string }
export const COURSES: Course[] = [
  { key: 'lang', name: '语言课', price: 5000, blurb: '去外赛区不再是问题，外赛区的报价权重也高。' },
  { key: 'psych', name: '运动心理', price: 8000, blurb: '心态 +5，气压对发挥的拖累减两成。' },
  { key: 'review', name: '复盘方法', price: 7000, blurb: '复盘的训练收益 ×1.25。' },
  { key: 'talk', name: '沟通表达', price: 6000, blurb: '羁绊涨得快三成，教练信任涨得快两成。' },
]

export interface Relax { key: string; name: string; price: number; fatigue: number; tilt: number; mental: number; once?: boolean; blurb: string }
export const RELAX: Relax[] = [
  { key: 'physio', name: '理疗', price: 400, fatigue: -18, tilt: -4, mental: 0, blurb: '不占行动点的恢复。' },
  { key: 'trip', name: '短途旅行', price: 2500, fatigue: -30, tilt: -20, mental: 1, blurb: '离开电脑两天。' },
  { key: 'flat', name: '电竞公寓', price: 20000, fatigue: 0, tilt: 0, mental: 0, once: true, blurb: '住得好，每周多回 3 点体力。' },
]

export const AGENTS: { tier: number; name: string; fee: number; cut: number; blurb: string }[] = [
  { tier: 0, name: '没有经纪人', fee: 0, cut: 0, blurb: '合同自己谈。' },
  { tier: 1, name: '普通经纪人', fee: 3000, cut: 0.05, blurb: '谈判底气 +6，转会窗多一家来问。' },
  { tier: 2, name: '金牌经纪人', fee: 15000, cut: 0.10, blurb: '底气 +12，外赛区的报价也带来，多两家来问。' },
]

export function buyGear(state: GameState, slot: string): string | null {
  const me = state.me!
  const cur = me.gear[slot] ?? 0
  if (cur >= 2) return `已经是${gearModel(slot, 2)}了。`
  const price = GEAR_PRICE[cur + 1]
  if (me.money < price) return `要 $${price.toLocaleString()}，钱不够。`
  addMoney(state, 'gear', -price)
  me.gear[slot] = cur + 1
  const name = GEAR_SLOTS.find((s) => s.key === slot)?.name ?? slot
  pushLog(state, 'money', `换了${name}：${gearModel(slot, cur + 1)}（${GEAR_TIER_CN[cur + 1]}，$${price.toLocaleString()}）。`)
  return null
}

export function buyCourse(state: GameState, key: string): string | null {
  const me = state.me!
  const c = COURSES.find((x) => x.key === key)
  if (!c) return '没有这门课。'
  if (me.courses.includes(key)) return '已经上过了。'
  if (me.money < c.price) return `要 $${c.price.toLocaleString()}，钱不够。`
  addMoney(state, 'course', -c.price)
  me.courses.push(key)
  if (key === 'lang') me.flags.lang = 1
  if (key === 'psych') me.mental = clamp(me.mental + 5, 0, 100)
  pushLog(state, 'money', `报了${c.name}（$${c.price.toLocaleString()}）。`)
  return null
}

export function buyRelax(state: GameState, key: string): string | null {
  const me = state.me!
  const p = state.players[me.id]
  const r = RELAX.find((x) => x.key === key)
  if (!r) return '没有这一项。'
  if (r.once && me.flags[`relax_${key}`]) return '已经有了。'
  if (me.money < r.price) return `要 $${r.price.toLocaleString()}，钱不够。`
  if (!r.once && me.relaxUsed >= 2) return '这周已经放松过两次了。'
  addMoney(state, 'relax', -r.price)
  if (r.once) me.flags[`relax_${key}`] = 1
  else me.relaxUsed++
  p.fatigue = clamp(p.fatigue + r.fatigue, 0, 100)
  me.tilt = clamp(me.tilt + r.tilt, 0, 100)
  me.mental = clamp(me.mental + r.mental, 0, 100)
  pushLog(state, 'money', `${r.name}（$${r.price.toLocaleString()}）${r.fatigue ? `，体力回了 ${-r.fatigue}` : ''}。`)
  return null
}

export function hireAgent(state: GameState, tier: number): string | null {
  const me = state.me!
  const a = AGENTS[tier]
  if (!a) return '没有这一档。'
  if (me.agentTier === tier) return '已经是这一档了。'
  if (tier > me.agentTier && me.money < a.fee) return `签约费 $${a.fee.toLocaleString()}，钱不够。`
  if (tier > me.agentTier) addMoney(state, 'agent', -a.fee)
  me.agentTier = tier
  pushLog(state, 'money', tier ? `签了${a.name}（$${a.fee.toLocaleString()}），以后抽你 ${Math.round(a.cut * 100)}% 的薪水。` : '和经纪人解约了。')
  return null
}

export const gearTrainMul = (gear: Record<string, number>): number =>
  1 + Object.values(gear).reduce((s, t) => s + t * 0.008, 0)
export const courseMul = (courses: string[], key: string, mul: number): number => (courses.includes(key) ? mul : 1)
