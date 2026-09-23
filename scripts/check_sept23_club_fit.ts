import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { clubWindow } from '../src/engine/me/club'
import { markClubDeparture } from '../src/engine/me/clubDepartures'
import { Rng } from '../src/engine/rng'
import { ATTR_KEYS, ROLES, type GameState, type Player, type Role } from '../src/engine/types'

Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline')) })

const clone = <T>(x: T): T => structuredClone(x)

function fixture(seed = 1) {
  const s = createCareer({
    name: '俱乐部适配核查',
    region: 'Europe',
    role: '控场',
    talents: emptyTalents(),
    originKey: 'netcafe',
    start: 'pre',
    seed,
    year: 2021
  })
  const me = s.me!
  const mine = s.players[me.id]
  // Force my team to a 2021 Europe team
  const team = Object.values(s.teams).find(t => !t.dormant && t.region === 'Europe' && t.roster.length >= 5)!
  assert.ok(team)
  s.myTeam = team.id
  mine.teamId = team.id
  mine.region = 'Europe'
  mine.nat = 'de'
  for (const k of ATTR_KEYS) mine.attrs[k] = 80
  me.phase = 'pro'
  me.coachTrust = 100
  me.gmTrust = 100
  me.fans = 20000
  me.titles = Array.from({ length: 8 }, () => ({ year: s.year, title: 'Champions', started: true }))

  // Release all old roster safely
  for (const p of Object.values(s.players)) {
    if (p.teamId === team.id) {
      p.teamId = null
      p.retiring = true
    }
  }
  team.roster = [mine.id]
  team.starters = [mine.id]

  // Create exact 6-man roster: me (控场), 4 cloned starters with roles 决斗者/先锋/哨卫/自由人, one bench 决斗者
  const template = Object.values(s.players).find(p => p.teamId === null && p.id !== mine.id)!
  const roles: Role[] = ['决斗者', '先锋', '哨卫', '自由人', '决斗者']
  const mateIds: string[] = []
  for (let i = 0; i < 5; i++) {
    const p = clone(template)
    p.id = `CLUB_FIT_MATE_${i}`
    p.ign = `队友${i}`
    p.teamId = team.id
    p.retiring = false
    p.nat = 'de'
    p.region = 'Europe'
    p.age = 25
    p.role = roles[i]
    p.roles = [roles[i]]
    p.overall = 80
    p.salary = 1000
    p.contractYears = 2
    for (const k of ATTR_KEYS) p.attrs[k] = 60
    s.players[p.id] = p
    mateIds.push(p.id)
  }
  // Special: make the 先锋 mate weak (overall 45) to trigger weakness for 先锋 role
  const weakPioneer = s.players[mateIds[1]]
  weakPioneer.overall = 45
  weakPioneer.attrs = { ...weakPioneer.attrs, ...Object.fromEntries(ATTR_KEYS.map(k => [k, 20])) }

  mine.teamId = team.id
  mine.retiring = false
  mine.overall = 80
  mine.salary = 1000
  mine.contractYears = 2
  for (const k of ATTR_KEYS) mine.attrs[k] = 80
  mine.role = '控场'
  mine.roles = ['控场']

  team.roster = [mine.id, ...mateIds]
  team.starters = [mine.id, ...mateIds.slice(0, 4)]
  team.rating = 80
  team.budget = 10000000
  s.players[mine.id] = mine

  for (const p of Object.values(s.players)) if (!p.teamId && p.id !== me.id) p.retiring = true
  // Candidate: clone of actual template, primary role 哨卫, roles ['哨卫','先锋']
  const candidate = clone(template)
  candidate.id = 'CLUB_FIT_CANDIDATE'
  candidate.ign = '候选人'
  candidate.teamId = null
  candidate.retiring = false
  candidate.nat = 'de'
  candidate.region = 'Europe'
  candidate.age = 25
  candidate.role = '哨卫'
  candidate.roles = ['哨卫', '先锋']
  candidate.overall = 52
  candidate.potential = 52
  candidate.ambition = 50
  candidate.salary = 1000
  candidate.contractYears = 0
  for (const k of ATTR_KEYS) candidate.attrs[k] = 30
  s.players[candidate.id] = candidate

  // Set actual import limit and two existing imports to exercise importBlock
  s.importLimit = false
  const existingImports = mateIds.slice(0, 2)
  for (const id of existingImports) {
    s.players[id].nat = 'us'
  }

  return { state: s, team, candidate }
}

function callClubWindow(s: GameState, rng: Rng) {
  const before = clone(s)
  clubWindow(s, rng)
  return { before, after: s }
}

const bug = process.argv.includes('--expect-bug')

