import raw from '../data/timeline.json'
import lineageRaw from '../data/lineage.json'
import { canonAgents } from './content'
import { onTimeline, regionIn } from './era'
import { contractLength, expectedSalary, recomputeOverall, refreshValue } from './player'
import { Rng, clamp, hashStr } from './rng'
import type { RawTeam } from './teams'
import type { Attrs, GameState, Player, Region, Role, Team } from './types'
import { autoStarters, ensureCaller, playerFromRaw, teamFromRaw } from './world'
import type { RawPlayer } from './world'

/**
 * The world after the summer of 2021, as it really went — everywhere the player cannot reach.
 *
 * A career that enters in 2021 opens on world_2021.json. Left to itself that
 * world only ages: nobody debuts, no club is founded, a roster changes only
 * when the game's own market moves somebody. By 2023 it would have no G2 in
 * the Americas league, no EDward Gaming, no Gentle Mates — and the author's
 * rule is that everything is real except the player.
 *
 * scripts/build_timeline.py wrote the book forward from vlr and Liquipedia:
 * each year's clubs, the rosters they opened with, everyone rated off that
 * year's own numbers with the ruler world_2021 was built with. This reads it
 * back into a running world twice over:
 *
 *  - at the season turn (syncYear): clubs founded, renamed, moved between the
 *    tiers or gone quiet; rosters as they opened; ratings as the year's
 *    numbers had them; people who never played again leave the scene
 *  - before each event (syncEvent): each real side takes the field with the
 *    people it really brought, which is where a mid-season move shows
 *
 * Neither touches the player's reach — his club, everyone on it, and him.
 * Inside it the world is his: a man he signed stays signed, a club he keeps
 * alive stays alive, and his squad grows the way the game grows it. Outside
 * it history resumes: a player he let go goes where history took him, and a
 * club that lost a man to him plays short until it signs somebody.
 */

/** `d` the first day it played that year, `e` the last */
interface TClub { n: string; t: string; r: string; k: 1 | 2; l: string | null; s: string | null; d: number; e?: number; o: number }
interface TRating { a: number[]; o: number; p: number; r: string; g: string[]; n: number; v: (number | null)[]; t?: string[]; i?: number }
interface TDebut { ign: string; nat: string | null; name: string | null; birth: string | null; age: number; est: boolean }
interface TYear {
  clubs: Record<string, TClub>
  rosters: Record<string, string[]>
  ratings: Record<string, TRating>
  debuts: Record<string, TDebut>
}
interface Book {
  meta: { years: number[]; attrs: string[]; traits: Record<string, [string, boolean]> }
  years: Record<string, TYear>
  last: Record<string, number>
}

const BOOK = raw as unknown as Book
const ATTRS = BOOK.meta.attrs as (keyof Attrs)[]
const FIRST = BOOK.meta.years[0]
const LAST_BOOK = BOOK.meta.years[BOOK.meta.years.length - 1]
/** A club that first played after February joins the world at that event, not on New Year's Day. */
const LATE_START = 60

/** A world that entered the timeline in 2021: its clubs carry the roster book's ids (engine/era.ts onTimeline). */
export const isTimelineWorld = (state: GameState): boolean => onTimeline(state)

/** Does the book have this year? */
export const bookCovers = (year: number): boolean => !!BOOK.years[String(year)]

/** The league a club held a seat in that year, as the book has it. */
export const bookLeague = (year: number, vlr: string): string | null => BOOK.years[String(year)]?.clubs[vlr]?.l ?? null

/** A club holding a seat in this season's VCT leagues — a partner, or one of China's visitors — from 2023, when the leagues closed. */
export const inVctLeague = (state: GameState, t: Team | undefined): boolean =>
  state.year >= 2023 && !!t && t.tier === 1 && !!t.league?.startsWith('VCT ')

/**
 * Whether a club has somewhere to play this year. From 2023 the leagues are
 * closed: a club with no seat, that history does not have in any Challengers
 * league that year and that has not played its way into an event — a club
 * history let go, or one the player kept alive outside every league — has
 * nowhere to play, and does not go shopping for professionals to sit.
 */
