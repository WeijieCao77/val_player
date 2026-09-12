import { clamp } from '../rng'
import type { Rng } from '../rng'
import type { GameState, Role } from '../types'
import type { NodeDim } from './types'
import { tiltDrag } from './growth'
import { injuryHit } from './injury'
import { standingOptions } from './keyround'
import type { BranchKey, Buy, Premise, RoundBranch } from './keyround'
import type { FactKey } from './hints'
import { KEY_HINTS, KEY_HL, KEY_NODES } from './keynodes'

/** what a call changes on the round-strength scale (ROUND_SENS is 30) */
export const NODE_SWING = 4
/** the share of a call that is my own attribute rather than the four around me */
export const NODE_MINE = 0.7

/**
 * 关键回合 (2026-09-12). A call settles the round it is on: whether it lands
 * moves that round's win chance on the logit scale, and the round is drawn
 * from that on the spot. Why these numbers — the design draft's prototype
 * (策划稿 §6.5, A3r: the real round engine, 800 BO3s a cell):
 *
 *   KEY_OK / KEY_FAIL, +2.4 / −1.8 per unit of risk: at an even round a
 *   full-risk call that lands is ~92% and one that misses ~14%; a steady one
 *   (risk 0.45) ~75% / ~31%. The prototype's +2.4 / −2.0 made one call worth
 *   about ±5 points of a map and left "every call landed and we still lost" at
 *   29% of even series (target 20–30%). In the game (scripts/check_decisions.ts,
 *   1500 BO3s a cell, a VCT rookie): landing +4.5, missing −4.2, all landed and
 *   still lost 28.0%, the underdog winning with every call landing 44.6%
 *   (target 40–50) — but the favourite missing every call still won only 57.3%
 *   (target ≥60). −1.8 took that to 58.3 with a miss still worth −3.9; each
 *   further step buys about a point and walks a miss toward the −3 floor, and
 *   what is left is the 1v2, where a miss is the round by definition. So −1.8,
 *   and that band stays a point or two short. A miss costs a little less than a
 *   landing gains, so a player who reads the situation comes out ahead.
 *
 *   KEY_MOMENTUM, +2 strength for a call that lands, fading with the existing
 *   0.7 a round: the next rounds lean our way, small next to the round itself.
 */
export const KEY_OK = 2.4
export const KEY_FAIL = 1.8
export const KEY_MOMENTUM = 2
/**
 * 局面提示: the option the hint favours is this much likelier to land, the
 * other this much less. ±12 is what made reading the situation worth something
 * in the prototype (best play − random +5.5; +2.7 without a hint) while both
 * options still sit inside 35–85%.
 */
export const HINT_EDGE = 0.12
/**
 * How often the coach's pick is the option the hint favours: right more often
 * than not, never always (A3r, 65%). A hint now states something the screen can
 * back up (me/hints.ts), and the coach is not equally good at every kind of it.
 * What is on the round record, the buttons and the map — the buys, the run of
 * rounds, the five's averages, the ground, who is still standing — he gets right
 * COACH_READS_PLAIN of the time. What is between you and the man across from
 * you, and who has the hot hand tonight, he watches from behind the five and
 * gets COACH_READS_SUBTLE. A line from the old pool, which states no fact,
 * stays at COACH_READS. scripts/check_decisions.ts prints what that comes to
 * over a season of calls.
 */
export const COACH_READS = 0.65
export const COACH_READS_PLAIN = 0.8
export const COACH_READS_SUBTLE = 0.5
/**
 * 快进 and 托管 take the coach's pick with this much off its chance to land —
 * nobody is in the chair. In the prototype that put a skipped match about 4
 * points under following the coach by hand, about 9 under reading the hints
 * well, and about level with making no calls at all.
 */
export const AUTO_PENALTY = 0.10

/**
 * The chance a call made by 快进 or 托管 lands: the coach's pick less
 * AUTO_PENALTY, and never more than the chance at which the call does nothing
 * for its round on average. At that chance the logit moves +KEY_OK×risk as
 * often as −KEY_FAIL×risk balances it (for the 1v2, the round's own odds), so
 * a skipped match is the two rosters again, whatever the attributes say.
 *
 * A flat −10 was not enough (2026-09-12): a player grows into the 80s over a
 * career, his calls land 70–80% of the time, and a call made with nobody in the
 * chair still paid. Sixteen careers from the ladder, left entirely on 快进, to
 * retirement: before the key rounds came in 87.5% won a title (5.6 titles
 * each, 53.6% of starts won); with a flat −10, 100% (7.4, 58.9%); with this
 * cap, 87.5% again (6.3, 57.1%), its calls landing 44% of the time. Manual play
 * is untouched: following the coach by hand, 93.8% (9.1). In the match check
 * (a VCT rookie, 1500 BO3s a cell) best play − 快进 is +9.8 and following the
 * coach − 快进 +5.3 to +8.1.
 */
export function autoChance(manual: number, base: number, decides?: boolean): number {
  const neutral = decides ? base : KEY_FAIL / (KEY_OK + KEY_FAIL)
  return clamp(Math.min(manual - AUTO_PENALTY, neutral), 0.03, 0.97)
}
/** an opponent's point on the call's attribute counts half what a point of mine does, measured from 50 */
export const NODE_OPP = 0.5

export interface NodeCtx {
  round: number
  mine: number
  theirs: number
  lead: number
  pistol: boolean
  half: number
  ot: boolean
  mapPoint: 'mine' | 'theirs' | null
  mapIndex: number
  seriesMine: number
  seriesTheirs: number
  need: number
  isIntl: boolean
  role: Role
  form: number
  /** the agent I am on this map, in Chinese, so the screen can say 你今晚打欧门 */
  agent?: string
  /** my side attacks this round */
  attack: boolean
  /** which of the map's three key rounds this is */
  slot: KeySlot
  /** my side goes into this round with too little in the bank for anything but an eco (MapSim.bank) */
  shortBuy: boolean
  /** the map, by its English key */
  map: string
  /** what my side and theirs buy for this round — the same whichever way it goes */
  buyMine: Buy
  buyTheirs: Buy
  /** the round just played on this map as the round record shows it, from my side; null before the first and after a pistol round */
  last: { mine: Buy; theirs: Buy; won: boolean } | null
  /** rounds in a row taken by whoever took the last one: positive mine, negative theirs */
  streak: number
  /** this round played out on copies of the map, the four ways the call can go (me/keyround.ts) */
  branches: Record<BranchKey, RoundBranch>
  /** for a node that says who is standing: me and my side's count, and theirs, as asked */
  alive?: [number, number]
}

/** A map's three key rounds: one in each half, and one at match point or the first overtime round. */
export type KeySlot = 'half1' | 'half2' | 'point'

