/**
 * What a career's prize money comes to, season by season, and which events paid it.
 *
 * Only reads what every version of the prize code writes — the 「奖金分成到账」
 * log line and the ledger — so the same probe runs before and after a change to
 * the prize table and the two outputs can be laid side by side.
 *
 *   npx tsx scripts/probe_prizes.ts [career=all|0|1|2] [seasons=6]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

const CAREERS: { label: string; opts: Partial<CareerOpts> }[] = [
  { label: '天梯起步 · 2021 · 北美', opts: { region: 'North America', start: 'pre', year: 2021, seed: 11 } },
  { label: '挑战者起步 · 2026 · 欧洲', opts: { region: 'Europe', start: 'chal', year: 2026, seed: 7 } },
  { label: 'VCT 起步 · 2021 · 韩国', opts: { region: 'Korea', start: 't1', year: 2021, seed: 5 } },
]

const which = process.argv[2] ?? 'all'
const seasons = Number(process.argv[3] ?? 6)

function run(label: string, opts: Partial<CareerOpts>): void {
  const state: GameState = createCareer({
    name: 'Probe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe',
    ...opts,
  } as CareerOpts)
  const me = state.me!
  const year0 = state.year
  const seen = new WeakSet<object>()
  const byYear = new Map<number, { total: number; lines: string[]; share: string }>()
  const at = (y: number) => {
    let hit = byYear.get(y)
    if (!hit) { hit = { total: 0, lines: [], share: '' }; byYear.set(y, hit) }
    return hit
  }
  const note = () => {
    const p = state.players[me.id]
    const t = state.teams[p?.teamId ?? '']
    at(state.year).share = me.phase === 'pro' && t
      ? `${t.tag} · 分成 ${p.contract?.bonusShare ?? 0}% · ${t.roster.length} 人`
      : me.phase
  }
  let guard = 0
  while (state.year - year0 < seasons && guard++ < 70 * seasons) {
    const y = state.year
    const stop = autoWeek(state)
    for (const l of me.log) {
      if (seen.has(l)) continue
      seen.add(l)
      if (!l.text.includes('奖金分成到账')) continue
      const m = /\$([\d,]+)/.exec(l.text)
      const v = m ? Number(m[1].replace(/,/g, '')) : 0
      const row = at(l.year ?? y)
      row.total += v
      row.lines.push(l.text)
    }
    if (state.year === y) note()
    if (stop.kind === 'game-over') break
  }
  console.log(`\n=== ${label}（seed ${opts.seed}）${year0}–${state.year}`)
  let sum = 0
  for (let y = year0; y < year0 + seasons; y++) {
    const r = byYear.get(y)
    sum += r?.total ?? 0
    console.log(`  ${y}  $${(r?.total ?? 0).toLocaleString()}  ${r?.share ?? ''}`)
    for (const l of r?.lines ?? []) console.log(`        ${l}`)
  }
  console.log(`  合计 $${sum.toLocaleString()}`)
}

CAREERS.forEach((c, i) => {
  if (which === 'all' || which === String(i)) run(c.label, c.opts)
})
