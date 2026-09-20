/**
 * 年龄曲线与三个门 — measure only, changes nothing.
 *
 * Companion to scripts/probe_balance.ts, written for the 2026-09-20 rebalance.
 * That one measures the player, his team-mates and the world's rating
 * distribution; this one measures the two curves the rebalance turns on
 * (engine/age.ts) and the three starting doors the age curve tilts between:
 *
 *   npx tsx scripts/probe_age.ts curve                           the two curves, no simulation
 *   npx tsx scripts/probe_age.ts veteran                         a diligent career against a lazy one, 22 → 36
 *   npx tsx scripts/probe_age.ts owes   [n]                      who the yearly cap owes the most, and how much
 *   npx tsx scripts/probe_age.ts real   [handle ...]             a named veteran's 枪法 at 30, old curve against new
 *   npx tsx scripts/probe_age.ts ages   <year> <years> <out>     the world's mean attribute by age, year by year
 *   npx tsx scripts/probe_age.ts doors  <year> <runs> <years> <out>   the three doors, end to end
 *
 * Neither script enters check:me. The rules the rebalance must keep are in
 * scripts/check_balance.ts.
 */
import { writeFileSync } from 'node:fs'
import { FALL_MAX, HOLD_MAX, HOLD_TALENT, HOLD_WORK, LATE_FROM, TALENT_SPREAD, TURN, attrDrift, holdOff, trainAgeMul } from '../src/engine/age'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, Player, Region, Role } from '../src/engine/types'
import { seasonRollover } from '../src/engine/training'
import { Rng, hashStr } from '../src/engine/rng'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const job = process.argv[2] ?? 'curve'
const K = ATTR_KEYS
const med = (xs: number[]): number => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)

/* ---------------------------------------------------------------- curve */

if (job === 'curve') {
  console.log('TURN', JSON.stringify(TURN), 'LATE_FROM', LATE_FROM, 'FALL_MAX', FALL_MAX)
  console.log('HOLD work', HOLD_WORK, 'talent', HOLD_TALENT, 'max', HOLD_MAX)
  console.log('')
  console.log('age  train   ' + K.map((k) => k.slice(0, 5).padStart(6)).join(''))
  for (let a = 16; a <= 36; a++) {
    const row = K.map((k) => attrDrift({ age: a, isIgl: true }, k).toFixed(2).padStart(6)).join('')
    console.log(String(a).padStart(3) + trainAgeMul(a).toFixed(2).padStart(7) + '   ' + row)
  }
}

/* ---------------------------------------------------------------- veteran */

/** A player good enough to be in a league, built around `top`. */
function make(id: string, age: number, top: keyof Attrs): Player {
  const attrs = {} as Attrs
  for (const k of K) attrs[k] = k === top ? 88 : 74
  return {
    id, ign: id, teamId: 'T', region: 'EMEA' as Region, role: '决斗者' as Role, age, isIgl: false,
    attrs, overall: 80, potential: 92, form: 70, morale: 75, fatigue: 20, salary: 0, value: 0,
    contractYears: 2, loyalty: 60, ambition: 60, xp: {} as Record<keyof Attrs, number>,
    injuredUntil: 0, career: { maps: 0, clutches: 0 },
    season: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 },
  } as unknown as Player
}

