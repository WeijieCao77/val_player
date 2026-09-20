/**
 * 数值平衡调研 — measure only, changes nothing.
 *
 * Written for the survey the author asked for on 2026-09-20, after players
 * reported that a team-mate who sat at 60-odd beside them reached 90-odd while
 * they went 70s → 80s, and that whole rosters read 95+ when the real people
 * are not stars. It answers those two with numbers rather than judgement:
 *
 *   npx tsx scripts/probe_balance.ts scale                       the ruler's own shape, no simulation
 *   npx tsx scripts/probe_balance.ts career <year> <runs> <yrs> <mode> <out.json>
 *   npx tsx scripts/probe_balance.ts paths  <year> <yrs> <out.json>
 *
 * `career` plays careers with the steady plan (auto), the week board's best
 * card (top) or one attribute forever (grind), and writes, year by year: the
 * player, every team-mate he started beside, and the whole world's rating
 * distribution. `paths` measures each thing that moves an AI rating on its own,
 * by cloning the world and running that one thing.
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek, autoPlan, autoResolve } from '../src/engine/me/auto'
import { advanceWeek, doAction } from '../src/engine/me/week'
import { hourValues } from '../src/engine/me/growth'
import { MeMatch } from '../src/engine/me/matchplay'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import { weeklyTick, seasonRollover } from '../src/engine/training'
import { syncYear, bookCovers } from '../src/engine/timeline'
import { holdScale, entryBands } from '../src/engine/ruler'
import { Rng, hashStr } from '../src/engine/rng'
import type { GameState, Player, Region, Role } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'
import { writeFileSync } from 'node:fs'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const job = process.argv[2] ?? 'scale'

/* ---------------------------------------------------------------- shared */

interface Snap { id: string; ign: string; real: string | null; o: number; pot: number; age: number; team: string; teamName: string; tier: number; league: string; region: string; role: string }

const snapOf = (state: GameState, p: Player): Snap => {
  const t = p.teamId ? state.teams[p.teamId] : undefined
  return {
    id: p.id, ign: p.ign, real: p.realName ?? null, o: p.overall, pot: p.potential, age: p.age,
    team: p.teamId ?? '', teamName: t?.name ?? '', tier: t?.tier ?? 0, league: t?.league ?? '',
    region: String(p.region), role: String(p.role),
  }
}

/** Everyone on a club, plus the free agents, as the world stands. */
const allPlayers = (state: GameState): Player[] => Object.values(state.players).filter((p) => p.id !== state.me?.id)

function worldShape(state: GameState) {
  const on = allPlayers(state).filter((p) => p.teamId && !state.teams[p.teamId]?.dormant)
  const cnt = (min: number) => on.filter((p) => p.overall >= min).length
  const byLeague: Record<string, { n: number; g95: number; g90: number; g85: number; med: number }> = {}
  const groups = new Map<string, number[]>()
  for (const p of on) {
    const t = state.teams[p.teamId!]
    const key = t?.league ?? '(无)'
    groups.set(key, [...(groups.get(key) ?? []), p.overall])
  }
  for (const [k, os] of groups) {
    const s = os.slice().sort((a, b) => a - b)
    byLeague[k] = {
      n: s.length, g95: s.filter((v) => v >= 95).length, g90: s.filter((v) => v >= 90).length,
      g85: s.filter((v) => v >= 85).length, med: s[Math.floor(s.length / 2)],
    }
  }
  // VCT starters only: the top five of every tier-1 club
  const starters: number[] = []
  const sub: number[] = []
  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    const os = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
    for (const o of os) (t.tier === 1 ? starters : sub).push(o)
  }
  const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  return {
    n: on.length, g95: cnt(95), g90: cnt(90), g85: cnt(85), g80: cnt(80),
    medAll: med(on.map((p) => p.overall)), medTop: med(starters), medSub: med(sub),
    top20: on.slice().sort((a, b) => b.overall - a.overall).slice(0, 20).map((p) => snapOf(state, p)),
    byLeague,
  }
}

/* ---------------------------------------------------------------- scale */

if (job === 'scale') {
  const out: Record<string, unknown> = {}
  for (const year of [2021, 2026] as const) {
    const state = createCareer({
      name: 'Probe', region: year === 2021 ? 'Europe' : 'EMEA', role: '决斗者',
      talents: emptyTalents(), originKey: 'net', start: 'pre', seed: 4242, year,
    })
    out[`w${year}`] = worldShape(state)
    out[`bands${year}`] = entryBands(year)
  }
  writeFileSync(process.argv[3] ?? 'scale.json', JSON.stringify(out, null, 1))
  console.log('scale written')
}

