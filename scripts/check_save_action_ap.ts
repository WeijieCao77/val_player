/** Save/load must not refund actions already executed by the instant board.
 * npx tsx scripts/check_save_action_ap.ts (single-repository, no career simulation)
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { doAction, undoAction, refundStalePlan } from '../src/engine/me/week'
import { migratePlayerSave } from '../src/engine/me/save'
import { sealWeek, weekStartSnap } from '../src/engine/me/undo'
import { packState, unpackState } from '../src/engine/save'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import type { GameState } from '../src/engine/types'

const mem = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } },
  fetch: () => Promise.reject(new Error('offline')),
})
const reload = (s: GameState) => migratePlayerSave(unpackState(packState(s)))
const base = reload(createCareer({ name: '读档行动点', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 701, year: 2026 }))
const fresh = () => structuredClone(base)
let bad = 0
function test(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) }
  catch (e) { bad++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`) }
}
test('instant action reload preserves full state, AP, XP, plan and undo history', () => {
  const s = fresh(); assert.equal(doAction(s, 'aim'), null)
  const expected = packState(s)
  const back = reload(s)
  assert.equal(back.me!.ap, s.me!.ap)
  assert.equal(packState(back) === expected, true)
  assert.equal(packState(reload(back)) === expected, true)
})
test('reload then undo still reverses the real action exactly once', () => {
  const s = fresh(); const before = packState(s)
  assert.equal(doAction(s, 'aim'), null)
  const back = reload(s)
  assert.equal(undoAction(back, 'aim'), null)
  delete back.me!.weekStart
  assert.equal(packState(back) === before, true)
  assert.notEqual(undoAction(back, 'aim'), null)
})
test('sealed executed action is not refunded when its undo snapshot is gone', () => {
  const s = fresh(); assert.equal(doAction(s, 'vod'), null); sealWeek(s)
  assert.equal(s.me!.weekStart, undefined)
  const back = reload(s)
  assert.equal(back.me!.ap, s.me!.ap)
  assert.equal(packState(back) === packState(s), true)
  assert.notEqual(undoAction(back, 'vod'), null)
})
for (const marker of ['absent', 'empty', 'duel-only', 'old-snapshot'] as const) {
  test(`genuine unexecuted old plan refunds once (${marker} marker)`, () => {
    const s = fresh(); const me = s.me!
    me.ap = 2; me.plan = { aim: 2, rest: 1, duel: 1 }
    delete me.weekDone; delete me.weekStart
    if (marker === 'empty') { me.weekDone = []; me.weekStart = weekStartSnap(s) }
    if (marker === 'duel-only') me.weekDone = ['duel']
    if (marker === 'old-snapshot') { me.weekStart = weekStartSnap(s); me.weekStart.week-- }
    const pBefore = JSON.stringify(s.players[me.id])
    refundStalePlan(s)
    assert.equal(me.ap, Math.min(me.apMax, 2 + 2 * ACTION_BY_KEY.aim.cost + ACTION_BY_KEY.rest.cost))
    assert.deepEqual(me.plan, { duel: 1 })
    assert.equal(JSON.stringify(s.players[me.id]), pBefore)
    const once = packState(s)
    refundStalePlan(s)
    assert.equal(packState(s), once)
  })
}
test('empty action history cannot disguise a real old plan from the full loader', () => {
  const s = fresh(); s.me!.ap = 2; s.me!.plan = { aim: 2 }; s.me!.weekDone = []
  const back = reload(s)
  assert.equal(back.me!.ap, 2 + 2 * ACTION_BY_KEY.aim.cost)
  assert.equal(back.me!.plan.aim, undefined)
  assert.equal(packState(reload(back)) === packState(back), true)
})
if (bad) process.exit(1)
console.log('PASS saved action AP and old-plan migration guards')
