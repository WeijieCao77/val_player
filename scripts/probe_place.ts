/**
 * 位置到底归谁管 — whose decision the career player's place in the five actually
 * is, measured on careers replayed the steady way (me/auto.ts autoPlan, the same
 * buttons a player presses).
 *
 * This is the number the dressing-room work kept running into
 * (scripts/probe_room.ts, me/room.ts): the room could not reach his place
 * because in nearly every week at a club his place was not the coach's to
 * decide — `promisedRole` or a trial seated him before coachView was ever read.
 * So it is measured on its own here, before and after the promise became a
 * floor of PROMISE_FLOOR matches rather than a standing guarantee.
 *
 * Three readings, every week at a club:
 *
 *  一 归谁管：the weeks his place is the contract's or a trial's, against the
 *    weeks the coach's own reading decides it. The contract's part is read off
 *    the engine (me/coach.ts promiseHolds) when that build has it, and off the
 *    old rule — a starting promise seats him for as long as it is written —
 *    when it does not, so one script measures both builds the same way.
 *
 *  二 隔多远：in the coach's own reading, room left out, how far he sits from
 *    the 5/6 line — the distance anything else would have to cover to move him.
 *    Reported over every week and over the weeks the coach decides.
 *
 *  三 换不换手：how often the five the coach names actually changes his place
 *    (me/coach.ts weeklyLineup, `lastLineupIn` — the same fact the week's log
 *    says out loud), split into falling out of the five and winning back in. A
 *    move between clubs is not a place changing hands and is not counted.
 *
 *   npx tsx scripts/probe_place.ts [seasons=3] [seeds=7,8] [roles=决斗者,控场] [starts=chal,t1]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import type { WeekStop } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import * as coachMod from '../src/engine/me/coach'
import { coachView } from '../src/engine/me/coach'
import { squadOf } from '../src/engine/roster'
import type { GameState, Region, Role } from '../src/engine/types'

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

const SEASONS = Number(process.argv[2] ?? 3)
const SEEDS = (process.argv[3] ?? '7,8').split(',').map(Number)
const ROLES = (process.argv[4] ?? '决斗者,控场').split(',') as Role[]
const STARTS = (process.argv[5] ?? 'chal,t1').split(',') as StartPoint[]
// only places with a club to sign for in 2026 — a China start finds none and createCareer throws
const REGION_OF: Record<number, Region> = { 7: 'Americas', 8: 'Pacific', 9: 'EMEA', 10: 'Americas', 11: 'Pacific', 12: 'EMEA' }

const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '-')
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')
const q = (a: number[], f: number) => {
  const s = a.slice().sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN
}

/**
 * Is my place the contract's this week, rather than the coach's? Read off the
 * engine where the build has the floor; off the rule it replaced where it does
 * not, so the same script measures a build from either side of the change.
 */
const promiseNow = (state: GameState): boolean => {
  const holds = (coachMod as unknown as Record<string, unknown>).promiseHolds
  if (typeof holds === 'function') return !!(holds as (s: GameState) => boolean)(state)
  const me = state.me!
  const r = state.players[me.id]?.contract?.promisedRole
  return (r === 'starter' || r === 'star') && !(me.benchLock && me.benchLock > state.day)
}
const hasFloor = typeof (coachMod as unknown as Record<string, unknown>).promiseHolds === 'function'

interface Tally {
  weeks: number
  byPromise: number
  byTrial: number
  starterWeeks: number
  /** every week, and the weeks the coach's own reading is what decides */
  margins: number[]
  freeMargins: number[]
  /** his place changing hands at one club */
  flips: number
  inOut: number
  outIn: number
  careers: number
  secs: number
}

const blank = (): Tally => ({
  weeks: 0, byPromise: 0, byTrial: 0, starterWeeks: 0, margins: [], freeMargins: [],
  flips: 0, inOut: 0, outIn: 0, careers: 0, secs: 0,
})

/** A week the steady way, playing my club's matches as they come. */
function week(state: GameState): WeekStop {
  const me = state.me!
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state)
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    else clear()
    stop = advanceWeek(state)
  }
  return stop
}

