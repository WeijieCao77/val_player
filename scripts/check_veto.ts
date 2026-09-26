/**
 * The map veto: who opens it, the grand final's upper-bracket hand, and whether each side picks and
 * bans by its own maps. No season is run; the brackets are written by hand.
 *
 * Reported 2026-09-26: 「胜者组进决赛没有获得两ban一选，导致打的第一张图是劣势地图」 — every series
 * alternated from side A, so the upper-bracket finalist banned one map and the other side the second,
 * and a bracket written with the upper finalist second handed the first map to the other side. The
 * sourced rules are in src/engine/me/veto.ts.
 *
 *   npx tsx scripts/check_veto.ts
 */
import assert from 'node:assert/strict'
import { mapCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MatchSim, poolFor, runVeto, simulateMatch, vetoSteps } from '../src/engine/match'
import type { VetoLead } from '../src/engine/match'
import { MeMatch } from '../src/engine/me/matchplay'
import { vetoLeadOf } from '../src/engine/me/veto'
import { eventsOf, isLeagueEvent } from '../src/engine/circuit'
import { makeFixture } from '../src/engine/league'
import type { Competition, Fixture, GameState, MatchResult } from '../src/engine/types'

globalThis.fetch = () => Promise.reject(new Error('offline regression'))
const t0 = Date.now()
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }

const base = createCareer({ name: '禁图回归', region: 'Korea' as never, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2026, seed: 3 })
const mine = base.myTeam
const others = Object.values(base.teams).filter((t) => t.id !== mine && t.roster.length >= 5 && !t.dormant).map((t) => t.id)
const [foe, third, fourth] = others

/** A world on 2026 day 200 whose one competition is `name`, with an upper and a lower final already played. */
function bracket(opts: { year?: number; name: string; circuit?: string; stage?: Competition['stage']; up: string; down: string; gfA: string; bo?: 1 | 2 | 3 | 5; round?: string }): { s: GameState; gf: Fixture } {
  const s = structuredClone(base)
  s.year = opts.year ?? 2026; s.day = 200; s.stage = opts.stage ?? 'stage2'
  s.fixtures = []; s.vetoPlan = undefined
  const key = 'veto-test'
  s.comps = { [key]: { key, name: opts.name, stage: s.stage, teams: [opts.up, opts.down, third], standings: {}, finished: [],
    ...(opts.circuit ? { format: 'circuit' as const, circuit: { id: opts.circuit, start: 0, end: 364, seeds: [] } } : {}) } }
  const played = (day: number, a: string, b: string, label: string, aWins: boolean) => {
    const f = makeFixture(s, day, s.stage, key, a, b, 3, label)
    f.played = true
    f.result = { mapsWonA: aWins ? 2 : 0, mapsWonB: aWins ? 0 : 2, maps: [], vetoLog: [], mvp: null, highlights: [] } as unknown as MatchResult
    s.fixtures.push(f)
  }
  played(190, opts.up, third, 'KO:3:胜者组决赛', true)
  played(195, third, opts.down, 'KO:5:败者组决赛', false)
  const gf = makeFixture(s, 200, s.stage, key, opts.gfA, opts.gfA === opts.up ? opts.down : opts.up, opts.bo ?? 5, opts.round ?? 'KO:6:总决赛')
  s.fixtures.push(gf)
  return { s, gf }
}

const steps = (bo: 1 | 2 | 3 | 5, lead?: VetoLead) => vetoSteps(bo, lead).map((x) => `${x.by} ${x.act}`).join(', ')

check('BO3 and BO5 orders: alternating from the side that opens; the upper hand bans twice, then picks maps one and three', () => {
  // EG–TL, Masters Tokyo 2023 (vlr.gg/220446): EG ban; TL ban; EG pick; TL pick; EG ban; TL ban; decider
  assert.equal(steps(3), 'a ban, b ban, a pick, b pick, a ban, b ban')
  // FNC–WOL, Masters Toronto 2025 lower final (vlr.gg/498634): alternating, FNC first
  assert.equal(steps(5), 'a ban, b ban, a pick, b pick, a pick, b pick')
  assert.equal(steps(3, { side: 'b', both: false, upper: true }), 'b ban, a ban, b pick, a pick, b ban, a ban')
  // GEN–SEN, Masters Madrid 2024 (vlr.gg/312779): GEN ban; GEN ban; GEN pick; SEN pick; GEN pick; SEN pick; decider
  assert.equal(steps(5, { side: 'b', both: true, upper: true }), 'b ban, b ban, b pick, a pick, b pick, a pick')
  assert.equal(steps(5, { side: 'a', both: true, upper: true }), 'a ban, a ban, a pick, b pick, a pick, b pick')
})

