import assert from 'node:assert/strict'
import { eventsOf } from '../src/engine/circuit'
import { stageNameIn } from '../src/engine/era'
import { FUTURE_CUP_NAME, sameFutureCupName } from '../src/engine/futureCupNames'

for (const year of [2027, 2034]) {
  assert.equal(stageNameIn(year, 'stage1', true), FUTURE_CUP_NAME[1])
  assert.equal(stageNameIn(year, 'stage2', true), FUTURE_CUP_NAME[2])
  for (const cup of [1, 2] as const) {
    const label = FUTURE_CUP_NAME[cup]
    const event = eventsOf(year).find(e => e.id === `F${year}:cup${cup}:China`)
    const open = eventsOf(year).find(e => e.id === `F${year}:open${cup}:China`)
    assert.ok(event && open)
    assert.equal(event.cn, `中国联赛 · ${label}`)
    assert.equal(open.cn, `中国联赛 · ${label}公开季后赛`)
    assert.equal(event.name, `VCT ${year}: China Cup ${cup}`, 'stable internal event identity')
    assert.ok(sameFutureCupName(year, `中国联赛 · 杯赛 ${cup}`, event.cn), 'old title can find current event')
    assert.ok(sameFutureCupName(year, `杯赛 ${cup} 公开资格赛 · 欧洲`, `${label}公开资格赛 · 欧洲`))
    assert.ok(sameFutureCupName(year, `EMEA 联赛 · 杯赛 ${cup} 公开季后赛`, `EMEA 联赛 · ${label}公开季后赛`))
  }
}
assert.equal(sameFutureCupName(2026, '杯赛 1', FUTURE_CUP_NAME[1]), false)
assert.equal(sameFutureCupName(2027, '杯赛 1', FUTURE_CUP_NAME[2]), false)
console.log('2027+ Cup display names, IDs and old-save names passed')
