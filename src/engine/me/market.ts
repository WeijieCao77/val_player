import { Rng, clamp } from '../rng'
import type { GameState, Player, Role, Team } from '../types'
import { regionIn } from '../era'
import { importBlock } from '../imports'
import { bookCovers, hasPlace, isTimelineWorld } from '../timeline'
import { clubWindow, feeOf, joinRoster } from './club'
import { pushLog } from './log'

/**
 * The market around a player: 破晓's AI market (market.ts), on this world.
 *
 * In 破晓 the market moves at two moments — the mid-season break and the
 * winter — and in two ways. A man below who has outgrown the man above him in
 * his job goes up in his place. And in the winter a bottom-half club's young
 * standout is bought by a top-half club with a weaker man in that job, one for
 * one. Each window's moves are capped, a club moves once a window, and nothing
 * touches the player's own job at his own club. Nobody bids, lists or haggles:
 * a move happens or it does not, and it is in the news.
 *
 * Here the moments are the two windows a player moves in (me/transfer.ts
 * PLAYER_WINDOWS). A year the roster book covers is history's — every club out
 * of the player's reach takes the field with the people it really had
 * (engine/timeline.ts) — so only his own club looks for help that year, among
 * the free agents (me/club.ts clubWindow). Past the book there is no history
 * to keep, and the whole world turns over this way. The one number a club can
 * pay with is its budget; a man's attachment to his club is his reason to stay.
 *
 * The thresholds are this game's, on its rating scale, not 破晓's.
 */

/** A standout: this far above his own club's rating. */
const STANDOUT = 5
/** And young enough for somebody to bet on. */
const YOUNG = 24
/** How much better than the buyer's man in that job he has to be. */
const UPGRADE = 3
/** A Challengers man going up: this far past a VCT club's man in his job. */
const PROMOTE_GAP = 5
const TRADE_ODDS = 0.3
const PROMOTE_ODDS = 0.6
/** Promotions a window, per region. */
const PROMOTIONS = 2
/** Moves a window writes into the news, at most. */
const NEWS_LINES = 12

/** Past the roster book there is no history to keep: the whole world turns over by the market. */
export const simulatedYear = (state: GameState): boolean => !isTimelineWorld(state) || !bookCovers(state.year)

const jobsOf = (p: Player): Role[] => p.roles ?? [p.role]

interface Move { p: Player; from: Team; q: Player; to: Team }

