/**
 * 自荐 and 主动接触 (engine/me/selfpitch.ts), headless.
 *
 * Reported 2026-09-14: 「不只是被动的等待试训邀请而是加入自荐的机制，就类似lol breaker的转会」; the design the
 * author approved the same day.
 *
 * 一 every gate greys the button with its reason, and a refused 自荐 spends nothing and sends nothing:
 *    action points, an invitation to answer, a tryout, a move agreed, one already waiting, a club already
 *    written to, a full roster, a full import list, a club turned down this year, a signing this transfer
 *    period, my own club's roster lock
 * 二 the limits: three a transfer period and a club once, a contact once; a no keeps its club away that season only
 * 三 a club's window must stay open seven more days; another 赛区 only with the language
 * 四 the answer comes three to seven days later, drawn on the chance the button showed; a no names a real reason
 * 五 signing elsewhere, or agreeing a move, calls a 自荐 off with a line
 * 六 a 自荐 that comes good is an invitation (via 'self') into the tryout and the grade; a clear margin skips the tryout
 * 七 a contact under contract: the manager's trust −4, terms from the other club, or a tryout near its bar
 * 八 托管 sends none, and closes a no's card
 * 九 an old save loads
 *
 *   npx tsx scripts/check_selfpitch.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { advanceWeek } from '../src/engine/me/week'
import { autoResolve, autoWeek } from '../src/engine/me/auto'
import { joinClub, makeDeal } from '../src/engine/me/contract'
import { abroadClub, expectOf, markDeclined, tryoutSkill } from '../src/engine/me/prepro'
import { startTryout, tryoutChoose, tryoutDays } from '../src/engine/me/tryout'
import { push } from '../src/engine/me/pending'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { MARKET_DAYS, absDay, todayAbs, windowAt } from '../src/engine/me/window'
import { eventsOf } from '../src/engine/circuit'
import type { CEvent } from '../src/engine/circuit'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { Competition, GameState, Region, Team } from '../src/engine/types'
import type { PitchBook } from '../src/engine/me/types'
import { Rng } from '../src/engine/rng'
import {
  CONTACT_TRUST, NEVPRO_TOP, ODDS_MAX, ODDS_MIN, PITCH_AP, PITCH_LEAD, PITCH_MAX, REPLY_MAX, REPLY_MIN, ROSTER_FULL,
  oddsLine, oddsWord, pitchBlock, pitchClubBlock, pitchDay, pitchHit, pitchOdds, pitchPool, pitchTargets, sendPitch, whyText,
} from '../src/engine/me/selfpitch'
import { pitchBook } from '../src/engine/me/pitchbook'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const t0 = Date.now()
const check = (ok: boolean, what: string): boolean => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
  return ok
}

const career = (start: StartPoint, seed: number, region: Region = 'EMEA'): GameState =>
  createCareer({ name: 'Pitch', region, role: '控场', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2026 })

/** every one of the eight at least `level` */
function lift(s: GameState, level: number): void {
  const p = s.players[s.me!.id]
  for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], level)
  recomputeOverall(p)
}

/** a club a 自荐 can go to today, as the transfer screen lists it */
const open = (s: GameState, f: (t: Team) => boolean = () => true): Team | undefined =>
  pitchTargets(s).rows.find((r) => !r.why && f(r.team))?.team

/** refused: the button's own line, nothing spent, nothing sent */
function refused(s: GameState, team: Team, want: RegExp, what: string): void {
  const me = s.me!
  const ap = me.ap
  const had = pitchBook(s).out?.id
  const sent = pitchBook(s).sent.length
  const line = pitchBlock(s) ?? pitchClubBlock(s, team)
  const said = sendPitch(s, team.id)
  // what the screen greys it with: the panel's own line, else the club's row — or, for another 赛区's club without the
  // language, which is not listed as a row, the club's gate (its one summary line is checked on its own below)
  const listed = pitchTargets(s)
  const row = listed.rows.find((r) => r.team.id === team.id)
  const shown = pitchBlock(s) ?? (row ? row.why : abroadClub(s, team) && !s.me!.flags.lang && listed.abroadShut > 0 ? pitchClubBlock(s, team) : null)
  check(!!said && said === line && said === shown && want.test(said) && me.ap === ap && pitchBook(s).out?.id === had && pitchBook(s).sent.length === sent,
    `${what}：「${said ?? '发出去了'}」`)
}

