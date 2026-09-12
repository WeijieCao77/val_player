import { duoBonded } from '../bonds'
import { ageDrift } from '../player'
import { bookCovers, isTimelineWorld } from '../timeline'
import type { GameState, Player, Team } from '../types'
import { trainAgeMul } from './growth'

/**
 * The small things in a week that are not matches (作者 2026-09-12：「队友的生日这些小事件都要有」).
 *
 * The manager game had them in engine/life.ts, which stopped running in a
 * career when the two games were separated. This is the career's own, after
 * 破晓 where 破晓 has the idea:
 *
 *  - my age when the year turns — 破晓 main.ts preLog「…赛季开始，你 N 岁了」 —
 *    with the one thing that changes at that age, read off the numbers the game
 *    itself uses (player.ts ageDrift, me/growth.ts trainAgeMul)
 *  - my club's run of five — 破晓 main.ts noteForm「五连胜 / 五连败」, once a
 *    season each way
 *  - a team-mate on a hot or cold run — 破晓 form.ts formNews, cut to my own
 *    five and read from the box scores of my club's matches in this save
 *  - a team-mate's birthday, only from a real date — the manager's life.ts;
 *    破晓 has no birthdays
 *  - milestones: maps, starts, seasons, years at the club, a team-mate's season
 *    at his club, matches beside him — 破晓 keeps these as achievements
 *    (achieve.ts「里程碑」). Marks the career's achievements already announce
 *    (100 starts, eight and twelve seasons, five years at a club) are theirs.
 *
 * Nothing here is a chore: no card, no choice, one line in the week's paper.
 * Nothing invents a private fact about a real person. And no transfer rumours
 * about team-mates: the market decides a move on the day the window opens
 * (me/market.ts), so there is no week before it for a rumour to come true in —
 * any rumour would be a story made up about a real player.
 */

export interface LifeBook {
  /** marks already said: each is said once */
  seen: string[]
  /** a team-mate's run as last said, so a run is said when it starts, not every week */
  form: Record<string, 'hot' | 'cold'>
  /** the calendar day (dayNo) a run was last said: one every two weeks at most */
  formAt?: number
  /** my club and the calendar day I joined it; null when a save from before this could not know */
  club?: { id: string; at: number | null }
  /** the last calendar day looked at, so a day the clock steps over (31 December) keeps its birthdays */
  at?: number
}

const DAY = 86_400_000
/** A calendar day as one number, from the engine's year and day (1 January is day 0, engine/season.ts dateLabel). */
export const dayNo = (year: number, day: number): number => Math.round(Date.UTC(year, 0, 1) / DAY) + day
export const dateOfDay = (n: number): { y: number; m: number; d: number } => {
  const t = new Date(n * DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const leap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** 29 February is kept on the 28th in the other years. */
export function sameDate(m: number, d: number, on: { y: number; m: number; d: number }): boolean {
  if (m === 2 && d === 29 && !leap(on.y)) return on.m === 2 && on.d === 28
  return on.m === m && on.d === d
}

/** A real birthdate, as Liquipedia has it. Nothing else counts as one. */
export function birthOf(p: Player): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.birth ?? '')
  if (!x) return null
  const y = Number(x[1])
  const m = Number(x[2])
  const d = Number(x[3])
  return y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null
}

const MAP_MARKS = [100, 250, 500, 1000]
/** 100 is the achievement 一百场 (me/achievements.ts matches100) */
const START_MARKS = [50, 200, 300, 500]
const MATE_MARKS = [50, 100, 200]
/** the eighth and twelfth are the achievements 常青树 and 十二年 */
const SEASON_MARKS = [2, 3, 5, 10]
/** five years at one club is the achievement 一队五年 */
const CLUB_SKIP = 5
/** a team-mate's seasons at his club worth a line */
const TENURE_MARKS = [3, 5, 10]
/** a run: this many of his matches for my club, the last of them this recent */
const RUN = 4
const RUN_DAYS = 42
/**
 * Rating over the run. An average starter sits at about 1.00 (player.ts
 * ratingOf); measured over a team-mate's four-match runs in this game
 * (.cache/probe_life.ts, 456 runs) p5 is 0.86 and p95 1.20.
 */
const HOT = 1.18
const COLD = 0.86
/** how far back toward his usual before the next run is news */
const SETTLE = 0.08
const FORM_GAP = 14
const STREAK = 5

function once(life: LifeBook, key: string): boolean {
  if (life.seen.includes(key)) return false
  life.seen.push(key)
  return true
}

/** My five besides me, while I have a club. */
function matesNow(state: GameState): Player[] {
  const me = state.me!
  if (me.phase !== 'pro') return []
  return (state.teams[state.myTeam]?.roster ?? [])
    .filter((id) => id !== me.id)
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
}

const startsOf = (state: GameState): number => {
  const me = state.me!
  return me.seasons.reduce((n, s) => n + s.starts, 0) + me.seasonStart.starts
}

/** professional seasons finished before this year */
const proSeasonsBefore = (state: GameState): number =>
  state.me!.seasons.filter((s) => s.tier > 0 && s.year < state.year).length

