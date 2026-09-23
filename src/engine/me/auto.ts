import { Rng, clamp, hashStr } from '../rng'
import { activeAbsence, absenceBlock } from './absence'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player, Role } from '../types'
import { duoMate, hourValues } from './growth'
export { duoMate }
import { emptyTalents, talentsOf } from './career'
import { ceilingOf, weightsFor } from '../player'
import { chasing } from './bottleneck'
import { ACTIONS, ACTION_BY_KEY } from './actions'
import { advanceWeek, doAction, doDuel } from './week'
import type { WeekStop } from './week'
import { FRIENDLY_MAP_FATIGUE, MeMatch } from './matchplay'
import { EDGE_NEED } from './coach'
import type { MeAction, PendingItem } from './types'
import { pop } from './pending'
import { asideItems, asideStop, lapsedSince } from './aside'
import { cupFor, enterCup, mountCupMatch, afterCupMatch, skipCup, TEMP_MINE, TEMP_OPP, cupRng, forfeitCup, isCupRound } from './cups'
import { declineInvite, startTryout, tryoutChoose, tryoutDays } from './tryout'
import { acceptDeal, declineDeal } from './contract'
import { answerStreamOffer } from './stream'
import { eventOf, resolveEvent } from './events'
import { takeIgl } from './igl'
import { COURSES, FLAT_RELIEF, GEAR_PRICE, RELAX, RELIEF_FLOOR, buyCourse, buyGear, buyRelax, GEAR_SLOTS, gearModel } from './shop'
import { autoOutlets } from './outlets'
import { fanCap } from './fans'
import { expectOf, tryoutSkill } from './prepro'
import { CEREMONIES, cerSkip } from './ceremony'
import { compCn } from './compname'
import { injuryHelpedBy, injuryStatus } from './injury'
import { autoHurt, autoSitsOut } from './hurtplay'
import { eventOf as circuitEventOf } from '../circuit'
import { momentMark } from './moments'
import { chainMate, chainTask } from './storyweek'
import { mineBy } from './nextup'
import { closePitchReply } from './selfpitch'
import { runScheduledSecondary, SECONDARY_AP } from './secondaryRole'

/** fatigue the steady plan leaves at the end of a week: 体力 60, where the week screen's bar is still green */
export const WEEK_END_FATIGUE = 40

/**
 * The fatigue my matches still to come this week will book: my club's
 * (matchplay.ts: a map on the floor 5, on the bench 1.5), and the round of my
 * cup this week holds (a map of it FRIENDLY_MAP_FATIGUE) — a club's man can be
 * in one too, between its events (me/cups.ts clubCupBlock).
 */
export function matchLoad(state: GameState): number {
  const me = state.me!
  const last = state.day - me.weekDay + 7
  const maps = (bo: number) => bo === 1 ? 1 : bo === 2 ? 2 : bo === 5 ? 4 : 2.5
  const run = me.pre.cup
  const r = run && cupFor(state, run.key)?.rounds[run.round]
  const cup = run && r && run.next != null && run.next <= last ? maps(r.bo) * FRIENDLY_MAP_FATIGUE : 0
  if (me.phase !== 'pro') return cup
  const club = state.myTeam
  const starter = !!state.teams[club]?.starters.includes(me.id)
  let load = run?.club === club ? cup : 0
  for (const f of state.fixtures) {
    if (f.played || f.comp === 'scrim' || f.day > last || (f.teamA !== club && f.teamB !== club)) continue
    load += maps(f.bo) * (starter ? 5 : 1.5)
  }
  return load
}

/**
 * Where fatigue lands at the end of this week as things stand: what the body
 * carries now — every hour already clicked is already in it (me/week.ts
 * doAction) — the matches still to come, and what a week gives back by itself
 * (growth.ts settleBody).
 */
export function weekEndFatigue(state: GameState, load = matchLoad(state)): number {
  const me = state.me!
  let f = state.players[me.id].fatigue + load
  f -= clamp(6 + (me.body - 50) / 10, 3, 12)
  // the flat gives a hard week back, down to RELIEF_FLOOR (growth.ts settleBody)
  return me.flags.relax_flat && f > RELIEF_FLOOR ? Math.max(RELIEF_FLOOR, f - FLAT_RELIEF) : f
}

/** A practice session of the steady plan: the three the role picks from, and 双排 for a talent in 沟通. */
export type Practice = 'aim' | 'vod' | 'util' | 'duo'

/** Fixed tail sessions follow the role, not a universal VOD + aim programme.
 * The first slot still reacts to current room; talentSessions can replace one
 * tail and practiceWithRoom still resolves ceilings at the moment of spending. */
export const ROLE_PRACTICE: Record<Role, [Practice, Practice]> = {
  决斗者: ['vod', 'aim'], 先锋: ['util', 'vod'], 控场: ['util', 'vod'],
  哨卫: ['vod', 'util'], 自由人: ['vod', 'aim'],
}

/** Support specialists still need basic gunplay. At most one tail slot every
 * four weeks catches up a large gap; no extra hours and no permanent gun slot.
 * Ceilings, fatigue, talent choices and live breakthroughs keep their guards. */
