/**
 * Do the eight ceilings hold, open, and survive a save from before them?
 *
 * me/bottleneck.ts makes three promises. No attribute ever passes its ceiling,
 * whichever system trains it — my own hours, the club's programme, the
 * winter's ageing — and `potential` is always what the ceilings add up to.
 * Ceilings actually open over a career, and say so in the log. And a save from
 * before them keeps the 上限 it had, without announcing eight bottlenecks the
 * week it loads. This walks the steady plan through a career and holds it to
 * all three, twice on the same seed so the whole thing is deterministic.
 *
 *   npx tsx scripts/check_bottleneck.ts [seasons=6] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { ATTR_CN, ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'
import { recomputeOverall } from '../src/engine/player'
import { breakInfo, ceilingPotential, ensureCeilings } from '../src/engine/me/bottleneck'

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

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)
let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }

function held(state: GameState, when: string): void {
  const p = state.players[state.me!.id]
  for (const k of ATTR_KEYS) if (p.attrs[k] > p.caps![k]) fail(`${when}：${ATTR_CN[k]} ${p.attrs[k]} 超过瓶颈 ${p.caps![k]}`)
  if (p.potential !== ceilingPotential(p)) fail(`${when}：上限 ${p.potential} 和八项瓶颈合起来的 ${ceilingPotential(p)} 对不上`)
}

function career(): GameState {
  // a Challengers start is a European club's, as in check_money
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
  })
  const year0 = state.year
  let guard = 0
  while (state.year - year0 < seasons && guard++ < 60 * seasons) {
    if (autoWeek(state).kind === 'game-over') break
    held(state, `${state.year} 第 ${state.day} 天`)
  }
  return state
}

const a = career()
const me = a.me!
const p = a.players[me.id]
const opened = me.log.filter((l) => l.text.startsWith('瓶颈松动'))
console.log(`${seasons} 季，seed ${seed}：综合 ${p.overall} / 上限 ${p.potential}`)
console.log(`  ${ATTR_KEYS.map((k) => `${ATTR_CN[k]} ${p.attrs[k]}/${p.caps![k]}`).join(' · ')}`)
console.log(`  瓶颈松动 ${opened.length} 次，赛季经验 ${me.bottleneck!.exp} 次`)
for (const l of opened.slice(0, 4)) console.log(`    ${l.year} ${l.text}`)
if (!opened.length) fail('一整个生涯没有一项瓶颈被破开')
for (const k of ATTR_KEYS.filter((x) => p.attrs[x] >= p.caps![x])) {
  const b = breakInfo(a, k)
  console.log(`  卡在瓶颈：${ATTR_CN[k]} —— ${b.dead ?? `${b.how}（${b.prog}）`}`)
}

const b = career()
if (JSON.stringify([p, me.bottleneck, me.log]) !== JSON.stringify([b.players[b.me!.id], b.me!.bottleneck, b.me!.log])) {
  fail('同一个种子跑两遍，瓶颈或日志不一样')
}

// a save from before the ceilings, mid-career: the 上限 it had is the 上限 it keeps
const old = structuredClone(a)
const op = old.players[old.me!.id]
delete op.caps
delete old.me!.bottleneck
const was = op.potential
ensureCeilings(old)
if (op.potential < was || op.potential > was + 1) fail(`老存档的上限从 ${was} 变成了 ${op.potential}`)
held(old, '老存档读进来')
for (let i = 0; i < 12; i++) { autoWeek(old); held(old, `老存档第 ${i + 1} 周`) }

// and one already stuck at its one number, with 99 枪法: every row at its ceiling, said once, not as news
const stuck = structuredClone(a)
const sp = stuck.players[stuck.me!.id]
delete sp.caps
delete stuck.me!.bottleneck
sp.attrs.aim = 99
recomputeOverall(sp)
sp.potential = sp.overall
ensureCeilings(stuck)
if (sp.potential !== sp.overall || sp.caps!.aim !== 99) fail('卡在上限的老存档读进来之后上限变了')
const logged = stuck.me!.log.length
autoWeek(stuck)
if (stuck.me!.log.slice(logged).some((l) => l.text.includes('练到瓶颈了'))) fail('老存档读进来的第一周把早就卡住的几项又报了一遍')

console.log(bad
  ? `\n✗ ${bad} 处不对`
  : '\n✓ 八项瓶颈守得住、破得开、写得出来；老存档的上限原样保留，同一个种子结果一样。')
if (bad) process.exit(1)
