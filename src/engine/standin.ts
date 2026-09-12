import type { Fixture, GameState, MatchResult, Player, Region, Role, Team } from './types'
import { regionIn } from './era'

/**
 * Who takes the floor when a club cannot put five fit men of its own on it.
 *
 * Riot does not hand a team a forfeit because somebody is hurt. A team
 * registers five starters and its substitutes (VCT Global Competition Policy
 * v2.0, 2022, §3.3.1; a 2023 league roster ran six to ten, reserves included);
 * a registered substitute comes on between maps (VCT Official Competition
 * Ruleset, Dec 2025, §4.6.16); and when an emergency still leaves a team
 * without five, officials may let it bring somebody in during roster lock
 * (GCP 2022 §3.5.2) or waive the roster requirement for a medical emergency
 * (Challengers EMEA 2025 §3.5.2). The forfeit is the last line, and even that
 * is left to a league official's discretion (ruleset §6.3.1). At the real
 * internationals Paper Rex played its registered cgrs at Tokyo 2023, Team
 * Liquid brought in penny as a stand-in at Toronto 2025, and KRÜ went into the
 * 2026 Americas Kickoff with its academy players and two stand-ins.
 *
 * So a club's five come, in this order, from (engine/match.ts selectLineup):
 *   1. its named starters who are fit;
 *   2. its registered bench, fit men only;
 *   3. its academy — 「T1 Academy」 is T1's, read off the clubs' real names —
 *      on a day the academy is not playing itself;
 *   4. an emergency stand-in: a real free agent of the club's own region, fit,
 *      no better than the club's own five, and not already on another club's
 *      floor today — the same man for the rest of the lay-off;
 *   5. and only when there is nobody at all, an injured man of its own.
 *
 * Nobody is invented. A man from outside the roster is marked on the result
 * (MatchResult.standIns) and the news says who was out and who came on.
 */

/** What a man from outside the registered roster costs a side on top of his rating: he has not drilled the club's calls. */
export const STANDIN_COST = 1.5

const CORE: Role[] = ['决斗者', '先锋', '控场', '哨卫']
/** How long a club's stand-in is remembered, so one man covers a lay-off instead of a new one each match. */
const STICKY_DAYS = 21
/** 「T1 Academy」「Gen.G Global Academy」「EDward Gaming Youth」 — and not 「OverPowered Youths」 or 「FUTURE ACADEMY TEAM」. */
const ACADEMY = /\s+(?:global\s+)?(?:academy|youth)$/i

const fitOn = (state: GameState, p: Player | undefined): p is Player => !!p && p.injuredUntil <= state.day
const plays = (f: Fixture, teamId: string) => f.teamA === teamId || f.teamB === teamId
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The club an academy belongs to, by its real name: that name, or that club's own tag, in the same region. */
export function parentOf(state: GameState, team: Team): Team | undefined {
  const m = ACADEMY.exec(team.name)
  if (!m) return undefined
  const base = team.name.slice(0, m.index).trim().toLowerCase()
  if (!base) return undefined
  const region = regionIn(team.region, state.year)
  let best: Team | undefined
  for (const t of Object.values(state.teams)) {
    if (t.id === team.id || t.dormant || ACADEMY.test(t.name) || regionIn(t.region, state.year) !== region) continue
    const name = t.name.toLowerCase()
    if (name !== base && t.tag.toLowerCase() !== base && !name.startsWith(`${base} `)) continue
    if (!best || t.tier < best.tier || (t.tier === best.tier && byId(t, best) < 0)) best = t
  }
  return best
}

/** A club's own academy, if this world holds one. */
export function academyOf(state: GameState, team: Team): Team | undefined {
  if (ACADEMY.test(team.name)) return undefined
  const id = academiesOf(state).get(team.id)
  return id ? state.teams[id] : undefined
}

/**
 * Every club's academy, read once a day — again only if a club is founded,
 * goes quiet or wakes that day. Walking every club for every call-up was a
 * tenth of a 2027 season's running time.
 */
