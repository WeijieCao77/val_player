import { Rng, hashStr } from '../rng'
import type { GameState, Player } from '../types'
import { birthOf, dateOfDay, dayNo, sameDate } from './life'
import type { MeMatchRecord } from './types'

/**
 * One team-mate saying one short thing in the week's paper (2026-09-18).
 *
 * A copy audit found the weekly report read like a ledger: up to four lines of
 * my own log, the transfers, the league, each a full sentence with its
 * conclusion, and not one person talking. The author's rule for it, as a
 * principle rather than anybody's copy: plenty of lines of one to eight
 * characters, room for small talk that has nothing to do with the match, and
 * only some of what is said about how anyone played.
 *
 * So at most one line a week, only while I am at a club, and only when
 * something real happened that week to set it off — my first start, a team-mate's
 * birthday (a real date, me/life.ts birthOf), a run of results, a series won or
 * lost without taking a map, a match MVP, a team-mate's big night. The line is
 * one of a few written for that thing, most of them not about me; who says it is
 * a real name off my club's roster. Nothing here claims more than the event: a
 * streak line is said only on a streak, a birthday line only in its week.
 *
 * It is written into the week's own paper (me/press.ts weekReport), which a new
 * week clears, and never into the log or the list 托管 hands back after a run —
 * a month left to 托管 does not come back as a page of chatter. Drawn on a
 * stream of the save and the day, so a check reads the same line every time.
 */

/** what set the line off, and who is in it */
type Why =
  | { k: 'first' }
  | { k: 'birthday'; p: Player }
  | { k: 'winRun' | 'lossRun'; n: number }
  | { k: 'bigWin' | 'bigLoss' }
  | { k: 'mvp' }
  | { k: 'hot'; p: Player }

/** said by somebody else in the five, unless `self`: then by the team-mate the line is about */
const LINES: Record<Why['k'], { t: string; self?: boolean }[]> = {
  first: [{ t: '首发了？请客。' }, { t: '机位还习惯吗？' }, { t: '第一场，感觉咋样？' }, { t: '睡得着吗？' }],
  birthday: [{ t: '蛋糕谁订的？' }, { t: '蜡烛别插满。' }, { t: '生日快乐，老哥。' }, { t: '又老一岁。', self: true }, { t: '谢了，蛋糕管够。', self: true }],
  winRun: [{ t: '别说话，别破。' }, { t: '这周谁都别换键盘。' }, { t: '外卖还点那家。' }],
  lossRun: [{ t: '加练吗？' }, { t: '开个短会吧。' }, { t: '谁去买点水果？' }],
  bigWin: [{ t: '宵夜我请。' }, { t: '能睡个懒觉吗？' }, { t: '这把录像留着。' }, { t: '烧烤去不去？' }],
  bigLoss: [{ t: '先睡，明天再说。' }, { t: '复盘几点？' }, { t: '谁点个外卖？' }, { t: '别去看弹幕。' }],
  mvp: [{ t: 'MVP，奶茶呢？' }, { t: 'MVP 请客。' }],
  hot: [{ t: '手有点热。', self: true }, { t: '这把准星调对了。', self: true }, { t: '这个灵敏度不改了。', self: true }],
}
/** a line is short: one to twelve characters */
export const CHATTER_MAX = 12
export const CHATTER_LINES = LINES

/** a run of results worth a word: three in a row, this week's the latest of them */
const RUN = 3
/** a team-mate's night worth a word, on a series we took */
const HOT = 1.35

/** My club's league results, newest first, as far back as one way: a draw or a year's turn ends it. */
function runOf(state: GameState, league: MeMatchRecord[]): { won: boolean; n: number } | null {
  let won: boolean | null = null
  let n = 0
  for (let i = league.length - 1; i >= 0; i--) {
    const m = league[i]
    if (m.year !== state.year || m.drawn) break
    if (won === null) won = m.won
    if (m.won !== won) break
    n++
  }
  return won === null ? null : { won, n }
}

/** What happened this week that a team-mate would say something about, the rarer things first. */
function whyThisWeek(state: GameState, mates: Player[]): Why[] {
  const me = state.me!
  const now = dayNo(state.year, state.day)
  const inWeek = (y: number, d: number): boolean => { const n = dayNo(y, d); return n > now - 7 && n <= now }
  const league = me.matches.filter((m) => !m.friendly)
  const week = league.filter((m) => inWeek(m.year, m.day))
  const out: Why[] = []
  // my first start in a career: every start I have is this week's
  const starts = me.seasons.reduce((n, s) => n + s.starts, 0) + me.seasonStart.starts
  const weekStarts = week.filter((m) => m.started).length
  if (weekStarts > 0 && starts === weekStarts) out.push({ k: 'first' })
  // a team-mate's birthday on one of the week's seven days
  for (const p of mates) {
    const b = birthOf(p)
    if (!b) continue
    for (let n = now - 6; n <= now; n++) {
      const on = dateOfDay(n)
      if (on.y > b.y && sameDate(b.m, b.d, on)) { out.push({ k: 'birthday', p }); break }
    }
  }
  if (out.length) return out
  if (!week.length) return out
  const run = runOf(state, league)
  if (run && run.n >= RUN) out.push({ k: run.won ? 'winRun' : 'lossRun', n: run.n })
  for (const m of week) {
    // a series taken or lost without the other side taking a map: 2-0, 3-0, 0-2
    const [a, b] = m.score.split('-').map(Number)
    if (m.won && b === 0 && a >= 2) out.push({ k: 'bigWin' })
    if (!m.won && !m.drawn && a === 0 && b >= 2) out.push({ k: 'bigLoss' })
    if (m.won && m.mvp && m.started) out.push({ k: 'mvp' })
    if (m.won) {
      const best = (m.box ?? []).filter((r) => r.mine && !r.me && r.rating >= HOT).sort((x, y) => y.rating - x.rating)[0]
      const p = best ? mates.find((q) => q.id === best.id) : undefined
      if (p) out.push({ k: 'hot', p })
    }
  }
  return out
}

/**
 * The week's one line from a team-mate, or null: 「💬 某人：「……」」. Only while I am
 * at a club, only when something this week set it off.
 */
export function mateLine(state: GameState): string | null {
  const me = state.me
  if (!me || me.phase !== 'pro') return null
  const team = state.teams[state.myTeam]
  if (!team) return null
  const mates = team.roster.filter((id) => id !== me.id).map((id) => state.players[id]).filter((p): p is Player => !!p)
  if (!mates.length) return null
  const whys = whyThisWeek(state, mates)
  if (!whys.length) return null
  const rng = new Rng(hashStr(`chatter:${state.seed}:${state.year}:${state.day}`))
  const why = whys[rng.int(0, whys.length - 1)]
  const pool = LINES[why.k]
  const line = pool[rng.int(0, pool.length - 1)]
  const about = why.k === 'birthday' || why.k === 'hot' ? why.p : null
  // the one it is about says a `self` line; anyone else in the five says the rest
  const others = about ? mates.filter((p) => p.id !== about.id) : mates
  const who = line.self && about ? about : others.length ? others[rng.int(0, others.length - 1)] : null
  if (!who) return null
  return `💬 ${who.ign}：「${line.t}」`
}
