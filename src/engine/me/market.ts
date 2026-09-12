import { Rng, clamp } from '../rng'
import { ROLES } from '../types'
import type { GameState, Player, Role, Team } from '../types'
import { regionIn } from '../era'
import { importBlock } from '../imports'
import { bookCovers, hasPlace, inVctLeague, isTimelineWorld, pastTheBook } from '../timeline'
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
 * to keep, and the whole world turns over this way. The book's last season is
 * history's only as far as it has been played (timeline.ts pastTheBook): 2026's
 * winter window opens in November, after the last day the book has anyone
 * playing, with no 2027 roster anywhere — so that off-season, which has not
 * happened, turns over on the same rules as every one after it. The one number a
 * club can pay with is its budget; a man's attachment to his club is his reason to stay.
 *
 * How much turns over past the book is the author's call (2026-09-12), made
 * against the real off-seasons of the partnered leagues: from one season's
 * last event to the next one's first, a partner changed 4.0–4.6 of its people
 * a winter in 2023–26 — about half of its newcomers from Challengers, the rest
 * from other partners and free agency — and 36–67 players went up from
 * Challengers. The world aims at the middle of that: about 2.5–3 changes a VCT
 * club and about 25 players up a winter. So the winter is where a year's moves
 * are made, as it really is:
 *
 *  - in the winter window a VCT club rebuilding bets on what a Challengers man
 *    will be as well as what he is — his rating and half the room above it, the
 *    way a club reads a free agent (me/club.ts) — and takes him when he is worth
 *    more than its man in his job; a Challengers club can lose two that way
 *  - a VCT league trades among itself, and there ratings sit close together,
 *    so less of a standout will do; a club that took a man up can still trade
 *  - at New Year, with the deals that ran out gone, a VCT club fills back to
 *    five and a sixth from the free agents, the best clubs choosing first
 *    (marketTurn) — which is where a good man his club did not renew goes next
 *
 * The mid-season break stays a small window, on ratings alone. The player's
 * own club is in one of these moves every other season at most.
 *
 * The thresholds are this game's, on its rating scale, not 破晓's.
 */

/** A standout: this far above his own club's rating. */
const STANDOUT = 5
/** And young enough for somebody to bet on. */
const YOUNG = 24
/** How much better than the buyer's man in that job he has to be. */
const UPGRADE = 3
/** In a VCT league: a standout is anyone at or above his club's rating… */
const STANDOUT_TOP = 0
/** …up to this age… */
const YOUNG_TOP = 30
/** …and a little better than the buyer's man is enough. */
const UPGRADE_TOP = 1
const TRADE_ODDS = 0.3
const TRADE_ODDS_TOP = 0.8
/** A Challengers man going up at the mid-season break: this far past a VCT club's man in his job, on ratings. */
const PROMOTE_GAP = 5
const PROMOTE_ODDS = 0.6
/** Promotions at the mid-season break, per region; a Challengers club gives up one man. */
const PROMOTIONS = 2
/** Promotions in the winter, per region: worth more than the VCT club's man in his job is enough. */
const PROMOTIONS_WINTER = 6
/**
 * A league whose real winters sent far fewer up has its own cap. The roster book's off-seasons — on a Challengers
 * roster at a season's last event, on a VCT one at the next season's first — took 1 Challengers player into
 * China's league in 2024→25 and 2 in 2025→26 (18 the winter its league opened), while Americas took 8 and 17,
 * EMEA 19 and 20, Pacific 8 and 13. At six a winter China filled its cap every year.
 */
const PROMOTIONS_WINTER_BY_LEAGUE: Partial<Record<string, number>> = { China: 2 }
const PROMOTE_ODDS_WINTER = 0.9
/** How many men a Challengers club can lose upward in the winter. */
const LOSSES_WINTER = 2
/**
 * In the winter window a VCT league club may take up to two men from Challengers
 * and make up to two trades — one of each at the mid-season break, and a
 * Challengers club still trades once. Once the rating ruler (engine/ruler.ts) put
 * everyone on one scale, the league caps held nothing back: reading 2027's winter
 * pool (China 33, Europe 11), a cap of 99 moved the same people as a cap of 6,
 * and 12–59 of each league's chances were stopped because the VCT club had
 * already moved once. The world's top-tier churn had fallen to 2.2–2.35 a club
 * against the author's 2.5–3 (2026-09-12: relax the two rules together).
 */
const TOP_MOVES_WINTER = 2
/**
 * How much of a winter promotion's cost a club's budget must cover, in a league
 * where the budget is what stops most of its chances. EMEA's clubs run budgets
 * below zero, and the budget stopped 71–87% of its chances in 2027's winter
 * (177 of 251, 189 of 217); China 32–48%, Pacific 19–40%, Americas 5–33%, where
 * something else stops most. A move that saves the club money is judged as before.
 */
const BUDGET_COVER_WINTER: Partial<Record<string, number>> = { EMEA: 0.7 }
/** A VCT club after New Year: five and a sixth. */
const TOP_SQUAD = 6
/** The player's own club is in a market move once in this many seasons at most. */
const MINE_EVERY = 2
/** Moves a window writes into the news, at most. */
const NEWS_LINES = 12

