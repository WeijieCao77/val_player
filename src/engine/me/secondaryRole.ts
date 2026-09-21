import { ROLES } from '../types'
import type { GameState, Role } from '../types'
import { recomputeOverall, refreshValue } from '../player'
import { ceilingPotential } from './bottleneck'
import { activeAbsence } from './absence'
import { daysLeft } from './aside'
import { ensureGrowthWeek } from './growthWeek'
import { pushLog } from './log'
import { sealWeek } from './undo'
import { weeklyLineup } from './coach'

export interface PositionTraining {
  home: Role
  secondary?: Role
  trainedWeek?: number
  switchedWeek?: number
}
export const SECONDARY_ROLES: Role[] = ROLES.filter(r => r !== '自由人')
export const SECONDARY_START_WEEK = 26
export const SECONDARY_AP = 2
export const SECONDARY_FATIGUE = 4
export const SECONDARY_GAIN = 2
const isRole = (r: unknown): r is Role => ROLES.includes(r as Role)

/** Main-player metadata only. NPC role coverage is never rewritten. */
export function normalizePositionTraining(state: GameState): void {
  const me = state.me, p = me && state.players[me.id]
  if (!me || !p) return
  const old = me.positionTraining
  const home = isRole(old?.home) ? old.home : p.role
  const secondary = isRole(old?.secondary) && old.secondary !== home && old.secondary !== '自由人'
    ? old.secondary : p.roles?.find(r => isRole(r) && r !== home && r !== '自由人')
  me.positionTraining = {
    home, ...(secondary ? { secondary } : {}),
    ...(Number.isInteger(old?.trainedWeek) && old!.trainedWeek! >= 0 && old!.trainedWeek! <= me.week ? { trainedWeek: old!.trainedWeek } : {}),
    ...(Number.isInteger(old?.switchedWeek) && old!.switchedWeek! >= 0 && old!.switchedWeek! <= me.week ? { switchedWeek: old!.switchedWeek } : {}),
  }
}

export function secondaryMastery(state: GameState): number {
  const me = state.me, p = me && state.players[me.id], role = me?.positionTraining?.secondary
  if (!p || !role) return 0
  // Existing legacy coverage is evidence of qualification, not a new awarded proficiency.
  if (p.roles?.includes(role)) return 100
  const n = p.rolePro?.[role]
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n!)) : 0
}

function available(state: GameState): string | null {
  const me = state.me, p = me && state.players[me.id]
  if (!me || !p) return '没有找到生涯主角。'
  if (me.phase === 'retired') return '退役后不能训练或切换位置。'
  if (me.week < SECONDARY_START_WEEK) return '完成 26 周生涯后开放副位置训练。'
  if (activeAbsence(state)) return '长期缺席期间暂不能训练或切换位置。'
  if (p.injuredUntil > state.day) return '伤病恢复后再安排副位置。'
  if (me.duelLive || me.pendingFixture || me.dueFixture || me.tryout) return '先完成当前比赛、对位挑战或试训。'
  if (me.pending.some(x => ['event', 'cup', 'tryout', 'ending', 'hurt'].includes(x.kind))) return '先处理当前待办事件。'
  return null
}

export function chooseSecondaryBlock(state: GameState, role: Role): string | null {
  const why = available(state)
  if (why) return why
  const me = state.me!, p = state.players[me.id]
  if (!SECONDARY_ROLES.includes(role) || role === (me.positionTraining?.home ?? p.role)) return '请选择主位置以外的实际岗位。'
  if (me.positionTraining?.secondary === role) return '已经选定这个副位置。'
  if (me.positionTraining?.secondary && (secondaryMastery(state) > 0 || me.positionTraining.trainedWeek !== undefined || p.role !== me.positionTraining.home)) return '已经开始培养的副位置不能更换；本次生涯只培养一个副位置。'
  return null
}

export function chooseSecondary(state: GameState, role: Role): string | null {
  const why = chooseSecondaryBlock(state, role)
  if (why) return why
  normalizePositionTraining(state)
  state.me!.positionTraining!.secondary = role
  pushLog(state, 'info', `选定副位置：${role}。每周可投入一次专门训练，熟练后才可切换岗位。`)
  return null
}

