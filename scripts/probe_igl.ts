/**
 * Callers and cohesion, measured: paired careers that differ only in their talent.
 *
 *   npx tsx scripts/probe_igl.ts dist                                        the world's 指挥 / 沟通 / 协同 by tier, callers and not
 *   npx tsx scripts/probe_igl.ts run <out.jsonl> [builds] [roles] [seeds] [seasons=6] [pol=auto]
 *                                                                            careers from a 2026 Challengers start, one JSON line each
 *   npx tsx scripts/probe_igl.ts report <a.jsonl> [b.jsonl]                  each build against 均衡型 on the same seed, role and policy;
 *                                                                            with b, b − a as well
 *
 * builds: even (均衡型 2+2), igl (the 指挥型 preset), iglmax (指挥 8 · 沟通 6 · 协同 4), social (协同 8 · 沟通 8)
 * builds: gun (the 枪法型 preset) as well
 * pol:    auto — left on 快进 (me/auto.ts autoWeek)
 *         role — the same, with the steady plan's talent session off (autoPlan's `talent` false): the role's three sessions
 *         call — a player chasing the calls: the same steady plan, with its 排位 points spent on a 跟队训练赛 and a
 *                双排 with the club's caller instead; the 综合 hours stay
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { createCareer, emptyTalents, TALENT_PRESETS } from '../src/engine/me/career'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import type { MeAction } from '../src/engine/me/types'
import { advanceWeek, setPlan } from '../src/engine/me/week'
import type { WeekStop } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { clubCaller } from '../src/engine/me/igl'
import { bondBetween, squadHarmony } from '../src/engine/bonds'
import { callerOf, squadOf } from '../src/engine/roster'
import type { Attrs, GameState, Player, Region, Role } from '../src/engine/types'

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

const q = (a: number[], f: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN }
const band = (a: number[]) => `n ${a.length} · p10 ${q(a, 0.1)} · p50 ${q(a, 0.5)} · p90 ${q(a, 0.9)}`
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)

type T = Record<keyof Attrs, number>
export const BUILDS: Record<string, T> = {
  even: emptyTalents(),
  igl: { ...TALENT_PRESETS.find((x) => x.key === 'igl')!.t },
  gun: { ...TALENT_PRESETS.find((x) => x.key === 'gun')!.t },
  iglmax: { aim: 1, reaction: 0, awareness: 1, utility: 0, clutch: 0, teamwork: 4, communication: 6, igl: 8 },
  social: { aim: 1, reaction: 1, awareness: 1, utility: 1, clutch: 0, teamwork: 8, communication: 8, igl: 0 },
}
const REGION_OF: Record<number, Region> = { 7: 'Americas', 8: 'Pacific', 9: 'EMEA', 10: 'China', 11: 'Americas', 12: 'Pacific' }

type Pol = 'auto' | 'call' | 'role'

export interface Row {
  build: string; role: Role; seed: number; pol?: Pol
  start: number; peak: number; final: number
  signed: number; firstVct: number; vctSeasons: number
  proWeeks: number; startShare: number
  teamWin: number; startWin: number; matches: number
  /** my rating and ACS rank on my side, over the official matches I started */
  rating?: number; rank?: number
  titles: number; intl: number
  bond: number; harmony: number; form: number; conflicts: number
  /** of conflicts: arguments after a match (赛后起了争执), and the weekly 「关系还没缓和」 notes, naming me */
  argues?: number; feuds?: number
  /** of argues, the ones where I was the one who carried (named first) */
  carried?: number
  /** my eight at the end */
  attrs?: Attrs
  /** action points the week's plan put on each action, over the professional weeks */
  hours?: Record<string, number>
  iglWeeks: number; iglYear: number; offers: number; declines: number; revokes: number
  igl: number; comm: number; tw: number
  trust?: number; firstCall?: number
  secs: number
}

/**
 * A player chasing the calls: the steady plan (autoPlan), with its 排位 points spent on a 跟队训练赛 and a
 * 双排 with the club's caller instead — the 综合 hours stay. Everything else as 快进 plays it.
 */
function callerWeek(state: GameState, hours: Record<string, number>): WeekStop {
  const me = state.me!
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state)
  if (me.phase === 'pro' && state.myTeam) {
    let guard = 0
    while ((me.plan.ranked ?? 0) > 0 && me.ap < 3 && guard++ < 6) setPlan(state, 'ranked', -1)
    if (me.ap >= 3) setPlan(state, 'scrim', 1)
    if ((me.plan.ranked ?? 0) > 0 && me.ap < 1) setPlan(state, 'ranked', -1)
    const mate = clubCaller(state) ?? squadOf(state, state.myTeam).find((x) => x.id !== me.id)
    if (mate && me.ap >= 1 && setPlan(state, 'duo', 1) === null) me.duoWith = mate.id
  }
  return playWeek(state, hours, clear)
}

/** The week as 快进 plays it (me/auto.ts autoWeek), step for step, with the plan's hours written down. */
function steadyWeek(state: GameState, hours: Record<string, number>, talent = true): WeekStop {
  const me = state.me!
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state, talent)
  return playWeek(state, hours, clear)
}

