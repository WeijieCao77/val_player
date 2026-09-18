/**
 * Cups a round a week, and what a deep run brings.
 *
 * Reported 2026-09-14: once entered, a café cup was played to its end on the
 * day it was entered — every round back to back, no rest, no training, no shop
 * in between. It now runs the way 破晓's 城市争霸赛 does: a round a week, the
 * card up only on the round's own day, and the weeks between are ordinary weeks.
 * And a run that goes deep can bring a club's call, which it never did:
 * me/prepro.ts cupInvite was never called.
 *
 *   一、by hand: sign up, rest between rounds, play each round on its day
 *   二、on autopilot: pre-pro weeks as the bot plays them; fast-forward at a round
 *   三、forfeit, signing mid-run, and saves from the blocking model
 *   四、the call a deep run can bring, once the run is over
 *   五、the cup's own page (ui/me/CupDetail.tsx): its days, its state and its greyed 报名 as the engine has them
 *
 *   npx tsx scripts/check_cup.ts
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { advanceUntil, autoPlan, autoResolve, leftToMe, matchLoad, runAutoPilot, runBlocked } from '../src/engine/me/auto'
import { advanceTurn, advanceWeek, planBlock, setPlan } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { TEMP_MINE, TEMP_OPP, afterCupMatch, cupEntryBlock, cupFor, cupOf, cupOpensOn, cupRng, cupRoundDay, cupStatus, enterCup, forfeitCup, isCupRound, mountCupMatch, resumeCup, roundDayAfter, skipCup } from '../src/engine/me/cups'
import { buyRelax } from '../src/engine/me/shop'
import { reachableClubs } from '../src/engine/me/prepro'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'
import type { PendingItem } from '../src/engine/me/types'
import { Rng, hashStr } from '../src/engine/rng'

let bad = 0
const fail = (m: string) => { bad++; console.log(`  ✗ ${m}`) }
const t0 = Date.now()
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} 秒`
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s))
const pct = (x: number) => `${Math.round(x * 100)}%`
const WEEKDAY = '日一二三四五六'
const weekday = (s: GameState, day: number) => new Date(Date.UTC(s.year, 0, 1 + day)).getUTCDay()
const date = (s: GameState, day: number) => {
  const d = new Date(Date.UTC(s.year, 0, 1 + day))
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} 周${WEEKDAY[d.getUTCDay()]}`
}
const cupCards = (s: GameState) => s.me!.pending.filter((x) => x.kind === 'cup')

const CAREERS: { label: string; o: any }[] = [
  { label: '2021 中国 · 网吧赛', o: { name: 'CupA', region: 'China', role: '决斗者', originKey: 'netcafe', start: 'pre', seed: 11, year: 2021 } },
  { label: '2026 欧洲 · 本地线下赛', o: { name: 'CupB', region: 'Europe', role: '先锋', originKey: 'grinder', start: 'pre', seed: 7, year: 2026 } },
]
const make = (o: any) => createCareer({ ...o, talents: emptyTalents() })

/** Weeks the bot's way until this cup's entry card is up; other cups are passed on. */
function toEntry(s: GameState, key: string, maxWeeks = 30): PendingItem | null {
  const me = s.me!
  const answer = (it: PendingItem): boolean => {
    if (it.kind === 'cup' && !isCupRound(s, it)) {
      if (it.id === key) return true
      skipCup(s, it.id!)
      return false
    }
    autoResolve(s, it)
    return false
  }
  for (let w = 0; w < maxWeeks; w++) {
    let g = 0
    while (me.pending.length && g++ < 30) if (answer(me.pending[0])) return me.pending[0]
    if (me.phase === 'pro' || me.phase === 'retired') return null
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(s)
    let st = advanceWeek(s)
    let k = 0
    while (st.kind !== 'week-end' && st.kind !== 'game-over' && k++ < 40) {
      if (st.kind === 'pending' && answer(st.item)) return st.item
      if (st.kind === 'match') new MeMatch(s, st.fixture).runOut()
      st = advanceWeek(s)
    }
  }
  return null
}

interface Row { label: string; bo: number; day: number; week: number; weekDay: number; before: number; after: number; won: boolean; score: string }

