import { ratingOf } from '../player'
import type { GameState, Player } from '../types'

/**
 * 称号 — what this save's numbers say a player is.
 *
 * Every one is read off the save itself: the trophies lifted in it
 * (Player.titles) and the lines the engine wrote for every map played in it
 * (Player.career). Nothing comes from who the real person is, and nothing
 * from the real-world record, which in a world that opened in 2021 would
 * hand out the future. So the same player can carry one in this save and not
 * in the next.
 *
 * Thresholds are relative: a stat title goes to the top few of everyone with
 * enough rounds behind them, never to a fixed number. A player carries one
 * title at most — the rarest he qualifies for — so the tag keeps meaning
 * something.
 */

export type StarTitleKey = 'triple' | 'bigstage' | 'iglchamp' | 'clutch' | 'opener' | 'mvp' | 'evergreen' | 'rising'

export const STAR_TITLE_NAME: Record<StarTitleKey, string> = {
  triple: '三冠王',
  bigstage: '大赛型选手',
  iglchamp: '冠军指挥',
  clutch: '残局大师',
  opener: '首杀机器',
  mvp: 'MVP 专业户',
  evergreen: '常青树',
  rising: '新星',
}

/** rarest first: the one shown when a player qualifies for several */
const ORDER: StarTitleKey[] = ['triple', 'iglchamp', 'bigstage', 'clutch', 'opener', 'mvp', 'evergreen', 'rising']

export interface StarTitle {
  key: StarTitleKey
  name: string
  /** where it comes from, in the save's own numbers */
  why: string
}

/** about twenty maps: less than this and a rate is a streak */
export const TITLE_MIN_ROUNDS = 480
/** fewer peers than this with a real sample and the stat titles wait */
const MIN_PEERS = 12

/** Masters and Champions, not a region's own stage of the same name (「北美 · 第一赛段 大师赛」) */
export const intlTitle = (t: string): boolean => !t.includes('·') && /masters|champions|lock\/\/in|大师赛|冠军赛/i.test(t)
/**
 * A region's top flight: a VCT league stage or Kickoff, or in 2021–22 a
 * Challengers Final, a regional Masters stage or a Last Chance Qualifier.
 * Open qualifiers, Challengers leagues and cups are real trophies, but a whole
 * roster collects them and they do not make a star.
 */
export const leagueTitle = (raw: string): boolean => {
  const t = raw.trim()
  if (/最后机会资格赛$|冠军赛资格赛$/.test(t)) return true
  if (/^挑战者联赛|^challengers|公开/i.test(t)) return false
  return /^VCT\s.*stage\s*\d|kickoff$/i.test(t)
    // a league's Kickoff and stages; not the 2027-on 杯赛, whose shape Riot has not announced
    || /联赛(\s*·\s*(揭幕赛|第.赛段))?$/.test(t)
    || /挑战者决赛$|赛段\s*大师赛$/.test(t)
}
export const titleWeight = (t: string): 'intl' | 'league' | 'minor' =>
  intlTitle(t) ? 'intl' : leagueTitle(t) ? 'league' : 'minor'

/** a rate over a small sample is pulled toward everyone's middle: this many rounds' worth */
const SHRINK_ROUNDS = 800
const SHRINK_MAPS = 30

const quantile = (vals: number[], q: number): number => {
  if (!vals.length) return 0
  const s = vals.slice().sort((a, b) => a - b)
  return s[Math.floor(q * (s.length - 1))]
}

