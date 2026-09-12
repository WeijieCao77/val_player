import { MatchSim } from '../match'
import type { MapSim, Side } from '../match'
import { Rng, clamp, hashStr } from '../rng'
import { commitFixture, fixtureRng } from '../season'
import { agentCn } from '../content'
import { ratingOf } from '../player'
import type { Fixture, GameState, MapLine, Player } from '../types'
import { deskLine } from './press'
import {
  AUTO_PENALTY, COACH_READS, HINT_EDGE, KEY_MOMENTUM, NODE_HINTS,
  eligibleNodes, keyRoundOdds, nodeChance, nodeHighlight, nodeReadout,
} from './nodes'
import { cerMatchEdge } from './ceremony'
import { hurtBook, hurtMap, injuryAfterMatch } from './hurtplay'

const clamp01 = (v: number) => Math.max(0.03, Math.min(0.97, v))
import type { KeySlot, NodeCtx, NodeDef } from './nodes'
import type { MeMatchRecord, NodeLogEntry } from './types'
import { afterMyMatch, refreshMyRounds } from './coach'
import { bondNoteMatch } from './bond'
import { blameLine, boxScore, seriesEdgeRows, verdict } from './postmatch'
import { starBeat, starBeatLine } from './stars'
import { rivalAfterMatch, rivalNodeEdge } from './rivals'
import { pushLog } from './log'
import { questProgress } from './quests'
import { compCn } from './compname'
import { psychMul } from './shop'

export type StepKind = 'node' | 'round' | 'map-start' | 'map-end' | 'done'

/** A match outside the calendar — a cup round on two temporary fives. */
export interface Friendly {
  aId: string
  bId: string
  bo: 1 | 2 | 3 | 5
  comp: string
  label: string
}

/** how many matches back keep the full all-ten table; older ones keep only the words */
const BOX_KEEP = 12

/** under this in the bank a side's next buy is an eco for certain (engine/match.ts Economy.decide) */
const ECO_BANK = 2200

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
 * decision. The engine's MatchSim does all the playing; this decides when to
 * ask me something and what my answer does to the round it is about.
 *
 * 关键回合 (2026-09-12). At most three calls a map — one in each half, one at
 * match point or the first overtime round — and each settles its own round:
 * whether it lands moves that round's odds (me/nodes.ts KEY_OK / KEY_FAIL), the
 * round is drawn from them, and the engine plays it out for that winner. The
 * calls used to be scattered over the early rounds and each one moved the next
 * few by a point or two, so playing them was worth about as much as skipping
 * them, and players said so (「选择做对了增加的赢面也不大…都直接跳过看结果了」).
 * 快进 and 托管 still make every call — the coach's pick, with nobody in the chair.
 */
export class MeMatch {
  readonly sim: MatchSim
  readonly side: Side | null
  readonly fixture: Fixture
  readonly friendly: Friendly | null
  readonly state: GameState
  /** whether I was in the five when the first map began */
  started = false
  /** the call waiting on choose(): the node and the moment, the option the hint favours
      (−1 when there is no hint) and which of its lines is read out, and the coach's pick */
  pending: { node: NodeDef; ctx: NodeCtx; fav: number; hk: number; coach: number } | null = null
  nodes: NodeLogEntry[] = []
  /** per map: the win estimate at kickoff and how it ended — the ledger that
      lets "90% and still lost" be checked rather than felt */
  mapLog: { map: string; before: number; won: boolean }[] = []
  /**
   * The call just made, waiting on the round it is about. Its line is written
   * only once that round has been played: the win or the loss and my kills in
   * it are read off the engine, never guessed ahead of it — a line that said I
   * had taken both of them, pinned on a round we lost, is what players sent in
   * (「做出正确选择显示我把人都杀完了，结果这个回合却输了」, 2026-09-12).
   */
  private unresolved: { entry: NodeLogEntry; node: NodeDef; idx: number; kills: number; force: Side } | null = null
  private seen = new Set<string>()
  /** the map's three key rounds, asked or not */
  private slots: Record<KeySlot, boolean> = { half1: false, half2: false, point: false }
  private nodeRng: Rng
  private finished: MeMatchRecord | null = null
  private mapStarted = false
  /** 快进 or 托管 has taken over: the calls are still made, the coach's way, with nobody in the chair */
  private auto = false

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