/** Today's round, played the way the card plays it. */
function playRound(s: GameState, rows: Row[]): void {
  const me = s.me!
  const p = s.players[me.id]
  const run = me.pre.cup!
  const cup = cupFor(s, run.key)!
  const before = Math.round(100 - p.fatigue)
  const m = mountCupMatch(s, cup, run.round, cupRng(s, `r${run.round}`))
  const rec = new MeMatch(s, { aId: TEMP_MINE, bId: TEMP_OPP, bo: m.bo, comp: cup.name, label: m.label }).runOut()
  const label = cup.rounds[run.round].label
  // the round's line in the week's report names the cup once (reported 2026-09-14: 「网吧赛 网吧赛 首轮」)
  const said = me.log.filter((l) => l.kind === 'cup').slice(-1)[0]?.text ?? ''
  if (!said.startsWith(`${cup.name} ${label} vs `)) fail(`${cup.name}${label}：这一轮的战报写成「${said.split(' vs ')[0]}」`)
  const week = me.week
  const weekDay = me.weekDay
  afterCupMatch(s, rec.won, rec.score, cupRng(s, 'after'))
  rows.push({ label, bo: m.bo, day: s.day, week, weekDay, before, after: Math.round(100 - p.fatigue), won: rec.won, score: rec.score })
}

/**
 * The week screen's button, pressed until the run is over: each week planned
 * by `plan` on its first morning, a round played on the day its card comes up,
 * anything else answered the steady way. On a morning with no round on it the
 * week is checked to be mine: rest, training and the shop all take.
 */
function pressThrough(s: GameState, plan: (s: GameState) => void, tag: string): { rows: Row[]; between: number } {
  const me = s.me!
  const rows: Row[] = []
  let between = 0
  let guard = 0
  while (me.pre.cup && guard++ < 150) {
    const run = me.pre.cup
    if (me.weekDay === 0 && me.ap === me.apMax) {
      if (run.next != null && run.next > s.day) {
        between++
        if (planBlock(s, 'rest')) fail(`${tag}：两轮之间排不了休息（${planBlock(s, 'rest')}）`)
        if (setPlan(s, 'aim', 1)) fail(`${tag}：两轮之间排不了训练`)
        else setPlan(s, 'aim', -1)
        const had = me.money
        const p = s.players[me.id]
        const fat = p.fatigue
        me.money += 400
        if (buyRelax(s, 'physio')) fail(`${tag}：两轮之间买不了理疗`)
        me.money = had
        p.fatigue = fat
        me.relaxUsed = 0
        if (cupCards(s).some((x) => isCupRound(s, x))) fail(`${tag}：没到比赛日，杯赛卡已经挂起来了`)
      }
      plan(s)
    }
    const st = advanceTurn(s)
    if (st.kind === 'pending') {
      const it = st.item
      if (isCupRound(s, it)) {
        if (me.pre.cup!.next !== s.day) fail(`${tag}：比赛卡在 ${date(s, s.day)} 弹出，这一轮排的是 ${date(s, me.pre.cup!.next ?? -1)}`)
        playRound(s, rows)
      } else if (it.kind === 'cup') skipCup(s, it.id!)
      else autoResolve(s, it)
      continue
    }
    if (st.kind === 'match') { new MeMatch(s, st.fixture).runOut(); continue }
    if (st.kind === 'game-over') break
    const live = me.pre.cup
    if (live && live.next != null && live.next > s.day && cupCards(s).some((x) => x.id === live.key)) fail(`${tag}：${date(s, s.day)} 不是比赛日，杯赛卡还挂着`)
  }
  if (me.pre.cup) fail(`${tag}：按了 ${guard} 次，赛事还没结束`)
  return { rows, between }
}

/**
 * The rounds' own rules: a week apart, on a weekend, on days one to six of a
 * week, one settlement between each two. `today`: the first round is a save's
 * carried-on round, played the day it was read.
 */
