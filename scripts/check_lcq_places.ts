/** 2022 South America LCQ has two placing seats, never a duplicated winner.
 * npx tsx scripts/check_lcq_places.ts — constructed draw only; no career simulation.
 */
import assert from 'node:assert/strict'
import routes from '../src/data/routes.json'
import partnered from '../src/data/routes_partnered.json'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { eventOf, progressCircuit, setupCircuitSeason } from '../src/engine/circuit'
import { syncEvent } from '../src/engine/timeline'

const book = routes.events as Record<string, { routes?: Record<string, { kind: string; event?: string; k?: number; pool?: string }>; award?: unknown }>
const out = book['1015'].routes!
assert.deepEqual(out['2355'], { kind: 'top', event: '1111', k: 0 })
assert.deepEqual(out['2406'], { kind: 'top', event: '1111', k: 1 })
assert.equal((partnered.events as Record<string, unknown>)['1015'], undefined, 'partnered data must not override open-era fix')
for (const [id, rules] of Object.entries(book)) {
  const used = new Set<string>()
  for (const r of Object.values(rules.routes ?? {})) {
    if (r.kind !== 'winner') continue
    assert(!used.has(r.event!), `${id} repeats winner of ${r.event}`)
    used.add(r.event!)
  }
}

const keyd = 'V21T4894', levi = 'V21T2359', furia = 'V21T2406', kru = 'V21T2355'
function draw(alreadyThrough: boolean, replay: boolean) {
  const state = createCareer({ name: 'LCQProbe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 11, year: 2021 })
  state.year = 2022
  syncEvent(state, eventOf('1111')!.rosters ?? {})
  syncEvent(state, eventOf('1015')!.rosters ?? {})
  setupCircuitSeason(state)
  const source = state.comps['ev:1111']
  const target = state.comps['ev:1015']
  assert(source?.circuit && target?.circuit)
  for (const t of [keyd, levi, furia, kru]) assert(state.teams[t], t)
  source.circuit.mode = replay ? 'history' : 'sim'
  source.finished = replay ? [kru, furia, keyd, levi] : [keyd, levi, furia, kru]
  source.places = [1, 2, 3, 4]
  source.champion = source.finished[0]
  // Explicitly touch LATAM's points pool with a finished paying event, so its
  // direct seat is a known world result, not an accidental historical default.
  const feeder = state.comps['ev:1086']
  assert(feeder?.circuit && book['1086'].award)
  feeder.circuit.mode = 'sim'
  feeder.champion = alreadyThrough ? levi : kru
  feeder.finished = [feeder.champion]
  for (const team of Object.values(state.teams)) team.champPoints = 0
  state.teams[feeder.champion].champPoints = 1000
  state.day = eventOf('1015')!.start! - 1
  progressCircuit(state, target, [])
  const event = eventOf('1015')!
  const seats = ['2355', '2406'].map(v => target.circuit!.seeds[event.seeds.indexOf(v)])
  assert.equal(new Set(target.circuit.seeds).size, target.circuit.seeds.length, 'no duplicated entrants')
  const expected = replay ? [kru, furia] : alreadyThrough ? [keyd, furia] : [keyd, levi]
  assert.deepEqual(seats, expected, `${replay ? 'history' : 'sim'} LCQ placing seats`)
  // Existing saves with a drawn field are not re-drawn when route data changes.
  target.circuit.seeds[event.seeds.indexOf('2355')] = 'legacy-seat'
  const kept = [...target.circuit.seeds]
  progressCircuit(state, target, [])
  assert.deepEqual(target.circuit.seeds, kept, 'already drawn saves preserve their seats')
  console.log(`✓ ${replay ? '历史回放' : alreadyThrough ? '第二名另路直通，顺延第三名' : '前两名未直通'}；已抽签名单保持`)
}
draw(true, false)
draw(false, false)
draw(true, true)
console.log('✓ 南美 LCQ 双名额：数据、顺延、历史和旧存档保护')
