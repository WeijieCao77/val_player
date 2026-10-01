/**
 * 真实开档场景自检：不模拟整季，只验证 createCareer 初始状态与关键迁移（打包/同步/名册/家庭/退役）。
 * 运行：npx tsx scripts/check_real_scenarios.ts
 */
import { createCareer } from '../src/engine/me/career'
import { emptyTalents } from '../src/engine/me/career'
import { fireEvent } from '../src/engine/me/events'
import { storyWeek } from '../src/engine/me/storyweek'
import { retire } from '../src/engine/me/endings'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { syncEvent } from '../src/engine/timeline'
import { syncYear } from '../src/engine/timeline'
import type { GameState } from '../src/engine/types'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

function rosterIds(state: GameState, teamId: string): string[] {
  return [...state.teams[teamId].roster]
}

function uniqueRoster(state: GameState, teamId: string): boolean {
  const ids = rosterIds(state, teamId)
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function checkDemon1() {
  const s = createCareer({
    scenario: 'demon1-2023',
    name: '检查用',
    region: 'Americas',
    role: '决斗者',
    talents: emptyTalents(),
    originKey: 'real',
    start: 'pre',
    year: 2026 as const,
  })

  const me = s.me!
  const team = s.teams[s.myTeam]
  assert(me.id === 'V26171', `Demon1 me.id 应为 V26171，实际 ${me.id}`)
  const p = s.players[me.id]
  assert(p, 'Demon1 球员不存在')
  assert(p.region === team.region, `Demon1 region ${p.region} != 队伍 ${team.region}`)
  assert(s.year === 2023, `Demon1 year ${s.year} != 2023`)
  assert(s.day === 18, `Demon1 day ${s.day} != 18`)
  assert(p.age === 20, `Demon1 age ${p.age} != 20`) // 2002-09-07 在 2023-01-19 为 20
  assert(team.id === 'V21T5248', `Demon1 team ${team.id} != V21T5248`)
  assert(me.phase === 'pro', `Demon1 phase ${me.phase} != pro`)
  assert(uniqueRoster(s, s.myTeam), 'Demon1 名册有重复 id')

  // 打包/解包保持 id 与场景
  const packed = packState(s)
  const unpacked = migratePlayerSave(unpackState(packed))
  assert(unpacked.me!.id === 'V26171', 'Demon1 打包解包后 me.id 变化')
  assert(unpacked.me!.scenario?.key === 'demon1-2023', 'Demon1 打包解包后 scenario.key 变化')
  assert(unpacked.players['V26171'] != null, 'Demon1 打包解包后球员丢失')

  // 年同步不改 year 原对象
  const playersBefore = s.players
  syncYear(s, 2025)
  assert(s.year === 2023, 'syncYear 不应改动 state.year')
  assert(s.players === playersBefore, 'syncYear 不应替换 players 对象')
  assert(s.players['V26171'] != null, 'syncYear 后 Demon1 丢失')

  // 名册同步事件：名册 id 形式 '1034': ['26171']
  syncEvent(s, { '1034': ['26171'] })
  // me 不应被名册同步移动或替换（真实开档用原 id 而非 ME_ID）
  assert(s.players[me.id] === p, 'syncEvent 后 me 球员对象被替换')
  assert(s.me!.id === me.id, 'syncEvent 后 me.id 变化')

  // PRIVATE family_call 不满足（false）
  const familyFalse = fireEvent(s, 'family_call') // PRIVATE 需要特定前置
  assert(!familyFalse, 'family_call 不应在 PRIVATE 状态触发')

  // 退役文字包含「本局模拟」
  s.me!.week = 40
  storyWeek(s)
  assert(!s.me!.chain, '真人不得开启私人事件链')
  retire(s, '测试退役', 'other')
  const retirementText = s.me!.ending!.text
  assert(retirementText.includes('本局模拟'), `退役文字缺少「本局模拟」: ${retirementText}`)

  console.log('✓ Demon1-2023 场景通过')
}

function checkZmjjKK() {
  const s = createCareer({
    scenario: 'zmjjkk-2024',
    name: '检查用',
    region: 'China',
    role: '决斗者',
    talents: emptyTalents(),
    originKey: 'real',
    start: 'pre',
    year: 2026 as const,
  })
  const me = s.me!
  assert(me.id === 'V3520', `ZmjjKK me.id 应为 V3520，实际 ${me.id}`)
  assert(s.year === 2024, `ZmjjKK year ${s.year} != 2024`)
  assert(s.day === 0, `ZmjjKK day ${s.day} != 0`)
  assert(s.players['V3520']?.teamId === 'V21T1120', 'ZmjjKK 队伍不对')
  assert(uniqueRoster(s, s.myTeam), 'ZmjjKK 名册有重复 id')
  console.log('✓ ZmjjKK-2024 场景通过')
}

function checkBoaster() {
  const s = createCareer({
    scenario: 'boaster-2023',
    name: '检查用',
    region: 'EMEA',
    role: '控场',
    talents: emptyTalents(),
    originKey: 'real',
    start: 'pre',
    year: 2026 as const,
  })
  const me = s.me!
  assert(me.id === 'V438', `Boaster me.id 应为 V438，实际 ${me.id}`)
  assert(s.year === 2023, `Boaster year ${s.year} != 2023`)
  assert(s.day === 0, `Boaster day ${s.day} != 0`)
  assert(s.players['V438']?.teamId === 'V21T2593', 'Boaster 队伍不对')
  assert(uniqueRoster(s, s.myTeam), 'Boaster 名册有重复 id')
  console.log('✓ Boaster-2023 场景通过')
}

checkDemon1()
checkZmjjKK()
checkBoaster()
console.log('全部真实开档场景自检通过')
