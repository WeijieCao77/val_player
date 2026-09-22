import type { GameState } from '../types'
import { activeAbsence } from './absence'
import { sealWeek } from './undo'
import { pushLog } from './log'

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
