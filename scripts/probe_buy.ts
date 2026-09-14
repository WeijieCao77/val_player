/**
 * Does money buy strength? The same career under different shopping, paired on
 * its seed: nothing bought, everything bought, and everything but one thing (or
 * one thing alone) — so the gap in peak 综合 can be put down to what caused it.
 *
 *   npx tsx scripts/probe_buy.ts run <variants> <seeds> <seasons> <start> <out.jsonl>
 *     variants: none | all | only:<part>[+<part>] | no:<part>[+<part>], comma-separated
 *     parts:    gear review psych talk lang flat physio trip agent
 *   npx tsx scripts/probe_buy.ts summary <a.jsonl,...>
 *
 * 「Everything」 is a player who buys whatever the shop sells the moment he can
 * afford it, keeping ¥2,000 back: all five slots to the flagship, all four
 * courses, the flat, the gold agent, and 理疗 / a short trip whenever there is
 * fatigue, tilt or a lay-off for them to take off (two a week, the shop's limit).
 * The week itself is 托管's steady week (me/auto.ts autoWeek), the shopping
 * done before it is planned, so the plan sees what the money bought.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { COURSES, GEAR_PRICE, GEAR_SLOTS, RELAX, buyCourse, buyGear, buyRelax, hireAgent } from '../src/engine/me/shop'
import { injuryHelpedBy, injuryStatus } from '../src/engine/me/injury'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region, Role } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

export const PARTS = ['gear', 'review', 'psych', 'talk', 'lang', 'flat', 'physio', 'trip', 'agent'] as const
export type Part = typeof PARTS[number]

export function partsOf(variant: string): Set<Part> {
  if (variant === 'none') return new Set()
  if (variant === 'all') return new Set(PARTS)
  const [how, list] = variant.split(':')
  const named = new Set(list.split('+') as Part[])
  return how === 'only' ? named : new Set(PARTS.filter((x) => !named.has(x)))
}

const KEEP = 2000
const price = (key: string) => RELAX.find((r) => r.key === key)!.price

/** Buy what `parts` allows, the moment it can be afforded. */
export function shopAll(state: GameState, parts: Set<Part>): void {
  const me = state.me!
  const p = state.players[me.id]
  const can = (n: number) => me.money - n >= KEEP
  if (parts.has('agent') && me.phase === 'pro' && me.agentTier < 2 && can(30000)) hireAgent(state, 2)
  if (parts.has('gear')) {
    for (const s of GEAR_SLOTS) {
      while ((me.gear[s.key] ?? 0) < 2 && can(GEAR_PRICE[(me.gear[s.key] ?? 0) + 1])) buyGear(state, s.key)
    }
  }
  for (const c of COURSES) if (parts.has(c.key as Part) && !me.courses.includes(c.key) && can(c.price)) buyCourse(state, c.key)
  if (parts.has('flat') && !me.flags.relax_flat && can(price('flat'))) buyRelax(state, 'flat')
  for (let i = 0; i < 2 && me.relaxUsed < 2; i++) {
    const tripUseful = injuryHelpedBy(state, 'trip') || me.tilt >= 20 || p.fatigue >= 30
    const physioUseful = injuryHelpedBy(state, 'physio') || p.fatigue >= 18 || me.tilt >= 4
    if (parts.has('trip') && tripUseful && can(price('trip'))) { buyRelax(state, 'trip'); continue }
    if (parts.has('physio') && physioUseful && can(price('physio'))) { buyRelax(state, 'physio'); continue }
    break
  }
}

export interface RunOut {
  seed: number; variant: string; region: string; role: string; start: string; seasons: number
  peak: number; peakYear: number; final: number; pot: number; ovrBySeason: number[]
  hours: Record<string, number>; weeksHurt: number; injuries: number; lasting: number
  mech: number; mile: number; exp: number; titles: number; starts: number; matches: number
  t1Weeks: number; ratingSum: number; proWeeks: number; fatigueSum: number; weeks: number
  spent: Record<string, number>; money: number; secs: number
}

