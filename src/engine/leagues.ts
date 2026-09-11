import { eventOf, eventsOf, LAST_REAL_YEAR, worldIdOf } from './circuit'
import type { CEvent } from './circuit'
import { FIRST_AHEAD, KICKOFF_OPEN, LEAGUES, reselects } from './ahead'
import type { League } from './ahead'
import { onTimeline, regionIn, WORLD_END } from './era'
import { sceneFor, successorsOf } from './timeline'
import { REGION_CN } from './types'
import type { Competition, GameState, StageKey, Team, VctSeason } from './types'

/**
 * Who plays in the leagues from 2027 — 暂定 1 and 7 of engine/ahead.ts.
 *
 * Riot has said a partner's place is no longer for good and that each league
 * has eight; it has not said how the eight are chosen. Until it does: the day
 * after Champions, next season's eight of each league are this world's best of
 * the two seasons before — chosen for 2027, kept for 2028, chosen again for
 * 2029, 2031 and 2033, letting in at most MAX_NEW_PARTNERS clubs from outside
 * each time — and China's two visitors are the top two of its
 * Ascension. At the turn of the year they take their tiers, and the sides the
 * November open qualifiers sent through carry into Kickoff, if three of the
 * five who won the place are still on the team (Riot's rule for a side that is
 * not a partner).
 *
 * A club's standing is what its placings paid: a league event once, a Masters
 * twice, Champions three times, 10 for a win down to 1 for 13th–16th. A season
 * this world did not keep the books of — 2025, for a career that opened in 2026 —
 * counts its real placings.
 */

/** The day after Champions' final (266–290): next season's leagues are announced. */
export const ANNOUNCE_DAY = 293

/**
 * 暂定 7: a reselection lets at most this many clubs from outside into a
 * league's eight, and one more for each partner since gone — the pace the
 * leagues really took new clubs at, one a year through Ascension from 2024 to
 * 2026. The author's call, 2026-09-11. 2027's first eight are not held to it.
 */
export const MAX_NEW_PARTNERS = 2

const WEIGHT: Partial<Record<StageKey, number>> = { kickoff: 1, stage1: 1, stage2: 1, masters1: 2, masters2: 2, champions: 3 }
const placePoints = (p: number): number => (p === 1 ? 10 : p === 2 ? 8 : p === 3 ? 6 : p === 4 ? 5 : p <= 6 ? 4 : p <= 8 ? 3 : p <= 12 ? 2 : 1)

/** What an event counts for: a league's own event or an international — not an Open Playoffs, a qualifier, or the Challengers. */
function weightOf(ev: CEvent | undefined): number {
  if (!ev?.stage || ev.scene || ev.plan?.kind === 'open') return 0
  if (ev.region && !(LEAGUES as string[]).includes(ev.region)) return 0
  return WEIGHT[ev.stage] ?? 0
}

const add = (out: Record<string, number>, id: string, v: number): void => { out[id] = (out[id] ?? 0) + v }

/** The season on the books, as this world played it. */
function scoreComps(state: GameState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of Object.values(state.comps)) {
    if (c.format !== 'circuit' || !c.champion || !c.circuit) continue
    const w = weightOf(eventOf(c.circuit.id))
    if (w) c.finished.forEach((t, i) => add(out, t, w * placePoints(c.places?.[i] ?? i + 1)))
  }
  return out
}

/** The club a real side is in this world: the player's club that carried it on, itself, or what history carried it on as. */
function clubNow(state: GameState, vlr: string): string | null {
  const id = worldIdOf(vlr)
  if (!id) return null
  const heir = state.heirs?.[id]
  if (heir && state.teams[heir]) return heir
  for (const x of [id, ...successorsOf(id, LAST_REAL_YEAR)]) if (state.teams[x] && !state.teams[x].dormant) return x
  return null
}

/** A real season this world kept no books of: its real placings. */
function scoreReal(state: GameState, year: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const ev of eventsOf(year)) {
    const w = ev.projected ? 0 : weightOf(ev)
    if (!w) continue
    const seen = new Set<string>()
    for (const [v, p] of ev.places) {
      const t = clubNow(state, v)
      if (!t || seen.has(t)) continue
      seen.add(t)
      add(out, t, w * placePoints(p))
    }
  }
  return out
}

function scoreOf(state: GameState, year: number): Record<string, number> {
  if (year === state.year) return scoreComps(state)
  return state.vct?.results?.[String(year)] ?? (year <= LAST_REAL_YEAR ? scoreReal(state, year) : {})
}

/** At the turn, before the old season's events are cleared: the reselection reads two seasons back. */
export function keepScore(state: GameState, year: number): void {
  if (year < LAST_REAL_YEAR - 1 || !onTimeline(state)) return
  if (!Object.values(state.comps).some((c) => c.format === 'circuit')) return
  const results = ((state.vct ??= {}).results ??= {})
  results[String(year)] ??= scoreComps(state)
  for (const y of Object.keys(results)) if (Number(y) < year - 2) delete results[y]
}

