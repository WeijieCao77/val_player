import { clamp } from '../rng'
import type { GameState } from '../types'
import { pushLog } from './log'
import { addMoney } from './money'
import { injuryRelax } from './injury'
import { cny } from './moneyfmt'
import { sealWeek } from './undo'

/**
 * Where the money goes. The rule from 破晓, and the author's: money does not buy
 * strength. Gear and courses buy comfort, calm and fewer lay-offs; recovery
 * brings a body back from a hard week; none of it buys an hour of practice or a
 * point of the eight.
 *
 * Money still reached the match and the ceilings, found by measuring rather
 * than reading (2026-09-11, 「钱通过商城转成属性影响夺冠」): every tier of gear
 * added to the odds of every call in every match; every short trip added a
 * point of 心态 for good; and the training speed the kit and courses sold got a
 * player to his ceilings sooner, where the break paths count (me/bottleneck.ts)
 * — +0.9 of peak overall, paired against the same careers never buying. The
 * first two went and the speed was halved.
 *
 * Measured again 2026-09-14 (scripts/probe_buy.ts: 托管's steady week, a
 * Challengers start, 8 seasons, the same seeds buying everything and nothing):
 * still +1.0 of peak overall, and 理疗 with short trips did all of it on their
 * own — fatigue taken off for free, so the steady plan swapped 228 hours of rest
 * for 146 of practice. Gear, 复盘方法, the flat, the agent and the other courses
 * each measured as nothing. So paid recovery stops at RELIEF_FLOOR: it brings a
 * body back from a hard week, never under where an ordinary week ends; and the
 * speed gear and 复盘方法 still sold is gone for what they are worth off the
 * clock (me/injury.ts). scripts/check_buy.ts holds all of it.
 *
 * And a VCT salary, which bought the whole shop inside its first season, gets
 * somewhere to go that is not strength at all: LIFESTYLE below.
 */
export const GEAR_SLOTS: { key: string; name: string }[] = [
  { key: 'mouse', name: '鼠标' }, { key: 'keyboard', name: '键盘' }, { key: 'headset', name: '耳机' },
  { key: 'monitor', name: '显示器' }, { key: 'chair', name: '椅子' },
]
/**
 * price of one slot by tier (1, 2), RMB: the five kits of each tier at their
 * real prices, averaged. 职业级: G PRO X SUPERLIGHT 2 ¥1,099–1,299 (ZOL),
 * ZOWIE XL2546K ¥3,999 (JD), Cloud III, TITAN Evo — about ¥2,000 a slot.
 * 旗舰: Viper V3 Pro, Wooting 60HE+ ¥1,258–1,500, G PRO X 2 ¥1,999 (tgbus),
 * XL2586X, Embody — about ¥5,500 a slot. The old $900 / $4,200 were three and
 * five times the kit.
 */
export const GEAR_PRICE = [0, 2000, 5500]
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

/** What gear does, in the shop's words (me/injury.ts GEAR_GUARD): the body, not the practice or the match. */
export const GEAR_EFFECT = '外设不加训练收益，比赛里的判断也不看外设。好外设护的是身体：鼠标和键盘护手腕，椅子护腰背，显示器和耳机护眼睛；职业级每件让对应伤病的几率低一成，旗舰低近两成。'

export interface Course { key: string; name: string; price: number; blurb: string }
export const COURSES: Course[] = [
  // RMB, 暂定: no published price to anchor a course to
  { key: 'lang', name: '语言课', price: 9000, blurb: '去外赛区不再是问题。本赛区的试训邀请和报价照常来；有俱乐部来找你时，外赛区的俱乐部还可能另外多来一家（2023 年起按 VCT 联赛分赛区）。' },
  { key: 'psych', name: '运动心理', price: 12000, blurb: '输了比赛气压涨得少两成，气压对临场判断的拖累也少两成。' },
  { key: 'review', name: '复盘方法', price: 8000, blurb: '复盘有了章法，不再对着录像熬眼睛：复盘不再添眼疲劳和偏头痛的几率，每次复盘气压消 2 点。' },
  { key: 'talk', name: '沟通表达', price: 6000, blurb: '羁绊涨得快三成，教练信任涨得快两成。' },
]

