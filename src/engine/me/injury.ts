import { Rng, clamp, hashStr } from '../rng'
import { recomputeOverall, refreshValue } from '../player'
import type { Attrs, GameState } from '../types'
import type { InjuryKind, MeAction, MeInjury, MeState } from './types'
import { pushLog } from './log'

/**
 * What being hurt is, for a player.
 *
 * Five lay-offs a VALORANT pro really has: the wrist, the back and neck, the
 * eyes, a fever or a bad stomach, and the one that is not the body at all.
 * Each is made likelier by something in the week the player actually had —
 * hours on the aim trainer, long series, a flight to an international, tilt,
 * weeks without a day off — and under all of them fatigue, 体质 and age.
 *
 * The engine still owns the clock: `injuredUntil`, which the coach, the lineup
 * and the action points all read, and its own weekly and post-match rolls hurt
 * everybody else (engine/training.ts). The career's own player is left out of
 * those two rolls and hurt here instead, once a week at the settlement, because
 * only this layer knows his 体质 and what his week was.
 *
 * While it lasts it takes something specific off: hours into the sore part go
 * almost nowhere, the named attributes are down on the floor and in a call if
 * he plays through (me/hurtplay.ts), a fever or a bad stretch of nights costs
 * form. Rest, 理疗 and the 康复 ceremony bring the day back; training on it
 * pushes the day out. Playing through is the only road to a lasting mark.
 *
 * Mechanics after 破晓's injury.ts (kinds with a weight, weeks out, a toll
 * while it lasts); the kinds, their numbers and every line here are this game's.
 */

type AttrKey = keyof Attrs
type Plan = MeState['plan']

export interface InjuryDef {
  kind: InjuryKind
  /** the names it goes by; which one depends on the week it happened in */
  names: [string, string]
  /** a sentence of what it is like, by name */
  text: Record<string, string>
  /** what it gets in the way of, in words */
  effect: string
  /** what heals it faster, and what slows it */
  care: string
  /** days out, before 体质 and age */
  days: [number, number]
  /** hours into these go almost nowhere while it lasts */
  sore: AttrKey[]
  /** and every training hour is worth this much */
  train: number
  /** off the attributes on the floor, and in a call judged on them, if I play through */
  hits: Partial<Record<AttrKey, number>>
  /** off 心态 in a call judged on nerve */
  mental?: number
  /** off form for a map played on it */
  formOnFloor?: number
  /** what each week of it costs */
  weekly?: { form?: number; tilt?: number; fatigue?: number }
  /** the hours in a week's plan that aggravate it */
  strain: (plan: Plan) => number
  /** 理疗 treats it; a short trip away does */
  physio: boolean
  trip: boolean
  /** a match played through it: the chance it leaves a mark */
  lasting: number
  lastingText: string
  /** light enough that the autopilot plays through it */
  autoPlays: boolean
}

const hrs = (plan: Plan, k: MeAction) => plan[k] ?? 0
const drills = (plan: Plan) => hrs(plan, 'aim') + hrs(plan, 'vod') + hrs(plan, 'util') + hrs(plan, 'ranked') + hrs(plan, 'scrim')