export interface NodeOpt { t: string; dim: NodeDim; risk: number }

/**
 * Where in a round a call happens: before the plant — the attack's way in or the
 * defence meeting it — the middle of the round, after the plant, a clutch, a
 * round decided by the buy, a match point, overtime.
 */
export type NodePhase = 'entry' | 'mid' | 'post' | 'clutch' | 'eco' | 'point' | 'ot'

/** Which key rounds a phase belongs in: a half's, the match point's, or either (a clutch can happen in both). */
export const PHASE_SLOT: Record<NodePhase, 'half' | 'point' | 'any'> = {
  entry: 'half', mid: 'half', post: 'half', eco: 'half', clutch: 'any', point: 'point', ot: 'point',
}

export interface NodeDef {
  id: string
  /** the question and its context; `{M}` is filled in with how many of theirs are standing, for a node that says */
  q: string
  ctx: string
  /** where in the round it happens; a map point and overtime take only the key round that is one */
  phase: NodePhase
  /** anything the premise below cannot say (the role I play, the score, my form) */
  when?: (c: NodeCtx) => boolean
  /**
   * What the node claims about its round — side, buys, the Spike, who is
   * standing, which match point — read at the call against the round played
   * out four ways (me/keyround.ts) and afterwards against the round record
   * (scripts/check_decisions.ts).
   */
  premise?: Premise
  /** which option each fact the screen can state favours (me/hints.ts); a fact the node has no entry for is not read out on it */
  lean?: Partial<Record<FactKey, number>>
  /**
   * 'fallback': asked only when no node written for the moment of the round fits.
   * 'retired': never asked again; kept so the calls in old saves keep their lines.
   */
  tier?: 'fallback' | 'retired'
  a: NodeOpt[]
  /** the steady choice — the coach's pick when there is no hint to read */
  rec: number
  /**
   * The premise is this very round: a 1v2 with me the last one standing. Such
   * a call settles the round it is about — landed, the round is ours; missed,
   * it is theirs — because "I lost the 1v2 and we won the round" cannot happen.
   * A map point is not one: the first contact can land and the round still go
   * (2026-09-12, 关键回合 — forcing both map points put half of all calls on a
   * coin that decided the round outright, and the extremes ran past the design).
   */
  decides?: boolean
}

/** a half's key round, not the one at match point or overtime */
const half = (c: NodeCtx) => c.slot !== 'point'

/**
 * Things that actually happen in a round, written so the choice is a thing you
 * would do, not an abstract dial. Each option is judged on one attribute; the
 * riskier one swings the round harder both ways.
 *
 * Each is asked only where its premise holds (2026-09-12): going in first only
 * on a round we attack, the 1v2 with the Spike planted only when we planted it,
 * holding a site only when we defend, 经济局 only when the bank says this round
 * is one, a map point or overtime only in the key round that is one. The three
 * key rounds themselves are picked in me/matchplay.ts.
 */