const nameOf = (state: GameState, id: string): string => state.teams[id]?.name ?? id
const playerClub = (state: GameState): string | null => (state.me ? (state.me.phase === 'pro' ? state.myTeam : null) : state.myTeam)
const active = (t: Team | undefined): t is Team => !!t && !t.dormant && t.roster.length >= 5

/** A season's partners and visitors, on the rules above. */
function drawLeagues(state: GameState, year: number): VctSeason {
  const prev = state.vct?.now
  const fresh = reselects(year) || !prev
  const last = scoreOf(state, year - 1)
  const two: Record<string, number> = { ...scoreOf(state, year - 2) }
  for (const [id, v] of Object.entries(last)) add(two, id, v)
  const by = (score: Record<string, number>) => (a: Team, b: Team): number =>
    (score[b.id] ?? 0) - (score[a.id] ?? 0) || a.tier - b.tier || b.rating - a.rating || a.id.localeCompare(b.id)
  const partners: Record<string, string[]> = {}
  for (const L of LEAGUES) {
    const ranked = Object.values(state.teams).filter((t) => active(t) && regionIn(t.region, year) === L).sort(by(two))
    const kept = (prev?.partners[L] ?? []).map((id) => state.teams[id]).filter(active)
    let eight: Team[]
    if (!fresh) eight = kept
    else if (!prev) eight = ranked.slice(0, 8)
    else {
      // the best eight of the two seasons, but no more than MAX_NEW_PARTNERS of them from outside — one
      // more for each partner since gone — and the other seats to the best of the partners already there
      const was = new Set(kept.map((t) => t.id))
      const newcomers = ranked.slice(0, 8).filter((t) => !was.has(t.id)).slice(0, MAX_NEW_PARTNERS + 8 - kept.length)
      eight = [...ranked.filter((t) => was.has(t.id)).slice(0, 8 - newcomers.length), ...newcomers]
    }
    if (eight.length < 8) {
      // a partner that has since folded: the next best of the two seasons takes its seat
      const have = new Set(eight.map((t) => t.id))
      eight = [...eight, ...ranked.filter((t) => !have.has(t.id)).slice(0, 8 - eight.length)]
    }
    // best of the season just played first: Kickoff's four byes
    partners[L] = eight.sort(by(last)).map((t) => t.id)
  }
  const cn = new Set(partners.China)
  const ascension = Object.values(state.comps).find((c) => {
    const ev = c.format === 'circuit' && c.circuit ? eventOf(c.circuit.id) : undefined
    return !!ev && ev.stage === 'ascension' && ev.region === 'China' && (!ev.plan || ev.plan.kind === 'ascension')
  })
  const visitors = (ascension?.finished ?? []).filter((id) => active(state.teams[id]) && !cn.has(id)).slice(0, 2)
  if (visitors.length < 2) {
    // no Ascension on the books to read: the best Chinese clubs outside the league
    const rest = Object.values(state.teams)
      .filter((t) => active(t) && regionIn(t.region, year) === 'China' && !cn.has(t.id) && !visitors.includes(t.id))
      .sort(by(last))
    for (const t of rest.slice(0, 2 - visitors.length)) visitors.push(t.id)
  }
  return { year, partners, visitors, reselected: fresh }
}

function announce(state: GameState, s: VctSeason, notes: string[]): void {
  const leagues = LEAGUES.map((L) => `${REGION_CN[L]} ${s.partners[L].map((id) => nameOf(state, id)).join('、')}`).join('；')
  const rule = !s.reselected ? '合作名单两年一选，这一年不变'
    : `按 ${s.year - 2}–${s.year - 1} 两年成绩取前 8${s.year > FIRST_AHEAD ? `，每个联赛最多换进 ${MAX_NEW_PARTNERS} 支新队` : ''}`
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `🏛️ ${s.year} 赛季合作战队${s.reselected ? '公布' : '不变'}（暂定规则：${rule}）：${leagues}。`
      + `中国访客：${s.visitors.map((id) => nameOf(state, id)).join('、') || '—'}。`,
  })
  const club = playerClub(state)
  const t = club ? state.teams[club] : undefined
  if (!t) return
  const L = LEAGUES.find((x) => s.partners[x].includes(t.id))
  if (L && (s.reselected || t.tier !== 1)) {
    notes.push(t.tier === 1 ? `🏛️ ${t.name} 留在了 ${s.year} 赛季 VCT ${L} 的合作战队里。` : `🏛️ ${t.name} 入选 ${s.year} 赛季 VCT ${L} 合作战队。`)
  } else if (!L && s.visitors.includes(t.id)) {
    notes.push(`🏛️ ${t.name} 拿到 ${s.year} 赛季中国联赛的访客席位。`)
  } else if (!L && t.tier === 1) {
    notes.push(`🏛️ ${t.name} 不在 ${s.year} 赛季的联赛名单上——要回联赛，得从 11 月的公开资格赛打起。`)
  }
}