if (job === 'veteran') {
  // seasonRollover alone, no training and no matches: what time takes, and how much of it work and talent hold off
  const rows: Record<string, number>[] = []
  for (let seed = 0; seed < 240; seed++) {
    const diligent = make('D', 22, 'aim')
    const lazy = make('L', 22, 'utility')
    const state = {
      year: 2030, seed, players: { D: diligent, L: lazy }, teams: {}, myTeam: '',
      training: { D: 'aim' as const, L: 'rest' as const },
    } as unknown as GameState
    for (let y = 0; y < 15; y++) {
      const rng = new Rng(hashStr(`vet:${seed}:${y}`))
      seasonRollover(state, rng)
      rows.push({
        age: diligent.age, dAim: diligent.attrs.aim, lAim: lazy.attrs.aim,
        dReact: diligent.attrs.reaction, lReact: lazy.attrs.reaction,
        dAware: diligent.attrs.awareness, lAware: lazy.attrs.awareness,
      })
    }
  }
  console.log('age   枪法 勤练+天赋 / 混日子      反应 勤 / 混      意识 勤 / 混')
  for (let a = 23; a <= 36; a++) {
    const r = rows.filter((x) => x.age === a)
    if (!r.length) continue
    console.log(
      String(a).padStart(3),
      mean(r.map((x) => x.dAim)).toFixed(1).padStart(8), mean(r.map((x) => x.lAim)).toFixed(1).padStart(8), '   ',
      mean(r.map((x) => x.dReact)).toFixed(1).padStart(6), mean(r.map((x) => x.lReact)).toFixed(1).padStart(6), '   ',
      mean(r.map((x) => x.dAware)).toFixed(1).padStart(6), mean(r.map((x) => x.lAware)).toFixed(1).padStart(6),
    )
  }
  const one = make('X', 30, 'aim')
  const st = { training: { X: 'aim' } } as unknown as GameState
  console.log('\nholdOff at 30 for his own best attribute, training it:', holdOff(st, one, 'aim').toFixed(2))
  console.log('holdOff for an attribute he is worst at and does not train:', holdOff({ training: {} } as unknown as GameState, one, 'communication').toFixed(2))
}

/* ---------------------------------------------------------------- owes / real */

interface TRating { o: number; p: number; i?: number }
interface TDebut { ign: string; age: number }
interface TYear { ratings: Record<string, TRating>; debuts: Record<string, TDebut> }
const BOOK = (await import('../src/data/timeline.json')).default as unknown as { meta: { years: number[] }; years: Record<string, TYear> }

/** Who the yearly cap owes the most: where the book ends up against where a capped career gets to. */
if (job === 'owes') {
  const { rulerShift } = await import('../src/engine/ruler')
  const { IGL_BONUS } = await import('../src/engine/player')
  const { ratingStep } = await import('../src/engine/timeline')
  const years = BOOK.meta.years
  const ign = new Map<string, string>()
  const born = new Map<string, { year: number; age: number }>()
  for (const y of years) for (const [id, d] of Object.entries(BOOK.years[String(y)].debuts)) {
    if (!born.has(id)) { born.set(id, { year: y, age: d.age }); ign.set(id, d.ign) }
  }
  const rows: { id: string; ign: string; book: number; capped: number; owed: number; first: number; last: number; from: number }[] = []
  for (const [id, b] of born) {
    let held: number | null = null
    let first = 0
    let book = 0
    let last = 0
    let from = 0
    for (const y of years) {
      const r = BOOK.years[String(y)].ratings[id]
      if (!r) continue
      const target = r.o + rulerShift(y, id) + (r.i ? IGL_BONUS : 0)
      const age = b.age + (y - b.year)
      if (held == null) { held = target; first = target; from = y }
      else held = held + Math.max(-ratingStep(age), Math.min(ratingStep(age), target - held))
      book = target
      last = y
    }
    if (held == null || last === from) continue
    rows.push({ id, ign: ign.get(id) ?? id, book, capped: Math.round(held), owed: book - Math.round(held), first, last, from })
  }
  const n = Number(process.argv[3] ?? 20)
  const up = rows.slice().sort((a, b) => b.owed - a.owed).slice(0, n)
  const down = rows.slice().sort((a, b) => a.owed - b.owed).slice(0, Math.min(8, n))
  console.log(`${rows.length} 个被书评过两年以上的真实选手，限幅之后离书的终点差多少`)
  console.log('  欠得最多（书说他涨到这里，限幅只走到这里）：')
  for (const r of up) console.log(`    ${r.ign.padEnd(14)} ${r.from}–${r.last}  起 ${r.first} · 书 ${r.book} · 限幅后 ${r.capped}  欠 ${r.owed}`)
  console.log('  反向最多（书说他跌到这里，限幅还没跌完）：')
  for (const r of down) console.log(`    ${r.ign.padEnd(14)} ${r.from}–${r.last}  起 ${r.first} · 书 ${r.book} · 限幅后 ${r.capped}  差 ${r.owed}`)
  const owed = rows.map((r) => Math.abs(r.owed)).sort((a, b) => a - b)
  console.log(`  全体 |欠|：中位 ${owed[Math.floor(owed.length / 2)]} · p90 ${owed[Math.floor(owed.length * 0.9)]} · 最大 ${owed[owed.length - 1]} · 一点不欠的 ${owed.filter((v) => v === 0).length}/${owed.length}`)
}