const FIRST_NODES: NodeDef[] = [
  // a pistol round never takes a call now (key rounds skip them); the node stays for its lines
  { id: 'pistol_rush', phase: 'entry', q: '手枪局。指挥问：五个人一起冲 B，还是分散拿信息？', ctx: '手枪局赢了，接下来两回合都是你们的经济。',
    when: (c) => c.pistol, rec: 1, tier: 'retired',
    a: [{ t: '冲，一波打穿', dim: 'reaction', risk: 0.9 }, { t: '分散拿信息，慢打', dim: 'awareness', risk: 0.4 }] },
  { id: 'entry', phase: 'entry', q: '烟还没起，你已经站在小道口。', ctx: '先手成了全队都能进，被反枪整回合就废了。',
    when: (c) => half(c) && c.attack && (c.role === '决斗者' || c.role === '先锋'), rec: 1,
    premise: { side: 'atk' }, lean: { duelUp: 0, duelDown: 1, theirBroke: 0, theirSaved: 1 },
    a: [{ t: '先手，不等了', dim: 'reaction', risk: 0.95 }, { t: '等道具到位再进', dim: 'utility', risk: 0.45 }] },
  { id: 'eco_gun', phase: 'eco', q: '经济局，队友把唯一一把大枪递给了你。', ctx: '拿枪就是全队指望你一个人打开局面。',
    when: (c) => half(c) && c.shortBuy, rec: 0, lean: { duelUp: 0, duelDown: 1, longLines: 0 },
    a: [{ t: '拿枪，我来打', dim: 'aim', risk: 0.8 }, { t: '别买了，五人轻甲一起冲', dim: 'teamwork', risk: 0.5 }] },
  { id: 'clutch', phase: 'clutch', q: '1v2，辐能芯片已经安装好了，对面两个人在点位两侧。', ctx: '他们拆除之前，你必须先解决一个。',
    when: (c) => half(c) && c.attack, rec: 0, decides: true,
    premise: { side: 'atk', planted: true, alive: { mine: 1, theirs: [2, 2] } }, lean: { duelUp: 0, duelDown: 1 },
    a: [{ t: '打，先找一个', dim: 'clutch', risk: 1.0 }, { t: '藏起来，等他们来拆', dim: 'awareness', risk: 0.6 }] },
  { id: 'behind_to', phase: 'entry', q: '落后暂停，指挥说完了战术，所有人看着你。', ctx: '这时候语音里最需要有人说话。',
    when: (c) => half(c) && c.lead <= -4, rec: 0, lean: { streakThem: 0, meHot: 1, meCold: 0 },
    a: [{ t: '喊一嗓子，把人拉回来', dim: 'communication', risk: 0.7 }, { t: '不说话，自己先打好', dim: 'aim', risk: 0.6 }] },
  { id: 'behind_site', phase: 'mid', q: '对面已经连着三回合压你这个点。', ctx: '他们盯上你了。',
    when: (c) => half(c) && !c.attack && c.lead <= -3, rec: 0,
    premise: { side: 'def' }, lean: { streakThem: 0, duelUp: 1, duelDown: 0 },
    a: [{ t: '换个位置，让他们扑空', dim: 'awareness', risk: 0.5 }, { t: '硬守，正面刚', dim: 'clutch', risk: 0.9 }] },
  { id: 'ahead_rush', phase: 'entry', q: '领先不少，队友想直接一波冲进去收工。', ctx: '稳一点也能赢，但会拖很久。',
    when: (c) => half(c) && c.attack && c.lead >= 4, rec: 1,
    premise: { side: 'atk' }, lean: { theirBroke: 0, theirSaved: 1, streakUs: 0 },
    a: [{ t: '冲，速战速决', dim: 'reaction', risk: 0.7 }, { t: '按道具慢打，别送', dim: 'utility', risk: 0.35 }] },
  { id: 'map_point_mine', phase: 'point', q: '赛点。指挥把最后一波的先手交给了你。', ctx: '这一回合结束了，这张图就结束了。',
    when: (c) => c.slot === 'point' && c.mapPoint === 'mine', rec: 0,
    premise: { point: 'mine' }, lean: { meHot: 0, meCold: 1, streakThem: 1 },
    a: [{ t: '给我，我来', dim: 'mental', risk: 1.0 }, { t: '按体系打，别改', dim: 'teamwork', risk: 0.45 }] },
  { id: 'map_point_theirs', phase: 'point', q: '对面赛点，暂停时语音里没人说话。', ctx: '这时候要有人站出来。',
    when: (c) => c.slot === 'point' && c.mapPoint === 'theirs', rec: 1,
    premise: { point: 'theirs' }, lean: { meHot: 0, meCold: 1 },
    a: [{ t: '这波交给我', dim: 'mental', risk: 1.0 }, { t: '别慌，按流程打一回合', dim: 'teamwork', risk: 0.5 }] },
  { id: 'ot', phase: 'ot', q: '加时。你发现自己的手在抖。', ctx: '这个舞台比训练赛大得多。',
    when: (c) => c.slot === 'point' && c.ot, rec: 0,
    premise: { point: 'ot' }, lean: { streakUs: 1, streakThem: 0 },
    a: [{ t: '深呼吸，按流程走', dim: 'mental', risk: 0.5 }, { t: '用一波激进的开局逼自己进状态', dim: 'aim', risk: 0.95 }] },
  { id: 'first_map', phase: 'entry', q: '今晚第一个关键回合。你把鼠标垫又擦了一遍，手心还是湿的。', ctx: '这一回合决定你今晚的心态。',
    when: (c) => c.slot === 'half1' && c.mapIndex === 0, rec: 0, lean: { duelUp: 1, duelDown: 0 },
    a: [{ t: '按流程，稳住', dim: 'mental', risk: 0.4 }, { t: '这回合一开局就去找人', dim: 'reaction', risk: 0.9 }] },
  { id: 'hot', phase: 'entry', q: '今天手感烫得离谱，什么都能打中。', ctx: '这种手感一年遇不到几次。',
    when: (c) => half(c) && c.form >= 80, rec: 0, lean: { duelUp: 0, duelDown: 1, theyHot: 1 },
    a: [{ t: '把资源都要过来', dim: 'aim', risk: 0.9 }, { t: '别飘，按体系打', dim: 'teamwork', risk: 0.4 }] },
  { id: 'cold', phase: 'entry', q: '今天怎么打都不对，简单的枪都在漏。', ctx: '队友已经开始帮你兜了。',
    when: (c) => half(c) && c.form <= 58, rec: 0, lean: { meCold: 0, theyHot: 0 },
    a: [{ t: '认了，让队友多拿枪', dim: 'communication', risk: 0.4 }, { t: '硬扛，我能找回来', dim: 'mental', risk: 1.0 }] },
  { id: 'intl', phase: 'entry', q: '国际赛的观众声浪比联赛大一个量级，你能听见自己的心跳。', ctx: '这就是你想来的地方。',
    when: (c) => c.slot === 'half1' && c.isIntl, rec: 0, lean: { duelUp: 1, duelDown: 0 },
    a: [{ t: '享受它', dim: 'mental', risk: 0.6 }, { t: '戴上降噪，只管枪', dim: 'aim', risk: 0.5 }] },
  { id: 'save', phase: 'clutch', q: '这回合快输了，队友喊 save，你觉得还能赌一把。', ctx: '保住枪下回合是满配，赌成了是回合。',
    when: (c) => half(c), rec: 1, lean: { duelUp: 0, duelDown: 1, theyHot: 1 },
    a: [{ t: '赌，冲上去', dim: 'clutch', risk: 0.9 }, { t: '听队友的，保枪', dim: 'awareness', risk: 0.35 }] },
  { id: 'info', phase: 'mid', q: '对面有人在你这边露了头，队友问要不要跟。', ctx: '跟上去可能二打二，也可能被夹。',
    when: (c) => half(c), rec: 1, lean: { duelUp: 0, duelDown: 1, theyHot: 1 },
    a: [{ t: '跟，打这波', dim: 'reaction', risk: 0.85 }, { t: '退，报点就行', dim: 'awareness', risk: 0.4 }] },
]

/**
 * Every node. The sixteen above came first and were written for no moment of
 * the round in particular; the key-round nodes written by phase (me/keynodes.ts)
 * are asked first, and these only when none of those fits a key round.
 */
export const NODES: NodeDef[] = [
  ...FIRST_NODES.map((n): NodeDef => (n.tier ? n : { ...n, tier: 'fallback' })),
  ...KEY_NODES,
]

/** The parts of a premise the moment itself answers: side, buys, which match point. */
function premiseMoment(p: Premise | undefined, c: NodeCtx): boolean {
  if (!p) return true
  if (p.side && (p.side === 'atk') !== c.attack) return false
  if (p.buyMine && !p.buyMine.includes(c.buyMine)) return false
  if (p.buyTheirs && !p.buyTheirs.includes(c.buyTheirs)) return false
  if (p.point === 'ot' && !(c.slot === 'point' && c.ot)) return false
  if ((p.point === 'mine' || p.point === 'theirs') && !(c.slot === 'point' && c.mapPoint === p.point)) return false
  return true
}

/** A node that fits the key round, with the counts of theirs it may say are standing ([-1] when it says nothing about that). */
export interface KeyCandidate { node: NodeDef; standing: number[] }

/**
 * Every node that can be asked in this key round: in its phase's key rounds,
 * its premise true of the moment, and — for the Spike and who is standing —
 * true of every way its round can go. The nodes written for a moment of the
 * round come first; the fallbacks only when none of those fit.
 */
export function keyCandidates(c: NodeCtx): KeyCandidate[] {
  const out: KeyCandidate[] = []
  for (const n of NODES) {
    if (n.tier === 'retired') continue
    const where = PHASE_SLOT[n.phase]
    if (where !== 'any' && (where === 'point') !== (c.slot === 'point')) continue
    if (!premiseMoment(n.premise, c)) continue
    try { if (n.when && !n.when(c)) continue } catch { continue }
    const standing = n.premise ? standingOptions(n.premise, c.branches, c.attack, n.decides) : [-1]
    if (standing.length) out.push({ node: n, standing })
  }
  const written = out.filter((x) => x.node.tier !== 'fallback')
  return written.length ? written : out
}

