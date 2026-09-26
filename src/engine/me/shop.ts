import { clamp } from '../rng'
import { ATTR_CN } from '../types'
import type { Attrs, GameState, Player } from '../types'
import { recomputeOverall, refreshValue, weightsFor } from '../player'
import { ACTION_BY_KEY } from './actions'
import type { MeAction, MeState } from './types'
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
 *
 * 2026-09-26, the author's rule changed with the research (「花了钱想看到属性涨
 * 一点」, 24 votes): money only speeds reaching a ceiling or slows a ceiling's
 * fall; it never raises one. So the flagship kits settle in (KITS below: a point
 * each, only under the ceiling), and a coach, a camp and a health team can be
 * paid for (me/crew.ts). Paid recovery still stops at RELIEF_FLOOR — the old leak
 * stays shut, and scripts/check_buy.ts holds an 「old shop only」 career to the
 * old bounds so it cannot come back under the new ones.
 */
export const GEAR_SLOTS: { key: string; name: string }[] = [
  { key: 'mouse', name: '鼠标' }, { key: 'pad', name: '鼠标垫' }, { key: 'keyboard', name: '键盘' },
  { key: 'monitor', name: '显示器' }, { key: 'headset', name: '耳机' }, { key: 'chair', name: '椅子' },
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
/** a mousepad costs what a mousepad costs (暂定, RMB): G640 about ¥250, Artisan 零 FX about ¥500 */
export const PAD_PRICE = [0, 250, 500]
export const gearPrice = (slot: string, tier: number): number => (slot === 'pad' ? PAD_PRICE : GEAR_PRICE)[tier] ?? 0
export const GEAR_TIER_CN = ['入门', '职业级', '旗舰']

/**
 * What each tier is on the desk: kit VCT players really buy, not a tier word —
 * 「这些外设没有代入感，要用一些真实的品牌和型号」 (2026-09-11). The effect is the
 * tier's; the name is what the player sees. From 2026-09-26 each bought tier has
 * two or three to choose from (「外设能不能自己选」), all alike in what they do —
 * the first of each is the one an older save already owns (me.flags gm_<slot>).
 */
export const GEAR_CHOICES: Record<string, [string[], string[], string[]]> = {
  mouse: [['罗技 G102'], ['罗技 G PRO X SUPERLIGHT 2', 'ZOWIE EC2-CW', 'Pulsar X2V2'], ['雷蛇 毒蝰 V3 Pro', '雷蛇 炼狱蝰蛇 V3 Pro', 'Finalmouse UltralightX']],
  pad: [['罗技 G240'], ['罗技 G640', 'ZOWIE G-SR'], ['Artisan 零 FX', 'Artisan 飞燕 FX', 'Lethal Gaming Gear Saturn Pro']],
  keyboard: [['雷柏 V500 PRO'], ['罗技 G PRO X TKL', 'HyperX Alloy Origins 60'], ['Wooting 60HE+', '赛睿 Apex Pro TKL', '雷蛇 猎魂光蛛 V3 Pro']],
  monitor: [['AOC 24G2 144Hz'], ['ZOWIE XL2546K 240Hz', '华硕 ROG Strix XG259QN'], ['ZOWIE XL2586X 540Hz', '华硕 ROG Swift PG248QP 540Hz']],
  headset: [['HyperX Cloud Stinger 2'], ['HyperX Cloud III', '赛睿 Arctis Nova 5'], ['罗技 G PRO X 2', '雷蛇 旋风黑鲨 V2 Pro', '赛睿 Arctis Nova Pro']],
  chair: [['西昊 M57'], ['Secretlab TITAN Evo', 'AndaSeat Kaiser 3'], ['Herman Miller × 罗技 G Embody', 'Herman Miller Aeron']],
}
export const GEAR_MODELS: Record<string, [string, string, string]> = Object.fromEntries(
  Object.entries(GEAR_CHOICES).map(([k, t]) => [k, [t[0][0], t[1][0], t[2][0]]]),
) as Record<string, [string, string, string]>
export const gearChoices = (slot: string, tier: number): string[] => GEAR_CHOICES[slot]?.[tier] ?? []
export const gearModel = (slot: string, tier: number, pick = 0): string =>
  GEAR_CHOICES[slot]?.[tier]?.[pick] ?? GEAR_MODELS[slot]?.[tier] ?? GEAR_TIER_CN[tier] ?? ''
/** the model on my desk now */
export const myGearModel = (me: MeState, slot: string): string => gearModel(slot, me.gear[slot] ?? 0, me.flags[`gm_${slot}`] ?? 0)

/** What gear does, in the shop's words (me/injury.ts GEAR_GUARD, KITS below): the body, and a flagship kit's one point. */
export const GEAR_EFFECT = '好外设护身体：鼠标和键盘护手腕，椅子护腰背，显示器和耳机护眼睛；职业级每件让对应伤病的几率低一成，旗舰低近两成。比赛里的判断不看外设。同一档的几款型号效果一样，只是手感不同。'

/**
 * 外设上手 (2026-09-26). A flagship kit takes some getting used to, and then it
 * shows: after KIT_SESSIONS sessions of its card, the attribute it serves goes up
 * a point — once, and only while that attribute is under its ceiling; at the
 * ceiling the point waits for room and says so. The kit the role leans on most
 * (mainKit) gives a second point after KIT_MORE more. It never touches a ceiling:
 * it is a point of the room that practice would have filled anyway, filled
 * sooner. At most KIT_BUDGET of 综合 for any role (scripts/check_shop_budget.ts).
 *
 * The cards: 枪法训练 for the aim kit (mouse and pad), 打排位 for the reaction kit
 * (a 540Hz monitor and a rapid-trigger keyboard — Wooting's stop is real), 复盘
 * for the headset (the steps and the abilities, heard again). Counted in
 * me.flags, which the week's 撤回 puts back with everything else (me/undo.ts).
 */
export interface Kit { key: 'aim' | 'react' | 'ear'; name: string; slots: string[]; attr: keyof Attrs; action: MeAction }
export const KITS: Kit[] = [
  { key: 'aim', name: '瞄准套件', slots: ['mouse', 'pad'], attr: 'aim', action: 'aim' },
  { key: 'react', name: '反应套件', slots: ['monitor', 'keyboard'], attr: 'reaction', action: 'ranked' },
  { key: 'ear', name: '耳机', slots: ['headset'], attr: 'awareness', action: 'vod' },
]
export const KIT_SESSIONS = 4
export const KIT_MORE = 8
/** the most 综合 the kits may add for any role, both points of the main kit included */
export const KIT_BUDGET = 1.0

/** the kit whose attribute this role weighs most: the one that gives a second point */
export const mainKit = (p: Pick<Player, 'role'>): Kit => {
  const w = weightsFor(p)
  return KITS.reduce((best, k) => (w[k.attr] > w[best.attr] ? k : best), KITS[0])
}
export const kitMax = (p: Pick<Player, 'role'>, kit: Kit): number => (kit.key === mainKit(p).key ? 2 : 1)
/** sessions counted since the kit was complete that the next point needs */
export const kitNeed = (up: number): number => (up ? KIT_SESSIONS + KIT_MORE : KIT_SESSIONS)
export const kitComplete = (me: MeState, kit: Kit): boolean => kit.slots.every((s) => (me.gear?.[s] ?? 0) >= 2)
/** room for the kit's point under his own ceiling (or, without ceilings, under his 上限) */
const kitRoom = (p: Player, k: keyof Attrs): boolean => (p.caps ? p.attrs[k] < p.caps[k] : p.overall < p.potential && p.attrs[k] < 99)

export interface KitRead { kit: Kit; complete: boolean; sessions: number; up: number; max: number; need: number; room: boolean }
export function kitRead(state: GameState, kit: Kit): KitRead {
  const me = state.me!
  const p = state.players[me.id]
  const up = me.flags[`kitUp_${kit.key}`] ?? 0
  return { kit, complete: kitComplete(me, kit), sessions: me.flags[`kitN_${kit.key}`] ?? 0, up, max: kitMax(p, kit), need: kitNeed(up), room: kitRoom(p, kit.attr) }
}

/** One kit's line for the gear panel, in words: what is missing, how far along, or why the point is waiting. */
export function kitLine(state: GameState, kit: Kit): string {
  const r = kitRead(state, kit)
  const cn = ATTR_CN[kit.attr]
  const card = ACTION_BY_KEY[kit.action].label
  const parts = kit.slots.length > 1 ? `${kit.slots.map((s) => GEAR_SLOTS.find((g) => g.key === s)!.name).join('和')}都换成旗舰` : '换成旗舰'
  const head = `${kit.name}（${parts}）：换上后${card}满 ${KIT_SESSIONS} 次，${cn} +1（离上限还有空间才算）${r.max > 1 ? `；再满 ${KIT_MORE} 次，再 +1` : ''}`
  if (r.up >= r.max) return `${head}。已经上手了。`
  if (!r.complete) return `${head}。还差：${kit.slots.filter((s) => (state.me!.gear[s] ?? 0) < 2).map((s) => GEAR_SLOTS.find((g) => g.key === s)!.name).join('、')}。`
  const have = Math.min(r.sessions, r.need)
  if (have >= r.need && !r.room) return `${head}。练够了，但${cn}到瓶颈了：这 1 点等离上限有空间时再算。`
  return `${head}。现在 ${have}/${r.need}。`
}

/**
 * A session of the card a flagship kit is for (me/growth.ts runAction): counted, and the point lands
 * the first session there is room for it. Returns the line to say, or null.
 */
export function kitSession(state: GameState, action: MeAction): string | null {
  const me = state.me!
  const p = state.players[me.id]
  let said: string | null = null
  for (const kit of KITS) {
    if (kit.action !== action || !kitComplete(me, kit)) continue
    const up = me.flags[`kitUp_${kit.key}`] ?? 0
    if (up >= kitMax(p, kit)) continue
    const need = kitNeed(up)
    const n = me.flags[`kitN_${kit.key}`] ?? 0
    if (n < need) me.flags[`kitN_${kit.key}`] = n + 1
    if (n + 1 < need || !kitRoom(p, kit.attr)) continue
    const k = kit.attr
    p.attrs[k] += 1
    // reaching the ceiling keeps no progress over (no 存点数, me/bottleneck.ts)
    if (p.caps && p.attrs[k] >= p.caps[k]) p.xp[k] = 0
    recomputeOverall(p)
    refreshValue(p)
    me.flags[`kitUp_${kit.key}`] = up + 1
    said = `新${kit.name}${up ? '用顺手了' : '上手了'}：${ATTR_CN[k]} +1。`
    pushLog(state, 'train', said)
  }
  return said
}

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

/** Up a tier, as the model picked from that tier's choices (GEAR_CHOICES; the first when none is picked). */
export function buyGear(state: GameState, slot: string, pick = 0): string | null {
  const me = state.me!
  if (!GEAR_SLOTS.some((s) => s.key === slot)) return '没有这一件。'
  const cur = me.gear[slot] ?? 0
  if (cur >= 2) return `已经是${myGearModel(me, slot)}了。`
  const price = gearPrice(slot, cur + 1)
  if (me.money < price) return `要 ${cny(price)}，钱不够。`
  const choice = Math.max(0, Math.min(pick, gearChoices(slot, cur + 1).length - 1))
  // A purchase stays made. Replaying earlier training must not refund its cost
  // while leaving the gear (or courses, agent and treatment below) in place.
  sealWeek(state)
  addMoney(state, 'gear', -price)
  me.gear[slot] = cur + 1
  if (choice) me.flags[`gm_${slot}`] = choice
  else delete me.flags[`gm_${slot}`]
  const name = GEAR_SLOTS.find((s) => s.key === slot)?.name ?? slot
  pushLog(state, 'money', `换了${name}：${gearModel(slot, cur + 1, choice)}（${GEAR_TIER_CN[cur + 1]}，${cny(price)}）。`)
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
