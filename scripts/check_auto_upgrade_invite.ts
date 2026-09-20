/** Targeted invitation policy checks only; no career simulation. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoResolve } from '../src/engine/me/auto'
import { push } from '../src/engine/me/pending'
import { windowAt } from '../src/engine/me/window'
import { windowRoll } from '../src/engine/me/transfer'
import { Rng } from '../src/engine/rng'
import { regionIn } from '../src/engine/era'
import { eventsOf } from '../src/engine/circuit'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear() {}, key: () => null, length: 0 },
  fetch: () => Promise.reject(new Error('offline')),
})
const base = createCareer({ name: 'Upgrade', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7001, year: 2026 })
const targetId = Object.values(base.teams).find(t => t.tier === 1 && regionIn(t.region, base.year) === 'EMEA' && !t.dormant)!.id
const inviteId = 'test:upgrade'
function fresh(): GameState {
  const s = structuredClone(base)
  const me = s.me!
  me.pending = []; me.deals = []; me.pre.invites = []; me.declined = []
  me.tryout = undefined
  s.teams[s.myTeam].tier = 2
  s.teams[s.myTeam].rating = 90
  s.teams[targetId].rating = 85
  s.players[me.id].overall = 84
  me.pre.tac = 0
  return s
}
function invite(s: GameState, id = targetId): void {
  s.me!.pre.invites.push({ id: inviteId, teamId: id, via: 'scout', day: s.day, expires: s.day + 14, direct: false })
  push(s, { kind: 'invite', id: inviteId })
}
function answer(s: GameState): void {
  autoResolve(s, { kind: 'invite', id: inviteId, day: s.day })
}
function rejected(s: GameState): void {
  assert.equal(s.me!.tryout, undefined)
  assert.equal(s.me!.pre.invites.length, 0)
  assert.equal(s.me!.pending.some(p => p.kind === 'invite'), false)
  assert.equal(s.me!.deals.length, 0)
}
function drawCalendar(s: GameState): void {
  // Mirror real event seeds, as check_window does, without playing any match.
  s.comps = {}
  for (const e of eventsOf(s.year)) {
    if (e.projected || e.start == null || e.end == null) continue
    const seeds = e.seeds.map(v => s.teams[`V21T${v}`] ? `V21T${v}` : null)
    const key = `ev:${e.id}`
    s.comps[key] = { key, name: e.cn, stage: e.stage ?? 'offseason', teams: [...new Set(seeds.filter((v): v is string => !!v))], standings: {}, finished: [], format: 'circuit', circuit: { id: e.id, start: e.start, end: e.end, seeds, mode: 'history' } }
  }
}
let bad = 0
function test(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) }
  catch (e) { bad++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`) }
}
test('tier2 → tier1 is worth a tryout even when target rating is lower; no automatic contract', () => {
  const s = fresh(); const from = s.myTeam; invite(s); answer(s)
  assert.equal(s.me!.tryout?.teamId, targetId)
  assert.equal(s.myTeam, from)
  assert.equal(s.me!.deals.length, 0)
  assert.equal(s.me!.declined.some(x => x.team === targetId), false)
})
test('skill gap still rejects the upgrade', () => {
  const s = fresh(); s.players[s.me!.id].overall = 10; invite(s); answer(s); rejected(s)
})
for (const [label, fromTier, toTier] of [['same-tier', 2, 2], ['downgrade', 1, 2]] as const) {
  test(`${label} lower rating still rejects`, () => {
    const s = fresh(); s.teams[s.myTeam].tier = fromTier; s.teams[targetId].tier = toTier
    invite(s); answer(s); rejected(s)
  })
}
test('same-tier +2 improvement still accepts a tryout', () => {
  const s = fresh(); s.teams[s.myTeam].rating = 80; s.teams[targetId].tier = 2; s.teams[targetId].rating = 82
  invite(s); answer(s); assert.equal(s.me!.tryout?.teamId, targetId)
})
for (const variant of ['missing', 'dormant', 'own-club'] as const) {
  test(`invalid ${variant} target closes safely`, () => {
    const s = fresh()
    // Isolate target validity from the ordinary rating filter.
    s.teams[s.myTeam].rating = 80
    if (variant === 'missing') delete s.teams[targetId]
    if (variant === 'dormant') s.teams[targetId].dormant = true
    invite(s, variant === 'own-club' ? s.myTeam : targetId); answer(s); rejected(s)
  })
}
test('stale invitation card closes safely', () => {
  const s = fresh(); push(s, { kind: 'invite', id: inviteId }); answer(s); rejected(s)
})
test('failed upgrade tryout does not create a contract', () => {
  const s = fresh(); const from = s.myTeam; invite(s); answer(s)
  assert.ok(s.me!.tryout)
  s.me!.tryout.score = -100
  autoResolve(s, { kind: 'tryout', id: inviteId, day: s.day })
  assert.equal(s.me!.tryout, undefined); assert.equal(s.me!.deals.length, 0); assert.equal(s.myTeam, from)
})
test('open-window invitation cannot force registration after a roster lock begins', () => {
  const s = fresh(); const from = s.myTeam
  drawCalendar(s)
  // Read the actual calendar without advancing any match or career.
  let open = -1; let locked = -1
  for (let day = 0; day < 364; day++) {
    s.day = day
    const w = windowAt(s, targetId)
    if (w.open && open < 0) open = day
    if (open >= 0 && day > open && w.lock) { locked = day; break }
  }
  assert.ok(open >= 0 && locked > open, 'fixture needs a real open day followed by a real roster lock')
  s.day = open; invite(s); answer(s); assert.ok(s.me!.tryout)
  s.me!.tryout.score = 100
  autoResolve(s, { kind: 'tryout', id: inviteId, day: s.day })
  const deal = s.me!.deals.find(d => d.teamId === targetId)
  assert.ok(deal, 'passed trial must offer terms, not sign directly')
  assert.equal(s.myTeam, from)
  s.day = locked
  assert.ok(windowAt(s, targetId).lock)
  autoResolve(s, { kind: 'deal', id: deal.id, day: s.day })
  assert.equal(s.myTeam, from)
  assert.equal(s.me!.moveAfter?.deal.teamId, targetId)
})
test('closed player window still prevents new windowRoll invitations', () => {
  const s = fresh()
  drawCalendar(s)
  let locked = false
  for (let day = 0; day < 364; day++) {
    s.day = day
    if (!windowAt(s, undefined, false).open) { locked = true; break }
  }
  assert.ok(locked)
  assert.equal(windowRoll(s, new Rng(1), 'week', 'vct'), 0)
  assert.equal(s.me!.pre.invites.length, 0)
})
if (bad) process.exit(1)
console.log('PASS invitation upgrade policy and existing skill/trial/window guards')
