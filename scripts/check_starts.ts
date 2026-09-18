/**
 * Every place a career can be asked to open in × every door × both entry years, through createCareer.
 *
 * Reported 2026-09-14: a 2021 ladder start from 「Americas」 crashed in career.ts, finding no club. The
 * new-career screen never lists it — 2021 lists the regions with clubs — but createCareer threw a
 * TypeError for any place with no club that year, and put a league's name on a real region only in 2026.
 *
 * - what the screen lets you start (the year lists the region, startBlocked says nothing) starts
 * - what it greys out, or does not list, is refused in the engine's words — never a TypeError
 * - a ladder start is never greyed in a region the year lists
 * - a league's name, and 2021's SEA, open in a region under it that the year lists
 * - a ladder start at no club; a club start at a club with somewhere to play that year
 * - each door opens on the goal the week page's 下一步 names (engine/me/goal.ts; reported 2026-09-18
 *   「不知道下一步要点哪」): the ladder on 拿到第一份合同 with its four roads, the second tier's starter on
 *   being seen by the first, the first tier's sixth man on 抢到首发 — with a line for the week, and cards
 *   marked 重点 among the ones it can take
 *
 *   npx tsx scripts/check_starts.ts
 */
import { careerRegions, createCareer, emptyTalents, isAcademy, startBlocked, startCnOf, startPool } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { ENTRY_YEARS, MERGED_INTO } from '../src/engine/era'
import { hasPlace } from '../src/engine/timeline'
import { goalOf, roadsOf, weekLine, weightsOf } from '../src/engine/me/goal'
import type { GoalKind } from '../src/engine/me/goal'
import { buildStartSheet } from '../src/engine/me/startSheet'
import { entryBands } from '../src/engine/ruler'
import { REGION_CN } from '../src/engine/types'
import type { GameState, Region } from '../src/engine/types'

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

let fails = 0
const fail = (m: string) => { fails++; console.log(`  ✗ ${m}`) }
const t0 = Date.now()
const cn = (r: Region) => REGION_CN[r] ?? r
const DOOR: Record<StartPoint, string> = { pre: '天梯', chal: '二队', t1: '替补' }
/** the goal each door opens on (engine/me/goal.ts goalOf) */
const GOAL: Record<StartPoint, GoalKind> = { pre: 'contract', chal: 'rise', t1: 'seat' }
/** r is `area`, or merges into it some year */
const within = (r: Region, area: Region): boolean => {
  for (let x: Region | undefined = r, guard = 0; x && guard < 7; x = MERGED_INTO[x]?.into, guard++) if (x === area) return true
  return false
}