/** Past the roster book — its last season's winter included — there is no history to keep: the whole world turns over by the market. */
export const simulatedYear = (state: GameState): boolean => !isTimelineWorld(state) || pastTheBook(state)

const jobsOf = (p: Player): Role[] => p.roles ?? [p.role]
/** What a man is worth to a club rebuilding: what he is, and half of what he has still to become. */
const worth = (p: Player): number => p.overall + Math.max(0, p.potential - p.overall) * 0.5

interface Move { p: Player; from: Team; q: Player; to: Team }

/** A player window opens (me/week.ts): the player's club in any year, the world past the book. */
export function marketWindow(state: GameState, rng: Rng, winter: boolean): void {
  const mineBefore = new Set(state.teams[state.myTeam]?.roster ?? [])
  clubWindow(state, rng)
  if (!simulatedYear(state)) return

  const me = state.me
  const myClub = me?.phase === 'pro' ? state.myTeam : null
  const myRole = me ? state.players[me.id]?.role : undefined
  const lines: { text: string; mine: boolean }[] = []

  // A man who changed clubs this season waits for the next one. In the book's last season that is only whoever
  // his club signed in this very window: every earlier move that year was history's, the market had not opened,
  // and 86–91% of each league's Challengers players "joined" 2026 when the book set that year's real rosters —
  // read as the market's own moves, they left China nobody to send up and the other leagues a handful.
  const lastBookSeason = bookCovers(state.year)
  const joinedNow = (p: Player): boolean => lastBookSeason
    ? !!state.myTeam && p.teamId === state.myTeam && !mineBefore.has(p.id)
    : p.joinedYear === state.year
  const movable = (p: Player | undefined): p is Player =>
    !!p && p.id !== me?.id && !p.retiring && !joinedNow(p)
  // never my job at my club
  const mineJob = (team: Team, role: Role) => team.id === myClub && role === myRole
  // and my club is in one of these moves every other season at most
  const capped = (team: Team): boolean =>
    team.id === myClub && !!me && me.flags.marketMoved !== undefined && state.year - me.flags.marketMoved < MINE_EVERY
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
    const mine = from.id === myClub || to.id === myClub
    if (mine && me) me.flags.marketMoved = state.year
    lines.push({ mine, text: `${to.name} 从 ${from.name} 换来 ${p.ign}（${p.overall}），${q.ign} 去了 ${from.name}。` })
    if (to.id === myClub) pushLog(state, 'team', `俱乐部从 ${from.name} 换来 ${p.ign}（${p.role}），${q.ign} 去了那边。`)
    else if (from.id === myClub) pushLog(state, 'team', `${p.ign} 去了 ${to.name}，${q.ign} 从那边过来。`)
  }

  const clubs = Object.values(state.teams).filter((t) => !t.dormant && t.roster.length >= 5 && hasPlace(state, t))

  // ---- every window: a Challengers man who has outgrown a VCT club's man in his job goes up in his place
  const odds = winter ? PROMOTE_ODDS_WINTER : PROMOTE_ODDS
  const losses = winter ? LOSSES_WINTER : 1
  // mid-season a club goes by what a man is; in the winter, by what he is worth to it
  const upBy = (p: Player, q: Player): number | null => {
    if (winter) return worth(p) > worth(q) ? worth(p) - worth(q) : null
    return p.overall >= q.overall + PROMOTE_GAP ? p.overall - q.overall : null
  }
  const lost = new Map<string, number>()
  const regions = new Map<string, Team[]>()
  for (const t of clubs) {
    const r = regionIn(t.region, state.year)
    regions.set(r, [...(regions.get(r) ?? []), t])
  }
  for (const [league, teams] of regions) {
    const cap = winter ? PROMOTIONS_WINTER_BY_LEAGUE[league] ?? PROMOTIONS_WINTER : PROMOTIONS
    const above = teams.filter((t) => t.tier === 1)
    const options: (Move & { gap: number })[] = []
    for (const from of teams.filter((t) => t.tier === 2)) {
      for (const id of from.roster) {
        const p = state.players[id]
        if (!movable(p) || mineJob(from, p.role)) continue
        for (const to of above) {
          if (mineJob(to, p.role)) continue
          const q = weakestIn(to, p.role)
          const gap = q ? upBy(p, q) : null
          if (q && gap != null) options.push({ p, from, q, to, gap })
        }
      }
    }
    let done = 0
    const intake = new Map<string, number>()
    const intakeCap = winter ? TOP_MOVES_WINTER : 1
    const cover = winter ? BUDGET_COVER_WINTER[league] ?? 1 : 1
    for (const o of options.sort((a, b) => b.gap - a.gap)) {
      if (done >= cap) break
      if ((lost.get(o.from.id) ?? 0) >= losses || (intake.get(o.to.id) ?? 0) >= intakeCap || capped(o.from) || capped(o.to)) continue
      if (o.p.teamId !== o.from.id || o.q.teamId !== o.to.id) continue
      if (importBlock(state, o.to.id, o.p) || importBlock(state, o.from.id, o.q)) continue
      const cost = feeOf(o.p) - feeOf(o.q)
      if (o.to.budget < (cost > 0 ? cost * cover : cost)) continue
      if (!rng.chance(odds * willing(o.p))) continue
      swap(o)
      lost.set(o.from.id, (lost.get(o.from.id) ?? 0) + 1)
      intake.set(o.to.id, (intake.get(o.to.id) ?? 0) + 1)
      done++
    }
  }

  // ---- the winter: a bottom-half club's young standout to a top-half club with a weaker man in his job
  if (winter) {
    // a club that took a man up can still trade; a VCT league club up to twice, a Challengers club once
    const traded = new Map<string, number>()
    const tradedOut = (t: Team): boolean => (traded.get(t.id) ?? 0) >= (t.tier === 1 ? TOP_MOVES_WINTER : 1)
    const leagues = new Map<string, Team[]>()
    for (const t of clubs) {
      const k = `${regionIn(t.region, state.year)}:${t.tier}:${t.tier === 2 ? t.scene ?? '' : ''}`
      leagues.set(k, [...(leagues.get(k) ?? []), t])
    }
    for (const league of leagues.values()) {
      if (league.length < 4) continue
      const top = league[0].tier === 1
      const standout = top ? STANDOUT_TOP : STANDOUT
      const young = top ? YOUNG_TOP : YOUNG
      const upgrade = top ? UPGRADE_TOP : UPGRADE
      const tradeOdds = top ? TRADE_ODDS_TOP : TRADE_ODDS
      const ranked = league.slice().sort((a, b) => b.rating - a.rating)
      const half = Math.floor(ranked.length / 2)
      const buyers = ranked.slice(0, half)
      const leagueCap = Math.max(1, Math.round(league.length * 0.25))
      let done = 0
      for (const from of ranked.slice(half)) {
        if (done >= leagueCap) break
        if (tradedOut(from) || capped(from)) continue
        const p = from.roster.map((id) => state.players[id])
          .filter((x): x is Player => movable(x) && x.age <= young && x.overall >= from.rating + standout && !mineJob(from, x.role))
          .sort((a, b) => b.overall - a.overall)[0]
        if (!p) continue
        const open = buyers
          .filter((to) => !tradedOut(to) && !capped(to) && !mineJob(to, p.role))
          .map((to) => ({ to, q: weakestIn(to, p.role) }))
          .filter((x): x is { to: Team; q: Player } => !!x.q && p.overall >= x.q.overall + upgrade)
          .filter(({ to, q }) => !importBlock(state, to.id, p) && !importBlock(state, from.id, q) && to.budget >= feeOf(p) - feeOf(q))
        if (!open.length || !rng.chance(tradeOdds * willing(p))) continue
        const { to, q } = rng.pick(open)
        swap({ p, from, q, to })
        traded.set(from.id, (traded.get(from.id) ?? 0) + 1)
        traded.set(to.id, (traded.get(to.id) ?? 0) + 1)
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

/**
 * New Year's free agency past the book (me/week.ts, at the season turn, before
 * the newcomers come in). The deals that ran out are gone; a VCT club fills
 * back to five and a sixth from the free agents — the missing job first, then
 * whoever is worth most — the best clubs choosing first. Never the player's
 * own club: it fills its own way (me/club.ts).
 */
export function marketTurn(state: GameState, rng: Rng): void {
  const me = state.me
  if (!me || !isTimelineWorld(state) || bookCovers(state.year) || me.flags.freeAgency === state.year) return
  me.flags.freeAgency = state.year
  const myClub = me.phase === 'pro' ? state.myTeam : null
  const free = Object.values(state.players).filter((p) => !p.teamId && !p.retiring && p.id !== me.id)
  const clubs = Object.values(state.teams)
    .filter((t) => !t.dormant && t.id !== myClub && t.roster.length >= 5 && inVctLeague(state, t))
    .sort((a, b) => b.rating - a.rating)
  const signed: string[] = []
  for (const t of clubs) {
    let guard = 0
    while (t.roster.length < TOP_SQUAD && guard++ < TOP_SQUAD) {
      const have = new Set(t.roster.map((id) => state.players[id]).filter((p): p is Player => !!p).flatMap(jobsOf))
      const missing = ROLES.filter((r) => r !== '自由人' && !have.has(r))
      const fit = (p: Player) => worth(p) + (jobsOf(p).some((r) => missing.includes(r)) ? 4 : 0) + (p.region === t.region ? 2 : 0)
      const pick = free
        .filter((p) => !p.teamId && !importBlock(state, t.id, p))
        .reduce<Player | undefined>((best, p) => (!best || fit(p) > fit(best) ? p : best), undefined)
      if (!pick) break
      joinRoster(state, pick, t, rng)
      signed.push(`${t.tag || t.name} ${pick.ign}`)
    }
  }
  if (signed.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `新赛季自由市场：VCT 俱乐部签下 ${signed.slice(0, 8).join('、')}${signed.length > 8 ? ` 等 ${signed.length} 人` : ''}。`,
    })
  }
}
