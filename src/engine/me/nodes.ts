import { clamp } from '../rng'
import type { GameState, Role } from '../types'
import type { NodeDim } from './types'
import { tiltDrag } from './growth'

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
    a: [{ t: '拿枪，我来打', dim: 'aim', risk: 0.8 }, { t: '别买了，五人半甲一起冲', dim: 'teamwork', risk: 0.5 }] },
  { id: 'clutch', q: '1v2，包已经下了，对面在包点两侧。', ctx: '拆包前你必须先解决一个。',
    when: (c) => !c.pistol && c.round >= 4, rec: 0,
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
    when: (c) => c.mapPoint === 'mine', rec: 0,
    a: [{ t: '给我，我来', dim: 'mental', risk: 1.0 }, { t: '按体系打，别改', dim: 'teamwork', risk: 0.45 }] },
  { id: 'map_point_theirs', q: '对面赛点，暂停时语音里没人说话。', ctx: '这时候要有人站出来。',
    when: (c) => c.mapPoint === 'theirs', rec: 1,
    a: [{ t: '把球给我', dim: 'mental', risk: 1.0 }, { t: '别慌，按流程打一回合', dim: 'teamwork', risk: 0.5 }] },
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
export function nodeChance(state: GameState, opt: NodeOpt): number {
  const me = state.me!
  const p = state.players[me.id]
  const mates = state.teams[state.myTeam].starters
    .filter((id) => id !== me.id)
    .map((id) => state.players[id])
    .filter(Boolean)
  let v: number
  if (opt.dim === 'mental') v = me.mental
  else {
    const mine = p.attrs[opt.dim]
    const avg = mates.length ? mates.reduce((s, m) => s + m.attrs[opt.dim as keyof typeof m.attrs], 0) / mates.length : mine
    v = mine * NODE_MINE + avg * (1 - NODE_MINE)
  }
  return clamp(
    0.30 + (v / 100) * 0.55 - (opt.risk - 0.5) * 0.15 + (me.mental - 50) / 500 - tiltDrag(me) / 60,
    0.12, 0.92,
  )
}
