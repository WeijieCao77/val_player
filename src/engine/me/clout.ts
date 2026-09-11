import { Rng, clamp, hashStr } from '../rng'
import { askingPrice, doTransfer, releasePlayer, squadFloorBlock } from '../transfer'
import { duoBonded } from '../bonds'
import { defaultContract } from '../types'
import type { GameState, Player } from '../types'
import { compCn } from './compname'
import { pushLog } from './log'
import { inWindow, nextWindow } from './transfer'

/**
 * How much of a say you have in your own club.
 *
 * Ported from 破晓's clout.ts. Its shape is the argument, and it is the one
 * that keeps this a player game rather than a manager game: there are exactly
 * **two** things you can ask the club to do, and both are deliberately hard to
 * reach. You are not given a transfer market. You are given a voice, and a
 * threshold you have to earn before anyone listens to it — 「我是一个选手，
 * 转会市场和我有什么关系」.
 *
 * 威望 is a read-out, not a resource: it is computed from what you have
 * already done — trophies, following, how far above your own team-mates you
 * are, your record, and what the staff think of you — and nothing spends it.
 * The two actions only check it.
 *
 * The other half of the original's design is that **failure is social, not
 * numeric**. Asking for a team-mate to be moved on and being turned down does
 * not cost you a stat; it costs you the room. He finds out. Everyone finds
 * out. That is the whole reason the action is worth having.
 */

/* ------------------------------------------------------------------ */
/*  威望                                                                */
/* ------------------------------------------------------------------ */

const ATTR_KEYS = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl'] as const

/**
 * One number for how good a player is, on the eight.
 *
 * Deliberately the plain average rather than `overall` or a match rating:
 * a rating carries your own in-match decisions with it, and this axis has to
 * compare you with people who never made any — the same reasoning as the
 * bond ledger's.
 */
export function attrAvg(p: Player): number {
  return ATTR_KEYS.reduce((s, k) => s + p.attrs[k], 0) / ATTR_KEYS.length
}

const isIntl = (t: string) => /Masters|Champions/.test(t)

export interface CloutParts { label: string; value: number }

/** 威望 0–100, and where each point of it came from. */
export function cloutBreakdown(state: GameState): { total: number; parts: CloutParts[] } {
  const me = state.me
  const parts: CloutParts[] = []
  if (!me || me.phase !== 'pro') return { total: 0, parts }
  const p = state.players[me.id]
  const team = state.teams[p?.teamId ?? '']
  if (!p || !team) return { total: 0, parts }

  let v = 18
  parts.push({ label: '底子', value: 18 })

  // A trophy you were on the floor for is worth more than a ring you watched.
  let silver = 0
  for (const t of me.titles) {
    const full = isIntl(t.title) ? 11 : 5
    silver += t.started ? full : full * 0.35
  }
  silver = Math.round(silver)
  if (silver) { v += silver; parts.push({ label: '冠军', value: silver }) }

  // Our following runs 0–4000, not 破晓's 0–1400, so the divisor is ours.
  const fame = Math.round(clamp(me.fans / 220, 0, 16))
  if (fame) { v += fame; parts.push({ label: '人气', value: fame }) }

  // how far above your own five you actually are — the term that stops a
  // journeyman on a great team from thinking he runs it
  const mates = team.roster.map((id) => state.players[id]).filter((q): q is Player => !!q && q.id !== me.id)
  if (mates.length) {
    const gap = Math.round(clamp((attrAvg(p) - mates.reduce((s, q) => s + attrAvg(q), 0) / mates.length) * 0.9, -8, 18))
    if (gap) { v += gap; parts.push({ label: '队内实力差', value: gap } ) }
  }

  const games = me.seasons.reduce((s, x) => s + x.matches, 0) + me.seasonStart.matches
  const wins = me.seasons.reduce((s, x) => s + x.wins, 0) + me.seasonStart.wins
  if (games > 20) {
    const rec = Math.round(clamp((wins / games - 0.5) * 40, -8, 12))
    if (rec) { v += rec; parts.push({ label: '生涯胜率', value: rec }) }
  }

  const trust = Math.round(clamp(((me.coachTrust + me.gmTrust) / 2 - 50) * 0.16, -6, 6))
  if (trust) { v += trust; parts.push({ label: '教练组与经理', value: trust }) }

  return { total: clamp(Math.round(v), 0, 100), parts }
}

export const cloutOf = (state: GameState): number => cloutBreakdown(state).total