/** The day after Champions: next season's partners and China's visitors. */
export function announceLeagues(state: GameState, notes: string[]): void {
  const year = state.year + 1
  if (state.day < ANNOUNCE_DAY || year < FIRST_AHEAD || year >= WORLD_END || !onTimeline(state)) return
  if (state.vct?.next?.year === year) return
  const next = drawLeagues(state, year)
  ;(state.vct ??= {}).next = next
  announce(state, next, notes)
}

/** Riot's rule for a side that is not a partner: three of the five who won its place still on it. */
function keptFive(state: GameState, c: Competition, id: string): boolean {
  const played = new Set<string>()
  for (const f of state.fixtures) {
    if (f.comp !== c.key || !f.result?.lineups) continue
    if (f.teamA === id) for (const p of f.result.lineups.a) played.add(p)
    if (f.teamB === id) for (const p of f.result.lineups.b) played.add(p)
  }
  return !played.size || (state.teams[id]?.roster ?? []).filter((p) => played.has(p)).length >= 3
}

/** November's qualifiers, read before the old season's events are cleared: each place down its own qualifier's order. */
function carryQualified(state: GameState, year: number, s: VctSeason, lost: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const taken = new Set([...Object.values(s.partners).flat(), ...s.visitors])
  for (const L of LEAGUES) {
    out[L] = []
    for (const [key, k] of KICKOFF_OPEN[L]) {
      const c = state.comps[`ev:F${year - 1}:${key}`]
      if (!c?.champion) continue
      for (let j = k; j < c.finished.length; j++) {
        const id = c.finished[j]
        const t = state.teams[id]
        if (taken.has(id) || !t || t.dormant) continue
        taken.add(id)
        if (!keptFive(state, c, id)) {
          lost.push(`🎟️ ${t.name} 冬窗换人太多，赢下${c.name}的五个人留下不到三个，揭幕赛名额顺延给下一名。`)
          continue
        }
        out[L].push(id)
        break
      }
    }
  }
  return out
}

/**
 * The turn into a season of the new format, before the old season's events are
 * cleared: the leagues as announced take their tiers, and November's open
 * qualifiers' sides carry into Kickoff. A save that turned the year without an
 * announcement — one written before there was one — has its leagues drawn now.
 */
export function turnLeagues(state: GameState, notes: string[]): void {
  const year = state.year
  if (year < FIRST_AHEAD || !onTimeline(state)) return
  const vct = (state.vct ??= {})
  const announced = vct.next?.year === year
  const s = announced && vct.next ? vct.next : drawLeagues(state, year)
  if (!announced) announce(state, s, notes)
  const lost: string[] = []
  s.qualified = carryQualified(state, year, s, lost)
  vct.now = s
  vct.next = undefined

  const seat = new Map<string, League>()
  for (const L of LEAGUES) for (const id of [...s.partners[L], ...(L === 'China' ? s.visitors : [])]) seat.set(id, L)
  const up: string[] = []
  const down: string[] = []
  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    const L = seat.get(t.id)
    if (L) {
      if (t.tier !== 1) up.push(t.name)
      t.tier = 1
      t.league = `VCT ${L}`
    } else if (t.tier === 1) {
      down.push(t.name)
      t.tier = 2
      t.scene = sceneFor(state, t)
      t.league = `Challengers ${t.scene ?? t.region}`
    }
  }

  const q = LEAGUES.map((L) => `${REGION_CN[L]} ${(s.qualified?.[L] ?? []).map((id) => nameOf(state, id)).join('、') || '—'}`).join('；')
  state.news.push({ day: state.day, kind: 'league', important: true, text: `🎟️ ${year} 揭幕赛公开资格赛出线：${q}。` })
  if (up.length || down.length) {
    state.news.push({
      day: state.day, kind: 'league',
      text: `🏛️ ${year} 赛季${up.length ? `进入联赛：${up.join('、')}` : ''}${up.length && down.length ? '；' : ''}${down.length ? `离开联赛：${down.join('、')}` : ''}。`,
    })
  }
  for (const line of lost) state.news.push({ day: state.day, kind: 'league', text: line })
  const club = playerClub(state)
  if (club && Object.values(s.qualified).some((ids) => ids.includes(club))) {
    notes.push(`🎟️ ${nameOf(state, club)} 从公开资格赛打进了 ${year} 揭幕赛。`)
  }
}