export function hasPlace(state: GameState, t: Team): boolean {
  if (t.dormant) return false
  if (!isTimelineWorld(state) || state.year < 2023 || t.tier === 1) return true
  const Y = BOOK.years[String(state.year)]
  // past the book a club keeps the Challengers league it last played
  if (!Y) return !!t.scene
  return !!bookClubOf(state, Y, t.id) || Object.values(state.comps).some((c) => c.format === 'circuit' && c.teams.includes(t.id))
}

const clubId = (vlr: string): string => `V21T${vlr}`
const vlrOf = (playerId: string): string | null => (/^V\d+$/.test(playerId) ? playerId.slice(1) : null)

/** The last year this person was on any real roster; undefined for anyone the book does not know. */
export function lastYearOf(p: Pick<Player, 'id'>): number | undefined {
  const v = vlrOf(p.id)
  return v ? BOOK.last[v] : undefined
}

/** The player's reach: his club, the people on it, himself. */
export function reachOf(state: GameState): { club: string | null; people: Set<string> } {
  const club = state.me ? (state.me.phase === 'pro' ? state.myTeam : null) : state.myTeam
  const people = new Set<string>()
  if (state.me) people.add(state.me.id)
  for (const id of (club && state.teams[club]?.roster) || []) people.add(id)
  return { club, people }
}

const leagueLabel = (c: Pick<TClub, 'l' | 's' | 'r'>): string => (c.l ? `VCT ${c.l}` : `Challengers ${c.s ?? c.r}`)

function traitsOf(r: TRating | undefined): { key: string; label: string; good: boolean }[] {
  return (r?.t ?? []).map((key) => ({
    key, label: BOOK.meta.traits[key]?.[0] ?? key, good: BOOK.meta.traits[key]?.[1] ?? true,
  }))
}

/** The nearest record at or before `year` — the book rates a man only in the years he played. */
function nearest<T>(year: number, pick: (y: TYear) => T | undefined): { value: T; year: number } | null {
  for (let y = year; y >= FIRST; y--) {
    const Y = BOOK.years[String(y)]
    const v = Y ? pick(Y) : undefined
    if (v) return { value: v, year: y }
  }
  return null
}

const knownTo = (state: GameState, vlr: string, year: number): boolean =>
  !!state.players[`V${vlr}`] || !!nearest(year, (Y) => Y.debuts[vlr])

/** Someone the book has met by this year, as the game holds him — made the first time he is needed. */
function ensurePlayer(state: GameState, vlr: string, year: number, region: Region): Player | null {
  const id = `V${vlr}`
  if (state.players[id]) return state.players[id]
  const found = nearest(year, (Y) => Y.debuts[vlr])
  if (!found) return null
  const d = found.value
  const r = nearest(year, (Y) => Y.ratings[vlr])?.value
  const rng = new Rng(hashStr(`debut:${vlr}`) ^ state.seed)
  const roles = (r?.r ?? '自由人').split('|') as Role[]
  const attrs = {} as Attrs
  ATTRS.forEach((k, i) => { attrs[k] = r?.a[i] ?? 55 })
  const rp: RawPlayer = {
    id, ign: d.ign, teamId: null, region, role: roles[0], roles, flex: roles.length > 1,
    agentPool: r?.g ?? [], roleSource: r?.g?.length ? 'agents' : 'vlr-primary', traits: traitsOf(r),
    nat: d.nat ?? undefined, realName: d.name, birth: d.birth, ageEstimated: d.est, joined: null,
    rounds: r?.n ?? 0, vlr: { rating: r?.v[0] ?? null, acs: r?.v[1] ?? null, rounds: r?.n ?? 0 },
    age: d.age + (year - found.year), isIgl: !!r?.i, attrs, overall: r?.o ?? 55, potential: r?.p ?? 60,
    form: Math.round(clamp(rng.norm(70, 8), 45, 95)), morale: Math.round(clamp(rng.norm(75, 8), 45, 98)),
    fatigue: rng.int(0, 20), salary: 0, value: 0, contractYears: 0,
    loyalty: Math.round(clamp(rng.norm(60, 16), 15, 95)), ambition: Math.round(clamp(rng.norm(62, 15), 15, 98)),
  }
  const p = playerFromRaw(rp, year, state.seed)
  recomputeOverall(p)
  p.potential = Math.max(p.potential, p.overall)
  refreshValue(p)
  state.players[id] = p
  return p
}