/** autoWeek, with the shopping before the plan and the plan counted */
export function runCareer(seed: number, variant: string, region: Region, role: Role, start: StartPoint, seasons: number): RunOut {
  const t0 = Date.now()
  const parts = partsOf(variant)
  const state = createCareer({ name: 'BuyProbe', region, role, talents: emptyTalents(), originKey: 'netcafe', start, seed })
  const me = state.me!
  const p = state.players[me.id]
  const year0 = state.year
  const hours: Record<string, number> = {}
  let peak = p.overall, peakYear = state.year, weeks = 0, weeksHurt = 0, t1Weeks = 0, ratingSum = 0, proWeeks = 0, fatigueSum = 0
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  while (state.year - year0 < seasons && weeks < seasons * 60) {
    clear()
    if (me.phase === 'retired' || state.gameOver) break
    shopAll(state, parts)
    if (injuryStatus(state)) weeksHurt++
    autoPlan(state)
    for (const [k, n] of Object.entries(me.plan)) hours[k] = (hours[k] ?? 0) + (n ?? 0)
    let stop = advanceWeek(state)
    let guard = 0
    while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
      if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
      else clear()
      stop = advanceWeek(state)
    }
    weeks++
    fatigueSum += p.fatigue
    if (me.phase === 'pro') {
      proWeeks++
      const t = state.teams[state.myTeam]
      if (t?.tier === 1) t1Weeks++
      ratingSum += t?.rating ?? 0
    }
    if (p.overall > peak) { peak = p.overall; peakYear = state.year }
    if (stop.kind === 'game-over') break
  }
  const bn = me.bottleneck
  const sum = (o?: Partial<Record<string, number>>) => Object.values(o ?? {}).reduce((s: number, v) => s + (v ?? 0), 0)
  const spent: Record<string, number> = {}
  const led = me.ledger!
  for (const k of ['gear', 'course', 'relax', 'agent']) spent[k] = (led.cur.out[k as keyof typeof led.cur.out] ?? 0)
  const pro = me.seasons.filter((s) => s.tier > 0)
  return {
    seed, variant, region, role, start, seasons,
    peak, peakYear, final: p.overall, pot: p.potential, ovrBySeason: me.seasons.map((s) => s.overallTo),
    hours, weeksHurt, injuries: me.flags.injuries ?? 0, lasting: me.flags.injLasting ?? 0,
    mech: sum(bn?.mech), mile: sum(bn?.mile), exp: bn?.exp ?? 0,
    titles: me.titles.filter((t) => t.started).length, starts: pro.reduce((s, x) => s + x.starts, 0), matches: pro.reduce((s, x) => s + x.matches, 0),
    t1Weeks, ratingSum, proWeeks, fatigueSum, weeks,
    spent, money: me.money, secs: Math.round((Date.now() - t0) / 1000),
  }
}

const REGIONS: Region[] = ['EMEA', 'Americas', 'Pacific']
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) }