/** the one waiting, answered now on the chance given */
function answer(s: GameState, odds: number): void {
  const out = s.me!.pitch!.out!
  out.odds = odds
  out.due = todayAbs(s)
  pitchDay(s)
}

const comp = (ev: CEvent, teams: string[]): Competition => ({
  key: `ev:${ev.id}`, name: ev.cn, stage: ev.stage ?? 'offseason', teams, standings: {}, finished: [], format: 'circuit',
  circuit: { id: ev.id, start: ev.start!, end: ev.end!, seeds: [...teams], mode: 'history' },
})

/* ---- 一、二、三 ---- */
console.log('一、闸：每一道都灰掉并写明原因（被拦下的不扣行动点、不发出）')
{
  const s = career('pre', 301)
  const me = s.me!
  lift(s, 66)
  s.day = 20
  const t = open(s, (x) => x.tier === 2)
  if (check(!!t && !pitchBlock(s), `2026 年 1 月的 EMEA 天梯选手：有能投的 Challengers 俱乐部（${t?.name ?? '无'}），没有挡着的闸`) && t) {
    me.ap = 1
    refused(s, t, new RegExp(`行动点不够（需 ${PITCH_AP}，剩 1）`), '行动点不够')
    me.ap = 12
    me.pre.invites.push({ id: 'check:inv', teamId: t.id, via: 'rank', day: s.day, expires: s.day + 21, direct: false })
    push(s, { kind: 'invite', id: 'check:inv' })
    refused(s, t, /^先答复 .+ 的试训邀请$/, '手上有试训邀请')
    me.pre.invites = []
    me.pending = []
    me.tryout = { inviteId: 'check:inv', teamId: t.id, startDay: s.day, step: 0, score: 0, log: [] }
    refused(s, t, /^正在 .+ 试训，打完再说$/, '正在试训')
    me.tryout = undefined
    me.moveAfter = { deal: makeDeal(s, t.id, 'sign', 'B', new Rng(1)), event: '某项赛事', until: s.day + 3, year: s.year }
    refused(s, t, /^已经和 .+ 谈妥，不再自荐别家$/, '谈妥了下一家')
    me.moveAfter = undefined

    // one club at a time: a full roster, a full import list, a club turned down this year, another 赛区 without the language
    const u = open(s, (x) => x.tier === 2 && x.id !== t.id)!
    const roster = u.roster.slice()
    while (u.roster.length < ROSTER_FULL) u.roster.push(`check:filler:${u.roster.length}`)
    refused(s, u, new RegExp(`^名单满了（${ROSTER_FULL}/${ROSTER_FULL}），这个转会期不加人$`), '名单满了')
    u.roster = roster
    const hadLimit = s.importLimit
    const p = s.players[me.id]
    const nat = p.nat
    s.importLimit = true
    p.nat = 'us'
    const mates = u.roster.map((id) => s.players[id]).filter((q) => !!q).slice(0, 2)
    const nats = mates.map((q) => q.nat)
    for (const q of mates) q.nat = 'us'
    refused(s, u, /^外援名额已经用满$/, '外援名额满了')
    mates.forEach((q, i) => { q.nat = nats[i] })
    p.nat = nat
    s.importLimit = hadLimit
    markDeclined(s, u.id)
    refused(s, u, /^今年回绝过，今年不再谈$/, '今年回绝过的俱乐部')
    me.declined = []

    console.log('三、窗口至少还开 7 天；外赛区要会外语')
    const v = open(s, (x) => x.tier === 1)
    const w = v ? windowAt(s, v.id) : undefined
    if (check(!!v && w?.closesOn != null, `VCT 俱乐部 ${v?.name ?? '（没找到）'} 的窗口开着，关窗日 ${w?.closesOn != null ? `第 ${w.closesOn - absDay(2026, 0)} 天` : '无'}`) && v && w?.closesOn != null) {
      const close = w.closesOn - absDay(2026, 0)
      s.day = close - 3
      refused(s, v, /^窗口 3 天后关，来不及回复$/, `离关窗 3 天（第 ${s.day} 天）`)
      s.day = close - PITCH_LEAD
      check(!pitchClubBlock(s, v), `离关窗正好 ${PITCH_LEAD} 天（第 ${s.day} 天）：投得了`)
      s.day = close + 16
      refused(s, v, /^VCT 窗口 \d+月\d+日开/, `窗口关着（第 ${s.day} 天）`)
      s.day = 20
    }
    const far = pitchPool(s).find((x) => abroadClub(s, x) && x.roster.length < ROSTER_FULL)
    if (check(!!far, `找到一家外赛区俱乐部（${far?.name ?? '无'}）`) && far) {
      refused(s, far, /^外赛区的俱乐部要会外语才投得了$/, '外赛区，不会外语')
      const listed = pitchTargets(s)
      check(listed.abroadShut > 0 && !listed.rows.some((r) => r.abroad), `不会外语：外赛区的 ${listed.abroadShut} 家在转会页上合成一行写明原因`)
      me.flags.lang = 1
      const why = pitchClubBlock(s, far)
      check(!why || !/外语/.test(why), `会外语：外赛区这家不再因为外语挡着（${why ?? '投得了'}）`)
      check(pitchTargets(s).rows.some((r) => r.abroad), '会外语：外赛区的俱乐部列出来了，排在本赛区后面')
      delete me.flags.lang
    }

    console.log('二、次数：一个转会期 3 次、同一家 1 次；回绝的那家本赛季不再收')
    check(sendPitch(s, t.id) === null && me.ap === 12 - PITCH_AP && pitchBook(s).out?.teamId === t.id, `发给 ${t.name}：扣 ${PITCH_AP} 行动点，等回复`)
    const other = open(s, (x) => x.tier === 2 && x.id !== t.id)
    if (other) refused(s, other, /^已经给 .+ 发了自荐，\d+月\d+日前回复$/, '上一份还没回复')
    me.pitch!.out = undefined
    refused(s, t, /^这个转会期已经投过这家$/, '同一家这个转会期第二次')
    const b = open(s, (x) => x.tier === 2)!
    sendPitch(s, b.id)
    answer(s, 0)
    me.pending = []
    refused(s, b, /^回绝过你，本赛季不再收你的自荐$/, '回绝过的那家')
    {
      const y = s.year
      s.year = y + 1
      const next = pitchClubBlock(s, b)
      s.year = y
      check(!next || !/本赛季/.test(next), `第二年这家又能投了（${next ?? '投得了'}）`)
    }
    const c = open(s, (x) => x.tier === 2)!
    sendPitch(s, c.id)
    me.pitch!.out = undefined
    const d = open(s, (x) => x.tier === 2)
    if (d) refused(s, d, new RegExp(`^这个转会期的 ${PITCH_MAX} 次用完了，下个转会期（\\d+月\\d+日起）再投$`), `第 ${PITCH_MAX + 1} 次`)
    s.day = MARKET_DAYS[0] + 2
    check(pitchBook(s).sent.length === 0 && !pitchBlock(s), `下个转会期（第 ${s.day} 天）：次数重新算`)
  }
}

