// DeepSeek test matrix; audited API names, switch branches and pre/post snapshots.
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { pitchOdds, pitchExplanation, NEVPRO_TOP } from '../src/engine/me/selfpitch'
import type { PitchOdds } from '../src/engine/me/selfpitch'

const memory = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, String(v)), removeItem: (k: string) => memory.delete(k), clear: () => memory.clear(), key: (i: number) => [...memory.keys()][i] ?? null, get length() { return memory.size } },
  fetch: () => Promise.reject(new Error('offline test: network forbidden')),
})
const state = createCareer({ name: '测试', region: 'Europe', role: '控场', year: 2026, start: 'pre', originKey: 'netcafe', seed: 125, talents: emptyTalents() })
const team = Object.values(state.teams).find(t => t.tier === 1)
assert.ok(team, 'actual tier-one team required')
const mate = state.players[team.roster[0]]
assert.ok(mate, 'actual roster player required')
mate.ign = 'Player123'; mate.overall = 87
const stateBefore = JSON.stringify(state), baseline = structuredClone(pitchOdds(state, team))
assert.equal(JSON.stringify(state), stateBefore, 'baseline odds read must not alter state')
let cases = 0
for (const gap of [-3, 0, 3]) for (const kind of ['hole', 'beat', 'place', null] as const)
for (const nevpro of [false, true]) for (const budget of [{ fee: 0, short: false }, { fee: 100, short: false }, { fee: 100, short: true }])
for (const numeric of [false, true]) {
  const o: PitchOdds = { ...structuredClone(baseline), gap, skill: baseline.expect + gap, need: kind === 'hole' ? { kind } : { kind, mate: structuredClone(mate) }, nevpro, ...budget }
  const before = JSON.stringify(o), lines = pitchExplanation(o, numeric), text = lines.join('\n')
  assert.ok(lines.length >= 3)
  assert.match(lines[0], /门槛跟首发不是一条线/)
  if (kind !== 'hole') assert.match(lines[0], /Player123/)
  else { assert.doesNotMatch(lines[0], /Player123/); assert.match(lines[0], /没有同位置首发/) }
  assert.match(lines[1], gap > 0 ? /高出.*加分/ : gap < 0 ? /还差.*减分/ : /正好/)
  if (numeric && gap !== 0) assert.ok(lines[1].includes(`${Math.abs(gap)} 点`))
  if (!numeric) { assert.doesNotMatch(text, /%|3 点/); if (kind !== 'hole') assert.match(text, /Player123/) }
  if (kind === 'hole') assert.match(lines[2], /缺少这个位置.*补缺/)
  else if (kind === 'beat') assert.match(lines[2], /比他们现在的首发强.*并不保证录取/)
  else if (kind === 'place') { assert.match(lines[2], /名单还没满六人/); assert.doesNotMatch(text, /87/) }
  else assert.match(lines[2], /没有明显的岗位需求.*不会加分/)
  if (nevpro) assert.ok(numeric ? text.includes(`${NEVPRO_TOP}%`) : text.includes('把握上限'))
  else assert.doesNotMatch(text, /从未打过职业|把握上限|%/)
  if (budget.short) { assert.match(text, /付不起.*大幅降低/); assert.doesNotMatch(text, /付得起/) }
  else if (budget.fee > 0) { assert.match(text, /付得起/); assert.doesNotMatch(text, /付不起/) }
  else assert.doesNotMatch(text, /违约金/)
  assert.equal(JSON.stringify(o), before, 'explanation must not mutate its odds/need/player object')
  assert.equal(JSON.stringify(state), stateBefore, 'explanation must not mutate career')
  assert.deepEqual(pitchOdds(state, team), baseline, 'real odds remain identical to pre-test result')
  cases++
}
assert.equal(cases, 144)
console.log(`PASS pitch explanation: ${cases} gap/need/never-pro/budget/number branches, digit-bearing names preserved, inputs/state/real odds unchanged`)
