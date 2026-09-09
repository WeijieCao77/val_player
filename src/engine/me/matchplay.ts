import { MatchSim } from '../match'
import type { Side } from '../match'
import { Rng, clamp, hashStr } from '../rng'
import { commitFixture, fixtureRng } from '../season'
import { agentCn } from '../content'
import { ratingOf } from '../player'
import type { Fixture, GameState, MapLine } from '../types'
import { eligibleNodes, nodeChance, nodeHighlight, nodeReadout, NODE_SWING } from './nodes'
import type { NodeCtx, NodeDef } from './nodes'
import type { MeMatchRecord, NodeLogEntry } from './types'
import { afterMyMatch, refreshMyRounds } from './coach'
import { bondNoteMatch } from './bond'
import { blameLine, boxScore, seriesEdgeRows, verdict } from './postmatch'
import { starBeat, starBeatLine } from './stars'
import { pushLog } from './log'
import { questProgress } from './quests'

export type StepKind = 'node' | 'round' | 'map-start' | 'map-end' | 'done'

/** A match outside the calendar — a cup round on two temporary fives. */
export interface Friendly {
  aId: string
  bId: string
  bo: 1 | 3 | 5
  comp: string
  label: string
}

/** at most this many calls a map, and never two within this many rounds */
/** how many matches back keep the full all-ten table; older ones keep only the words */
const BOX_KEEP = 12

const NODES_PER_MAP = 3
const NODE_GAP = 4

/**
 * Chance of taking a map from a score, given a per-round chance. Overtime is
 * approximated as "two in a row before they get two in a row".
 */
export function mapWinProb(mine: number, theirs: number, p: number): number {
  const memo = new Map<string, number>()
  const q = (p * p) / (p * p + (1 - p) * (1 - p))
  const f = (m: number, t: number): number => {
    if (m >= 13 && m - t >= 2) return 1
    if (t >= 13 && t - m >= 2) return 0
    if (m >= 12 && t >= 12) return q
    const k = `${m}:${t}`
    const hit = memo.get(k)
    if (hit !== undefined) return hit
    const v = p * f(m + 1, t) + (1 - p) * f(m, t + 1)
    memo.set(k, v)
    return v
  }
  return f(mine, theirs)
}

/**
 * One of my club's matches, driven a round at a time so the UI can stop on a
 * decision. The engine's MatchSim does all the playing; this only decides when
 * to ask me something and what my answer does to the next few rounds.
 *
 * 快进 and 托管 run the identical path with the steady option chosen for me.
 */
export class MeMatch {
  readonly sim: MatchSim
  readonly side: Side | null
  readonly fixture: Fixture
  readonly friendly: Friendly | null
  readonly state: GameState
  /** whether I was in the five when the first map began */
  started = false
  pending: { node: NodeDef; ctx: NodeCtx } | null = null
  nodes: NodeLogEntry[] = []
  /** per map: the win estimate at kickoff and how it ended — the ledger that
      lets "90% and still lost" be checked rather than felt */
  mapLog: { map: string; before: number; won: boolean }[] = []
  /** the story of the call just made, to be pinned on the round it shapes */
  private pendingHl: string | null = null
  private seen = new Set<string>()
  private perMap = 0
  private lastNodeRound = -99
  private nodeRng: Rng
  private finished: MeMatchRecord | null = null
  private mapStarted = false

  constructor(state: GameState, src: Fixture | Friendly) {
    this.state = state
    if ('aId' in src) {
      this.friendly = src
      const id = `friendly:${state.year}:${state.day}:${src.label}`
      this.fixture = { id, day: state.day, stage: state.stage, comp: src.comp, teamA: src.aId, teamB: src.bId, bo: src.bo, label: src.label, played: false }
      this.sim = new MatchSim(state, src.aId, src.bId, src.bo, new Rng(hashStr(`match:${state.seed}:${id}`)))
      this.side = this.sim.sideOf(src.aId)
    } else {
      this.friendly = null
      this.fixture = src
      this.sim = new MatchSim(state, src.teamA, src.teamB, src.bo, fixtureRng(state, src), src.scrim)
      this.side = this.sim.sideOf(state.myTeam)
    }
    this.nodeRng = new Rng(hashStr(`node:${state.seed}:${state.year}:${this.fixture.id}`))
  }

  /** my club in this match — the temporary five in a cup, my employer otherwise */
  get myTeamId(): string { return this.friendly ? this.friendly.aId : this.state.myTeam }
  /** the other five */
  get oppTeamId(): string {
    if (this.friendly) return this.friendly.bId
    return this.mineIsA ? this.fixture.teamB : this.fixture.teamA
  }