console.log('一（续）、有合同：签约的转会期、自己名单锁定、一个转会期接触一次')
{
  const s = career('chal', 302)
  const me = s.me!
  lift(s, 80)
  s.day = 20
  me.ap = 8
  const mine = s.teams[s.myTeam]
  const to = Object.values(s.teams).find((x) => x.tier === 2 && x.id !== mine.id && !x.dormant && x.region === mine.region && x.roster.length < ROSTER_FULL)!
  const t = open(s, (x) => x.id !== to.id)!
  joinClub(s, makeDeal(s, to.id, 'transfer', 'A', new Rng(2)))
  refused(s, t, /^这个转会期刚签约，下个转会期（\d+月\d+日起）才能主动接触$/, '这个转会期刚签约')
  me.flags.signedPeriod = 0
  const ev = eventsOf(2026).find((e) => e.stage === 'masters2' && e.region === null)
  if (check(!!ev, '2026 第二站大师赛在数据里') && ev) {
    const keep = s.comps
    s.comps = { [`ev:${ev.id}`]: comp(ev, [s.myTeam]) }
    s.day = ev.start! + 1
    refused(s, t, /^你的俱乐部正在打 .+，名单锁到 \d+月\d+日$/, '自己的俱乐部名单锁定')
    s.comps = keep
    s.day = 20
  }
  const u = open(s)!
  const trust = me.gmTrust
  check(sendPitch(s, u.id) === null && me.gmTrust === trust - CONTACT_TRUST && me.pitch?.out?.kind === 'contact', `接触 ${u.name}：经理信任 ${trust} → ${me.gmTrust}`)
  answer(s, 0)
  me.pending = []
  const v = open(s)
  if (v) refused(s, v, /^这个转会期已经接触过 .+，下个转会期（\d+月\d+日起）再说$/, '这个转会期第二次接触')
  s.day = MARKET_DAYS[0] + 2
  const next = pitchBlock(s)
  check(!next || !/接触过/.test(next), `下个转会期又能接触（${next ?? '投得了'}）`)
}