check('runVeto with the upper hand: both bans and maps one and three are his, the decider is nobody\'s', () => {
  const s = structuredClone(base); s.day = 200; s.stage = 'stage2'
  const pool = poolFor(s)
  assert.equal(pool.length, 7)
  for (let seed = 0; seed < 12; seed++) {
    const v = runVeto(s, foe, mine, 5, pool, new Rng(seed), { side: 'b', both: true, upper: true })
    const me = s.teams[mine].name
    assert.match(v.log[0], /从胜者组晋级/)
    const bans = v.log.filter((l) => l.includes('禁图：'))
    assert.equal(bans.length, 2)
    assert.ok(bans.every((l) => l.startsWith(`${me} 禁图`)), `both bans are the upper side's: ${bans}`)
    assert.deepEqual(v.pickedBy, ['b', 'a', 'b', 'a', null])
    assert.equal(new Set(v.maps).size, 5)
    assert.ok(v.log.at(-1)!.startsWith('决胜图'))
  }
  // no lead: exactly the old alternating veto from side A
  const plain = runVeto(s, foe, mine, 3, pool, new Rng(4))
  assert.deepEqual(plain.pickedBy, ['a', 'b', null])
  assert.ok(plain.log[0].startsWith(`${s.teams[foe].name} 禁图`))
})

check('a 2026 Masters grand final: the upper finalist has the hand even when the bracket writes him second', () => {
  const { s, gf } = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe })
  const lead = vetoLeadOf(s, gf)
  assert.deepEqual(lead, { side: 'b', both: true, upper: true })
  const mm = new MeMatch(s, gf)
  assert.equal(mm.side, 'b')
  assert.equal(mm.sim.lead?.side, mm.side)
  assert.equal(mm.sim.pickedBy[0], mm.side, 'map one is the upper finalist\'s pick')
  assert.equal(mm.sim.pickedBy[2], mm.side, 'map three too')
  const bans = mm.sim.vetoLog.filter((l) => l.includes('禁图：'))
  assert.ok(bans.length === 2 && bans.every((l) => l.startsWith(s.teams[mine].name)), bans.join(' | '))
  // and the same the other way: a lower-bracket finalist gets no bans at all
  const other = bracket({ name: '伦敦大师赛', stage: 'masters2', up: foe, down: mine, gfA: mine })
  const mm2 = new MeMatch(other.s, other.gf)
  assert.equal(mm2.sim.lead?.side, 'b')
  assert.equal(mm2.sim.pickedBy[0], 'b')
  assert.ok(mm2.sim.vetoLog.filter((l) => l.includes('禁图：')).every((l) => l.startsWith(other.s.teams[foe].name)))
})

check('NPC grand finals get the same hand: simulated in the day loop\'s path', () => {
  const { s, gf } = bracket({ name: '2026 全球冠军赛', stage: 'champions', up: foe, down: fourth, gfA: fourth })
  const lead = vetoLeadOf(s, gf)
  assert.deepEqual(lead, { side: 'b', both: true, upper: true })
  const r = simulateMatch(s, gf.teamA, gf.teamB, gf.bo, new Rng(9), gf.scrim, lead)
  assert.match(r.vetoLog[0], new RegExp(`^${s.teams[foe].name} 从胜者组晋级`))
  const bans = r.vetoLog.filter((l) => l.includes('禁图：'))
  assert.ok(bans.every((l) => l.startsWith(s.teams[foe].name)))
})

check('by era and event: 2023-on VCT league both bans; Challengers, 2021 and 2024 Challengers open the veto only', () => {
  const league = eventsOf(2024).find((e) => isLeagueEvent(2024, e) && e.stage === 'stage1')!
  assert.ok(league, 'a 2024 league stage on the books')
  const l = bracket({ year: 2024, name: league.cn, circuit: league.id, stage: 'stage1', up: mine, down: foe, gfA: foe })
  assert.deepEqual(vetoLeadOf(l.s, l.gf), { side: 'b', both: true, upper: true })
  const chal = bracket({ year: 2024, name: '韩国 · 挑战者联赛 第一赛段', stage: 'stage1', up: mine, down: foe, gfA: foe })
  assert.deepEqual(vetoLeadOf(chal.s, chal.gf), { side: 'b', both: false, upper: true })
  const r21 = bracket({ year: 2021, name: '雷克雅未克大师赛', stage: 'masters1', up: mine, down: foe, gfA: foe })
  assert.deepEqual(vetoLeadOf(r21.s, r21.gf), { side: 'b', both: false, upper: true })
  const r22 = bracket({ year: 2022, name: '哥本哈根大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe })
  assert.deepEqual(vetoLeadOf(r22.s, r22.gf), { side: 'b', both: true, upper: true })
  // a BO3 final keeps the ordinary veto, opened by the upper side
  const bo3 = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe, bo: 3 })
  assert.deepEqual(vetoLeadOf(bo3.s, bo3.gf), { side: 'b', both: false, upper: true })
  const sim = new MatchSim(bo3.s, bo3.gf.teamA, bo3.gf.teamB, 3, new Rng(3), undefined, vetoLeadOf(bo3.s, bo3.gf))
  assert.deepEqual(sim.pickedBy, ['b', 'a', null])
})