export const CLOUT_TIERS: { at: number; name: string; blurb: string }[] = [
  { at: 78, name: '队魂', blurb: '你说的话，俱乐部会认真听。' },
  { at: 62, name: '核心', blurb: '你在这支队里说得上话。' },
  { at: 44, name: '主力', blurb: '打得不错，但还轮不到你定阵容。' },
  { at: 26, name: '轮换', blurb: '先把位置坐稳再说别的。' },
  { at: 0, name: '新人', blurb: '没人会听一个新人的意见。' },
]

export const cloutTier = (c: number) => CLOUT_TIERS.find((t) => c >= t.at) ?? CLOUT_TIERS[CLOUT_TIERS.length - 1]

/* ------------------------------------------------------------------ */
/*  一、提出换人                                                        */
/* ------------------------------------------------------------------ */

export const LIST_GATE = { clout: 55, coach: 60, vetClout: 75, vetCoach: 50 }
/** stages, not weeks — asking twice in a month is not asking, it is nagging */
const LIST_COOLDOWN = 3
const SIGN_COOLDOWN = 4

export interface Gate { ok: boolean; why?: string }

export function canList(state: GameState): Gate {
  const me = state.me
  if (!me || me.phase !== 'pro') return { ok: false, why: '你还没有队伍。' }
  const c = cloutOf(state)
  const ct = Math.round(me.coachTrust)
  if (c < LIST_GATE.clout) return { ok: false, why: `威望不够（${c}/${LIST_GATE.clout}）。先打出成绩再谈阵容。` }
  const byCoach = ct >= LIST_GATE.coach
  const byClout = c >= LIST_GATE.vetClout && ct >= LIST_GATE.vetCoach
  if (!byCoach && !byClout) {
    return {
      ok: false,
      why: c >= LIST_GATE.vetClout
        ? `教练那边还差一口气（信任 ${ct}/${LIST_GATE.vetCoach}）。功勋压得住他，但压不到这个份上。`
        : `还没人肯为你动阵容。教练信任要 ${LIST_GATE.coach}（现在 ${ct}），或者威望到 ${LIST_GATE.vetClout}（现在 ${c}）用功勋压过教练组。`,
    }
  }
  if ((me.cloutCd?.list ?? 0) > 0) return { ok: false, why: `刚提过一次，${me.cloutCd!.list} 个赛段内别再提。` }
  // Ask before rolling, not after: a five-man squad cannot lose anybody, and
  // finding that out only once the coach has already said yes is a dead end
  // with no reason attached.
  const floor = squadFloorBlock(state, state.players[me.id].teamId ?? '')
  if (floor) return { ok: false, why: floor }
  return { ok: true }
}

/** The odds the coach agrees, and the reasons, so the screen can print them. */
export function listOdds(state: GameState, target: Player): number {
  const me = state.me!
  const team = state.teams[state.players[me.id].teamId ?? '']
  const all = (team?.roster ?? []).map((id) => state.players[id]).filter((q): q is Player => !!q)
  const teamAvg = all.length ? all.reduce((s, q) => s + attrAvg(q), 0) / all.length : 60
  let p = 0.30
  p += (cloutOf(state) - LIST_GATE.clout) / 120
  p += (me.coachTrust - LIST_GATE.coach) / 180
  // the weaker he is than the rest, the easier this is to argue
  p += clamp((teamAvg - attrAvg(target)) / 16, -0.2, 0.32)
  // ...and the more the room likes him, the harder
  p -= clamp((target.morale - 50) / 200, -0.15, 0.22)
  if (target.age >= 27) p += 0.08
  if (target.age <= 19) p -= 0.10
  return clamp(p, 0.05, 0.82)
}

