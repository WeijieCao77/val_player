import type { Lineup, MapSim, Side } from '../match'
import type { Rng } from '../rng'
import type { GameState, Player, Role } from '../types'
import { AGENT_ROLE, mapCn } from '../content'
import { COACH_READS, COACH_READS_PLAIN, COACH_READS_SUBTLE, DIM_CN, NODE_HINTS, countCn, nodeReadout } from './nodes'
import type { NodeCtx, NodeDef } from './nodes'
import type { Buy } from './keyround'

/**
 * 局面提示 from what the screen can back up (2026-09-12).
 *
 * A hint used to be a line from a pool — 「对面这张图 B 点前压频率高」 — with the
 * option it favoured drawn at random. Now it states a fact the player can check
 * on the screen at the moment of the call, and the option it favours follows
 * from that fact, the way a player would read it:
 *
 *   the round record   — what the other five bought last round and whether they
 *                        lost it; a run of three or more rounds either way
 *   the buttons        — the five's average on the attribute a call is judged on,
 *                        against theirs
 *   the man across     — my opposite number's attribute against mine (his card is
 *                        one click away)
 *   the scoreboard     — who has the hot hand on this map, me included
 *   the ground         — three sites, teleporters, long sightlines
 *   the call itself    — how many are standing, when the node says
 *
 * Nothing here reads what the player could not know: not their bank, not this
 * round's buy before contact, not how the round will go. Each node says which of
 * these it reads and which option each favours (NodeDef.lean). When none of them
 * is true of the moment, the old pool line stands in, as before.
 */

export type FactKey =
  | 'theirBroke' | 'theirSaved' | 'streakUs' | 'streakThem'
  | 'teamUp' | 'teamDown' | 'duelUp' | 'duelDown'
  | 'theyHot' | 'meHot' | 'meCold'
  | 'threeSites' | 'teleporter' | 'longLines'
  | 'upMen' | 'downMen' | 'evenMen' | 'oneLeft' | 'manyLeft'

/**
 * How plainly a fact sits on the screen, which is how often the coach reads it
 * right (me/nodes.ts COACH_READS_PLAIN / _SUBTLE): the record, the buttons, the
 * map and the count are plain; a duel and a hot hand are read off one man.
 */
export const FACT_CLARITY: Record<FactKey, 'plain' | 'subtle'> = {
  theirBroke: 'plain', theirSaved: 'plain', streakUs: 'plain', streakThem: 'plain',
  teamUp: 'plain', teamDown: 'plain', threeSites: 'plain', teleporter: 'plain', longLines: 'plain',
  upMen: 'plain', downMen: 'plain', evenMen: 'plain', oneLeft: 'plain', manyLeft: 'plain',
  duelUp: 'subtle', duelDown: 'subtle', theyHot: 'subtle', meHot: 'subtle', meCold: 'subtle',
}
export const FACT_KEYS = Object.keys(FACT_CLARITY) as FactKey[]

/** Facts that read an attribute off an option: the option the pair's `up` entry names is the one whose attribute is compared. */
export const PAIRS: readonly (readonly [FactKey, FactKey])[] = [['teamUp', 'teamDown'], ['duelUp', 'duelDown']]

export interface Hint {
  /** the option it favours */
  fav: number
  /** the line with numbers, and in words for when the 数值 switch is off */
  text: string
  words: string
  /** the fact it states, or 'pool' for a line from NODE_HINTS, which states none */
  fact: FactKey | 'pool'
  /** a pool line's index */
  hk?: number
}

export interface HintEnv { state: GameState; m: MapSim; side: Side; myTeamId: string; oppTeamId: string }

/** thresholds: a gap of this much on the buttons, or between me and the man across, is worth saying */
export const TEAM_GAP = 5
export const DUEL_GAP = 6
/** a run of rounds worth saying */
export const RUN = 3
/** a hot hand on this map: at least this many kills, and at least this many a round played */
export const HOT_KILLS = 8
export const HOT_RATE = 0.85
/** a cold one: this many more deaths than kills */
export const COLD_GAP = 5

const BUY_WORD: Record<Buy, string> = { full: '满配', force: '半起', eco: '经济局' }
const roleIn = (L: Lineup, p: Player): Role => AGENT_ROLE[L.agents[p.id]] ?? p.role