function book(state: GameState): LifeBook {
  const me = state.me!
  if (me.life) return me.life
  const life: LifeBook = { seen: [], form: {} }
  me.life = life
  // a career already under way when this arrived: what it has passed is not news
  if (me.week > 0) {
    const p = state.players[me.id]
    for (const m of MAP_MARKS) if (p.career.maps >= m) life.seen.push(`maps:${m}`)
    for (const m of START_MARKS) if (startsOf(state) >= m) life.seen.push(`starts:${m}`)
    const seasons = proSeasonsBefore(state) + (me.phase === 'pro' ? 1 : 0)
    for (let k = 1; k <= seasons; k++) life.seen.push(`pro:${k}`)
    for (const e of Object.values(me.mates ?? {})) {
      for (const m of MATE_MARKS) if ((e.matches ?? 0) >= m) life.seen.push(`mate:${e.id}:${m}`)
    }
    const run = streakOf(state)
    if (run && run.n >= STREAK) life.seen.push(`run:${run.won ? 'w' : 'l'}:${state.year}`)
  }
  return life
}

/**
 * The day's things (me/week.ts runDays): a team-mate's birthday, a year at the
 * club, and when the year turns, my age.
 */
export function lifeDay(state: GameState, newYear: boolean): void {
  const me = state.me
  if (!me || me.phase === 'retired') return
  const fresh = !me.life
  const life = book(state)
  const now = dayNo(state.year, state.day)
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  // the club, and the day I joined it: seen the day it changes; a save from before this cannot know
  if (!team) life.club = undefined
  else if (life.club?.id !== team.id) life.club = { id: team.id, at: fresh && me.week > 0 ? null : now }

  const out: string[] = []
  // every calendar day since the last look: the year's turn steps over 31 December
  const from = life.at !== undefined && now > life.at && now - life.at <= 10 ? life.at + 1 : now
  life.at = now
  const mates = matesNow(state)
  for (let n = from; n <= now; n++) {
    const on = dateOfDay(n)
    for (const p of mates) {
      const b = birthOf(p)
      if (!b || on.y <= b.y || !sameDate(b.m, b.d, on) || !once(life, `bd:${p.id}:${on.y}`)) continue
      duoBonded(state, me.id, p.id, 1)
      out.push(`🎂 队友 ${p.ign} ${on.y - b.y} 岁生日，一起庆祝了。`)
    }
    const at = life.club?.at
    if (team && at != null && n > at) {
      const j = dateOfDay(at)
      const years = on.y - j.y
      if (years >= 1 && years !== CLUB_SKIP && sameDate(j.m, j.d, on) && once(life, `club:${team.id}:${at}:${years}`)) {
        out.push(`🎖 加盟 ${team.name} 满 ${years} 年。`)
      }
    }
  }
  if (newYear) yearTurn(state, life, out)
  for (const l of out) me.weekNotes.push(l)
}

/** What changes at this age, in the game's own numbers, or nothing worth saying. */
function ageSign(age: number): string {
  const was = ageDrift({ age: age - 1 } as Player)
  const now = ageDrift({ age } as Player)
  if (now < 0 && was >= 0) return '这个冬天起属性开始下滑，枪法和反应最先。'
  if (now < 0 && now < was) return '下滑得比去年快了。'
  if (trainAgeMul(age) < trainAgeMul(age - 1)) return '同样的训练，涨得比去年慢一点。'
  return ''
}

/**
 * The season a team-mate's stint at this club began: this world's own record of
 * him, a line a year. A stint already running when the roster book opens began
 * before it; for that one stint vlr's join month says when, if it has one.
 */
function stintFrom(state: GameState, p: Player, teamId: string): number | null {
  const h = p.clubHist ?? []
  const last = h[h.length - 1]
  if (!last || last.team !== teamId || !isTimelineWorld(state)) return null
  if (bookCovers(last.from - 1)) return last.from
  const joined = h.length === 1 ? Number(String(p.joined ?? '').slice(0, 4)) : 0
  return joined && joined <= last.from ? joined : null
}

function yearTurn(state: GameState, life: LifeBook, out: string[]): void {
  const me = state.me!
  const p = state.players[me.id]
  // last year's birthdays, runs and season lines are done with
  const year = String(state.year)
  life.seen = life.seen.filter((k) => !/^(bd|run|ten):/.test(k) || k.split(':').pop() === year)
  if (p && once(life, `age:${p.age}`)) out.push(`🎂 你 ${p.age} 岁了。${ageSign(p.age)}`)
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!team) return
  // a team-mate reaching a mark at his club, the longest-serving first, one line
  let best: { p: Player; n: number } | null = null
  for (const q of matesNow(state)) {
    const from = stintFrom(state, q, team.id)
    if (from === null) continue
    const k = state.year - from + 1
    if (TENURE_MARKS.includes(k) && (!best || k > best.n)) best = { p: q, n: k }
  }
  if (best && once(life, `ten:${best.p.id}:${state.year}`)) out.push(`🎖 ${best.p.ign} 在 ${team.name} 的第 ${best.n} 个赛季。`)
}

