/**
 * A Challengers promotion place won in a decider, whose split is next season's: does the next season seat the club?
 *
 * Reported 2026-09-24, beside 「赢了晋升赛没上一级联赛」: twelve promotion stages of 2023–2025 send their sides into the
 * next season's first split, and a club that won its decider for the last place played the next season where it had
 * been (engine/circuit.ts carryPromotions, promotedIn). Where the real side that held the place is in that split, the
 * winner takes its seat; where it is not (six of the twelve), nothing is made up.
 *
 *   npx tsx scripts/check_promotion_carry.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { carryPromotions, drawnSeeds, eventOf, eventsOf } from '../src/engine/circuit'
import type { CEvent } from '../src/engine/circuit'
import type { Competition, Fixture, GameState, Team } from '../src/engine/types'

const t0 = Date.now()
let checks = 0
const ok = (label: string) => { checks++; console.log(`OK ${label}`) }
const base = createCareer({ name: '升级赛回归', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 3, year: 2021 })

// every promotion stage whose places go into another season's event
const feeds: { y: number; ev: CEvent; ui: number; to: CEvent }[] = []
for (const y of [2023, 2024, 2025]) for (const ev of eventsOf(y)) ev.units.forEach((u, ui) => {
  if (!u.feeds || !u.promotes) return
  const to = eventOf(u.feeds)!
  if (!eventsOf(y).some((e) => e.id === to.id)) feeds.push({ y, ev, ui, to })
})
assert.equal(feeds.length, 12)

function turn(f: (typeof feeds)[0], winner: 'mine' | 'real') {
  const s = structuredClone(base) as GameState
  const u = f.ev.units[f.ui]
  const real = u.ranked![u.promotes! - 1]
  const stub = (vlr: string) => {
    const id = `V21T${vlr}`
    if (!vlr.startsWith('N:') && !s.teams[id]) s.teams[id] = { ...structuredClone(s.teams[s.myTeam]), id, name: vlr, roster: [] } as Team
  }
  for (const v of [...f.to.seeds, ...(u.ranked ?? [])]) stub(v)
  s.year = f.y
  const mine = s.myTeam
  const rival = `V21T${real}`
  const fx = { id: 'decider', comp: `ev:${f.ev.id}`, label: 'KO:0:升降级 · 决胜局', day: f.ev.end ?? 300, bo: 3, played: true,
    teamA: mine, teamB: rival, result: { mapsWonA: winner === 'mine' ? 2 : 0, mapsWonB: winner === 'mine' ? 0 : 2, maps: [] } } as unknown as Fixture
  const comp = { ...Object.values(base.comps).find((c) => c.circuit)!, key: `ev:${f.ev.id}`, champion: mine, finished: [mine] } as Competition
  comp.circuit = { ...comp.circuit!, id: f.ev.id, mode: 'sim', done: undefined, playin: { key: `${f.ui}:${u.promotes}`, fixture: 'decider' } }
  s.comps = { [comp.key]: comp }
  s.fixtures = [fx]
  // the turn: carried before the season's events and ties are cleared
  s.year = f.y + 1
  carryPromotions(s)
  s.comps = {}
  s.fixtures = []
  return { s, mine, real, seeds: drawnSeeds(s, f.to) }
}

const seated: string[] = []
const unread: string[] = []
for (const f of feeds) {
  const { s, mine, real, seeds } = turn(f, 'mine')
  assert.deepEqual(s.promoted, [{ year: f.y + 1, feeds: f.to.id, real, club: mine }], `${f.ev.name}: carried`)
  const at = f.to.seeds.indexOf(real)
  if (at >= 0) {
    assert.equal(seeds[at], mine, `${f.ev.name} → ${f.to.name}: the decider's winner in the real side's seat`)
    assert.equal(seeds.filter((t) => t === mine).length, 1)
    seated.push(`${f.ev.name} → ${f.to.name}`)
  } else {
    assert.ok(!seeds.includes(mine), `${f.ev.name}: no seat made up`)
    unread.push(`${f.ev.name} → ${f.to.name}`)
  }
  // the real side, where it is a club here, winning its own place carries nothing (an open-qualifier side is nobody's)
  if (!real.startsWith('N:')) {
    const lost = turn(f, 'real')
    assert.equal(lost.s.promoted, undefined, 'the real side won its own place: nothing carried')
    assert.ok(!lost.seeds.includes(lost.mine))
  }
  // a season later nothing is read
  s.year += 1
  assert.ok(!drawnSeeds(s, f.to).includes(mine) || f.to.seeds.indexOf(real) < 0)
}
assert.equal(seated.length, 6, `six seats read: ${seated.join('; ')}`)
assert.deepEqual(unread.sort(), [
  'Challengers 2025: Brazil Gamers Club Stage 2 → Challengers 2026: Brazil Gamers Club Stage 1',
  'Challengers 2025: France Revolution Stage 3 → Challengers 2026: France Revolution Stage 1',
  'Challengers 2025: North America ACE Stage 3 → Challengers 2026: North America ACE Stage 1',
  'Challengers League Malaysia/Singapore: Split 2 → Challengers League 2024 Malaysia/Singapore: Split 1',
  'Challengers League Taiwan/Hong Kong: Split 2 → Challengers League 2024 Taiwan/Hong Kong: Split 1',
  'Challengers League 2024 DACH Evolution: Split 2 → Challengers 2025: DACH Evolution Stage 1',
].sort())
ok(`a decider won for a promotion place into next season: seated in ${seated.length} of 12; the other six are not made up`)
console.log(`PASS ${checks} promotion-carry checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
