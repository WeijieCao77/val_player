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
 *   npx tsx scripts/probe_age.ts ages   <year> <years> <out>     the world's mean attribute by age, year by year
 *   npx tsx scripts/probe_age.ts doors  <year> <runs> <years> <out>   the three doors, end to end
 *
 * Neither script enters check:me. The rules the rebalance must keep are in
 * scripts/check_balance.ts.
 */
import { writeFileSync } from 'node:fs'
import { FALL_MAX, HOLD_MAX, HOLD_WORK, HOLD_TALENT, LATE_FROM, TURN, attrDrift, holdOff, trainAgeMul } from '../src/engine/age'
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
