/**
 * What this stretch of a career is for, and what this week is best spent on.
 *
 * Reported 2026-09-18 by a tester on a 2021 ladder start: 「没有进来的引导教学，不知道下一步要点哪，
 * 不知道哪些是重要的事情哪些是休赛期点的。」 The tour named the regions of the page and never said what
 * they were for. 破晓 answers it on its week page with a card on who can see you and whether you are
 * short on the ladder or on being seen — 练段位还是去露脸, in words. This is that, in our own words:
 * the goal of the phase in one sentence, the one thing this week is best spent on, how far off each
 * road to the goal is, and which of the week's cards serve it and which are 调剂.
 *
 * Nothing here decides anything. Every line reads a rule the engine already keeps — the invitation
 * lines (prepro.ts INVITE_*), the three months before the ladder and the following bring calls
 * (PRE_EARLIEST), the cups' weeks (cups.ts), the 自荐's gate and odds (selfpitch.ts), the coach's own
 * sentence (coach.ts standingLine) and the hour worth the most to 综合 (growth.ts hourValues) — so the
 * card cannot drift away from what the week will actually do.
 */
import type { GameState } from '../types'
import { ATTR_CN } from '../types'
import type { MeAction } from './types'
import { ACTIONS } from './actions'
import { hourValues } from './growth'
import { INVITE_FANS, INVITE_LADDER, PRE_EARLIEST } from './prepro'
import { onBoard, rankAt, rankBar, rankFull, rankText, standingOf } from './rank'
import { CUPS, cupView } from './cups'
import { fanTier, fansCn } from './fans'
import { PITCH_AP, oddsWord, pitchBlock, pitchTargets } from './selfpitch'
import { pitchBook } from './pitchbook'
import { EDGE_NEED, TRIAL_MATCHES, promiseSeat, standingLine } from './coach'
import { duelBlock } from './duel'
import { staminaLeft } from './week'
import { dateCn } from './window'
import { formatOf } from '../era'

/** where a career is: without a club, or at one — each phase's guidance is put away on its own */
export type GoalPhase = 'pre' | 'pro'

/**
 * 拿到合同 without a club; at one, 抢到首发 from the bench, 把试用期打下来 on trial, and as a starter
 * 打稳首发 — on the second tier with being seen by the first on top of it.
 */
export type GoalKind = 'contract' | 'seat' | 'trial' | 'rise' | 'hold'

export interface Goal {
  kind: GoalKind
  phase: GoalPhase
  /** the goal in one sentence: 拿到第一份合同 */
  title: string
  /** what it takes, one or two short sentences */
  how: string
}

/** the club tier above the second, as the year names it (the hero's 一线 / 二线 in the open years) */
const topWord = (state: GameState): string => (formatOf(state.year) === 'open' ? '一线队' : 'VCT 俱乐部')

export function goalOf(state: GameState): Goal | null {
  const me = state.me
  if (!me || me.phase === 'retired' || state.gameOver) return null
  if (me.phase !== 'pro') {
    return {
      kind: 'contract', phase: 'pre',
      title: me.pre.wasPro ? '再拿到一份合同' : '拿到第一份合同',
      how: '俱乐部从四处发现你：杯赛走得远、天梯打上去、粉丝涨起来，或者你去「转会」页自荐。',
    }
  }
  const team = state.teams[state.myTeam]
  const starter = !!team?.starters.includes(me.id)
  if (me.trial) {
    return { kind: 'trial', phase: 'pro', title: '把试用期打下来', how: `还剩 ${me.trial.left} 场正赛：赢下比赛或打出队内前二就算过。` }
  }
  if (!starter) {
    return {
      kind: 'seat', phase: 'pro', title: '抢到首发',
      how: `教练每周一排首发，看综合、状态和他对你的信任。替补时打对位挑战、跟队训练赛让他看见你，赢够对位给你 ${TRIAL_MATCHES} 场正赛的试用期。`,
    }
  }
  if (team && team.tier !== 1) {
    return {
      kind: 'rise', phase: 'pro', title: `打稳首发，让${topWord(state)}看到你`,
      how: '教练每周一排首发，看综合、状态和他对你的信任。赛段里打得好，别队教练会记下你，窗口开着就可能来报价。',
    }
  }
  return {
    kind: 'hold', phase: 'pro', title: '打稳首发，帮队伍赢下比赛',
    how: '教练每周一排首发，看综合、状态和他对你的信任。跟队训练赛让他看得见你，正赛打得好，位置就是你的。',
  }
}