/** The year's numbers, laid over a man history kept out of the player's reach. */
function applyRating(p: Player, r: TRating): void {
  ATTRS.forEach((k, i) => { p.attrs[k] = r.a[i] ?? p.attrs[k] })
  const roles = r.r.split('|') as Role[]
  p.role = roles[0]
  p.roles = roles
  p.flex = roles.length > 1
  if (r.g.length) p.agentPool = canonAgents(r.g)
  p.traits = traitsOf(r)
  p.isIgl = !!r.i
  p.rounds = (p.rounds ?? 0) + r.n
  p.vlr = { rating: r.v[0] ?? null, acs: r.v[1] ?? null, rounds: r.n }
  recomputeOverall(p)
  p.potential = Math.max(r.p, p.overall)
  refreshValue(p)
}

/** A club the roster book has not held before, priced the way build_world_2021.py prices one. */
function newClub(state: GameState, vlr: string, c: TClub): Team {
  const rng = new Rng(hashStr(`club:${vlr}`) ^ state.seed)
  const rt: RawTeam = {
    id: clubId(vlr), name: c.n, tag: c.t, region: c.r, tier: c.k, league: leagueLabel(c), rating: c.o,
    budget: Math.round(c.k === 1 ? rng.range(2_000_000, 8_500_000) : rng.range(240_000, 900_000)),
    reputation: Math.round(clamp(c.o * (c.k === 1 ? 1 : 0.72), 20, 99)),
    roster: [], coach: null,
    facilities: Math.round(clamp(rng.norm(c.o - (c.k === 1 ? 5 : 18), 8), 20, 94)),
  }
  const t = teamFromRaw(rt, state.seed)
  if (c.s) t.scene = c.s
  return t
}

function release(state: GameState, p: Player | undefined): void {
  if (!p?.teamId) return
  const from = state.teams[p.teamId]
  if (from) {
    from.roster = from.roster.filter((id) => id !== p.id)
    from.starters = from.starters.filter((id) => id !== p.id)
  }
  p.teamId = null
  p.contractYears = 0
  p.listed = false
  p.listedOn = undefined
}

function sign(state: GameState, p: Player, team: Team, year: number, rng: Rng): void {
  if (p.teamId === team.id) return
  release(state, p)
  team.roster.push(p.id)
  p.teamId = team.id
  p.retiring = false
  const squad = team.roster.map((id) => state.players[id]).filter((q): q is Player => !!q)
  p.contractYears = Math.max(1, contractLength(p, rng, squad))
  p.salary = expectedSalary(p, team.tier)
  p.joinedYear = year
  p.clubHist ??= []
  const last = p.clubHist[p.clubHist.length - 1]
  if (!last || last.team !== team.id) p.clubHist.push({ team: team.id, from: year, to: year })
}

/**
 * A club that has stopped playing keeps its name, its region and its place in
 * everyone's club history — not a playing club's kit. Its map preferences and
 * sponsors were most of a quiet club's weight in a save (270 KB of 473 by 2026)
 * and nothing reads them until it plays again, when wake() draws them afresh.
 */
function quiet(t: Team): void {
  t.dormant = true
  t.starters = []
  t.sponsors = []
  t.mapPrefs = {}
}

function wake(state: GameState, t: Team): void {
  t.dormant = false
  if (t.sponsors.length && Object.keys(t.mapPrefs ?? {}).length) return
  const fresh = teamFromRaw({ ...(t as unknown as RawTeam), roster: [] }, state.seed)
  if (!t.sponsors.length) t.sponsors = fresh.sponsors
  if (!Object.keys(t.mapPrefs ?? {}).length) t.mapPrefs = fresh.mapPrefs
}

function rerate(state: GameState, t: Team): void {
  const top = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
  if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
}

