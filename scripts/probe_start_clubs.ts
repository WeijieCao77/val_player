/**
 * Where a club start opens. The new-career page no longer lists clubs to pick
 * (asked 2026-09-12: 「为什么还是显示谁来找我……这里是选择俱乐部」): the game assigns
 * one off the career's seed (engine/me/career.ts pickClub / startPool).
 *
 * For 2021 and 2026, every region a career can open in × 二队首发 (chal) and
 * 替补 (t1) × a run of seeds: the club each seed opens at, how often a
 * second-team start went to a top club's academy, and — on a world built once
 * per year — that every assigned club has somewhere to play that year
 * (engine/timeline.ts hasPlace). A region with no such club refuses rather than
 * opening somewhere else. Then a few careers are created in full, to show the
 * probe's draw is the one createCareer makes and that the first log line names
 * the club.
 *
 *   npx tsx scripts/probe_start_clubs.ts [seeds=8]
 */
import { assignStartClub, candidateClubs, careerRegions, createCareer, emptyTalents, isAcademy, startPool } from '../src/engine/me/career'
import { regionsOf } from '../src/engine/era'
import { hasPlace } from '../src/engine/timeline'
import { REGION_CN } from '../src/engine/types'
import type { Region } from '../src/engine/types'
import { hashStr } from '../src/engine/rng'

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

const SEEDS = Number(process.argv[2] ?? 8)
/**
 * Seeds the way the page makes them — a hash of the ID, the choices and the clock (career.ts createCareer) —
 * not 1, 2, 3: the career's xorshift stream barely moves its first roll for small seeds, so seeds 1…8 all
 * draw the same club, which no real career does.
 */
const seedOf = (i: number): number => hashStr(`Rookie|${i}|${1_757_000_000_000 + i * 7919}`) >>> 0
let fails = 0
const fail = (m: string) => { fails++; console.log(`  FAIL ${m}`) }
const cn = (r: Region) => REGION_CN[r] ?? r

type Start = 'chal' | 't1'
const samples: { year: 2021 | 2026; region: Region; start: Start; seed: number }[] = []

for (const year of [2021, 2026] as const) {
  const regions = year >= 2026
    ? careerRegions(year)
    : regionsOf(year).filter((r) => candidateClubs(r, 1, year).length + candidateClubs(r, 2, year).length > 0)
  // one world a year to ask hasPlace of: a ladder start builds all of it
  const world = createCareer({ name: 'Probe', region: regions[0], role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 1, year })
  console.log(`\n== ${year} · ${regions.length} 个地区 · ${SEEDS} 个种子`)
  let chal = 0
  let chalAcademy = 0
  let empty = 0
  for (const region of regions) {
    for (const start of ['chal', 't1'] as Start[]) {
      const label = `${cn(region)} ${start === 'chal' ? '二队' : '替补'}`
      const pool = startPool(region, start, year)
      if (!pool.length) {
        empty++
        console.log(`  ${label.padEnd(16)} 开季时没有可分配的俱乐部 → 开局按钮置灰`)
        try { assignStartClub(region, start, 1, year); fail(`${label}: an empty pool still assigned a club`) } catch { /* refused, as it should */ }
        continue
      }
      const academies = pool.filter((c) => isAcademy(c, year))
      const counts = new Map<string, number>()
      for (let i = 1; i <= SEEDS; i++) {
        const seed = seedOf(i)
        const id = assignStartClub(region, start, seed, year)
        counts.set(id, (counts.get(id) ?? 0) + 1)
        const t = world.teams[id]
        if (!t) fail(`${label} seed #${i}: ${id} is not in the ${year} world`)
        else if (!hasPlace(world, t)) fail(`${label} seed #${i}: ${t.name} has nowhere to play in ${year}`)
        if (start === 'chal') {
          chal++
          if (academies.some((c) => c.id === id)) chalAcademy++
        }
      }
      if (academies.length && [...counts.keys()].some((id) => !academies.some((c) => c.id === id))) fail(`${label}: a region with academies opened outside them`)
      const names = [...counts.entries()].sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${pool.find((c) => c.id === id)?.name ?? id}${academies.some((c) => c.id === id) ? '*' : ''}×${n}`)
      console.log(`  ${label.padEnd(16)} 候选 ${pool.length}${academies.length ? `（二队 ${academies.length}）` : ''}：${names.join('，')}`)
      if (start === 'chal' && academies.length && !samples.some((s) => s.year === year && s.start === 'chal')) samples.push({ year, region, start, seed: seedOf(3) })
      if (start === 'chal' && !academies.length && year === 2021 && !samples.some((s) => s.year === year && s.start === 'chal')) samples.push({ year, region, start, seed: seedOf(2) })
      if (start === 't1' && !samples.some((s) => s.year === year && s.start === 't1')) samples.push({ year, region, start, seed: seedOf(5) })
    }
  }
  console.log(`  二队首发共 ${chal} 局，进了一线队二队的 ${chalAcademy} 局（${chal ? Math.round((chalAcademy / chal) * 100) : 0}%）；开季时没有可分配俱乐部的 ${empty} 处（* = 一线队二队）`)
}

console.log('\n== createCareer 抽到的是同一家，第一行日志写出分到哪家')
for (const s of samples) {
  const g = createCareer({ name: 'Probe', region: s.region, role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: s.start, seed: s.seed, year: s.year })
  const want = assignStartClub(s.region, s.start, s.seed, s.year)
  const t = g.teams[g.myTeam]
  const first = g.me!.log[0]?.text ?? ''
  if (g.myTeam !== want) fail(`${s.year} ${cn(s.region)} ${s.start} seed ${s.seed}: createCareer opened at ${g.myTeam}, the draw says ${want}`)
  if (!t || !first.includes(t.name)) fail(`${s.year} ${cn(s.region)} ${s.start}: the first log line does not name the club`)
  if (t && !hasPlace(g, t)) fail(`${s.year} ${cn(s.region)} ${s.start}: ${t.name} has nowhere to play`)
  console.log(`  ${s.year} ${cn(s.region)} ${s.start} → ${t?.name}：「${first}」`)
}

console.log(fails ? `\nFAIL: ${fails}` : '\nok')
process.exit(fails ? 1 : 0)
