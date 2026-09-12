import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS } from '../types'
import type { GameState } from '../types'
import { ceilingOf, weightsFor } from '../player'
import { chasing } from './bottleneck'
import { traitMul } from './traits'
import { ACTION_BY_KEY } from './actions'
import { advanceWeek, doDuel, setPlan } from './week'
import type { WeekStop } from './week'
import { MeMatch } from './matchplay'
import { EDGE_NEED } from './coach'
import type { PendingItem } from './types'
import { pop } from './pending'
import { cupFor, enterCup, mountCupMatch, afterCupMatch, skipCup, TEMP_MINE, TEMP_OPP, cupRng } from './cups'
import { declineInvite, startTryout, tryoutChoose, tryoutDays } from './tryout'
import { acceptDeal, declineDeal } from './contract'
import { answerStreamOffer } from './stream'
import { eventOf, resolveEvent } from './events'
import { buyCourse, buyGear, buyRelax, GEAR_SLOTS, gearModel } from './shop'
import { fanCap } from './fans'
import { retire } from './endings'
import { expectOf, tryoutSkill } from './prepro'
import { CEREMONIES, cerSkip } from './ceremony'
import { compCn } from './compname'
import { injuryHelpedBy, injuryStatus } from './injury'
import { autoHurt, autoSitsOut } from './hurtplay'
import { eventOf as circuitEventOf } from '../circuit'
import { storyPlan } from './storyweek'

/** fatigue the steady plan leaves at the end of a week: 体力 60, where the week screen's bar is still green */
export const WEEK_END_FATIGUE = 40

/** The fatigue my club's matches still to come this week will book (matchplay.ts: a map on the floor 5, on the bench 1.5). */
export function matchLoad(state: GameState): number {
  const me = state.me!
  if (me.phase !== 'pro') return 0
  const club = state.myTeam
  const starter = !!state.teams[club]?.starters.includes(me.id)
  const last = state.day - me.weekDay + 7
  let load = 0
  for (const f of state.fixtures) {
    if (f.played || f.comp === 'scrim' || f.day > last || (f.teamA !== club && f.teamB !== club)) continue
    const maps = f.bo === 1 ? 1 : f.bo === 2 ? 2 : f.bo === 5 ? 4 : 2.5
    load += maps * (starter ? 5 : 1.5)
  }
  return load
}

/**
 * Where fatigue lands at the end of this week if the plan stands: what is
 * already on it, the matches still to come, and what a week gives back by
 * itself — the same sums as growth.ts settleTraining.
 */
export function weekEndFatigue(state: GameState, load = matchLoad(state)): number {
  const me = state.me!
  let f = state.players[me.id].fatigue + load
  for (const [k, n] of Object.entries(me.plan)) {
    const d = ACTION_BY_KEY[k as keyof typeof ACTION_BY_KEY]
    if (!d || !n) continue
    f += d.fatigue * n
    if (k === 'rest') f -= 14 * n * ((me.body - 50) / 200 + traitMul(me, 'rest') - 1)
  }
  if (me.flags.relax_flat) f -= 3
  return f - clamp(6 + (me.body - 50) / 10, 3, 12)
}

/**
 * The steady plan — never the best plan. Chase a trial when benched, practise
 * what the role is judged on, keep the ladder warm without a club — and not at
 * the body's expense: an hour goes on only while the week still ends with
 * 体力 60 or so, and rest makes the room when it would not.
 *
 * It used to rest by thresholds (once above 45 fatigue, twice above 65) and put
 * every other point into training whatever it cost, matches not counted. On the
 * recommended plan 体力 sat under 40 for most of a year (reported 2026-09-11;
 * a probe's ladder start had 24 weeks under 40). The headless bot's week goes
 * through exactly the buttons' functions.
 */
