import { Rng, clamp, hashStr } from '../rng'
import type { GameState } from '../types'
import type { NodeDim, TryoutDayLog } from './types'
import { pushLog } from './log'
import { pop, push } from './pending'
import { expectOf, tryoutSkill } from './prepro'
import { DIM_CN } from './nodes'
import { makeDeal } from './contract'

export interface TryoutOpt { t: string; dim: NodeDim; risk: number }
export interface TryoutDay { name: string; desc: string; opts: TryoutOpt[]; rec: number }

/**
 * Four days at the club. Each day tests one thing and gives me one choice;
 * the riskier option swings the verdict harder both ways, and a failure costs
 * exactly what a success earns — a grade means nothing otherwise.
 */
export const TRYOUT_DAYS: TryoutDay[] = [
  { name: '第一天 · 枪法测试', desc: 'DM 与 aim 测试，教练组在后面看数据。', rec: 0,
    opts: [{ t: '稳扎稳打，打自己的节奏', dim: 'aim', risk: 0.6 }, { t: '秀一把，打出上限', dim: 'reaction', risk: 1.2 }, { t: '只当热身，别受伤', dim: 'aim', risk: 0.4 }] },
  { name: '第二天 · 训练赛', desc: '顶替一个首发打两张图。', rec: 0,
    opts: [{ t: '按他们的体系打', dim: 'teamwork', risk: 0.7 }, { t: '多做道具，让队友舒服', dim: 'utility', risk: 0.8 }, { t: '先手冲，让他们看到枪', dim: 'reaction', risk: 1.3 }] },
  { name: '第三天 · 复盘会', desc: '教练放录像，让你说。', rec: 0,
    opts: [{ t: '认真讲自己的错', dim: 'awareness', risk: 0.6 }, { t: '指出队伍体系的问题', dim: 'igl', risk: 1.1 }, { t: '少说话，多听', dim: 'communication', risk: 0.4 }] },
  { name: '第四天 · 经理面谈', desc: '聊合同之前先聊人。', rec: 2,
    opts: [{ t: '直接谈钱', dim: 'mental', risk: 1.0 }, { t: '谈上场时间', dim: 'communication', risk: 0.8 }, { t: '都听俱乐部安排', dim: 'mental', risk: 0.5 }] },
]

const tryoutRng = (state: GameState, step: number) =>
  new Rng(hashStr(`tryout:${state.seed}:${state.year}:${state.day}:${step}`))

/** Accept the invitation: four days start now (they do not move the calendar). */
export function startTryout(state: GameState, inviteId: string): string | null {
  const me = state.me!
  const inv = me.pre.invites.find((i) => i.id === inviteId)
  if (!inv) return '这份邀请已经不在了。'
  if (me.tryout) return '你正在另一家试训。'
  pop(state, 'invite', inviteId)
  if (inv.direct) {
    me.pre.invites = me.pre.invites.filter((i) => i.id !== inviteId)
    const deal = makeDeal(state, inv.teamId, 'sign', 'A', tryoutRng(state, 9))
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    pushLog(state, 'deal', `${state.teams[inv.teamId]?.name} 免了试训，直接给了合同。`)
    return null
  }
  me.tryout = { inviteId, teamId: inv.teamId, startDay: state.day, step: 0, score: 0, log: [] }
  push(state, { kind: 'tryout', id: inviteId })
  return null
}

export function declineInvite(state: GameState, inviteId: string): void {
  const me = state.me!
  const inv = me.pre.invites.find((i) => i.id === inviteId)
  me.pre.invites = me.pre.invites.filter((i) => i.id !== inviteId)
  pop(state, 'invite', inviteId)
  if (inv) {
    me.declined.push(inv.teamId)
    pushLog(state, 'info', `你回绝了 ${state.teams[inv.teamId]?.name} 的邀请。今年他们不会再来。`)
  }
}

/** The penalty of a fourth day on tired legs: 体质 shows up here, nowhere else this loudly. */
export const tryoutFatiguePenalty = (state: GameState, day: number): number =>
  day * Math.max(0, 52 - state.me!.body) * 0.055

export function tryoutChoose(state: GameState, i: number): TryoutDayLog {
  const me = state.me!
  const t = me.tryout!
  const day = TRYOUT_DAYS[t.step]
  const opt = day.opts[i] ?? day.opts[day.rec]
  const p = state.players[me.id]
  const v = opt.dim === 'mental' ? me.mental : p.attrs[opt.dim]
  const pen = tryoutFatiguePenalty(state, t.step)
  const chance = clamp(0.22 + (v - pen) / 100 * 0.62, 0.08, 0.92)
  const rng = tryoutRng(state, t.step)
  const ok = rng.chance(chance)
  const delta = (ok ? 1 : -1) * opt.risk * 4.2
  t.score += delta
  const entry: TryoutDayLog = { day: t.step, pick: opt.t, dim: DIM_CN[opt.dim], p: Math.round(chance * 100), ok }
  t.log.push(entry)
  t.step++
  if (t.step >= TRYOUT_DAYS.length) finishTryout(state)
  return entry
}

export function gradeOf(d: number): string {
  return d >= 16 ? 'A+' : d >= 8 ? 'A' : d >= 0 ? 'B' : d >= -9 ? 'C' : 'D'
}

function finishTryout(state: GameState): void {
  const me = state.me!
  const t = me.tryout!
  const team = state.teams[t.teamId]
  const d = tryoutSkill(state) + t.score + me.pre.tac * 0.1 - expectOf(team)
  const grade = gradeOf(d)
  t.grade = grade
  me.pre.invites = me.pre.invites.filter((i) => i.id !== t.inviteId)
  pop(state, 'tryout', t.inviteId)
  me.pre.scoutSeen += 1
  if (grade === 'D' || (grade === 'C' && team.tier === 1 && !me.pre.wasPro)) {
    pushLog(state, 'bad', `${team.name} 试训评级 ${grade}：他们说以后再联系。（差距 ${Math.round(-d)} 分）`)
    me.declined.push(team.id)
    me.tryout = undefined
    return
  }
  const deal = makeDeal(state, team.id, 'sign', grade, tryoutRng(state, 8))
  me.deals.push(deal)
  push(state, { kind: 'deal', id: deal.id })
  pushLog(state, 'deal', `${team.name} 试训评级 ${grade}，给了一份合同。`)
  me.tryout = undefined
}