/* ---------------------------------------------------------------- career */

type Mode = 'auto' | 'top' | 'grind'

/** One week, played the way `mode` plays it. */
function playWeek(state: GameState, mode: Mode): { kind: string } {
  const me = state.me!
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  if (mode === 'auto') return autoWeek(state)
  // a human at the week board: all the hours go to one card
  plan(state, mode)
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    else clear()
    stop = advanceWeek(state)
  }
  return stop
}

function plan(state: GameState, mode: Mode): void {
  const me = state.me!
  const p = state.players[me.id]
  let guard = 0
  while (me.ap > 0 && guard++ < 30) {
    // the week board's own ranking (growth.ts hourValues) — a player chasing his peak follows it
    const best: MeAction = mode === 'top'
      ? (hourValues(state)[0]?.key ?? 'ranked')
      : 'aim'
    const def = ACTION_BY_KEY[best]
    if (me.ap < def.cost) break
    // the body still has to hold: rest when the legs are gone, as any player would
    const k: MeAction = p.fatigue > 78 ? 'rest' : best
    if (doAction(state, k) !== null) {
      if (doAction(state, 'rest') !== null) break
    }
  }
}

if (job === 'career') {
  const year = Number(process.argv[3] ?? 2026) as 2021 | 2026
  const runs = Number(process.argv[4] ?? 8)
  const years = Number(process.argv[5] ?? 8)
  const mode = (process.argv[6] ?? 'auto') as Mode
  const outPath = process.argv[7] ?? 'career.json'
  const REGIONS2021: Region[] = ['Europe', 'North America', 'Korea', 'Brazil']
  const REGIONS2026: Region[] = ['EMEA', 'Americas', 'Pacific', 'China']
  const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
  const STARTS: StartPoint[] = ['chal', 't1', 'chal', 't1']
  const rows: unknown[] = []
  const t0 = Date.now()
  for (let i = 0; i < runs; i++) {
    const seed = 2000 + i * 131
    const region = (year === 2021 ? REGIONS2021 : REGIONS2026)[i % 4]
    const role = ROLES[Math.floor(i / 4) % 4]
    const start = STARTS[i % 4]
    let state: GameState
    try {
      state = createCareer({ name: `Bal${i}`, region, role, talents: emptyTalents(), originKey: 'net', start, seed, year })
    } catch (e) {
      process.stderr.write(`run ${i} skipped: ${String(e)}\n`)
      continue
    }
    const me = state.me!
    const p = state.players[me.id]
    /** the people he started beside: locked in the first week he is on a roster */
    let mates: string[] = []
    let mateYear = 0
    const track = new Map<string, { first: Snap; by: Record<number, Snap> }>()
    const yearly: unknown[] = []
    let weeks = 0
    let crashed = ''
    const y0 = state.year
    try {
      while (state.year < y0 + years && me.phase !== 'retired' && weeks < years * 60) {
        const yr = state.year
        const stop = playWeek(state, mode)
        weeks++
        if (!mates.length && me.phase === 'pro' && state.myTeam) {
          mateYear = state.year
          mates = (state.teams[state.myTeam]?.roster ?? []).filter((id) => id !== me.id)
          for (const id of mates) {
            const q = state.players[id]
            if (q) track.set(id, { first: snapOf(state, q), by: {} })
          }
        }
        // the year turned inside that week: book the world as it stands
        if (state.year !== yr) {
          for (const [id, rec] of track) { const q = state.players[id]; if (q) rec.by[state.year] = snapOf(state, q) }
          yearly.push({ year: state.year, me: snapOf(state, p), world: worldShape(state), atClub: state.myTeam, tier: state.teams[state.myTeam]?.tier ?? 0 })
        }
        if (stop.kind === 'game-over') break
      }
    } catch (e) { crashed = String((e as Error).message ?? e).slice(0, 120) }
    rows.push({
      seed, region, role, start, year, mode, mateYear, weeks, crashed,
      end: snapOf(state, p), ending: me.ending?.title ?? '(未退役)',
      seasons: me.seasons.map((s) => ({ year: s.year, tier: s.tier, from: s.overallFrom, to: s.overallTo, starts: s.starts, matches: s.matches })),
      mates: [...track].map(([id, rec]) => ({ id, first: rec.first, by: rec.by })),
      yearly,
    })
    process.stderr.write(`run ${i + 1}/${runs} ${region} ${role} ${start} → ${p.overall} (${me.ending?.title ?? me.phase}) ${crashed}\n`)
  }
  writeFileSync(outPath, JSON.stringify({ year, runs, years, mode, secs: Math.round((Date.now() - t0) / 1000), rows }, null, 1))
  console.log(`career written: ${rows.length} runs in ${Math.round((Date.now() - t0) / 1000)}s`)
}

