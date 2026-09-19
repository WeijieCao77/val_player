/**
 * The draws read at once say what they said read one by one (engine/circuit.ts readDraws, planSeeds).
 *
 * Reported 2026-09-18, a page audit on a 2029 career: the first opening of 转会 froze the page for 7.5–11 seconds in
 * the dev build, 9 in the built site. 「挑一家接触」, shut, still listed every club with its window
 * (me/selfpitch.ts pitchTargets); each club's window read every event ahead of it (me/window.ts busyFrom), each event
 * worked its draw out again for each club and again for each event feeding it (circuit.ts drawOutlook,
 * couldStillTake), and each draw of the new format went through every club in the world once for every place it had
 * empty (planSeeds). Now the list is built when it is opened, one read works each draw out once for the whole list,
 * and a draw goes through the clubs once for each kind of place.
 *
 * None of that may change a word on a page. On fresh copies of the same save, the quick way against the long way
 * (drawTheLongWay: no read kept between clubs, every empty place asking every club again, as before):
 *
 *  - 名单: pitchTargets — every club with its group, its chance and why it cannot be written to — with the
 *    language, so every 赛区's clubs are read
 *  - 出路: drawOutlook for my club and a spread of clubs, every event not over, inside one read
 *  - 积分: pointsTables, which reads the same draws
 *
 * on a 2021 VCT career from the open era to 2029 (the new format from 2027), and a 2026 ladder career into 2027.
 * The time each way is printed, not held: the machine it runs on is shared.
 *
 *   npx tsx scripts/check_drawread.ts
 */
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

import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { pitchTargets } from '../src/engine/me/selfpitch'
import { drawOutlook, drawTheLongWay, pointsTables, readDraws } from '../src/engine/circuit'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region } from '../src/engine/types'

let bad = 0
const t0 = Date.now()
const check = (ok: boolean, what: string): boolean => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
  return ok
}
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState
const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now()
  const r = f()
  return [r, performance.now() - t]
}
const longWay = <T>(f: () => T): T => {
  drawTheLongWay(true)
  try {
    return f()
  } finally {
    drawTheLongWay(false)
  }
}

/** the list as the page shows it, down to each club's chance and its reason */
const listed = (s: GameState): string => {
  const r = pitchTargets(s)
  return JSON.stringify({
    shut: r.abroadShut,
    rows: r.rows.map((x) => ({ ...x, team: x.team.id, odds: { ...x.odds, need: { kind: x.odds.need.kind, mate: x.odds.need.mate?.id } } })),
  })
}

/** my club and every fortieth club that could play, against every event not over */
function outlooks(s: GameState): string[] {
  const ids = Object.values(s.teams).filter((t) => !t.dormant && t.roster.length >= 5).map((t) => t.id).sort()
  const clubs = [...new Set([...(s.me?.phase === 'pro' ? [s.myTeam] : []), ...ids.filter((_, i) => i % 40 === 0)])]
  const out: string[] = []
  for (const c of Object.values(s.comps)) {
    if (!c.circuit || c.champion || c.circuit.done) continue
    for (const id of clubs) out.push(`${c.key} ${id} ${JSON.stringify(drawOutlook(s, c, id))}`)
  }
  return out
}

function same(label: string, s: GameState): void {
  const where = `${label} ${s.year} 第 ${s.day} 天${s.me?.phase === 'pro' ? ` · ${s.teams[s.myTeam]?.tag}` : ' · 没有俱乐部'}`
  const a = clone(s)
  const b = clone(s)
  // with the language: another 赛区's clubs are listed too, and read
  a.me!.flags.lang = true
  b.me!.flags.lang = true
  const [slow, ts] = timed(() => longWay(() => listed(a)))
  const [quick, tq] = timed(() => listed(b))
  const n = (JSON.parse(quick) as { rows: unknown[] }).rows.length
  check(slow === quick, `${where}：自荐/接触名单 ${n} 家，一次读完和一家一家读一样（${(ts / 1000).toFixed(1)} 秒 → ${(tq / 1000).toFixed(2)} 秒）`)
  const c = clone(s)
  const d = clone(s)
  const [os, to] = timed(() => longWay(() => outlooks(c)))
  const [oq, tr] = timed(() => readDraws(d, () => outlooks(d)))
  const diff = os.findIndex((x, i) => x !== oq[i])
  check(os.length === oq.length && diff < 0, `${where}：${os.length} 个「俱乐部 × 赛事」的出路一样（${(to / 1000).toFixed(1)} 秒 → ${(tr / 1000).toFixed(2)} 秒）${diff >= 0 ? `，第一处不同：${os[diff]} ≠ ${oq[diff]}` : ''}`)
  const e = clone(s)
  const f = clone(s)
  check(JSON.stringify(longWay(() => pointsTables(e))) === JSON.stringify(pointsTables(f)), `${where}：积分表一样`)
}

/** talents on the first two of the eight, as the phone audit's long career has them (scripts/mobile_saves.ts): good enough to stay in a club */
function career(region: Region, start: StartPoint, year: 2021 | 2026, seed: number): GameState {
  const talents = emptyTalents()
  ATTR_KEYS.forEach((k, i) => { talents[k] = [8, 8, 4][i] ?? 0 })
  return createCareer({ name: 'Draws', region, role: '控场', talents, originKey: 'academy', start, seed, year })
}

/** on to the given day, a week at a time */
function until(s: GameState, year: number, day: number): boolean {
  for (let w = 0; w < 60 * 10 && (s.year < year || (s.year === year && s.day < day)); w++) {
    if (s.me!.phase === 'retired' || autoWeek(s).kind === 'game-over') return false
  }
  return true
}

console.log('一、2021 开档的一线队员，从开放年代打到 2029（2027 起是新赛制）')
{
  const s = career('Europe', 't1', 2021, 41)
  for (const [y, d] of [[2022, 150], [2023, 120], [2024, 200], [2025, 60], [2026, 250], [2027, 40], [2028, 180], [2029, 0]] as const) {
    if (!until(s, y, d)) { check(false, `${y} 第 ${d} 天之前生涯就结束了`); break }
    same('2021 欧洲', s)
  }
}

console.log('二、2026 开档的天梯选手，打进 2027')
{
  const s = career('China', 'pre', 2026, 7)
  for (const [y, d] of [[2026, 120], [2027, 90]] as const) {
    if (!until(s, y, d)) { check(false, `${y} 第 ${d} 天之前生涯就结束了`); break }
    same('2026 天梯', s)
  }
}

console.log(bad ? `\n✗ 一次读完的赛事抽签有 ${bad} 处和一家一家读的不一样。` : `\n✓ 转会页的名单、各俱乐部在每项赛事的出路和积分表：一次读完和一家一家读，一字不差。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(bad ? 1 : 0)