/**
 * Paid recovery takes fatigue down to here (体力 55, under 「累」) and no further.
 * The steady week ends at auto.ts WEEK_END_FATIGUE, under it, so on an ordinary
 * week there is nothing for money to take off: it brings a body back from a
 * hard week — a Masters, a run of series, a lay-off — and never turns into
 * practice. At no floor, 理疗 twice a week let the steady plan skip a rest in
 * two weeks of three (2026-09-14).
 */
export const RELIEF_FLOOR = 45
/** the flat's better sleep, a week, down to RELIEF_FLOOR (growth.ts settleTraining) */
export const FLAT_RELIEF = 3

export interface Relax { key: string; name: string; price: number; fatigue: number; tilt: number; mental: number; once?: boolean; blurb: string }
export const RELAX: Relax[] = [
  // RMB, 暂定. What each takes off a lay-off's weekly chance, and which lay-offs it shortens, is me/injury.ts's
  { key: 'physio', name: '理疗', price: 400, fatigue: -18, tilt: -4, mental: 0, blurb: `不占行动点。累的时候回 18 点体力，最多回到 ${100 - RELIEF_FLOOR}；这周手腕、腰背少伤三成，手腕、腰背、眼睛的伤好得快。` },
  { key: 'trip', name: '短途旅行', price: 4000, fatigue: -30, tilt: -20, mental: 0, blurb: `离开电脑两天：气压消 20 点，累的时候回 30 点体力（最多回到 ${100 - RELIEF_FLOOR}）；这周不容易焦虑失眠，倦怠缓得快。` },
  { key: 'flat', name: '电竞公寓', price: 60000, fatigue: 0, tilt: 0, mental: 0, once: true, blurb: `住得好、睡得好：累的时候每周多回 ${FLAT_RELIEF} 点体力（最多回到 ${100 - RELIEF_FLOOR}），感冒发烧、焦虑失眠少两成。` },
]

/** RMB signing fees, 暂定; the cut is a share of the wage */
export const AGENTS: { tier: number; name: string; fee: number; cut: number; blurb: string }[] = [
  { tier: 0, name: '没有经纪人', fee: 0, cut: 0, blurb: '合同自己谈。' },
  { tier: 1, name: '普通经纪人', fee: 8000, cut: 0.05, blurb: '谈判底气 +6，转会窗多一家来问。' },
  { tier: 2, name: '金牌经纪人', fee: 30000, cut: 0.10, blurb: '底气 +12，外赛区的报价也带来，多两家来问。' },
]

/**
 * 钱的出口. The probes that found the leaks above also found where a career's
 * money ends up: an autopilot VCT career sat on $1.6M by its eighth season,
 * having bought everything in the shop in its first VCT year. These are what a
 * professional's money really goes on, and none of them is strength — nothing
 * here touches the eight, a ceiling, form, fatigue, 心态 or a match. Each is
 * done once, is a line in the log the day it happens, and is read back in the
 * career's ending.
 */
export interface Lifestyle { key: string; name: string; price: number; blurb: string; line: string }
export const LIFESTYLE: Lifestyle[] = [
  // RMB, 暂定
  { key: 'home', name: '给家里换套房子', price: 1_500_000, blurb: '爸妈搬进新家。家里要是每周等你寄钱，从此不用了。', line: '你给家里换了套房子。' },
  { key: 'fund', name: '冠名家乡的高校赛', price: 200_000, blurb: '出钱办一届以你命名的高校联赛，热度 +30。', line: '家乡的高校赛用你的名字办过一届。' },
  { key: 'plan', name: '退役后的规划', price: 300_000, blurb: '请理财顾问把退役后的日子安排好。比赛里什么都不变。', line: '退役那天，你不用为下个月发愁。' },
]
export const lifeFlag = (key: string): string => `life_${key}`

/** Why this cannot be done right now, or null — the button is greyed with this reason, never hidden. */
export function lifestyleLocked(state: GameState, x: Lifestyle): string | null {
  const me = state.me!
  if (me.flags[lifeFlag(x.key)]) return '已经办过了'
  if (me.phase !== 'pro') return '有了职业合同再说'
  if (me.money < x.price) return `还差 ${cny(x.price - me.money)}`
  return null
}

export function buyLifestyle(state: GameState, key: string): string | null {
  const me = state.me!
  const x = LIFESTYLE.find((l) => l.key === key)
  if (!x) return '没有这一项。'
  const why = lifestyleLocked(state, x)
  if (why) return `${why}。`
  sealWeek(state)
  addMoney(state, 'life', -x.price)
  me.flags[lifeFlag(key)] = state.year
  if (key === 'home' && me.upkeep) me.upkeep = 0
  if (key === 'fund') me.heat += 30
  pushLog(state, 'money', `${x.name}（${cny(x.price)}）。${x.blurb}`)
  return null
}