/**
 * My opposite number on this map: the one of theirs on the agent job I am on,
 * else the one whose own role is mine; of two, the better player.
 */
export function oppositeOf(state: GameState, m: MapSim, side: Side): { p: Player; role: Role } | null {
  const meId = state.me!.id
  const mine = side === 'a' ? m.A : m.B
  const theirs = side === 'a' ? m.B : m.A
  const myRole = AGENT_ROLE[mine.agents[meId]] ?? state.players[meId]?.role
  if (!myRole) return null
  const byAgent = theirs.players.filter((p) => AGENT_ROLE[theirs.agents[p.id]] === myRole)
  const pool = byAgent.length ? byAgent : theirs.players.filter((p) => p.role === myRole)
  const p = pool.slice().sort((x, y) => y.overall - x.overall || (x.id < y.id ? -1 : 1))[0]
  return p ? { p, role: roleIn(theirs, p) } : null
}

/** The hot hand among the other five on this map: the most kills, if it is enough to say. */
export function theirHotHand(m: MapSim, side: Side): { p: Player; role: Role; kills: number } | null {
  const theirs = side === 'a' ? m.B : m.A
  const top = theirs.players
    .map((p) => ({ p, kills: m.lines[p.id]?.kills ?? 0 }))
    .sort((x, y) => y.kills - x.kills || (x.p.id < y.p.id ? -1 : 1))[0]
  if (!top || top.kills < Math.max(HOT_KILLS, Math.ceil(m.round * HOT_RATE))) return null
  return { ...top, role: roleIn(theirs, top.p) }
}

/** Every fact the node reads that is true of the moment, each with the option it favours. */
export function nodeFacts(node: NodeDef, c: NodeCtx, env: HintEnv): Hint[] {
  const lean = node.lean
  if (!lean) return []
  const out: Hint[] = []
  const add = (fact: FactKey, text: string, words = text) => {
    const fav = lean[fact]
    if (fav != null && node.a[fav]) out.push({ fav, text, words, fact })
  }
  const { state, m, side } = env
  const meId = state.me!.id

  // the round record
  if (c.last) {
    if (c.last.won && c.last.theirs !== 'eco') add('theirBroke', `对面上回合${BUY_WORD[c.last.theirs]}输掉了，这回合手里多半凑不齐长枪。`)
    if (c.last.theirs === 'eco') add('theirSaved', '对面上回合打的经济局，这回合长枪和技能都会起齐。')
  }
  if (c.streak >= RUN) add('streakUs', `你们连下 ${c.streak} 回合，对面的节奏已经乱了。`)
  if (c.streak <= -RUN) add('streakThem', `对面连下 ${-c.streak} 回合，正打得顺手。`)

  // The attributes. The button already says where I stand against their five on an option's attribute
  // (你占上风 / 差不多 / 对面更强, within 3 is level — ui/me/MatchPlay.tsx), so a hint about an attribute
  // is only worth reading out when it says something the button does not: my five carry an attribute I
  // alone am behind on, or I am ahead on one my five are not; the man across from me is weaker than me
  // where their five are not, or stronger where they are not. Read against the button, a rookie is not
  // told on every call that the man across is better than him — the button said so already.
  const buttonEdge = (ro: { mine: number; theirs: number | null }) =>
    ro.theirs == null || Math.abs(ro.mine - ro.theirs) <= 3 ? 0 : ro.mine > ro.theirs ? 1 : -1
  if (lean.teamUp != null && lean.teamDown != null) {
    const opt = node.a[lean.teamUp]
    if (opt && opt.dim !== 'mental') {
      const ro = nodeReadout(state, opt, env.myTeamId, env.oppTeamId)
      if (ro.theirs != null) {
        const ours = ro.mates != null ? (ro.mine + ro.mates * 4) / 5 : ro.mine
        const gap = Math.round(ours - ro.theirs)
        const dim = DIM_CN[opt.dim]
        const btn = buttonEdge(ro)
        if (gap >= TEAM_GAP && btn <= 0) add('teamUp', `你们五个人的${dim}平均比对面高 ${gap}。`, `你们整体的${dim}比对面强。`)
        if (gap <= -TEAM_GAP && btn >= 0) add('teamDown', `对面五个人的${dim}平均比你们高 ${-gap}。`, `对面整体的${dim}比你们强。`)
      }
    }
  }
  if (lean.duelUp != null && lean.duelDown != null) {
    const opt = node.a[lean.duelUp]
    const opp = opt && opt.dim !== 'mental' ? oppositeOf(state, m, side) : null
    if (opt && opt.dim !== 'mental' && opp) {
      const dim = DIM_CN[opt.dim]
      const gap = Math.round(state.players[meId].attrs[opt.dim]) - Math.round(opp.p.attrs[opt.dim])
      const btn = buttonEdge(nodeReadout(state, opt, env.myTeamId, env.oppTeamId))
      if (gap >= DUEL_GAP && btn <= 0) add('duelUp', `对位的${opp.role}${dim}比你低 ${gap}。`, `对位的${opp.role}${dim}不如你。`)
      if (gap <= -DUEL_GAP && btn >= 0) add('duelDown', `对位的${opp.role}${dim}比你高 ${-gap}。`, `对位的${opp.role}${dim}比你强${-gap >= 12 ? '不少' : '一截'}。`)
    }
  }

  // the scoreboard on this map
  const ml = m.lines[meId]
  if (ml) {
    if (ml.kills >= Math.max(HOT_KILLS, Math.ceil(m.round * HOT_RATE)) && ml.kills - ml.deaths >= 3) add('meHot', `你这张图已经 ${ml.kills} 杀，手是热的。`)
    if (ml.deaths - ml.kills >= COLD_GAP) add('meCold', `你这张图 ${ml.kills} 杀 ${ml.deaths} 死，枪还没打开。`)
  }
  if (lean.theyHot != null) {
    const hot = theirHotHand(m, side)
    if (hot) add('theyHot', `对面的${hot.role}这张图已经 ${hot.kills} 杀，手正热。`)
  }

  // the ground
  if (c.map === 'Haven' || c.map === 'Lotus') add('threeSites', `${mapCn(c.map)}有三个点，转一次点要跑很远。`)
  if (c.map === 'Bind') add('teleporter', '源工重镇有两道传送门，转点比看上去快得多。')
  if (c.map === 'Breeze') add('longLines', '微风岛屿的枪线又长又开阔，贴近打的一方吃亏。')

  // who is standing, as the call says
  if (c.alive) {
    const [n, t] = c.alive
    const count = `${countCn(n)}打${countCn(t, true)}`
    if (n > t) add('upMen', `${count}，你们多${countCn(n - t)}个人。`)
    if (n < t) add('downMen', `${count}，你们少${countCn(t - n)}个人。`)
    if (n === t) add('evenMen', `${count}，人数一样。`)
    if (t === 1) add('oneLeft', '对面只剩一个人，他得一个人看住所有方向。')
    if (t >= 2) add('manyLeft', `对面还有${countCn(t)}个人，正面硬打就是一个打${countCn(t, true)}个。`)
  }
  return out
}