function playWeek(state: GameState, hours: Record<string, number>, clear: () => void): WeekStop {
  const me = state.me!
  if (me.phase === 'pro' && state.myTeam) {
    for (const [k, n] of Object.entries(me.plan)) if (n) hours[k] = (hours[k] ?? 0) + n * ACTION_BY_KEY[k as MeAction].cost
  }
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    else clear()
    stop = advanceWeek(state)
  }
  return stop
}

function career(build: string, role: Role, seed: number, seasons: number, pol: Pol = 'auto'): Row {
  const t0 = Date.now()
  const state = createCareer({ name: `P${seed}`, region: REGION_OF[seed] ?? 'EMEA', role, talents: BUILDS[build], originKey: 'netcafe', start: 'chal', seed, year: 2026 })
  const me = state.me!
  const p: Player = state.players[me.id]
  const start = p.overall
  let peak = p.overall
  let weeks = 0
  let signed = 0
  let firstVct = 0
  const vctYears = new Set<number>()
  let proWeeks = 0, startWeeks = 0, iglWeeks = 0, iglYear = 0, conflicts = 0, argues = 0, carried = 0, feuds = 0, firstCall = 0
  const bonds: number[] = [], harm: number[] = [], forms: number[] = [], trust: number[] = []
  const hours: Record<string, number> = {}
  while (state.year < 2026 + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
    const stop = pol === 'call' ? callerWeek(state, hours) : steadyWeek(state, hours, pol !== 'role')
    weeks++
    peak = Math.max(peak, p.overall)
    if (!firstCall && p.isIgl && p.iglSource === 'appointed') firstCall = weeks
    if (me.phase === 'pro' && state.myTeam) {
      const team = state.teams[state.myTeam]
      if (!signed) signed = state.year
      if (team.tier === 1) { vctYears.add(state.year); if (!firstVct) firstVct = state.year }
      proWeeks++
      trust.push(me.coachTrust)
      if (team.starters.includes(me.id)) startWeeks++
      const mates = team.roster.filter((id) => id !== me.id)
      if (mates.length) bonds.push(mean(mates.map((id) => bondBetween(state, me.id, id))))
      harm.push(squadHarmony(state, state.myTeam))
      forms.push(p.form)
      if (p.isIgl && callerOf(state, state.myTeam)?.id === me.id) { iglWeeks++; if (!iglYear) iglYear = state.year }
      const mine = me.weekNotes.filter((n) => n.includes('💢') && n.includes(p.ign))
      conflicts += mine.length
      argues += mine.filter((n) => n.includes('赛后起了争执')).length
      carried += mine.filter((n) => n.includes('赛后起了争执') && n.startsWith(`💢 ${p.ign} 和`)).length
      feuds += mine.filter((n) => n.includes('关系还没缓和')).length
    }
    if (stop.kind === 'game-over') break
  }
  const official = me.matches.filter((m) => !m.friendly && !m.drawn)
  const started = official.filter((m) => m.started)
  const book = me.igl
  return {
    build, role, seed, pol, start, peak, final: p.overall,
    signed, firstVct, vctSeasons: vctYears.size,
    proWeeks, startShare: proWeeks ? startWeeks / proWeeks : 0,
    rating: mean(started.map((m) => m.rating)), rank: mean(started.map((m) => m.rank)),
    teamWin: official.length ? official.filter((m) => m.won).length / official.length : 0,
    startWin: started.length ? started.filter((m) => m.won).length / started.length : 0,
    matches: official.length,
    titles: me.titles.filter((x) => x.started).length,
    intl: me.titles.filter((x) => x.started && /Masters|Champions|大师赛|冠军赛/.test(x.title)).length,
    bond: mean(bonds), harmony: mean(harm), form: mean(forms), conflicts, argues, carried, feuds, hours, attrs: { ...p.attrs },
    iglWeeks, iglYear, offers: book?.offers ?? 0, declines: book?.declines ?? 0, revokes: book?.revokes ?? 0,
    igl: p.attrs.igl, comm: p.attrs.communication, tw: p.attrs.teamwork,
    trust: mean(trust), firstCall,
    secs: Math.round((Date.now() - t0) / 1000),
  }
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-')
const sg = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '-')
const COLS: [keyof Row, string, number][] = [
  ['start', '起点', 1], ['peak', '峰值综合', 1], ['firstVct', '首个VCT年', 1], ['vctSeasons', 'VCT赛季', 1],
  ['startShare', '首发周%', 100], ['teamWin', '队伍胜率%', 100], ['titles', '冠军(首发)', 1], ['intl', '国际冠军', 1],
  ['bond', '和队友关系', 1], ['harmony', '全队关系', 1], ['form', '状态', 1], ['conflicts', '💢合计', 1], ['argues', '赛后争执', 1], ['feuds', '还没缓和', 1],
  ['trust', '教练信任', 1], ['iglWeeks', '主指挥周', 1], ['revokes', '被收回', 1], ['igl', '末指挥', 1], ['comm', '末沟通', 1],
]
const vctOf = (r: Row) => (r.firstVct || 2033)
const valueOf = (r: Row, k: keyof Row) => (k === 'firstVct' ? vctOf(r) : Number(r[k] ?? NaN))
const groupOf = (r: Row) => `${r.role} ${r.build} ${r.pol ?? 'auto'}`