function checkRows(s: GameState, rows: Row[], tag: string, o: { entered?: number; today?: boolean } = {}): void {
  if (!rows.length) { fail(`${tag}：一轮都没打`); return }
  if (o.entered != null) {
    const wait = rows[0].day - o.entered
    if (wait < 8 || wait > 13) fail(`${tag}：报名到首轮隔了 ${wait} 天，应该是下一周的周末（8–13 天）`)
  }
  rows.forEach((r, i) => {
    if (o.today && i === 0) return
    const wd = weekday(s, r.day)
    if (wd !== 6 && wd !== 0) fail(`${tag}：${r.label} 在 ${date(s, r.day)}，不是周末`)
    if (r.weekDay < 1 || r.weekDay > 6) fail(`${tag}：${r.label} 在一周的第 ${r.weekDay} 天，应该在周结算之后、下一次结算之前`)
  })
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].day - rows[i - 1].day
    if (o.today && i === 1 ? gap < 8 || gap > 13 : gap !== 7) fail(`${tag}：${rows[i - 1].label} 到 ${rows[i].label} 隔了 ${gap} 天，应该一周一轮`)
    if (rows[i].week !== rows[i - 1].week + 1) fail(`${tag}：${rows[i - 1].label} 和 ${rows[i].label} 之间结算了 ${rows[i].week - rows[i - 1].week} 次，应该正好一次`)
  }
  if (!rows.every((r, i) => i === rows.length - 1 || r.won)) fail(`${tag}：输了还接着打`)
}

/**
 * What must hold for a cup that played rounds inside the window, in the two
 * states that are both legitimate — and which one a run lands in is not this
 * check's to pin down.
 *
 * Pre-pro cup results move with the RNG stream. Any key round that draws shifts
 * it (me/nodes.ts WEAK_SHARE is one such consumer), so a group match lost on one
 * commit is won on the next; a win keeps the run alive to its next round where
 * a loss closes it. Both readings are correct play.
 *
 * So the rule is keyed to the cup being examined, and never asks whether some
 * *other* run is idle. When a 22-week window ends, another cup may legitimately
 * still be attached to me.pre.cup — that says nothing about this one, and a
 * check that fails on it is asserting fixture luck, not an invariant.
 *
 *   ended   — detached from me.pre.cup, written into me.pre.cups, the pickup
 *             fives dropped and the card gone
 *   running — still attached, so not yet written down as finished, and with a
 *             round genuinely left to play
 */
function ended(s: GameState, key: string, tag: string): void {
  const me = s.me!
  if (me.pre.cup?.key === key) fail(`${tag}：赛事还挂着`)
  if (!me.pre.cups.some((c) => c.key === key && c.year === s.year)) fail(`${tag}：结束了却没有记录`)
  if (s.teams[TEMP_MINE] || s.teams[TEMP_OPP]) fail(`${tag}：临时队伍没撤`)
  if (cupCards(s).some((x) => x.id === key)) fail(`${tag}：结束后杯赛卡还挂着`)
}

/** The other legitimate state: this cup is the one still attached, mid-run. */
function running(s: GameState, key: string, rounds: number, tag: string): void {
  const me = s.me!
  const run = me.pre.cup!
  if (me.pre.cups.some((c) => c.key === key && c.year === s.year)) fail(`${tag}：还挂着，却已经记下了战绩`)
  if (run.round >= rounds) fail(`${tag}：${rounds} 轮都打完了，赛事还挂着`)
}

const line = (rows: Row[]) => rows.map((r) => `${r.label} BO${r.bo} ${r.won ? '胜' : '负'} ${r.score}（体力 ${r.before}→${r.after}）`).join(' · ')
/** a stronger me, so a run goes past its first round */
const stronger = (s: GameState, by: number) => { const p = s.players[s.me!.id]; for (const k of ATTR_KEYS) p.attrs[k] += by; recomputeOverall(p) }

/** Sign up for the city cup on its card; returns the day it was entered. */
function signUp(s: GameState, tag: string): number | null {
  const me = s.me!
  const it = toEntry(s, 'city')
  if (!it) { fail(`${tag}：没等到报名卡`); return null }
  const cup = cupFor(s, 'city')!
  me.money = Math.max(me.money, cup.fee + 3000)
  me.pending = [it, ...me.pending.filter((x) => x !== it)]
  const day = s.day
  const why = enterCup(s, 'city', new Rng(1))
  if (why) { fail(`${tag}：报不了名：${why}`); return null }
  return day
}