/** a line with one word in bold: `pre` <b>`b`</b> `post` */
export interface Line { pre: string; b?: string; post: string }

/** The hour worth the most to 综合 right now (growth.ts hourValues) — the week board's own line, said once. */
export function hourLine(state: GameState): Line | null {
  const best = hourValues(state)[0]
  const label = best && ACTIONS.find((a) => a.key === best.key)?.label
  if (!best || !label) return null
  return { pre: '现在练', b: label, post: `对综合涨得最多（${best.attrs.map((k) => ATTR_CN[k]).join('、')}还有空间）。` }
}

/** 远 → 够了, for a road's distance in words */
export const NEAR_CN = ['还远', '还差一截', '快到了', '够了'] as const
export type Near = 0 | 1 | 2 | 3

/** Without a club in the career's first year, the ladder and the following bring no call before PRE_EARLIEST weeks (prepro.ts rollInvites). */
export const callsShut = (state: GameState): boolean => {
  const me = state.me!
  return me.phase !== 'pro' && !me.pre.wasPro && me.pre.year === 1 && me.week < PRE_EARLIEST
}

/** the ladder against the line where clubs start to call, as rollInvites reads it: today's place (rank.ts standingOf) */
export function ladderNear(state: GameState): Near {
  const l = standingOf(state)
  return l >= INVITE_LADDER ? 3 : l >= INVITE_LADDER - 6 ? 2 : onBoard(l) ? 1 : 0
}

/** the following against 「有固定观众」, where they start to call */
export function fansNear(state: GameState): Near {
  const r = state.me!.fans / INVITE_FANS
  return r >= 1 ? 3 : r >= 0.75 ? 2 : r >= 0.4 ? 1 : 0
}

export interface Road {
  key: 'cup' | 'ladder' | 'fans' | 'pitch'
  label: string
  /** where it stands, in words */
  text: string
  near: Near
  /** the figures behind it, for the 数值 switch */
  nums?: string
  /** a page that acts on it */
  go?: { screen: string; label: string }
}

/** The cup still ahead this year, or the one being played: its name, and when. */
export function cupAhead(state: GameState): { name: string; weeks: number; minFans: number } | null {
  const me = state.me!
  const week = Math.floor(state.day / 7)
  const region = state.players[me.id]?.region
  for (const raw of CUPS) {
    const c = cupView(raw, state.year, region)
    if (c.week < week) continue
    if (me.pre.cup?.key === c.key) continue
    if (me.pre.cups.some((x) => x.key === c.key && x.year === state.year)) continue
    if (me.pre.seen.includes(`${state.year}:${c.key}`)) continue
    return { name: c.name, weeks: c.week - week, minFans: c.minFans }
  }
  return null
}