for (const year of ENTRY_YEARS) {
  const listed = careerRegions(year)
  let started = 0
  const refused: string[] = []
  const moved: string[] = []
  for (const region of Object.keys(REGION_CN) as Region[]) {
    for (const start of Object.keys(startCnOf(year)) as StartPoint[]) {
      const label = `${year} ${cn(region)}${DOOR[start]}开局`
      const why = startBlocked(region, start, year)
      if (listed.includes(region) && start === 'pre' && why) fail(`${label}：列出来的地区，天梯开局却是灰的（${why}）`)
      let g: GameState
      try {
        g = createCareer({ name: 'Start', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed: 2026, year })
      } catch (e) {
        const words = e instanceof Error && !(e instanceof TypeError) && e.message.startsWith(`${year} 年开季时`)
        if (!words) fail(`${label}：崩了 —— ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
        if (!why) fail(`${label}：开局按钮能按，createCareer 却开不了（${e instanceof Error ? e.message : String(e)}）`)
        refused.push(`${cn(region)}${DOOR[start]}`)
        continue
      }
      started++
      if (why) fail(`${label}：开局按钮是灰的（${why}），createCareer 却开了`)
      const me = g.me!
      if (!listed.includes(me.region)) fail(`${label}：开在了 ${me.region}，这一年那里没有俱乐部`)
      if (listed.includes(region) ? me.region !== region : !within(me.region, region)) fail(`${label}：开在了 ${me.region}，不在${cn(region)}`)
      if (!listed.includes(region) && start === 'pre') moved.push(`${cn(region)} → ${cn(me.region)}`)
      if (start === 'pre') {
        if (g.myTeam !== '') fail(`${label}：天梯开局却在俱乐部 ${g.myTeam}`)
      } else {
        const t = g.teams[g.myTeam]
        if (!t) fail(`${label}：分到的俱乐部 ${g.myTeam} 不在这个世界里`)
        else if (!hasPlace(g, t)) fail(`${label}：${t.name} 这一年没有比赛可打`)
      }
      // the 下一步 card on day one: the door's goal, a line for the week, the roads without a club, 重点 on the board
      const goal = goalOf(g)
      if (goal?.kind !== GOAL[start]) fail(`${label}：第一周的目标是「${goal?.title ?? '没有'}」（${goal?.kind ?? '—'}），应该是 ${GOAL[start]}`)
      if (!weekLine(g)) fail(`${label}：下一步卡片没有「这周」那一句`)
      if (start === 'pre' && roadsOf(g).length !== 4) fail(`${label}：没有队伍时应该列出四条路，列了 ${roadsOf(g).length} 条`)
      if (!Object.values(weightsOf(g)).includes('focus')) fail(`${label}：行动卡上一张「重点」都没有`)
    }
  }
  console.log(`${year}：列出 ${listed.length} 个地区 · ${Object.keys(REGION_CN).length} 个地区名 × ${Object.keys(startCnOf(year)).length} 种开局，开得了 ${started}，按钮灰掉、引擎也不开 ${refused.length}（${refused.join('、')}）`)
  if (moved.length) console.log(`  联赛名 / 大区名落到：${moved.join('，')}`)
}

// where a league's name opens: 2026's as it always did, 2021's at the biggest scene under it
for (const [year, asked, want] of [
  [2026, 'Americas', 'North America'], [2026, 'EMEA', 'Europe'], [2026, 'Pacific', 'Japan'],
  [2021, 'Americas', 'North America'], [2021, 'EMEA', 'Europe'],
] as [2021 | 2026, Region, Region][]) {
  const g = createCareer({ name: 'League', region: asked, role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 9, year })
  if (g.me!.region !== want) fail(`${year} ${cn(asked)}开局开在了${cn(g.me!.region)}，应该是${cn(want)}`)
}

// The new-career screen reads all of this from a table worked out as the site is built (engine/me/startSheet.ts,
// vite.config.ts), not from the world, which it no longer fetches (reported 2026-09-18, an outside audit: the home
// page downloaded about 8 MB before any career was opened). The table says what the functions above say.
{
  const sheet = buildStartSheet()
  let rows = 0
  for (const year of ENTRY_YEARS) {
    const y = sheet[year]
    if (JSON.stringify(y.regions) !== JSON.stringify(careerRegions(year))) fail(`${year} 开局表的地区和 careerRegions 不一样`)
    if (JSON.stringify(y.bands) !== JSON.stringify(entryBands(year))) fail(`${year} 开局表的首发水平和 entryBands 不一样`)
    for (const region of new Set<Region>([...y.regions, 'China'])) {
      for (const start of Object.keys(startCnOf(year)) as StartPoint[]) {
        const row = y.doors[region]?.[start]
        const label = `${year} ${cn(region)}${DOOR[start]}开局`
        if (!row) { fail(`${label}：开局表里没有这一格`); continue }
        rows++
        if (row.gate !== (startBlocked(region, start, year) ?? '')) fail(`${label}：开局表说「${row.gate || '能开'}」，startBlocked 说「${startBlocked(region, start, year) ?? '能开'}」`)
        const pool = startPool(region, start, year)
        if (row.pool !== pool.length) fail(`${label}：开局表说 ${row.pool} 支俱乐部，startPool 有 ${pool.length} 支`)
        if (row.academies !== (start === 'chal' && pool.some((c) => isAcademy(c, year)))) fail(`${label}：开局表对「是不是二队」说得不对`)
      }
    }
  }
  const kb = JSON.stringify(sheet).length / 1024
  if (kb > 16) fail(`开局表有 ${kb.toFixed(1)} KB：首页随页面一起下载它，应该是几 KB 的小表`)
  console.log(`开局页的表：${rows} 格，和引擎说的一致，${kb.toFixed(1)} KB`)
}

// the report itself
{
  const g = createCareer({ name: 'Report', region: 'Americas', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 1, year: 2021 })
  if (!within(g.me!.region, 'Americas')) fail(`2021 美洲天梯开局开在了 ${g.me!.region}`)
  console.log(`2021 美洲天梯开局：开在${cn(g.me!.region)} · ${g.me!.log[1]?.text ?? ''}`)
}

console.log(fails ? `\n✗ ${fails} 项不对。` : `\n✓ 每个地区名 × 每种开局 × 两个入口年份：能按的都开得了，灰掉的引擎也说清楚不开，没有一处崩。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
