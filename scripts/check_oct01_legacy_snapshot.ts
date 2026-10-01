import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import frozen from '../src/data/npc_legacy_shifts.json'
import { legacyRulerShift, legacyRegionalRulerShift } from '../src/engine/npcLegacyRuler'

// The snapshot was compared to every output of the published algorithm BEFORE
// removing a roster member. Old-save baselines must not follow later populations.
let count = 0
for (const [year, entries] of Object.entries(frozen.years)) {
  assert.ok(!Object.hasOwn(entries, '4710'), 'removed player has no stored calibration row')
  for (const [id, [total, regional]] of Object.entries(entries)) {
    assert.equal(legacyRulerShift(+year, id), total)
    assert.equal(legacyRegionalRulerShift(+year, id), regional)
    assert.ok(Number.isInteger(total) && total >= -99 && total <= 99)
    assert.ok(Number.isInteger(regional) && regional >= -4 && regional <= 0)
    count++
  }
}
assert.equal(count, 11076)
assert.equal(createHash('sha256').update(JSON.stringify(frozen.years)).digest('hex'), '369b167bcf285d6024674fa914e9e9f347167f78e6449d9b57b12803cffa9b00', 'all surviving pre-removal values are immutable')
console.log('PASS immutable old NPC shifts: all surviving published total and regional deltas retained')
