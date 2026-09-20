import assert from 'node:assert/strict'
import { playerLocation } from '../src/engine/me/playerLocation'
import world2021 from '../src/data/world_2021.json'
import type { Region } from '../src/engine/types'

const kk = world2021.players.find(p => p.id === 'V3520')!
assert.equal(kk.nat, 'cn')
assert.equal(kk.region, 'Hong Kong & Taiwan', 'keep the historical first-club circuit')
const before = JSON.stringify(kk)
assert.deepEqual(playerLocation(kk, { region: 'China' }, 2026), {
  nationality: '国籍/地区：中国', competition: '当前赛区：中国',
})
assert.deepEqual(playerLocation(kk, { region: 'Hong Kong & Taiwan' }, 2021), {
  nationality: '国籍/地区：中国', competition: '当前赛区：港台',
})
assert.equal(playerLocation(kk, { region: 'Europe' }, 2026).competition, '当前赛区：欧非中东')
assert.equal(playerLocation(kk, null, 2026).competition, null, 'free agents have no current club circuit')
assert.equal(playerLocation({ nat: 'tw' }, { region: 'China' }, 2026).nationality, '国籍/地区：中国台湾')
assert.equal(playerLocation({ nat: 'hk' }, { region: 'China' }, 2026).nationality, '国籍/地区：中国香港')
assert.equal(playerLocation({ nat: undefined }, null, 2026).nationality, '国籍/地区：国籍未知')
assert.equal(JSON.stringify(kk), before, 'no save/simulation mutation')
for (const p of world2021.players) {
  const team = world2021.teams.find(t => t.id === p.teamId)
  for (const year of [2021, 2022, 2026]) {
    const view = playerLocation({ nat: p.nat ?? undefined }, team ? { region: team.region as Region } : null, year)
    assert.ok(!view.nationality.includes('undefined'))
    assert.ok(!view.competition?.includes('undefined'))
  }
}
console.log(`PASS player location: ZmjjKK, history, transfers, free agents, HK/TW, unknown, ${world2021.players.length} historical players × 3 years`)