/**
 * One of them: a phase first, evenly among the phases that have a node here,
 * then a node in it — so a moment with five ways in does not crowd out the
 * clutch or the eco round that also fits. Nodes not yet asked this match come
 * first.
 */
export function pickKeyNode(cands: KeyCandidate[], seen: Set<string>, rng: Rng): KeyCandidate {
  const fresh = cands.filter((x) => !seen.has(x.node.id))
  const pool = fresh.length ? fresh : cands
  const phases: NodePhase[] = []
  for (const x of pool) if (!phases.includes(x.node.phase)) phases.push(x.node.phase)
  const ph = phases[rng.int(0, phases.length - 1)]
  const inPhase = pool.filter((x) => x.node.phase === ph)
  return inPhase[rng.int(0, inPhase.length - 1)]
}

/** a count of players in words, as the start of 两打三 and the end of 三打二 read it */
export const countCn = (n: number, tail = false): string => (n === 2 ? (tail ? '二' : '两') : ['零', '一', '两', '三', '四', '五'][n] ?? String(n))

/** A node's question or context as asked: `{M}` is how many of theirs are standing. */
export const nodeText = (s: string, alive?: [number, number]): string =>
  alive ? s.replace(/\{M\}/g, countCn(alive[1])) : s

export const DIM_CN: Record<NodeDim, string> = {
  aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
  clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥', mental: '心态',
}

/**
 * The odds of a call landing. Seven tenths me, three tenths the four around
 * me — one man does not carry four — and the riskier option really is less
 * likely, not just swingier. Nerve helps; tilt hurts.
 *
 * The other five count as well (2026-09-12). The button had always shown their
 * average on the same attribute and the odds never read it. It counts half what
 * my own number does, measured from 50: against a VCT five on 86 a call is about
 * ten points harder than it was, against a weak five a little easier. 心态 is
 * nerve, and that is mine alone.
 */
export function nodeChance(state: GameState, opt: NodeOpt, teamId?: string, oppTeamId?: string): number {
  const me = state.me!
  const p = state.players[me.id]
  const mates = (state.teams[teamId ?? state.myTeam]?.starters ?? [])
    .filter((id) => id !== me.id)
    .map((id) => state.players[id])
    .filter(Boolean)
  let v: number
  let opp = 0
  // hurt: a call made on what the injury gets in the way of is harder (me/injury.ts)
  if (opt.dim === 'mental') v = me.mental + injuryHit(state, 'mental')
  else {
    const dim = opt.dim
    const mine = p.attrs[dim] + injuryHit(state, dim)
    const avg = mates.length ? mates.reduce((s, m) => s + m.attrs[dim], 0) / mates.length : mine
    v = mine * NODE_MINE + avg * (1 - NODE_MINE)
    const five = oppTeamId ? (state.teams[oppTeamId]?.starters ?? []).map((id) => state.players[id]).filter(Boolean) : []
    if (five.length) opp = ((five.reduce((s, x) => s + x.attrs[dim], 0) / five.length - 50) / 100) * 0.55 * NODE_OPP
  }
  // a cool head adds a little; a trait may add more. Gear used to add 0.4% a tier here — money
  // reaching into the match — until the economy was measured (me/shop.ts, 2026-09-11)
  const edge = me.traits?.includes('edge') && (p.form < 70 || me.tilt > 40) ? 0.03 : 0
  return clamp(
    0.30 + (v / 100) * 0.55 - opp - (opt.risk - 0.5) * 0.15 + (me.mental - 50) / 500 - tiltDrag(me) / 60 + edge,
    0.12, 0.92,
  )
}

/**
 * The numbers behind a call, for the screen: what I bring on the attribute it
 * is judged on, what the four around me average, and what the other five
 * average on the same one. An attribute is only real once the player can see
 * it lined up against somebody.
 */
export function nodeReadout(
  state: GameState, opt: NodeOpt, teamId?: string, oppTeamId?: string,
): { mine: number; mates: number | null; theirs: number | null } {
  const me = state.me!
  const p = state.players[me.id]
  if (opt.dim === 'mental') return { mine: Math.round(me.mental), mates: null, theirs: null }
  const dim = opt.dim
  const avgOf = (ids: string[]) => {
    const rows = ids.map((id) => state.players[id]).filter(Boolean)
    return rows.length ? Math.round(rows.reduce((s, m) => s + m.attrs[dim], 0) / rows.length) : null
  }
  const mates = avgOf((state.teams[teamId ?? state.myTeam]?.starters ?? []).filter((id) => id !== me.id))
  const theirs = oppTeamId ? avgOf(state.teams[oppTeamId]?.starters ?? []) : null
  return { mine: Math.round(p.attrs[dim]), mates, theirs }
}

/**
 * 局面提示: one thing the screen reads out before a call, and which option it
 * favours. What it says is how the other five play this map — their habits,
 * where their utility went, who is looking at your line — so it can be read
 * and weighed, and it is real in the only way that counts: the favoured option
 * really is HINT_EDGE likelier to land, the other one HINT_EDGE less. Nothing
 * here claims what this round's buys, kills or ending will be: the round record
 * beside it would contradict that.
 *
 * NODE_HINTS[id][i] are lines that favour option i. A node with none (the
 * pistol round, which no longer takes a call) gets no hint and no edge.
 */