function career(role: Role, start: StartPoint, seed: number, t: Tally): void {
  const t0 = Date.now()
  const state = createCareer({
    name: `P${seed}`, region: REGION_OF[seed] ?? 'EMEA', role,
    talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2026,
  })
  const me = state.me!
  const year0 = state.year
  let weeks = 0
  // last week's answer at this club: a move between clubs is not a place changing hands
  let prevClub = ''
  let prevIn: boolean | null = null
  while (state.year < year0 + SEASONS && me.phase !== 'retired' && weeks < SEASONS * 60) {
    const stop = week(state)
    weeks++
    const team = me.phase === 'pro' && state.myTeam ? state.teams[state.myTeam] : undefined
    if (team) {
      t.weeks++
      const trial = !!me.trial
      const promise = !trial && promiseNow(state)
      if (trial) t.byTrial++
      if (promise) t.byPromise++
      const inFive = me.lastLineupIn ?? team.starters.includes(me.id)
      if (inFive) t.starterWeeks++
      if (prevClub === team.id && prevIn !== null && prevIn !== inFive) {
        t.flips++
        if (prevIn) t.inOut++
        else t.outIn++
      }
      prevClub = team.id
      prevIn = inFive
      // how far the coach's own reading puts me from the 5/6 line, room left out
      const squad = squadOf(state, team.id)
      if (squad.length > 5) {
        const cv = new Map(squad.map((p) => [p.id, coachView(state, p, false)]))
        const sorted = squad.slice().sort((a, b) => cv.get(b.id)! - cv.get(a.id)!)
        const rank = sorted.findIndex((p) => p.id === me.id)
        if (rank >= 0) {
          const d = rank < 5
            ? cv.get(sorted[rank].id)! - cv.get(sorted[5].id)!
            : cv.get(sorted[4].id)! - cv.get(sorted[rank].id)!
          t.margins.push(d)
          if (!trial && !promise) t.freeMargins.push(d)
        }
      }
    } else {
      prevClub = ''
      prevIn = null
    }
    if (stop.kind === 'game-over') break
  }
  t.careers++
  t.secs += Math.round((Date.now() - t0) / 1000)
}

const merge = (xs: Tally[]): Tally => xs.reduce((a, b) => ({
  weeks: a.weeks + b.weeks, byPromise: a.byPromise + b.byPromise, byTrial: a.byTrial + b.byTrial,
  starterWeeks: a.starterWeeks + b.starterWeeks,
  margins: a.margins.concat(b.margins), freeMargins: a.freeMargins.concat(b.freeMargins),
  flips: a.flips + b.flips, inOut: a.inOut + b.inOut, outIn: a.outIn + b.outIn,
  careers: a.careers + b.careers, secs: a.secs + b.secs,
}), blank())

// the door a career opens at decides the standing its first contract promises
// (me/career.ts): a Challengers start signs as 首发, a tier-one bench as 轮换 —
// so the two sides of the floor are read apart as well as together
const START_CN: Record<string, string> = {
  chal: '二队开局 · 第一份合同写的是首发',
  t1: '一队替补开局 · 第一份合同写的是轮换',
  pre: '天梯开局',
}

const byStart = new Map<StartPoint, Tally>()
for (const start of STARTS) byStart.set(start, blank())
for (const role of ROLES) for (const start of STARTS) for (const seed of SEEDS) {
  const t = byStart.get(start)!
  career(role, start, seed, t)
  process.stderr.write(`${role} ${start} seed ${seed} 打完：${start} 累计在队 ${t.weeks} 周、换手 ${t.flips} 次 · ${t.secs}s\n`)
}

function report(label: string, t: Tally): void {
  if (!t.weeks) return
  const decided = t.weeks - t.byPromise - t.byTrial
  console.log(`\n【${label}】${t.careers} 段生涯 · 在队 ${t.weeks} 周`)
  console.log(`  一、位置是谁定的：合同 ${t.byPromise}（${pct(t.byPromise, t.weeks)}）· 试用期 ${t.byTrial}（${pct(t.byTrial, t.weeks)}）· 教练自己读 ${decided}（${pct(decided, t.weeks)}）；你在首发里的周 ${pct(t.starterWeeks, t.weeks)}`)
  console.log(`  二、教练的读数离 5/6 线多远：全部 ${t.margins.length} 周 p10 ${f2(q(t.margins, 0.1))} · p50 ${f2(q(t.margins, 0.5))} · p90 ${f2(q(t.margins, 0.9))}；教练说了算的 ${t.freeMargins.length} 周 p10 ${f2(q(t.freeMargins, 0.1))} · p50 ${f2(q(t.freeMargins, 0.5))} · p90 ${f2(q(t.freeMargins, 0.9))}`)
  console.log(`  三、位置真的换手：${t.flips} 次（在队周的 ${pct(t.flips, t.weeks)}）—— 掉出首发 ${t.inOut}、打回首发 ${t.outIn}`)
}

const all = merge([...byStart.values()])
console.log(`\n位置归谁管 · ${hasFloor ? `保底 ${(coachMod as unknown as Record<string, number>).PROMISE_FLOOR} 场` : '保底之前的版本'} · ${ROLES.join('/')} × ${STARTS.join('/')} × 种子 ${SEEDS.join('/')} × ${SEASONS} 个赛季 · ${all.secs}s`)
for (const start of STARTS) report(START_CN[start] ?? start, byStart.get(start)!)
report('合计', all)
