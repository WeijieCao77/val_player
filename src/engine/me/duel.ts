import { Rng, clamp, hashStr } from '../rng'
import { ATTR_CN, ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player } from '../types'
import { ACTION_BY_KEY, DUELS_PER_WEEK } from './actions'
import { EDGE_NEED, TRIAL_MATCHES, coachStarters, duelTarget } from './coach'
import { addXp } from './growth'
import { pushLog } from './log'
import type { DuelSceneLog } from './types'

/**
 * The practice duel, played a scene at a time.
 *
 * The coach puts me and the starter in my slot on the same side of a scrim.
 * Best of three scenes; each one is a thing that happens in a scrim, with
 * three ways to play it, each judged on one attribute against his. Landing a
 * risky one is what the staff remembers. The instant version (coach.runDuel)
 * stays for 托管 and the bot; this is what the button opens.
 */

type Dim = keyof Attrs | 'mental'
export interface DuelOpt { t: string; dim: Dim; risk: number }
export interface DuelScene { q: string; ctx: string; a: DuelOpt[] }

export const DUEL_SCENES: DuelScene[] = [
  { q: '开局对枪：教练把你和他放在同一条道上，让你们各自打自己的。', ctx: '训练赛不会为你改战术，队伍照常打。',
    a: [{ t: '抢先手，赌第一枪', dim: 'reaction', risk: 1.2 }, { t: '架住不动，等他探头', dim: 'awareness', risk: 0.8 }, { t: '跟队友同步进，不单挑', dim: 'teamwork', risk: 0.6 }] },
  { q: '中期：对面开始每回合往你守的点压。', ctx: '他显然想在教练面前把你打穿。',
    a: [{ t: '换个刁钻的位置反打', dim: 'awareness', risk: 1.0 }, { t: '叫一个队友过来补位', dim: 'communication', risk: 0.8 }, { t: '正面硬守，用枪说话', dim: 'aim', risk: 1.2 }] },
  { q: '残局：包已经下了，场上只剩你和他。', ctx: '教练组全在身后看。',
    a: [{ t: '主动找他单挑', dim: 'clutch', risk: 1.1 }, { t: '藏起来，等他来拆', dim: 'awareness', risk: 0.7 }, { t: '假拆骗他出来', dim: 'clutch', risk: 1.0 }] },
  { q: '选人：教练问你要不要拿他的本命特工。', ctx: '拿了就是在他面前证明这个特工你也会。',
    a: [{ t: '拿，我玩得比他好', dim: 'utility', risk: 1.3 }, { t: '拿版本强势的，稳打', dim: 'utility', risk: 0.7 }, { t: '拿功能型的，帮队伍赢', dim: 'teamwork', risk: 0.9 }] },
  { q: '第三张图之前，他在休息室跟你说：「训练赛而已，别太当真。」', ctx: '你知道他是想让你松下来。',
    a: [{ t: '笑一笑，上去更狠', dim: 'mental', risk: 1.0 }, { t: '当没听见，按自己的节奏打', dim: 'mental', risk: 0.7 }, { t: '回一句「那你也别当真」', dim: 'communication', risk: 1.1 }] },
  { q: '局面焦灼，队友问这回合怎么打。', ctx: '训练赛里指挥权在他手上，不在你。',
    a: [{ t: '接过指挥，报点打', dim: 'igl', risk: 1.2 }, { t: '听队伍的，先打好自己', dim: 'mental', risk: 0.6 }, { t: '自己去做信息，找机会', dim: 'awareness', risk: 0.8 }] },
]

export const DIM_CN: Record<string, string> = { ...ATTR_CN, mental: '心态' }

/** Why a duel cannot start right now, or null. */
export function duelBlock(state: GameState): string | null {
  const me = state.me!
  if (me.phase !== 'pro') return '没有队伍，没有可以挑战的人。'
  const team = state.teams[state.myTeam]
  if (team.starters.includes(me.id)) return '你已经是首发了，不用挑战谁。'
  if (me.trial) return '你正在试用期，先把正赛打好。'
  if (me.benchLock && me.benchLock > state.day) return `教练这段时间不会再看你（还有 ${me.benchLock - state.day} 天）。`
  if (me.duelLive && !me.duelLive.done) return '训练赛正在打。'
  if (me.duelsThisWeek >= DUELS_PER_WEEK) return '这周已经打了两次对位，教练不会再排。'
  if (me.ap < ACTION_BY_KEY.duel.cost) return `要 ${ACTION_BY_KEY.duel.cost} 个行动点。`
  const mine = state.players[me.id]
  if (mine.injuredUntil > state.day) return '带伤打不了对位。'
  if (!duelTarget(state)) return '现在没有可以挑战的首发。'
  return null
}

function value(state: GameState, p: Player, dim: Dim): number {
  if (dim === 'mental') return p.id === state.me!.id ? state.me!.mental : 55
  return p.attrs[dim]
}

/** Odds of one scene going my way: my number on that attribute against his. */
export function duelOptP(state: GameState, opt: DuelOpt): number {
  const me = state.me!
  const mine = state.players[me.id]
  const live = me.duelLive
  const him = live ? state.players[live.himId] : duelTarget(state)
  if (!him) return 0.5
  const a = value(state, mine, opt.dim)
  const b = value(state, him, opt.dim)
  let p = 0.52 + (a - b) / 38 - (opt.risk - 0.8) * 0.10
  p -= Math.max(0, mine.fatigue - 55) * 0.003
  p += (mine.form - 70) / 400 + (me.mental - 50) / 400
  return clamp(p, 0.12, 0.88)
}