const ACADEMIES = new WeakMap<GameState, { key: string; map: Map<string, string> }>()
function academiesOf(state: GameState): Map<string, string> {
  const teams = Object.values(state.teams)
  let active = 0
  for (const t of teams) if (!t.dormant) active++
  const key = `${state.year}:${state.day}:${teams.length}:${active}`
  const hit = ACADEMIES.get(state)
  if (hit?.key === key) return hit.map
  const map = new Map<string, string>()
  for (const t of teams.filter((x) => !x.dormant && ACADEMY.test(x.name)).sort(byId)) {
    const parent = parentOf(state, t)
    if (parent && !map.has(parent.id)) map.set(parent.id, t.id)
  }
  ACADEMIES.set(state, { key, map })
  return map
}

/** The day's free agents, read once a day and checked again at use: a man signed since is never called up. */
const FREE = new WeakMap<GameState, { key: string; list: Player[] }>()
function freeAgents(state: GameState): Player[] {
  const key = `${state.year}:${state.day}`
  const hit = FREE.get(state)
  if (hit?.key === key) return hit.list
  const list = Object.values(state.players).filter((p) => p.teamId === null && !p.retiring)
  FREE.set(state, { key, list })
  return list
}

/** Everyone already on some other club's floor today. */
function onFloorToday(state: GameState, teamId: string): Set<string> {
  const out = new Set<string>()
  for (const f of state.fixtures) {
    if (!f.played || f.day !== state.day || !f.result?.lineups) continue
    if (f.teamA !== teamId) for (const id of f.result.lineups.a) out.add(id)
    if (f.teamB !== teamId) for (const id of f.result.lineups.b) out.add(id)
  }
  return out
}

/** Who stood in for this club lately. */
function lateStandIns(state: GameState, teamId: string): Set<string> {
  const out = new Set<string>()
  for (const f of state.fixtures) {
    const s = f.result?.standIns
    if (!s || !f.played || f.day > state.day || state.day - f.day > STICKY_DAYS) continue
    if (f.teamA === teamId) for (const id of s.a) out.add(id)
    if (f.teamB === teamId) for (const id of s.b) out.add(id)
  }
  return out
}

export interface Callups {
  /** the academy's fit men, best first — empty when the academy plays today */
  academy: Player[]
  /** whoever stood in for this club lately and is still free and fit: he covers the rest of the lay-off */
  again: Player[]
  /** the region's other fit free agents worth a look, best first */
  free: Player[]
}

/**
 * The men a club short of five fit players of its own may bring in.
 *
 * `rivalFive`, when given, picks today's opponent's five. If that side is short
 * too, the club with the lower id calls up first and this one does not take
 * the same man — both halves of one match reading the same free agent was the
 * one way a man could otherwise be on both sides of the server.
 */
export function callupPool(state: GameState, teamId: string, rivalFive?: (id: string) => Player[]): Callups {
  const team = state.teams[teamId]
  if (!team) return { academy: [], again: [], free: [] }
  const meId = state.me?.id
  const taken = onFloorToday(state, teamId)
  if (rivalFive) {
    const f = state.fixtures.find((x) => !x.played && x.day <= state.day && plays(x, teamId))
    const rival = f ? (f.teamA === teamId ? f.teamB : f.teamA) : null
    if (rival && rival < teamId && state.teams[rival]) {
      const theirs = new Set(state.teams[rival].roster)
      for (const p of rivalFive(rival)) if (!theirs.has(p.id)) taken.add(p.id)
    }
  }
  // the career's own player is his own story (engine/me), never a stand-in for somebody else's club
  const usable = (p: Player | undefined): p is Player => fitOn(state, p) && !p.retiring && p.id !== meId && !taken.has(p.id)

  const acad = academyOf(state, team)
  const academy = acad && !state.fixtures.some((f) => f.day === state.day && plays(f, acad.id))
    ? acad.roster.map((id) => state.players[id]).filter(usable).sort((a, b) => b.overall - a.overall || byId(a, b))
    : []

  // the club's region as it is organised this year, and where that has nobody free, the region it belongs to now
  const free = freeAgents(state).filter((p) => p.teamId === null && usable(p))
  const inRegion = (year: number) => {
    const r: Region = regionIn(team.region, year)
    return free.filter((p) => regionIn(p.region, year) === r)
  }
  let pool = inRegion(state.year)
  if (!pool.length) pool = inRegion(9999)
  // The man who stood in last time comes back. Chosen afresh each match, the
  // one who had just played lost the next pick to his own fatigue, and a club
  // went through three free agents in three days for one heavy cold.
  const recent = lateStandIns(state, teamId)
  const again = pool.filter((p) => recent.has(p.id)).sort((a, b) => b.overall - a.overall || byId(a, b))
  // A level a club finds on a match day: no better than the club it covers for.
  // Ranked on rating alone, Copenhagen 2022 had DRX calling in a 90-rated free
  // agent for a side rated 87 — a stand-in that made them stronger. Only a
  // region with fewer than three such men looks above that.
  const others = pool.filter((p) => !recent.has(p.id))
  const plausible = others.filter((p) => p.overall <= team.rating)
  const home = (p: Player) => (p.region === team.region ? 2 : 0)
  const ranked = (plausible.length >= 3 ? plausible : others)
    .sort((a, b) => b.overall + home(b) - (a.overall + home(a)) || byId(a, b))
  // the best ten, and the best two of every job, for the lineup's own judgement of fit (match.ts)
  const look = new Set(ranked.slice(0, 10))
  for (const role of CORE) for (const p of ranked.filter((q) => (q.roles ?? [q.role]).includes(role)).slice(0, 2)) look.add(p)
  return { academy, again, free: ranked.filter((p) => look.has(p)) }
}