/** The Challengers league most of a region's clubs play in, for a club history no longer has. */
function sceneOf(Y: TYear, region: string): string | undefined {
  const count = new Map<string, number>()
  for (const c of Object.values(Y.clubs)) if (c.r === region && c.s) count.set(c.s, (count.get(c.s) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}


/** Which Challengers league a player from each country would be playing in, most specific first. */
const NAT_SCENES: Record<string, string[]> = {}
for (const [scenes, codes] of [
  [['France'], 'fr'], [['DACH'], 'de at ch li'], [['Spain'], 'es ad'], [['Italy'], 'it sm'], [['Portugal'], 'pt'],
  [['Northern Europe', 'NORTH//EAST'], 'gb uk ie se no dk fi is ee lv lt nl be lu'],
  [['East', 'NORTH//EAST'], 'pl cz sk hu ro bg ru ua by kz rs hr si ba mk al me gr cy md ge am az uz kg'],
  [['Turkey'], 'tr'], [['MENA'], 'sa ae eg ma dz tn jo kw qa bh om iq lb sy ps ly ye ir'],
  [['North America'], 'us ca'], [['Brazil'], 'br'],
  [['LATAM North', 'LATAM'], 'mx co pe ve cr pa gt sv hn ni do pr cu ec'], [['LATAM South', 'LATAM'], 'ar cl uy py bo'],
  [['Korea'], 'kr'], [['Japan'], 'jp'], [['China'], 'cn'], [['South Asia'], 'in pk bd lk np'], [['Oceania'], 'au nz'],
  [['Vietnam', 'SEA'], 'vn'], [['Thailand', 'SEA'], 'th'], [['Philippines', 'SEA'], 'ph'], [['Indonesia', 'SEA'], 'id'],
  [['Malaysia & Singapore', 'SEA'], 'my sg'], [['Hong Kong & Taiwan', 'SEA'], 'tw hk mo'], [['SEA'], 'kh mm la bn'],
] as [string[], string][]) {
  for (const c of codes.split(' ')) NAT_SCENES[c] = scenes
}

/**
 * The Challengers league a club plays in this year. History says so for every
 * club it kept; for one it did not — a club the player keeps alive, or joins
 * after history let it go — it is where its people are from, as the leagues
 * stood that year: a Russian five in 2023 play East Surge, and in 2025 the
 * NORTH//EAST league that replaced it.
 */
export function sceneFor(state: GameState, t: Team): string | undefined {
  // a league club plays in no Challengers league: it keeps the one history gave it (China's partners
  // played the Evolution Series) and is never given one off its players' passports — Team Liquid,
  // read as NORTH//EAST, entered that league's Kickoff through the open decider
  if (inVctLeague(state, t)) return t.scene
  // past the book the Challengers leagues are its last year's: the seasons after it play that year's again (engine/circuit.ts)
  const Y = BOOK.years[String(Math.min(state.year, LAST_BOOK))]
  if (!Y) return t.scene
  const have = new Set(Object.values(Y.clubs).map((c) => c.s).filter((s): s is string => !!s))
  if (t.scene && have.has(t.scene)) return t.scene
  const votes = new Map<string, number>()
  for (const id of t.roster) {
    const scene = (NAT_SCENES[state.players[id]?.nat ?? ''] ?? []).find((s) => have.has(s))
    if (scene) votes.set(scene, (votes.get(scene) ?? 0) + 1)
  }
  const league = regionIn(t.region, state.year)
  const scene = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? sceneOf(Y, t.region)
    ?? [...Object.values(Y.clubs).filter((c) => c.s && regionIn(c.r as Region, state.year) === league)
      .reduce((m, c) => m.set(c.s!, (m.get(c.s!) ?? 0) + 1), new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0]
  if (scene) t.scene = scene
  return scene
}

/**
 * 方案 C, decided 2026-09-10 (engine/era.ts PARTNER_TEAMS_2023): the thirty
 * seats stand as history, except that the player's club is judged on its
 * 2022. A club that reached an international that year takes a seat in its
 * league, and the partner that goes without is the weakest one there. China
 * had no league in 2023, and that does not bend.
 */
function judgeSeat(state: GameState, mine: string | null, Y: TYear, notes: string[]): void {
  if (!mine || state.seat) return
  const t = state.teams[mine]
  if (!t) return
  if (bookClubOf(state, Y, mine)?.l) return
  const league = regionIn(t.region, 2023)
  if (league !== 'Americas' && league !== 'EMEA' && league !== 'Pacific') return
  const reached = Object.values(state.comps).filter((c) => c.format === 'circuit' && c.teams.includes(mine)
    && (c.stage === 'masters1' || c.stage === 'masters2' || c.stage === 'champions'))
  if (!reached.length) {
    notes.push(`🏛️ 2023 年的三十个合作席位公布了，${t.name} 不在名单上——2022 年没打进过国际赛。去 Challengers 联赛，从 Ascension 往上打。`)
    return
  }
  const partners = Object.entries(Y.clubs)
    .filter(([, c]) => c.l === league)
    .map(([v]) => state.teams[clubId(v)])
    .filter((x): x is Team => !!x && x.id !== mine)
    .sort((a, b) => a.rating - b.rating)
  const out = partners[0]
  if (!out) return
  state.seat = { club: mine, displaced: out.id, league, from: 2023 }
  notes.push(`🏛️ ${t.name} 拿到了 VCT ${league} 的合作席位——2022 年打进了${reached.map((c) => c.name).join('、')}。真实历史里这个席位属于 ${out.name}。`)
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `🏛️ Riot 公布 2023 合作战队：${t.name} 入选 VCT ${league}，${out.name} 未获席位。`,
  })
}

function applySeat(state: GameState, year: number): void {
  const s = state.seat
  if (!s || year < s.from) return
  const mine = state.teams[s.club]
  if (mine) { mine.tier = 1; mine.league = `VCT ${s.league}` }
  // the seat's real holder, and whatever history carried it on as: Giants Gaming's was GIANTX's from 2024
  for (const id of [s.displaced, ...successorsOf(s.displaced, year)]) {
    const out = state.teams[id]
    if (!out || id === s.club) continue
    out.tier = 2
    out.scene = sceneFor(state, out)
    out.league = `Challengers ${out.scene ?? out.region}`
  }
}

/** The clubs history carried a club on as, by `year` (src/data/lineage.json): Giants Gaming → GIANTX in 2024. */
export function successorsOf(teamId: string, year: number): string[] {
  const out: string[] = []
  let at = teamId
  for (let guard = 0; guard < 6; guard++) {
    const e = LINEAGE.find((x) => clubId(x.from) === at && x.year <= year)
    if (!e) break
    at = clubId(e.to)
    out.push(at)
  }
  return out
}

interface Lineage {
  from: string
  to: string
  year: number
  day: number
  kind: 'rebrand' | 'merger' | 'roster'
  fromName: string
  toName: string
  source: string
}
const LINEAGE = (lineageRaw as unknown as { entries: Lineage[] }).entries

/** The book's record of a club this year: the club history carried it on as, else its own. */
function bookClubOf(state: GameState, Y: TYear, teamId: string): TClub | undefined {
  const heirs = Object.entries(state.heirs ?? {}).filter(([, to]) => to === teamId).map(([id]) => id.slice(4))
  for (const v of heirs.reverse()) if (Y.clubs[v]) return Y.clubs[v]
  return teamId.startsWith('V21T') ? Y.clubs[teamId.slice(4)] : undefined
}

/**
 * A club history carried on under another name — a rebrand, a merger, a roster
 * bought whole (src/data/lineage.json, every entry with its source). Out of the
 * player's reach the book already moves the people. Inside it, the player's
 * club is the one that carries on: it takes the new name on the day history
 * did, and every event that seeds the successor seeds it.
 */
function inherit(state: GameState, mine: string | null, year: number, day: number, notes: string[]): void {
  if (!mine || !state.teams[mine]) return
  for (const e of LINEAGE) {
    const from = clubId(e.from)
    const to = clubId(e.to)
    if (from !== mine && state.heirs?.[from] !== mine) continue
    if (state.heirs?.[to] === mine || to === mine) continue
    if (year < e.year || (year === e.year && day < e.day)) continue
    const t = state.teams[mine]
    const successor: Team | undefined = state.teams[to]
    if (successor && successor.id !== mine) {
      for (const pid of [...successor.roster]) release(state, state.players[pid])
      quiet(successor)
    }
    state.heirs = { ...(state.heirs ?? {}), [to]: mine }
    const book = BOOK.years[String(year)]?.clubs[e.to]
    const old = t.name
    t.name = book?.n ?? e.toName
    if (book?.t) t.tag = book.t
    const verb = e.kind === 'rebrand' ? '更名为' : e.kind === 'merger' ? '合并为' : '整队加入'
    const line = `🔁 ${old} ${verb} ${t.name}——真实历史里 ${e.fromName} 在 ${e.year} 年${verb} ${e.toName}，你的俱乐部跟着走。`
    notes.push(line)
    state.news.push({ day: state.day, kind: 'club', important: true, text: line })
  }
}

/** The same moves the timeline makes, for whoever else has to sign or release on history's behalf. */
export { sign as signForHistory, release as releaseForHistory, quiet as quietClub }

/* ------------------------------------------------------------------ */
/*  clubs history let go, one at a time                                */
/* ------------------------------------------------------------------ */

export interface Fold {
  vlr: string
  /** the last day it played that year */
  last: number
  /** the day it is gone: three to five weeks after that */
  day: number
  /** its Challengers league, where that league does not go on the next year */
  merged: string | null
}

const FOLDS = new Map<number, Fold[]>()

/**
 * The clubs that played their last Riot event in `year`: in the book that year,
 * not the next, and not carried on under another name — a rebrand, a merger or
 * a roster bought whole is not the end of a club. Each goes quiet three to five
 * weeks after its own last event, through the year, the way they really did —
 * not on New Year's Day all at once. A year with no book after it has none.
 */
export function foldsOf(year: number): Fold[] {
  const hit = FOLDS.get(year)
  if (hit) return hit
  const Y = BOOK.years[String(year)]
  const N = BOOK.years[String(year + 1)]
  const out: Fold[] = []
  if (Y && N) {
    const goesOn = new Set(Object.values(N.clubs).map((c) => c.s).filter((s): s is string => !!s))
    for (const [vlr, c] of Object.entries(Y.clubs)) {
      if (N.clubs[vlr] || LINEAGE.some((e) => e.from === vlr)) continue
      const last = c.e ?? c.d
      out.push({
        vlr, last,
        day: Math.min(362, last + 21 + (hashStr(`fold:${vlr}:${year}`) % 15)),
        merged: c.s && !goesOn.has(c.s) ? c.s : null,
      })
    }
  }
  FOLDS.set(year, out)
  return out
}

/** What the club tells its people: nothing history did not say. */
const foldReason = (f: Fold): string => (f.merged
  ? `${f.merged} 这个 Challengers 联赛明年不再单独举办，俱乐部没有拿到新联赛的位置，赛季结束后不再保留职业队`
  : '赛季结束后不再保留职业队（资金、联赛调整等压力，具体原因没有对外公布）')

/**
 * A day of the clubs history let go. Out of the player's reach each goes quiet
 * on its day and its people go to the market.
 *
 * The player's own club is not spared. He is one player, and whether a club
 * carries on is not his to decide — the author's rule. It is not closed from
 * under him either: `state.foldNotice` is set two or three weeks ahead for
 * engine/me to tell him, and the club closes on that day, after the last event
 * it is still playing in this world. A manager's club is his to keep: the
 * manager game has no life after a club.
 */
export function historyFolds(state: GameState): string[] {
  const gone: string[] = []
  if (!isTimelineWorld(state)) return gone
  const { club: mine, people } = reachOf(state)
  for (const f of foldsOf(state.year)) {
    const id = clubId(f.vlr)
    const heir = state.heirs?.[id]
    const t = state.teams[heir && state.teams[heir] ? heir : id]
    if (!t || t.dormant) continue
    if (t.id === mine) {
      if (!state.me || state.foldNotice?.club === t.id) continue
      const playing = Object.values(state.comps)
        .filter((c) => !!c.circuit && !c.champion && !c.circuit.done && c.teams.includes(t.id))
        .map((c) => c.circuit!.end + 7)
      const day = Math.min(362, Math.max(f.day, ...playing))
      const lead = 14 + (hashStr(`fold-notice:${f.vlr}:${state.year}`) % 8)
      if (state.day >= day - lead) state.foldNotice = { club: t.id, day: Math.max(day, state.day + 14), reason: foldReason(f) }
      continue
    }
    if (state.day < f.day) continue
    for (const pid of [...t.roster]) if (!people.has(pid)) release(state, state.players[pid])
    quiet(t)
    gone.push(t.name)
  }
  return gone
}

export interface YearSync {
  moved: number
  founded: string[]
  renamed: string[]
  folded: string[]
  /** people who never played again: the caller retires them */
  retire: string[]
  notes: string[]
}

/** Bring the world up to `year` as history had it, outside the player's reach. Run at the season turn. */
export function syncYear(state: GameState, year: number): YearSync {
  const out: YearSync = { moved: 0, founded: [], renamed: [], folded: [], retire: [], notes: [] }
  const Y = BOOK.years[String(year)]
  if (!Y || !isTimelineWorld(state)) return out
  const { club: mine, people } = reachOf(state)
  const rng = new Rng(hashStr(`timeline:${state.seed}:${year}`))
  inherit(state, mine, year, LATE_START, out.notes)
  if (year === 2023) judgeSeat(state, mine, Y, out.notes)

  for (const [vlr, r] of Object.entries(Y.ratings)) {
    const p = state.players[`V${vlr}`]
    if (p && !people.has(p.id)) applyRating(p, r)
  }

  const active = new Set<string>()
  for (const [vlr, c] of Object.entries(Y.clubs)) {
    const id = clubId(vlr)
    active.add(id)
    if (id === mine || (mine && state.heirs?.[id] === mine)) continue
    let t = state.teams[id]
    if (!t) {
      if (c.d > LATE_START) continue
      t = newClub(state, vlr, c)
      state.teams[id] = t
      out.founded.push(c.n)
    } else if (t.name !== c.n) {
      out.renamed.push(`${t.name} 更名为 ${c.n}`)
      t.name = c.n
      t.tag = c.t
    }
    wake(state, t)
    t.region = c.r as Region
    t.tier = c.k
    t.league = leagueLabel(c)
    t.scene = c.s ?? undefined
  }

  for (const [vlr, ids] of Object.entries(Y.rosters)) {
    if (mine && state.heirs?.[clubId(vlr)] === mine) continue
    const t = state.teams[clubId(vlr)]
    if (!t || t.id === mine) continue
    const want = ids.map((x) => ensurePlayer(state, x, year, t.region)).filter((p): p is Player => !!p && !people.has(p.id))
    const keep = new Set(want.map((p) => p.id))
    for (const pid of [...t.roster]) if (!keep.has(pid)) release(state, state.players[pid])
    for (const p of want) {
      if (p.teamId === t.id) continue
      sign(state, p, t, year, rng)
      out.moved++
    }
  }

  for (const t of Object.values(state.teams)) {
    if (!t.id.startsWith('V21T') || active.has(t.id) || t.id === mine || t.dormant) continue
    for (const pid of [...t.roster]) release(state, state.players[pid])
    quiet(t)
    out.folded.push(t.name)
  }

  for (const p of Object.values(state.players)) {
    if (people.has(p.id) || p.teamId) continue
    const last = lastYearOf(p)
    if (last != null && last < year) out.retire.push(p.id)
  }

  applySeat(state, year)
  const own = mine ? state.teams[mine] : undefined
  if (own && year >= 2023 && state.seat?.club !== mine) {
    const book = bookClubOf(state, Y, mine!)
    own.tier = book?.l ? 1 : 2
    // a seat this year means no Challengers league; own.league is still last year's here, so ask the book
    own.scene = book?.s ?? (book?.l ? undefined : sceneFor(state, own))
    own.league = leagueLabel({ l: book?.l ?? null, s: own.scene ?? null, r: own.region })
  }

  for (const t of Object.values(state.teams)) {
    // a save written before quiet() was: its quiet clubs lose their kit on the next turn
    if (t.dormant) { quiet(t); continue }
    ensureCaller(state, t.id)
    if (t.id !== mine) t.starters = autoStarters(state, t.id)
    rerate(state, t)
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  a world that enters the timeline later than 2021                   */
/* ------------------------------------------------------------------ */

export interface BookClubChoice { id: string; name: string; tag: string; region: Region; tier: 1 | 2; rating: number; roster: number }

/** The clubs the book has playing when `year` opens, for the new-career screen. */
export function bookClubsAt(year: number): BookClubChoice[] {
  const Y = BOOK.years[String(year)]
  if (!Y) return []
  return Object.entries(Y.clubs)
    .filter(([vlr, c]) => c.d <= LATE_START && (Y.rosters[vlr]?.length ?? 0) >= 5)
    .map(([vlr, c]) => ({ id: clubId(vlr), name: c.n, tag: c.t, region: c.r as Region, tier: c.k, rating: c.o, roster: Y.rosters[vlr].length }))
}

/**
 * Bring a world built on 2021's roster book up to `year` on the book alone: every
 * year's clubs founded and gone, rosters as they opened, ratings off that year's
 * numbers, people who never played again gone — with no season played between.
 *
 * It is what a career entering in 2026 opens on: the same world a 2021 career
 * carries into 2026, on the same ruler, rather than a 2026 some other builder
 * made. The clubs that stopped playing on the way are not kept — a world that
 * did not live through those years has no club histories to show them in.
 */
export function openWorldAt(state: GameState, year: number): void {
  for (let y = FIRST + 1; y <= year; y++) {
    // a winter each, as the rollover would have given it
    for (const p of Object.values(state.players)) p.age += 1
    state.year = y
    const r = syncYear(state, y)
    for (const id of r.retire) delete state.players[id]
  }
  for (const t of Object.values(state.teams)) if (t.dormant) delete state.teams[t.id]
  for (const p of Object.values(state.players)) {
    if (p.teamId && !state.teams[p.teamId]) p.teamId = null
    p.clubHist = (p.clubHist ?? []).filter((h) => !!state.teams[h.team])
  }
}

/**
 * Before an event: every real side out of the player's reach takes the field
 * with the people it really brought. Returns the clubs that first appear here.
 */
export function syncEvent(state: GameState, rosters: Record<string, string[]>): string[] {
  const founded: string[] = []
  if (!isTimelineWorld(state)) return founded
  const year = state.year
  const Y = BOOK.years[String(year)]
  const { club: mine, people } = reachOf(state)
  const rng = new Rng(hashStr(`timeline-ev:${state.seed}:${year}:${state.day}`))
  inherit(state, mine, year, state.day, [])
  for (const [vlr, ids] of Object.entries(rosters)) {
    const id = clubId(vlr)
    if (id === mine || (mine && state.heirs?.[id] === mine)) continue
    let t = state.teams[id]
    if (!t) {
      const c = Y?.clubs[vlr]
      // five friends from an open qualifier are not a club the book holds
      if (!c || ids.filter((x) => knownTo(state, x, year)).length < 3) continue
      t = newClub(state, vlr, c)
      state.teams[id] = t
      founded.push(c.n)
    }
    const team = t
    const want = ids.map((x) => ensurePlayer(state, x, year, team.region)).filter((p): p is Player => !!p && !people.has(p.id))
    wake(state, team)
    let moved = false
    for (const p of want) {
      if (p.teamId === team.id) continue
      sign(state, p, team, year, rng)
      moved = true
    }
    if (team.roster.length > 7) {
      const brought = new Set(want.map((p) => p.id))
      const spare = team.roster.map((pid) => state.players[pid])
        .filter((p): p is Player => !!p && !brought.has(p.id))
        .sort((a, b) => a.overall - b.overall)
      while (team.roster.length > 7 && spare.length) release(state, spare.shift())
    }
    if (moved) {
      ensureCaller(state, team.id)
      team.starters = autoStarters(state, team.id)
      rerate(state, team)
    }
  }
  return founded
}