export const INJURY_KINDS: Record<InjuryKind, InjuryDef> = {
  wrist: {
    kind: 'wrist', names: ['手腕劳损', '腱鞘炎'],
    text: {
      手腕劳损: '握鼠标的那只手腕一用力就酸。',
      腱鞘炎: '拇指根到手腕一线肿着，一甩枪就刺痛。',
    },
    effect: '枪法和反应受影响',
    care: '休息和理疗好得快，练枪会拖长。',
    days: [8, 21], sore: ['aim', 'reaction'], train: 0.9,
    hits: { aim: -12, reaction: -9 },
    strain: (p) => hrs(p, 'aim') + 0.5 * hrs(p, 'ranked'),
    physio: true, trip: false, lasting: 0.07, autoPlays: false,
    lastingText: '落下了病根：手腕以后更容易复发，枪法和反应也掉了一点。',
  },
  back: {
    kind: 'back', names: ['腰背劳损', '颈椎不适'],
    text: {
      腰背劳损: '一天坐十个小时，腰先扛不住了，坐满一张图就得起来活动。',
      颈椎不适: '脖子转不过来，一侧肩膀跟着发僵。',
    },
    effect: '坐不久，反应和意识受影响',
    care: '休息和理疗好得快，训练赛会拖长。',
    days: [6, 17], sore: [], train: 0.75,
    hits: { reaction: -5, awareness: -5, clutch: -4, teamwork: -3, aim: -3 },
    weekly: { fatigue: 5 },
    strain: (p) => hrs(p, 'scrim') + 0.5 * (hrs(p, 'aim') + hrs(p, 'util')),
    physio: true, trip: false, lasting: 0.05, autoPlays: false,
    lastingText: '落下了病根：以后坐久了腰背就疼，体质差了一截。',
  },
  eyes: {
    kind: 'eyes', names: ['视疲劳', '偏头痛'],
    text: {
      视疲劳: '盯屏幕太久，眼睛干涩发胀，看小地图都费劲。',
      偏头痛: '一到下午就头疼，屏幕的光刺得睁不开眼。',
    },
    effect: '反应和意识受影响',
    care: '休息和理疗好得快，直播和复盘会拖长。',
    days: [4, 10], sore: ['awareness', 'clutch'], train: 0.8,
    hits: { reaction: -8, awareness: -7, aim: -3 },
    strain: (p) => hrs(p, 'stream') + hrs(p, 'content') + hrs(p, 'vod'),
    physio: true, trip: false, lasting: 0.03, autoPlays: true,
    lastingText: '落下了病根：眼睛一累就头疼，反应慢了一点。',
  },
  ill: {
    kind: 'ill', names: ['感冒发烧', '肠胃炎'],
    text: {
      感冒发烧: '烧到三十八度多，坐下来打不完一张图。',
      肠胃炎: '吃坏了肚子，两天没怎么吃下东西。',
    },
    effect: '整个人发虚，状态受影响',
    care: '多休息，别硬练。',
    days: [3, 8], sore: [], train: 0.5,
    hits: { aim: -4, reaction: -5, awareness: -4, utility: -3, clutch: -4, teamwork: -3, communication: -3 },
    mental: -3, formOnFloor: -8, weekly: { form: 4 },
    strain: (p) => 0.5 * drills(p),
    physio: false, trip: false, lasting: 0, autoPlays: true,
    lastingText: '',
  },
  burnout: {
    kind: 'burnout', names: ['焦虑失眠', '倦怠'],
    text: {
      焦虑失眠: '凌晨四点还睁着眼，脑子里一直在重播上一场。',
      倦怠: '一打开游戏就想关掉，训练表上的字一个都看不进去。',
    },
    effect: '状态和心态受影响',
    care: '休息和短途旅行缓得快，硬练会拖长。',
    days: [9, 20], sore: [], train: 0.55,
    hits: { clutch: -9, communication: -6, awareness: -5 },
    mental: -10, formOnFloor: -6, weekly: { form: 4, tilt: 7 },
    strain: (p) => 0.5 * (drills(p) + hrs(p, 'stream')),
    physio: false, trip: true, lasting: 0.05, autoPlays: false,
    lastingText: '落下了病根：压力一大就睡不好，心态差了一截。',
  },
}

export const INJURY_ORDER: InjuryKind[] = ['wrist', 'back', 'eyes', 'ill', 'burnout']

/** ten days or more still to go: the coach will not play me on it, nor will the autopilot */
export const SERIOUS_DAYS = 10

/** the engine's six names (every team-mate, and my own on a save from before the kinds) and this file's own */
const NOTE_KIND: Record<string, InjuryKind> = {
  手腕劳损: 'wrist', 腱鞘炎: 'wrist', 腱鞘炎复发: 'wrist',
  腰背劳损: 'back', 颈椎不适: 'back', 肩部拉伤: 'back',
  视疲劳: 'eyes', 偏头痛: 'eyes',
  感冒发烧: 'ill', 肠胃炎: 'ill', 重感冒: 'ill',
  焦虑失眠: 'burnout', 倦怠: 'burnout', '心理疲劳 / 需要休息': 'burnout',
}
export const kindOfNote = (note?: string): InjuryKind => NOTE_KIND[note ?? ''] ?? 'back'

/** How long, in words. */
export function durationWord(days: number): string {
  if (days <= 4) return '几天就好'
  if (days <= 10) return '大约一周'
  if (days <= 17) return '大约两周'
  if (days <= 24) return '大约三周'
  return '一个月左右'
}
/** the same, for a table cell */
export function durationShort(days: number): string {
  if (days <= 4) return '几天'
  if (days <= 10) return '一周'
  if (days <= 17) return '两周'
  if (days <= 24) return '三周'
  return '一个月'
}

