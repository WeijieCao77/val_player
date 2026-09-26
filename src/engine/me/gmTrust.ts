import type { GameState } from '../types'
import { clamp } from '../rng'
import { SEASON_DAYS } from '../calendar'
import { activeAbsence } from './absence'
import { sealWeek } from './undo'
import { pushLog } from './log'
import { isIntlComp } from './compclass'

export const MANAGER_TALK_AP = 2
export const MANAGER_TALK_GAIN = 3
export const MANAGER_TALK_WEEKS = 4
export const MANAGER_TALK_CAP = 80

export function managerTalkWait(state: GameState): number {
  const me = state.me
  if (!me || !Number.isInteger(me.week) || me.week < 0) return 0
  const last = me.managerTalkWeek
  if (last === undefined || !Number.isInteger(last) || last < 0 || last > me.week) return 0
  return Math.max(0, MANAGER_TALK_WEEKS - (me.week - last))
}

export function managerTalkBlock(state: GameState): string | null {
  const me = state.me
  const p = me && state.players[me.id]
  if (!me || !p) return '没有找到生涯主角。'
  if (me.phase !== 'pro') return '当前不在职业阶段。'
  const team = state.teams[state.myTeam]
  if (!team) return '当前俱乐部不存在。'
  if (p.teamId !== team.id || !team.roster.includes(me.id)) return '当前不在俱乐部名单中。'
  if (!Number.isInteger(me.week) || me.week < 0) return '当前周数无效。'
  if (activeAbsence(state)) return '长期缺席期间不能与经理沟通。'
  if (me.duelLive || me.pendingFixture || me.dueFixture || me.tryout || me.pendingEvent) return '先完成当前比赛、对位挑战或试训。'
  if (me.pending.some(x => ['event', 'cup', 'tryout', 'ending', 'hurt'].includes(x.kind))) return '先处理当前待办事件。'
  const trust = me.gmTrust
  if (typeof trust !== 'number' || !Number.isFinite(trust) || trust < 0 || trust > 100) return '当前信任值异常，不能沟通。'
  if (trust >= MANAGER_TALK_CAP) return '经理已经足够信任你，沟通渠道暂时不再提升。'
  if (typeof me.ap !== 'number' || !Number.isFinite(me.ap) || me.ap < MANAGER_TALK_AP) return `行动点不足，需要 ${MANAGER_TALK_AP} 点。`
  const wait = managerTalkWait(state)
  if (wait > 0) return `沟通后需要等待 ${wait} 周。`
  return null
}

export function talkToManager(state: GameState): string | null {
  const why = managerTalkBlock(state)
  if (why) return why
  const me = state.me!
  sealWeek(state)
  me.ap -= MANAGER_TALK_AP
  const before = me.gmTrust
  const after = Math.min(MANAGER_TALK_CAP, before + MANAGER_TALK_GAIN)
  me.gmTrust = after
  me.managerTalkWeek = me.week
  const gain = after - before
  const line = `与经理沟通：信任 ${before} → ${after}（+${gain}）。本次以及本周此前可撤回行动已确定，不能撤回。`
  me.weekNotes.push(line)
  ;(me.weekLog ??= []).push(line)
  pushLog(state, 'info', line)
  return null
}

/* ------------------------------------------------------------------ */
/*  the manager's stage settlement                                      */
/* ------------------------------------------------------------------ */

/**
 * The manager reads a stage's results, as 破晓's cloutTick does (its clout.ts, 2026-09-08 values). The author,
 * 2026-09-26, reversing 2026-09-23's 「本次不增加赢比赛、夺冠的自动经理信任奖励」: 经理信任随成绩变化.
 *
 *  - first it drifts GM_DRIFT of the way back to GM_HOME: a manager does not trust you for a stage two years ago;
 *  - a title won since the last settlement: a league's GM_TITLE.league, an international's GM_TITLE.intl, a
 *    title won from the bench GM_BENCH of that (威望 counts a bench title the same way, me/clout.ts);
 *  - the club's official results this stage, (win rate − 0.5) × GM_RECORD — played or watched, the manager
 *    reads the club's record;
 *  - the following: 破晓's (人气 − 90) / 26, held to −4…+6, on our scale — its 人气 saturates 威望 at 224
 *    and ours at 3520 (fans ÷ 220 against its ÷ 14), so 90 is 1400 here and 26 is 400. The floor is −1, not −4:
 *    a following starts at a couple of hundred here and takes years to grow (check_clout: 228 → 1313 over
 *    seven seasons), and at −4 a stage the drift alone would hold a young starter's manager near 34.
 *
 * 「与经理沟通」 is unchanged and still stops at its own cap; results can take the regard past it.
 */
export const GM_HOME = 50
export const GM_DRIFT = 0.18
export const GM_TITLE = { league: 5, intl: 10 } as const
export const GM_BENCH = 0.35
export const GM_RECORD = 12
export const GM_FANS = { home: 1400, per: 400, lo: -1, hi: 6 } as const

const r1 = (x: number) => Math.round(x * 10) / 10

export function gmStage(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.teams[state.myTeam]) return
  const now = state.year * SEASON_DAYS + state.day
  const book = me.gmBook
  // an older save: the first settlement records where things stand and pays nothing back
  if (!book) { me.gmBook = { year: state.year, day: state.day, seen: me.titles.length }; return }
  const since = book.year * SEASON_DAYS + book.day
  const parts: string[] = []
  const before = me.gmTrust
  let v = before + (GM_HOME - before) * GM_DRIFT
  if (Math.abs(v - before) >= 0.05) parts.push(`时间冲淡 ${fmt(v - before)}`)
  let honours = 0
  for (const t of me.titles.slice(book.seen)) honours += (isIntlComp(t.title) ? GM_TITLE.intl : GM_TITLE.league) * (t.started ? 1 : GM_BENCH)
  if (honours) { v += honours; parts.push(`冠军 ${fmt(honours)}`) }
  const games = me.matches.filter((m) => !m.friendly && m.year * SEASON_DAYS + m.day > since && m.year * SEASON_DAYS + m.day <= now)
  if (games.length) {
    const w = games.filter((m) => m.won).length
    const d = (w / games.length - 0.5) * GM_RECORD
    v += d
    parts.push(`战绩 ${w} 胜 ${games.length - w} 负 ${fmt(d)}`)
  }
  const fans = clamp((me.fans - GM_FANS.home) / GM_FANS.per, GM_FANS.lo, GM_FANS.hi)
  if (Math.abs(fans) >= 0.05) { v += fans; parts.push(`人气 ${fmt(fans)}`) }
  // whole points, as every other move of it is (「与经理沟通」 +3, a failed ask −12)
  me.gmTrust = Math.round(clamp(v, 0, 100))
  me.gmBook = { year: state.year, day: state.day, seen: me.titles.length }
  if (!parts.length || me.gmTrust === Math.round(before)) return
  const line = `经理看了上个赛段：${parts.join('、')}。经理信任 ${Math.round(before)} → ${me.gmTrust}。`
  pushLog(state, 'team', line)
  me.weekNotes.push(line)
}

const fmt = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(r1(x))}`
