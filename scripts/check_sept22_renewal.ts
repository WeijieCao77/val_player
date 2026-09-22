/** DeepSeek draft reviewed against real APIs; no skipped regions or fixtures.
 * npx tsx scripts/check_sept22_renewal.ts */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region, SquadRole } from '../src/engine/types'
import { expectedSalary, recomputeOverall } from '../src/engine/player'
import { makeDeal, ROLE_PAY } from '../src/engine/me/contract'
import { expectOf, tryoutSkill } from '../src/engine/me/prepro'
import { keepInBand, offerOf, payBand, payOf } from '../src/engine/me/paytable'
import { convert, roundPay, toUsd } from '../src/engine/me/currency'
import { clamp, Rng } from '../src/engine/rng'
import type { Deal } from '../src/engine/me/types'

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, fetch: () => Promise.reject(new Error('offline')) })
type Grade = 'A+' | 'A' | 'B' | 'C' | 'D'
const GRADE_DELTA: Record<Grade, number> = { 'A+': 8, A: 4, B: 0, C: -5, D: -10 }
/** Pre-change offer formula: deliberately contains no renewal floor logic. */
function formula(state: GameState, tid: string, kind: Deal['kind'], grade: Grade) {
  const me = state.me!, p = state.players[me.id], team = state.teams[tid]
  const d = tryoutSkill(state) - expectOf(team) + GRADE_DELTA[grade]
  const q = clamp((d + 10) / 26, 0, 1)
  const role: SquadRole = team.tier === 1
    ? (d >= 8 || (kind !== 'sign' && me.proven) ? 'starter' : 'rotation')
    : (d >= 8 ? 'star' : 'starter')
  const raw = expectedSalary(p, team.tier) * ROLE_PAY[role] * (0.7 + 0.6 * q) * (kind === 'renew' ? 1.05 : 1)
  return { ...offerOf(team, state.year, raw), role }
}
function makeState(region: Region, year: 2021 | 2026) {
  const state = createCareer({ name: '续约保护验收', region, role: '控场', year, start: 't1', originKey: 'netcafe', talents: emptyTalents(), seed: 42 })
  const me = state.me!, p = state.players[me.id], team = state.teams[state.myTeam]
  assert.equal(me.phase, 'pro'); assert.equal(team.tier, 1); assert.equal(p.teamId, team.id)
  for (const k of ATTR_KEYS) p.attrs[k] = 80
  recomputeOverall(p); me.proven = true; p.contract.promisedRole = 'starter'
  team.starters = [me.id, ...team.roster.filter((id) => id !== me.id)].slice(0, 5)
  assert.equal(team.starters.length, 5); assert.ok(team.starters.includes(me.id))
  const band = payBand(team.region, team.tier, year)
  const salary = roundPay(band.cap * 0.8, band.cur)
  me.pay = { cur: band.cur, salary, sign: 0, buyout: 0, year, tier: team.tier }
  p.salary = toUsd(salary, band.cur, year)
  return state
}
/** The real makeDeal consumes exactly these three RNG draws in this order. */
function checkedDeal(state: GameState, tid: string, kind: Deal['kind'] = 'renew', grade: Grade = 'B') {
  const rng = new Rng(42), expected = new Rng(42), tier = state.teams[tid].tier
  const deal = makeDeal(state, tid, kind, grade, rng)
  const years = tier === 1 ? (expected.chance(0.5) ? 2 : 3) : (expected.chance(0.6) ? 1 : 2)
  assert.equal(deal.years, years)
  assert.equal(deal.signBonus, roundPay(deal.salary * expected.range(0, 0.3), deal.cur))
  assert.equal(deal.buyout, roundPay(deal.salary * (tier === 1 ? expected.range(4, 8) : expected.range(2, 4)), deal.cur))
  assert.equal(rng.state, expected.state, 'renewal floor must not consume/reorder RNG')
  return deal
}
let cases = 0, protectedCases = 0, negativeCases = 0
const currencies = new Set<string>()
for (const region of ['Europe', 'China', 'Korea', 'North America'] satisfies Region[]) {
  for (const year of [2021, 2026] as const) {
    const state = makeState(region, year), me = state.me!, tid = state.myTeam, team = state.teams[tid]
    const base = formula(state, tid, 'renew', 'B'), current = payOf(state)!
    const protectedSalary = keepInBand(team, year, convert(current.salary, current.cur, base.cur, year))
    const deal = checkedDeal(state, tid)
    assert.equal(deal.salary, Math.max(base.salary, protectedSalary)); assert.equal(deal.role, base.role)
    if (deal.salary > base.salary) protectedCases++
    currencies.add(deal.cur); cases++
    const negatives: [string, (s: GameState) => void][] = [
      ['not starting', s => { s.teams[tid].starters = s.teams[tid].starters.filter(id => id !== me.id) }],
      ['bench promise', s => { s.players[me.id].contract.promisedRole = 'bench' }],
      ['rotation promise', s => { s.players[me.id].contract.promisedRole = 'rotation' }],
      ['star demoted to starter', s => { s.players[me.id].contract.promisedRole = 'star' }],
      ['old tier differs', s => { s.me!.pay!.tier = 2 }],
      ['not current club', s => { s.myTeam = '' }],
      ['player belongs elsewhere', s => { s.players[me.id].teamId = null }],
      ['free agent', s => { s.me!.phase = 'free' }],
    ]
    for (const [name, mutate] of negatives) {
      const clone = structuredClone(state); mutate(clone)
      assert.equal(checkedDeal(clone, tid).salary, formula(clone, tid, 'renew', 'B').salary, `${region}/${year}: ${name}`)
      negativeCases++
    }
    for (const kind of ['sign', 'transfer'] as const) assert.equal(checkedDeal(state, tid, kind).salary, formula(state, tid, kind, 'B').salary)
    // Real legacy fallback: absent written pay is reconstructed from p.salary.
    const old = structuredClone(state); delete old.me!.pay
    const oldPay = payOf(old)!
    assert.equal(checkedDeal(old, tid).salary, Math.max(base.salary, keepInBand(team, year, oldPay.salary)))
    // Imported terms in a different currency must not be mistaken for a local
    // amount. payOf intentionally reconciles such stale terms with USD salary.
    const foreign = structuredClone(state), foreignCur = base.cur === 'USD' ? 'EUR' : 'USD'
    foreign.me!.pay = { ...current, cur: foreignCur, salary: roundPay(convert(current.salary, current.cur, foreignCur, year), foreignCur) }
    const reconciled = payOf(foreign)!
    assert.equal(reconciled.cur, base.cur)
    assert.equal(checkedDeal(foreign, tid).salary, Math.max(base.salary, keepInBand(team, year, reconciled.salary)))
    // Current salary above the band is capped, never propagated as an outlier.
    const high = structuredClone(state), band = payBand(team.region, team.tier, year)
    high.me!.pay!.salary = roundPay(band.cap * 2, band.cur); high.players[me.id].salary = toUsd(high.me!.pay!.salary, band.cur, year)
    assert.equal(checkedDeal(high, tid).salary, band.cap)
    // A low current salary does not replace the higher normal offer.
    const low = structuredClone(state)
    low.me!.pay!.salary = band.floor; low.players[me.id].salary = toUsd(band.floor, band.cur, year)
    assert.equal(checkedDeal(low, tid).salary, base.salary)
    console.log(`PASS ${region}/${year} actual club=${team.name} region=${team.region} ${deal.cur} normal=${base.salary} renewal=${deal.salary}; 8 negative gates, sign/transfer, old-save/currency, low/cap, RNG`)
  }
}
assert.equal(cases, 8, 'all four regions × two years must run, never skip failed fixtures')
assert.ok(protectedCases > 0, 'at least one case must exercise the protection, not only the unmodified formula')
assert.equal(negativeCases, 64)
assert.deepEqual([...currencies].sort(), ['CNY', 'EUR', 'KRW', 'USD'])
console.log(`PASS renewal: ${cases}/8 real cases, protection exercised ${protectedCases}/8, ${negativeCases} negative gates, all 4 currencies and RNG order`)