/** A player window opens (me/week.ts): the player's club in any year, the world past the book. */
export function marketWindow(state: GameState, rng: Rng, winter: boolean): void {
  clubWindow(state, rng)
  if (!simulatedYear(state)) return

  const me = state.me
  const myClub = me?.phase === 'pro' ? state.myTeam : null
  const myRole = me ? state.players[me.id]?.role : undefined
  const moved = new Set<string>()
  const lines: { text: string; mine: boolean }[] = []

  const movable = (p: Player | undefined): p is Player =>
    !!p && p.id !== me?.id && !p.retiring && p.joinedYear !== state.year
  // never my job at my club
  const mineJob = (team: Team, role: Role) => team.id === myClub && role === myRole
  // a man who belongs where he is rarely goes
  const willing = (p: Player) => clamp((95 - (p.loyalty ?? 50)) / 45, 0.2, 1)
  const weakestIn = (team: Team, role: Role): Player | undefined =>
    team.roster.map((id) => state.players[id])
      .filter((q): q is Player => movable(q) && jobsOf(q).includes(role))
      .sort((a, b) => a.overall - b.overall)[0]

  const swap = ({ p, from, q, to }: Move): void => {
    const fee = Math.max(0, feeOf(p) - feeOf(q))
    joinRoster(state, p, to, rng)
    joinRoster(state, q, from, rng)
    to.budget -= fee
    from.budget += fee
    moved.add(from.id)
    moved.add(to.id)
    const mine = from.id === myClub || to.id === myClub
    lines.push({ mine, text: `${to.name} 从 ${from.name} 换来 ${p.ign}（${p.overall}），${q.ign} 去了 ${from.name}。` })
    if (to.id === myClub) pushLog(state, 'team', `俱乐部从 ${from.name} 换来 ${p.ign}（${p.role}），${q.ign} 去了那边。`)
    else if (from.id === myClub) pushLog(state, 'team', `${p.ign} 去了 ${to.name}，${q.ign} 从那边过来。`)
  }

  const clubs = Object.values(state.teams).filter((t) => !t.dormant && t.roster.length >= 5 && hasPlace(state, t))

  // ---- every window: a Challengers man who has outgrown a VCT club's man in his job goes up in his place
  const regions = new Map<string, Team[]>()
  for (const t of clubs) {
    const r = regionIn(t.region, state.year)
    regions.set(r, [...(regions.get(r) ?? []), t])
  }
  for (const teams of regions.values()) {
    const above = teams.filter((t) => t.tier === 1)
    const options: (Move & { gap: number })[] = []
    for (const from of teams.filter((t) => t.tier === 2)) {
      for (const id of from.roster) {
        const p = state.players[id]
        if (!movable(p) || mineJob(from, p.role)) continue
        for (const to of above) {
          if (mineJob(to, p.role)) continue
          const q = weakestIn(to, p.role)
          if (q && p.overall >= q.overall + PROMOTE_GAP) options.push({ p, from, q, to, gap: p.overall - q.overall })
        }
      }
    }
    let done = 0
    for (const o of options.sort((a, b) => b.gap - a.gap)) {
      if (done >= PROMOTIONS) break
      if (moved.has(o.from.id) || moved.has(o.to.id)) continue
      if (o.p.teamId !== o.from.id || o.q.teamId !== o.to.id) continue
      if (importBlock(state, o.to.id, o.p) || importBlock(state, o.from.id, o.q)) continue
      if (o.to.budget < feeOf(o.p) - feeOf(o.q)) continue
      if (!rng.chance(PROMOTE_ODDS * willing(o.p))) continue
      swap(o)
      done++
    }
  }

  // ---- the winter: a bottom-half club's young standout to a top-half club with a weaker man in his job
  if (winter) {
    const leagues = new Map<string, Team[]>()
    for (const t of clubs) {
      const k = `${regionIn(t.region, state.year)}:${t.tier}:${t.tier === 2 ? t.scene ?? '' : ''}`
      leagues.set(k, [...(leagues.get(k) ?? []), t])
    }
    for (const league of leagues.values()) {
      if (league.length < 4) continue
      const ranked = league.slice().sort((a, b) => b.rating - a.rating)
      const half = Math.floor(ranked.length / 2)
      const buyers = ranked.slice(0, half)
      const cap = Math.max(1, Math.round(league.length * 0.25))
      let done = 0
      for (const from of ranked.slice(half)) {
        if (done >= cap) break
        if (moved.has(from.id)) continue
        const p = from.roster.map((id) => state.players[id])
          .filter((x): x is Player => movable(x) && x.age <= YOUNG && x.overall >= from.rating + STANDOUT && !mineJob(from, x.role))
          .sort((a, b) => b.overall - a.overall)[0]
        if (!p) continue
        const open = buyers
          .filter((to) => !moved.has(to.id) && !mineJob(to, p.role))
          .map((to) => ({ to, q: weakestIn(to, p.role) }))
          .filter((x): x is { to: Team; q: Player } => !!x.q && p.overall >= x.q.overall + UPGRADE)
          .filter(({ to, q }) => !importBlock(state, to.id, p) && !importBlock(state, from.id, q) && to.budget >= feeOf(p) - feeOf(q))
        if (!open.length || !rng.chance(TRADE_ODDS * willing(p))) continue
        const { to, q } = rng.pick(open)
        swap({ p, from, q, to })
        done++
      }
    }
  }

  if (!lines.length) return
  const ordered = [...lines.filter((l) => l.mine), ...lines.filter((l) => !l.mine)]
  for (const l of ordered.slice(0, NEWS_LINES)) {
    state.news.push({ day: state.day, kind: 'transfer', important: l.mine, text: l.text })
  }
  if (lines.length > NEWS_LINES) {
    state.news.push({ day: state.day, kind: 'transfer', text: `转会窗里另有 ${lines.length - NEWS_LINES} 笔一换一的交易。` })
  }
}