/** Ask the coach to move a team-mate on. Returns the line for the screen. */
export function doList(state: GameState, targetId: string): string {
  const me = state.me!
  const gate = canList(state)
  if (!gate.ok) return gate.why ?? '现在提不了。'
  const target = state.players[targetId]
  const team = state.teams[state.players[me.id].teamId ?? '']
  if (!target || !team?.roster.includes(targetId)) return '他不在你的队里。'
  if (targetId === me.id) return '你不能把自己换掉——想走的话去挂牌那一栏。'

  const rng = new Rng(hashStr(`clout:list:${state.seed}:${state.year}:${state.day}:${targetId}`))
  const p = listOdds(state, target)
  me.cloutCd ??= { list: 0, sign: 0 }
  me.cloutCd.list = LIST_COOLDOWN

  if (!rng.chance(p)) {
    // The failure is the point: it does not cost a stat, it costs the room.
    me.coachTrust = clamp(me.coachTrust - 14, 0, 100)
    duoBonded(state, me.id, targetId, -26)
    for (const id of team.roster) if (id !== me.id && id !== targetId) duoBonded(state, me.id, id, -9)
    pushLog(state, 'bad', `你向教练组提出换掉 ${target.ign}，没被同意——<b>而且消息走漏了</b>。${target.ign} 知道了，整个基地都知道了。`)
    return `没同意。${target.ign} 知道是你提的。`
  }

  const blocked = releasePlayer(state, target)
  if (blocked) {
    me.cloutCd.list = 0
    return blocked
  }
  me.coachTrust = clamp(me.coachTrust - 4, 0, 100)
  for (const id of team.roster) if (id !== me.id) duoBonded(state, me.id, id, -6)
  pushLog(state, 'team', `你向教练组提出换掉 ${target.ign}，成功了。他被放走，位置空了出来。<b>基地安静了很久——他们知道这是你提的。</b>`)
  return `${target.ign} 被放走了。位置空着，俱乐部会去补。`
}

/* ------------------------------------------------------------------ */
/*  二、要求签人                                                        */
/* ------------------------------------------------------------------ */

export const SIGN_GATE = { clout: 66, gm: 72 }
const SIGN_SLOTS = 5
/** above this, a failed approach is the market's fault, not yours */
const SIGN_FAIL_VET = 78

export function canSign(state: GameState): Gate {
  const me = state.me
  if (!me || me.phase !== 'pro') return { ok: false, why: '你还没有队伍。' }
  const c = cloutOf(state)
  const gm = Math.round(me.gmTrust)
  if (c < SIGN_GATE.clout) return { ok: false, why: `威望不够（${c}/${SIGN_GATE.clout}）。这种要求得是队魂级别的人才提得动。` }
  if (gm < SIGN_GATE.gm) return { ok: false, why: `经理不认你（信任 ${gm}/${SIGN_GATE.gm}）。他要先看到你值这个钱。` }
  if (!inWindow(state)) {
    const w = nextWindow(state)
    return { ok: false, why: `转会窗没开，签不了人。下一个窗口：${w.label}，还有 ${w.weeks} 周。` }
  }
  if ((me.cloutCd?.sign ?? 0) > 0) return { ok: false, why: `本赛季已经提过，${me.cloutCd!.sign} 个赛段后再说。` }
  return { ok: true }
}

export interface SignTarget { id: string; ign: string; role: string; overall: number; teamName: string; abroad: boolean; fee: number }

/**
 * Who you could plausibly ask for.
 *
 * Not a market: five names, sampled evenly across the band your standing
 * actually reaches, so the list is a suggestion rather than a shopping page.
 * The reach moves with 威望 and the manager's regard, which is the only place
 * either number is spent on anything.
 */
export function signTargets(state: GameState): SignTarget[] {
  const me = state.me
  if (!me || me.phase !== 'pro') return []
  const myTeam = state.teams[state.players[me.id].teamId ?? '']
  if (!myTeam) return []
  const mates = myTeam.roster.map((id) => state.players[id]).filter((q): q is Player => !!q && q.id !== me.id)
  const teamAvg = mates.length ? mates.reduce((s, q) => s + attrAvg(q), 0) / mates.length : 60
  const reach = teamAvg + (cloutOf(state) - SIGN_GATE.clout) / 6 + (me.gmTrust - SIGN_GATE.gm) / 9

  // and the club has to be able to pay: doTransfer debits without refusing,
  // so an unaffordable name on this list would be a request that quietly puts
  // the club in the red rather than one the manager turns down
  const purse = myTeam.budget
  const band = Object.values(state.players)
    .filter((q) => q.teamId && q.teamId !== myTeam.id && !q.retiring)
    .map((q) => ({ q, a: attrAvg(q) }))
    .filter((x) => x.a <= reach + 4 && x.a >= teamAvg - 1 && askingPrice(x.q) <= purse)
    .sort((a, b) => b.a - a.a)
  if (!band.length) return []
  const pick = band.length <= SIGN_SLOTS
    ? band
    : Array.from({ length: SIGN_SLOTS }, (_, i) => band[Math.round(i * (band.length - 1) / (SIGN_SLOTS - 1))])
  return pick.map(({ q }) => ({
    id: q.id, ign: q.ign, role: q.role, overall: q.overall,
    teamName: state.teams[q.teamId!]?.name ?? '—',
    abroad: state.teams[q.teamId!]?.region !== myTeam.region,
    fee: askingPrice(q),
  }))
}

