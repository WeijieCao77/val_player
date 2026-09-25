/**
 * The age curve (2026-09-25, engine/player.ts): young players' hours go further and their ceilings
 * loosen, the peak is 23–26, and from 27 each winter takes 枪法 and 反应 and the ceilings they sit
 * under, with no break able to buy them back, while 意识 and the rest hold. The career player and a
 * club's man share it.
 *
 *   npx tsx scripts/check_age_curve.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { PEAK_END, ageAttrMul, ageLoss, trainAgeMul, youthLoosens } from '../src/engine/player'
import { seasonRollover } from '../src/engine/training'
import { bottleneckWeek, breakthrough, ceilingPotential, ensureCeilings, pathDead } from '../src/engine/me/bottleneck'
import { ageNote } from '../src/engine/me/growth'
import { Rng } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

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

let n = 0
const ok = (cond: boolean, what: string) => { assert.ok(cond, what); n++; console.log(`  ✓ ${what}`) }

console.log('一、曲线本身')
for (let a = 17; a < 34; a++) assert.ok(trainAgeMul(a + 1) <= trainAgeMul(a), `trainAgeMul ${a}`)
ok(trainAgeMul(19) / trainAgeMul(24) > 1.8 && trainAgeMul(30) < trainAgeMul(24), '19 岁的训练值是 24 岁的 1.8 倍以上，30 岁更少')
ok(ageAttrMul(PEAK_END, 'aim') === 1 && ageAttrMul(PEAK_END + 1, 'aim') < 1 && ageAttrMul(30, 'awareness') === 1, '过了巅峰期练枪法反应打折，意识不打折')
ok(ATTR_KEYS.every((k) => ageLoss(PEAK_END, k) === 0) && ageLoss(27, 'aim') > 0 && ageLoss(30, 'reaction') >= ageLoss(27, 'reaction'), '26 岁前不掉，27 岁起枪法反应开始掉、越往后越多')
ok((['awareness', 'utility', 'teamwork', 'communication', 'igl'] as const).every((k) => ageLoss(32, k) === 0), '意识、道具、协同、沟通、指挥不掉')
ok([17, 18, 22, 25].every((a) => youthLoosens(a) === 0) && [19, 20, 21].every((a) => youthLoosens(a) === 1), '19–21 岁的冬天瓶颈各松 1 点')

const career = (): GameState => createCareer({ name: '年龄', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', year: 2026, seed: 3301 })
const me = (s: GameState) => s.players[s.me!.id]

console.log('二、过了巅峰期的冬天')
{
  const s = career()
  const p = me(s)
  ensureCeilings(s)
  p.age = 29
  for (const k of ATTR_KEYS) { p.attrs[k] = 85; p.caps![k] = 85; p.xp[k] = 0 }
  p.potential = ceilingPotential(p)
  s.me!.bottleneck!.pot = p.potential
  const was = { attrs: { ...p.attrs }, caps: { ...p.caps! } }
  seasonRollover(s, new Rng(7))
  ok(p.age === 30 && p.attrs.aim < was.attrs.aim && p.attrs.reaction < was.attrs.reaction, `30 岁的冬天：枪法 ${was.attrs.aim} → ${p.attrs.aim}，反应 ${was.attrs.reaction} → ${p.attrs.reaction}`)
  ok(p.caps!.aim === p.attrs.aim && p.caps!.reaction === p.attrs.reaction, '瓶颈跟着降：练也补不回原来的高度')
  ok((['awareness', 'utility', 'teamwork', 'communication', 'igl'] as const).every((k) => p.attrs[k] >= was.attrs[k]), '意识、道具、协同、沟通、指挥没有掉')
  ok(p.potential === ceilingPotential(p) && s.me!.bottleneck!.pot === p.potential, `上限 ${p.potential} 仍是八项瓶颈之和，瓶颈账本同步`)
  const caps = { ...p.caps! }
  // settle (me/bottleneck.ts) opens all eight by p.potential − bn.pot: that has to be nothing after a winter that only faded
  ok(!(p.potential > s.me!.bottleneck!.pot), '下一次周结算不会把降下去的上限当成冬训重评、再给八项加回去')
  bottleneckWeek(s)
  ok(p.caps!.aim <= caps.aim && p.caps!.reaction <= caps.reaction, '周结算之后枪法、反应的瓶颈也没有回去')
  ok(!!pathDead(s, 'aim') && !!pathDead(s, 'reaction') && !pathDead(s, 'awareness'), `枪法、反应的「怎么破」灰掉并说明原因：${pathDead(s, 'aim')}`)
  const aimCap = p.caps!.aim
  const reactCap = p.caps!.reaction
  breakthrough(s, 'awareness', 2.4, '测试', 'mile')
  ok(p.caps!.aim === aimCap && p.caps!.reaction === reactCap && p.caps!.awareness > caps.awareness, '过了巅峰期，突破的收获落在意识这些还在涨的地方，不落在枪法反应上')
}

console.log('三、还在长的冬天')
{
  const s = career()
  const p = me(s)
  ensureCeilings(s)
  p.age = 18
  // no scout's re-rating this winter: this is the age's own loosening alone
  p.season.maps = 0
  p.season.rounds = 0
  const caps = { ...p.caps! }
  const pot = p.potential
  seasonRollover(s, new Rng(9))
  ok(p.age === 19 && ATTR_KEYS.every((k) => p.caps![k] === Math.min(99, caps[k] + 1)), '19 岁的冬天八项瓶颈各松 1 点（到 99 的不动）')
  ok(p.potential === ceilingPotential(p) && p.potential > pot && s.me!.bottleneck!.pot === p.potential, `上限 ${pot} → ${p.potential}，账本同步，不会被当成重评再加一遍`)
  ok(s.me!.log.some((l) => l.text.includes('还在长的年纪')), '日志里说了一句')
}

console.log('四、俱乐部选手也一样')
{
  const s = career()
  const q = Object.values(s.players).find((x) => x.id !== s.me!.id && !x.caps && x.attrs.aim > 70 && x.attrs.reaction > 70)!
  q.age = 29
  q.potential = q.overall
  const was = { aim: q.attrs.aim, overall: q.overall }
  seasonRollover(s, new Rng(5))
  ok(q.attrs.aim < was.aim && q.potential <= Math.max(q.overall, was.overall), `NPC 30 岁：枪法 ${was.aim} → ${q.attrs.aim}，潜力随之降到 ${q.potential}，不会练回去`)
}

console.log('五、说给玩家听')
ok(!!ageNote(27, false)?.includes('枪法和反应') && !!ageNote(27, false)?.includes('意识还在涨'), `27 岁：${ageNote(27, false)}`)
ok(!!ageNote(19, false) && ageNote(23, false) === null, `19 岁：${ageNote(19, false)}`)
ok(!!ageNote(28, true)?.includes('点'), `数值开关：${ageNote(28, true)}`)

console.log(`\n✓ ${n} 项通过`)
