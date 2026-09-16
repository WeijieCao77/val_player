/**
 * A career read back from its save is the same career.
 *
 * A fixture is `F` and a number, and the match is played off that id
 * (engine/season.ts fixtureRng). The number used to come from one counter in
 * engine/league.ts that only setupSeason moved, so a page that opened a save
 * numbered the fixtures it wrote next from F0 again, beside the F0… already on
 * the books: a 2021 career reloaded at day 112 held seven ids twice by the next
 * week, a lookup by id could find the wrong match (me/week.ts dueToday,
 * me/hurtplay.ts), and every match from there on was played off another stream
 * than the same career never reloaded. Two careers in one process moved each
 * other's numbers too, which is what a script runs.
 *
 * Each world counts its own fixtures now, and a world this process has not
 * numbered yet counts on from the highest id it holds. So:
 *
 *  - two careers of one seed are stepped a week at a time side by side, and one
 *    of them is saved and read back the way the page does it (packState →
 *    unpackState → migratePlayerSave) at several points — a Challengers season
 *    of mine in progress, an event of the world's in progress, the last weeks of
 *    a season, and the turn of the year. Every week: the same fixtures, the same
 *    ids, the same results, and no id twice
 *  - at the first of those, a third career of another seed is begun and played a
 *    week in the same process: it numbers from F0, and the career beside it does
 *    not feel it
 *  - the count a fresh page rebuilds off the books is the count the run holds,
 *    every week — which is what lets a save carry no counter of its own
 *  - an old save still loads and carries on: a career written raw, under the
 *    manager game's old key, read through loadAutosave
 *  - a manager's save exported and imported again, and a world put back in place
 *    the way the tutorial puts it (ui/Tutorial.tsx), count on from their books
 *
 *   npx tsx scripts/check_reload.ts [seed=11]
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

import { createHash } from 'node:crypto'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { highestFixtureNo, nextFixtureNo, syncFixtureSeq } from '../src/engine/league'
import { exportSave, importSave, packState, unpackState } from '../src/engine/save'
import { SAVE_KEYS, loadAutosave, migratePlayerSave } from '../src/engine/me/save'
import type { Fixture, GameState, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
let bad = 0
const fail = (s: string): void => { bad++; console.log(`  ✗ ${s}`) }
const t0 = Date.now()
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(1)} s`

const md5 = (s: string): string => createHash('md5').update(s).digest('hex').slice(0, 12)
const short = (v: unknown): string => {
  const s = JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 120 ? `${s.slice(0, 120)}…` : s
}

/** key order aside: a loaded career's fields come back in another order, and that is not a difference */
const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]))
  }
  return v
}

