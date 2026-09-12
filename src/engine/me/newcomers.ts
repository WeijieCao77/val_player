import RAW_2021 from '../../data/world_2021.json'
import { regionIn } from '../era'
import { importBlock } from '../imports'
import { recomputeOverall, refreshValue } from '../player'
import { PROSPECTS } from '../prospects'
import { Rng, clamp, hashStr } from '../rng'
import { bookCovers, bookDebutants, bookHandles, hasPlace, isTimelineWorld, lastYearOf, reachOf, releaseForHistory, signForHistory } from '../timeline'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player, Region, Team } from '../types'
import { WORLD_PLAYERS, autoStarters, ensureCaller, playerFromRaw } from '../world'
import type { RawPlayer } from '../world'

/**
 * New people, past the roster book.
 *
 * Through 2026 everybody is real: the book brings each year's debutants in at
 * the events they really played. After it nobody arrives, and a world that only
 * ages runs out of people — by 2030 a league is the same few hundred men four
 * years older. The author's call (2026-09-12): from 2027 the scene takes in
 * made-up newcomers, clearly marked, at the rate the real one did.
 *
 *  - How many: the book's own rate. In 2025 and 2026, the two years whose scene
 *    is the size this world carries on at, the book met this many new people a
 *    year for every player on the rosters clubs opened the year with (people it
 *    met for the first time that year ÷ people on opening rosters, by the league
 *    of the club each first played for; 2026 as far as it has been played).
 *  - Who: nobody's name. A handle is made up and checked against every handle
 *    the book, the 2021 and 2026 world files and the prospects list have ever
 *    held, and every one already in this world.
 *  - How good, and which job: drawn from the league they come into, not from
 *    fixed numbers. Each is modelled on a Challengers player of that league —
 *    most from its lower half, a few from near its top — with his eight shaken
 *    a little. A league the ratings are rescaled in still hands out newcomers
 *    that fit it.
 *  - How old, and how far his ceiling sits above him: a real debutant's, one of
 *    the people the book met for the first time in 2024–2026. Not the league's
 *    own young end — past the book nobody real is young any more, and newcomers
 *    modelled on it came in a year older every winter.
 *  - Where: the real ones mostly first played for a Challengers club (270 of 329
 *    in 2025, 357 of 375 in 2026). A Challengers club takes one in when he is
 *    worth more to it than the weakest man it has, and that man is let go; the
 *    rest are free agents, signed like anyone when a club needs somebody. From
 *    there they go up by playing, like everyone else (me/market.ts).
 *  - And out: a free agent past the book who has gone two whole seasons without
 *    a club leaves the scene, made up or real — the book's own rule, that people
 *    who never played again are gone — so a save does not grow without end.
 *
 * Everything is drawn from the world's seed and the year. Nothing here touches
 * the player's club.
 */

/** The first season with made-up newcomers: the first one past the roster book. */
export const FIRST_FICTIONAL = 2027

/** New people a year per player on a roster, by league (timeline.json, 2025 and 2026 pooled). */
const ENTRY_RATE: [Region, number][] = [
  ['Americas', 136 / 584],
  ['EMEA', 257 / 955],
  ['Pacific', 213 / 726],
  ['China', 98 / 195],
]
/** The years whose real debutants give a newcomer his age and his headroom. */
const DEBUT_YEARS = [2024, 2025, 2026]
/** A club region needs this many Challengers players to be its newcomers' model; below it, the whole league is. */
const LOCAL_POOL = 25
/** How far down a league a newcomer is modelled: a percentile to this power, so most land in its lower half. */
const SKEW = 1.8
/** Seasons without a club after which a free agent past the book has left the scene. */
const GONE_AFTER = 3

let DEBUTANTS: { age: number; headroom: number }[] | null = null
const debutants = (): { age: number; headroom: number }[] => (DEBUTANTS ??= bookDebutants(DEBUT_YEARS))

const handleKey = (s: string): string => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Every handle a made-up newcomer may not take. */
function takenHandles(state: GameState): Set<string> {
  const out = new Set<string>()
  const add = (s: string | undefined) => { if (s) out.add(handleKey(s)) }
  for (const s of bookHandles()) add(s)
  for (const p of WORLD_PLAYERS) add(p.ign)
  for (const p of (RAW_2021 as unknown as { players: { ign: string }[] }).players) add(p.ign)
  for (const p of PROSPECTS) add(p.ign)
  for (const p of Object.values(state.players)) add(p.ign)
  return out
}

