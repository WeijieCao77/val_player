import type { MapSim, Side } from '../match'
import type { RoundLog } from '../types'

/**
 * The round a key-round call is about, before it is played (2026-09-12).
 *
 * A call is asked before its round, and the round is then played for the
 * winner the call settles (me/matchplay.ts). A call that says "the Spike is
 * down" or "it is you and one team-mate against three" makes a claim about that
 * round which the round record, the scoreboard and the engine's own highlight
 * line will all be read against. So the round is played out first on copies of
 * the map (MapSim.fork) — once for each of the four ways the call can go —
 * and a premise is only offered where every way it can go agrees with it.
 *
 * None of this reads anything the player could not know at the moment of the
 * call: which way the round goes is still the call's to decide, and the copies
 * only say what shape the round has around it.
 */

export type Buy = 'eco' | 'force' | 'full'
export type BranchKey = 'okWin' | 'okLoss' | 'failWin' | 'failLoss'
export const BRANCHES: readonly BranchKey[] = ['okWin', 'okLoss', 'failWin', 'failLoss']

export interface Body { id: string; kills: number; dead: boolean }

/** One way the round can go, played out on a copy of the map. */
export interface RoundBranch {
  won: boolean
  end: RoundLog['end']
  buyMine: Buy
  buyTheirs: Buy
  /** my five this round, me first, and theirs */
  mine: Body[]
  theirs: Body[]
  /** whom the engine wrote a 1vX down for this round, if anybody */
  clutchId: string | null
}

/**
 * What a call that lands does to the map before its round is played — a little
 * momentum, and the next rounds played through me. choose() runs exactly this,
 * and so does every copy the premises are read on, so the copy is the round.
 */
export function landCall(m: MapSim, side: Side, meId: string, momentum: number): void {
  m.nudge[side] += momentum
  if (!m.calls[side]) m.calls[side] = { kind: 'focus', playerId: meId, roundsLeft: 3 }
}

/** The round about to be played, four ways: the call landed or not, the round ours or not. */
export function roundBranches(m: MapSim, side: Side, meId: string, momentum: number): Record<BranchKey, RoundBranch> {
  const other: Side = side === 'a' ? 'b' : 'a'
  const five = (s: Side) => (s === 'a' ? m.A : m.B).players.map((p) => p.id)
  const mineIds = five(side).sort((x, y) => Number(y === meId) - Number(x === meId))
  const theirIds = five(other)
  const before = m.lines
  const play = (ok: boolean, won: boolean): RoundBranch => {
    const f = m.fork()
    if (ok) landCall(f, side, meId, momentum)
    f.playRound(won ? side : other)
    const rl = f.rounds[f.rounds.length - 1]
    const after = f.lines
    const body = (id: string): Body => ({ id, kills: after[id].kills - before[id].kills, dead: after[id].deaths > before[id].deaths })
    const clutchId = [...mineIds, ...theirIds].find((id) => after[id].clutches > before[id].clutches) ?? null
    return {
      won, end: rl.end,
      buyMine: side === 'a' ? rl.buyA : rl.buyB,
      buyTheirs: side === 'a' ? rl.buyB : rl.buyA,
      mine: mineIds.map(body), theirs: theirIds.map(body), clutchId,
    }
  }
  return { okWin: play(true, true), okLoss: play(true, false), failWin: play(false, true), failLoss: play(false, false) }
}

/**
 * What a node claims about its round, as data, so the moment it is asked and
 * the round record afterwards can both be read against the same thing.
 */
export interface Premise {
  /** my side attacks ('atk') or defends ('def') this round */
  side?: 'atk' | 'def'
  /** what my side and theirs bought for it (their buy is only claimed once the round is live) */
  buyMine?: readonly Buy[]
  buyTheirs?: readonly Buy[]
  /** the Spike is down at the call: our plant when we attack, theirs when we defend */
  planted?: boolean
  /** who is standing at the call: me and mine − 1 team-mates, and theirs — a range, settled when it is asked */
  alive?: { mine: number; theirs: readonly [number, number] }
  /** the key round that is a match point, ours or theirs, or the first overtime round */
  point?: 'mine' | 'theirs' | 'ot'
}