/** 老曲线 against 新曲线 on a named real veteran's 枪法, winter by winter. */
if (job === 'real') {
  // the curve as it stood at 36f7ab7, for the comparison: one number for all eight,
  // and the winter took 0-2 points off 枪法/反应 with probability |drift|/2
  const oldDrift = (age: number): number =>
    (age <= 21 ? 1.0 : age <= 24 ? 0.65 : age <= 26 ? 0.3 : age <= 28 ? -0.25 : age <= 30 ? -0.9 : -1.6)
  const oldFall = (age: number, k: keyof Attrs): number => {
    const d = oldDrift(age)
    return d >= 0 ? 0 : Math.abs(d) * 0.5 * (k === 'aim' || k === 'reaction' ? 1 : 0.5)
  }
  const newFall = (age: number, k: keyof Attrs, hold: number): number =>
    Math.max(0, -attrDrift({ age, isIgl: false }, k)) * (1 - hold)

  const names = process.argv.slice(3)
  const want = names.length ? names : ['Boaster', 'Derke', 'aspas', 'MaKo', 'Chronicle']
  const last = BOOK.meta.years[BOOK.meta.years.length - 1]
  const Y = BOOK.years[String(last)]
  const byIgn = new Map<string, string>()
  for (const y of BOOK.meta.years) for (const [id, d] of Object.entries(BOOK.years[String(y)].debuts)) byIgn.set(d.ign, id)
  const ageOf = new Map<string, number>()
  for (const y of BOOK.meta.years) for (const [id, d] of Object.entries(BOOK.years[String(y)].debuts)) if (!ageOf.has(id)) ageOf.set(id, d.age + (last - y))
  const ATTRS = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl'] as (keyof Attrs)[]
  const raw = (await import('../src/data/timeline.json')).default as unknown as { years: Record<string, { ratings: Record<string, { a: number[] }> }> }
  for (const handle of want) {
    const id = byIgn.get(handle)
    const r = id ? Y.ratings[id] : undefined
    const a = id ? raw.years[String(last)].ratings[id]?.a : undefined
    if (!id || !r || !a) { console.log(`${handle}: 书里 ${last} 年没有他`); continue }
    const age0 = ageOf.get(id)!
    const aim0 = a[ATTRS.indexOf('aim')]
    // how much of the fall he holds off: 枪法 against his own eight, and he is training it
    const meanAttr = ATTRS.reduce((s, k, i) => s + a[i], 0) / 8
    const talent = Math.max(0, Math.min(1, (aim0 - meanAttr) / TALENT_SPREAD + 0.5))
    const holdBest = Math.min(HOLD_MAX, HOLD_WORK + HOLD_TALENT * talent)
    const holdLazy = Math.min(HOLD_MAX, HOLD_TALENT * talent)
    let o = aim0
    let nBest = aim0
    let nLazy = aim0
    const line: string[] = []
    for (let age = age0 + 1; age <= 34; age++) {
      o -= oldFall(age, 'aim')
      nBest -= newFall(age, 'aim', holdBest)
      nLazy -= newFall(age, 'aim', holdLazy)
      if (age === 27 || age === 30 || age === 32 || age === 34) line.push(`${age} 岁：老 ${o.toFixed(1)} · 新勤练 ${nBest.toFixed(1)} · 新混日子 ${nLazy.toFixed(1)}`)
    }
    console.log(`${handle}（${last} 年 ${age0} 岁，枪法 ${aim0}，压慢 ${holdBest.toFixed(2)} / ${holdLazy.toFixed(2)}）`)
    for (const l of line) console.log('    ' + l)
  }
}

/* ---------------------------------------------------------------- ages / doors */