export function rolePractice(p: Player, week: number, preserveTail = false): [Practice, Practice] {
  const tail: [Practice, Practice] = [...ROLE_PRACTICE[p.role]]
  if (preserveTail || (p.role !== '先锋' && p.role !== '控场' && p.role !== '哨卫')) return tail
  const gun = (p.attrs.aim + p.attrs.reaction) / 2
  const craft = (p.attrs.awareness + p.attrs.utility) / 2
  if (week % 4 === 3 && craft - gun >= 12 && (p.attrs.aim < ceilingOf(p, 'aim') || p.attrs.reaction < ceilingOf(p, 'reaction'))) tail[1] = 'aim'
  return tail
}

/**
 * The practice that trains each attribute, for the talent's session: the week board's own (actions.ts), 复盘
 * carrying 指挥 too — and for 沟通 two 队友双排, which put 0.3 of a training week an hour into it where a
 * session of 道具与跑图 puts 0.11 in two (growth.ts runAction), with the team-mate I get on worst with.
 */
export const TALENT_PRACTICE: Record<keyof Attrs, Practice> = {
  aim: 'aim', reaction: 'aim', awareness: 'vod', clutch: 'vod', igl: 'vod',
  utility: 'util', teamwork: 'util', communication: 'duo',
}
/** the golden ratio's fractional part: week n's talent pick sits at (n + 1) × this, mod 1 */
export const TALENT_STEP = (Math.sqrt(5) - 1) / 2
/** the attribute whose break counts a session (me/bottleneck.ts breakCount, and 枪法's two a week): while it is live the session stays */
const FEEDS: Record<Exclude<Practice, 'duo'>, keyof Attrs> = { aim: 'aim', vod: 'awareness', util: 'utility' }

/** Resolve a personal-practice slot without spending anything. A fixed tail
 * session must still have something to do: room in ANY attribute it trains
 * (including vod's IGL study), a live breakthrough, or a non-attribute reward.
 * Recheck immediately before each session: an earlier one may fill its bar.
 * The role/talent's choice wins whenever useful; only an empty slot changes.
 */
export function practiceWithRoom(state: GameState, preferred: Exclude<Practice, 'duo'>): Exclude<Practice, 'duo'> | null {
  const me = state.me!
  const values = hourValues(state)
  const useful = (key: Exclude<Practice, 'duo'>): boolean =>
    values.some((h) => h.key === key && h.attrs.length > 0)
    // Two aim sessions are all this week's grind asks for; capped extras bank no XP.
    || (chasing(state, FEEDS[key]) && (key !== 'aim' || (me.plan.aim ?? 0) < 2))
    || me.quests.some((q) => q.kind === 'train' && q.done < q.need)
    || (key === 'vod' && me.courses.includes('review') && me.tilt > 0)
  if (useful(preferred)) return preferred
  // Existing hourValues is a pure, deterministic estimate. It includes mixed
  // practice and IGL, unlike testing only the action's first attribute.
  for (const h of values) if (h.key === 'aim' || h.key === 'vod' || h.key === 'util') return h.key
  for (const key of ['aim', 'vod', 'util'] as const) if (useful(key)) return key
  return null
}

/** points past 均衡型 at which the talent has its session every week; a smaller lean has it that share of the weeks */
export const LEAN_FULL = 6

/** How far a talent leans past 均衡型 (career.ts emptyTalents, the build the role's three sessions were drawn on), attribute by attribute, never under zero. */
export function talentLean(t: Record<keyof Attrs, number>): Record<keyof Attrs, number> {
  const even = emptyTalents()
  return Object.fromEntries(ATTR_KEYS.map((k) => [k, Math.max(0, (t[k] ?? 0) - even[k])])) as Record<keyof Attrs, number>
}

/**
 * This week's talent pick, or null for a week the role's plan keeps: an attribute with room under its ceiling,
 * in proportion to the points it has past 均衡型 (talentLean). The line is the lean — LEAN_FULL when the lean is
 * shorter, and what it does not cover is the role's — so a preset build (7 to 12 points past 均衡型) has the
 * session every week, a point or two moved off 均衡型 one week in six or in three, and 均衡型 itself never.
 * Not a roll: week n takes the point (n + 1) × TALENT_STEP mod 1 along the line, and those points fall into each
 * share as often as it is long — over any ten weeks or so the picks split as the lean does, a save picks the
 * same way every time, and nothing is kept.
 */
export function talentPick(state: GameState): keyof Attrs | null {
  const me = state.me!
  const p = state.players[me.id]
  const lean = talentLean(talentsOf(state))
  const open = ATTR_KEYS.filter((k) => lean[k] > 0 && p.attrs[k] < ceilingOf(p, k))
  const total = open.reduce((s, k) => s + lean[k], 0)
  if (!total) return null
  const at = (((me.week + 1) * TALENT_STEP) % 1) * Math.max(total, LEAN_FULL)
  let acc = 0
  for (const k of open) {
    acc += lean[k]
    if (at < acc) return k
  }
  return null
}

