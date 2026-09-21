import type { GameState, Player } from '../types'
import { bondBetween, duoBonded } from '../bonds'
import { activeAbsence, beginAbsence } from './absence'
import { ensureCareerEvents, recordCareerEvent } from './eventState'
import { leaveClub } from './contract'
import { retire } from './endings'
import { applyEffect } from './fx'
import { fireEvent } from './events'
import type { EventDef } from './events'
import { careerStarts } from './detail'
import { EVERYDAY_EVENTS } from './events_everyday'

/** Major disruptions share the existing weekly event draw, plus a half-year global cooldown. */
export const MAJOR_EVENT_GAP = 26
const available = (s: GameState) => s.me?.phase === 'pro' && !activeAbsence(s)
export const majorEventReady = (s: GameState) => available(s) && s.me!.week >= 12
  && s.me!.week - (s.me!.careerEvents?.lastMajorWeek ?? -MAJOR_EVENT_GAP) >= MAJOR_EVENT_GAP
const majorFired = (s: GameState) => { ensureCareerEvents(s).lastMajorWeek = s.me!.week }

/** Only an actual starter who calls or leads the current five by overall is a core. */
export function conflictCore(s: GameState): Player | undefined {
  if (!available(s)) return
  const t = s.teams[s.myTeam]
  if (!t) return
  const starters = t.starters.map(id => s.players[id]).filter((p): p is Player => !!p && p.teamId === t.id)
  const leader = [...starters].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0]
  return starters.filter(p => p.id !== s.me!.id && (p.id === t.igl || p.id === leader?.id))
    .filter(p => bondBetween(s, s.me!.id, p.id) < 0)
    .sort((a, b) => bondBetween(s, s.me!.id, a.id) - bondBetween(s, s.me!.id, b.id) || a.id.localeCompare(b.id))[0]
}
const coreStillHere = (s: GameState) => {
  const a = s.me!.careerEvents?.pendingCore
  return a && s.me!.phase === 'pro' && s.myTeam === a.clubId && s.players[a.mateId]?.teamId === a.clubId ? a : undefined
}
function closeConflict(s: GameState, dismissed: boolean): string[] {
  const a = ensureCareerEvents(s), target = coreStillHere(s)
  if (!target) { a.pendingCore = undefined; return ['阵容已经变化，这次争执不再继续，也不记为被开除。'] }
  const text = dismissed ? `与队内核心 ${target.mateName} 公开决裂后，俱乐部解除合同。`
    : `与 ${target.mateName} 完成一次面对面的和解。`
  if (dismissed) {
    a.disputes.push({ year: s.year, day: s.day, mateId: target.mateId, mateName: target.mateName, clubId: target.clubId, wasCore: true, dismissed: true })
    recordCareerEvent(s, 'conflict', text, target.mateId)
    leaveClub(s, `因你与 ${target.mateName} 的持续公开争执解除合同`)
  } else {
    a.reconciliations++
    duoBonded(s, s.me!.id, target.mateId, 16)
    recordCareerEvent(s, 'support', text, target.mateId)
  }
  a.pendingCore = undefined
  return [text]
}
function takeLeave(s: GameState, reason: 'surgery' | 'illness' | 'family', days: number | 'season', label: string): string[] {
  if (!available(s)) return ['当前已在缺席或离队状态，本次不叠加缺席。']
  const a = beginAbsence(s, reason, days, label)
  const text = `${label}；获准暂停比赛和高强度训练，至 ${a.until.year} 赛季第 ${a.until.day + 1} 天恢复。`
  return [text, '期间不会因为未参加训练赛而扣教练信任。']
}