// Primary positive bug: candidate roles include 先锋 but p.role !== 先锋, so old code would not consider, new should.
for (let i = 1; i <= 12; i++) {
  const seed = i * 1000 + 1
  const { state, team, candidate } = fixture(seed)
  const rng = new Rng(seed)
  const gate = rng.chance(0.5)
  const { before, after } = callClubWindow(state, new Rng(seed))

  if (bug) {
    // Before fix expected: secondary false for all, primary positive === gate
    assert.equal(after.teams[after.myTeam].roster.includes(candidate.id), false, `Seed ${seed}: bug expected no signing`)
    // Also check if gate was true, then old code would have considered primary and maybe signed someone else, but not this candidate.
  } else {
    // After fix: signed === gate (if gate true, candidate should be signed; if false, not)
    assert.equal(after.teams[after.myTeam].roster.includes(candidate.id), gate, `Seed ${seed}: fixed behavior mismatch`)
  }
}

// Paired positive control and the insolvent cheap-signing regression.
for(let i=1;i<=12;i++){
  const seed=i*1000+1, gate=new Rng(seed).chance(.5)
  for(const budget of [10_000_000,0,3601]){
    const {state,team,candidate}=fixture(seed)
    candidate.role='先锋';candidate.roles=['先锋'];team.budget=budget
    clubWindow(state,new Rng(seed))
    assert.equal(candidate.teamId===team.id, budget>40_000?gate:(bug&&gate), `primary/budget=${budget} seed=${seed}`)
  }
}
// Ensure at least one seed with gate true and one with gate false
{
  const gates = Array.from({ length: 12 }, (_, i) => {
    const seed = (i + 1) * 1000 + 1
    return new Rng(seed).chance(0.5)
  })
  assert.ok(gates.includes(true) && gates.includes(false), 'Need both gate outcomes')
}

// Negative tests using verified gate seed 1001 (gate true)
const gateSeed = 1001
const gate = new Rng(gateSeed).chance(0.5)
assert.equal(gate, true, 'Seed 1001 gate should be true')

// Negative: annual flag prevents signing
{
  const { state } = fixture(gateSeed)
  state.me!.flags.clubSigned = state.year
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'Annual flag should block')
}

// Negative: protected primary role (控场) with roles ['控场','先锋'] should not be considered
{
  const { state, candidate } = fixture(gateSeed)
  candidate.role = '控场'
  candidate.roles = ['控场', '先锋']
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.equal(state.teams[state.myTeam].roster.includes(candidate.id), false, 'Protected role should not sign')
}

// Negative: recent departure via markClubDeparture
{
  const { state, candidate } = fixture(gateSeed)
  markClubDeparture(state, state.teams[state.myTeam].id, candidate.id)
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'Recent departure should block')
}

// Negative: import limit with two imports
{
  const { state, candidate } = fixture(gateSeed)
  state.importLimit = true
  candidate.nat = 'us' // candidate would be third import
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'Import limit should block')
}

// Negative: candidate retiring
{
  const { state, candidate } = fixture(gateSeed)
  candidate.retiring = true
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'Retiring candidate should block')
}

// Negative: no shortfall for weak starter (team rating 80, weak starter 80 => not weak)
{
  const { state, team } = fixture(gateSeed)
  // Set weak pioneer back to 80 so no weak role
  const weakPioneer = Object.values(state.players).find(p => p.id.startsWith('CLUB_FIT_MATE_1'))!
  weakPioneer.overall = 80
  weakPioneer.attrs = { ...weakPioneer.attrs, ...Object.fromEntries(ATTR_KEYS.map(k => [k, 60])) }
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'No weak role should block')
}

// A strong candidate still needs an affordable salary.
{
  const { state, candidate } = fixture(gateSeed)
  candidate.overall = 99
  candidate.potential = 99
  candidate.role = '哨卫'
  candidate.roles = ['哨卫', '先锋']
  state.teams[state.myTeam].budget = 500000
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.deepEqual(state.teams[state.myTeam].roster, before.teams[before.myTeam].roster, 'Budget scarce should block')
}

// A candidate whose primary role is the protagonist's remains protected.
{
  const { state, candidate } = fixture(gateSeed)
  candidate.role = '控场'
  candidate.roles = ['控场', '先锋']
  const before = clone(state)
  clubWindow(state, new Rng(gateSeed))
  assert.equal(state.teams[state.myTeam].roster.includes(candidate.id), false, 'Own role should never sign')
}


if (bug) {
  console.log('REPRODUCED: clubWindow only considers p.role, so candidates with role in p.roles but different primary role are never signed.')
} else {
  console.log('PASS sept23 club fit: includes role check with protagonist guard, 12-seed paired controls, role/import/cooldown/quota and no-budget guards.')
}