/** The week's things (me/week.ts settleWeek): milestones, a team-mate's run, my club's streak. */
export function lifeWeek(state: GameState, notes: string[]): void {
  const me = state.me
  if (!me || me.phase === 'retired') return
  const life = book(state)
  const p = state.players[me.id]
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  // the season count, in my first week at a club that year: a year that turns while I am between clubs still gets it
  if (team) {
    const n = proSeasonsBefore(state) + 1
    if ((n === 1 || SEASON_MARKS.includes(n)) && once(life, `pro:${n}`)) notes.push(n === 1 ? '🎖 第一个职业赛季。' : `🎖 第 ${n} 个职业赛季。`)
  }
  const mark = (marks: number[], v: number, key: string, line: (m: number) => string): void => {
    const hit = marks.filter((m) => v >= m && !life.seen.includes(`${key}:${m}`))
    if (!hit.length) return
    for (const m of hit) life.seen.push(`${key}:${m}`)
    notes.push(line(hit[hit.length - 1]))
  }
  mark(MAP_MARKS, p.career.maps, 'maps', (m) => `🎖 职业生涯第 ${m} 张图。`)
  mark(START_MARKS, startsOf(state), 'starts', (m) => `🎖 第 ${m} 场正赛首发。`)
  if (!team) return

  // matches beside team-mates: the biggest mark reached this week, in one line
  let top = 0
  let names: string[] = []
  for (const q of matesNow(state)) {
    const e = me.mates?.[q.id]
    if (!e) continue
    for (const m of MATE_MARKS) {
      if ((e.matches ?? 0) < m || !once(life, `mate:${q.id}:${m}`)) continue
      if (m > top) { top = m; names = [] }
      if (m === top) names.push(q.ign)
    }
  }
  if (top) notes.push(`🎖 和 ${names.length > 2 ? `${names[0]} 等 ${names.length} 人` : `${names.join('、')} `}同队满 ${top} 场。`)

  formWeek(state, life, notes)
  streakWeek(state, life, team, notes)
}

/** A team-mate's rating over his last few matches for my club, from their box scores; null without a recent run. */
function runOf(state: GameState, id: string, now: number): number | null {
  const me = state.me!
  const r: number[] = []
  for (let i = me.matches.length - 1; i >= 0 && r.length < RUN; i--) {
    const m = me.matches[i]
    if (now - dayNo(m.year, m.day) > RUN_DAYS) break
    if (m.friendly || !m.box) continue
    const row = m.box.find((b) => b.mine && b.id === id)
    if (row) r.push(row.rating)
  }
  return r.length < RUN ? null : r.reduce((a, b) => a + b, 0) / r.length
}

function formWeek(state: GameState, life: LifeBook, notes: string[]): void {
  const mates = matesNow(state)
  const here = new Set(mates.map((q) => q.id))
  for (const id of Object.keys(life.form)) if (!here.has(id)) delete life.form[id]
  const now = dayNo(state.year, state.day)
  let pick: { q: Player; avg: number; flag: 'hot' | 'cold' } | null = null
  for (const q of mates) {
    const avg = runOf(state, q.id, now)
    if (avg === null) continue
    const flag = avg >= HOT ? 'hot' : avg <= COLD ? 'cold' : null
    if (!flag) {
      // well back to his usual: the next run is news again
      if (avg < HOT - SETTLE && avg > COLD + SETTLE) delete life.form[q.id]
      continue
    }
    if (life.form[q.id] === flag) continue
    if (!pick || Math.abs(avg - 1) > Math.abs(pick.avg - 1)) pick = { q, avg, flag }
  }
  if (!pick || (life.formAt !== undefined && now - life.formAt < FORM_GAP)) return
  life.form[pick.q.id] = pick.flag
  life.formAt = now
  notes.push(pick.flag === 'hot'
    ? `🔥 ${pick.q.ign} 近 ${RUN} 场评分 ${pick.avg.toFixed(2)}，手感正烫。`
    : `🧊 ${pick.q.ign} 近 ${RUN} 场评分 ${pick.avg.toFixed(2)}，手感不在。`)
}

/** My club's results this season, newest back: wins in a row or defeats in a row. A level Bo2 ends either. */
function streakOf(state: GameState): { won: boolean; n: number } | null {
  const me = state.me!
  const since = me.life?.club?.at ?? null
  let won: boolean | null = null
  let n = 0
  for (let i = me.matches.length - 1; i >= 0; i--) {
    const m = me.matches[i]
    if (m.friendly) continue
    if (m.year !== state.year || (since !== null && dayNo(m.year, m.day) < since) || m.drawn) break
    if (won === null) won = m.won
    if (m.won !== won) break
    n++
  }
  return won === null ? null : { won, n }
}

function streakWeek(state: GameState, life: LifeBook, team: Team, notes: string[]): void {
  const run = streakOf(state)
  if (!run || run.n < STREAK || !once(life, `run:${run.won ? 'w' : 'l'}:${state.year}`)) return
  notes.push(run.won ? `🔥 ${team.name} ${run.n} 连胜。` : `🧊 ${team.name} ${run.n} 连败。`)
}