const ONSET = ['k', 'z', 'r', 'v', 'l', 'n', 't', 'sh', 'm', 'd', 'f', 'j', 'x', 'h', 'b', 'y', 'g', 's', 'p', 'kr', 'dr', 'st', 'br', 'tr', 'vr', 'ny']
const VOWEL = ['a', 'e', 'i', 'o', 'u', 'y', 'ai', 'ei', 'ou', 'ae']
const CODA = ['', '', '', 'n', 'r', 'x', 'k', 's', 'th', 'l', 'z', 'm', 'v']

/** A made-up handle nobody real has had. */
function makeHandle(rng: Rng, taken: Set<string>): string {
  for (let tries = 0; tries < 60; tries++) {
    const syl = () => rng.pick(ONSET) + rng.pick(VOWEL)
    const core = syl() + (rng.chance(0.65) ? syl() : '') + rng.pick(CODA)
    const style = rng.next()
    const handle = style < 0.45 ? core[0].toUpperCase() + core.slice(1)
      : style < 0.75 ? core
        : style < 0.88 ? core.toUpperCase()
          : `${core}${rng.int(1, 99)}`
    if (handle.length < 3 || handle.length > 12) continue
    const key = handleKey(handle)
    // 「Kaz7」 is too near a real 「Kaz」 to be anybody's own
    if (taken.has(key) || taken.has(key.replace(/[0-9]/g, ''))) continue
    taken.add(key)
    return handle
  }
  let n = 100
  while (taken.has(`newcomer${n}`)) n++
  taken.add(`newcomer${n}`)
  return `Newcomer${n}`
}

interface Seat { p: Player; region: Region }

/** One newcomer, modelled on the league he comes into, as old and as far from his ceiling as a real debutant. */
function makeNewcomer(state: GameState, rng: Rng, region: Region, league: Seat[], taken: Set<string>, id: string): Player {
  const here = league.filter((s) => s.region === region)
  const pool = (here.length >= LOCAL_POOL ? here : league).map((s) => s.p)
  // his job and his passport: somebody's from where he comes from
  const like = rng.pick(pool)
  const sameJob = pool.filter((q) => q.role === like.role)
  const ladder = (sameJob.length >= 8 ? sameJob : pool).slice().sort((a, b) => a.overall - b.overall)
  const model = ladder[Math.floor(Math.pow(rng.next(), SKEW) * (ladder.length - 1))]
  const real = debutants()
  const debut = real.length ? rng.pick(real) : { age: model.age, headroom: Math.max(0, model.potential - model.overall) }
  const attrs = {} as Attrs
  for (const k of ATTR_KEYS) attrs[k] = clamp(model.attrs[k] + rng.int(-3, 3), 20, 99)
  const roles = model.roles ?? [model.role]
  const rp: RawPlayer = {
    id, ign: makeHandle(rng, taken), teamId: null, region, role: model.role, roles: [...roles], flex: roles.length > 1,
    agentPool: [], traits: [], nat: like.nat, realName: null, birth: null, ageEstimated: false, joined: null,
    rounds: 0, vlr: { rating: null, acs: null, rounds: 0 },
    age: debut.age, isIgl: false, attrs, overall: 0, potential: 0,
    form: Math.round(clamp(rng.norm(70, 8), 45, 95)), morale: Math.round(clamp(rng.norm(75, 8), 45, 98)), fatigue: rng.int(0, 20),
    salary: 0, value: 0, contractYears: 0,
    loyalty: Math.round(clamp(rng.norm(55, 16), 15, 95)), ambition: Math.round(clamp(rng.norm(66, 15), 15, 98)),
  }
  const p = playerFromRaw(rp, state.year, state.seed)
  recomputeOverall(p)
  p.potential = clamp(p.overall + debut.headroom, p.overall, 99)
  p.fictional = true
  p.fictionalSince = state.year
  refreshValue(p)
  return p
}

const rerate = (state: GameState, t: Team): void => {
  const top = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
  if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
}

/**
 * The winter's newcomers and leavers, once a season from 2027 (me/week.ts, at
 * the season turn). Returns how many came in, how many a Challengers club took,
 * and how many left.
 */