export function autoPlan(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  const pro = me.phase === 'pro'
  const team = state.teams[state.myTeam]
  const starter = pro && team.starters.includes(me.id)
  const load = matchLoad(state)
  const end = () => weekEndFatigue(state, load)
  const spend = (k: keyof typeof ACTION_BY_KEY) => setPlan(state, k, 1) === null
  const rest = ACTION_BY_KEY.rest
  // hurt: the week goes on rest, which is what heals it (me/injury.ts) — a signed stream minimum aside
  if (injuryStatus(state)) {
    if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage) spend('stream')
    while (me.ap > 0 && spend('rest')) { /* resting */ }
    return
  }
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
  const first = weakest === 'aim' || weakest === 'reaction' ? 'aim'
    : weakest === 'awareness' || weakest === 'clutch' ? 'vod' : 'util'
  want(first)
  if (chasing(state, 'aim')) want('aim')
  if (pro && me.ap >= 3 && !starter) want('scrim')
  if (!pro) { want('ranked'); want('ranked') }
  want('vod')
  want('aim')
  if (me.quests.some((q) => q.kind === 'stream' && q.done < q.need)) want('stream')
  // a signed stream deal is a contract: its minimum is kept even on a tired week
  if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage && !want('stream')) spend('stream')
  while (me.ap > 0) {
    if (me.ap >= 2 && me.fans < 200 && want('stream')) continue
    if (want('ranked')) continue
    // nothing else fits this week: the hour goes to rest, while there is anything to rest off
    if (end() > 0 && spend('rest')) continue
    break
  }
  // a chain under way keeps its task in the week (me/storyweek.ts)
  storyPlan(state, (k, d) => setPlan(state, k, d) === null)
}

/** Answer whatever is in front of me the steady way. Returns a line for the record. */
export function autoResolve(state: GameState, item: PendingItem): string {
  const me = state.me!
  const p = state.players[me.id]
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
      // a run already entered is played out — entering it again failed, and skipping it left it hanging
      if (me.pre.cup?.key !== item.id) {
        if (me.money < cup.fee + 500 || me.fans < cup.minFans) { skipCup(state, item.id!); return `跳过${cup.name}` }
        // a cup is several matches back to back: not entered on anything serious or anything that can leave a mark
        if (autoSitsOut(state)) { skipCup(state, item.id!); return `带伤，没报${cup.name}` }
        const why = enterCup(state, item.id!, rng)
        if (why) { skipCup(state, item.id!); return why }
      }
      let guard = 0
      while (me.pre.cup && guard++ < 8) {
        const run = me.pre.cup
        const m = mountCupMatch(state, cup, run.round, cupRng(state, `r${run.round}`))
        const rec = new MeMatch(state, { aId: TEMP_MINE, bId: TEMP_OPP, bo: m.bo, comp: cup.name, label: m.label }).runOut()
        afterCupMatch(state, rec.won, rec.score, rng)
      }
      return `打完了${cup.name}`
    }
    case 'invite': {
      const inv = me.pre.invites.find((i) => i.id === item.id)
      if (!inv) { pop(state, 'invite', item.id); return '' }
      const team = state.teams[inv.teamId]
      const cur = me.phase === 'pro' ? state.teams[state.myTeam] : null
      if (cur && team.rating < cur.rating + 2) { declineInvite(state, inv.id); return `回绝了 ${team.name}` }
      if (tryoutSkill(state) < expectOf(team) - 6) { declineInvite(state, inv.id); return `差太远，回绝了 ${team.name}` }
      startTryout(state, inv.id)
      return `去 ${team.name} 试训`
    }
    case 'tryout': {
      let guard = 0
      while (me.tryout && guard++ < 6) tryoutChoose(state, tryoutDays(state)[me.tryout.step].rec)
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
      if (opt?.e.money && opt.e.money < 0 && me.money + opt.e.money < 0) pick = ev.a.findIndex((o) => !o.e.money || o.e.money >= 0)
      resolveEvent(state, ev.id, Math.max(0, pick))
      return `${ev.q.slice(0, 18)}… → ${ev.a[Math.max(0, pick)].t}`
    }
    case 'trait': pop(state, 'trait', item.id); return ''
    case 'released': pop(state, 'released'); return ''
    // never on autopilot: the clock stops on it (see runAutoPilot's on())
    case 'folding': pop(state, 'folding'); return ''
    case 'season': {
      pop(state, 'season', item.id)
      if (me.retireAsk && p.age >= 31) retire(state, `${p.age} 岁，你决定退役`)
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
    if (item.kind === 'event' || item.kind === 'trait') return me.auto.daily
    if (item.kind === 'stream') return me.auto.biz
    if (item.kind === 'cup') return me.auto.biz
    if (item.kind === 'invite' || item.kind === 'tryout' || item.kind === 'deal' || item.kind === 'released') return me.auto.career
    return false
  }
  let guard = 0
  while (me.pending.length && on(me.pending[0]) && guard++ < 12) {
    const line = autoResolve(state, me.pending[0])
    if (line) done.push(line)
  }
  if (me.auto.buy) done.push(...autoBuy(state))
  for (const d of done) me.autoNotes.push(d)
  if (me.autoNotes.length > 60) me.autoNotes.splice(0, me.autoNotes.length - 60)
  return done
}