/** What the money became, as the ending tells it. */
export const lifeLines = (state: GameState): string[] =>
  LIFESTYLE.filter((x) => state.me?.flags[lifeFlag(x.key)]).map((x) => x.line)

export function buyGear(state: GameState, slot: string): string | null {
  const me = state.me!
  const cur = me.gear[slot] ?? 0
  if (cur >= 2) return `已经是${gearModel(slot, 2)}了。`
  const price = GEAR_PRICE[cur + 1]
  if (me.money < price) return `要 ${cny(price)}，钱不够。`
  // A purchase stays made. Replaying earlier training must not refund its cost
  // while leaving the gear (or courses, agent and treatment below) in place.
  sealWeek(state)
  addMoney(state, 'gear', -price)
  me.gear[slot] = cur + 1
  const name = GEAR_SLOTS.find((s) => s.key === slot)?.name ?? slot
  pushLog(state, 'money', `换了${name}：${gearModel(slot, cur + 1)}（${GEAR_TIER_CN[cur + 1]}，${cny(price)}）。`)
  return null
}

export function buyCourse(state: GameState, key: string): string | null {
  const me = state.me!
  const c = COURSES.find((x) => x.key === key)
  if (!c) return '没有这门课。'
  if (me.courses.includes(key)) return '已经上过了。'
  if (me.money < c.price) return `要 ${cny(c.price)}，钱不够。`
  sealWeek(state)
  addMoney(state, 'course', -c.price)
  me.courses.push(key)
  if (key === 'lang') me.flags.lang = 1
  pushLog(state, 'money', `报了${c.name}（${cny(c.price)}）。`)
  return null
}

export function buyRelax(state: GameState, key: string): string | null {
  const me = state.me!
  const p = state.players[me.id]
  const r = RELAX.find((x) => x.key === key)
  if (!r) return '没有这一项。'
  if (r.once && me.flags[`relax_${key}`]) return '已经有了。'
  if (me.money < r.price) return `要 ${cny(r.price)}，钱不够。`
  if (!r.once && me.relaxUsed >= 2) return '这周已经放松过两次了。'
  sealWeek(state)
  addMoney(state, 'relax', -r.price)
  if (r.once) me.flags[`relax_${key}`] = 1
  else {
    me.relaxUsed++
    // this week's chance of the lay-offs it guards against (me/injury.ts injuryHazards)
    me.flags[`${key}Wk`] = me.week
  }
  // down to RELIEF_FLOOR and no further: a hard week given back, never an ordinary one turned into practice
  const was = p.fatigue
  if (r.fatigue < 0 && was > RELIEF_FLOOR) p.fatigue = Math.max(RELIEF_FLOOR, was + r.fatigue)
  const back = Math.round(was - p.fatigue)
  me.tilt = clamp(me.tilt + r.tilt, 0, 100)
  me.mental = clamp(me.mental + r.mental, 0, 100)
  pushLog(state, 'money', `${r.name}（${cny(r.price)}）${back ? `，体力回了 ${back}` : r.fatigue ? '，身上不累，体力没什么可回的' : ''}。`)
  // treatment for what I have shortens the lay-off (me/injury.ts)
  injuryRelax(state, key)
  return null
}

export function hireAgent(state: GameState, tier: number): string | null {
  const me = state.me!
  const a = AGENTS[tier]
  if (!a) return '没有这一档。'
  if (me.agentTier === tier) return '已经是这一档了。'
  if (tier > me.agentTier && me.money < a.fee) return `签约费 ${cny(a.fee)}，钱不够。`
  sealWeek(state)
  if (tier > me.agentTier) addMoney(state, 'agent', -a.fee)
  me.agentTier = tier
  pushLog(state, 'money', tier ? `签了${a.name}（${cny(a.fee)}），以后抽你 ${Math.round(a.cut * 100)}% 的薪水。` : '和经纪人解约了。')
  return null
}

export const courseMul = (courses: string[], key: string, mul: number): number => (courses.includes(key) ? mul : 1)
/** 运动心理: how much of a loss, and of the tilt it leaves, reaches the next call */
export const psychMul = (courses: string[]): number => (courses.includes('psych') ? 0.8 : 1)