function summary(files: string[]): void {
  const rows = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunOut))
  const key = (r: RunOut) => `${r.seed}:${r.start}:${r.seasons}`
  const base = new Map(rows.filter((r) => r.variant === 'none').map((r) => [key(r), r]))
  const variants = [...new Set(rows.map((r) => r.variant))].filter((v) => v !== 'none')
  const hrs = (r: RunOut, k: string) => r.hours[k] ?? 0
  const train = (r: RunOut) => hrs(r, 'aim') + hrs(r, 'vod') + hrs(r, 'util') + hrs(r, 'ranked') + hrs(r, 'scrim')
  console.log('variant       | n | peak gap mean ± sd [min, max] | final gap | pot gap | train hrs gap | rest hrs gap | hurt wks gap | mech gap | mile gap | titles gap | starts gap | club rating gap')
  for (const v of variants) {
    const pairs = rows.filter((r) => r.variant === v && base.has(key(r))).map((r) => [r, base.get(key(r))!] as const)
    if (!pairs.length) continue
    const g = (f: (r: RunOut) => number) => pairs.map(([a, b]) => f(a) - f(b))
    const peak = g((r) => r.peak)
    const f1 = (xs: number[]) => `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(2)}`
    console.log(`${v.padEnd(13)} | ${pairs.length} | ${f1(peak)} ± ${sd(peak).toFixed(2)} [${Math.min(...peak)}, ${Math.max(...peak)}] | ${f1(g((r) => r.final))} | ${f1(g((r) => r.pot))} | ${f1(g(train))} | ${f1(g((r) => hrs(r, 'rest')))} | ${f1(g((r) => r.weeksHurt))} | ${f1(g((r) => r.mech))} | ${f1(g((r) => r.mile))} | ${f1(g((r) => r.titles))} | ${f1(g((r) => r.starts))} | ${f1(g((r) => (r.proWeeks ? r.ratingSum / r.proWeeks : 0)))}`)
  }
  // the same gap at shorter horizons: the best season-end 综合 within the first h seasons
  const upTo = (r: RunOut, h: number) => Math.max(...r.ovrBySeason.slice(0, h))
  console.log('\nvariant       | best season-end 综合 by season 3 / 4 / 5 / 6 / 8: gap mean ± sd')
  for (const v of variants) {
    const pairs = rows.filter((r) => r.variant === v && base.has(key(r))).map((r) => [r, base.get(key(r))!] as const)
    if (!pairs.length) continue
    const cells = [3, 4, 5, 6, 8].map((h) => {
      const xs = pairs.filter(([a, b]) => a.ovrBySeason.length >= h && b.ovrBySeason.length >= h).map(([a, b]) => upTo(a, h) - upTo(b, h))
      return xs.length ? `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(2)} ± ${sd(xs).toFixed(2)}` : '—'
    })
    console.log(`${v.padEnd(13)} | ${cells.join(' | ')}`)
  }
  console.log('\nper seed peaks:')
  const seeds = [...new Set(rows.map(key))]
  for (const s of seeds) console.log(`  ${s}  ${rows.filter((r) => key(r) === s).map((r) => `${r.variant} ${r.peak}(${r.peakYear})`).join(' · ')}`)
  void ATTR_KEYS
}

// run as a script only: scripts/check_buy.ts imports the careers above
const [mode, ...args] = (process.argv[1] ?? '').endsWith('probe_buy.ts') ? process.argv.slice(2) : ['import']
if (mode === 'import') {
  // imported
} else if (mode === 'run') {
  const [variants, seeds, seasons, start, out] = args
  for (const seed of seeds.split(',').map(Number)) {
    const region = REGIONS[seed % REGIONS.length]
    const role = ROLES[seed % ROLES.length]
    for (const v of variants.split(',')) {
      const r = runCareer(seed, v, region, role, start as StartPoint, Number(seasons))
      appendFileSync(out, JSON.stringify(r) + '\n')
      process.stderr.write(`seed ${seed} ${region} ${role} ${v}: peak ${r.peak} (${r.peakYear}) final ${r.final} pot ${r.pot} train ${r.hours.aim ?? 0}/${r.hours.vod ?? 0}/${r.hours.util ?? 0}/${r.hours.ranked ?? 0}/${r.hours.scrim ?? 0} rest ${r.hours.rest ?? 0} hurt ${r.weeksHurt} mech ${r.mech} mile ${r.mile} ${r.secs}s\n`)
    }
  }
} else if (mode === 'summary') {
  summary(args[0].split(','))
} else {
  console.log('npx tsx scripts/probe_buy.ts run <variants> <seeds> <seasons> <start> <out.jsonl> | summary <files>')
}