check('no hand where the bracket gives none: other rounds, scrims, a manager\'s save', () => {
  const lbf = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe, round: 'KO:5:败者组决赛' })
  assert.equal(vetoLeadOf(lbf.s, lbf.gf), undefined)
  const single = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe, round: 'KO:6:决赛' })
  assert.equal(vetoLeadOf(single.s, single.gf), undefined)
  const scrim = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe })
  scrim.gf.scrim = { map: 'Ascent', format: 'full24' }
  assert.equal(vetoLeadOf(scrim.s, scrim.gf), undefined)
  const manager = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe })
  manager.s.me = undefined
  assert.equal(vetoLeadOf(manager.s, manager.gf), undefined)
})

check('each side bans the other\'s best maps and picks its own, the player\'s club included', () => {
  const { s, gf } = bracket({ name: '伦敦大师赛', stage: 'masters2', up: mine, down: foe, gfA: foe })
  const pool = poolFor(s)
  const [strong, second, theirA, theirB, ...rest] = pool
  for (const m of pool) { s.teams[mine].mapPrefs[m] = 50; s.teams[foe].mapPrefs[m] = 50 }
  s.teams[mine].mapPrefs[strong] = 88; s.teams[foe].mapPrefs[strong] = 35
  s.teams[mine].mapPrefs[second] = 80; s.teams[foe].mapPrefs[second] = 45
  s.teams[mine].mapPrefs[theirA] = 30; s.teams[foe].mapPrefs[theirA] = 88
  s.teams[mine].mapPrefs[theirB] = 32; s.teams[foe].mapPrefs[theirB] = 85
  assert.ok(rest.length === 3)
  const lead = vetoLeadOf(s, gf)!
  for (let seed = 0; seed < 20; seed++) {
    const sim = new MatchSim(s, gf.teamA, gf.teamB, 5, new Rng(seed), undefined, lead)
    const bans = sim.vetoLog.filter((l) => l.includes('禁图：'))
    assert.ok(bans.some((l) => l.endsWith(mapCn(theirA))) && bans.some((l) => l.endsWith(mapCn(theirB))), `seed ${seed}: bans ${bans}`)
    assert.equal(sim.maps[0], strong, `seed ${seed}: map one ${sim.maps[0]}`)
    assert.equal(sim.maps[2], second, `seed ${seed}: map three ${sim.maps[2]}`)
  }
  // across random boards, the side that picks is at least as strong as the other on its own pick: map one
  // (the upper hand's first pick, the one the report was about) nearly always — the old side-blind pick
  // managed 75% — and later picks, made from what is left, most of the time
  const rng = new Rng(77)
  let fair = 0, n = 0, first = 0
  const boards = 400
  for (let i = 0; i < boards; i++) {
    for (const id of [mine, foe]) for (const m of pool) s.teams[id].mapPrefs[m] = Math.round(50 + rng.range(-25, 25))
    const v = runVeto(s, foe, mine, 5, pool, new Rng(i), lead)
    v.maps.forEach((m, k) => {
      const by = v.pickedBy[k]
      if (!by) return
      const [me, them] = by === 'a' ? [foe, mine] : [mine, foe]
      const edge = s.teams[me].mapPrefs[m] >= s.teams[them].mapPrefs[m]
      n++
      if (edge) fair++
      if (k === 0 && edge) first++
    })
  }
  assert.ok(first / boards >= 0.85, `map one was the picker's edge only ${(first / boards * 100).toFixed(0)}% of the time`)
  assert.ok(fair / n >= 0.7, `a pick was the picker's edge only ${(fair / n * 100).toFixed(0)}% of the time`)
  console.log(`   map one the picker's edge ${(first / boards * 100).toFixed(0)}%, every pick ${(fair / n * 100).toFixed(0)}%`)
})

console.log(`PASS ${checks} veto checks (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