function report(rows: Row[], label: string): Map<string, number[]> {
  const out = new Map<string, number[]>()
  console.log(`\n${label}: ${rows.length} careers`)
  const groups = [...new Set(rows.map(groupOf))]
  console.log(`group | n | ${COLS.map((c) => c[1]).join(' | ')}`)
  for (const g of groups) {
    const rs = rows.filter((r) => groupOf(r) === g)
    console.log(`${g} | ${rs.length} | ${COLS.map(([k, , m]) => f1(mean(rs.map((r) => valueOf(r, k) * m)))).join(' | ')}`)
  }
  console.log(`\npaired against even on the same seed, role and policy (first VCT: no VCT by 2032 counts as 2033)`)
  console.log(`group | ${COLS.map((c) => c[1]).join(' | ')}`)
  for (const g of groups) {
    const rs = rows.filter((r) => groupOf(r) === g)
    if (rs[0].build === 'even') continue
    const diffs = COLS.map(([k, , m]) => {
      const d: number[] = []
      for (const r of rs) {
        const e = rows.find((x) => x.role === r.role && x.build === 'even' && (x.pol ?? 'auto') === (r.pol ?? 'auto') && x.seed === r.seed)
        if (e) d.push((valueOf(r, k) - valueOf(e, k)) * m)
      }
      out.set(`${g}|${String(k)}`, d)
      return `${sg(mean(d))} [${d.map((x) => sg(x)).join(' ')}]`
    })
    console.log(`${g} | ${diffs.join(' | ')}`)
  }
  return out
}

const mode = process.argv[2] ?? 'dist'
if (mode === 'dist') {
  for (const year of [2021, 2026]) {
    const state = createCareer({ name: 'Probe', region: 'EMEA', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7, year })
    for (const tier of [1, 2]) {
      const on = (p: Player) => !!p.teamId && state.teams[p.teamId]?.tier === tier && p.id !== state.me!.id
      const callers = Object.values(state.players).filter((p) => on(p) && p.isIgl)
      const rest = Object.values(state.players).filter((p) => on(p) && !p.isIgl)
      console.log(`${year} T${tier} callers  指挥 ${band(callers.map((p) => p.attrs.igl))} | 沟通 ${band(callers.map((p) => p.attrs.communication))} | 协同 ${band(callers.map((p) => p.attrs.teamwork))}`)
      console.log(`${year} T${tier} others   指挥 ${band(rest.map((p) => p.attrs.igl))} | 沟通 ${band(rest.map((p) => p.attrs.communication))} | 协同 ${band(rest.map((p) => p.attrs.teamwork))}`)
    }
  }
} else if (mode === 'run') {
  const out = process.argv[3]
  const builds = (process.argv[4] ?? 'even,igl,iglmax,social').split(',')
  const roles = (process.argv[5] ?? '控场,决斗者').split(',') as Role[]
  const seeds = (process.argv[6] ?? '7,8,9').split(',').map(Number)
  const seasons = Number(process.argv[7] ?? 6)
  const pol = (process.argv[8] ?? 'auto') as Pol
  for (const role of roles) for (const seed of seeds) for (const b of builds) {
    const r = career(b, role, seed, seasons, pol)
    appendFileSync(out, `${JSON.stringify(r)}\n`)
    process.stderr.write(`${role} ${b} ${pol} seed ${seed}: ${r.start}→${r.peak} vct ${r.firstVct || '-'} call ${r.iglWeeks}w from wk ${r.firstCall || '-'} revoked ${r.revokes} trust ${f1(r.trust ?? NaN)} starts ${(r.startShare * 100).toFixed(0)}% bond ${f1(r.bond)} form ${f1(r.form)} argue ${r.argues}+${r.feuds}/${r.conflicts} igl ${r.igl}/${r.comm} titles ${r.titles} · ${r.secs}s\n`)
  }
} else if (mode === 'report') {
  const read = (f: string): Row[] => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
  const a = report(read(process.argv[3]), process.argv[3])
  if (process.argv[4]) {
    const b = report(read(process.argv[4]), process.argv[4])
    console.log(`\nchange in the paired gap, ${process.argv[4]} − ${process.argv[3]} (mean)`)
    const keys = [...new Set([...b.keys()].map((k) => k.split('|')[0]))]
    console.log(`group | ${COLS.map((c) => c[1]).join(' | ')}`)
    for (const g of keys) console.log(`${g} | ${COLS.map(([k]) => sg(mean(b.get(`${g}|${String(k)}`) ?? []) - mean(a.get(`${g}|${String(k)}`) ?? []))).join(' | ')}`)
  }
}