/* ---- 四 ---- */
console.log('四、回复：3–7 天后到，按按钮上的把握抽；没成写真实原因')
{
  const s = career('pre', 303)
  const me = s.me!
  lift(s, 66)
  const t = open(s, (x) => x.tier === 2)!
  const shown = pitchOdds(s, t)
  const parts = shown.parts.reduce((n, x) => n + x.v, 0)
  check(shown.pct >= ODDS_MIN && shown.pct <= ODDS_MAX && (shown.capped ? true : parts === shown.pct), `把握 ${shown.pct}%：${oddsLine(s, shown)}（${oddsWord(shown.pct)}）`)
  sendPitch(s, t.id)
  const out = { ...me.pitch!.out! }
  const hit = pitchHit(s, out)
  check(out.odds === shown.pct, `发出去的把握就是按钮上的数（${out.odds}%）`)
  const from = todayAbs(s)
  let guard = 0
  while (me.pitch?.out && guard++ < 6) {
    const stop = advanceWeek(s)
    if (stop.kind === 'pending' && me.pitch?.out) autoResolve(s, stop.item)
  }
  const after = todayAbs(s) - from
  check(!me.pitch?.out && after >= REPLY_MIN && after <= REPLY_MAX, `真按日子推：第 ${after} 天回复（${REPLY_MIN}–${REPLY_MAX}）`)
  if (hit) check(me.pre.invites.some((i) => i.via === 'self' && i.teamId === t.id) && me.pending.some((x) => x.kind === 'invite'), '抽中了：一份来源为自荐的试训邀请，卡片等你答复')
  else check(!!me.pitch?.replies.some((r) => r.id === out.id) && me.pending.some((x) => x.kind === 'pitch' && x.id === out.id), '没抽中：回复卡等你看')
  const tally = me.pitch?.tally
  check(!!tally && tally.sent === 1 && tally.replied === 1 && tally.ok === (hit ? 1 : 0) && tally.odds === out.odds, `记账：发 ${tally?.sent} · 回 ${tally?.replied} · 成 ${tally?.ok}`)
}
{
  // the reasons, each read off the club on the day of the answer
  const s = career('pre', 304)
  const me = s.me!
  lift(s, 62)
  s.day = 20
  const reason = (team: Team, set?: () => void, undo?: () => void): string => {
    me.pitch && (me.pitch.out = undefined)
    me.pending = []
    if (sendPitch(s, team.id)) return '（发不出去）'
    set?.()
    answer(s, 0)
    undo?.()
    const r = me.pitch!.replies[me.pitch!.replies.length - 1]
    me.pitch!.sent = []
    me.pitch!.rejected = []
    return r ? `${r.why}:${whyText(s, r)}` : '（没有回复）'
  }
  const skill = Math.round(tryoutSkill(s))
  const far = open(s, (x) => x.tier === 2 && Math.round(expectOf(x)) - skill >= 6)
  if (far) {
    const gap = Math.round(expectOf(far)) - skill
    const r = reason(far)
    check(r === `gap:实力还差一截（差 ${gap}）`, `离门槛差 ${gap}：「${r}」`)
  } else check(false, '没找到比门槛低 6 分以上的 Challengers 俱乐部')
  const full = open(s, (x) => x.tier === 2)!
  const keep = full.roster.slice()
  const r1 = reason(full, () => { while (full.roster.length < ROSTER_FULL) full.roster.push(`check:filler:${full.roster.length}`) }, () => { full.roster = keep })
  check(r1.startsWith('full:名单满了'), `等回复期间对方名单满了：「${r1}」`)
  lift(s, 90)
  const vct = open(s, (x) => x.tier === 1 && pitchOdds(s, x).capped === 'nevpro' && pitchOdds(s, x).raw - NEVPRO_TOP > -Math.min(0, pitchOdds(s, x).parts.find((q) => q.key === 'gap')?.v ?? 0))
  if (vct) {
    const r = reason(vct)
    check(r.startsWith('nevpro:') && r.includes('打过职业'), `没打过职业投 VCT（本来 ${pitchOdds(s, vct).raw}%，封顶 ${NEVPRO_TOP}%）：「${r}」`)
  } else check(false, '没找到被「没打过职业最多 5%」压下来的 VCT 俱乐部')
  const easy = open(s, (x) => x.tier === 2 && tryoutSkill(s) >= expectOf(x) && pitchOdds(s, x).need.kind === 'hole')
  if (easy) {
    const r = reason(easy)
    check(r.startsWith('luck:') && r.includes('把握'), `够格、他们缺人，还是没成：「${r}」`)
  } else check(false, '没找到够格又缺人的 Challengers 俱乐部')
  // a club with a place under six has a need of its own (me/selfpitch.ts PITCH_SQUAD): one of six or more, every 控场 starter it has raised past me
  const steady = open(s, (x) => x.tier === 2 && tryoutSkill(s) >= expectOf(x) && x.roster.length >= 6 && !!pitchOdds(s, x).need.mate)
  if (steady) {
    const role = s.players[me.id].role
    const inRole = steady.starters.map((id) => s.players[id]).filter((q) => !!q && (q.roles ?? [q.role]).includes(role))
    const was = inRole.map((q) => q.overall)
    const r = reason(steady, () => { for (const q of inRole) q.overall = 99 }, () => { inRole.forEach((q, i) => { q.overall = was[i] }) })
    check(r.startsWith(`starter:${role}位置上的首发 `) && r.endsWith('比你稳') && inRole.some((q) => r.includes(q.ign)), `位置上的首发比你强（${inRole.length} 名${role}首发）：「${r}」`)
  } else check(false, '没找到有控场首发、名单 6 人以上的 Challengers 俱乐部')
}