/**
 * The hint for a call: one of the facts the node reads that is true now, or —
 * when none is — a line from the node's pool with the option drawn, as before.
 * When the true facts point different ways, the option comes first, evenly
 * among those some fact favours, and then a fact that favours it: two facts for
 * the steady option and one for the bold one is still a real read either way,
 * not two chances in three that the hint says "steady".
 */
export function pickHint(node: NodeDef, c: NodeCtx, env: HintEnv, rng: Rng): Hint | null {
  const facts = nodeFacts(node, c, env)
  if (facts.length) {
    const favs: number[] = []
    for (const h of facts) if (!favs.includes(h.fav)) favs.push(h.fav)
    const fav = favs[rng.int(0, favs.length - 1)]
    const mine = facts.filter((h) => h.fav === fav)
    return mine[rng.int(0, mine.length - 1)]
  }
  const lines = NODE_HINTS[node.id]
  if (!lines) return null
  const fav = rng.int(0, node.a.length - 1)
  const hk = rng.int(0, Math.max(1, lines[fav]?.length ?? 1) - 1)
  const text = lines[fav]?.[hk]
  return text ? { fav, hk, text, words: text, fact: 'pool' } : null
}

/** How often the coach reads a hint right: the plainer the fact, the likelier (me/nodes.ts COACH_READS). */
export function coachReads(h: Hint): number {
  if (h.fact === 'pool') return COACH_READS
  return FACT_CLARITY[h.fact] === 'plain' ? COACH_READS_PLAIN : COACH_READS_SUBTLE
}