/* ---------------------------------------------------------------- paths */

/** A deep copy good enough to run one world tick on. */
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState

const deltas = (before: GameState, after: GameState) => {
  const out: number[] = []
  for (const p of Object.values(after.players)) {
    const b = before.players[p.id]
    if (!b || p.id === after.me?.id) continue
    out.push(p.overall - b.overall)
  }
  const sum = out.reduce((s, v) => s + v, 0)
  const nz = out.filter((v) => v !== 0)
  const s = out.slice().sort((a, b) => a - b)
  return {
    n: out.length, sum, mean: out.length ? sum / out.length : 0,
    moved: nz.length, up: out.filter((v) => v > 0).length, down: out.filter((v) => v < 0).length,
    p10: s[Math.floor(s.length * 0.1)] ?? 0, med: s[Math.floor(s.length / 2)] ?? 0, p90: s[Math.floor(s.length * 0.9)] ?? 0,
    max: s[s.length - 1] ?? 0, min: s[0] ?? 0,
  }
}

/** The same, for the young alone — where a world's growth actually is. */
const deltasAge = (before: GameState, after: GameState, lo: number, hi: number) => {
  const out: number[] = []
  for (const p of Object.values(after.players)) {
    const b = before.players[p.id]
    if (!b || p.id === after.me?.id || b.age < lo || b.age > hi) continue
    out.push(p.overall - b.overall)
  }
  const sum = out.reduce((s, v) => s + v, 0)
  return { n: out.length, mean: out.length ? sum / out.length : 0 }
}

if (job === 'paths') {
  const year = Number(process.argv[3] ?? 2026) as 2021 | 2026
  const years = Number(process.argv[4] ?? 6)
  const outPath = process.argv[5] ?? 'paths.json'
  const state = createCareer({
    name: 'Probe', region: year === 2021 ? 'Europe' : 'EMEA', role: '决斗者',
    talents: emptyTalents(), originKey: 'net', start: 'chal', seed: 7777, year,
  })
  const me = state.me!
  const p = state.players[me.id]
  const out: unknown[] = []
  let weeks = 0
  const y0 = state.year
  while (state.year < y0 + years && me.phase !== 'retired' && weeks < years * 60) {
    const yr = state.year
    const wasYear = clone(state)
    const stop = autoWeek(state)
    weeks++
    if (state.year !== yr) {
      // the turn just happened: measure each of the winter's paths on its own, from the week before it
      const base = wasYear
      const t1 = clone(base); const r1 = new Rng(hashStr(`probe:roll:${yr}`)); seasonRollover(t1, r1)
      const t2 = clone(base); t2.year = yr + 1; syncYear(t2, yr + 1)
      const t3 = clone(base); holdScale(t3)
      const t4 = clone(base); const r4 = new Rng(hashStr(`probe:train:${yr}`)); for (let w = 0; w < 4; w++) weeklyTick(t4, r4)
      out.push({
        year: yr, bookCovers: bookCovers(yr + 1),
        rollover: deltas(base, t1), rolloverYoung: deltasAge(base, t1, 16, 21), rolloverOld: deltasAge(base, t1, 27, 40),
        book: deltas(base, t2), hold: deltas(base, t3),
        train4w: deltas(base, t4), train4wYoung: deltasAge(base, t4, 16, 21), train4wOld: deltasAge(base, t4, 27, 40),
        me: { o: p.overall, pot: p.potential, age: p.age, phase: me.phase },
      })
      process.stderr.write(`year ${yr} measured\n`)
    }
    if (stop.kind === 'game-over') break
  }
  writeFileSync(outPath, JSON.stringify({ year, years, rows: out }, null, 1))
  console.log('paths written')
}
