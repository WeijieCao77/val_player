// DeepSeek test structure, reviewed to use actual GameState fixtures and independent pre-refactor arithmetic.
import assert from 'node:assert/strict'
import { fanCap, fanOutlook, fanWeek, fansWan } from '../src/engine/me/fans'
import { traitMul } from '../src/engine/me/traits'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { GameState } from '../src/engine/types'

const memory = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, String(v)), removeItem: (k: string) => memory.delete(k), clear: () => memory.clear(), key: (i: number) => [...memory.keys()][i] ?? null, get length() { return memory.size } },
  fetch: () => Promise.reject(new Error('offline test: network forbidden')),
})
const original = createCareer({ name: '测试', region: 'Europe', role: '控场', year: 2026, start: 'pre', originKey: 'netcafe', seed: 125, talents: emptyTalents() })
const wan = (value: number) => Math.pow(Math.max(0, value), 1.548) / 551

function check(state: GameState) {
  const me = state.me!, before = JSON.stringify(state), expected = structuredClone(state), cap = fanCap(state)
  // Frozen original fanWeek formula from a78c6c2; do not derive the expectation from fanOutlook.
  let rate = (me.phase === 'pro' ? 0.012 : 0.055) + Math.min(0.045, Math.max(0, me.heat / 900))
  rate *= traitMul(me, 'fan')
  if (me.stream.deal) rate *= 1.25
  const gap = cap - me.fans, next = Math.max(0, me.fans + gap * (gap > 0 ? rate : 0.02)), delta = next - me.fans
  const outlook = fanOutlook(state)
  assert.deepEqual(outlook, { cap, next, delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', deltaWan: wan(next) - wan(me.fans) })
  assert.equal(JSON.stringify(state), before, 'fanOutlook must be read-only')
  expected.me!.fans = next; expected.me!.heat = Math.max(0, me.heat * 0.90)
  fanWeek(state)
  assert.deepEqual(state, expected, 'fanWeek changes only fans and heat, exactly as before refactor')
}
let cases = 0
for (const phase of ['pre', 'pro'] as const) for (const abroad of [false, true]) for (const stream of [false, true]) {
  const base = structuredClone(original), me = base.me!
  me.phase = phase; me.abroad = abroad
  me.stream.deal = stream ? { platform: 'test', club: false, guarantee: 1000, clubCut: 0, minPerStage: 2, untilYear: 2028 } : undefined
  const cap = fanCap(base)
  for (const fans of [0, cap, cap * 1.2]) for (const heat of [0, 40, 90, 500]) {
    const state = structuredClone(base); state.me!.fans = fans; state.me!.heat = heat
    check(state); cases++
  }
}
assert.equal(cases, 96)
for (const trait of ['edge', 'glue', 'star']) {
  const state = structuredClone(original); state.me!.traits = [trait]; state.me!.fans = 0; state.me!.heat = 40; check(state)
}

// Deliberately extreme constructed reachability, NOT a natural-career or difficulty claim.
const extreme = structuredClone(original), me = extreme.me!
me.titles = Array.from({ length: 20 }, (_, i) => ({ year: 2026 + i, title: 'Champions', started: true }))
me.pre.cups = Array.from({ length: 40 }, (_, i) => ({ key: `test${i}`, year: 2026 + Math.floor(i / 2), reached: 3, rounds: 3, won: true, prize: 0, results: [] }))
me.pre.ladderPeak = 100; me.seasonStart.starts = 200; me.seasons = []
me.fans = 0; me.heat = 0; me.phase = 'pro'; me.abroad = false; me.stream.deal = undefined
const capWan = fansWan(fanCap(extreme))
assert.ok(capWan > 1000, `extreme cap must exceed 1000万, got ${capWan}`)
assert.ok(fansWan(3500) < 1000, '3500 internal fan points are not 1000万 people')
let weeks = 0
while (fansWan(me.fans) <= 1000 && weeks < 1000) { fanWeek(extreme); weeks++ }
assert.ok(fansWan(me.fans) > 1000, 'real fanWeek must cross 1000万 within the constructed bound')
console.log(`PASS fans: ${cases} formula cases + 3 traits, pure reads, only fans/heat mutation; extreme fixture crossed 1000万 in ${weeks} weeks (cap ${capWan.toFixed(2)}万, reached ${fansWan(me.fans).toFixed(2)}万); not a natural-career claim`)
