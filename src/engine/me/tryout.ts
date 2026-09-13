import { Rng, clamp, hashStr } from '../rng'
import type { GameState } from '../types'
import type { NodeDim, TryoutDayLog } from './types'
import { pushLog } from './log'
import { pop, push } from './pending'
import { expectOf, markDeclined, tryoutSkill } from './prepro'
import { DIM_CN } from './nodes'
import { makeDeal } from './contract'
import { tryoutNight } from './nights'

export interface TryoutOpt {
  t: string
  dim: NodeDim
  risk: number
  /** what you are actually betting — the sentence 破晓 puts under every option */
  why: string
}
export interface TryoutDay { name: string; desc: string; opts: TryoutOpt[]; rec: number }

/**
 * Four days at the club. Each day tests one thing and gives me one choice;
 * the riskier option swings the verdict harder both ways, and a failure costs
 * exactly what a success earns — a grade means nothing otherwise.
 */
/**
 * Four days at the club.
 *
 * The shape was already ours: one test a day, one choice, the riskier option
 * swinging the verdict harder both ways. What came across from 破晓's
 * tryout.ts is what each option *says* — every one of theirs carries a line
 * naming the bet («打成了就是核心，打崩了就是不合群»), and without it a
 * choice between three attribute names is a dice roll with extra steps.
 */
export const TRYOUT_DAYS: TryoutDay[] = [
  {
    name: '第一天 · 枪法考核', rec: 0,
    desc: '教练组在你身后架了台机器录屏。他们不看你杀了几个，看你每一发开枪前的那半秒。',
    opts: [
      { t: '打自己的节奏，不急', dim: 'aim', risk: 0.6, why: '数据不会难看，也不会让人记住。' },
      { t: '全程拉到最快，秀一把', dim: 'reaction', risk: 1.3, why: '打出来就是“这手得留下”，拉拉垮了就是“心太浮”。' },
      { t: '只当热身，别把手腾担累坏', dim: 'aim', risk: 0.4, why: '保住体力，代价是这一天几乎不加分。' },
    ],
  },
  {
    name: '第二天 · 训练赛', rec: 0,
    desc: '顶掉一个首发打两张图。队伍不会为你改战术，你得自己钻进去。',
    opts: [
      { t: '完全按他们的体系打', dim: 'teamwork', risk: 0.7, why: '融入得快，但录像里看不出哪一个是你。' },
      { t: '多丢道具，把队友喀舒服', dim: 'utility', risk: 0.8, why: '教练看得见，数据面板上看不见。' },
      { t: '先手冲，让他们看到枪', dim: 'reaction', risk: 1.3, why: '打成了就是核心，打崩了就是不合群。' },
    ],
  },
  {
    name: '第三天 · 复盘会', rec: 0,
    desc: '教练把昨天那个丢包的回合倒了七遍，然后问你：这一回合，问题出在谁身上。',
    opts: [
      { t: '承认是自己的错，并给出改法', dim: 'awareness', risk: 0.7, why: '教练最想听到的答案。' },
      { t: '指出这支队伍体系上的问题', dim: 'igl', risk: 1.2, why: '说服了是有主见，没说服就是听不进话。' },
      { t: '少说话，多听', dim: 'communication', risk: 0.4, why: '稳妥，但显得你没有自己的想法。' },
    ],
  },
  {
    name: '第四天 · 经理面谈', rec: 2,
    desc: '合同就摆在桌上，他没推过来。先问你一句：你觉得自己值多少。',
    opts: [
      { t: '报一个高数字', dim: 'mental', risk: 1.3, why: '有底气是加分项，没底气就是不自量力。谈成了筹码也高。' },
      { t: '先谈上场时间，钱往后放', dim: 'communication', risk: 0.9, why: '他会记住你想打比赛，不是想拿钱。' },
      { t: '都听俱乐部安排', dim: 'mental', risk: 0.5, why: '不会出错，也不会给你加什么。' },
    ],
  },
]

/**
 * What the coaching staff said when they closed the door.
 *
 * A grade with no sentence attached is a letter, not a verdict.
 */
export const GRADE_TEXT: Record<string, string> = {
  'A+': '教练组开会时用了「捡到了」这个说法。',
  A: '四天下来，他们对你没有保留意见。',
  B: '他们觉得你能用，但还不到能托付的程度。',
  C: '差了一口气。要么再练一年，要么从低一级做起。',
  D: '教练组没有留你的意思。',
}

/**
 * Which days this tryout actually runs.
 *
 * A man who has played professionally does not get re-tested on his aim in
 * a solo-queue booth — 破晓's rule, 「打过职业的人不用再考单排」, and the
 * same holds here: his match record is the test. His day one is skipped, and
 * the grade is computed over the three days he did play.
 */
export function tryoutDays(state: GameState): TryoutDay[] {
  const me = state.me!
  return me.pre.wasPro || me.phase === 'pro' ? TRYOUT_DAYS.slice(1) : TRYOUT_DAYS
}

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
    // a man under contract is bought, not signed: his club is paid (me/contract.ts joinClub)
    const deal = makeDeal(state, inv.teamId, me.phase === 'pro' ? 'transfer' : 'sign', 'A', tryoutRng(state, 9))
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    pushLog(state, 'deal', `${state.teams[inv.teamId]?.name} 免了试训，直接给了合同。`)
    return null
  }
  me.tryout = { inviteId, teamId: inv.teamId, startDay: state.day, step: 0, score: 0, log: [] }
  // the first hour at the base is a night of its own (me/nights.ts), on screen before day one
  tryoutNight(state)
  push(state, { kind: 'tryout', id: inviteId })
  return null
}

export function declineInvite(state: GameState, inviteId: string): void {
  const me = state.me!
  const inv = me.pre.invites.find((i) => i.id === inviteId)
  me.pre.invites = me.pre.invites.filter((i) => i.id !== inviteId)
  pop(state, 'invite', inviteId)
  if (inv) {
    markDeclined(state, inv.teamId)
    pushLog(state, 'info', `你回绝了 ${state.teams[inv.teamId]?.name} 的邀请。今年他们不会再来。`)
  }
}

/** The penalty of a fourth day on tired legs: 体质 shows up here, nowhere else this loudly. */
export const tryoutFatiguePenalty = (state: GameState, day: number): number =>
  day * Math.max(0, 52 - state.me!.body) * 0.055

export function tryoutChoose(state: GameState, i: number): TryoutDayLog {
  const me = state.me!
  const t = me.tryout!
  const days = tryoutDays(state)
  const day = days[t.step]
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
  if (t.step >= days.length) finishTryout(state)
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
    markDeclined(state, team.id)
    me.tryout = undefined
    return
  }
  // a professional trialled by a VCT club that came for him (me/transfer.ts vctApproach) is bought from his club
  const deal = makeDeal(state, team.id, me.phase === 'pro' ? 'transfer' : 'sign', grade, tryoutRng(state, 8))
  me.deals.push(deal)
  push(state, { kind: 'deal', id: deal.id })
  pushLog(state, 'deal', `${team.name} 试训评级 <b>${grade}</b>。${GRADE_TEXT[grade]}他们给了一份合同。`)
  me.tryout = undefined
}
