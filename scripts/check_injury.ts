/**
 * How often does anyone get hurt, for how long, and what does it leave behind?
 *
 * me/injury.ts promises a career where an injury is an event, not a season's
 * weather: on the steady plan most seasons pass without one, a lay-off is a
 * week or three, and a lasting hit is rare and only ever comes from playing
 * through. Team-mates are the engine's own rolls (engine/training.ts), read
 * the same way. This walks the steady plan through a ladder start and a
 * Challengers start and counts, per season, my injuries by kind, my weeks out,
 * the matches I played hurt, the lasting hits — and my club's team-mates' lay-offs.
 *
 *   npx tsx scripts/check_injury.ts [seasons=6] [seeds=7] [starts=pre,chal] [steady|through]
 *
 * `through` answers every 「带伤上吗」 with 带伤上 instead of the autopilot's
 * answer, which is how often a lasting mark comes from playing through.
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan, autoResolve, autoWeek } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { answerHurt } from '../src/engine/me/hurtplay'
import type { GameState } from '../src/engine/types'

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

const seasons = Number(process.argv[2] ?? 6)
const seeds = (process.argv[3] ?? '7').split(',').map(Number)
const starts = (process.argv[4] ?? 'pre,chal').split(',') as ('pre' | 'chal')[]
const through = process.argv[5] === 'through'

/** autoWeek, or the same week with every light injury played through */
function week(state: GameState): { kind: string } {
  if (!through) return autoWeek(state)
  const me = state.me!
  const answer = () => {
    let g = 0
    while (me.pending.length && g++ < 20) {
      const it = me.pending[0]
      if (it.kind === 'hurt') answerHurt(state, it.id!, true)
      else autoResolve(state, it)
    }
  }
  answer()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state)
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    else answer()
    stop = advanceWeek(state)
  }
  return stop
}

interface Lay { kind: string; from: number; until: number; year: number }

interface Tally {
  seasons: number
  proSeasons: number
  mine: Lay[]
  mates: Lay[]
  lasting: number
  playedHurt: number
  hurtWeeks: number
  stuck: number
}

/** the player layer's own record of what is wrong, if this build has one */
type MeHurt = { kind?: string; from?: number }
const hurtOf = (state: GameState): MeHurt | undefined => (state.me as unknown as { injury?: MeHurt }).injury

function career(start: 'pre' | 'chal', seed: number): Tally {
  const state = createCareer({
    // a Challengers start is a European club's, as in check_money; the ladder start opens beside it
    name: 'Probe', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start, seed,
  })
  const me = state.me!
  const p = state.players[me.id]
  const year0 = state.year
  const t: Tally = { seasons: 0, proSeasons: 0, mine: [], mates: [], lasting: 0, playedHurt: 0, hurtWeeks: 0, stuck: 0 }
  const open = new Map<string, Lay>()
  const mates = new Map<string, Lay>()
  let prevDay = state.day
  let prevYear = state.year
  let proWeeks = 0
  let weeks = 0
  let guard = 0
  while (state.year - year0 < seasons && guard++ < 60 * seasons) {
    if (week(state).kind === 'game-over') break
    weeks++
    if (state.year !== prevYear) { prevYear = state.year; prevDay = 0; open.clear() }
    if (me.phase === 'pro') proWeeks++
    // mine: keyed on the day it began when the build knows it, else on the day it ends
    if (p.injuredUntil > state.day) {
      t.hurtWeeks++
      const h = hurtOf(state)
      const from = h?.from ?? Math.round((prevDay + state.day) / 2)
      const key = h?.from != null ? `${state.year}:${h.from}` : `${state.year}:u${p.injuredUntil}`
      const lay = open.get(key)
      if (lay) lay.until = p.injuredUntil
      else {
        const l: Lay = { kind: h?.kind ?? p.injuryNote ?? '?', from, until: p.injuredUntil, year: state.year }
        open.set(key, l)
        t.mine.push(l)
      }
    }
    // team-mates: the engine sets a lay-off once and never moves it, so its end day is its key
    if (me.phase === 'pro') {
      for (const id of state.teams[state.myTeam]?.roster ?? []) {
        if (id === me.id) continue
        const q = state.players[id]
        if (!q || q.injuredUntil <= state.day) continue
        const key = `${id}:${state.year}:${q.injuredUntil}`
        if (mates.has(key)) continue
        const l: Lay = { kind: q.injuryNote ?? '?', from: Math.min(q.injuredUntil - 1, Math.round((prevDay + state.day) / 2)), until: q.injuredUntil, year: state.year }
        mates.set(key, l)
        t.mates.push(l)
      }
    }
    prevDay = state.day
  }
  // whatever is on screen is finished the way a player would before stopping
  for (let i = 0; i < 4 && me.pending.length; i++) week(state)
  t.stuck = me.pending.filter((x) => (x.kind as string) === 'hurt').length
  t.seasons = weeks / 52
  t.proSeasons = proWeeks / 52
  t.lasting = me.flags.injLasting ?? 0
  t.playedHurt = me.flags.injPlayed ?? 0
  return t
}

const weeksOut = (l: Lay) => Math.max(1, l.until - l.from) / 7
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)

function byKind(lays: Lay[]): string {
  const m = new Map<string, Lay[]>()
  for (const l of lays) m.set(l.kind, [...(m.get(l.kind) ?? []), l])
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([k, ls]) => `${k} ${ls.length}（平均 ${f1(avg(ls.map(weeksOut)))} 周）`).join(' · ') || '无'
}

let bad = 0
for (const start of starts) {
  const all: Tally[] = seeds.map((s) => career(start, s))
  const sum = (f: (t: Tally) => number) => all.reduce((s, t) => s + f(t), 0)
  const mine = all.flatMap((t) => t.mine)
  const mates = all.flatMap((t) => t.mates)
  const S = sum((t) => t.seasons)
  const P = sum((t) => t.proSeasons)
  const label = (start === 'pre' ? '天梯开局' : 'Challengers 开局') + (through ? ' · 轻伤一律带伤上' : '')
  console.log(`\n== ${label} · ${seeds.length} 个种子 × ${seasons} 季（实际 ${f1(S)} 季，其中有队 ${f1(P)} 季）`)
  console.log(`  我：受伤 ${mine.length} 次 · 每季 ${f2(mine.length / Math.max(0.01, S))} 次 · 平均缺阵 ${f1(avg(mine.map(weeksOut)))} 周 · 伤着的周数 ${sum((t) => t.hurtWeeks)}`)
  console.log(`      按类型：${byKind(mine)}`)
  const seasonsHurt = sum((t) => new Set(t.mine.map((l) => l.year)).size)
  console.log(`      有伤的赛季 ${seasonsHurt}/${Math.round(S)}`)
  console.log(`      带伤出场 ${sum((t) => t.playedHurt)} 场 · 落下病根 ${sum((t) => t.lasting)} 次${mine.length ? `（每次受伤 ${f2(sum((t) => t.lasting) / mine.length)}）` : ''}`)
  console.log(`  队友（我所在俱乐部）：${mates.length} 次 · 每队每季 ${f2(mates.length / Math.max(0.01, P))} 次 · 平均缺阵 ${f1(avg(mates.map(weeksOut)))} 周`)
  console.log(`      按引擎的伤名：${byKind(mates)}`)
  const stuck = sum((t) => t.stuck)
  if (stuck) { bad++; console.log(`✗ 有 ${stuck} 个「带伤上吗」没有关掉，时钟会停在那里。`) }
}
console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 跑完了，没有卡住的决定。')
if (bad) process.exitCode = 1