export interface InjuryStatus {
  kind: InjuryKind
  /** what it is called */
  note: string
  /** a sentence of what it is like */
  text: string
  effect: string
  care: string
  daysLeft: number
  weeksLeft: number
  /** how long, in words */
  duration: string
  /** SERIOUS_DAYS or more still to go */
  serious: boolean
  /** 「手腕劳损：枪法和反应受影响，大约两周」 */
  line: string
}

/** What is wrong with me right now, if anything. Reads only; safe on any screen. */
export function injuryStatus(state: GameState): InjuryStatus | null {
  const me = state.me
  if (!me) return null
  const p = state.players[me.id]
  if (!p || p.injuredUntil <= state.day) return null
  const kind = me.injury?.kind ?? kindOfNote(p.injuryNote)
  const def = INJURY_KINDS[kind]
  const note = p.injuryNote && NOTE_KIND[p.injuryNote] ? p.injuryNote : def.names[0]
  const daysLeft = p.injuredUntil - state.day
  const duration = durationWord(daysLeft)
  return {
    kind, note, text: def.text[note] ?? def.text[def.names[0]], effect: def.effect, care: def.care,
    daysLeft, weeksLeft: Math.max(1, Math.ceil(daysLeft / 7)), duration,
    serious: daysLeft >= SERIOUS_DAYS, line: `${note}：${def.effect}，${duration}`,
  }
}

/** The record of the lay-off I am in; a save from before the kinds gets one the first time it is asked. */
export function ensureInjury(state: GameState): MeInjury | undefined {
  const me = state.me
  const p = me ? state.players[me.id] : undefined
  if (!me || !p || p.injuredUntil <= state.day) return me?.injury
  me.injury ??= { kind: kindOfNote(p.injuryNote), from: state.day, played: 0 }
  return me.injury
}

/** The key a lay-off is held under: its first day this season, or its last on a save from before the kinds. */
export function injuryKey(state: GameState): string {
  const me = state.me!
  return me.injury ? `${state.year}:${me.injury.from}` : String(state.players[me.id]?.injuredUntil ?? 0)
}

/** The week just gone, as far as the body is concerned: maps I was on the floor for, and whether it meant a flight. */
function weekLoad(state: GameState): { maps: number; travel: boolean } {
  const me = state.me!
  const from = state.day - 7
  let maps = 0
  let travel = false
  for (const m of me.matches) {
    if (m.year !== state.year || m.day <= from || m.day > state.day || !(m.started || m.friendly)) continue
    maps += m.maps
    if (/Masters|Champions|LOCK\/\/IN|大师赛|冠军赛/i.test(m.comp)) travel = true
  }
  return { maps, travel }
}

/**
 * This week's chance of each kind, at the settlement.
 *
 * A floor for bad luck, then what the week did: the hours that load each part,
 * the maps played past a normal week, a flight. Fatigue at the week's end is
 * the big lever. It counts from 25 — the steady plan ends most weeks between
 * 15 and 35 (measured 2026-09-11) — and steepens, so a normal week costs
 * little and a week ended at 70 roughly triples the chance. 体质 guards the
 * body, 心态 the head, age wears the back hardest. A mark left by an earlier
 * one makes it likelier to come back, and a week just back from one is watched.
 */
export function injuryHazards(state: GameState): Record<InjuryKind, number> {
  const me = state.me!
  const p = state.players[me.id]
  const plan = me.plan
  const tired = clamp((p.fatigue - 25) / 50, 0, 1.5)
  const load = 0.4 * tired + 0.6 * tired * tired
  const { maps, travel } = weekLoad(state)
  const body = clamp(1.5 - me.body / 100, 0.6, 1.2)
  const age = 1 + Math.max(0, p.age - 24) * 0.07
  const noRest = Math.min(10, me.flags.injNoRest ?? 0)
  const again = (k: InjuryKind, x: number) => (me.flags[`chronic_${k}`] ? x : 1)
  const grace = me.flags.injHealedWk != null && me.week - me.flags.injHealedWk < 2 ? 0.35 : 1
  const h: Record<InjuryKind, number> = {
    wrist: (0.0018 + 0.0008 * (hrs(plan, 'aim') + 0.5 * (hrs(plan, 'ranked') + hrs(plan, 'util'))) + 0.010 * load) *
      age * body * again('wrist', 1.8),
    back: (0.0011 + 0.0009 * Math.max(0, maps - 3) + 0.007 * load) * age * age * body * again('back', 1.6),
    eyes: (0.0008 + 0.0005 * (hrs(plan, 'stream') + hrs(plan, 'content') + hrs(plan, 'vod')) + 0.004 * load) * again('eyes', 1.6),
    ill: (0.0018 + 0.0012 * Math.max(0, maps - 2) + (travel ? 0.005 : 0)) * body * body,
    burnout: (0.0006 + 0.007 * load + 0.00012 * Math.max(0, me.tilt - 45) + 0.0003 * noRest) *
      clamp(1.35 - me.mental / 150, 0.6, 1.2) * again('burnout', 1.6),
  }
  for (const k of INJURY_ORDER) h[k] *= grace
  return h
}