export const CAREER_EVENTS: EventDef[] = [
  {
    id: 'career_surgery', w: 2, max: 1, rec: 1,
    when: s => majorEventReady(s) && s.day < 270 && ['wrist', 'back'].includes(s.me!.injury?.kind ?? '') && s.players[s.me!.id].injuredUntil - s.day >= 7,
    onFire: majorFired,
    q: '复查后，队医建议你停止高强度训练，认真处理这次伤病。',
    ctx: '这是模拟生涯中的重大伤病事件。两条路线都会真正缺席比赛，普通理疗不能提前解除；俱乐部同意保留休养安排。',
    a: [
      { t: '接受手术，退出本赛季剩余比赛', g: 'warm', e: { fatigue: -12, note: '本赛季报销，下赛季恢复参赛资格' }, confirm: '确定接受手术并退出本赛季剩余比赛吗？普通康复操作不能提前解除，直到下一赛季才恢复参赛资格。' },
      { t: '选择保守治疗，休养十二周', g: 'grind', e: { fatigue: -8, note: '连续缺席 84 天，不能带伤上场' } },
    ],
    onResolve: (s, i) => takeLeave(s, 'surgery', i === 0 ? 'season' : 84, i === 0 ? '手术后赛季休养' : '伤病保守治疗'),
  },
  {
    id: 'career_diagnosis', w: 1.5, max: 1, rec: 0,
    when: s => majorEventReady(s) && s.me!.week >= 52 && careerStarts(s.me!) >= 20 && !s.me!.careerEvents?.diagnosis,
    onFire: s => {
      majorFired(s)
      const p = s.players[s.me!.id]
      const peak = Math.max(p.overall, ...s.me!.seasons.map(x => x.overallTo), s.me!.seasonStart.overall)
      ensureCareerEvents(s).diagnosis = { year: s.year, day: s.day, peakOverall: peak, atPeak: p.overall >= 85 && p.overall >= peak - 2 }
    },
    q: '检查结果让训练计划按下暂停键：你需要较长时间的治疗。',
    ctx: '医生建议离开高强度竞技环境。你可以保留职业身份长期休养，也可以选择医疗退役。托管只会选择休养，不会替你结束生涯。',
    a: [
      { t: '接受治疗，休养十六周后再回来', g: 'warm', e: { fatigue: -15, note: '连续缺席 112 天，生涯继续' } },
      { t: '以健康为重，宣布医疗退役', g: 'warm', e: { note: '立即结束当前生涯，已有荣誉保留' }, confirm: '确定宣布医疗退役吗？当前生涯会立即结束，无法在此存档继续参赛。已有冠军与履历会保留。' },
    ],
    onResolve: (s, i) => {
      if (i === 0) return takeLeave(s, 'illness', 112, '长期治疗休养')
      const a = ensureCareerEvents(s)
      if (!a.diagnosis || s.me!.phase === 'retired') return []
      a.medicalRetirement = { ...a.diagnosis, year: s.year, day: s.day }
      recordCareerEvent(s, 'medical', '因重大疾病告别职业赛场，选择医疗退役。')
      retire(s, '因重大疾病需要长期治疗，你宣布医疗退役', 'other')
      return ['你选择了医疗退役。生涯荣誉与这次告别都会留在记录里。']
    },
  },
  {
    id: 'career_family_leave', w: 4, max: 2, rec: 0,
    when: majorEventReady, onFire: majorFired,
    q: '家里遇到突发情况，需要有人回去照料一段时间。',
    ctx: '俱乐部同意请假并安排替补。选择会影响实际参赛，不会把家庭请假写成伤病，也不会扣除未训练的信任。',
    a: [
      { t: '安排家人接力，自己先回去一周', g: 'warm', e: { mental: 1, note: '缺席 7 天' } },
      { t: '亲自留在家里，把事情安顿好', g: 'warm', e: { mental: 2, tilt: -8, note: '缺席 28 天，约半个赛段' } },
    ],
    onResolve: (s, i) => takeLeave(s, 'family', i === 0 ? 7 : 28, '获准家庭事假'),
  },
  {
    id: 'career_core_dispute', w: 4, max: 4, rec: 0,
    when: s => majorEventReady(s) && !!conflictCore(s),
    onFire: s => {
      majorFired(s)
      const p = conflictCore(s)!
      ensureCareerEvents(s).pendingCore = { mateId: p.id, mateName: p.ign, clubId: s.myTeam, sinceWeek: s.me!.week, stage: 'warning' }
    },
    q: '复盘时，长期不合的队内核心与你发生了争执。',
    ctx: '一次分歧不等于被开除。你可以寻求协调，也可以选择把矛盾升级。',
    ctxOf: s => `与 ${s.me!.careerEvents?.pendingCore?.mateName ?? '队内核心'} 的分歧摆上了桌面。私下沟通可以修复关系；公开升级会损害教练信任。`,
    a: [
      { t: '请教练主持，当面说开', g: 'warm', e: { note: '教练信任 +3，与该队友关系 +16' } },
      { t: '要求公开站队，把分歧升级', g: 'hard', e: { note: '教练信任 -8，与该队友关系 -20；进入最终协调' } },
    ],
    onResolve: (s, i) => {
      const target = coreStillHere(s)
      if (!target) return closeConflict(s, false)
      if (i === 0) return [...applyEffect(s, { coachTrust: 3 }), ...closeConflict(s, false)]
      duoBonded(s, s.me!.id, target.mateId, -20)
      target.stage = 'ultimatum'
      const lines = applyEffect(s, { coachTrust: -8 })
      recordCareerEvent(s, 'conflict', `与 ${target.mateName} 的争执升级，俱乐部要求最终协调。`, target.mateId)
      fireEvent(s, 'career_core_ultimatum')
      return [...lines, `与 ${target.mateName} 关系 -20；俱乐部仍给了你和解的机会。`]
    },
  },
  {
    id: 'career_core_ultimatum', w: 0, max: 4, rec: 0,
    when: s => coreStillHere(s)?.stage === 'ultimatum',
    q: '俱乐部要求结束公开争执，这是最后一次协调。',
    ctx: '明确拒绝协调并继续公开攻击队友，将导致真实解约。托管不会替你选择被开除。',
    a: [
      { t: '停止争吵，接受协调', g: 'warm', e: { note: '保留合同，与该队友关系 +16' } },
      { t: '拒绝协调，继续公开决裂', g: 'hard', e: { note: '俱乐部解除合同，立即成为自由人' }, confirm: '确定继续公开决裂吗？俱乐部将立即解除你的合同，你会失去本队位置并成为自由人；这次解约会记入生涯。' },
    ],
    onResolve: (s, i) => closeConflict(s, i === 1),
  },
  ...EVERYDAY_EVENTS,
]