export function signOdds(state: GameState, target: Player): number {
  const me = state.me!
  const myTeam = state.teams[state.players[me.id].teamId ?? '']
  const mates = (myTeam?.roster ?? []).map((id) => state.players[id]).filter((q): q is Player => !!q && q.id !== me.id)
  const teamAvg = mates.length ? mates.reduce((s, q) => s + attrAvg(q), 0) / mates.length : 60
  let p = 0.5
  p += (cloutOf(state) - SIGN_GATE.clout) / 110
  p += (me.gmTrust - SIGN_GATE.gm) / 160
  p -= clamp((attrAvg(target) - teamAvg) / 18, 0, 0.3)
  if (state.teams[target.teamId ?? '']?.region !== myTeam?.region) p -= 0.12
  return clamp(p, 0.1, 0.82)
}

/** Ask the club to go and get him. Returns the line for the screen. */
export function doSign(state: GameState, targetId: string): string {
  const me = state.me!
  const gate = canSign(state)
  if (!gate.ok) return gate.why ?? '现在提不了。'
  const target = state.players[targetId]
  const myTeam = state.teams[state.players[me.id].teamId ?? '']
  if (!target || !myTeam) return '找不到这个人。'

  const rng = new Rng(hashStr(`clout:sign:${state.seed}:${state.year}:${state.day}:${targetId}`))
  const p = signOdds(state, target)
  me.cloutCd ??= { list: 0, sign: 0 }
  me.cloutCd.sign = SIGN_COOLDOWN
  const clout = cloutOf(state)

  if (!rng.chance(p)) {
    if (clout >= SIGN_FAIL_VET) {
      me.gmTrust = clamp(me.gmTrust - 5, 0, 100)
      pushLog(state, 'bad', `你向经理提出签下 ${target.ign}。他跑了一趟，对方开的价俱乐部吃不下。「这不怪你，是那边狮子大开口。」`)
      return `没谈成，价太高。经理没怪你。`
    }
    me.gmTrust = clamp(me.gmTrust - 12, 0, 100)
    pushLog(state, 'bad', `你向经理提出签下 ${target.ign}，对方要价太高，谈崩了。<b>经理觉得你不太懂行情。</b>`)
    return `谈崩了。经理觉得你不太懂行情。`
  }

  const fee = askingPrice(target)
  if (fee > myTeam.budget) {
    me.gmTrust = clamp(me.gmTrust - 5, 0, 100)
    pushLog(state, 'bad', `你向经理提出签下 ${target.ign}。他看了一眼账，没接话。「这个价信不是不想，是真没钱。」`)
    return `俱乐部出不起这个价（要 ${fee.toLocaleString()}，队里只有 ${Math.round(myTeam.budget).toLocaleString()}）。`
  }
  const ok = doTransfer(state, target, myTeam.id, fee, defaultContract(target.salary, 2))
  if (!ok) {
    // the engine refused — a full roster, an import limit, a squad floor
    me.cloutCd.sign = 0
    return '俱乐部去谈了，但这笔转会办不下来（名单已满或名额受限）。'
  }
  me.gmTrust = clamp(me.gmTrust - 3, 0, 100)
  pushLog(state, 'team', `俱乐部按你的要求把 <b>${target.ign}</b> 签了下来。<b>这是你的话语权换来的——现在成绩得对得起它。</b>`)
  return `${target.ign} 来了。`
}

/* ------------------------------------------------------------------ */

/** Both cooldowns tick down a stage at a time. */
export function cloutStage(state: GameState): void {
  const me = state.me
  if (!me?.cloutCd) return
  me.cloutCd.list = Math.max(0, me.cloutCd.list - 1)
  me.cloutCd.sign = Math.max(0, me.cloutCd.sign - 1)
}

/** A line for the career card and the club screen. */
export function cloutLine(state: GameState): string {
  const c = cloutOf(state)
  const t = cloutTier(c)
  const me = state.me
  const big = me?.titles.filter((x) => isIntl(x.title) && x.started) ?? []
  return big.length
    ? `${t.name} · ${c}　${t.blurb}（${big.map((x) => compCn(x.title)).slice(0, 2).join('、')}）`
    : `${t.name} · ${c}　${t.blurb}`
}