export const NODE_HINTS: Record<string, string[][]> = {
  entry: [
    ['对面这张图守小道的人习惯靠后站，先手的那一枪来得及。', '上回合对面的烟雾和闪光都交在了另一边，这边手里是空的。'],
    ['对面上两回合都在小道口放了陷阱，冒进去就是送。', '对面这张图喜欢在小道口双人架枪，没有闪光进不去。'],
  ],
  eco_gun: [
    ['对面守这个点喜欢站远点，一把长枪就能把远处的枪线架住。', '对面在这个点只留了一个人看，长枪先手就能打开。'],
    ['对面这张图喜欢分散守点，五个人一起冲，哪里都是以多打少。', '对面的人习惯躲在近点，手枪贴脸也打得过。'],
  ],
  clutch: [
    ['两个人一左一右，中间隔着一道墙，谁也看不到谁。', '其中一个的脚步声就在你左边，他还不知道你在这。'],
    ['他们两个人贴在一起走，正面找只会吃交叉火力。', '他们习惯先清角落再拆除，拆的那一下总是背对着角落。'],
  ],
  behind_to: [
    ['语音里已经有两个人在互相埋怨，这时候需要一个声音。', '暂停时大家都低着头，没人愿意先开口。'],
    ['指挥已经把话说完了，再多一个声音只会乱。', '这几个队友吃「看你打」这一套，一个漂亮的回合比十句话管用。'],
  ],
  behind_site: [
    ['对面三回合打的都是同一个时间点，他们还会再来。', '对面每次都是先交闪光再冲，躲开这一下就是个空点。'],
    ['对面这三回合冲进来的都是同一个人，他的枪不算快。', '对面每次进点的技能都交得太早，硬守能等到他们手里没东西。'],
  ],
  ahead_rush: [
    ['对面刚刚连着输，站位还没调整过来。', '对面这张图防守时，前半段总是缩在点里。'],
    ['对面落后之后喜欢前压抢节奏，冲进去正撞枪口。', '对面还有一个终极技能没交，慢慢逼出来再进。'],
  ],
  map_point_mine: [
    ['对面暂停之后换了站位，老套路打过去正好撞上。', '对面这几回合一直在针对你们的默认打法。'],
    ['对面紧张了，上回合有两个人提前暴露了位置。', '你们这套打法，对面这张图还没接住过一次。'],
  ],
  map_point_theirs: [
    ['对面觉得你们已经散了，站位压得很靠前。', '对面这几回合一直在盯你的队友，没人看你那条线。'],
    ['对面急着收图，这一回合多半会冒进。', '对面这张图还没打穿过你们完整的一回合。'],
  ],
  ot: [
    ['加时的对面也在紧张，谁先犯错谁输。', '对面加时习惯打得很慢，稳住就能耗到他们出错。'],
    ['对面加时第一回合总是缩着打，前压能抢到先手。', '对面的人加时手也在抖，枪线上的反应慢了半拍。'],
  ],
  first_map: [
    ['对面开场就在找你的位置，急着出去正好撞枪。', '今晚对面的开局打得很慢，不用急。'],
    ['对面今晚的开局总是把人压得很散，先找到一个就占住了。', '对面开局喜欢把最弱的一个人放在你这条线上。'],
  ],
  hot: [
    ['对面还没发现你今天手这么热，站位完全没针对你。', '对面这张图只放了一个人看你这条线。'],
    ['对面已经开始针对你了，两个人在盯你的位置。', '对面这回合的技能多半全冲着你这边来。'],
  ],
  cold: [
    ['队友今天手都很热，枪让出去不亏。', '对面在盯你这条线，你退一步他们就扑空。'],
    ['对面没把你当回事，你那条线只站了一个人。', '你的状态差是手紧，打开一两枪就好了。'],
  ],
  intl: [
    ['全场的声浪都在给你们加油，像主场一样。', '队友报点的声音够大，声浪盖不住。'],
    ['场馆的回音很重，语音里的报点有点糊。', '对面的应援声压过了你们，越听越乱。'],
  ],
  save: [
    ['对面剩下的人正分头清角落，谁也顾不上谁。', '对面剩下的人手里都是便宜的枪，赌赢了就是一回合。'],
    ['对面剩下的人抱在一起，冲上去就是一换二。', '对面还有人没露面，冲上去多半被夹。'],
  ],
  info: [
    ['露头的那个人是对面枪最慢的一个，身边没人补。', '对面这张图喜欢一个人单独摸过来找信息。'],
    ['对面这张图喜欢拿一个人露头，把人骗出去再夹。', '露头的那一下之后，你听到了第二个人的脚步。'],
  ],
  ...KEY_HINTS,
}

/** The hint's line, NODE_HINTS[id][fav][k], or null when the call had none. */
export function hintText(id: string, fav: number | undefined, k: number | undefined): string | null {
  if (fav == null || k == null || fav < 0 || k < 0) return null
  return NODE_HINTS[id]?.[fav]?.[k] ?? null
}

const sig = (x: number) => 1 / (1 + Math.exp(-x))
const logit = (p: number) => Math.log(p / (1 - p))

/**
 * This round's win chance for my side once a call has landed or not, from the
 * chance it had before — the two rosters, the map's own swing, the momentum
 * in hand (MapSim.roundEstimate). A call whose premise is this very round is
 * the round: landed, ours; missed, theirs.
 */
export function keyRoundOdds(base: number, risk: number, decides?: boolean): { ok: number; fail: number } {
  if (decides) return { ok: 1, fail: 0 }
  const l = logit(clamp(base, 0.02, 0.98))
  return { ok: sig(l + KEY_OK * risk), fail: sig(l - KEY_FAIL * risk) }
}

/** The stakes of an option in words, for when the 「数值」 switch is off. */
export function stakeWords(ok: number, fail: number, decides?: boolean): string {
  if (decides) return '成了就拿下，没成就丢了'
  return `${ok >= 0.7 ? '成了这回合多半是我们的' : '成了这回合也很悬'}；${fail <= 0.3 ? '没成基本就丢了' : '没成这回合很悬'}`
}

/** what the screen calls each key round */
export const SLOT_CN: Record<KeySlot, string> = { half1: '上半场关键回合', half2: '下半场关键回合', point: '赛点关键回合' }

/**
 * What a call looks like from the seat next to you, told once the round it was
 * about has been played. Four cases for each option of each node — landed and
 * the round taken, landed and lost anyway, missed and taken anyway, missed and
 * lost — so a line never says the round went one way while the round record
 * right above it says the other (「做出正确选择显示我把人都杀完了，结果这个回合
 * 却输了」, 2026-09-12: a line picked before the round existed was contradicted
 * by it one call in eight).
 *
 * A line that says I killed somebody belongs to a kill-count set: `k0` is read
 * when I had none in that round, `k1` when I had at least one (exactly one when
 * the set has a `k2`), `k2` when I had two or more. A plain string says nothing
 * about my kills. No line says how the round ended — the record says 全歼 or
 * 拆除 — or that the map is over: narrate adds that from the score.
 *
 * A node that `decides` its round has no okLoss or failWin, because they cannot
 * happen. scripts/check_decisions.ts reads every line against its round.
 */
export type KillSet = { k0: string; k1: string; k2?: string }
export type HlText = string | KillSet
export interface HlOpt { okWin: HlText; okLoss?: HlText; failWin?: HlText; failLoss: HlText }

