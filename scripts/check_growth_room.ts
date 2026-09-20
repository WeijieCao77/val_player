/**
 * Targeted guard for the career player's per-attribute training room.
 *
 * ROOM_SCALE = 8 is the adopted player-growth curve. Its surrounding guards
 * must stay green so changing the curve cannot silently change NPC growth,
 * legacy no-caps saves, injuries, condition, action previews, or undo.
 *
 *   npx tsx scripts/check_growth_room.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import { addXp, gainBase, hourValues, roomMul, runAction, weekGain } from '../src/engine/me/growth'
import { injuryTrainMul } from '../src/engine/me/injury'
import { doAction, undoAction } from '../src/engine/me/week'
import { recomputeOverall, weightsFor } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import { packState } from '../src/engine/save'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, Player, Role } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const EXPECTED_SCALE = 8
const ROOM_FLOOR = 0.25
const ROOM_TOP = 1.3
const GAPS = [0, 1, 2, 3, 5, 8, 10, 13, 20] as const
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const PRACTICE: MeAction[] = ['aim', 'vod', 'util', 'ranked', 'scrim']
const EXTRA = 0.55
const AIM_SHARE = 0.65

let fails = 0
let passes = 0
const check = (good: boolean, what: string): void => {
  console.log(`  ${good ? '✓' : '✗'} ${what}`)
  if (good) passes++
  else fails++
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps
const expectedRoom = (gap: number): number => Math.max(ROOM_FLOOR, Math.min(ROOM_TOP, gap / EXPECTED_SCALE))

const career = (role: Role = '决斗者', seed = 701): GameState => {
  const s = createCareer({
    name: '成长空间', region: 'China', role,
    talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed,
  })
  const me = s.me!
  const p = s.players[me.id]
  me.ap = me.apMax
  me.plan = {}
  p.fatigue = 25
  return s
}

const withRoom = (p: Player, gaps: Partial<Record<keyof Attrs, number>> = {}): void => {
  p.caps ??= { ...p.attrs }
  for (const [i, k] of ATTR_KEYS.entries()) {
    const gap = gaps[k] ?? GAPS[(i + 3) % GAPS.length]
    p.attrs[k] = 55
    p.caps[k] = 55 + gap
    p.xp[k] = 0
  }
  p.potential = 99
  recomputeOverall(p)
}

/** Save contents except the undo snapshot itself, exactly as check_week_instant does. */
const whole = (s: GameState): string => {
  const copy = structuredClone(s)
  delete copy.me!.weekStart
  return packState(copy)
}

console.log(`一、已采用曲线：ROOM_SCALE=${EXPECTED_SCALE}，逐属性、逐缺口都钉住`)
{
  const p = sPlayer(career())
  const mismatches: string[] = []
  const rangeErrors: string[] = []
  const orderErrors: string[] = []
  for (const k of ATTR_KEYS) {
    let prior = -Infinity
    for (const gap of GAPS) {
      withRoom(p, { [k]: gap })
      const got = roomMul(p, k)
      const want = expectedRoom(gap)
      if (!near(got, want)) mismatches.push(`${k}:${gap}=${got.toFixed(3)}≠${want.toFixed(3)}`)
      if (got < ROOM_FLOOR || got > ROOM_TOP) rangeErrors.push(`${k}:${gap}=${got}`)
      if (got + 1e-12 < prior) orderErrors.push(`${k}:${gap} ${prior}→${got}`)
      prior = got
    }
  }
  check(mismatches.length === 0,
    `9 个缺口 × 8 项属性符合当前曲线${mismatches.length ? `（${mismatches.slice(0, 8).join('；')}…）` : ''}`)
  check(rangeErrors.length === 0, `始终落在 ${ROOM_FLOOR}…${ROOM_TOP}`)
  check(orderErrors.length === 0, '缺口越大，倍率单调不降')
  console.log(`    枪法样例：${GAPS.map((g) => `${g}→${expectedRoom(g).toFixed(3)}`).join(' · ')}`)
}
{
  const p = sPlayer(career())
  const epsilon = 1e-6
  for (const edge of [2, 10.4]) {
    for (const delta of [-epsilon, 0, epsilon]) {
      const gap = edge + delta
      withRoom(p, { aim: gap })
      const got = roomMul(p, 'aim')
      const want = expectedRoom(gap)
      check(near(got, want, 1e-12) && got >= ROOM_FLOOR && got <= ROOM_TOP,
        `小数 clamp 边界 ${gap.toFixed(6)}：${got.toFixed(9)}，预期 ${want.toFixed(9)}`)
    }
  }
}

console.log('\n二、到顶不囤经验；没有 caps 的旧路径不读 roomMul')
{
  const s = career()
  const p = sPlayer(s)
  withRoom(p, { aim: 0 })
  p.xp.aim = 73
  const before = p.attrs.aim
  const rose = addXp(p, 'aim', 999)
  check(!rose && p.attrs.aim === before && p.xp.aim === 0,
    '单项到自己的上限后，再多训练也不涨、不存点')
}
{
  const low = career('决斗者', 702)
  const high = structuredClone(low)
  const setLegacy = (s: GameState, value: number) => {
    const p = sPlayer(s)
    delete p.caps
    for (const k of ATTR_KEYS) { p.attrs[k] = value; p.xp[k] = 0 }
    p.potential = 99
    recomputeOverall(p)
    s.me!.trainWeek = { week: s.me!.week, g: 10 }
  }
  setLegacy(low, 55)
  setLegacy(high, 85)
  const lowPreview = hourValues(low).find((h) => h.key === 'aim')!.perPoint
  const highPreview = hourValues(high).find((h) => h.key === 'aim')!.perPoint
  runAction(low, 'aim')
  runAction(high, 'aim')
  check(near(lowPreview, highPreview) && near(sPlayer(low).xp.aim ?? 0, sPlayer(high).xp.aim ?? 0),
    '无 caps 的旧存档保持原路径：不同 headroom 不改变额外行动的单小时倍率')
}