  private ctxOf(slot: KeySlot): NodeCtx {
    const m = this.map!
    const mine = this.myRounds
    const theirs = this.theirRounds
    const r = m.round + 1
    const comp = this.state.comps[this.fixture.comp]
    // who attacks the round about to be played (MapSim.phase): A the first half and every other overtime round
    const aAttack = r <= 12 ? true : r <= 24 ? false : (r - 25) % 2 === 0
    return {
      round: r, mine, theirs, lead: mine - theirs,
      pistol: r === 1 || r === 13, half: r <= 12 ? 1 : r <= 24 ? 2 : 3, ot: r >= 25,
      mapPoint: mine === 12 && theirs < 12 ? 'mine' : theirs === 12 && mine < 12 ? 'theirs' : null,
      mapIndex: this.sim.mapIndex,
      seriesMine: this.myMaps, seriesTheirs: this.theirMaps, need: this.sim.need,
      isIntl: !comp?.region, role: this.me.role, form: this.me.form,
      agent: this.myAgent(),
      attack: this.mineIsA === aAttack, slot, shortBuy: m.bank(this.side!) < ECO_BANK,
    }
  }

  /** the agent I am on the map in progress, in Chinese */
  myAgent(): string | undefined {
    const m = this.map
    if (!m || !this.side) return undefined
    const en = (this.mineIsA ? m.A : m.B).agents[this.state.me!.id]
    return en ? agentCn(en) : undefined
  }

  /**
   * Which of the map's three key rounds the round about to be played is, if
   * any. The first half's: the first of rounds 5–12 with the score within
   * three, else round 10. The second half's: the first from round 14 within
   * three, else round 20. The third: match point, either side's, or the first
   * overtime round. A pistol round never takes one, and a scrim's twenty-four
   * rounds have no match point.
   */
  private keySlot(m: MapSim): KeySlot | null {
    const r = m.round + 1
    if (r === 1 || r === 13) return null
    const mine = this.myRounds
    const theirs = this.theirRounds
    const close = Math.abs(mine - theirs) <= 3
    if (!this.slots.point && m.format !== 'full24' &&
        ((mine === 12 && theirs < 12) || (theirs === 12 && mine < 12) || r === 25)) return 'point'
    if (!this.slots.half1 && r >= 5 && r <= 12 && (close || r >= 10)) return 'half1'
    if (!this.slots.half2 && r >= 14 && r <= 24 && (close || r >= 20)) return 'half2'
    return null
  }

