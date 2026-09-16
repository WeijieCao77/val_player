/**
 * What the career-end card is actually handed.
 *
 * The card ranks its trophy wall with `/Champions/` and `/Masters/` regexes
 * (ui/me/Poster.tsx, ui/me/share.ts, me/nights.ts), but the timeline books a
 * competition under its Chinese name (engine/circuit.ts: `${year} 全球冠军赛`).
 * This prints the title strings a real save carries and what each ranking
 * method makes of them, so the mismatch is a fact rather than a reading.
 *
 *   npx tsx scripts/probe_endcard.ts [seasons=8] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { retire } from '../src/engine/me/endings'
import { compClass, isIntlComp } from '../src/engine/me/compclass'
import { compCn } from '../src/engine/me/compname'

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

const seasons = Number(process.argv[2] ?? 8)
const seed = Number(process.argv[3] ?? 7)

for (const [label, opts] of [
  ['2026 开局', { year: undefined }],
  ['2021 开局', { year: 2021 as const }],
] as const) {
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
    ...(opts.year ? { year: opts.year } : {}),
  })
  const me = state.me!
  const y0 = state.year
  let guard = 0
  while (state.year - y0 < seasons && guard++ < 60 * (seasons + 1)) {
    if (autoWeek(state).kind === 'game-over') break
  }
  if (!me.ending) retire(state, '探针')

  console.log(`\n=== ${label} · seed ${seed} · ${y0}–${state.year} · 「${me.ending?.title}」 ===`)
  if (!me.titles.length) { console.log('  （没有奖杯）'); continue }
  console.log('  stored                      compClass    intl   /Champions/ /Masters/  Poster 归档')
  for (const t of me.titles) {
    const cls = compClass(t.title)
    const cRe = /Champions/.test(t.title)
    const mRe = /Masters/.test(t.title)
    // exactly what ui/me/Poster.tsx does today
    const bucket = cRe ? 'c (金)' : mRe ? 'm (红)' : 'r (灰)'
    const truth = cls === 'champions' ? 'c (金)' : cls === 'masters' ? 'm (红)' : 'r (灰)'
    const ok = bucket === truth ? ' ' : '  ← 错'
    console.log(`  ${String(t.title).padEnd(26)} ${cls.padEnd(12)} ${String(isIntlComp(t.title)).padEnd(6)} `
      + `${String(cRe).padEnd(11)} ${String(mRe).padEnd(10)} ${bucket}${ok}  [${compCn(t.title)}]${t.started ? '' : ' 随队'}`)
  }
}