/* ---- 五 ---- */
console.log('五、等回复时签了别家、谈妥了下一家：自荐作废，日志写明')
{
  const s = career('pre', 305)
  const me = s.me!
  lift(s, 66)
  const a = open(s, (x) => x.tier === 2)!
  const b = open(s, (x) => x.tier === 2 && x.id !== a.id)!
  sendPitch(s, a.id)
  joinClub(s, makeDeal(s, b.id, 'sign', 'B', new Rng(5)))
  check(!me.pitch?.out && me.log.some((l) => l.text.includes('作废') && l.text.includes(a.name)) && me.pitch?.tally?.cancelled === 1, `签了 ${b.name}：给 ${a.name} 的自荐作废，日志写明`)
  const s2 = career('pre', 306)
  lift(s2, 66)
  const a2 = open(s2, (x) => x.tier === 2)!
  const b2 = open(s2, (x) => x.tier === 2 && x.id !== a2.id)!
  sendPitch(s2, a2.id)
  s2.me!.moveAfter = { deal: makeDeal(s2, b2.id, 'sign', 'B', new Rng(6)), event: '某项赛事', until: s2.day + 5, year: s2.year }
  answer(s2, 100)
  check(!s2.me!.pre.invites.length && s2.me!.log.some((l) => l.text.includes('谈妥') && l.text.includes('作废')), '谈妥了下一家：到回复那天作废，不来邀请')
}

