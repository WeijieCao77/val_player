import { clamp } from '../rng'
import type { GameState, Role } from '../types'
import type { NodeDim } from './types'
import { tiltDrag } from './growth'
import { injuryHit } from './injury'

/** what a call changes on the round-strength scale (ROUND_SENS is 30) */
export const NODE_SWING = 4
/** the share of a call that is my own attribute rather than the four around me */
export const NODE_MINE = 0.7

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
}

export interface NodeOpt { t: string; dim: NodeDim; risk: number }

export interface NodeDef {
  id: string
  q: string
  ctx: string
  when: (c: NodeCtx) => boolean
  a: NodeOpt[]
  /** the steady choice — what 快进 and 托管 take */
  rec: number
  /**
   * The premise is this very round: a 1v2 with me the last one standing, a map
   * point. Such a call settles the round it is about — landed, the round is
   * ours; missed, it is theirs — because "I lost the 1v2 and we won the round"
   * cannot happen (engine/me/matchplay.ts passes it to MapSim.playRound).
   */
  decides?: boolean
}

/**
 * Things that actually happen in a round, written so the choice is a thing you
 * would do, not an abstract dial. Each option is judged on one attribute; the
 * riskier one swings the round harder both ways.
 */
export const NODES: NodeDef[] = [
  { id: 'pistol_rush', q: '手枪局。指挥问：五个人一起冲 B，还是分散拿信息？', ctx: '手枪局赢了，接下来两回合都是你们的经济。',
    when: (c) => c.pistol, rec: 1,
    a: [{ t: '冲，一波打穿', dim: 'reaction', risk: 0.9 }, { t: '分散拿信息，慢打', dim: 'awareness', risk: 0.4 }] },
  { id: 'entry', q: '烟还没起，你已经站在小道口。', ctx: '先手成了全队都能进，被反枪整回合就废了。',
    when: (c) => !c.pistol && (c.role === '决斗者' || c.role === '先锋'), rec: 1,
    a: [{ t: '先手，不等了', dim: 'reaction', risk: 0.95 }, { t: '等道具到位再进', dim: 'utility', risk: 0.45 }] },
  { id: 'eco_gun', q: '经济局，队友把唯一一把大枪递给了你。', ctx: '拿枪就是全队指望你一个人打开局面。',
    when: (c) => !c.pistol && c.round >= 3, rec: 0,
    a: [{ t: '拿枪，我来打', dim: 'aim', risk: 0.8 }, { t: '别买了，五人轻甲一起冲', dim: 'teamwork', risk: 0.5 }] },
  { id: 'clutch', q: '1v2，包已经下了，对面在包点两侧。', ctx: '拆包前你必须先解决一个。',
    when: (c) => !c.pistol && c.round >= 4, rec: 0, decides: true,
    a: [{ t: '打，先找一个', dim: 'clutch', risk: 1.0 }, { t: '藏起来，等他们来拆', dim: 'awareness', risk: 0.6 }] },
  { id: 'behind_to', q: '落后暂停，指挥说完了战术，所有人看着你。', ctx: '这时候语音里最需要有人说话。',
    when: (c) => c.lead <= -4, rec: 0,
    a: [{ t: '喊一嗓子，把人拉回来', dim: 'communication', risk: 0.7 }, { t: '不说话，自己先打好', dim: 'aim', risk: 0.6 }] },
  { id: 'behind_site', q: '对面已经连着三回合压你这个点。', ctx: '他们盯上你了。',
    when: (c) => c.lead <= -3 && !c.pistol, rec: 0,
    a: [{ t: '换个位置，让他们扑空', dim: 'awareness', risk: 0.5 }, { t: '硬守，正面刚', dim: 'clutch', risk: 0.9 }] },
  { id: 'ahead_rush', q: '领先不少，队友想直接 rush 收工。', ctx: '稳一点也能赢，但会拖很久。',
    when: (c) => c.lead >= 4 && !c.pistol, rec: 1,
    a: [{ t: '冲，速战速决', dim: 'reaction', risk: 0.7 }, { t: '按道具慢打，别送', dim: 'utility', risk: 0.35 }] },
  { id: 'map_point_mine', q: '赛点。指挥把最后一波的先手交给了你。', ctx: '这一回合结束了，这张图就结束了。',
    when: (c) => c.mapPoint === 'mine', rec: 0, decides: true,
    a: [{ t: '给我，我来', dim: 'mental', risk: 1.0 }, { t: '按体系打，别改', dim: 'teamwork', risk: 0.45 }] },
  { id: 'map_point_theirs', q: '对面赛点，暂停时语音里没人说话。', ctx: '这时候要有人站出来。',
    when: (c) => c.mapPoint === 'theirs', rec: 1, decides: true,
    a: [{ t: '这波交给我', dim: 'mental', risk: 1.0 }, { t: '别慌，按流程打一回合', dim: 'teamwork', risk: 0.5 }] },
  { id: 'ot', q: '加时。你发现自己的手在抖。', ctx: '这个舞台比训练赛大得多。',
    when: (c) => c.ot, rec: 0,
    a: [{ t: '深呼吸，按流程走', dim: 'mental', risk: 0.5 }, { t: '用一波激进的开局逼自己进状态', dim: 'aim', risk: 0.95 }] },
  { id: 'first_map', q: '第一张图开赛前，你在座位上把鼠标垫又擦了一遍。', ctx: '第一回合决定你今晚的心态。',
    when: (c) => c.mapIndex === 0 && c.round <= 2, rec: 0,
    a: [{ t: '按流程，稳住', dim: 'mental', risk: 0.4 }, { t: '第一回合就去找人', dim: 'reaction', risk: 0.9 }] },
  { id: 'hot', q: '今天手感烫得离谱，什么都能打中。', ctx: '这种手感一年遇不到几次。',
    when: (c) => c.form >= 80 && !c.pistol, rec: 0,
    a: [{ t: '把资源都要过来', dim: 'aim', risk: 0.9 }, { t: '别飘，按体系打', dim: 'teamwork', risk: 0.4 }] },
  { id: 'cold', q: '今天怎么打都不对，简单的枪都在漏。', ctx: '队友已经开始帮你兜了。',
    when: (c) => c.form <= 58 && !c.pistol, rec: 0,
    a: [{ t: '认了，让队友多拿枪', dim: 'communication', risk: 0.4 }, { t: '硬扛，我能找回来', dim: 'mental', risk: 1.0 }] },
  { id: 'intl', q: '国际赛的观众声浪比联赛大一个量级，你能听见自己的心跳。', ctx: '这就是你想来的地方。',
    when: (c) => c.isIntl && c.round <= 3, rec: 0,
    a: [{ t: '享受它', dim: 'mental', risk: 0.6 }, { t: '戴上降噪，只管枪', dim: 'aim', risk: 0.5 }] },
  { id: 'save', q: '这回合快输了，队友喊 save，你觉得还能赌一把。', ctx: '保住枪下回合是满配，赌成了是回合。',
    when: (c) => !c.pistol && c.round >= 3, rec: 1,
    a: [{ t: '赌，冲上去', dim: 'clutch', risk: 0.9 }, { t: '听队友的，保枪', dim: 'awareness', risk: 0.35 }] },
  { id: 'info', q: '对面有人在你这边露了头，队友问要不要跟。', ctx: '跟上去可能二打二，也可能被夹。',
    when: (c) => !c.pistol, rec: 1,
    a: [{ t: '跟，打这波', dim: 'reaction', risk: 0.85 }, { t: '退，报点就行', dim: 'awareness', risk: 0.4 }] },
]