/** The four ways a club finds a player without one, each as far as it stands today. */
export function roadsOf(state: GameState): Road[] {
  const me = state.me!
  const roads: Road[] = []

  // 杯赛: the run under way, else the next one this year
  const run = me.pre.cup
  const raw = run && CUPS.find((x) => x.key === run.key)
  if (run && raw) {
    const c = cupView(raw, state.year, state.players[me.id]?.region)
    const left = (run.next ?? state.day) - state.day
    roads.push({ key: 'cup', label: '杯赛', near: 2, text: `${c.name}打到${c.rounds[run.round]?.label ?? '下一轮'}，${left <= 0 ? '今天开打' : `${left} 天后开打`}` })
  } else {
    const next = cupAhead(state)
    if (next) {
      const fans = next.minFans && me.fans < next.minFans ? `，邀请制，粉丝要到「${fanTier(next.minFans).name}」` : ''
      roads.push({ key: 'cup', label: '杯赛', near: next.weeks <= 2 ? 2 : 1, text: `${next.name} ${next.weeks === 0 ? '本周报名' : `${next.weeks} 周后报名`}${fans}` })
    } else {
      roads.push({ key: 'cup', label: '杯赛', near: 0, text: '今年的杯赛打完了，明年开春再来' })
    }
  }

  // 天梯: where I stand today against where the calls start, and how long I have stood there (prepro.ts noteWatched)
  const ln = ladderNear(state)
  const now = rankText(rankAt(state))
  const watched = me.pre.scoutWeeks ?? 0
  roads.push({
    key: 'ladder', label: '天梯', near: ln, nums: `${rankFull(rankAt(state))}${ln === 3 ? ` · 站住 ${watched} 周` : ''}`,
    text: ln === 3
      ? `${now}：够了，${watched > 1 ? '站住越久来电话越勤' : '俱乐部会来看'}`
      : `${now}，要到${rankBar(state, INVITE_LADDER)}：${NEAR_CN[ln]}`,
  })

  // 粉丝: in the tiers' own words
  const fn = fansNear(state)
  roads.push({
    key: 'fans', label: '粉丝', near: fn, nums: `${fansCn(me.fans)} / ${fansCn(INVITE_FANS)}`,
    text: fn === 3 ? `${fanTier(me.fans).name}：够了` : `${fanTier(me.fans).name}，要到「${fanTier(INVITE_FANS).name}」：${NEAR_CN[fn]}`,
  })

  // 自荐: one on its way, the gate that shuts it, or the best chance among the clubs open to it
  const pitch = pitchNow(state)
  if (pitch.out) {
    roads.push({ key: 'pitch', label: '自荐', near: 2, text: `已发给 ${state.teams[pitch.out.teamId]?.name ?? '俱乐部'}，${dateCn(pitch.out.due, state.year)}前回复` })
  } else if (pitch.why) {
    roads.push({ key: 'pitch', label: '自荐', near: 0, text: pitch.why })
  } else {
    const best = pitch.best
    roads.push({
      key: 'pitch', label: '自荐', near: best >= 25 ? 2 : best >= 10 ? 1 : 0,
      nums: best ? `最高 ${best}%` : undefined,
      go: { screen: 'transfer', label: '去挑一家' },
      text: best ? `每次 ${PITCH_AP} 点；把握最大的一家：${oddsWord(best)}` : '眼下没有投得了的俱乐部',
    })
  }
  return roads
}

/**
 * The 自荐 as the transfer page would take it today: one on its way, the gate that shuts every club
 * (selfpitch.ts pitchBlock) — this week's action points aside, the button's business and not the road's —
 * or the best chance among the clubs open to one, the figure the button prints.
 */
function pitchNow(state: GameState): { out?: { teamId: string; due: number }; why: string | null; best: number } {
  const me = state.me!
  const out = pitchBook(state).out
  if (out) return { out, why: null, best: 0 }
  const why = pitchBlock(state)
  if (why && !(me.ap < PITCH_AP && why.startsWith('本周行动点'))) return { why, best: 0 }
  return { why: null, best: pitchTargets(state).rows.filter((r) => !r.why).reduce((m, r) => Math.max(m, r.odds.pct), 0) }
}

/**
 * The one thing this week is best spent on. Without a club: a cup round this week first; a 自荐 with a
 * real chance; in the first three months, 综合 for the cups; a road already close; else the hour worth the most. At a club, from the
 * bench, the 对位挑战 while it can be played; else the hour worth the most.
 */