/* ---- 一、by hand ---- */
console.log('一、手动：报名，两轮之间排休息，比赛日当天打')
/** the week between rounds: six hours of rest, six of ranked */
const restWeek = (s: GameState) => { for (let i = 0; i < 6; i++) setPlan(s, 'rest', 1); while (s.me!.ap > 0 && !setPlan(s, 'ranked', 1)) { /* filling */ } }
for (const c of CAREERS) {
  for (const strong of [false, true]) {
    const tag = `${c.label}${strong ? ' · 练强了再报' : ''}`
    const s = make(c.o)
    const me = s.me!
    if (strong) stronger(s, 12)
    const entered = signUp(s, tag)
    if (entered == null) continue
    const run = me.pre.cup!
    if (cupCards(s).length) fail(`${tag}：报完名报名卡还挂着，时钟会被挡住`)
    if (run.next == null) { fail(`${tag}：报了名没有首轮日期`); continue }
    if (!strong) {
      // a week that holds a round counts its maps in the recommended plan (me/auto.ts matchLoad)
      const w = clone(s)
      let g = 0
      while ((w.me!.weekDay !== 0 || w.day + 7 < run.next) && g++ < 10) {
        if (advanceWeek(w).kind === 'game-over') break
        let h = 0
        while (w.me!.pending.length && h++ < 20 && !isCupRound(w, w.me!.pending[0])) autoResolve(w, w.me!.pending[0])
      }
      if (w.me!.pre.cup?.next != null && w.day < w.me!.pre.cup.next && matchLoad(w) <= 0) fail(`${tag}：这周有一轮杯赛，推荐安排却没算它的体力`)
      if (matchLoad(s) !== 0) fail(`${tag}：报名这周没有比赛，推荐安排却算了比赛体力`)
      // the same week rested or trained through: the rest has to show before the next round
      const a = clone(s)
      const b = clone(s)
      for (let i = 0; i < 12; i++) setPlan(a, 'rest', 1)
      for (let i = 0; i < 6; i++) setPlan(b, 'aim', 1)
      for (const x of [a, b]) {
        let st = advanceWeek(x)
        let k = 0
        while (st.kind !== 'week-end' && st.kind !== 'game-over' && k++ < 20) {
          if (st.kind === 'pending') { if (isCupRound(x, st.item)) playRound(x, []); else autoResolve(x, st.item) }
          st = advanceWeek(x)
        }
      }
      const fa = a.players[a.me!.id].fatigue
      const fb = b.players[b.me!.id].fatigue
      if (!(fa < fb - 20)) fail(`${tag}：报名那周全休息，结算后疲劳 ${fa.toFixed(0)}；全练枪 ${fb.toFixed(0)}——休息没回体力`)
      console.log(`  ${tag}：报名那周全休息 vs 全练枪，首轮前体力 ${Math.round(100 - fa)} vs ${Math.round(100 - fb)}`)
    }
    const r = pressThrough(s, restWeek, tag)
    checkRows(s, r.rows, tag, { entered })
    ended(s, 'city', tag)
    for (let i = 1; i < r.rows.length; i++) if (r.rows[i].before < r.rows[i - 1].after) fail(`${tag}：两轮之间排了休息，${r.rows[i].label} 前体力 ${r.rows[i].before} 反倒比 ${r.rows[i - 1].label} 后的 ${r.rows[i - 1].after} 低`)
    const rec = me.pre.cups[me.pre.cups.length - 1]
    const last = r.rows[r.rows.length - 1]
    console.log(`  ${tag}：${date(s, entered)} 报名 → ${r.rows.map((x) => date(s, x.day)).join('、')}，跨 ${last ? last.day - entered : 0} 天；${r.between} 个没有比赛的周初，休息、训练、理疗都排得上`)
    console.log(`    ${line(r.rows)} → ${rec.won ? '冠军' : `赢 ${rec.reached}/${rec.rounds} 轮`}，奖金 $${rec.prize}`)
  }
}