function diff(a: unknown, b: unknown, path: string, out: string[], limit = 12): void {
  if (out.length >= limit || a === b) return
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: 直接打的=${short(a)}  读档的=${short(b)}`)
    return
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra)
  const kb = Object.keys(rb)
  if (ka.join('') !== kb.join('')) {
    const onlyA = ka.filter((k) => !(k in rb))
    const onlyB = kb.filter((k) => !(k in ra))
    if (onlyA.length || onlyB.length) out.push(`${path}: 只有直接打的有 [${onlyA.slice(0, 6).join(', ')}]，只有读档的有 [${onlyB.slice(0, 6).join(', ')}]`)
  }
  for (const k of ka) if (k in rb) diff(ra[k], rb[k], `${path}.${k}`, out, limit)
}

/** what a career looks like once saved and read back — so what loading itself tidies is not counted as a difference */
const loadedForm = (s: GameState): Record<string, unknown> =>
  migratePlayerSave(unpackState(packState(s))) as unknown as Record<string, unknown>

const saved = (s: GameState): Map<string, string> => {
  const o = loadedForm(s)
  return new Map(Object.keys(o).map((k) => [k, md5(JSON.stringify(canon(o[k])) ?? 'undefined')]))
}

/** every key of the two careers that differs, with the first few differences under it */
function wholeState(a: GameState, b: GameState, when: string): void {
  const ha = saved(a)
  const hb = saved(b)
  const off = [...new Set([...ha.keys(), ...hb.keys()])].filter((k) => ha.get(k) !== hb.get(k))
  if (!off.length) return
  fail(`${when}：读回来的存档和一路打下来的不一样（${off.join('、')}）`)
  const pa = loadedForm(a)
  const pb = loadedForm(b)
  for (const k of off) {
    const out: string[] = []
    diff(canon(pa[k]), canon(pb[k]), k, out)
    for (const l of out) console.log(`      ${l}`)
  }
}

/** a fixture as the books hold it — what loading prunes (scoreboards, vetoes) is not part of it */
const line = (f: Fixture): string =>
  `${f.id}|${f.day}|${f.comp}|${f.teamA}|${f.teamB}|${f.played ? 1 : 0}|`
  + (f.result ? `${f.result.mapsWonA}-${f.result.mapsWonB}:${f.result.maps.map((m) => `${m.scoreA}-${m.scoreB}`).join(',')}` : '')

const books = (s: GameState): string => s.fixtures.map(line).join('\n')

const dupes = (s: GameState): string[] => {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const f of s.fixtures) {
    if (seen.has(f.id)) twice.add(f.id)
    seen.add(f.id)
  }
  return [...twice]
}

/** where the two careers' books first part company */
function firstOff(a: GameState, b: GameState): string {
  const la = a.fixtures.map(line)
  const lb = b.fixtures.map(line)
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `第 ${i + 1} 场：直接打的 ${la[i] ?? '（没有）'}，读档的 ${lb[i] ?? '（没有）'}`
  }
  return `场次数不同：${la.length} / ${lb.length}`
}

/** a competition of this career with games played and games still to play — an event under way */
function underWay(s: GameState, mine: boolean): boolean {
  const by = new Map<string, { p: number; u: number }>()
  for (const f of s.fixtures) {
    if (mine && f.teamA !== s.myTeam && f.teamB !== s.myTeam) continue
    if (f.comp === 'scrim') continue
    const r = by.get(f.comp) ?? { p: 0, u: 0 }
    if (f.played) r.p++
    else r.u++
    by.set(f.comp, r)
  }
  return [...by.values()].some((r) => r.p > 0 && r.u > 0)
}

const make = (region: Region, start: StartPoint, year: number, s = seed): GameState => createCareer({
  name: '读档', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed: s, year: year as 2021,
})

interface Run {
  label: string
  region: Region
  start: StartPoint
  year: number
  /** how far to play */
  done: (s: GameState, week: number) => boolean
  /** a career of another seed is begun and played mid-run, to see whether it moves this one's numbers */
  stray?: boolean
}

/**
 * Two careers of one seed, a week at a time side by side; one of them is saved
 * and read back at each point the run asks for. Returns how many times it was
 * reloaded.
 */
function lockstep(run: Run): number {
  let a = make(run.region, run.start, run.year)
  let b = make(run.region, run.start, run.year)
  const took: string[] = []
  const held = new Set<string>()
  let week = 0
  let stray = false
  console.log(`  ${run.label}`)
  while (!run.done(a, week) && !a.gameOver && !b.gameOver && week < 120) {
    const yearWas = a.year
    week++
    autoWeek(a)
    autoWeek(b)
    // the count a page rebuilds off the books is the count this run holds
    if (nextFixtureNo(a) !== highestFixtureNo(a) + 1) {
      fail(`第 ${week} 周（${a.year}:${a.day}）：接着编的号 F${nextFixtureNo(a)}，从赛程上看应该是 F${highestFixtureNo(a) + 1}`)
    }
    const twice = dupes(b)
    if (twice.length) fail(`第 ${week} 周（${b.year}:${b.day}）：读档的赛程里有 ${twice.length} 个重号（${twice.slice(0, 6).join('、')}）`)
    if (books(a) !== books(b)) {
      fail(`第 ${week} 周（${a.year}:${a.day}）：两边的赛程对不上 — ${firstOff(a, b)}`)
      wholeState(a, b, `第 ${week} 周`)
      return took.length
    }
    // what a save is taken in the middle of
    const why = a.year !== yearWas ? '跨年'
      : !held.has('mine') && a.me?.phase === 'pro' && underWay(a, true) ? '我的赛事打到一半'
        : !held.has('world') && underWay(a, false) ? '世界的赛事打到一半'
          : !held.has('late') && a.day >= 330 ? '赛季最后几周'
            : ''
    if (!why) continue
    held.add(why === '跨年' ? 'turn' : why.startsWith('我的') ? 'mine' : why.startsWith('世界') ? 'world' : 'late')
    if (why === '跨年' && took.some((t) => t.startsWith('跨年'))) continue
    const before = nextFixtureNo(b)
    b = migratePlayerSave(unpackState(packState(b)))
    const after = nextFixtureNo(b)
    if (after !== before) fail(`第 ${week} 周：读回来接着编 F${after}，存之前是 F${before}`)
    took.push(`${why}（第 ${week} 周 ${b.year}:${b.day}，F${after}）`)
    // a new career begun in the same process: its own numbers, and this one's are its own
    if (run.stray && !stray) {
      stray = true
      let other: GameState | null = make(run.region, run.start, run.year, seed + 7)
      // far enough in that it is writing the very numbers this career is holding
      let n = 0
      while (highestFixtureNo(other) < after && n++ < 20) autoWeek(other)
      const mine = nextFixtureNo(b)
      if (mine !== after) fail(`旁边开了一档新存档以后，这一档接着编 F${mine}，本来是 F${after}`)
      if (highestFixtureNo(other) < 0) fail(`新开的那一档打了 ${n} 周还没排出比赛，编号撞不上`)
      else if (!other.fixtures.some((f) => f.id === 'F0')) fail('新开的那一档没有从 F0 开始编号')
      else if (highestFixtureNo(other) < after) fail(`新开的那一档只编到 F${highestFixtureNo(other)}，没打到这一档的 F${after}`)
      console.log(`    旁边新开一档（种子 ${seed + 7}）打了 ${n} 周：它从 F0 编到 F${nextFixtureNo(other) - 1}，这一档还是 F${mine}`)
      other = null
    }
    // the week after a reload, everything, not only the books
    autoWeek(a)
    autoWeek(b)
    week++
    if (books(a) !== books(b)) fail(`读档后第一周（${a.year}:${a.day}）：赛程对不上 — ${firstOff(a, b)}`)
    else wholeState(a, b, `读档后第一周（${a.year}:${a.day}）`)
  }
  wholeState(a, b, `打到 ${a.year}:${a.day}`)
  console.log(`    ${week} 周到 ${a.year}:${a.day}，${a.fixtures.length} 场在册，存读 ${took.length} 次：${took.join('；')}（${secs()}）`)
  if (!took.length) fail(`${run.label}：一次都没存读到`)
  return took.length
}

console.log(`存档读回来还是同一个世界（种子 ${seed}）`)
console.log('一、一路打下来 vs 中途存读')
const turns = lockstep({
  label: '2021 欧洲 · Challengers 首发，打到 2022 年年中',
  region: 'Europe' as Region, start: 'chal' as StartPoint, year: 2021,
  done: (s) => s.year >= 2022 && s.day >= 140,
  stray: true,
})
lockstep({
  label: '2026 欧洲 · VCT 替补，打半个赛季',
  region: 'Europe' as Region, start: 't1' as StartPoint, year: 2026,
  done: (_s, week) => week >= 26,
})
if (turns < 2) fail('2021 那一档没有跨年那一次存读')

console.log('二、旧存档')
{
  // a career written raw, under the manager game's old key: what a browser from before the player game had its own keys holds
  const s = make('Europe' as Region, 'chal' as StartPoint, 2021)
  for (let i = 0; i < 12; i++) autoWeek(s)
  localStorage.clear()
  localStorage.setItem(SAVE_KEYS.oldAutosave, packState(s))
  const old = await loadAutosave()
  if (!old?.me) fail('旧存档读不出来')
  else {
    const want = highestFixtureNo(s) + 1
    if (nextFixtureNo(old) !== want) fail(`旧存档读出来接着编 F${nextFixtureNo(old)}，赛程上到 F${want - 1}`)
    if (dupes(old).length) fail('旧存档读出来就有重号')
    autoWeek(s)
    autoWeek(old)
    if (books(s) !== books(old)) fail(`旧存档接着打对不上 — ${firstOff(s, old)}`)
    else console.log(`  旧格式（没压缩、旧键名）读出来接着编 F${want}，再打一周和没读过的一样（${old.fixtures.length} 场在册）`)
  }
  // the manager game's own way out and in
  const back = importSave(exportSave(s))
  if (nextFixtureNo(back) !== nextFixtureNo(s)) fail(`导出再导入接着编 F${nextFixtureNo(back)}，本来是 F${nextFixtureNo(s)}`)
  else console.log(`  导出再导入（经理模式的存档文件）接着编 F${nextFixtureNo(back)}`)
  // and a world put back in place inside the same object, the way the tutorial puts the save back
  const snapshot = packState(s)
  const sandbox = migratePlayerSave(unpackState(snapshot))
  autoWeek(sandbox)
  Object.assign(sandbox, unpackState(snapshot))
  syncFixtureSeq(sandbox)
  if (nextFixtureNo(sandbox) !== highestFixtureNo(s) + 1) {
    fail(`原地放回去的世界接着编 F${nextFixtureNo(sandbox)}，赛程上到 F${highestFixtureNo(s)}`)
  } else console.log(`  原地放回去（新手教程试玩完）接着编 F${nextFixtureNo(sandbox)}`)
}

console.log(bad ? `✗ ${bad} 处不对（${secs()}）` : `✓ 存读没有改变世界（${secs()}）`)
process.exit(bad ? 1 : 0)