export function secondaryTrainingBlock(state: GameState): string | null {
  const why = available(state)
  if (why) return why
  const me = state.me!, p = state.players[me.id], training = me.positionTraining
  if (!training?.secondary) return '先选定一个副位置。'
  if (secondaryMastery(state) >= 100) return '这个副位置已经练成。'
  if (training.trainedWeek === me.week) return '本周已训练过副位置，下周再来。'
  if (me.ap < SECONDARY_AP) return `行动点不足，需要 ${SECONDARY_AP} 点。`
  if (p.fatigue > 100 - SECONDARY_FATIGUE) return '体力不足，需要至少 4 点体力。'
  return null
}

export function trainSecondary(state: GameState): string | null {
  const why = secondaryTrainingBlock(state)
  if (why) return why
  const me = state.me!, p = state.players[me.id], training = me.positionTraining!, role = training.secondary!
  const before = secondaryMastery(state)
  ensureGrowthWeek(state)
  sealWeek(state)
  me.ap -= SECONDARY_AP
  p.fatigue += SECONDARY_FATIGUE
  p.rolePro = { ...p.rolePro, [role]: Math.min(100, before + SECONDARY_GAIN) }
  training.trainedWeek = me.week
  const mastered = p.rolePro[role]! >= 100
  if (mastered) { p.roles = [...new Set([...(p.roles ?? [p.role]), training.home, role])]; p.flex = true }
  const line = `副位置训练：${role}熟练度 ${before} → ${p.rolePro[role]}，消耗 2 点行动、4 点体力。${mastered ? '已练成，下周空白周初可切换；成就在正常周结算领取。' : '本次以及此前的行动已定下来，不能撤回。'}`
  me.weekNotes.push(line)
  ;(me.weekLog ??= []).push(line)
  pushLog(state, 'train', line)
  return null
}

export function secondarySwitchBlock(state: GameState, target: Role): string | null {
  const why = available(state)
  if (why) return why
  const me = state.me!, p = state.players[me.id], training = me.positionTraining
  if (!training?.secondary) return '先培养副位置。'
  if (target !== training.home && target !== training.secondary) return '只能在主位置和已练成的副位置之间切换。'
  if (target === p.role) return '当前已经在这个位置。'
  if (target === training.secondary && secondaryMastery(state) < 100) return '副位置熟练度达到 100 后才可切换。'
  if (training.switchedWeek === me.week) return '本周已经切换过位置。'
  if (me.weekDay !== 0 || me.ap !== me.apMax || me.weekDone?.length || Object.values(me.plan).some(n => (n ?? 0) > 0) || me.trainWeek?.week === me.week || training.trainedWeek === me.week) return '只能在新一周尚未安排任何行动、训练之前切换。'
  if (me.trial) return '先完成当前首发试用期，再更换岗位。'
  if (me.pre.cup?.alive) return '当前杯赛结束后再切换岗位。'
  if (me.pitch?.out || me.moveAfter || me.deals.some(d => daysLeft(state, d) >= 0)) return '先处理正在洽谈的自荐、转会或合同报价，再切换岗位。'
  return null
}

export function switchSecondaryRole(state: GameState, target: Role): string | null {
  const why = secondarySwitchBlock(state, target)
  if (why) return why
  const me = state.me!, p = state.players[me.id], before = p.role
  ensureGrowthWeek(state)
  sealWeek(state)
  p.role = target
  recomputeOverall(p)
  if (p.caps) p.potential = ceilingPotential(p)
  refreshValue(p)
  me.edge = 0
  me.positionTraining!.switchedWeek = me.week
  // beginWeek named the five before this optional switch. Re-run the real selection policy now,
  // retaining promise/bench-lock rules instead of granting an automatic starting place.
  if (me.phase === 'pro' && state.teams[state.myTeam]) weeklyLineup(state)
  const line = `岗位切换：${before} → ${target}。综合与上限按新岗位重新加权，八属性不变；旧岗位对位资本清零，教练按正常选拔安排首发。`
  me.weekNotes.push(line)
  ;(me.weekLog ??= []).push(line)
  pushLog(state, 'info', line)
  return null
}