/* ---- 六 ---- */
console.log('六、自荐成了：来源为自荐的试训邀请 → 试训 → 评级；高出 10 以上免试训')
{
  const s = career('pre', 307)
  const me = s.me!
  lift(s, 66)
  const t = open(s, (x) => x.tier === 2 && tryoutSkill(s) < expectOf(x) + 10)!
  sendPitch(s, t.id)
  answer(s, 100)
  const inv = me.pre.invites.find((i) => i.via === 'self')
  check(!!inv && !inv.direct && me.pending.some((x) => x.kind === 'invite' && x.id === inv.id) && me.log.some((l) => l.text.includes('回复了你的自荐')), `${t.name} 回复了自荐：试训邀请（via self），卡片等你答复`)
  if (inv) {
    check(startTryout(s, inv.id) === null && !!me.tryout, '接下邀请，试训开始')
    let g = 0
    while (me.tryout && g++ < 6) tryoutChoose(s, tryoutDays(s)[me.tryout.step].rec)
    check(!me.tryout && me.log.some((l) => l.text.includes(`${t.name} 试训评级`)), `试训打完、评了级：${me.deals.some((d) => d.teamId === t.id) ? '给了合同' : '没给合同'}`)
  }
  const d = career('pre', 308)
  lift(d, 92)
  const u = open(d, (x) => x.tier === 2 && tryoutSkill(d) >= expectOf(x) + 10)
  if (check(!!u, `实力 ${Math.round(tryoutSkill(d))}：找到高出门槛 10 以上的俱乐部（${u?.name ?? '无'}）`) && u) {
    sendPitch(d, u.id)
    answer(d, 100)
    const inv2 = d.me!.pre.invites.find((i) => i.via === 'self')
    check(!!inv2?.direct && startTryout(d, inv2.id) === null && d.me!.deals.some((x) => x.teamId === u.id && x.kind === 'sign'), '免试训，直接给了合同')
  }
}

/* ---- 七 ---- */
console.log('七、有合同的主动接触：经理信任 −4，对方来谈转会；离门槛近的先试训')
{
  const s = career('chal', 309)
  const me = s.me!
  lift(s, 95)
  s.day = 20
  me.ap = 8
  const t = open(s, (x) => tryoutSkill(s) >= expectOf(x) + 4)
  if (check(!!t, `综合 ${s.players[me.id].overall} 的 Challengers 选手：找到一家能接触、高出门槛 4 以上的俱乐部（${t?.name ?? '无'}）`) && t) {
    const trust = me.gmTrust
    check(sendPitch(s, t.id) === null && me.gmTrust === trust - CONTACT_TRUST && me.ap === 8 - PITCH_AP, `接触 ${t.name}：信任 ${trust} → ${me.gmTrust}，行动点 8 → ${me.ap}`)
    answer(s, 100)
    const deal = me.deals.find((x) => x.teamId === t.id)
    check(!!deal && deal.kind === 'transfer' && deal.via === 'contact' && me.pending.some((x) => x.kind === 'deal' && x.id === deal.id), `成了：${t.name} 开了转会报价（${deal?.kind ?? '无'}），卡片等你谈`)
  }
  const n = career('chal', 310)
  lift(n, 70)
  n.day = 20
  n.me!.ap = 8
  const v = open(n, (x) => tryoutSkill(n) < expectOf(x) + 4)
  if (check(!!v, `找到一家离门槛不到 4 分的俱乐部（${v?.name ?? '无'}）`) && v) {
    sendPitch(n, v.id)
    answer(n, 100)
    const inv = n.me!.pre.invites.find((i) => i.via === 'self' && i.teamId === v.id)
    check(!!inv && !inv.direct && n.me!.phase === 'pro' && !n.me!.deals.some((x) => x.teamId === v.id), `离门槛近：${v.name} 先请你去试训`)
    if (inv) check(startTryout(n, inv.id) === null && tryoutDays(n).length === 3, '打过职业的人试训三天')
  }
}