/**
 * The week's three practice sessions, with the talent's among them (decided 2026-09-14, 「托管训练跟着天赋走」).
 *
 * The steady plan practised only what the role is judged on — the session of its weakest attribute, 复盘 and
 * 枪法训练 — so on 快进 and 托管 the points put into 指挥 or 沟通 trained nothing the role did not. A 指挥型
 * duelist ended six seasons at 沟通 67–71, under what a coach wants from his caller, and called 25 weeks in one
 * career of three (scripts/probe_igl.ts).
 *
 * Now, for a talent that leans off 均衡型, one session in three is the talent's: about a third of the practice
 * hours, a quarter of a professional week's eight points. It is the practice of the week's pick (talentPick,
 * TALENT_PRACTICE), and it takes the place of the session worth the least to 综合 this week (growth.ts
 * hourValues) — never one a live break is counting (FEEDS), and never one of its own practice, so the talent
 * always adds a session: a 指挥型 duelist whose pick is 指挥 gives up an 枪法训练 for a second 复盘.
 *
 * Weighted by the raw points, 均衡型 — points everywhere — put a third of its practice off its role too: the
 * balanced duelist's 道具 and 沟通 rose, he out-rated his team-mates in defeat and argued as the one who had
 * carried, and over six seasons his arguments went from 7 to 27 and his average bond from 19 to 5, for 0.3 of
 * peak (probe_igl.ts, 3 seeds). So the pick reads the lean past 均衡型, and 均衡型 practises as it always has.
 */
export function talentSessions(state: GameState, role: Practice[], preserve: readonly number[] = []): Practice[] {
  const k = talentPick(state)
  if (!k) return role
  const own: Practice = TALENT_PRACTICE[k] === 'duo' && !duoMate(state) ? 'util' : TALENT_PRACTICE[k]
  const worth = new Map<string, number>(hourValues(state).map((h) => [h.key, h.perPoint]))
  const room = role
    .map((s, i) => ({ s, i, v: worth.get(s) ?? 0 }))
    .filter((x) => !preserve.includes(x.i) && x.s !== own && (x.s === 'duo' || !chasing(state, FEEDS[x.s])))
    .sort((a, b) => a.v - b.v || a.i - b.i)[0]
  if (!room) return role
  const out = [...role]
  out[room.i] = own
  return out
}

/**
 * The steady plan — never the best plan. Chase a trial when benched, practise
 * what the role is judged on and, a session in three, what the talent is in
 * (talentSessions) — keep the ladder warm without a club — and not at
 * the body's expense: an hour goes on only while the week still ends with
 * 体力 60 or so, and rest makes the room when it would not. `talent` false
 * leaves the role's three sessions as they were (scripts/probe_igl.ts).
 *
 * It used to rest by thresholds (once above 45 fatigue, twice above 65) and put
 * every other point into training whatever it cost, matches not counted. On the
 * recommended plan 体力 sat under 40 for most of a year (reported 2026-09-11;
 * a probe's ladder start had 24 weeks under 40). The headless bot's week goes
 * through exactly the buttons' functions.
 */
export function autoPlan(state: GameState, talent = true): string {
  const me = state.me!
  const p = state.players[me.id]
  const pro = me.phase === 'pro'
  const team = state.teams[state.myTeam]
  const starter = pro && team.starters.includes(me.id)
  const load = matchLoad(state)
  const end = () => weekEndFatigue(state, load)
  const spend = (k: keyof typeof ACTION_BY_KEY) => doAction(state, k) === null
  const rest = ACTION_BY_KEY.rest
  const was = { ap: me.ap, plan: { ...me.plan }, stamina: Math.round(100 - p.fatigue), trainedWeek: me.positionTraining?.trainedWeek }
  const said = () => autoLine(state, was)
  if (activeAbsence(state)) {
    spend('vod')
    while (me.ap > 0 && spend('rest')) { /* approved leave */ }
    return said()
  }
  runScheduledSecondary(state)
  // hurt: the week goes on rest, which is what heals it (me/injury.ts) — a signed stream minimum aside
  if (injuryStatus(state)) {
    if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage) spend('stream')
    while (me.ap > 0 && spend('rest')) { /* resting */ }
    return said()
  }
  // a chain under way asks for its hours first: there is no taking an hour back
  // to make room for it any more (me/storyweek.ts storyPlan)
  const task = chainTask(state)
  if (task && task !== 'quiet') {
    if (task === 'duo') me.duoWith = chainMate(state) ?? duoMate(state)?.id ?? me.duoWith
    spend(task)
  }
  // 「安静」: this week must stay off the stream, so it is never spent on one —
  // a signed platform's minimum excepted, which is a contract and beats the chain
  const quiet = task === 'quiet'
  // an hour of k if the week can take it; rest first while that makes the room and still leaves the hour's points
  const want = (k: keyof typeof ACTION_BY_KEY): boolean => {
    const d = ACTION_BY_KEY[k]
    let guard = 0
    while (end() + d.fatigue > WEEK_END_FATIGUE && me.ap >= d.cost + rest.cost && guard++ < 12 && spend('rest')) { /* making room */ }
    return end() + d.fatigue <= WEEK_END_FATIGUE && spend(k)
  }

  if (pro && !starter && !me.trial && me.edge < EDGE_NEED) {
    let guard = 0
    // the way off the bench, but not on legs that are gone: a duel wears twice (runDuel, and the week's books)
    while (me.ap >= ACTION_BY_KEY.duel.cost && guard++ < 3 && end() + ACTION_BY_KEY.duel.fatigue * 2 <= WEEK_END_FATIGUE + 20) {
      const r = doDuel(state)
      if (typeof r === 'string') break
      if (r.trial) break
    }
  }

  const w = weightsFor(p)
  // an attribute at its ceiling takes no hours from the steady plan (me/bottleneck.ts) —
  // except 枪法 while its grind is live, whose ceiling is broken by exactly those hours
  const weakest = ATTR_KEYS
    .filter((k) => k !== 'igl' && p.attrs[k] < ceilingOf(p, k))
    .sort((a, b) => p.attrs[a] / w[a] - p.attrs[b] / w[b])[0]
  const first: Practice = weakest === 'aim' || weakest === 'reaction' ? 'aim'
    : weakest === 'awareness' || weakest === 'clutch' ? 'vod' : 'util'
  const tail = ROLE_PRACTICE[p.role][1]
  const preserveTail = tail !== 'duo' && chasing(state, FEEDS[tail])
  const tailPlan = rolePractice(p, me.week, preserveTail)
  const role: Practice[] = [first, ...tailPlan]
  // A craft-heavy talent must not immediately replace its scheduled, bounded
  // catch-up with a third craft session. Its other two slots remain available.
  const catchUp = tail !== 'aim' && tailPlan[1] === 'aim'
  const sessions = talent ? talentSessions(state, role, catchUp ? [2] : []) : role
  const session = (s: Practice): void => {
    if (s !== 'duo') {
      const useful = practiceWithRoom(state, s)
      if (useful) want(useful)
      return
    }
    const mate = duoMate(state)
    if (!mate) {
      const useful = practiceWithRoom(state, 'util')
      if (useful) want(useful)
      return
    }
    me.duoWith = mate.id
    want('duo')
    want('duo')
  }
  session(sessions[0])
  if (chasing(state, 'aim') && (me.plan.aim ?? 0) < 2) want('aim')
  if (pro && me.ap >= 3 && !starter) want('scrim')
  if (!pro) { want('ranked'); want('ranked') }
  session(sessions[1])
  session(sessions[2])
  if (!quiet && me.quests.some((q) => q.kind === 'stream' && q.done < q.need)) want('stream')
  // a signed stream deal is a contract: its minimum is kept even on a tired week, and even on a 「安静」 week
  if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage && !want('stream')) spend('stream')
  while (me.ap > 0) {
    if (!quiet && me.ap >= 2 && me.fans < 200 && want('stream')) continue
    if (want('ranked')) continue
    // nothing else fits this week: the hour goes to rest, while there is anything to rest off
    if (end() > 0 && spend('rest')) continue
    break
  }
  return said()
}

