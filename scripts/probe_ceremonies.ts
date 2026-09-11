/**
 * How many nights a year stop the clock? The design range is 4–8 a season,
 * every ceremony counted, and this prints it per season for a ladder start
 * and a pro start.
 *
 * Counted from the log, like check_ceremony: the log is what the player saw.
 * The autopilot skips every one of them, which is fine — skipping still
 * writes the line.
 *
 *   npx tsx scripts/probe_ceremonies.ts [seasons=6] [seed=7] [year=2021]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { CEREMONIES } from '../src/engine/me/ceremony'
import type { CerKind } from '../src/engine/me/types'
import type { EntryYear } from '../src/engine/era'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => {},
  key: () => null,
  length: 0,
}
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)
const year = Number(process.argv[4] ?? 2021) as EntryYear

const kinds = Object.keys(CEREMONIES) as CerKind[]

function run(start: StartPoint, region: 'China' | 'Europe'): void {
  const state = createCareer({
    name: 'Probe', region, role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start, seed, year,
  })
  const me = state.me!
  const y0 = state.year
  const rows = new Map<number, Partial<Record<CerKind, number>>>()
  // the diary keeps its last 400 lines, so by the end of a six-season run the
  // first year is gone: read it a week at a time, as it is written
  let last: (typeof me.log)[number] | undefined
  const read = () => {
    const from = last ? me.log.lastIndexOf(last) + 1 : 0
    for (const l of me.log.slice(from)) {
      const k = kinds.find((x) => l.text.includes(CEREMONIES[x].name))
      if (!k) continue
      const r = rows.get(l.year) ?? {}
      r[k] = (r[k] ?? 0) + 1
      rows.set(l.year, r)
    }
    last = me.log[me.log.length - 1] ?? last
  }
  let guard = 0
  while (state.year - y0 < seasons && guard++ < 60 * seasons) {
    const stop = autoWeek(state)
    read()
    if (stop.kind === 'game-over') break
  }
  for (let i = 0; i < 4 && (me.cer || me.pending.length); i++) { autoWeek(state); read() }
  console.log(`\n${START_LABEL[start]}（${region}，${y0} 开档，seed ${seed}）→ ${state.year}，结局：${me.ending?.title ?? '未退役'}`)
  console.log(`  年份  身份      场次   合计  ${kinds.map((k) => CEREMONIES[k].name).join(' · ')}`)
  for (let y = y0; y <= state.year; y++) {
    const r = rows.get(y) ?? {}
    const total = kinds.reduce((s, k) => s + (r[k] ?? 0), 0)
    const season = me.seasons.find((s) => s.year === y)
    const who = season ? (season.tier ? `${season.tier === 1 ? '一线' : '二线'}职业` : '无合同') : '—'
    // a season with few matches has few nights, and should: media days come before matches
    const games = season ? String(season.matches) : '—'
    console.log(`  ${y}  ${who.padEnd(6)}  ${games.padStart(4)}  ${String(total).padStart(3)}   ${kinds.map((k) => r[k] ?? 0).join(' · ')}`)
  }
}

const START_LABEL: Record<StartPoint, string> = { pre: '天梯开档', chal: '二线开档', t1: '一线替补开档' }

run('pre', 'China')
run('t1', 'China')
