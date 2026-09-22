// DeepSeek regression draft, repaired to use real players and strict assertions.
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { coachView, duelTarget } from '../src/engine/me/coach'
import { duelRelation } from '../src/engine/me/duelRead'
import type { GameState, Player } from '../src/engine/types'

// Frozen old selection policy, independent of the new presentation helper.
function previousTarget(state: GameState): Player | null {
  const me = state.me!
  const starters = state.teams[state.myTeam].starters.filter(id => id !== me.id).map(id => state.players[id]).filter((p): p is Player => !!p)
  const same = starters.filter(p => (p.roles ?? [p.role]).includes(state.players[me.id].role) && !p.isIgl)
  return (same.length ? same : starters.filter(p => !p.isIgl)).sort((a, b) => coachView(state, a) - coachView(state, b))[0] ?? null
}
const original = createCareer({ name: '对位核查', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
for (const scenario of ['same', 'secondary', 'cross', 'protected', 'all-igl', 'current-role', 'weakest', 'empty'] as const) {
  const state = structuredClone(original), me = state.me!, mine = state.players[me.id], team = state.teams[state.myTeam]
  const ids = team.roster.filter(id => id !== me.id).slice(0, 5)
  assert.equal(ids.length, 5)
  team.starters = [...ids]
  const players = ids.map(id => state.players[id])
  for (const p of players) { p.role = '控场'; p.roles = ['控场']; p.isIgl = false; p.injuredUntil = 0 }
  const first = players[0]
  if (scenario === 'same' || scenario === 'weakest') { first.role = '决斗者'; first.roles = ['决斗者'] }
  if (scenario === 'secondary') { first.role = '先锋'; first.roles = ['先锋', '决斗者'] }
  if (scenario === 'protected') { first.role = '决斗者'; first.roles = ['决斗者']; first.isIgl = true }
  if (scenario === 'all-igl') for (const p of players) p.isIgl = true
  if (scenario === 'empty') team.starters = []
  if (scenario === 'current-role') { mine.role = '先锋'; mine.roles = ['决斗者', '先锋']; first.role = '先锋'; first.roles = ['先锋'] }
  if (scenario === 'weakest') { players[1].role = '决斗者'; players[1].roles = ['决斗者']; players[1].overall = 40; first.overall = 99 }
  const before = JSON.stringify(state), target = duelTarget(state), expected = previousTarget(state)
  assert.equal(target?.id ?? null, expected?.id ?? null, `${scenario}: selection stays identical`)
  if (scenario === 'all-igl' || scenario === 'empty') assert.equal(target, null)
  else {
    assert.ok(target)
    const relation = duelRelation(state, target)
    const kind = scenario === 'secondary' ? 'secondary' : scenario === 'cross' || scenario === 'protected' ? 'cross' : 'same'
    assert.equal(relation.kind, kind, scenario)
    assert.equal(relation.label, kind === 'cross' ? '首发名额挑战' : '对位挑战')
    assert.ok(relation.explanation.includes(mine.role))
    if (scenario === 'protected') assert.notEqual(target.id, first.id)
    if (scenario === 'same' || scenario === 'secondary' || scenario === 'current-role') assert.equal(target.id, first.id)
    if (scenario === 'cross') assert.equal((target.roles ?? [target.role]).includes(mine.role), false, 'real old fallback is cross-position, not a same-role opponent')
  }
  assert.equal(JSON.stringify(state), before, `${scenario}: classification/selection reads do not mutate state`)
}
console.log('PASS duel relation: same, secondary, cross, IGL protection, all-IGL/empty, switched role, unchanged selection and no mutation')