/* ---- 二、autopilot ---- */
console.log(`\n二、托管：职业前一路交给推荐安排 · ${secs()}`)
const AUTO = [
  { label: '2021 中国', o: CAREERS[0].o },
  { label: '2021 欧洲', o: { name: 'CupC', region: 'Europe', role: '哨卫', originKey: 'town', start: 'pre', seed: 5, year: 2021 } },
]
let fastSeed: GameState | null = null
for (const c of AUTO) {
  const s = make(c.o)
  const me = s.me!
  const rows: Record<string, Row[]> = {}
  let stuck = 0
  const answer = () => {
    let g = 0
    while (me.pending.length && g++ < 30) {
      const it = me.pending[0]
      if (isCupRound(s, it)) {
        const run = me.pre.cup!
        const cup = cupFor(s, run.key)!
        const p = s.players[me.id]
        const before = Math.round(100 - p.fatigue)
        const label = cup.rounds[run.round].label
        const bo = cup.rounds[run.round].bo
        const week = me.week, weekDay = me.weekDay, day = s.day
        autoResolve(s, it)
        const m = me.matches[me.matches.length - 1]
        const played = !!m && m.friendly && m.day === day
        ;(rows[`${s.year}:${run.key}`] ??= []).push({ label, bo, day, week, weekDay, before, after: Math.round(100 - p.fatigue), won: played && m.won, score: played ? m.score : '弃权' })
      } else autoResolve(s, it)
    }
    if (me.pending.length) stuck++
  }
  for (let w = 0; w < 22; w++) {
    answer()
    if (me.phase === 'pro' || me.phase === 'retired') break
    autoPlan(s)
    let st = advanceWeek(s)
    let k = 0
    while (st.kind !== 'week-end' && st.kind !== 'game-over' && k++ < 40) {
      if (st.kind === 'match') new MeMatch(s, st.fixture).runOut()
      else answer()
      st = advanceWeek(s)
    }
    // the first week-end of a run with a round ahead: where the fast-forward cases start
    if (!fastSeed && me.pre.cup?.next != null && me.pre.cup.next > s.day && !me.pending.length) fastSeed = clone(s)
  }
  answer()
  if (stuck) fail(`${c.label}：${stuck} 次清不掉等着的卡`)
  for (const [k, rs] of Object.entries(rows)) {
    const key = k.split(':')[1]
    const cup = cupFor(s, key)!
    checkRows(s, rs, `${c.label} ${cup.name}`)
    // whichever state this run is in, it is asserted — never skipped (see ended/running)
    if (me.pre.cup?.key === key) running(s, key, cup.rounds.length, `${c.label} ${cup.name}`)
    else ended(s, key, `${c.label} ${cup.name}`)
    console.log(`  ${c.label} ${cup.name}：${rs.map((r) => date(s, r.day)).join('、')} · ${line(rs)}`)
  }
  if (!Object.keys(rows).length) console.log(`  ${c.label}：22 周里没有打杯赛`)
}
if (!fastSeed) fail('托管跑下来没有一次「赛事进行中、下一轮还没到」的周末，快进没法测')
else {
  const base = fastSeed as GameState
  const next = base.me!.pre.cup!.next!
  // 到下一场比赛: stops on the round's card on its day, and hands it to me
  const m = clone(base)
  const r = advanceUntil(m, 'match')
  const it = r.stop.kind === 'pending' ? r.stop.item : undefined
  if (!it || !isCupRound(m, it) || m.day !== next) fail(`快进到下一场比赛：应该停在 ${date(m, next)} 的杯赛卡上，停在了 ${r.stop.kind} ${it?.kind ?? ''} ${date(m, m.day)}`)
  else {
    console.log(`  快进「下一场比赛」：停在 ${date(m, m.day)} 的杯赛比赛日，交给你打`)
    // a round is not a decision: the dials do not play it, and it does not hold a run back
    m.me!.auto.biz = true
    runAutoPilot(m)
    if (!m.me!.pending.some((x) => isCupRound(m, x))) fail('托管「商务」开着，单次推进替你把杯赛打了')
    if (runBlocked(m)) fail('杯赛比赛日的卡挡住了快进，它不是要你拿主意的事')
  }
  // a month: as before a week holding a match of my club's, it stops at the week-end in front of it, never past the round
  const mo = clone(base)
  const r1 = advanceUntil(mo, 'month')
  const moRound = mo.me!.matches.some((x) => x.friendly && x.day === next)
  if (moRound || mo.day > next) fail(`快进一个月：越过了 ${date(mo, next)} 的杯赛（停在 ${date(mo, mo.day)}）`)
  else console.log(`  快进「一个月后」：${r1.weeks} 周，停在 ${date(mo, mo.day)}（${r1.stop.kind}），在杯赛那一周前面交还给你`)
  // to the end of the stage: the round played the steady way on the road, as a match of my club's is
  const st = clone(base)
  const r2 = advanceUntil(st, 'stage')
  const played = st.me!.matches.some((x) => x.friendly && x.day === next)
  if (!played) fail(`快进到赛段末：路过 ${date(st, next)} 的杯赛没有替你打（停在 ${r2.stop.kind}，${r2.weeks} 周）`)
  else console.log(`  快进「赛段末」：${r2.weeks} 周，路上替你打了杯赛：${r2.notes.filter((n) => /胜|负|弃权/.test(n)).slice(0, 3).join(' / ')}${r2.stop.kind === 'pending' ? `；停在 ${r2.stop.item.kind}` : ''}`)
}