  get map() { return this.sim.current }
  get mineIsA(): boolean { return this.side === 'a' }
  get done(): boolean { return this.finished !== null }
  get me() { return this.state.players[this.state.me!.id] }

  get myMaps(): number { return this.mineIsA ? this.sim.wonA : this.sim.wonB }
  get theirMaps(): number { return this.mineIsA ? this.sim.wonB : this.sim.wonA }
  get myRounds(): number { const m = this.map; return m ? (this.mineIsA ? m.a : m.b) : 0 }
  get theirRounds(): number { const m = this.map; return m ? (this.mineIsA ? m.b : m.a) : 0 }

  /** am I on the floor for the map in progress */
  get playing(): boolean {
    const m = this.map
    if (!m || !this.side) return false
    const five = this.mineIsA ? m.A.players : m.B.players
    return five.some((p) => p.id === this.state.me!.id)
  }

  /** the round-win estimate for my side, right now */
  roundProb(): number {
    const m = this.map
    if (!m || !this.side) return 0.5
    const pa = m.roundEstimate()
    return this.mineIsA ? pa : 1 - pa
  }

  /** my side's chance of taking the map in progress */
  winProb(): number {
    const m = this.map
    if (!m || !this.side) return 0.5
    if (m.over) return (this.mineIsA ? m.a > m.b : m.b > m.a) ? 1 : 0
    return mapWinProb(this.myRounds, this.theirRounds, this.roundProb())
  }

  private ctxOf(): NodeCtx {
    const m = this.map!
    const mine = this.myRounds
    const theirs = this.theirRounds
    const r = m.round + 1
    const comp = this.state.comps[this.fixture.comp]
    return {
      round: r, mine, theirs, lead: mine - theirs,
      pistol: r === 1 || r === 13, half: r <= 12 ? 1 : r <= 24 ? 2 : 3, ot: r >= 25,
      mapPoint: mine === 12 && theirs < 12 ? 'mine' : theirs === 12 && mine < 12 ? 'theirs' : null,
      mapIndex: this.sim.mapIndex,
      seriesMine: this.myMaps, seriesTheirs: this.theirMaps, need: this.sim.need,
      isIntl: !comp?.region, role: this.me.role, form: this.me.form,
      agent: this.myAgent(),
    }
  }

  /** the agent I am on the map in progress, in Chinese */
  myAgent(): string | undefined {
    const m = this.map
    if (!m || !this.side) return undefined
    const en = (this.mineIsA ? m.A : m.B).agents[this.state.me!.id]
    return en ? agentCn(en) : undefined
  }

  /** Advance one beat. 'node' means a decision is waiting on choose(). */
  step(): StepKind {
    if (this.finished) return 'done'
    if (this.pending) return 'node'
    const m = this.sim.current
    if (!m) {
      if (!this.sim.nextMap()) { this.finishInternal(); return 'done' }
      this.perMap = 0
      this.lastNodeRound = -99
      if (!this.mapStarted) {
        this.mapStarted = true
        this.started = this.playing
      }
      this.mapLog.push({ map: this.sim.current!.map, before: Math.round(this.winProb() * 100), won: false })
      return 'map-start'
    }
    if (m.over) {
      const entry = this.mapLog[this.mapLog.length - 1]
      if (entry) entry.won = this.mineIsA ? m.a > m.b : m.b > m.a
      this.sim.closeMap()
      if (this.sim.decided) { this.finishInternal(); return 'done' }
      return 'map-end'
    }
    // a decision only when the map is still in the balance — nobody needs to
    // be asked anything at 12-2 — and only while I am the one playing: a
    // skipped match is the engine's numbers against theirs, nothing of mine
    const open = this.winProb()
    if (!this.skipNodes && this.playing && this.side && this.perMap < NODES_PER_MAP && m.round - this.lastNodeRound >= NODE_GAP &&
        open > 0.06 && open < 0.94) {
      const c = this.ctxOf()
      const pool = eligibleNodes(c, this.seen)
      const chance = c.pistol || c.mapPoint || c.ot ? 0.6 : 0.28
      if (pool.length && this.nodeRng.chance(chance)) {
        const node = pool[this.nodeRng.int(0, pool.length - 1)]
        this.pending = { node, ctx: c }
        this.seen.add(node.id)
        this.perMap++
        this.lastNodeRound = m.round
        return 'node'
      }
    }
    m.playRound()
    // the call I just made belongs to the round it shaped, not to the map
    if (this.pendingHl) {
      const rl = m.rounds[m.rounds.length - 1]
      if (rl) rl.hl = [this.pendingHl, ...(rl.hl ?? [])]
      this.pendingHl = null
    }
    return 'round'
  }