function nameFor(state: GameState, kind: InjuryKind, days: number, travel: boolean, rng: Rng): string {
  const me = state.me!
  const [a, b] = INJURY_KINDS[kind].names
  switch (kind) {
    case 'wrist': return me.flags.chronic_wrist || days >= 15 ? b : a
    case 'back': return rng.chance(0.5) ? a : b
    case 'eyes': return me.tilt >= 40 || rng.chance(0.3) ? b : a
    case 'ill': return travel || rng.chance(0.25) ? b : a
    default: return me.tilt >= 50 ? a : b
  }
}

/** It happens: the clock, the name, the record, and one line. */
export function startInjury(state: GameState, kind: InjuryKind, rng: Rng): void {
  const me = state.me!
  const p = state.players[me.id]
  const def = INJURY_KINDS[kind]
  // older bodies and weaker constitutions take longer to come back
  const slow = clamp(1 + (p.age - 24) * 0.03, 0.9, 1.3) * clamp(1.25 - me.body / 200, 0.8, 1.15)
  const days = Math.max(2, Math.round(rng.int(def.days[0], def.days[1]) * slow))
  const name = nameFor(state, kind, days, weekLoad(state).travel, rng)
  p.injuredUntil = state.day + days
  p.injuryNote = name
  p.morale = clamp(p.morale - 6, 0, 100)
  me.injury = { kind, from: state.day, played: 0 }
  me.flags.injuries = (me.flags.injuries ?? 0) + 1
  pushLog(state, 'bad', `${name}：${def.effect}，${durationWord(days)}。`)
}

/** A week of it: what it costs, and what the week's plan did to the day it ends. */
function weekOfIt(state: GameState, cur: InjuryStatus): void {
  const me = state.me!
  const p = state.players[me.id]
  ensureInjury(state)
  const def = INJURY_KINDS[cur.kind]
  if (def.weekly?.form) p.form = clamp(p.form - def.weekly.form, 30, 99)
  if (def.weekly?.tilt) me.tilt = clamp(me.tilt + def.weekly.tilt, 0, 100)
  if (def.weekly?.fatigue) p.fatigue = clamp(p.fatigue + def.weekly.fatigue, 0, 100)
  const shave = Math.floor((me.plan.rest ?? 0) * 0.75)
  const add = Math.floor(def.strain(me.plan) * 0.8)
  if (!shave && !add) return
  p.injuredUntil = Math.max(state.day + 1, p.injuredUntil - shave + add)
  if (add > shave) pushLog(state, 'bad', `带着${cur.note}硬练，好得更慢了。`)
}

/**
 * The weekly settle: a week of the lay-off I am in, the day it is over, or the
 * roll for a new one. The roll has its own stream, so no other dice move.
 */
export function injuryTick(state: GameState): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  if (!p) return
  me.flags.injNoRest = (me.plan.rest ?? 0) > 0 ? 0 : Math.min(20, (me.flags.injNoRest ?? 0) + 1)
  const cur = injuryStatus(state)
  if (cur) {
    weekOfIt(state, cur)
    return
  }
  if (me.injury || me.flags.injurySaid) {
    me.injury = undefined
    me.flags.injurySaid = 0
    me.flags.injHealedWk = me.week
    pushLog(state, 'good', '伤好了，这周可以正常练了。')
  }
  if (me.phase === 'retired') return
  const h = injuryHazards(state)
  const rng = new Rng(hashStr(`injury:${state.seed}:${state.year}:${state.day}`))
  if (!rng.chance(INJURY_ORDER.reduce((s, k) => s + h[k], 0))) return
  startInjury(state, rng.weighted(INJURY_ORDER, INJURY_ORDER.map((k) => h[k])), rng)
}