/* ---- 三、forfeit, signing, old saves ---- */
console.log(`\n三、弃权、签约退赛、老存档 · ${secs()}`)
{
  const s = make(CAREERS[0].o)
  const cup = cupFor(s, 'city')!
  if (signUp(s, '弃权') != null) {
    const entry = clone(s)
    let g = 0
    let st = advanceTurn(s)
    while (!(st.kind === 'pending' && isCupRound(s, st.item)) && g++ < 30) {
      if (st.kind === 'pending') autoResolve(s, st.item)
      st = advanceTurn(s)
    }
    if (!(st.kind === 'pending' && isCupRound(s, st.item))) fail('没等到首轮的比赛卡')
    else {
      const f = clone(s)
      const money0 = f.me!.money
      const rec = forfeitCup(f, new Rng(3))
      if (!rec || !rec.forfeit) fail('弃权没有记成弃权')
      else {
        if (rec.prize !== cup.prize[rec.reached]) fail(`弃权奖金 $${rec.prize}，按已赢轮次应是 $${cup.prize[rec.reached]}`)
        if (f.me!.money !== money0 + rec.prize) fail('弃权的奖金没到账')
        ended(f, 'city', '弃权')
        console.log(`  首轮弃权：赛事结束，赢 ${rec.reached} 轮，奖金 $${rec.prize}，卡片收起`)
      }
      const after = advanceTurn(f)
      if (after.kind === 'pending' && after.item.kind === 'cup') fail('弃权之后推进还是弹杯赛卡')
    }
    // signed to a club between rounds: the run is withdrawn from, as before
    const w = clone(entry)
    w.me!.phase = 'pro'
    resumeCup(w)
    if (w.me!.pre.cup || cupCards(w).length) fail('签约之后杯赛没有退出')
    else console.log('  两轮之间签了约：下一次推进退出杯赛')
    // a save from the blocking model: the run's card in front and no dates — or, the old dead save, no card at all
    for (const shape of ['card', 'nocard'] as const) {
      const o = clone(entry)
      stronger(o, 12)
      const run = o.me!.pre.cup!
      delete (run as any).next
      delete (run as any).year
      o.me!.pending = o.me!.pending.filter((x) => x.kind !== 'cup')
      if (shape === 'card') o.me!.pending.unshift({ kind: 'cup', id: run.key, day: o.day })
      const old = migratePlayerSave(unpackState(packState(o)))
      const day0 = old.day
      const tag = shape === 'card' ? '老存档（卡在最前）' : '老存档（没有卡，当年的死档）'
      const r = pressThrough(old, restWeek, tag)
      checkRows(old, r.rows, tag, { today: true })
      ended(old, 'city', tag)
      if (r.rows[0] && r.rows[0].day !== day0) fail(`${tag}：接着打的这一轮应在读档当天（${date(old, day0)}），实际 ${date(old, r.rows[0].day)}`)
      console.log(`  ${tag}：读档当天（${date(old, day0)}）打 ${r.rows[0]?.label ?? '—'}，之后 ${r.rows.slice(1).map((x) => `${x.label} ${date(old, x.day)}`).join('、') || '没有下一轮'}；${line(r.rows)}`)
    }
  }
}