  /** Answer the waiting decision. */
  choose(i: number): NodeLogEntry {
    const pend = this.pending
    if (!pend) throw new Error('no decision pending')
    const m = this.map!
    const opt = pend.node.a[i] ?? pend.node.a[pend.node.rec]
    const p = nodeChance(this.state, opt, this.myTeamId)
    const ok = this.nodeRng.chance(p)
    const before = this.winProb()
    const side = this.side!
    if (ok) {
      m.nudge[side] += opt.risk * NODE_SWING
      if (!m.calls[side]) m.calls[side] = { kind: 'focus', playerId: this.state.me!.id, roundsLeft: 3 }
    } else {
      m.nudge[side] -= opt.risk * NODE_SWING * 0.8
    }
    const after = this.winProb()
    const ro = nodeReadout(this.state, opt, this.myTeamId, this.oppTeamId)
    const idx = pend.node.a.indexOf(opt)
    const hl = nodeHighlight(pend.node.id, idx < 0 ? pend.node.rec : idx, ok)
    const entry: NodeLogEntry = {
      map: m.map, round: pend.ctx.round, q: pend.node.q, pick: opt.t, dim: opt.dim,
      p: Math.round(p * 100), ok, before: Math.round(before * 100), after: Math.round(after * 100),
      mine: ro.mine, theirs: ro.theirs ?? undefined, hl,
    }
    this.nodes.push(entry)
    this.pendingHl = hl
    this.pending = null
    return entry
  }

  /** no more decisions once the player has stepped away from the chair */
  private skipNodes = false

  /**
   * Everything left, with no decisions in it: 快进, 托管 and the headless bot
   * all take this road, so a skipped match is the two rosters' numbers and
   * nothing else. Decisions already made stay in the record.
   */
  runOut(): MeMatchRecord {
    this.skipNodes = true
    if (this.pending) this.choose(this.pending.node.rec)
    let guard = 0
    while (!this.finished && guard++ < 400) this.step()
    return this.finished!
  }

  get record(): MeMatchRecord | null { return this.finished }

  /**
   * The lines from this match that were about me: the engine's highlights
   * that carry my name (it already writes the clutch and the ace — nobody was
   * reading them), and what each of my calls did, in the order they happened.
   */
  private myHighlights(engine: string[]): string[] {
    const ign = this.me.ign
    const out: string[] = []
    for (const n of this.nodes) {
      if (n.hl) out.push(`${n.map} 第 ${n.round} 回合 · ${n.hl}`)
    }
    for (const h of engine) {
      if (h.includes(ign)) out.push(h)
    }
    return out
  }

