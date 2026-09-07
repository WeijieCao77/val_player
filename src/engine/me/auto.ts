import { Rng, hashStr } from '../rng'
import { ATTR_KEYS } from '../types'
import type { GameState } from '../types'
import { weightsFor } from '../player'
import { ACTION_BY_KEY } from './actions'
import { advanceWeek, doDuel, setPlan } from './week'
import type { WeekStop } from './week'
import { MeMatch } from './matchplay'
import { EDGE_NEED } from './coach'
import type { PendingItem } from './types'
import { pop } from './pending'
import { cupOf, enterCup, mountCupMatch, afterCupMatch, skipCup, TEMP_MINE, TEMP_OPP, cupRng } from './cups'
import { declineInvite, startTryout, tryoutChoose, TRYOUT_DAYS } from './tryout'
import { acceptDeal, declineDeal } from './contract'
import { answerStreamOffer } from './stream'
import { eventOf, resolveEvent } from './events'
import { buyCourse, buyGear, buyRelax, GEAR_SLOTS } from './shop'
import { fanCap } from './fans'
import { retire } from './endings'
import { expectOf, tryoutSkill } from './prepro'

/**
 * The steady plan — never the best plan. Rest when worn, chase a trial when
 * benched, practise what the role is judged on, keep the ladder warm without
 * a club. The headless bot's week goes through exactly the buttons' functions.
 */
export function autoPlan(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  const pro = me.phase === 'pro'
  const team = state.teams[state.myTeam]
  const starter = pro && team.starters.includes(me.id)
  const spend = (k: keyof typeof ACTION_BY_KEY) => setPlan(state, k, 1) === null

  if (p.fatigue > 65) { spend('rest'); spend('rest') }
  else if (p.fatigue > 45) spend('rest')

  if (pro && !starter && !me.trial && me.edge < EDGE_NEED) {
    let guard = 0
    while (me.ap >= ACTION_BY_KEY.duel.cost && guard++ < 3) {
      const r = doDuel(state)
      if (typeof r === 'string') break
      if (r.trial) break
    }
  }

  const w = weightsFor(p)
  const weakest = ATTR_KEYS
    .filter((k) => k !== 'igl')
    .sort((a, b) => p.attrs[a] / w[a] - p.attrs[b] / w[b])[0]
  const first = weakest === 'aim' || weakest === 'reaction' ? 'aim'
    : weakest === 'awareness' || weakest === 'clutch' ? 'vod' : 'util'
  spend(first)
  if (pro && me.ap >= 3 && !starter) spend('scrim')
  if (!pro) { spend('ranked'); spend('ranked') }
  spend('vod')
  spend('aim')
  if (me.quests.some((q) => q.kind === 'stream' && q.done < q.need)) spend('stream')
  if (me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage) spend('stream')
  while (me.ap > 0) {
    if (me.ap >= 2 && me.fans < 200 && spend('stream')) continue
    if (spend('ranked')) continue
    break
  }
}

/** Answer whatever is in front of me the steady way. Returns a line for the record. */
export function autoResolve(state: GameState, item: PendingItem): string {
  const me = state.me!
  const p = state.players[me.id]
  const rng = new Rng(hashStr(`auto:${state.seed}:${state.year}:${state.day}:${item.kind}:${item.id ?? ''}`))
  switch (item.kind) {
    case 'cup': {
      const cup = cupOf(item.id!)
      if (!cup || me.money < cup.fee + 500 || me.fans < cup.minFans) { skipCup(state, item.id!); return `跳过${cup?.name ?? '杯赛'}` }
      const why = enterCup(state, item.id!, rng)
      if (why) { skipCup(state, item.id!); return why }
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
      while (me.tryout && guard++ < 6) tryoutChoose(state, TRYOUT_DAYS[me.tryout.step].rec)
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
    case 'season': {
      pop(state, 'season', item.id)
      if (me.retireAsk && p.age >= 31) retire(state, `${p.age} 岁，你决定退役`)
      return ''
    }
    case 'ending': pop(state, 'ending'); return ''
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
  if (p.fatigue >= 70 && me.money - 400 >= reserve && !buyRelax(state, 'physio')) out.push('买了理疗')
  for (const s of GEAR_SLOTS) {
    if ((me.gear[s.key] ?? 0) >= 1) continue
    if (me.money - 900 < reserve) break
    if (!buyGear(state, s.key)) out.push(`买了职业级${s.name}`)
  }
  if (me.phase === 'pro') {
    if (me.mental < 50 && me.money - 8000 >= reserve && !buyCourse(state, 'psych')) out.push('报了运动心理课')
    if (me.abroad && !me.courses.includes('lang') && me.money - 5000 >= reserve && !buyCourse(state, 'lang')) out.push('报了语言课')
  }
  return out
}

/** One whole week the steady way, matches and everything waiting included. */
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