/** A training hour on k while hurt is worth this much (me/growth.ts). */
export function injuryTrainMul(state: GameState, k: AttrKey): number {
  const cur = injuryStatus(state)
  if (!cur) return 1
  const def = INJURY_KINDS[cur.kind]
  return def.train * (def.sore.includes(k) ? 0.4 : 1)
}

/** What it takes off an attribute, or 心态, in a call made on it (me/nodes.ts). */
export function injuryHit(state: GameState, dim: AttrKey | 'mental'): number {
  const cur = injuryStatus(state)
  if (!cur) return 0
  const def = INJURY_KINDS[cur.kind]
  const v = dim === 'mental' ? def.mental ?? 0 : def.hits[dim] ?? 0
  return Math.round(v * (cur.serious ? 1.3 : 1))
}

/** What it takes off me for a map played on it (me/hurtplay.ts puts it on, and back). */
export function floorHits(state: GameState): { attrs: Partial<Record<AttrKey, number>>; form: number } | null {
  const cur = injuryStatus(state)
  if (!cur) return null
  const def = INJURY_KINDS[cur.kind]
  const mul = cur.serious ? 1.3 : 1
  const attrs: Partial<Record<AttrKey, number>> = {}
  for (const [k, v] of Object.entries(def.hits) as [AttrKey, number][]) attrs[k] = Math.round(v * mul)
  return { attrs, form: Math.round((def.formOnFloor ?? 0) * mul) }
}

/** Would this purchase treat what I have? (me/auto.ts shops on it.) */
export function injuryHelpedBy(state: GameState, key: string): boolean {
  const cur = injuryStatus(state)
  if (!cur) return false
  const def = INJURY_KINDS[cur.kind]
  return key === 'physio' ? def.physio : key === 'trip' ? def.trip : false
}

/** 理疗 or a short trip, bought (me/shop.ts): if it treats what I have, the lay-off is shorter. */
export function injuryRelax(state: GameState, key: string): void {
  if (!injuryHelpedBy(state, key)) return
  const cur = injuryStatus(state)!
  const p = state.players[state.me!.id]
  p.injuredUntil = Math.max(state.day + 1, p.injuredUntil - (key === 'trip' ? 3 : 2))
  pushLog(state, 'good', key === 'trip' ? `出去走了两天，${cur.note}缓过来一些。` : `理疗之后，${cur.note}好了一点。`)
}

/** Played through, and it left a mark: small, for good, and likelier to come back. */
export function lastingHit(state: GameState, kind: InjuryKind): void {
  const me = state.me!
  const p = state.players[me.id]
  const def = INJURY_KINDS[kind]
  if (!def.lasting) return
  if (kind === 'wrist') {
    p.attrs.aim = Math.max(20, p.attrs.aim - 1)
    p.attrs.reaction = Math.max(20, p.attrs.reaction - 1)
  }
  if (kind === 'eyes') p.attrs.reaction = Math.max(20, p.attrs.reaction - 1)
  if (kind === 'back') me.body = clamp(me.body - 4, 0, 100)
  if (kind === 'burnout') me.mental = clamp(me.mental - 4, 0, 100)
  recomputeOverall(p)
  refreshValue(p)
  me.flags[`chronic_${kind}`] = 1
  me.flags.injLasting = (me.flags.injLasting ?? 0) + 1
  pushLog(state, 'bad', def.lastingText)
}

const REHAB: Record<InjuryKind, string> = {
  wrist: '理疗师给你排了一套节奏训练——不碰鼠标，只做手腕。',
  back: '理疗师让你趴下，从颈椎一节一节往下找，然后是一套跟着节拍做的拉伸。',
  eyes: '队医把屏幕调暗，给你一套跟着节拍做的眼部放松。',
  ill: '烧退了，人还是虚的。队医让你跟着节拍，先把呼吸找回来。',
  burnout: '心理咨询师没跟你聊比赛，只给了一套跟着节拍的呼吸练习：先把觉睡回来。',
}
/** What the 康复 ceremony has me do, by what is wrong (me/ceremony.ts). */
export const rehabStory = (state: GameState): string => REHAB[injuryStatus(state)?.kind ?? 'wrist']
