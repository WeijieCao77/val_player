/**
 * The age curve, measured (asked 2026-09-25: 「能力值提升太慢了」「22 23 岁就该迈入巅峰了然后再往后的话可以掉能力值」).
 * One career per call, so a run can be split across processes and RAM stays low:
 *
 *   npx tsx scripts/probe_age_curve.ts <out.jsonl> <role> <start> <seed> [year=2021] [seasons=14] [policy=auto] [talent=role]
 *
 * policy auto = 按推荐做完 every week (me/auto.ts autoWeek); casual = no targeted practice,
 * one ranked a week and the rest on stream / rest. talent role = the role's preset, even = emptyTalents.
 * Appends one JSON line: the player's 综合 and 枪法/反应 by age, when he first reached 80/85/90,
 * and each winter the world's VCT starters (p10/p50/p90, by age band). Read-only on the engine.
 */
import { appendFileSync } from 'node:fs'
import { freemem } from 'node:os'

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
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })

const [out, roleArg, start, seedS, yearS = '2021', seasonsS = '14', policy = 'auto', talent = 'role'] = process.argv.slice(2)
// ASCII aliases, for shells that mangle the role's own name
const ALIAS: Record<string, string> = { duelist: '决斗者', initiator: '先锋', controller: '控场', sentinel: '哨卫', flex: '自由人' }
const role = ALIAS[roleArg] ?? roleArg
if (!out || !role || !start || !seedS) { console.error('usage: <out.jsonl> <role> <start> <seed> [year] [seasons] [auto|casual] [role|even]'); process.exit(2) }

const { createCareer, emptyTalents } = await import('../src/engine/me/career')
const { ROLE_TALENT_PRESETS } = await import('../src/engine/me/talent')
const { autoWeek, autoResolve } = await import('../src/engine/me/auto')
const { advanceWeek, doAction } = await import('../src/engine/me/week')
const { MeMatch } = await import('../src/engine/me/matchplay')
import type { GameState, Role } from '../src/engine/types'
import type { StartPoint } from '../src/engine/me/talent'

const year = Number(yearS)
const seasons = Number(seasonsS)
const seed = Number(seedS)
const t0 = Date.now()
const s: GameState = createCareer({
  name: '年龄曲线', region: 'EMEA', role: role as Role, originKey: 'netcafe', start: start as StartPoint,
  year: year as 2021 | 2026, seed,
  talents: talent === 'even' ? emptyTalents() : { ...ROLE_TALENT_PRESETS[role as Role].t },
})
const me = s.me!
const P = () => s.players[me.id]

/** a player who shows up: one ranked a week, the rest streamed or rested */
function casualWeek(): string {
  let g = 0
  while (me.pending.length && g++ < 20) autoResolve(s, me.pending[0])
  if (me.phase === 'retired' || s.gameOver) return 'game-over'
  doAction(s, 'ranked')
  for (let i = 0; i < 12 && me.ap > 0; i++) {
    if (P().fatigue < 50 && doAction(s, 'stream') === null) continue
    if (doAction(s, 'rest') !== null) break
  }
  let stop = advanceWeek(s)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
    else { let h = 0; while (me.pending.length && h++ < 20) autoResolve(s, me.pending[0]) }
    stop = advanceWeek(s)
  }
  return stop.kind
}

const q = (xs: number[], f: number) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * f)] : null }
function world() {
  const st: number[] = []
  const band: Record<string, number[]> = { '≤21': [], '22-24': [], '25-27': [], '28-30': [], '31+': [] }
  for (const t of Object.values(s.teams)) {
    if (t.dormant || t.tier !== 1) continue
    for (const id of t.starters) {
      const p = s.players[id]
      if (!p || id === me.id) continue
      st.push(p.overall)
      const b = p.age <= 21 ? '≤21' : p.age <= 24 ? '22-24' : p.age <= 27 ? '25-27' : p.age <= 30 ? '28-30' : '31+'
      band[b].push(p.overall)
    }
  }
  const avg = (xs: number[]) => xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null
  return { year: s.year, n: st.length, p10: q(st, 0.1), p50: q(st, 0.5), p90: q(st, 0.9), ge90: st.filter((v) => v >= 90).length,
    band: Object.fromEntries(Object.entries(band).map(([k, v]) => [k, [v.length, avg(v)]])) }
}

const byAge: Record<number, { ovr: number; aim: number; reaction: number; awareness: number; utility: number; pot: number; last: number }> = {}
const first: Record<number, { week: number; age: number; year: number } | null> = { 80: null, 85: null, 90: null }
const worlds = [world()]
let peak = { ovr: 0, age: 0, week: 0 }
let peakAim = 0
let weeks = 0
const note = () => {
  const p = P()
  byAge[p.age] = { ovr: p.overall, aim: p.attrs.aim, reaction: p.attrs.reaction, awareness: p.attrs.awareness, utility: p.attrs.utility, pot: p.potential, last: me.week }
  for (const k of [80, 85, 90]) if (!first[k] && p.overall >= k) first[k] = { week: me.week, age: p.age, year: s.year }
  if (p.overall > peak.ovr) peak = { ovr: p.overall, age: p.age, week: me.week }
  peakAim = Math.max(peakAim, p.attrs.aim)
}
const startOvr = P().overall
const startPot = P().potential
note()
let reason = 'target'
while (s.year < year + seasons && weeks < seasons * 60) {
  if (freemem() / 1024 ** 2 < 500) { reason = 'low-ram'; break }
  const y0 = s.year
  const stop = policy === 'casual' ? casualWeek() : autoWeek(s).kind
  weeks++
  if (s.year !== y0) worlds.push(world())
  if (!s.players[me.id]) { reason = 'gone'; break }
  note()
  if (stop === 'game-over' || me.phase === 'retired') { reason = `retired:${String(s.gameOver ?? '').slice(0, 24)}`; break }
}
const row = {
  role, start, seed, year, seasons, policy, talent, reason, weeks, secs: Math.round((Date.now() - t0) / 1000),
  startOvr, startPot, startAge: byAge[Math.min(...Object.keys(byAge).map(Number))] ? Math.min(...Object.keys(byAge).map(Number)) : null,
  byAge, first, peak, peakAim, worlds, phase: me.phase,
}
appendFileSync(out, JSON.stringify(row) + '\n')
console.log(`${role} ${start} ${seed} ${policy}/${talent}: ${reason} ${weeks}w ${row.secs}s · ${startOvr} → peak ${peak.ovr}@${peak.age} · 80@${first[80]?.age ?? '-'} 90@${first[90]?.age ?? '-'} · ${Object.entries(byAge).map(([a, v]) => `${a}:${v.ovr}/${v.aim}`).join(' ')}`)