/* ---- 四、the call a deep run can bring ---- */
console.log(`\n四、杯赛带来的试训邀请 · ${secs()}`)
{
  const s = make(CAREERS[1].o)
  if (signUp(s, '邀请') != null) {
    const cup = cupFor(s, 'city')!
    // somebody a club could want: within reach of at least one bar (me/prepro.ts reachableClubs)
    for (let i = 0; i < 20 && !reachableClubs(s).length; i++) stronger(s, 1)
    if (!reachableClubs(s).length) fail('练到 20 点以上也没有够得着的俱乐部，测不了')
    const N = 40
    /** the share of runs ended at this round, this way, that bring a call */
    const rate = (round: number, won: boolean): number => {
      let calls = 0
      for (let t = 0; t < N; t++) {
        const c = clone(s)
        c.me!.pre.invites = []
        c.me!.pending = c.me!.pending.filter((x) => x.kind !== 'invite')
        c.me!.pre.cup!.round = round
        // seeded the way the game seeds it (me/cups.ts cupRng): a hashed tag, not neighbouring integers
        afterCupMatch(c, won, won ? '2-1' : '0-2', new Rng(hashStr(`cupinv:${round}:${won}:${t}`)))
        const over = !won || round === cup.rounds.length - 1
        if (!!c.me!.pre.cup === over) { fail(`${cup.rounds[round].label}${won ? '赢了' : '输了'}，赛事${over ? '该结束却还在' : '不该结束却没了'}`); break }
        const inv = c.me!.pre.invites.find((x) => x.via === 'cup')
        if (!inv) continue
        calls++
        const card = c.me!.pending.find((x) => x.kind === 'invite' && x.id === inv.id)
        if (!card) fail('杯赛带来的邀请没有卡片')
        else if (!leftToMe(c, card)) fail('托管「生涯」没开，快进却不会停在杯赛带来的邀请上')
      }
      return calls / N
    }
    const champ = rate(cup.rounds.length - 1, true)
    const semi = rate(2, false)
    const first = rate(0, false)
    // a round won with more to play: no call yet — 破晓 keeps them for the end of the cup
    const mid = rate(0, true)
    console.log(`  打完来电话的比例：夺冠 ${pct(champ)} · 四强出局 ${pct(semi)} · 首轮出局 ${pct(first)} · 赢了首轮还没打完 ${pct(mid)}（各 ${N} 次；被记下名字 ${s.me!.pre.scoutSeen} 次，够得着的俱乐部 ${reachableClubs(s).length} 家）`)
    if (champ < 0.6) fail(`夺冠只有 ${pct(champ)} 带来邀请，cupInvite 写的是八成以上`)
    if (first > 0.35) fail(`首轮出局也有 ${pct(first)} 带来邀请`)
    if (!(champ > semi && semi > first)) fail('走得越远越容易被看到，这个次序没有成立')
    if (mid > 0) fail('赛事还没打完，杯赛的邀请就来了')
  }
}