  private finishInternal(): void {
    if (this.finished) return
    const state = this.state
    const me = state.me!
    const f = this.fixture
    const result = this.sim.finish()
    const mineIds = (this.mineIsA ? result.lineups?.a : result.lineups?.b) ?? []
    const started = mineIds.includes(me.id)
    const won = this.mineIsA ? result.mapsWonA > result.mapsWonB : result.mapsWonB > result.mapsWonA

    const sum: MapLine = { kills: 0, deaths: 0, assists: 0, damage: 0, firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 0, acs: 0 }
    const acsBy: Record<string, { d: number; r: number }> = {}
    for (const ms of result.maps) {
      for (const [pid, l] of Object.entries(ms.lines)) {
        if (!mineIds.includes(pid)) continue
        const t = (acsBy[pid] ??= { d: 0, r: 0 })
        t.d += l.damage
        t.r += l.rounds
        if (pid === me.id) {
          sum.kills += l.kills; sum.deaths += l.deaths; sum.assists += l.assists
          sum.damage += l.damage; sum.firstKills += l.firstKills; sum.firstDeaths += l.firstDeaths
          sum.clutches += l.clutches; sum.rounds += l.rounds
        }
      }
    }
    const order = Object.entries(acsBy)
      .map(([pid, t]) => ({ pid, acs: t.r ? (t.d / t.r) * 1.45 : 0 }))
      .sort((a, b) => b.acs - a.acs)
    const rank = started ? order.findIndex((x) => x.pid === me.id) + 1 : 0
    const acs = sum.rounds ? (sum.damage / sum.rounds) * 1.45 : 0
    const rating = started ? ratingOf(sum) : 0

    const notes: string[] = []
    const opp = state.teams[this.mineIsA ? f.teamB : f.teamA]
    if (!this.friendly) {
      commitFixture(state, f, result, notes)
      me.weekNotes.push(...notes)
    }

    const comp = state.comps[f.comp]
    const score = this.mineIsA ? `${result.mapsWonA}-${result.mapsWonB}` : `${result.mapsWonB}-${result.mapsWonA}`
    const rec: MeMatchRecord = {
      fixtureId: f.id, day: state.day, year: state.year,
      comp: this.friendly ? this.friendly.comp : (comp?.name ?? f.comp), label: f.label.replace(/^(KO|SW):\d+:/, ''),
      opp: opp?.name ?? '?', oppTag: opp?.tag ?? '?', friendly: !!this.friendly,
      started, won, score, maps: result.maps.length,
      rounds: sum.rounds, kills: sum.kills, deaths: sum.deaths, assists: sum.assists,
      firstKills: sum.firstKills, clutches: sum.clutches,
      acs: Math.round(acs), rating: Math.round(rating * 100) / 100,
      mvp: result.mvp === me.id, carried: started && !won && rank === 1,
      nodes: this.nodes.slice(), rank,
      highlights: this.myHighlights(result.highlights),
      mapLog: this.mapLog.slice(),
    }
    // why it went that way — the engine already added these terms up when it
    // decided the round win rate; until now nothing read them back out
    const theirIds = (this.mineIsA ? result.lineups?.b : result.lineups?.a) ?? []
    rec.edge = seriesEdgeRows(result.maps, this.mineIsA)
    rec.verdict = verdict(rec, rec.edge)
    rec.box = boxScore(state, result.maps, mineIds, theirIds)
    rec.blame = blameLine(rec.box, rec)
    // the man in my position on the other side, if he is anybody
    const beat = starBeat(state, rec, this.me.role)
    if (beat) {
      rec.starBeat = starBeatLine(beat, won)
      if (beat.won && started) {
        me.heat += 6
        me.fans += 40
      }
    }
    this.finished = rec
    if (this.friendly) {
      me.matches.push(rec)
      if (me.matches.length > 120) me.matches.splice(0, me.matches.length - 120)
      // ten rows a match adds up; only the recent ones keep the full table
      for (let i = 0; i < me.matches.length - BOX_KEEP; i++) delete me.matches[i].box
      me.heat += won ? 4 : 1
      this.me.fatigue = clamp(this.me.fatigue + 4 * result.maps.length, 0, 100)
      me.mental = clamp(me.mental + (won ? 0.3 : 0.1), 0, 100)
      pushLog(state, 'cup', `${rec.comp} ${rec.label} vs ${rec.opp} ${score} ${won ? '胜' : '负'} · 你 ${sum.kills}/${sum.deaths}/${sum.assists} · ACS ${rec.acs}${rec.mvp ? ' · MVP' : ''}`)
      me.pendingFixture = undefined
      return
    }
    if (f.comp !== 'scrim') {
      me.matches.push(rec)
      if (me.matches.length > 120) me.matches.splice(0, me.matches.length - 120)
      // ten rows a match adds up; only the recent ones keep the full table
      for (let i = 0; i < me.matches.length - BOX_KEEP; i++) delete me.matches[i].box
      me.seasonStart.matches++
      me.playedThisStage++
      // one more night shared with these four
      bondNoteMatch(state, mineIds)
      if (started) {
        me.startedThisStage++
        me.seasonStart.starts++
        me.seasonStart.acsSum += rec.acs
        if (won) me.seasonStart.wins++
      }
      me.heat += started ? (won ? 7 : -2.5) : (won ? 3 : -1)
      // a match is the most tiring thing in the week; a map on the floor costs more than a map on the bench
      this.me.fatigue = clamp(this.me.fatigue + (started ? 5 : 1.5) * result.maps.length, 0, 100)
      if (started && won) questProgress(state, 'win', 1)
      if (started) {
        me.tilt = clamp(me.tilt + (won ? -6 : rank >= 5 ? 14 : 8), 0, 100)
        if (won && rank === 1) me.mental = clamp(me.mental + 0.5, 0, 100)
      }
      const line = started
        ? `${rec.comp} ${rec.label} vs ${rec.oppTag} ${score} ${won ? '胜' : '负'} · 你 ${sum.kills}/${sum.deaths}/${sum.assists} · ACS ${rec.acs} · 评分 ${rec.rating.toFixed(2)}${rec.mvp ? ' · MVP' : ''}${rec.carried ? ' · 输球但你全队最高' : ''}`
        : `${rec.comp} ${rec.label} vs ${rec.oppTag} ${score} ${won ? '胜' : '负'} —— 你在替补席看完了这场。`
      pushLog(state, 'match', line)
      afterMyMatch(state, rec)
    }
    me.pendingFixture = undefined
    refreshMyRounds(state)
  }
}
