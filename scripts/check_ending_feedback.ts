import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { retire, retirementTick } from '../src/engine/me/endings'
import { ENDING_FEEDBACK_FLAG, endingFeedbackReady, noteEndingFeedbackShown } from '../src/engine/me/endingFeedback'
import { Rng } from '../src/engine/rng'
import { WORLD_END } from '../src/engine/era'
import type { GameState } from '../src/engine/types'

const base = createCareer({ name: '结局反馈测试', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 7, year: 2022 })
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const cases: [string, (g: GameState) => void][] = [
  ['主动退役', g => retire(g, '主动退役测试', 'chose')],
  ['世界终点', g => { g.year = WORLD_END; retirementTick(g, new Rng(1)) }],
  ['四年未签约', g => { g.me!.pre.year = 4; retirementTick(g, new Rng(1)) }],
  ['两年自由人', g => { g.me!.phase = 'free'; g.me!.freeYears = 2; retirementTick(g, new Rng(1)) }],
  ['年龄上限', g => { g.players[g.me!.id].age = 33; retirementTick(g, new Rng(1)) }],
  ['年龄衰退', g => { g.me!.phase = 'pro'; g.players[g.me!.id].age = 30; retirementTick(g, { chance: () => true } as Rng) }],
]
for (const [label, trigger] of cases) {
  const g = clone(base); trigger(g)
  assert.equal(g.me!.phase, 'retired', label)
  assert.equal(g.me!.flags[ENDING_FEEDBACK_FLAG], 1, label)
  assert.equal(endingFeedbackReady(g), false, 'must wait for ending and all pending cards')
  assert.equal(noteEndingFeedbackShown(g), false, 'blocked card cannot consume prompt')
  const ending = clone(g.me!.ending), gameOver = g.gameOver
  g.me!.pending = []
  assert.equal(endingFeedbackReady(g), true)
  assert.equal(endingFeedbackReady(clone(g)), true, 'unshown prompt survives reload')
  assert.equal(noteEndingFeedbackShown(g), true)
  assert.equal(noteEndingFeedbackShown(g), false)
  assert.equal(endingFeedbackReady(clone(g)), false, 'shown prompt never repeats on reload')
  retire(g, '重复调用不应重新排队')
  assert.equal(g.me!.flags[ENDING_FEEDBACK_FLAG], 2)
  assert.deepEqual(g.me!.ending, ending); assert.equal(g.gameOver, gameOver)
}
const old = clone(base)
retire(old, '旧结局')
delete old.me!.flags[ENDING_FEEDBACK_FLAG]; old.me!.pending = []
assert.equal(endingFeedbackReady(old), false, 'existing finished careers are not retroactively interrupted')
retire(old, '重复旧结局')
assert.equal(old.me!.flags[ENDING_FEEDBACK_FLAG], undefined)
assert.equal(endingFeedbackReady(base), false)
assert.equal(noteEndingFeedbackShown(base), false)
console.log('PASS ending feedback: all 6 retirement routes, ending first, unshown reload, shown once, old saves quiet, verdict unchanged.')