export const NODE_HL: Record<string, HlOpt[]> = {
  pistol_rush: [
    {
      okWin: { k0: '手枪局五个人一起压进去，你跟在后面补位，冲锋一口气打穿，手枪局拿下。', k1: '手枪局五个人一起压进去，你在拐角放倒一个，冲锋一口气打穿，手枪局拿下。', k2: '手枪局五个人一起压进去，你在拐角连着放倒两个，手枪局拿下。' },
      okLoss: { k0: '冲锋的时机是对的，可对面补位的枪更快，手枪局没拿下。', k1: '冲锋的时机是对的，你也放倒了一个，可对面补位的枪更快，手枪局没拿下。' },
      failWin: '五个人挤在一条道上被架住，冲锋停在了拐角——好在绕过去的队友接上了，手枪局还是拿下。',
      failLoss: '五个人挤在一条道上被架住，冲锋停在了第一个拐角，手枪局丢了。',
    },
    {
      okWin: '你们散开摸清了对面的站位，再一处一处压过去，手枪局拿下。',
      okLoss: '信息拿到了，对面站在哪一清二楚，可几次对枪都慢了半拍，手枪局没拿下。',
      failWin: '散得太开，信息没传回来，好在正面的对枪赢了，手枪局照样拿下。',
      failLoss: '散得太开，信息没拿到，几路人互相接不上，手枪局丢了。',
    },
  ],
  entry: [
    {
      okWin: { k0: '你先探出去逼出了对面的枪位，身后四个人顺着压进点，这回合拿下。', k1: '你先手放倒一个，身后四个人跟着压进点，这回合拿下。', k2: '你先手连着放倒两个，身后四个人几乎是走进点的，这回合拿下。' },
      okLoss: { k0: '你先探出去逼退了架枪的人，可补枪没跟上，这回合还是丢了。', k1: '你先手放倒一个撕开了口子，可补枪没跟上，这回合还是丢了。' },
      failWin: '先手没打出来，你被逼回了小道口，队友用技能把点重新撕开，这回合还是拿下。',
      failLoss: '先手没打出来，你被逼回了小道口，进点的节奏断了，这回合丢了。',
    },
    {
      okWin: '你压住了自己，等烟和闪光都落稳才进，五个人一起压上去，这回合拿下。',
      okLoss: '烟和闪光都到位了，五个人一起进，可对面反应更快，这回合还是丢了。',
      failWin: '等道具的这几秒，对面已经架好了枪，进点变成了硬啃——还是啃了下来，这回合拿下。',
      failLoss: '等道具的这几秒，对面已经架好了枪，进点变成了硬啃，这回合丢了。',
    },
  ],
  eco_gun: [
    {
      okWin: { k0: '你拿着全队唯一一把长枪卡住了关键的枪线，对面不敢往前走，这回合拿下。', k1: '全队唯一一把长枪在你手里，你用它放倒一个打开了局面，这回合拿下。', k2: '全队唯一一把长枪在你手里，你连着放倒两个，这回合硬是拿下。' },
      okLoss: { k0: '长枪在你手里架住了一条路，可别的路被打穿了，这回合没翻过来。', k1: '长枪在你手里放倒了一个，可一把枪撑不起五个人，这回合没翻过来。' },
      failWin: '全队指望的那把长枪没能打开局面，倒是队友拿着手枪抢到了位置，这回合反而拿下。',
      failLoss: '全队指望的那把长枪没能打开局面，这回合交了出去。',
    },
    {
      okWin: '五把手枪套着轻甲一起冲，靠人数把点撕开，这回合拿下。',
      okLoss: '五个人轻甲一起冲，时机是对的，可枪械的差距摆在那里，这回合没翻过来。',
      failWin: '五个人轻甲冲上去，阵型被打散了，剩下的时间里队友硬是磨了下来，这回合拿下。',
      failLoss: '五个人轻甲冲上去，被长枪的枪线顶了回来，这回合交了出去。',
    },
  ],
  clutch: [
    {
      okWin: { k0: '你往前压了一步，把两个人的位置逼得一清二楚，他们谁都没敢去碰芯片，这回合拿下。', k1: '你先找到一个放倒，剩下那个被你的枪线逼得不敢去拆，这回合拿下。', k2: '你先找到一个放倒，转身又把第二个等了出来，两个都是你收的，这回合拿下。' },
      failLoss: { k0: '你想先找一个，刚探头就被两边同时夹住，这回合丢了。', k1: '你先放倒了一个，第二个从另一侧绕了过来，1v2 没收住，这回合丢了。' },
    },
    {
      okWin: { k0: '你藏在他们想不到的角落，一直没暴露，他们在拆除和找人之间犹豫到了最后，这回合拿下。', k1: '你藏住了，等他们蹲下拆除的那一下才出枪，放倒一个，剩下那个没敢再碰芯片，这回合拿下。', k2: '你藏住了，等他们来拆除的那一下出枪，两个都倒在芯片旁边，这回合拿下。' },
      failLoss: '藏得太久，等你探出头，局面已经被他们收拾干净了，这回合丢了。',
    },
  ],
  behind_to: [
    {
      okWin: '暂停回来，你在语音里把节奏喊了回来，五个人重新站到一起，这回合拿下。',
      okLoss: '暂停回来，你在语音里把大家喊醒了，打得也有章法，这回合还是丢了。',
      failWin: '你喊了一嗓子，语音里没人接话——好在手上没乱，这回合还是拿下。',
      failLoss: '你喊了一嗓子，语音里没人接话，暂停回来的这一回合也丢了。',
    },
    {
      okWin: { k0: '你没说话，每一个位置都站得很稳，队友看着你的节奏跟了上来，这回合拿下。', k1: '你没说话，一枪放倒一个，用枪把队友重新打醒了，这回合拿下。' },
      okLoss: { k0: '你没说话，自己那条线守得很稳，可别的线被打穿了，这回合还是丢了。', k1: '你没说话，放倒了一个，自己的枪是热的，这回合还是丢了。' },
      failWin: '你闷头打自己的，语音里还是一片安静，好在这回合还是拿下。',
      failLoss: '你闷头打自己的，语音里还是一片安静，这回合也丢了。',
    },
  ],
  behind_site: [
    {
      okWin: '你换了位置，他们第四次压过来的时候扑了个空，这回合拿下。',
      okLoss: '你换了位置，他们果然又压过来扑了个空，可转点太快没接上，这回合还是丢了。',
      failWin: '你换了位置，他们这回合偏偏没来，你守了个空——好在另一边顶住了，这回合拿下。',
      failLoss: '你换了位置，结果他们这回合压的正是你新站的那边，这回合丢了。',
    },
    {
      okWin: { k0: '你硬守在原位，用技能和枪线把第四次进攻拖住，等来了回防的队友，这回合拿下。', k1: '你硬守在原位，正面放倒一个，把第四次进攻顶了回去，这回合拿下。', k2: '你硬守在原位，正面连着放倒两个，第四次进攻被你一个人顶了回去，这回合拿下。' },
      okLoss: { k0: '你硬守在原位拖了很久，可他们人多，这回合还是丢了。', k1: '你正面放倒了一个，可他们人多，这回合还是丢了。' },
      failWin: '你还守在老位置，他们第四次压过来，人比上次多，你没顶住——好在回防的队友把点抢了回来，这回合拿下。',
      failLoss: '你还守在老位置，他们第四次压过来，人比上次多，这回合丢了。',
    },
  ],
  ahead_rush: [
    {
      okWin: '一波压上去，对面还没站好位置，速战速决，这回合拿下。',
      okLoss: '一波压上去，时机没错，可对面的反应更快，这回合还是丢了。',
      failWin: '冲得太急，阵型在拐角散了，好在队友补了上来，这回合还是拿下。',
      failLoss: '冲得太急，被架住反打了一波，这回合交了出去。',
    },
    {
      okWin: '按道具一步一步推，没给对面任何机会，这回合稳稳拿下。',
      okLoss: '按道具一步一步推，每一步都没出错，可对面这回合的枪就是更准，还是丢了。',
      failWin: '打得太慢，时间快到了才进点，进得很别扭——还是进下来了，这回合拿下。',
      failLoss: '打得太慢，时间快到了才进点，进得很别扭，这回合丢了。',
    },
  ],
  map_point_mine: [
    {
      okWin: { k0: '最后一波先手交给你，你第一个探出去把枪位逼了出来，队友顺着把点打开，赛点收下。', k1: '最后一波先手交给你，你放倒一个打开了口子，赛点收下。', k2: '最后一波先手交给你，你连着放倒两个，赛点收下。' },
      okLoss: { k0: '最后一波先手交给你，你第一个探出去逼出了枪位，可队友没跟上来，赛点没收住。', k1: '最后一波先手交给你，你放倒一个打开了口子，可补枪慢了一步，赛点没收住。' },
      failWin: '最后一波先手交给你，你没能打开局面，是队友从另一边绕进去，把赛点收下了。',
      failLoss: { k0: '最后一波先手交给你，可你没能打开局面，赛点从手里溜走了。', k1: '最后一波先手交给你，你放倒了一个，可口子没撕开，赛点从手里溜走了。' },
    },
    {
      okWin: '按体系打完最后一回合，谁都没有多做动作，赛点收下。',
      okLoss: '按体系打，每个人的位置都没错，可对面这回合的枪就是更准，赛点没收住。',
      failWin: '按体系打，对面早把这套看透了——还好有人临场改了一步，赛点还是收下。',
      failLoss: '按体系打，可对面早把这套看透了，赛点没收住。',
    },
  ],
  map_point_theirs: [
    {
      okWin: { k0: '对面赛点，你站出来要了这一波，队友跟着你的节奏打，把这回合抢了回来。', k1: '对面赛点，你站出来放倒一个，把这回合抢了回来。', k2: '对面赛点，你站出来连着放倒两个，把这回合抢了回来。' },
      okLoss: { k0: '对面赛点，你站出来要了这一波，节奏也打出来了，最后还是没扛住。', k1: '对面赛点，你站出来放倒一个，可这一波最后还是没扛住。' },
      failWin: '对面赛点，你要来的这一波没打出来，队友替你把这回合抢了回来。',
      failLoss: { k0: '对面赛点，你站出来要了这一波，没扛住。', k1: '对面赛点，你放倒了一个，这一波还是没扛住。' },
    },
    {
      okWin: '对面赛点，五个人按流程打了一回合，稳住了，把这回合抢了回来。',
      okLoss: '对面赛点，五个人按流程打得一步不乱，可对面的枪更快，没扛住。',
      failWin: '对面赛点，按流程走，每一步都被对面算到了——最后一个人硬是把这回合抢了回来。',
      failLoss: '对面赛点，五个人按流程走，每一步都被对面算到了，没扛住。',
    },
  ],
  ot: [
    {
      okWin: '加时，你深呼吸，按流程走，手稳了下来，这回合拿下。',
      okLoss: '加时，你深呼吸，把手稳了下来，打得没毛病，这回合还是丢了。',
      failWin: '加时，深呼吸也没压住手抖，好在队友稳，这回合拿下。',
      failLoss: '加时，深呼吸也没压住手抖，这回合丢了。',
    },
    {
      okWin: { k0: '加时，你用一波激进的前压把自己逼进了状态，对面被压得不敢出头，这回合拿下。', k1: '加时，你一波激进的前压放倒一个，手不抖了，这回合拿下。' },
      okLoss: { k0: '加时，你前压逼自己进了状态，手不抖了，这回合还是丢了。', k1: '加时，你前压放倒一个，手不抖了，这回合还是丢了。' },
      failWin: '加时的激进开局冲得太猛，你被逼退了回来，好在队友把这回合扛了下来，拿下。',
      failLoss: '加时的激进开局冲得太猛，节奏乱了，这回合丢了。',
    },
  ],
  first_map: [
    {
      okWin: '开局按流程走，心跳慢了下来，这回合拿下。',
      okLoss: '开局按流程走，心态是稳的，这回合没拿下，人也没乱。',
      failWin: '按流程打，手还是有点僵，好在这回合还是拿下。',
      failLoss: '按流程打，手还是有点僵，这回合丢了。',
    },
    {
      okWin: { k0: '开局就去找人，你先摸清了对面的位置，队友顺着你的报点打，这回合拿下。', k1: '开局就去找人，你先找到对面，放倒一个，这回合拿下。' },
      okLoss: { k0: '开局就去找人，你先摸清了对面的位置，可信息没换成回合，这回合丢了。', k1: '开局就去找人，你先放倒一个，这回合还是丢了。' },
      failWin: '开局就去找人，却被对面先发现，你退了回来——这回合还是拿下。',
      failLoss: '开局就去找人，却被对面先发现，这回合丢了。',
    },
  ],
  hot: [
    {
      okWin: { k0: '资源都给了你，你占着最好的枪线，对面没人敢从你那边过，这回合拿下。', k1: '资源都给了你，你没浪费，放倒一个，这回合拿下。', k2: '资源都给了你，你一个人就放倒两个，这回合拿下。' },
      okLoss: { k0: '资源都给了你，你那条线守得纹丝不动，可别的线漏了，这回合丢了。', k1: '资源都给了你，你放倒了一个，可其他人没接住，这回合丢了。' },
      failWin: '要了资源，手感却在这一回合凉了一下，好在队友接住了，这回合拿下。',
      failLoss: '要了资源，手感却在这一回合凉了，这回合丢了。',
    },
    {
      okWin: '手感烫也没飘，按体系打，这回合赢得很稳，拿下。',
      okLoss: '手感烫也没飘，按体系打，打法没毛病，这回合是对面更准，丢了。',
      failWin: '手感这么烫却按体系打，好几次机会从眼前过去——这回合还是拿下。',
      failLoss: '手感这么烫却按体系打，机会从眼前过去，这回合丢了。',
    },
  ],
  cold: [
    {
      okWin: '认了状态差，把好位置让给队友，你在后面报点补位，这回合反而顺了，拿下。',
      okLoss: '你把好位置让了出去，自己报点补位，配合是顺的，这回合还是丢了。',
      failWin: '把位置让出去了，队友也没打顺——最后磕磕绊绊，这回合还是拿下。',
      failLoss: '把位置让出去了，队友这回合也没打好，丢了。',
    },
    {
      okWin: { k0: '你硬扛着站在前面，枪还没开张，位置一步没退，这回合拿下。', k1: '硬扛的这一回合，你放倒一个，手感找回来了，这回合拿下。' },
      okLoss: { k0: '硬扛的这一回合心态稳住了，枪还没开张，这回合丢了。', k1: '硬扛的这一回合，你放倒一个，手感找回来一点，这回合还是丢了。' },
      failWin: '硬扛的这一回合，简单的枪又漏了，好在队友兜住了，这回合拿下。',
      failLoss: '硬扛的这一回合，简单的枪又漏了，这回合丢了。',
    },
  ],
  intl: [
    {
      okWin: '声浪里你还是听得见自己的报点，这回合拿下，全场都在喊。',
      okLoss: '你把声浪当成了背景，节奏一点没乱，这回合还是丢了。',
      failWin: '想享受，声浪却把你的节奏冲乱了，好在队友稳住，这回合拿下。',
      failLoss: '想享受，声浪却把你的节奏冲乱了，这回合丢了。',
    },
    {
      okWin: { k0: '戴上降噪，世界只剩脚步和枪声，你的站位干净利落，这回合拿下。', k1: '戴上降噪，世界只剩枪声，你放倒一个，这回合拿下。' },
      okLoss: { k0: '戴上降噪，你打得很专注，这回合还是丢了。', k1: '戴上降噪，你打得很干净，放倒一个，这回合还是丢了。' },
      failWin: '降噪戴上了，队友的报点也听不太清，好在这回合还是拿下。',
      failLoss: '降噪戴上了，队友的报点也听不太清，这回合丢了。',
    },
  ],
  save: [
    {
      okWin: { k0: '队友喊保枪你没听，冲上去逼出了对面的位置，队友跟上来把回合翻了，拿下。', k1: '队友喊保枪你没听，冲上去放倒一个，这回合被你赌了回来，拿下。', k2: '队友喊保枪你没听，冲上去连着放倒两个，这回合被你赌了回来，拿下。' },
      okLoss: { k0: '你冲上去拖住了对面，差一口气就翻过来，这回合还是丢了。', k1: '你冲上去放倒了一个，差一口气就翻过来，这回合还是丢了。' },
      failWin: '你赌上去没赌中，好在队友那边把局面翻了过来，这回合拿下。',
      failLoss: '你赌上去没赌中，这回合丢了。',
    },
    {
      okWin: '你退下来准备保枪，结果队友那边把回合打了回来，枪在，回合也拿下。',
      okLoss: '你听队友的退了下来，枪保住了，这回合交了出去。',
      failWin: '保枪的路线被对面摸到，你被追着走，最后是队友把回合打了回来，拿下。',
      failLoss: '保枪的路线被对面摸到，这回合丢了。',
    },
  ],
  info: [
    {
      okWin: { k0: '你跟上去二打二，枪线把对面逼得往回缩，这回合拿下。', k1: '你跟上去二打二，放倒一个，这回合拿下。', k2: '你跟上去二打二，两个都是你放倒的，这回合拿下。' },
      okLoss: { k0: '你跟上去把人逼退了，可别的地方被打穿，这回合丢了。', k1: '你跟上去放倒一个，这一波是赚的，这回合还是丢了。' },
      failWin: '跟上去被夹了一下，好在队友反应快，这回合还是拿下。',
      failLoss: '跟上去被夹了一下，这回合丢了。',
    },
    {
      okWin: '你退了一步报点，队友顺着你的信息打，这回合拿下。',
      okLoss: '你退了一步报出点位，信息是准的，这回合还是丢了。',
      failWin: '你退了，报了点，没人去接——还好这回合还是拿下。',
      failLoss: '你退了，报了点，没人去接，信息浪费了，这回合丢了。',
    },
  ],
  ...KEY_HL,
}

