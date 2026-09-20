import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MapSim, buildLineup, mapMvp, seriesMvp, simulateMatch } from '../src/engine/match'
import { aggregateLines, mapPerformanceRating, performanceRating } from '../src/engine/performance'
import { boxScore } from '../src/engine/me/postmatch'
import { ratingOf } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import type { MapLine, MapScore, Role } from '../src/engine/types'

let groups = 0
const check = (name: string, fn: () => void) => { fn(); groups++; console.log(`✓ ${name}`) }
const line = (p: Partial<MapLine> = {}): MapLine => ({ kills: 16, deaths: 16, assists: 6, damage: 3000, firstKills: 3, firstDeaths: 3, clutches: 0, rounds: 24, acs: 181, ...p })
const map = (lines: Record<string, MapLine>, modern = true): MapScore => ({ map: 'Ascent', scoreA: 13, scoreB: 11, lines, ...(modern ? { performanceVersion: 1 as const } : {}) })
const support = line({ kills: 12, deaths: 13, assists: 14, firstKills: 1, firstDeaths: 1, damage: 2400, acs: 145 })

check('recorded support and clutch contributions can beat higher ACS; no role bonus', () => {
  const duel = line()
  assert(performanceRating(support) > performanceRating(duel))
  assert.equal(mapMvp(map({ duel, support }), { a: ['duel', 'support'], b: [] }), 'support')
  assert(performanceRating(line({ kills: 30 })) > performanceRating(support))
  assert(performanceRating(line({ clutches: 3 })) > performanceRating(line()))
  assert(performanceRating(line({ deaths: 10 })) > performanceRating(line()))
  assert(performanceRating(line({ firstKills: 5, firstDeaths: 1 })) > performanceRating(line()))
  assert.equal(performanceRating(line({ kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0 })), .55)
})
check('zero/missing/corrupt fields are finite, bounded, and zero rounds never win', () => {
  assert.equal(performanceRating({}), 0)
  assert.equal(performanceRating({ rounds: 0, kills: 100 }), 0)
  assert(Number.isFinite(performanceRating({ rounds: 20, kills: NaN, assists: Infinity, deaths: -10 })))
  assert.equal(performanceRating({ rounds: 1, kills: 1e9, assists: 1e9, clutches: 1e9 }), 3)
  assert.equal(mapMvp(map({ absent: line({ rounds: 0, acs: 9999 }), support })), 'support')
  assert.equal(mapMvp(map({})), null)
})
check('ties have no winner nod; real loser can still win MVP', () => {
  const tied = map({ a: line(), b: line() }); tied.scoreA = tied.scoreB = 12
  assert.equal(mapMvp(tied, { a: ['a'], b: ['b'] }), 'a')
  assert.equal(mapMvp(map({ a: line(), b: line({ kills: 30 }) }), { a: ['a'], b: ['b'] }), 'b')
})
check('old maps keep old rating/ACS MVP without rewriting the input', () => {
  const old = map({ duel: line(), support }, false)
  const before = JSON.stringify(old)
  assert.equal(mapMvp(old), 'duel')
  assert.equal(mapPerformanceRating(old, support), ratingOf(support))
  assert.equal(seriesMvp([old], new Set()), 'duel')
  assert.equal(JSON.stringify(old), before)
})
check('series sums actual rounds, missing players only count rounds played; ACS stays damage', () => {
  const maps = [map({ p: line({ rounds: 12, kills: 12 }), q: support }), map({ p: line({ rounds: 36, kills: 12 }) })]
  const totals = aggregateLines(maps)
  assert.equal(totals.p.rounds, 48)
  assert.equal(totals.q.rounds, 24)
  assert.equal(totals.p.kills, 24)
  assert.equal(totals.p.acs, 6000 / 48 * 1.45)
  assert.equal(seriesMvp(maps, new Set()), performanceRating(totals.p) > performanceRating(totals.q) ? 'p' : 'q')
})

const state = createCareer({ name: 'RolePerformance', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 872 })
const teams = Object.values(state.teams).filter((t) => t.roster.length >= 5)
check('new and old career boxes use their own scoring; rating ties sort on ACS', () => {
  const ids = teams[0].roster.slice(0, 2)
  const modern = map({ [ids[0]]: line(), [ids[1]]: support })
  const rows = boxScore(state, [modern], ids, [])
  assert.equal(rows[0].id, ids[1])
  assert.equal(rows[0].rating, Math.round(performanceRating(support) * 100) / 100)
  delete modern.performanceVersion
  const old = boxScore(state, [modern], ids, [])
  assert.equal(old.find((r) => r.id === ids[1])!.rating, Math.round(ratingOf(support) * 100) / 100)
})
let checkedRounds = 0, clutchRounds = 0
check('actual rounds conserve kills/deaths; opening credits belong to real kills/deaths; clutch winner alive', () => {
  for (let i = 0; i < 60; i++) {
    const a = teams[i % teams.length].id, b = teams[(i + 9) % teams.length].id
    const sim = new MapSim('Ascent', buildLineup(state, a, 'Ascent', b), buildLineup(state, b, 'Ascent', a), new Rng(55000 + i))
    while (!sim.over) {
      const before = structuredClone(sim.lines)
      sim.playRound()
      let kills = 0, deaths = 0, fk = 0, fd = 0, clutches = 0
      for (const [pid, after] of Object.entries(sim.lines)) {
        const old = before[pid]
        const k = after.kills - old.kills, d = after.deaths - old.deaths
        const f = after.firstKills - old.firstKills, x = after.firstDeaths - old.firstDeaths
        const c = after.clutches - old.clutches
        assert(f <= k); assert(x <= d)
        if (c) { assert.equal(d, 0); clutchRounds++ }
        kills += k; deaths += d; fk += f; fd += x; clutches += c
      }
      assert.equal(kills, deaths); assert.equal(fk, fd); assert(fk <= 1); assert(clutches <= 1)
      checkedRounds++
    }
    assert.equal(sim.result().score.performanceVersion, 1)
  }
  assert(clutchRounds > 0)
})

const distribution: Partial<Record<Role, { n: number; traditional: number; contribution: number; mvps: number }>> = {}
for (let i = 0; i < 800; i++) {
  const a = teams[(i * 7) % teams.length].id, b = teams[(i * 13 + 3) % teams.length].id
  if (a === b) continue
  const result = simulateMatch(state, a, b, 3, new Rng(872000 + i))
  for (const [pid, totals] of Object.entries(aggregateLines(result.maps))) {
    const role = state.players[pid].role
    const t = distribution[role] ??= { n: 0, traditional: 0, contribution: 0, mvps: 0 }
    t.n++; t.traditional += ratingOf(totals); t.contribution += performanceRating(totals)
    if (result.mvp === pid) t.mvps++
  }
}
console.log(JSON.stringify({ groups, checkedRounds, clutchRounds, distribution: Object.fromEntries(Object.entries(distribution).map(([role, t]) => [role, { n: t.n, traditional: +(t.traditional / t.n).toFixed(4), contribution: +(t.contribution / t.n).toFixed(4), mvps: t.mvps }])) }, null, 2))
console.log('✓ Role performance regression passed (distribution is diagnostic, not equal-ability causal proof).')