/** what 按推荐做完 did, in one line — 破晓 says it in one line too (routine.ts quickPlan) */
function autoLine(state: GameState, was: { ap: number; plan: Partial<Record<MeAction, number>>; stamina: number; trainedWeek?: number }): string {
  const me = state.me!
  const p = state.players[me.id]
  const spent = was.ap - me.ap
  const parts = ACTIONS
    .map((a) => ({ a, n: (me.plan[a.key] ?? 0) - (was.plan[a.key] ?? 0) }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.a.label} ×${x.n}`)
  if (was.trainedWeek !== me.week && me.positionTraining?.trainedWeek === me.week) parts.push('副位置训练 ×1')
  if (!parts.length) return me.ap > 0 ? '这周没有还能做的事了，剩下的行动点用不出去。' : '这周的行动点已经用完了。'
  const now = Math.round(100 - p.fatigue)
  return `按推荐做完了 ${spent} 点：${parts.join('、')}。体力 ${was.stamina} → ${now}。`
}

/** Answer whatever is in front of me the steady way. Returns a line for the record. */
export function autoResolve(state: GameState, item: PendingItem): string {
  const me = state.me!
  const rng = new Rng(hashStr(`auto:${state.seed}:${state.year}:${state.day}:${item.kind}:${item.id ?? ''}`))
  switch (item.kind) {
    case 'ceremony': {
      // the autopilot does not play reflex games; skipping is silver, and
      // silver is the neutral middle, so nothing is lost by being away
      const name = me.cer ? CEREMONIES[me.cer.kind].name : '仪式'
      cerSkip(state)
      return `${name}：没参加那个环节`
    }
    case 'cup': {
      const cup = cupFor(state, item.id!)
      if (!cup) { skipCup(state, item.id!); return '' }
      // a round of the run I am in: today's match (me/cups.ts, a round a week)
      if (isCupRound(state, item)) {
        const run = me.pre.cup!
        const label = cup.rounds[run.round]?.label ?? ''
        // a round's card on a day that is not its own has nothing to play (resumeCup puts it back on the day)
        if (run.next != null && run.next > state.day) { pop(state, 'cup', item.id); return '' }
        // hurt on the day, the way a match day of my club's goes (me/hurtplay.ts autoHurt): anything that can leave a mark sits out — in a cup, a forfeit
        if (autoSitsOut(state)) { forfeitCup(state, rng); return `带伤，${cup.name}${label}弃权` }
        const m = mountCupMatch(state, cup, run.round, cupRng(state, `r${run.round}`))
        const rec = new MeMatch(state, { aId: TEMP_MINE, bId: TEMP_OPP, bo: m.bo, comp: cup.name, label: m.label }).runOut()
        afterCupMatch(state, rec.won, rec.score, rng)
        return `${cup.name}${label} ${rec.won ? '胜' : '负'} ${rec.score}`
      }
      // signed, a cup between the club's events is the player's own call (me/cups.ts clubCupBlock): 托管 keeps to the
      // club's career and leaves it. Entered for him, a 2021 Korean Challengers career played June's 主播杯, came into its
      // Stage 3 a little more tired and out of form, and lost the quarter-final it had won (scripts/check_worldline.ts)
      if (me.phase === 'pro') { skipCup(state, item.id!); return `签了约，${cup.name}没替你报` }
      if (me.money < cup.fee + 500 || me.fans < cup.minFans) { skipCup(state, item.id!); return `跳过${cup.name}` }
      // not entered on anything serious or anything that can leave a mark: the first round is only a week or so away
      if (autoSitsOut(state)) { skipCup(state, item.id!); return `带伤，没报${cup.name}` }
      const why = enterCup(state, item.id!, rng)
      if (why) { skipCup(state, item.id!); return why }
      return `报名了${cup.name}`
    }
    case 'invite': {
      const inv = me.pre.invites.find((i) => i.id === item.id)
      if (!inv) { pop(state, 'invite', item.id); return '' }
      // two clubs asked on the same day: the tryout already under way is played out first — startTryout refuses a
      // second one, and the invite used to sit at the head of the list for ever (found 2026-09-14)
      let guard = 0
      while (me.tryout && guard++ < 6) tryoutChoose(state, tryoutDays(state)[me.tryout.step].rec)
      const team = state.teams[inv.teamId]
      const cur = me.phase === 'pro' ? state.teams[state.myTeam] : null
      if (!team || team.dormant || team.id === cur?.id) {
        me.pre.invites = me.pre.invites.filter((i) => i.id !== inv.id)
        pop(state, 'invite', inv.id)
        return '这家俱乐部的邀请已经不适用了。'
      }
      // A real step up a tier is worth trying even from a strong Challengers club, just as it is in the deal
      // branch below. This only accepts the trial: the skill check, trial result and registration lock still apply.
      const upgrade = cur?.tier === 2 && team.tier === 1
      if (cur && !upgrade && team.rating < cur.rating + 2) { declineInvite(state, inv.id); return `回绝了 ${team.name}` }
      if (tryoutSkill(state) < expectOf(team) - 6) { declineInvite(state, inv.id); return `差太远，回绝了 ${team.name}` }
      const why = startTryout(state, inv.id)
      // refused all the same: off the list, and the invite runs out on its own
      if (why) { pop(state, 'invite', inv.id); return why }
      return `去 ${team.name} 试训`
    }
    case 'tryout': {
      if (activeAbsence(state)) {
        me.tryout = undefined
        pop(state, 'tryout', item.id)
        return absenceBlock(state)!
      }
      let guard = 0
      while (me.tryout && guard++ < 6) tryoutChoose(state, tryoutDays(state)[me.tryout.step].rec)
      // a tryout's card whose tryout is gone (signed elsewhere meanwhile) comes off the list instead of being answered for ever
      if (!me.tryout) pop(state, 'tryout', item.id)
      return '试训打完了'
    }
    case 'deal': {
      const d = me.deals.find((x) => x.id === item.id)
      if (!d) { pop(state, 'deal', item.id); return '' }
      const team = state.teams[d.teamId]
      if (d.kind === 'renew') { acceptDeal(state, d.id); return `续约 ${team.name}` }
      if (d.kind === 'sign') { acceptDeal(state, d.id); return `签约 ${team.name}` }
      const cur = state.teams[state.myTeam]
      const benched = !cur.starters.includes(me.id)
      const better = team.rating > cur.rating + 4 || (benched && (d.role === 'starter' || d.role === 'star')) || (cur.tier === 2 && team.tier === 1)
      if (better) { acceptDeal(state, d.id); return `转会 ${team.name}` }
      declineDeal(state, d.id)
      return `拒绝了 ${team.name}`
    }
    case 'stream': {
      const fill = me.fans / Math.max(1, fanCap(state))
      const choice = fill >= 0.6 ? 'club' : 'none'
      answerStreamOffer(state, choice)
      return choice === 'club' ? '签了俱乐部平台的独家' : '没签独家'
    }
    case 'event': {
      const ev = eventOf(item.id!)
      if (!ev) { pop(state, 'event', item.id); me.pendingEvent = undefined; return '' }
      let pick = ev.rec
      const opt = ev.a[pick]
      if (opt?.confirm || (opt?.e.money && opt.e.money < 0 && me.money + opt.e.money < 0)) {
        pick = ev.a.findIndex((o) => !o.confirm && (!o.e.money || o.e.money >= 0))
      }
      if (pick < 0) return '这件事需要你亲自决定。'
      resolveEvent(state, ev.id, Math.max(0, pick))
      return `${ev.q.slice(0, 18)}… → ${ev.a[Math.max(0, pick)].t}`
    }
    // a club's no to a 自荐 (me/selfpitch.ts): read and closed — 托管 never sends one, it only answers what comes back
    case 'pitch': {
      const r = me.pitch?.replies.find((x) => x.id === item.id)
      closePitchReply(state, item.id ?? '')
      return r ? `${state.teams[r.teamId]?.name ?? '俱乐部'} 回绝了你的${r.kind === 'contact' ? '接触' : '自荐'}` : ''
    }
    case 'trait': pop(state, 'trait', item.id); return ''
    case 'released': pop(state, 'released'); return ''
    // never on autopilot: the clock stops on it (see runAutoPilot's on())
    case 'folding': pop(state, 'folding'); return ''
    // the coach's offer to call: the steady answer is yes — he only asks a player who can (me/igl.ts)
    case 'igl': takeIgl(state); return '接下了队内指挥'
    case 'season': {
      pop(state, 'season', item.id)
      return ''
    }
    case 'ending': pop(state, 'ending'); return ''
    // hurt on a match day: a cold or tired eyes played through, anything that can leave a mark sat out
    case 'hurt': return autoHurt(state, item.id!)
  }
  return ''
}

/** The four dials of 托管, applied to whatever is waiting and to the week's shopping. */
export function runAutoPilot(state: GameState): string[] {
  const me = state.me!
  const done: string[] = []
  const on = (item: PendingItem): boolean => {
    // the coach's offer to call is a career decision (me/igl.ts)
    if (item.kind === 'igl') return me.auto.career
    if (item.kind === 'event' || item.kind === 'trait') return me.auto.daily
    if (item.kind === 'stream') return me.auto.biz
    // a cup's entry is the dial's; its rounds are matches, and a press hands them to me as it does my club's
    if (item.kind === 'cup') return me.auto.biz && !isCupRound(state, item)
    if (item.kind === 'invite' || item.kind === 'tryout' || item.kind === 'deal' || item.kind === 'released' || item.kind === 'pitch') return me.auto.career
    return false
  }
  let guard = 0
  while (me.pending.length && on(me.pending[0]) && guard++ < 12) {
    const line = autoResolve(state, me.pending[0])
    if (line) done.push(line)
  }
  if (runScheduledSecondary(state)) done.push('完成本周副位置训练（2点行动、4点体力）。')
  if (me.auto.buy) done.push(...autoBuy(state))
  for (const d of done) me.autoNotes.push(d)
  if (me.autoNotes.length > 60) me.autoNotes.splice(0, me.autoNotes.length - 60)
  return done
}

/** what 托管's shopping never spends below, in RMB (ui/me/AutoScreen.tsx says it) */
export const AUTO_RESERVE = 25000

/** Shopping the steady way: a reserve first, then what pays now. */
export function autoBuy(state: GameState): string[] {
  const me = state.me!
  const p = state.players[me.id]
  const out: string[] = []
  // RMB (me/currency.ts); the prices are the shop's own
  const reserve = AUTO_RESERVE
  const relax = (key: string) => RELAX.find((r) => r.key === key)?.price ?? 0
  const course = (key: string) => COURSES.find((c) => c.key === key)?.price ?? 0
  // 理疗 also shortens a lay-off it treats; a short trip, one that is in the head (me/injury.ts)
  if ((p.fatigue >= 70 || injuryHelpedBy(state, 'physio')) && me.money - relax('physio') >= reserve && !buyRelax(state, 'physio')) out.push('买了理疗')
  if (injuryHelpedBy(state, 'trip') && me.money - relax('trip') >= reserve * 2 && !buyRelax(state, 'trip')) out.push('出去散了两天心')
  for (const s of GEAR_SLOTS) {
    if ((me.gear[s.key] ?? 0) >= 1) continue
    if (me.money - GEAR_PRICE[1] < reserve) break
    if (!buyGear(state, s.key)) out.push(`${s.name}换成了${gearModel(s.key, 1)}`)
  }
  if (me.phase === 'pro') {
    if (me.tilt >= 40 && me.money - course('psych') >= reserve && !buyCourse(state, 'psych')) out.push('报了运动心理课')
    if (me.abroad && !me.courses.includes('lang') && me.money - course('lang') >= reserve && !buyCourse(state, 'lang')) out.push('报了语言课')
  }
  // where the rest goes: home, a meetup, a scholarship, the winter's holiday, a studio for a streamer (me/outlets.ts)
  out.push(...autoOutlets(state))
  return out
}

/** One whole week the steady way, matches and everything waiting included. */
export type AdvanceUntil = 'match' | 'stage' | 'season' | 'month'

/**
 * Nothing of mine in the next `days`: no match for my club, and no event in my
 * own scene starting or under way — my region's circuit until 2022, my club's
 * Challengers league from 2023, or anything my club is already in.
 *
 * The Chinese ladder in 2021 is three events in a year, and 策划稿 §3.5 A is
 * the author's answer to it: say so, and let the clock run a month at a time
 * through the gaps, with the training, the ladder and the streams filling them
 * — never an invented match.
 */
export function quietAhead(state: GameState, days = 28): boolean {
  const me = state.me
  if (!me) return false
  const club = me.phase === 'pro' ? state.myTeam : null
  const until = state.day + days
  // a round of my cup inside the stretch (me/cups.ts, a round a week) — entered without a club, or at this one
  const run = !club || me.pre.cup?.club === club ? me.pre.cup : undefined
  if (run?.next != null && run.next <= until) return false
  if (club && state.fixtures.some((f) => !f.played && f.day >= state.day && f.day <= until && (f.teamA === club || f.teamB === club))) return false
  // nor a round of my club's whose tie is not written yet, nor an event opening that holds its place or may take it: the week
  // offered a month three weeks before a Masters the club had qualified for, and days before its qualifier decider (me/nextup.ts)
  if (club && mineBy(state, until)) return false
  const region = club ? state.teams[club]?.region : state.players[me.id]?.region
  const scene = club ? state.teams[club]?.scene : undefined
  return !Object.values(state.comps).some((c) => {
    if (c.champion || !c.circuit || c.circuit.done) return false
    if (c.circuit.start > until || c.circuit.end < state.day) return false
    if (club && c.teams.includes(club)) return true
    const ev = circuitEventOf(c.circuit.id)
    if (!ev) return false
    if (state.year >= 2023) return !!scene && ev.scene === scene
    return !!region && (ev.layer ?? (ev.region ? [ev.region] : [])).includes(region)
  })
}

/**
 * The cards a run of several weeks leaves on the table unless the dial that
 * hands them to 托管 is on (AutoScreen writes down what each dial covers):
 *
 *   「生涯」 deal (a first contract, a transfer, a renewal) · invite · tryout ·
 *           released · folding
 *   「商务」 stream (an exclusive) · cup (an entry, and its fee)
 *
 * and the season card while it asks a veteran of 31 whether he retires: this
 * decision is always the player's; headless resolution safely continues. Everything else a run answers the
 * steady way, as it always has: events and trait notices whatever 「日常」
 * says, ceremonies, the plain season card, a knock on a match day.
 *
 * A run used to answer all of it. The week's button became 「推进一个月」 in a
 * quiet stretch, and pressed unread it renewed a contract or signed for a
 * club (reported 2026-09-12). A single week never did: it stops on every card.
 */
export const RUN_DIAL: Partial<Record<PendingItem['kind'], 'career' | 'biz'>> = {
  deal: 'career', invite: 'career', tryout: 'career', released: 'career', folding: 'career', igl: 'career',
  stream: 'biz', cup: 'biz',
}

/**
 * A card a run stops in front of (see RUN_DIAL). An offer set aside has no card at all (me/aside.ts), so it is
 * never one of these: it holds nothing back, and 托管 does not answer it either — it is mine to come back to.
 */
export function leftToMe(state: GameState, item: PendingItem): boolean {
  const me = state.me!
  if (item.kind === 'season') return !!me.retireAsk && (state.players[me.id]?.age ?? 0) >= 31
  // a round of my cup is a match, not a decision: a run hands it to me or plays it, as it does my club's (advanceUntil)
  if (isCupRound(state, item)) return false
  const dial = RUN_DIAL[item.kind]
  return !!dial && !me.auto[dial]
}

/** The first card waiting that a run would stop on: while there is one, a run does not start. */
export function runBlocked(state: GameState): PendingItem | undefined {
  return state.me?.pending.find((x) => leftToMe(state, x))
}

/** Why a run stopped, or would not start, in the card's words: 「Suning Gaming 的续约等你拿主意（托管「生涯」没开）」. */
export function stopLine(state: GameState, item: PendingItem): string {
  const me = state.me!
  if (isCupRound(state, item)) {
    const run = me.pre.cup!
    const cup = cupFor(state, run.key)
    return `${cup?.name ?? '杯赛'}${cup?.rounds[run.round]?.label ?? ''}今天开打`
  }
  const club = (id?: string) => (id && state.teams[id]?.name) || '俱乐部'
  const dial = item.kind === 'season' ? undefined : RUN_DIAL[item.kind]
  let what = '有件事等你拿主意'
  if (item.kind === 'deal') {
    const d = me.deals.find((x) => x.id === item.id)
    what = `${club(d?.teamId)} 的${d?.kind === 'renew' ? '续约' : d?.kind === 'transfer' ? '转会报价' : '合同'}等你拿主意`
  } else if (item.kind === 'invite') what = `${club(me.pre.invites.find((i) => i.id === item.id)?.teamId)} 的试训邀请等你回复`
  else if (item.kind === 'tryout') what = `${club(me.tryout?.teamId)} 的试训还没打完`
  else if (item.kind === 'released') what = '你成了自由人'
  else if (item.kind === 'folding') what = '俱乐部要解散了'
  else if (item.kind === 'igl') what = '教练想让你来当指挥'
  else if (item.kind === 'pitch') what = `${club(me.pitch?.replies.find((r) => r.id === item.id)?.teamId)} 回复了你的自荐`
  else if (item.kind === 'stream') what = '直播独家等你答复'
  else if (item.kind === 'cup') what = `${(item.id && cupFor(state, item.id)?.name) || '杯赛'}等你决定报不报名`
  else if (item.kind === 'season') what = '要不要退役，等你决定'
  return dial ? `${what}（托管「${dial === 'career' ? '生涯' : '商务'}」没开）` : what
}

/**
 * Let the clock run: each week is planned the steady way unless I already
 * planned it by hand, whatever the dials cover is answered, the small things
 * the steady way, and the run stops the moment something is mine to do — my
 * match (I play it), a decision no dial of mine hands over (leftToMe), the end
 * of the road — or at the boundary asked for. With such a decision already
 * waiting it does not start at all.
 */
export function advanceUntil(state: GameState, until: AdvanceUntil): { stop: WeekStop; weeks: number; notes: string[]; aside?: string } {
  const me = state.me!
  const stage0 = state.stage
  const year0 = state.year
  let weeks = 0
  const notes: string[] = []
  let stop: WeekStop = { kind: 'week-end' }
  const waiting = runBlocked(state)
  if (waiting) return { stop: { kind: 'pending', item: waiting }, weeks, notes }
  // whatever else is waiting is answered the steady way and written down — a
  // run to the end of the season that stops at every event is not a run
  const settle = (): PendingItem | undefined => {
    let g = 0
    while (me.pending.length && g++ < 20) {
      if (leftToMe(state, me.pending[0])) return me.pending[0]
      // a round of my cup: 到下一场比赛 and a month hand it to me, as they do my club's match; the longer runs play it
      if (isCupRound(state, me.pending[0]) && (until === 'match' || until === 'month')) return me.pending[0]
      const line = autoResolve(state, me.pending[0])
      notes.push(line || '替你处理了一件等着的事。')
    }
    return me.pending[0]
  }
  while (weeks < 60) {
    const fullBeforePilot = me.weekDay === 0 && me.ap === me.apMax
    const trainedBeforePilot = me.positionTraining?.trainedWeek
    runAutoPilot(state)
    const wait = settle()
    if (wait) return { stop: { kind: 'pending', item: wait }, weeks, notes }
    if (me.phase === 'retired' || state.gameOver) return { stop: { kind: 'game-over' }, weeks, notes }
    // An offer I set aside holds nothing back (me/aside.ts), but a run that reaches the week it runs out in hands
    // the week back, once, with the week screen's reminder over the button. The week it was set aside in never
    // stops, and a second press runs straight on: the offer then lapses on its own day, written down below.
    if (weeks > 0 && me.weekDay === 0) {
      const aside = asideStop(state)
      if (aside) return { stop, weeks, notes, aside }
    }
    // The scheduled-only week may have been opened by PlayerGame's post-advance pilot.
    // Do not mistake its paid 2 AP for a user-authored partial plan, even at certification.
    const scheduledOnly = me.positionTraining?.autoTrainedWeek === me.week
      && me.positionTraining.trainedWeek === me.week && me.ap === me.apMax - SECONDARY_AP
      && me.trainWeek?.week !== me.week && !me.weekDone?.length
      && !Object.values(me.plan).some(n => (n ?? 0) > 0)
    const justScheduled = fullBeforePilot && trainedBeforePilot !== me.week
      && me.positionTraining?.autoTrainedWeek === me.week
    if (me.weekDay === 0 && (me.ap === me.apMax || scheduledOnly || justScheduled)) autoPlan(state)
    const onTable = asideItems(state)
    const momentsBefore = momentMark(state)
    stop = advanceWeek(state)
    notes.push(...lapsedSince(state, onTable))
    // A big moment was raised under the run (me/moments.ts): the week hands the screen
    // back on that very day, and so does the run — the card is the next thing the player
    // should see. Without this, a 快进 read the day loop's 「停下」 as a day of nothing and
    // ran on: reported 2026-09-19, 「打进大赛」 for a Masters drawn mid-run was first drawn
    // on screen after the club's whole campaign had been played (scripts/probe_qualtime.ts).
    // A match handed back keeps its own branch below: the card follows it, as it always has.
    // A week that did run to its end still counts as run — a card raised on its last day
    // (a ladder tier at the weekly settle, say) must not make the run look like it stood still.
    if (stop.kind !== 'match' && momentMark(state) !== momentsBefore) {
      if (stop.kind === 'week-end') weeks++
      // The week this run would have handed back for an offer set aside (me/aside.ts asideStop,
      // the check at the top of this loop) is handed back here instead, with the card behind it:
      // the reminder comes once in a career, and a card raised in the same week used to eat it
      // (scripts/check_deal_defer.ts 「快进为它停了 0 次」).
      const aside = weeks > 0 && me.weekDay === 0 ? asideStop(state) : undefined
      return { stop, weeks, notes, aside }
    }
    if (stop.kind === 'match') {
      // the next match is what "到下一场比赛" runs to; a longer run plays it
      // the skipped way — the coach's calls made for me, with nobody in the chair (me/matchplay.ts runOut)
      if (until === 'match' || until === 'month') return { stop, weeks, notes }
      const rec = new MeMatch(state, stop.fixture).runOut()
      notes.push(`${compCn(rec.comp)} vs ${rec.oppTag} ${rec.score} ${rec.won ? '胜' : '负'}${rec.started ? ` · 你 ${rec.kills}/${rec.deaths}/${rec.assists} · ACS ${rec.acs}` : ' · 你没上场'}`)
      continue
    }
    if (stop.kind === 'pending') {
      const held = settle()
      if (held) return { stop: { kind: 'pending', item: held }, weeks, notes }
      continue
    }
    if (stop.kind === 'game-over') return { stop, weeks, notes }
    weeks++
    if (until === 'stage' && state.stage !== stage0) break
    if (until === 'season' && state.year !== year0) break
    // a month of nothing, or less if something of mine starts within the week
    if (until === 'month' && (weeks >= 4 || !quietAhead(state, 7))) break
  }
  return { stop, weeks, notes }
}

export function autoWeek(state: GameState): WeekStop {
  const me = state.me!
  let guard = 0
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state)
  let stop = advanceWeek(state)
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    else clear()
    stop = advanceWeek(state)
  }
  return stop
}