/** How the round a call was about went, read off the engine once it has been played. */
export interface RoundFacts {
  won: boolean
  /** my kills in that round */
  kills: number
}

export type HlCell = 'okWin' | 'okLoss' | 'failWin' | 'failLoss'

export interface NodeLine {
  text: string
  /** which of the four the line was written for */
  cell: HlCell
  /** what it says about my kills: none, at least one, two or more — null when it says nothing */
  kills: 0 | 1 | 2 | null
  /** no line was written for this case and a plain one stood in */
  fallback: boolean
}

/** The one-line story of a call, by node, option, outcome and the round it was about. */
export function nodeLine(id: string, option: number, ok: boolean, f: RoundFacts): NodeLine {
  const cell: HlCell = ok ? (f.won ? 'okWin' : 'okLoss') : (f.won ? 'failWin' : 'failLoss')
  const t = (NODE_HL[id]?.[option] ?? NODE_HL[id]?.[0])?.[cell]
  if (t == null) {
    const text = ok ? (f.won ? '这一下做成了，这回合拿下。' : '这一下做成了，这回合还是丢了。')
      : (f.won ? '这一下没成，这回合还是拿下。' : '这一下没成，这回合丢了。')
    return { text, cell, kills: null, fallback: true }
  }
  if (typeof t === 'string') return { text: t, cell, kills: null, fallback: false }
  if (f.kills >= 2 && t.k2) return { text: t.k2, cell, kills: 2, fallback: false }
  if (f.kills >= 1) return { text: t.k1, cell, kills: 1, fallback: false }
  return { text: t.k0, cell, kills: 0, fallback: false }
}

export function nodeHighlight(id: string, option: number, ok: boolean, f: RoundFacts): string {
  return nodeLine(id, option, ok, f).text
}

/**
 * How a map looks before it starts, from my side's round-win estimate. Text
 * for the player, thresholds on the same number the engine rolls with.
 */
export function gapVerdict(p: number): { k: 'crush' | 'edge' | 'even' | 'under' | 'hopeless'; t: string; d: string } {
  if (p >= 0.60) return { k: 'crush', t: '实力碾压', d: '正常打就能赢，别浪。' }
  if (p >= 0.54) return { k: 'edge', t: '占优', d: '稳住节奏就行。' }
  if (p > 0.46) return { k: 'even', t: '势均力敌', d: '胜负就在那几个关键回合上。' }
  if (p > 0.40) return { k: 'under', t: '劣势', d: '硬碰硬赢不了，得在关键回合赌一把。' }
  return { k: 'hopeless', t: '差距过大', d: '这一图基本没戏。打完它，把状态留给下一图。' }
}