export function startDuel(state: GameState): string | null {
  const why = duelBlock(state)
  if (why) return why
  const me = state.me!
  const him = duelTarget(state)!
  const rng = new Rng(hashStr(`duel:${state.seed}:${state.year}:${state.day}:${me.duelsThisWeek}`))
  const idx = DUEL_SCENES.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) { const j = rng.int(0, i); [idx[i], idx[j]] = [idx[j], idx[i]] }
  me.ap -= ACTION_BY_KEY.duel.cost
  me.plan.duel = (me.plan.duel ?? 0) + 1
  me.duelsThisWeek++
  state.players[me.id].fatigue = clamp(state.players[me.id].fatigue + 7, 0, 100)
  me.duelLive = { himId: him.id, sc: [0, 0], round: 1, pool: idx.slice(0, 5), rounds: [], flash: 0, done: false }
  return null
}

export function duelScene(state: GameState): DuelScene | null {
  const live = state.me!.duelLive
  if (!live || live.done) return null
  return DUEL_SCENES[live.pool[(live.round - 1) % live.pool.length]]
}

/** Answer the current scene. */
export function duelPick(state: GameState, i: number): DuelSceneLog | null {
  const me = state.me!
  const live = me.duelLive
  const scene = duelScene(state)
  if (!live || !scene) return null
  const opt = scene.a[i] ?? scene.a[0]
  const mine = state.players[me.id]
  const him = state.players[live.himId]
  const p = duelOptP(state, opt)
  const rng = new Rng(hashStr(`duel:${state.seed}:${state.day}:${live.round}:${i}`))
  const ok = rng.chance(p)
  const flash = ok && opt.risk >= 1.1
  const a = Math.round(value(state, mine, opt.dim))
  const b = Math.round(value(state, him, opt.dim))
  // the thing you just did is the thing you get better at
  if (opt.dim !== 'mental') addXp(mine, opt.dim, ok ? 6 : 3)
  const line = `第 ${live.round} 局 · ${opt.t}（${DIM_CN[opt.dim]} ${a} 对 ${b}，${Math.round(p * 100)}%）—— ${ok ? (flash ? '打成了，很亮眼' : '打成了') : '被他压住了'}`
  const entry: DuelSceneLog = { r: live.round, t: opt.t, dim: DIM_CN[opt.dim], p: Math.round(p * 100), ok, mine: a, his: b, flash, line }
  live.rounds.push(entry)
  if (ok) { live.sc[0]++; if (flash) live.flash++ } else live.sc[1]++
  live.round++
  if (live.sc[0] >= 2 || live.sc[1] >= 2) endDuel(state)
  return entry
}

function endDuel(state: GameState): void {
  const me = state.me!
  const live = me.duelLive
  if (!live || live.done) return
  const him = state.players[live.himId]
  const won = live.sc[0] > live.sc[1]
  live.done = true
  me.scrimRounds += 30
  me.mental = clamp(me.mental + (won ? 0.4 : 0.2), 0, 100)
  if (won) {
    const gain = 1 + live.flash * 0.5
    me.edge = Math.min(EDGE_NEED + 2, me.edge + gain)
    me.coachTrust = clamp(me.coachTrust + 1.5, 0, 100)
    live.verdict = `你 ${live.sc[0]}:${live.sc[1]} 赢下对位。${live.flash ? `有 ${live.flash} 波打得很亮，教练组记下了。` : ''}资本 +${gain} → ${me.edge.toFixed(1)}/${EDGE_NEED}`
  } else {
    me.edge = Math.max(0, me.edge - 0.5)
    me.coachTrust = clamp(me.coachTrust + 0.3, 0, 100)
    live.verdict = `${live.sc[1]}:${live.sc[0]} 输给了他。差距在哪，下面写着。资本 −0.5 → ${me.edge.toFixed(1)}/${EDGE_NEED}`
  }
  live.edge = me.edge

  const team = state.teams[state.myTeam]
  const starter = team.starters.includes(me.id)
  const locked = !!me.benchLock && me.benchLock > state.day
  if (me.edge >= EDGE_NEED && !me.trial && !starter && !locked) {
    me.trial = { left: TRIAL_MATCHES, displaced: him.id, forgiven: false }
    me.edge = 0
    team.starters = coachStarters(state)
    live.trial = true
    live.verdict += `教练找你谈了：下一场正赛，名单上是你。赢了位置就是你的；输了回替补席。`
    pushLog(state, 'good', `训练赛里你连着压过 ${him.ign}，教练点头了：接下来 ${TRIAL_MATCHES} 场正赛你先打。赢下来就是你的。`)
  } else {
    pushLog(state, won ? 'team' : 'info',
      `对位挑战 vs ${him.ign} ${live.sc[0]}:${live.sc[1]}${live.flash ? `，${live.flash} 波亮眼` : ''} —— ${won ? '赢了' : '输了'}，资本 ${me.edge.toFixed(1)}/${EDGE_NEED}。`)
  }
}

export function closeDuel(state: GameState): void {
  const me = state.me!
  if (me.duelLive?.done) me.duelLive = undefined
}

/** The post-mortem: the eight side by side, and what to practise tomorrow. */
export function duelCompare(state: GameState): { dim: string; mine: number; his: number }[] {
  const me = state.me!
  const live = me.duelLive
  if (!live) return []
  const mine = state.players[me.id]
  const him = state.players[live.himId]
  return ATTR_KEYS.map((k) => ({ dim: ATTR_CN[k], mine: mine.attrs[k], his: him.attrs[k] }))
}
