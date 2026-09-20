/** Regression: training -> a purchase -> undo used to refund cash but keep the purchase. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { doAction, undoAction, undoWeek } from '../src/engine/me/week'
import { canUndo } from '../src/engine/me/undo'
import { buyCourse, buyGear, buyLifestyle, buyRelax, hireAgent } from '../src/engine/me/shop'
import { buyStudio, fundScholar, holdMeet, openCafe, setFamily, takeBreak } from '../src/engine/me/outlets'
import { packState, unpackState } from '../src/engine/save'
import type { GameState } from '../src/engine/types'

const base = createCareer({ name: '经济撤回', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7 })
base.me!.money = 3_000_000
base.me!.fans = 3000
base.me!.ap = base.me!.apMax
// The season is over for this fixture: no time advancement or simulation is needed.
base.fixtures = []
base.comps = {}

const whole = (s: GameState): string => {
  const copy = structuredClone(s)
  delete copy.me!.weekStart
  return packState(copy)
}

const cases: [string, (s: GameState) => string | null][] = [
  ['外设', s => buyGear(s, 'mouse')],
  ['语言课', s => buyCourse(s, 'lang')],
  ['理疗', s => buyRelax(s, 'physio')],
  ['公寓', s => buyRelax(s, 'flat')],
  ['买房', s => buyLifestyle(s, 'home')],
  ['经纪人', s => hireAgent(s, 1)],
  ['寄钱安排', s => setFamily(s, 1)],
  ['见面会', s => holdMeet(s, 'small')],
  ['奖学金', fundScholar],
  ['带家人旅行', s => takeBreak(s, 'family')],
  ['回家休假', s => takeBreak(s, 'home')],
  ['直播间', buyStudio],
  ['网咖', openCafe],
]
for (const [label, purchase] of cases) {
  const s = structuredClone(base)
  assert.equal(doAction(s, 'aim'), null, `${label}: training allowed`)
  assert.equal(purchase(s), null, `${label}: purchase allowed`)
  assert.equal(canUndo(s, 'aim'), false, `${label}: earlier training sealed`)
  const paid = whole(s)
  assert.notEqual(undoAction(s, 'aim'), null, `${label}: cannot refund through one action`)
  assert.deepEqual(undoWeek(s), [], `${label}: cannot refund through whole week`)
  assert.equal(whole(s), paid, `${label}: cash, ledger and purchase all unchanged`)
  // The seal survives saving. New training can still be taken off without touching the purchase.
  const loaded = unpackState(packState(s))
  const afterLoad = whole(loaded)
  assert.equal(canUndo(loaded, 'aim'), false, `${label}: seal survives reload`)
  assert.equal(doAction(loaded, 'vod'), null, `${label}: later training allowed`)
  assert.equal(undoAction(loaded, 'vod'), null, `${label}: later training remains reversible`)
  assert.equal(whole(loaded), afterLoad, `${label}: later rewind retains complete purchase`)
  console.log(`✓ ${label}`)
}

for (const [label, purchase] of cases.filter(([label]) => !['寄钱安排', '回家休假'].includes(label))) {
  const s = structuredClone(base)
  s.me!.money = 0
  assert.equal(doAction(s, 'aim'), null)
  const before = whole(s)
  assert.notEqual(purchase(s), null, `${label}: unaffordable purchase refused`)
  assert.equal(canUndo(s, 'aim'), true, `${label}: refused purchase must not seal training`)
  assert.equal(whole(s), before, `${label}: refused purchase changes nothing`)
  assert.equal(undoAction(s, 'aim'), null)
}
console.log('✓ 13 economic operations seal only on success; failed purchases preserve undo.')