const deadOf = (xs: Body[]) => xs.filter((x) => x.dead).length

/**
 * The kills the ones standing at the call can account for: everyone still up at
 * the end was standing, and the rest of the standing count is made up of those
 * who fell later — the ones with the most kills, since they might have taken
 * them after the call. `lead` must be among them (me, on my side).
 */
function standingKills(xs: Body[], standing: number, lead?: string): number | null {
  const up = xs.filter((x) => !x.dead)
  if (up.length > standing) return null
  const pool = xs.filter((x) => x.dead)
  const picked = up.slice()
  const leadRow = lead ? xs.find((x) => x.id === lead) : undefined
  if (leadRow && leadRow.dead) {
    if (picked.length >= standing) return null
    picked.push(leadRow)
    pool.splice(pool.indexOf(leadRow), 1)
  }
  pool.sort((a, b) => b.kills - a.kills)
  while (picked.length < standing && pool.length) picked.push(pool.shift()!)
  return picked.reduce((s, x) => s + x.kills, 0)
}

/**
 * Whether one way the round can go agrees with "me and mine − 1 team-mates
 * standing against theirs" at the moment of the call, the Spike down or not:
 *  - everyone who is down at the call is down at the end, and I am up at the call;
 *  - whoever falls after the call was killed by someone standing at it;
 *  - a 1vX the engine writes down belongs to somebody still standing at the end,
 *    and when I am the last of mine, to me;
 *  - with the Spike down, the round cannot end on time: the attackers take it by
 *    elimination or detonation, the defenders by elimination or the defuse.
 */
export function branchAgrees(b: RoundBranch, attack: boolean, planted: boolean, mine?: number, theirs?: number): boolean {
  if (planted) {
    const attackersWon = b.won === attack
    if (attackersWon ? b.end !== 'elim' && b.end !== 'spike' : b.end !== 'elim' && b.end !== 'defuse') return false
  }
  if (mine == null || theirs == null) return true
  const myDead = deadOf(b.mine)
  const theirDead = deadOf(b.theirs)
  if (myDead < 5 - mine || theirDead < 5 - theirs) return false
  const me = b.mine[0]
  if (me.dead && myDead < 6 - mine) return false
  const ours = standingKills(b.mine, mine, me.id)
  const their = standingKills(b.theirs, theirs)
  if (ours == null || their == null) return false
  if (theirDead - (5 - theirs) > ours || myDead - (5 - mine) > their) return false
  if (b.clutchId) {
    const row = [...b.mine, ...b.theirs].find((x) => x.id === b.clutchId)
    if (row && b.mine.includes(row) && (row.dead || (mine === 1 && row.id !== me.id))) return false
  }
  return true
}

/** The ways a call can go: both results for an ordinary call, and for one that is its round, landed-and-won or missed-and-lost. */
export const branchesFor = (decides?: boolean): readonly BranchKey[] => (decides ? ['okWin', 'failLoss'] : BRANCHES)

/**
 * How many of theirs a node's alive range can say are standing, given every way
 * its round can go — empty when none, [] also when the node claims nothing
 * about who is standing but the Spike premise fails. `[-1]` when the node claims
 * nothing about standing and its round agrees.
 */
export function standingOptions(p: Premise, br: Record<BranchKey, RoundBranch>, attack: boolean, decides?: boolean): number[] {
  const keys = branchesFor(decides)
  const planted = !!p.planted
  if (!p.alive) return keys.every((k) => branchAgrees(br[k], attack, planted)) ? [-1] : []
  const out: number[] = []
  for (let t = p.alive.theirs[0]; t <= p.alive.theirs[1]; t++) {
    if (keys.every((k) => branchAgrees(br[k], attack, planted, p.alive!.mine, t))) out.push(t)
  }
  return out
}