export function eligibleNodes(c: NodeCtx, seen: Set<string>): NodeDef[] {
  const pool = NODES.filter((n) => {
    try { return n.when(c) } catch { return false }
  })
  const fresh = pool.filter((n) => !seen.has(n.id))
  return fresh.length ? fresh : pool
}

export const DIM_CN: Record<NodeDim, string> = {
  aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
  clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥', mental: '心态',
}

/**
 * The odds of a call landing. Seven tenths me, three tenths the four around
 * me — one man does not carry four — and the riskier option really is less
 * likely, not just swingier. Nerve helps; tilt hurts.
 */
export function nodeChance(state: GameState, opt: NodeOpt, teamId?: string): number {
  const me = state.me!
  const p = state.players[me.id]
  const mates = (state.teams[teamId ?? state.myTeam]?.starters ?? [])
    .filter((id) => id !== me.id)
    .map((id) => state.players[id])
    .filter(Boolean)
  let v: number
  // hurt: a call made on what the injury gets in the way of is harder (me/injury.ts)
  if (opt.dim === 'mental') v = me.mental + injuryHit(state, 'mental')
  else {
    const mine = p.attrs[opt.dim] + injuryHit(state, opt.dim)
    const avg = mates.length ? mates.reduce((s, m) => s + m.attrs[opt.dim as keyof typeof m.attrs], 0) / mates.length : mine
    v = mine * NODE_MINE + avg * (1 - NODE_MINE)
  }
  // a cool head adds a little; a trait may add more. Gear used to add 0.4% a tier here — money
  // reaching into the match — until the economy was measured (me/shop.ts, 2026-09-11)
  const edge = me.traits?.includes('edge') && (p.form < 70 || me.tilt > 40) ? 0.03 : 0
  return clamp(
    0.30 + (v / 100) * 0.55 - (opt.risk - 0.5) * 0.15 + (me.mental - 50) / 500 - tiltDrag(me) / 60 + edge,
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
 * What a call looks like from the seat next to you: one line for each option
 * of each node, landing or not — the story has to be about the thing you
 * actually chose. These describe the action, not the round, which is still
 * played afterwards.
 */
const NODE_HL: Record<string, { ok: string; bad: string }[]> = {
  pistol_rush: [
    { ok: '手枪局五个人一起冲，对面还没架好枪就被打穿了一条道。', bad: '五个人挤在一条道上被架住，冲锋在第一个拐角就停了。' },
    { ok: '你们分散拿到了信息，对面的站位一清二楚，再慢慢收。', bad: '分散得太开，信息没拿到，人先被各个击破。' },
  ],
  entry: [
    { ok: '你第一个探出去，先手拿下首杀，身后四个人跟着进了点。', bad: '先手被反枪，你第一个倒下，进点的节奏断了。' },
    { ok: '你压住了自己，等烟和闪都到位才进，五个人一起压上去。', bad: '等道具的这几秒对面已经架好了，进点变成了硬啃。' },
  ],
  eco_gun: [
    { ok: '全队唯一一把大枪在你手里，你打开了局面。', bad: '那把大枪在你手里被打掉了，这回合的经济白攒。' },
    { ok: '五把手枪轻甲一起冲，靠人数把点撕开了。', bad: '五个人轻甲冲上去，被两把大枪扫了回来。' },
  ],
  clutch: [
    { ok: '1v2，你先解决了一个，再把最后一个等了出来。', bad: '1v2 想先找一个，被两边同时夹住。' },
    { ok: '1v2，你藏住了，等他们来拆包的那一下把两个都打了。', bad: '藏得太久，他们没来拆，包炸了你还在角落里。' },
  ],
  behind_to: [
    { ok: '暂停之后你在语音里把节奏拉了回来，五个人重新站到了一起。', bad: '喊了一嗓子，语音里没人接话。' },
    { ok: '你没说话，用一个回合的枪把队友重新打醒了。', bad: '你闷头打自己的，语音里还是一片安静。' },
  ],
  behind_site: [
    { ok: '你换了位置，他们第四次来的时候扑了个空。', bad: '换了位置，他们这回没来，你守了个空点。' },
    { ok: '你硬守，正面把第四次进攻顶了回去。', bad: '还守在那个点，他们第四次来了，人比上次多。' },
  ],
  ahead_rush: [
    { ok: '一波冲上去，速战速决。', bad: '冲得太急，被守住反打了一波。' },
    { ok: '按道具慢慢打，没给对面任何机会。', bad: '打得太慢，时间快到了才进点，进得很别扭。' },
  ],
  map_point_mine: [
    { ok: '最后一波先手交给你，你把这张图打完了。', bad: '最后一波没打开，赛点从手里溜了一下。' },
    { ok: '按体系打完最后一回合，谁都没有多做动作。', bad: '按体系打，但对面早就把这套看透了。' },
  ],
  map_point_theirs: [
    { ok: '对面赛点，你站出来把这回合抢了回来。', bad: '对面赛点，你要来的这回合没打好。' },
    { ok: '对面赛点，五个人按流程打了一回合，稳住了。', bad: '对面赛点，按流程打，流程被打穿了。' },
  ],
  ot: [
    { ok: '加时，你深呼吸，按流程走，手稳住了。', bad: '加时第一回合，手还是抖了一下。' },
    { ok: '加时，你用一波激进开局把自己逼进了状态。', bad: '加时的激进开局冲得太猛，先送了一个。' },
  ],
  first_map: [
    { ok: '开局稳住，第一回合按流程拿下。', bad: '按流程打，第一回合还是没拿住。' },
    { ok: '第一回合就去找人，先找到了对面。', bad: '第一回合就去找人，被人先找到了。' },
  ],
  hot: [
    { ok: '手感烫，资源都给了你，你也都打中了。', bad: '要了资源，手感却在这一回合凉了。' },
    { ok: '手感烫也没飘，按体系打，赢得很稳。', bad: '手感这么烫却按体系打，机会从眼前过去了。' },
  ],
  cold: [
    { ok: '认了状态差，把枪让给队友，这一回合反而顺了。', bad: '把枪让出去了，队友这回合也没打好。' },
    { ok: '硬扛的这一回合，手感被你找回来了。', bad: '硬扛的这一回合，简单的枪又漏了。' },
  ],
  intl: [
    { ok: '声浪里你还是听得见自己的报点。', bad: '想享受，结果声浪把你的节奏冲乱了。' },
    { ok: '戴上降噪，世界只剩枪声，你打得很干净。', bad: '降噪戴上了，队友的报点也听不清了。' },
  ],
  save: [
    { ok: '队友喊 save 你没听，赌上去，赌成了。', bad: '赌上去，枪没保住。' },
    { ok: '听队友的保了枪，下回合满配站上去。', bad: '保枪的时候被追着打，枪也没保住。' },
  ],
  info: [
    { ok: '跟上去二打二，这波你们打赢了。', bad: '跟上去被夹了一下。' },
    { ok: '你退了一步报点，队友顺着你的信息把人抓了。', bad: '退了，报了点，没人去接，信息浪费了。' },
  ],
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
  /** what it says about my kills: none, at least one, at least two — null when it says nothing */
  kills: 0 | 1 | 2 | null
  /** no line was written for this case and a plain one stood in */
  fallback: boolean
}

/** The one-line story of a call, by node, option, outcome and the round it was about. */
export function nodeLine(id: string, option: number, ok: boolean, f: RoundFacts): NodeLine {
  const cell: HlCell = ok ? (f.won ? 'okWin' : 'okLoss') : (f.won ? 'failWin' : 'failLoss')
  const t = NODE_HL[id]?.[option] ?? NODE_HL[id]?.[0]
  if (t) return { text: ok ? t.ok : t.bad, cell, kills: null, fallback: false }
  return { text: ok ? '这一下做对了。' : '这一下没成。', cell, kills: null, fallback: true }
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