/* ---- 八 ---- */
console.log('八、托管：不替你发自荐；回来的回复卡照托管处理')
{
  const s = career('pre', 311)
  const me = s.me!
  lift(s, 70)
  for (let i = 0; i < 10; i++) autoWeek(s)
  check(!me.pitch?.tally?.sent && !me.log.some((l) => l.text.startsWith('自荐：') || l.text.startsWith('主动接触：')), `托管推了 10 周（${me.phase === 'pro' ? '已签约' : '还在天梯'}）：一份自荐都没发`)
  const c = career('pre', 312)
  lift(c, 66)
  const t = open(c, (x) => x.tier === 2)!
  sendPitch(c, t.id)
  answer(c, 0)
  const card = c.me!.pending.find((x) => x.kind === 'pitch')
  const line = card ? autoResolve(c, card) : ''
  check(!!card && !c.me!.pending.some((x) => x.kind === 'pitch') && !c.me!.pitch!.replies.length && line.includes('回绝'), `回绝的回复卡：托管看完关掉（「${line}」）`)
}

/* ---- 九 ---- */
console.log('九、老存档')
{
  const s = career('pre', 313)
  lift(s, 66)
  const o = structuredClone(s) as GameState
  delete (o.me as { pitch?: PitchBook }).pitch
  const old = migratePlayerSave(unpackState(packState(o)))
  const t = open(old, (x) => x.tier === 2)
  check(!old.me!.pitch && !pitchBlock(old) && pitchTargets(old).rows.length > 0, `没有自荐字段的老存档：读得进来，转会页照常列出 ${pitchTargets(old).rows.length} 家`)
  check(!!t && sendPitch(old, t.id) === null && !!old.me!.pitch?.out, '老存档里发得出自荐')
  const h = structuredClone(s) as GameState
  h.me!.pitch = { period: 1 } as unknown as PitchBook
  h.me!.pending.push({ kind: 'pitch', id: 'check:ghost', day: h.day })
  const back = migratePlayerSave(unpackState(packState(h)))
  const bk = back.me!.pitch!
  check(Array.isArray(bk.sent) && Array.isArray(bk.contacted) && Array.isArray(bk.rejected) && Array.isArray(bk.replies) && !back.me!.pending.some((x) => x.id === 'check:ghost') && !pitchBlock(back),
    '缺字段的自荐记录补成空的，对不上的回复卡清掉')
  const u = open(s, (x) => x.tier === 2)!
  sendPitch(s, u.id)
  answer(s, 100)
  const again = migratePlayerSave(unpackState(packState(s)))
  check(again.me!.pre.invites.some((i) => i.via === 'self') && again.me!.pitch?.tally?.ok === 1, '自荐带来的邀请存得住、读得回')
}

console.log(bad ? `\n✗ 自荐有 ${bad} 处不对。` : `\n✓ 自荐和主动接触：闸都写明原因，次数和回绝记得住，窗口和外语照规矩，回复按按钮上的把握来，签约作废，成了走试训和合同，托管不代发，老存档照读。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(bad ? 1 : 0)