  /** Advance one beat. 'node' means a decision is waiting on choose(). */
  step(): StepKind {
    if (this.finished) return 'done'
    if (this.pending) return 'node'
    const m = this.sim.current
    if (!m) {
      // playing through an injury, or a cup entered hurt: on the five, as I actually am (me/hurtplay.ts)
      if (!hurtMap(this.state, this.fixture.id, !!this.friendly, () => this.sim.nextMap())) { this.finishInternal(); return 'done' }
      this.slots = { half1: false, half2: false, point: false }
      if (!this.mapStarted) {
        this.mapStarted = true
        this.started = this.playing
      }
      // 决赛入场的热身：每张图开局带着它进去
      if (this.side) {
        const { nudge } = cerMatchEdge(this.state)
        if (nudge) this.sim.current!.nudge[this.side] += nudge
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
    // a call only while I am the one playing — a map watched from the bench is
    // the engine's numbers against theirs, nothing of mine — and never a second
    // one on a round a call is already about
    const slot = this.side && this.playing && !this.unresolved ? this.keySlot(m) : null
    if (slot) {
      const c = this.ctxOf(slot)
      const pool = eligibleNodes(c, this.seen)
      if (pool.length) {
        const node = pool[this.nodeRng.int(0, pool.length - 1)]
        const lines = NODE_HINTS[node.id]
        const fav = lines ? this.nodeRng.int(0, node.a.length - 1) : -1
        const hk = fav < 0 ? -1 : this.nodeRng.int(0, Math.max(1, lines![fav]?.length ?? 1) - 1)
        // the coach reads the situation right more often than not (me/nodes.ts COACH_READS)
        const coach = fav < 0 ? node.rec : this.nodeRng.chance(COACH_READS) ? fav : (fav + 1) % node.a.length
        this.pending = { node, ctx: c, fav, hk, coach }
        this.seen.add(node.id)
        this.slots[slot] = true
        return 'node'
      }
    }
    const call = this.unresolved
    m.playRound(call?.force)
    // the call I just made belongs to the round it was about, and is told once that round is known
    if (call) this.narrate(m, call)
    return 'round'
  }

  /** The line for a call, now that its round has been played, pinned on that round. */
  private narrate(m: MapSim, call: { entry: NodeLogEntry; node: NodeDef; idx: number; kills: number }): void {
    this.unresolved = null
    const rl = m.rounds[m.rounds.length - 1]
    if (!rl) return
    const e = call.entry
    const meId = this.state.me!.id
    e.won = (rl.winner === 'A') === this.mineIsA
    e.kills = Math.max(0, (m.lines[meId]?.kills ?? 0) - call.kills)
    // the score this round left: what the call and the round actually did to the map
    e.after = Math.round(this.winProb() * 100)
    let text = nodeHighlight(call.node.id, call.idx, e.ok, { won: e.won, kills: e.kills })
    // a round that closed the map says so from the score, never from the copy
    if (m.over) text += this.myRounds > this.theirRounds ? '这张图拿下了。' : this.myRounds < this.theirRounds ? '这张图丢了。' : '这张图打平了。'
    e.hl = text
    rl.hl = [text, ...(rl.hl ?? [])]
    // landed, favoured to take the round, and lost it anyway: whose night was it on the floor.
    // Only a form well under the 70 the engine treats as ordinary is named — otherwise it was the dice
    if (e.ok && !e.won && !e.decided && (e.qok ?? 0) >= 70) {
      const mates = (this.mineIsA ? m.A : m.B).players.filter((p) => p.id !== meId)
      const worst = mates.reduce<Player | null>((w, p) => (!w || p.form < w.form ? p : w), null)
      if (worst && worst.form < 65) { e.mate = worst.ign; e.mateForm = Math.round(worst.form) }
    }
  }

  /**
   * What option i of the waiting call stands on: its chance to land — my
   * attributes against theirs, the hint, a rival across the floor, a final's
   * warm-up, and nobody in the chair under 快进 — and this round's win chance
   * for my side either way. choose() rolls on exactly these numbers, so what
   * the button says is what happens.
   */
  optionOdds(i: number): { p: number; ok: number; fail: number } {
    const pend = this.pending
    if (!pend) throw new Error('no decision pending')
    const idx = pend.node.a[i] ? i : pend.coach
    const opt = pend.node.a[idx]
    const hint = pend.fav < 0 ? 0 : idx === pend.fav ? HINT_EDGE : -HINT_EDGE
    const p = clamp01(
      nodeChance(this.state, opt, this.myTeamId, this.oppTeamId) + cerMatchEdge(this.state).node +
      rivalNodeEdge(this.state, this.oppTeamId) + hint - (this.auto ? AUTO_PENALTY : 0),
    )
    const { ok, fail } = keyRoundOdds(this.roundProb(), opt.risk, pend.node.decides)
    return { p, ok, fail }
  }

  /** Answer the waiting call. The round it is about is drawn here and played on the next step. */
  choose(i: number): NodeLogEntry {
    const pend = this.pending
    if (!pend) throw new Error('no decision pending')
    const m = this.map!
    const me = this.state.me!
    const side = this.side!
    const idx = pend.node.a[i] ? i : pend.coach
    const opt = pend.node.a[idx]
    const odds = this.optionOdds(idx)
    const ok = this.nodeRng.chance(odds.p)
    const before = this.winProb()
    // the round itself, drawn from its odds now the call is known; a 1v2 with me the last one standing is the call
    const won = pend.node.decides ? ok : this.nodeRng.chance(ok ? odds.ok : odds.fail)
    if (ok) {
      m.nudge[side] += KEY_MOMENTUM
      // playing to what just worked: the next rounds run through me — a bigger share of the kills when we take them
      if (!m.calls[side]) m.calls[side] = { kind: 'focus', playerId: me.id, roundsLeft: 3 }
    }
    // the coach was watching: a call that lands earns a little of his trust, one that
    // misses costs twice that (破晓's +0.3 / −0.6). A cup's temporary five has no coach of mine
    if (!this.friendly) me.coachTrust = clamp(me.coachTrust + (ok ? 0.3 : -0.6), 0, 100)
    const ro = nodeReadout(this.state, opt, this.myTeamId, this.oppTeamId)
    const shown = Math.round(before * 100)
    const entry: NodeLogEntry = {
      map: m.map, round: pend.ctx.round, q: pend.node.q, pick: opt.t, dim: opt.dim,
      p: Math.round(odds.p * 100), ok, before: shown, after: shown,
      mine: ro.mine, theirs: ro.theirs ?? undefined,
      id: pend.node.id, opt: idx, decided: pend.node.decides || undefined,
      qok: Math.round(odds.ok * 100), qfail: Math.round(odds.fail * 100),
      fav: pend.fav < 0 ? undefined : pend.fav, hk: pend.fav < 0 ? undefined : pend.hk,
      auto: this.auto || undefined,
    }
    this.nodes.push(entry)
    // nothing is said yet: the line waits for the round (narrate)
    this.unresolved = {
      entry, node: pend.node, idx,
      kills: m.lines[me.id]?.kills ?? 0,
      force: won ? side : side === 'a' ? 'b' : 'a',
    }
    this.pending = null
    return entry
  }

  /**
   * Everything left, the coach's way: 快进, 托管 and the headless bot all take
   * this road. The calls are still made — the coach's pick, AUTO_PENALTY off
   * each because nobody is in the chair — so walking away costs a little and
   * never pays. It used to skip every call left, which made a skipped match
   * the two rosters' numbers and nothing else: as good as playing it (2026-09-12).
   * Calls already made stay in the record.
   */
  runOut(): MeMatchRecord {
    this.auto = true
    let guard = 0
    while (!this.finished && guard++ < 1000) {
      if (this.step() === 'node') this.choose(this.pending!.coach)
    }
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
    const drawn = result.mapsWonA === result.mapsWonB

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
      // booked with me counted as having played, not as a short club's injured man (me/hurtplay.ts)
      hurtBook(state, f.id, () => commitFixture(state, f, result, notes))
      // a lay-off with a diagnosis and a count of days is said in words when the week opens instead
      me.weekNotes.push(...notes.filter((n) => !n.includes('⚕') && !deskLine(n)))
    }

    const comp = state.comps[f.comp]
    const score = this.mineIsA ? `${result.mapsWonA}-${result.mapsWonB}` : `${result.mapsWonB}-${result.mapsWonA}`
    const rec: MeMatchRecord = {
      fixtureId: f.id, day: state.day, year: state.year,
      comp: this.friendly ? this.friendly.comp : (comp?.name ?? f.comp), label: f.label.replace(/^(KO|SW):\d+:/, ''),
      opp: opp?.name ?? '?', oppTag: opp?.tag ?? '?', friendly: !!this.friendly,
      started, won, drawn: drawn || undefined, score, maps: result.maps.length,
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
    // a rival, or the man in my position, in one line (me/rivals.ts)
    if (!this.friendly && f.comp !== 'scrim') rivalAfterMatch(state, rec, { oppTeamId: this.oppTeamId, maps: result.maps, fixture: f })
    this.finished = rec
    if (this.friendly) {
      me.matches.push(rec)
      if (me.matches.length > 120) me.matches.splice(0, me.matches.length - 120)
      // ten rows a match adds up; only the recent ones keep the full table
      for (let i = 0; i < me.matches.length - BOX_KEEP; i++) delete me.matches[i].box
      me.heat += won ? 4 : 1
      this.me.fatigue = clamp(this.me.fatigue + 4 * result.maps.length, 0, 100)
      me.mental = clamp(me.mental + (won ? 0.3 : 0.1), 0, 100)
      pushLog(state, 'cup', `${compCn(rec.comp)} ${rec.label} vs ${rec.opp} ${score} ${drawn ? '平' : won ? '胜' : '负'} · 你 ${sum.kills}/${sum.deaths}/${sum.assists} · ACS ${rec.acs}${rec.mvp ? ' · MVP' : ''}`)
      // a cup played hurt: what it did, after the result (me/hurtplay.ts)
      injuryAfterMatch(state, rec)
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
        // 运动心理 takes a fifth off what a loss leaves behind (me/shop.ts)
        const lossTilt = won ? -6 : drawn ? 2 : rank >= 5 ? 14 : 8
        me.tilt = clamp(me.tilt + (lossTilt > 0 ? lossTilt * psychMul(me.courses ?? []) : lossTilt), 0, 100)
        if (won && rank === 1) me.mental = clamp(me.mental + 0.5, 0, 100)
      }
      const line = started
        ? `${compCn(rec.comp)} ${rec.label} vs ${rec.oppTag} ${score} ${drawn ? '平' : won ? '胜' : '负'} · 你 ${sum.kills}/${sum.deaths}/${sum.assists} · ACS ${rec.acs} · 评分 ${rec.rating.toFixed(2)}${rec.mvp ? ' · MVP' : ''}${rec.carried ? ' · 输了比赛但你全队最高' : ''}`
        : `${compCn(rec.comp)} ${rec.label} vs ${rec.oppTag} ${score} ${drawn ? '平' : won ? '胜' : '负'} —— 你在替补席看完了这场。`
      pushLog(state, 'match', line)
      afterMyMatch(state, rec)
      // played through an injury, or stepped in for an injured team-mate (me/hurtplay.ts)
      injuryAfterMatch(state, rec)
    }
    me.pendingFixture = undefined
    refreshMyRounds(state)
  }
}
