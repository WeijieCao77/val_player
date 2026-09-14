/**
 * A career saved before the rating ruler, loaded (me/rulerMigrate.ts, 方案 A1).
 *
 *  - 2021, in the book's years: a world put back on the builders' scale, loaded,
 *    reads each real player back to what a new career's world gives him
 *  - 2026 + two winters with no hold, loaded: the VCT starters' median lands in
 *    a new career's range and the player keeps his place among the world
 *  - either one: the ruler is stamped, the note is said once, and loading it
 *    again changes nothing
 *
 *   npx tsx scripts/check_ruler_migrate.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { RULER, rulerShift, shiftPlayer } from '../src/engine/ruler'
import { refreshValue } from '../src/engine/player'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const NOTE = '能力标尺更新'
const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const starters = (s: GameState, tier: 1 | 2) => Object.values(s.teams).filter((t) => !t.dormant && t.tier === tier && !t.id.startsWith('CUP_'))
  .flatMap((t) => t.starters).filter((id) => id !== s.me?.id).map((id) => s.players[id]?.overall).filter((v): v is number => v != null)
const field = (s: GameState) => Object.values(s.teams).filter((t) => !t.dormant).flatMap((t) => t.roster)
  .filter((id) => id !== s.me?.id).map((id) => s.players[id]?.overall).filter((v): v is number => v != null).sort((a, b) => a - b)
const place = (s: GameState) => { const xs = field(s); const o = s.players[s.me!.id].overall; return (xs.filter((v) => v < o).length + xs.filter((v) => v === o).length / 2) / xs.length }
const print = (s: GameState) => Object.values(s.players).map((p) => `${p.id}:${p.overall}:${Object.values(p.attrs).join('.')}:${p.potential}:${p.caps ? Object.values(p.caps).join('.') : ''}`).join('|')
const load = (s: GameState) => migratePlayerSave(unpackState(packState(s)))
const notes = (s: GameState) => s.me!.log.filter((l) => l.text.startsWith(NOTE)).length

/** a save as the builders' scale left it: no ruler on record */
const unstamp = (s: GameState) => { delete (s as { ruler?: number }).ruler }

console.log('2021 · 书里的年份：旧尺子上的世界读档后回到新档的数')
{
  const opts = { name: 'Old', region: 'Europe' as const, role: '哨卫' as const, talents: emptyTalents(), originKey: 'netcafe', start: 'chal' as const, seed: 5, year: 2021 as const }
  const fresh = createCareer(opts)
  const old = createCareer(opts)
  for (const p of Object.values(old.players)) {
    if (!/^V\d+$/.test(p.id)) continue
    shiftPlayer(p, -rulerShift(2021, p.id.slice(1)))
    refreshValue(p)
  }
  unstamp(old)
  const tier1Old = med(starters(old, 1))
  const placeOld = place(old)
  const loaded = load(old)
  check(loaded.ruler === RULER, `尺子已记上（${loaded.ruler}）`)
  const ids = Object.keys(fresh.players).filter((id) => /^V\d+$/.test(id))
  const close = ids.filter((id) => Math.abs(loaded.players[id].overall - fresh.players[id].overall) <= 1).length
  check(close / ids.length >= 0.97, `真实选手和新档差 ≤1 的占 ${Math.round((close / ids.length) * 100)}%（${close}/${ids.length}）`)
  check(Math.abs(med(starters(loaded, 1)) - med(starters(fresh, 1))) <= 1, `一线首发中位 ${tier1Old} → ${med(starters(loaded, 1))}，新档 ${med(starters(fresh, 1))}`)
  check(Math.abs(place(loaded) - placeOld) <= 0.03, `主角在世界里的位置 ${placeOld.toFixed(3)} → ${place(loaded).toFixed(3)}`)
  check(notes(loaded) === 1 && loaded.me!.weekNotes.some((n) => n.startsWith(NOTE)), '读档说明写了一次（本周 + 日志）')
  const again = load(loaded)
  check(print(again) === print(loaded) && notes(again) === 1, '再读一次什么都不变，说明也不再写')
}

console.log('2026 → 2028 · 书之后：两个冬天没有定尺的老档')
{
  const s0 = createCareer({ name: 'Old', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 11, year: 2026 })
  unstamp(s0)
  const t0 = Date.now()
  let weeks = 0
  while (s0.year < 2028 && weeks++ < 140) if (autoWeek(s0).kind === 'game-over') break
  const vctOld = med(starters(s0, 1))
  const placeOld = place(s0)
  const overallOld = s0.players[s0.me!.id].overall
  const loaded = load(s0)
  const vct = starters(loaded, 1)
  const vctNew = med(vct)
  const ge90 = vct.filter((o) => o >= 90).length
  console.log(`  (${Math.round((Date.now() - t0) / 1000)}s to ${s0.year}) VCT 首发中位 ${vctOld} → ${vctNew}，90+ ${ge90}/${vct.length}；主角综合 ${overallOld} → ${loaded.players[loaded.me!.id].overall}`)
  check(vctOld >= 87, `读档前世界确实涨上去了（VCT 首发中位 ${vctOld}）`)
  check(loaded.ruler === RULER, '尺子已记上')
  check(vctNew >= 83 && vctNew <= 87, `读档后 VCT 首发中位 ${vctNew} 落在新档的 83–87`)
  check(Math.abs(place(loaded) - placeOld) <= 0.03, `主角在世界里的位置 ${placeOld.toFixed(3)} → ${place(loaded).toFixed(3)}`)
  const p = loaded.players[loaded.me!.id]
  check(!!p.caps && Object.keys(p.attrs).every((k) => p.caps![k as keyof typeof p.attrs] >= p.attrs[k as keyof typeof p.attrs]), '瓶颈都没跌到属性以下')
  check(notes(loaded) === 1, '读档说明写了一次')
  const again = load(loaded)
  check(print(again) === print(loaded) && notes(again) === 1, '再读一次什么都不变')
}

console.log(bad ? `\n${bad} 项没过` : '\n全部通过')
if (bad) process.exit(1)