function compute(state: GameState): Map<string, StarTitle> {
  const out = new Map<string, StarTitle>()
  const give = (p: Player, key: StarTitleKey, why: string) => {
    const cur = out.get(p.id)
    if (!cur || ORDER.indexOf(key) < ORDER.indexOf(cur.key)) out.set(p.id, { key, name: STAR_TITLE_NAME[key], why })
  }
  const active = Object.values(state.players).filter((p) => p.teamId)
  const me = state.me
  // the whole roster is credited with a trophy; a star has to have played for it
  const pool = active.filter((p) => p.career.rounds >= TITLE_MIN_ROUNDS)

  // silverware lifted in this save
  for (const p of pool) {
    const lifted = p.id === me?.id ? me.titles.filter((t) => t.started) : (p.titles ?? [])
    const won = lifted.filter((t) => titleWeight(t.title) !== 'minor')
    if (!won.length) continue
    const intl = won.filter((t) => intlTitle(t.title))
    const byYear = new Map<number, { n: number; intl: number }>()
    for (const t of won) {
      const y = byYear.get(t.year) ?? { n: 0, intl: 0 }
      y.n++
      if (intlTitle(t.title)) y.intl++
      byYear.set(t.year, y)
    }
    const treble = [...byYear.entries()].filter(([, y]) => y.n >= 3 && y.intl >= 1).sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0]
    if (treble) give(p, 'triple', `${treble[0]} 年拿下 ${treble[1].n} 座冠军，其中 ${treble[1].intl} 座国际赛`)
    if (p.isIgl && p.iglSource !== 'inferred' && intl.length >= 1 && won.length >= 3) give(p, 'iglchamp', `作为指挥拿下 ${won.length} 座冠军，其中 ${intl.length} 座国际赛`)
    if (intl.length >= 2) give(p, 'bigstage', `国际赛冠军 ${intl.length} 座`)
  }

  // the numbers, against everyone else with a real sample
  if (pool.length < MIN_PEERS) return out
  const n = pool.length >= 60 ? 3 : 2
  const rating = new Map(pool.map((p) => [p.id, ratingOf(p.career)]))
  const r = (p: Player) => rating.get(p.id) ?? 0
  /** the top n by a rate, pulled toward the pool's middle so a hot month cannot top a season */
  const leaders = (x: (p: Player) => number, per: (p: Player) => number, prior: number, ok: (p: Player) => boolean = () => true) => {
    const mid = quantile(pool.map((p) => x(p) / Math.max(1, per(p))), 0.5)
    const score = (p: Player) => (x(p) + mid * prior) / (per(p) + prior)
    const bar = quantile(pool.map(score), 0.9)
    return pool.filter((p) => ok(p) && score(p) >= bar)
      .sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))
      .slice(0, n)
  }
  const rounds = (p: Player) => p.career.rounds
  // a rate title is for the players who have carried a load: the busier 60% of the pool
  const busy = quantile(pool.map(rounds), 0.4)
  const load = (p: Player) => p.career.rounds >= busy

  leaders((p) => p.career.clutches, rounds, SHRINK_ROUNDS, load).forEach((p, i) =>
    give(p, 'clutch', `${p.career.maps} 张图 ${p.career.clutches} 次残局，同期第 ${i + 1}`))
  leaders((p) => p.career.firstKills, rounds, SHRINK_ROUNDS, (p) => load(p) && p.career.firstKills > p.career.firstDeaths).forEach((p, i) =>
    give(p, 'opener', `首杀 ${p.career.firstKills} 次，首杀差 +${p.career.firstKills - p.career.firstDeaths}，同期第 ${i + 1}`))
  leaders((p) => p.career.mvps, (p) => p.career.maps, SHRINK_MAPS, load).forEach((p, i) =>
    give(p, 'mvp', `${p.career.maps} 张图拿了 ${p.career.mvps} 次 MVP，同期第 ${i + 1}`))

  const ranked = (score: (p: Player) => number, ok: (p: Player) => boolean) =>
    pool.filter(ok).sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1)).slice(0, n)

  const r60 = quantile(pool.map(r), 0.6)
  const r80 = quantile(pool.map(r), 0.8)
  ranked((p) => p.career.maps, (p) => p.age >= 29 && r(p) >= r60).forEach((p) =>
    give(p, 'evergreen', `${p.age} 岁，${p.career.maps} 张图，评分 ${r(p).toFixed(2)} 还在前列`))
  ranked(r, (p) => p.age <= 20 && r(p) >= r80).forEach((p, i) =>
    give(p, 'rising', `${p.age} 岁，评分 ${r(p).toFixed(2)}，同期第 ${i + 1} 高的年轻选手`))

  return out
}

const cache = new WeakMap<GameState, { stamp: string; map: Map<string, StarTitle> }>()

/** Everyone in the world who carries a title today. Worked out once a day. */
export function starTitles(state: GameState): Map<string, StarTitle> {
  const stamp = `${state.year}:${state.day}:${state.me?.matches.length ?? 0}`
  const hit = cache.get(state)
  if (hit?.stamp === stamp) return hit.map
  const map = compute(state)
  cache.set(state, { stamp, map })
  return map
}

export const starTitleOf = (state: GameState, id: string): StarTitle | null => starTitles(state).get(id) ?? null