/* ---- 五、the cup's own page ---- */
// Reported 2026-09-18: 「右边可以看到今年的赛事……但是没地方点进去看具体赛程或者比赛信息、报名信息」. The page a
// cup now opens (ui/me/CupDetail.tsx) says the week its card comes up, the first round's day, where the cup stands
// and why 报名 is greyed — every one of them read off engine/me/cups.ts, and here held to what the engine then does.
console.log(`\n五、赛事详情页说的和引擎做的一样 · ${secs()}`)
for (const c of CAREERS) {
  const s = make(c.o)
  const me = s.me!
  const def = cupOf('city')!
  const tag = c.label
  const st0 = cupStatus(s, 'city')
  const ahead = def.week - Math.floor(s.day / 7)
  const opens = cupOpensOn(s, def)
  const first = roundDayAfter(s.year, opens)
  if (st0.kind !== 'ahead' || st0.weeks !== ahead) fail(`${tag}：开档时详情页写「${st0.kind === 'ahead' ? `${st0.weeks} 周后` : st0.kind}」，应是 ${ahead} 周后`)
  const it = toEntry(s, 'city')
  if (!it) { fail(`${tag}：没等到报名卡`); continue }
  if (s.day !== opens) fail(`${tag}：详情页说 ${date(s, opens)} 那一周弹卡，卡在 ${date(s, s.day)} 弹出`)
  if (cupStatus(s, 'city').kind !== 'now') fail(`${tag}：报名卡挂着，详情页写的是「${cupStatus(s, 'city').kind}」`)
  if (cupRoundDay(s) !== first) fail(`${tag}：详情页说首轮 ${date(s, first)}，报名卡说 ${date(s, cupRoundDay(s))}`)
  // greyed with the reason, the way the card's 报名 is: short of the fee, then an invitation short of followers
  const skip = clone(s)
  skip.me!.money = def.fee - 1
  const why = cupEntryBlock(skip, 'city')
  const refused = enterCup(clone(skip), 'city', new Rng(1))
  if (!why || !refused) fail(`${tag}：钱不够时详情页${why ? '' : '没'}说报不了，报名${refused ? '' : '却'}成功了`)
  const inv = clone(s)
  inv.me!.fans = 0
  if (!cupEntryBlock(inv, 'streamer')?.includes('粉丝')) fail(`${tag}：粉丝不够时详情页没说邀请制的门槛（${cupEntryBlock(inv, 'streamer')}）`)
  skipCup(skip, 'city')
  if (cupStatus(skip, 'city').kind !== 'skipped') fail(`${tag}：选了不打，详情页写的是「${cupStatus(skip, 'city').kind}」`)
  // entered: the run's first round on the day the page named, then each round kept as it went
  const entered = signUp(s, tag)
  if (entered == null) continue
  if (me.pre.cup?.next !== first) fail(`${tag}：详情页说首轮 ${date(s, first)}，报了名排在 ${date(s, me.pre.cup?.next ?? -1)}`)
  if (cupStatus(s, 'city').kind !== 'running') fail(`${tag}：报了名，详情页写的是「${cupStatus(s, 'city').kind}」`)
  const r = pressThrough(s, restWeek, `${tag} · 详情页`)
  const st = cupStatus(s, 'city')
  const rec = st.kind === 'done' ? st.run : undefined
  const cup = cupFor(s, 'city')!
  if (!rec) fail(`${tag}：打完了，详情页写的是「${st.kind}」`)
  else if (rec.results?.length !== r.rows.length || !rec.results.every((x, i) => x.startsWith(`${cup.rounds[i].label} `))) fail(`${tag}：详情页的轮次记录 ${JSON.stringify(rec.results)}，实际打了 ${r.rows.map((x) => x.label).join('、')}`)
  else console.log(`  ${tag}：开档写 ${ahead} 周后，${date(s, opens)} 弹卡、首轮 ${date(s, first)}，都和引擎一样；打完记下 ${rec.results.join(' · ')}`)
  // a week gone by with no card — a club then, or no career yet: 错过了
  const late = clone(s)
  late.me!.pre.cups = late.me!.pre.cups.filter((x) => x.key !== 'premier')
  late.me!.pre.seen = late.me!.pre.seen.filter((x) => !x.endsWith(':premier'))
  late.day = Math.max(late.day, (cupOf('premier')!.week + 1) * 7)
  if (cupStatus(late, 'premier').kind !== 'missed') fail(`${tag}：挑战者组那一周过去了也没弹卡，详情页写的是「${cupStatus(late, 'premier').kind}」`)
}

console.log(bad ? `\n✗ ${bad} 项不对。 · ${secs()}` : `\n✓ 杯赛一周一轮，两轮之间能休息、训练、买东西，比赛日才弹卡，快进和联赛一个规矩，老存档接得上，走得远会有人来电话；详情页说的日子和状态都是引擎的。 · ${secs()}`)
if (bad) process.exit(1)