/** Shopping the steady way: a reserve first, then what pays now. */
export function autoBuy(state: GameState): string[] {
  const me = state.me!
  const p = state.players[me.id]
  const out: string[] = []
  const reserve = 3000
  // 理疗 also shortens a lay-off it treats; a short trip, one that is in the head (me/injury.ts)
  if ((p.fatigue >= 70 || injuryHelpedBy(state, 'physio')) && me.money - 400 >= reserve && !buyRelax(state, 'physio')) out.push('买了理疗')
  if (injuryHelpedBy(state, 'trip') && me.money - 2500 >= reserve * 2 && !buyRelax(state, 'trip')) out.push('出去散了两天心')
  for (const s of GEAR_SLOTS) {
    if ((me.gear[s.key] ?? 0) >= 1) continue
    if (me.money - 900 < reserve) break
    if (!buyGear(state, s.key)) out.push(`${s.name}换成了${gearModel(s.key, 1)}`)
  }
  if (me.phase === 'pro') {
    if (me.tilt >= 40 && me.money - 8000 >= reserve && !buyCourse(state, 'psych')) out.push('报了运动心理课')
    if (me.abroad && !me.courses.includes('lang') && me.money - 5000 >= reserve && !buyCourse(state, 'lang')) out.push('报了语言课')
  }
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
  if (club && state.fixtures.some((f) => !f.played && f.day >= state.day && f.day <= until && (f.teamA === club || f.teamB === club))) return false
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
 * and the season card while it asks a veteran of 31 whether he retires, which
 * autoResolve answers with a retirement. Everything else a run answers the
 * steady way, as it always has: events and trait notices whatever 「日常」
 * says, ceremonies, the plain season card, a knock on a match day.
 *
 * A run used to answer all of it. The week's button became 「推进一个月」 in a
 * quiet stretch, and pressed unread it renewed a contract or signed for a
 * club (reported 2026-09-12). A single week never did: it stops on every card.
 */
export const RUN_DIAL: Partial<Record<PendingItem['kind'], 'career' | 'biz'>> = {
  deal: 'career', invite: 'career', tryout: 'career', released: 'career', folding: 'career',
  stream: 'biz', cup: 'biz',
}

/** A card a run stops in front of (see RUN_DIAL). */
export function leftToMe(state: GameState, item: PendingItem): boolean {
  const me = state.me!
  if (item.kind === 'season') return !me.auto.career && !!me.retireAsk && (state.players[me.id]?.age ?? 0) >= 31
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
  const club = (id?: string) => (id && state.teams[id]?.name) || '俱乐部'
  const dial = item.kind === 'season' ? 'career' : RUN_DIAL[item.kind]
  let what = '有件事等你拿主意'
  if (item.kind === 'deal') {
    const d = me.deals.find((x) => x.id === item.id)
    what = `${club(d?.teamId)} 的${d?.kind === 'renew' ? '续约' : d?.kind === 'transfer' ? '转会报价' : '合同'}等你拿主意`
  } else if (item.kind === 'invite') what = `${club(me.pre.invites.find((i) => i.id === item.id)?.teamId)} 的试训邀请等你回复`
  else if (item.kind === 'tryout') what = `${club(me.tryout?.teamId)} 的试训还没打完`
  else if (item.kind === 'released') what = '你成了自由人'
  else if (item.kind === 'folding') what = '俱乐部要解散了'
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
export function advanceUntil(state: GameState, until: AdvanceUntil): { stop: WeekStop; weeks: number; notes: string[] } {
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
      const line = autoResolve(state, me.pending[0])
      notes.push(line || '替你处理了一件等着的事。')
    }
    return me.pending[0]
  }
  while (weeks < 60) {
    runAutoPilot(state)
    const wait = settle()
    if (wait) return { stop: { kind: 'pending', item: wait }, weeks, notes }
    if (me.phase === 'retired' || state.gameOver) return { stop: { kind: 'game-over' }, weeks, notes }
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(state)
    stop = advanceWeek(state)
    if (stop.kind === 'match') {
      // the next match is what "到下一场比赛" runs to; a longer run plays it
      // the skipped way — two rosters' numbers, no decisions of mine
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