/** 「X 伤缺，Y 替补上场」 — or null when nobody came on for anybody. */
function changeLine(state: GameState, team: Team, ids: string[], outsiders: string[]): string | null {
  const ign = (id: string) => state.players[id]?.ign ?? id
  const played = new Set(ids)
  const out = team.roster.filter((id) => !played.has(id) && team.starters.includes(id)
    && (state.players[id]?.injuredUntil ?? 0) > state.day)
  const bench = ids.filter((id) => team.roster.includes(id) && !team.starters.includes(id))
  const fromAcademy = outsiders.filter((id) => { const t = state.players[id]?.teamId; return !!t && t !== team.id })
  const free = outsiders.filter((id) => !state.players[id]?.teamId)
  const came: string[] = []
  if (out.length && bench.length) came.push(`${bench.map(ign).join('、')} 替补上场`)
  if (fromAcademy.length) {
    const club = state.teams[state.players[fromAcademy[0]]?.teamId ?? '']
    came.push(`从 ${club?.name ?? '青训队'} 调来 ${fromAcademy.map(ign).join('、')} 替补`)
  }
  if (free.length) came.push(`自由人 ${free.map(ign).join('、')} 临时顶替上场`)
  if (!came.length) return null
  return `${team.name}：${out.length ? `${out.map(ign).join('、')} 伤缺` : '可上场的不足五人'}，${came.join('，')}。`
}

/**
 * The news when a match took a man off the bench for an injured starter, or
 * brought one in from outside the roster. Once per club per change: a lay-off
 * that covers a week of matches is one line, not one a match. On the player's
 * own match day the week's digest hears about the other side's changes, and
 * about a stand-in in his own club's five (his team-mates' lay-offs are said
 * when the week opens, me/hurtplay.ts mateInjuryWeek).
 */
export function lineupNews(state: GameState, f: Fixture, result: MatchResult, notes: string[]): void {
  if (f.comp === 'scrim') return
  const mine = state.myTeam
  const ours = !!mine && plays(f, mine)
  for (const side of ['a', 'b'] as const) {
    const teamId = side === 'a' ? f.teamA : f.teamB
    const team = state.teams[teamId]
    const ids = result.lineups?.[side]
    if (!team || !ids?.length || teamId.startsWith('CUP_')) continue
    const outsiders = result.standIns?.[side] ?? []
    const text = changeLine(state, team, ids, outsiders)
    if (!text) continue
    if (state.news.some((n) => n.text === text && n.day <= state.day && state.day - n.day <= STICKY_DAYS)) continue
    state.news.push({ day: state.day, kind: 'club', text, important: ours || undefined })
    if (ours && (teamId !== mine || outsiders.length)) notes.push(text)
  }
}