export function newcomersTurn(state: GameState): { born: number; placed: number; gone: number } {
  const out = { born: 0, placed: 0, gone: 0 }
  const year = state.year
  const me = state.me
  if (!me || !isTimelineWorld(state) || year < FIRST_FICTIONAL || bookCovers(year) || me.flags.newcomers === year) return out
  me.flags.newcomers = year
  const rng = new Rng(hashStr(`newcomers:${state.seed}:${year}`))
  const { club: mine, people } = reachOf(state)
  const active = Object.values(state.teams).filter((t) => !t.dormant && t.roster.length >= 5 && hasPlace(state, t))
  const value = (p: Player) => p.overall + Math.max(0, p.potential - p.overall) * 0.5
  const taken = takenHandles(state)
  let seq = 0
  const nextId = (): string => {
    let id = ''
    do id = `N${year}${String(seq++).padStart(4, '0')}`
    while (state.players[id])
    return id
  }

  for (const [L, rate] of ENTRY_RATE) {
    const clubs = active.filter((t) => regionIn(t.region, year) === L)
    const onRosters = clubs.reduce((s, t) => s + t.roster.filter((id) => id !== me.id).length, 0)
    const league: Seat[] = clubs.filter((t) => t.tier === 2)
      .flatMap((t) => t.roster.map((id) => state.players[id]).filter((p): p is Player => !!p && p.id !== me.id).map((p) => ({ p, region: t.region })))
    if (league.length < 10) continue
    const count = new Map<Region, number>()
    for (const s of league) count.set(s.region, (count.get(s.region) ?? 0) + 1)
    const regions = [...count.keys()]
    const fresh: Player[] = []
    const n = Math.round(onRosters * rate)
    for (let i = 0; i < n; i++) {
      const region = rng.weighted(regions, regions.map((r) => count.get(r)!))
      const p = makeNewcomer(state, rng, region, league, taken, nextId())
      state.players[p.id] = p
      fresh.push(p)
    }
    out.born += fresh.length

    // a Challengers club takes one in when he is worth more to it than the weakest man it has
    for (const t of rng.shuffle(clubs.filter((c) => c.tier === 2 && c.id !== mine))) {
      const open = fresh.filter((p) => !p.teamId && !importBlock(state, t.id, p))
      if (!open.length) break
      const fit = (p: Player) => value(p) + (p.region === t.region ? 3 : 0)
      const best = open.reduce((a, b) => (fit(b) > fit(a) ? b : a))
      const squad = t.roster.map((id) => state.players[id]).filter((q): q is Player => !!q && !people.has(q.id))
      if (!squad.length) continue
      const weakest = squad.reduce((a, b) => (value(b) < value(a) ? b : a))
      if (t.roster.length >= 6) {
        if (value(best) <= value(weakest)) continue
        releaseForHistory(state, weakest)
      } else if (value(best) < value(weakest) - 3) continue
      signForHistory(state, best, t, year, rng)
      ensureCaller(state, t.id)
      t.starters = autoStarters(state, t.id)
      rerate(state, t)
      out.placed++
    }
  }

  // two whole seasons without a club, and he has left the scene
  const gone: string[] = []
  for (const p of Object.values(state.players)) {
    if (p.teamId || p.id === me.id || people.has(p.id)) continue
    const last = Math.max(FIRST_FICTIONAL - 1, p.fictionalSince ?? 0, lastYearOf(p) ?? 0, ...(p.clubHist ?? []).map((h) => h.to))
    if (year - last < GONE_AFTER) continue
    gone.push(p.ign)
    delete state.players[p.id]
  }
  out.gone = gone.length

  if (out.born) {
    state.news.push({
      day: state.day, kind: 'player',
      text: `🌱 ${year} 赛季有 ${out.born} 名新人进入职业圈（虚构选手，名字不对应真实的人），其中 ${out.placed} 人签进了 Challengers 俱乐部。`,
    })
  }
  if (gone.length) {
    state.news.push({
      day: state.day, kind: 'player',
      text: `👋 两个赛季没有队伍，离开职业圈：${gone.slice(0, 8).join('、')}${gone.length > 8 ? ` 等 ${gone.length} 人` : ''}。`,
    })
  }
  return out
}