const playOut = (state: GameState, years: number, onYear?: (s: GameState) => void): void => {
  const me = state.me!
  const y0 = state.year
  let weeks = 0
  while (state.year < y0 + years && me.phase !== 'retired' && weeks < years * 60) {
    const yr = state.year
    const stop = autoWeek(state)
    weeks++
    if (state.year !== yr) onYear?.(state)
    if (stop.kind === 'game-over') break
  }
}

if (job === 'ages') {
  const year = Number(process.argv[3] ?? 2026)
  const years = Number(process.argv[4] ?? 8)
  const out = process.argv[5] ?? 'ages.json'
  const state = createCareer({
    name: 'Age', region: year === 2021 ? 'Europe' : 'EMEA', role: '决斗者',
    talents: emptyTalents(), originKey: 'net', start: 'chal', seed: 7777, year,
  })
  const snap = (s: GameState) => {
    const by: Record<number, Record<string, number[]>> = {}
    for (const p of Object.values(s.players)) {
      if (!p.teamId || s.teams[p.teamId]?.dormant || p.id === s.me?.id) continue
      const b = (by[p.age] ??= {})
      for (const k of K) (b[k] ??= []).push(p.attrs[k])
      ;(b.overall ??= []).push(p.overall)
    }
    return Object.fromEntries(Object.entries(by)
      .filter(([, v]) => v.overall.length >= 8)
      .map(([a, v]) => [a, { n: v.overall.length, ...Object.fromEntries(Object.entries(v).map(([k, xs]) => [k, +mean(xs).toFixed(2)])) }]))
  }
  const rows: unknown[] = [{ year: state.year, by: snap(state) }]
  playOut(state, years, (s) => rows.push({ year: s.year, by: snap(s) }))
  writeFileSync(out, JSON.stringify({ year, years, rows }, null, 1))
  console.log('ages written')
}

if (job === 'doors') {
  const year = Number(process.argv[3] ?? 2026)
  const runs = Number(process.argv[4] ?? 4)
  const years = Number(process.argv[5] ?? 9)
  const outPath = process.argv[6] ?? 'doors.json'
  const REGIONS: Region[] = year === 2021
    ? ['Europe', 'North America', 'Korea', 'Brazil'] : ['EMEA', 'Americas', 'Pacific', 'China']
  const rows: unknown[] = []
  const t0 = Date.now()
  for (const start of ['pre', 'chal', 't1'] as StartPoint[]) {
    for (let i = 0; i < runs; i++) {
      const seed = 5000 + i * 97
      let state: GameState
      try {
        state = createCareer({
          name: `Door${i}`, region: REGIONS[i % 4], role: '决斗者',
          talents: emptyTalents(), originKey: 'net', start, seed, year,
        })
      } catch (e) { process.stderr.write(`${start} ${i} skipped: ${String(e)}\n`); continue }
      const me = state.me!
      const p = state.players[me.id]
      let crashed = ''
      let proAt = 0
      try {
        playOut(state, years, (s) => { if (!proAt && s.me!.phase === 'pro') proAt = s.year })
      } catch (e) { crashed = String((e as Error).message ?? e).slice(0, 100) }
      rows.push({
        start, seed, region: REGIONS[i % 4], end: p.overall, pot: p.potential, age: p.age,
        proAt, titles: me.titles?.length ?? 0, seasons: me.seasons?.length ?? 0,
        ending: me.ending?.title ?? me.phase, crashed,
      })
      process.stderr.write(`${start} ${i + 1}/${runs} → ${p.overall} (cap ${p.potential}) ${crashed}\n`)
    }
  }
  writeFileSync(outPath, JSON.stringify({ year, runs, years, secs: Math.round((Date.now() - t0) / 1000), rows }, null, 1))
  for (const start of ['pre', 'chal', 't1']) {
    const r = (rows as { start: string; end: number; pot: number }[]).filter((x) => x.start === start)
    console.log(start, 'n', r.length, 'end median', med(r.map((x) => x.end)), 'range', Math.min(...r.map((x) => x.end)), '-', Math.max(...r.map((x) => x.end)), 'cap median', med(r.map((x) => x.pot)))
  }
}