console.log('\n三、年龄、疲劳和伤病仍然各自有效')
{
  const s = career('先锋', 703)
  const team = s.teams[s.myTeam]
  const base = sPlayer(s)
  withRoom(base, Object.fromEntries(ATTR_KEYS.map((k) => [k, 20])) as Record<keyof Attrs, number>)
  const young = structuredClone(base); young.age = 20; young.fatigue = 25
  const old = structuredClone(base); old.age = 30; old.fatigue = 25
  const tired = structuredClone(base); tired.age = 20; tired.fatigue = 80
  const y = gainBase(young, team, new Rng(11))
  const o = gainBase(old, team, new Rng(11))
  const t = gainBase(tired, team, new Rng(11))
  check(y > o, `同样缺口下，20 岁训练基础 ${y.toFixed(3)} > 30 岁 ${o.toFixed(3)}`)
  check(y > t, `同龄同缺口下，体力正常 ${y.toFixed(3)} > 高疲劳 ${t.toFixed(3)}`)
}
{
  const healthy = career('决斗者', 704)
  const hurt = structuredClone(healthy)
  for (const s of [healthy, hurt]) {
    withRoom(sPlayer(s), { aim: 8, reaction: 8 })
    s.me!.trainWeek = { week: s.me!.week, g: 10 }
  }
  const hp = sPlayer(hurt)
  hp.injuredUntil = hurt.day + 14
  hp.injuryNote = '手腕劳损'
  hurt.me!.injury = { kind: 'wrist', from: hurt.day, played: 0 }
  const injuryMul = injuryTrainMul(hurt, 'aim')
  runAction(healthy, 'aim')
  runAction(hurt, 'aim')
  check(injuryMul < 1 && (sPlayer(hurt).xp.aim ?? 0) < (sPlayer(healthy).xp.aim ?? 0),
    `伤到枪法时倍率 ${injuryMul.toFixed(3)}，实际经验仍低于健康状态`)
}

console.log('\n四、界面 hourValues 与 runAction 用同一把尺，覆盖各角色权重位置')
{
  const mismatches: string[] = []
  for (const [ri, role] of ROLES.entries()) {
    for (const [ai, action] of PRACTICE.entries()) {
      const s = career(role, 800 + ri * 10 + ai)
      const p = sPlayer(s)
      withRoom(p)
      s.me!.trainWeek = { week: s.me!.week, g: 10 }
      const g = weekGain(s)
      const shown = hourValues(s).find((h) => h.key === action)
      if (!shown) { mismatches.push(`${role}/${action}:预览缺失`); continue }
      const before = { ...p.xp }
      runAction(s, action)
      const w = weightsFor(p)
      const weightedXp = ATTR_KEYS.reduce((sum, k) => sum + ((p.xp[k] ?? 0) - (before[k] ?? 0)) * w[k], 0)
      const actual = weightedXp / g / ACTION_BY_KEY[action].cost
      if (!near(actual, shown.perPoint, 1e-8)) mismatches.push(`${role}/${action}:${actual.toFixed(8)}≠${shown.perPoint.toFixed(8)}`)
    }
  }
  check(mismatches.length === 0,
    `5 种角色 × 5 类训练的预览与实际收益一致${mismatches.length ? `（${mismatches.slice(0, 5).join('；')}）` : ''}`)
}

console.log('\n五、周基础值可缓存，但 roomMul 必须按点击当下的缺口读取')
{
  const s = career('决斗者', 705)
  const p = sPlayer(s)
  withRoom(p, { aim: 20, reaction: 20 })
  const g = weekGain(s)
  const cached = s.me!.trainWeek?.g
  p.caps!.aim = p.attrs.aim + 3
  p.xp.aim = 0
  runAction(s, 'aim')
  const want = g * EXTRA * AIM_SHARE * expectedRoom(3)
  check(cached === g && near(p.xp.aim ?? 0, want, 1e-8),
    `trainWeek.g 保持 ${g.toFixed(3)}，点击仍按最新缺口 3 计为 ${want.toFixed(3)} XP（实际 ${(p.xp.aim ?? 0).toFixed(3)}）`)
}

console.log('\n六、点击再撤回，整份可保存状态逐字节复原')
{
  const s = career('控场', 706)
  const p = sPlayer(s)
  withRoom(p)
  p.fatigue = 25
  s.me!.ap = s.me!.apMax
  const before = whole(s)
  const did = doAction(s, 'util')
  const moved = whole(s) !== before
  const undone = undoAction(s, 'util')
  check(!did && moved && !undone && whole(s) === before,
    '道具与跑图点击后确实改变状态；撤回后 packState 逐字节回到点击前')
}

function sPlayer(s: GameState): Player {
  return s.players[s.me!.id]
}

console.log(`\n${fails ? `✗ ${fails} 项不对，${passes} 项通过` : `✓ ${passes} 项全部通过`}`)
process.exit(fails ? 1 : 0)