export function weekLine(state: GameState): Line | null {
  const me = state.me!
  if (me.phase !== 'pro') {
    const run = me.pre.cup
    const raw = run && CUPS.find((x) => x.key === run.key)
    const left = run ? (run.next ?? state.day) - state.day : 99
    if (run && raw && left < 7 - me.weekDay) {
      const c = cupView(raw, state.year, state.players[me.id]?.region)
      return { pre: `${c.name}${c.rounds[run.round]?.label ?? ''}${left <= 0 ? '今天' : ` ${left} 天后`}开打：`, b: '按推荐做完', post: '会给比赛留出体力。' }
    }
    // a 自荐 with a real chance is the one thing no plan does for you (托管 never sends one)
    const pitch = pitchNow(state)
    if (!pitch.out && !pitch.why && pitch.best >= 25 && me.ap >= PITCH_AP) {
      return { pre: '去「转会」页发一封', b: '自荐', post: `：把握最大的一家${oddsWord(pitch.best)}。` }
    }
    const hour = hourLine(state)
    if (callsShut(state)) {
      // PRE_EARLIEST weeks, said in months
      return hour ? { pre: '前两个月只有杯赛会带来电话，先把综合练上去：现在练', b: hour.b, post: '涨得最多。' } : null
    }
    if (ladderNear(state) === 2) return { pre: `天梯离${rankBar(state, INVITE_LADDER)}不远了：多打`, b: '排位', post: '。' }
    if (fansNear(state) === 2) return { pre: `粉丝快到「${fanTier(INVITE_FANS).name}」了：点两次`, b: '直播', post: '。' }
    return hour
  }
  const team = state.teams[state.myTeam]
  if (team && !team.starters.includes(me.id) && !me.trial && promiseSeat(state) !== 'bench') {
    const why = duelBlock(state)
    if (!why || why.startsWith('要 ')) {
      return { pre: '打', b: '对位挑战', post: `：再赢约 ${Math.max(1, Math.ceil(EDGE_NEED - me.edge))} 场，教练给 ${TRIAL_MATCHES} 场正赛的试用期。` }
    }
  }
  return hourLine(state)
}

/**
 * At a club, how far off the goal is: where I stand with the coach, in the team screen's own sentence
 * (coach.ts standingLine). From the bench with the 对位 open, the week's line already counts the wins
 * still needed, so it is not said twice.
 */
export function farLine(state: GameState): string | null {
  if (state.me!.phase !== 'pro') return null
  if (goalOf(state)?.kind === 'seat' && weekLine(state)?.b === '对位挑战') return null
  return standingLine(state, 'team') || null
}

/** 重点: serves the goal this week. 调剂: the hours outside the game, right when the note under them says so. */
export type Weight = 'focus' | 'filler'

/** 体力 under this and the week's rest is part of the work, as the bar turns red (Week.tsx) */
const TIRED = 40

/**
 * Which of the week's cards serve the goal and which are 调剂. Without a club, the four practices; at a
 * club, 跟队训练赛 and the hour worth the most, and from the bench the 对位挑战. 休息 is part of the work
 * once the body is down, 直播 once the following is close or a deal or a task asks for it. A card
 * that is neither says nothing.
 */
export function weightsOf(state: GameState): Partial<Record<MeAction, Weight>> {
  const me = state.me!
  const out: Partial<Record<MeAction, Weight>> = { stream: 'filler', content: 'filler', rest: 'filler' }
  const goal = goalOf(state)
  if (!goal) return {}
  if (goal.phase === 'pre') {
    for (const k of ['aim', 'vod', 'util', 'ranked'] as const) out[k] = 'focus'
    if (!callsShut(state) && fansNear(state) === 2) out.stream = 'focus'
  } else {
    out.scrim = 'focus'
    const best = hourValues(state)[0]
    if (best) out[best.key] = 'focus'
    if (goal.kind === 'seat') out.duel = 'focus'
  }
  if (me.quests.some((q) => q.kind === 'stream' && q.done < q.need)) out.stream = 'focus'
  if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage) out.stream = 'focus'
  if (staminaLeft(state) < TIRED) out.rest = 'focus'
  return out
}

/** When the hours outside the game are the right call — said once over them, not on every card. */
export function fillerNote(state: GameState): string {
  const pro = state.me!.phase === 'pro'
  return pro
    ? '调剂：体力见底先休息；缺钱或签了直播合约，再直播、做内容。'
    : '调剂：体力见底先休息；缺钱或想走粉丝这条路，再直播、做内容。'
}
