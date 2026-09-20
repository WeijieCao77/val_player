/**
 * 不打排位：分数不掉，神话起名次往后掉. The author, 2026-09-14: 「不打排位分数也会掉，这不合理，我们的设定是不打会下滑，
 * 但是在辐能这个段位下滑的应该是排名但是分数不变，下滑是因为别人分变高了」 (me/rank.ts boardWeek and standingOf,
 * me/prepro.ts ladderWeekly and playRanked).
 *
 *  一 a week without ranked keeps the score and RR exactly, at every tier — through the week's own settlement too
 *  二 a 辐能战魂 who stops slides down the board — near 1st, 10th, 100th, 300th, 480th: places a week, weeks to leave the
 *     500 — and out of the 500 reads the 神话 division of his RR, with that RR; never under that division's last place
 *  三 a player who keeps playing at a steady skill does not slide
 *  四 back from a break the place comes back through RR: playing takes none of the climb off, the place moves with the
 *     RR, the week's settle is a sliver of the way back, and a man who only loses gets no place back
 *  五 a club's call reads the place as it reads — the same draws as a man who stands there — and so do the tryout's
 *     read, the talks' leverage, the events and the save card; the lines to aim at do not move
 *  六 the best keeps the place actually held: 前一百 and a tier's first card go by the place on the screen, not the RR
 *  七 an event's answer that puts ranked off takes no score
 *  八 the edges: at the top of the scale a win pays the climb down; leaving a club lifts the standing, taking no RR
 *  九 a save from before loads, keeps its score, nothing climbed, and plays on
 *
 *   npx tsx scripts/check_ladder_idle.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import {
  BOARD_CLIMB, BOARD_RISE_MAX, BOARD_SETTLE, PUT_OFF_CN, RADIANT_SLOTS, rankAt, rankBar, rankFull, rankText, standAtLeast, standingOf,
} from '../src/engine/me/rank'
import { INVITE_LADDER, INVITE_LADDER_T1, ladderLabel, ladderWeekly, playRanked, rollInvites, skillToLadder, tryoutSkill } from '../src/engine/me/prepro'
import { doAction, settleWeek } from '../src/engine/me/week'
import { applyEffect } from '../src/engine/me/fx'
import { EVENTS, describeEffect } from '../src/engine/me/events'
import { ACHIEVEMENTS } from '../src/engine/me/achievements'
import { leaveClub, makeDeal } from '../src/engine/me/contract'
import { migratePlayerSave } from '../src/engine/me/save'
import { buildSaveMeta } from '../src/engine/me/saveMeta'
import { inviteBlock } from '../src/engine/me/window'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region } from '../src/engine/types'
import { Rng, clamp, hashStr } from '../src/engine/rng'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let fails = 0
const check = (ok: boolean, what: string): void => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++ }
const info = (m: string): void => console.log(`    ${m}`)
const t0 = Date.now()
const n = (x: number | null | undefined): string => (x ?? 0).toLocaleString('en-US')

/** all rank.ts reads of a save: the date, the seed, where I come from, the score and the board's climb past it */
const at = (ladder: number, rise = 0, year = 2026, day = 100, region: Region = 'China', seed = 7): GameState =>
  ({ year, day, seed, me: { region, phase: 'pre', flags: {}, moments: [], pre: { ladder, ladderPeak: ladder, rise } } } as unknown as GameState)
/** the same, on a career's own date, seed and server */
const like = (g: GameState, ladder: number, rise = 0): GameState => at(ladder, rise, g.year, g.day, g.me!.region, g.seed)

/** the score whose place on that board, as it stands, is about `place` */
function scoreAt(place: number, g: GameState = at(0)): number {
  let lo = 42
  let hi = 100
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if ((rankAt(like(g, mid)).pos ?? Infinity) > place) lo = mid
    else hi = mid
  }
  return hi
}

/** the lowest score whose RR is `rr` or more */
function scoreOfRR(g: GameState, rr: number): number {
  let lo = 42
  let hi = 100
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (rankAt(like(g, mid)).rr < rr) lo = mid
    else hi = mid
  }
  return hi
}

/** the score that, with the board `rise` RR past it, stands where `stand` stands */
function scoreFor(g: GameState, stand: number, rise: number): number {
  let lo = stand
  let hi = 100
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (standingOf(like(g, mid, rise)) < stand) lo = mid
    else hi = mid
  }
  return hi
}

/** the climb past `ladder` that puts its place on the screen at about `place` */
function riseTo(g: GameState, ladder: number, place: number): number {
  let lo = 0
  let hi = BOARD_RISE_MAX
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if ((rankAt(like(g, ladder, mid)).pos ?? 0) < place) lo = mid
    else hi = mid
  }
  return hi
}

const DIV_ORDER: Record<string, number> = { 神话: 1, '神话 1': 1, '神话 2': 2, '神话 3': 3, 辐能战魂: 4 }

/** the last place of a division of 神话: the place of the lowest score that holds it or better, on the board as it stands */
function footOf(g: GameState, name: string): number {
  let lo = 42
  let hi = 100
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if ((DIV_ORDER[rankAt(like(g, mid)).name] ?? 0) >= (DIV_ORDER[name] ?? 0)) hi = mid
    else lo = mid
  }
  return rankAt(like(g, hi)).pos ?? 0
}

/** RR per unit of log place on a board, read off it (me/rank.ts THETA) */
function rrPerLn(g: GameState): number {
  const a = rankAt(like(g, 50))
  const b = rankAt(like(g, 72))
  return (b.rr - a.rr) / Math.log((a.pos ?? 1) / (b.pos ?? 1))
}

/** a player a range of clubs would ask: every one of the eight at least `level` */
function lift(s: GameState, level: number): void {
  const p = s.players[s.me!.id]
  for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], level)
  recomputeOverall(p)
}

/** games that go win, loss, win, loss… */
const evenRng = (): Rng => {
  let g = 0
  return { chance: () => g++ % 2 === 0 } as unknown as Rng
}

/** the old week without ranked (me/prepro.ts ladderWeekly until 2026-09-14), for the report */
const oldLeak = (l: number, target: number): number => clamp(l + (target - l) * 0.06 - 0.4, 0, 100)

const career = (seed: number, region: Region = 'China', start: 'pre' | 'chal' = 'pre'): GameState =>
  createCareer({ name: 'Idle', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2026 })

/* ---- 一 ---- */
console.log('\n一、不打排位的周：分数和 RR 一点不动')
{
  const tiers: [string, number][] = [['铂金', 6], ['钻石', 22], ['超凡入圣', 36], ['神话', scoreAt(3000)], ['辐能战魂', scoreAt(200)]]
  for (const [tier, l] of tiers) {
    const s = at(l)
    const r0 = rankAt(s)
    let never = true
    let prev = r0.pos ?? 0
    for (let w = 1; w <= 52; w++) {
      ladderWeekly(s, false)
      const r = rankAt(s)
      if ((r.pos ?? 0) < prev) never = false
      prev = r.pos ?? 0
    }
    const r = rankAt(s)
    check(r0.tier === tier && s.me!.pre.ladder === l && r.rr === r0.rr && s.me!.pre.ladderPeak === l,
      `${tier}：52 周不打，分数 ${l.toFixed(2)} → ${s.me!.pre.ladder.toFixed(2)}，RR ${r0.rr} → ${r.rr}，最高没动（${rankFull(r0)} → ${rankFull(r)}）`)
    if (r0.pos === null) check(r.name === r0.name && s.me!.pre.rise === 0, `${tier}：没有排行榜名次，段位原样，榜单也没有越过他`)
    else check(never && (r.pos ?? 0) > (r0.pos ?? 0), `${tier}：名次只往后掉，第 ${n(r0.pos)} → 第 ${n(r.pos)} 名`)
  }

  // the week's own settlement, a week without ranked
  const s = career(7)
  const me = s.me!
  me.pre.ladder = scoreAt(300, s)
  me.pre.ladderPeak = me.pre.ladder
  me.pre.rise = 0
  const l = me.pre.ladder
  const r0 = rankAt(s)
  for (let w = 0; w < 6; w++) {
    me.plan = {}
    me.ap = me.apMax
    doAction(s, 'rest')
    settleWeek(s)
  }
  const r = rankAt(s)
  check(me.pre.ladder === l && r.rr === r0.rr && (r.pos ?? 0) > (r0.pos ?? 0) && me.pre.ladderPeak === l,
    `周结算（只休息、不排位）走 6 周：分数 ${l.toFixed(2)} → ${me.pre.ladder.toFixed(2)}，${rankFull(r0)} → ${rankFull(r)}，最高没动`)
  check(ladderLabel(s) === rankText(r) && ladderLabel(s) !== rankText(rankAt(s, me.pre.ladder)),
    `周页、总览、存档卡读掉过的名次：${ladderLabel(s)}（光看分数是 ${rankText(rankAt(s, me.pre.ladder))}）`)
}

/* ---- 二 ---- */
console.log('\n二、辐能战魂停排：名次往后掉，掉出前 500 按 RR 读作神话几，RR 不变（国服 2026）')
info(`榜单每停一周比你多涨 ${BOARD_CLIMB} RR，涨上去的那截每周回落 ${(BOARD_SETTLE * 100).toFixed(1)}%，最多 ${BOARD_RISE_MAX} RR；名次最多掉到 RR 所在小段的最后一名`)
{
  const SHOWN = [1, 2, 3, 4, 6, 8, 12, 16, 26, 39, 52, 78, 104]
  // weeks to leave the 500, as the calibration's comment in me/rank.ts says them
  const bounds: Record<number, [number, number]> = { 480: [1, 1], 300: [3, 5], 100: [9, 13], 10: [26, 36], 1: [48, 68] }
  const firstWeek: Record<number, number> = {}
  for (const P of [1, 10, 50, 100, 300, 480]) {
    const l = scoreAt(P)
    const s = at(l)
    const r0 = rankAt(s)
    const places: number[] = []
    let out = 0
    let outName = ''
    let kept = true
    for (let w = 1; w <= 104; w++) {
      ladderWeekly(s, false)
      const r = rankAt(s)
      places.push(r.pos ?? 0)
      if (r.rr !== r0.rr || s.me!.pre.ladder !== l) kept = false
      if (!out && !r.radiant) { out = w; outName = rankFull(r) }
    }
    firstWeek[P] = places[0] - (r0.pos ?? 0)
    // the real calendar: the same weeks with the server's own wander (rank.ts boardPop)
    const cal = at(l)
    let calOut = 0
    for (let w = 1; w <= 104 && !calOut; w++) {
      ladderWeekly(cal, false)
      cal.day = 100 + 7 * w
      if (cal.day >= 365) { cal.year += Math.floor(cal.day / 365); cal.day %= 365 }
      if (!rankAt(cal).radiant) calOut = w
    }
    // the old leak, for a man sitting where his play puts him (playRanked settles about 3 over the skill's spot)
    let old = l
    let oldOut = 0
    for (let w = 1; w <= 104 && !oldOut; w++) { old = oldLeak(old, l - 3); if (!rankAt(at(old)).radiant) oldOut = w }
    const r = rankAt(s)
    const foot = footOf(s, r.name)
    info(`第 ${n(r0.pos)} 名（${r0.rr} RR）：${SHOWN.map((w) => `${w} 周 ${n(places[w - 1])}`).join(' · ')}`)
    info(`  第 1 周掉 ${n(firstWeek[P])} 名；${out ? `第 ${out} 周掉出前 ${RADIANT_SLOTS}，读作 ${outName}` : '停两年也没掉出前 500'}；按真实日历（服务器人数有起伏）${calOut ? `第 ${calOut} 周` : '两年内没有'}；旧规则（分数往下漏）${oldOut ? `第 ${oldOut} 周` : '两年内没有'}；停两年 ${rankFull(r)}，${r.name} 最后一名是第 ${n(foot)} 名`)
    check(r0.radiant && kept, `第 ${P} 名左右的辐能战魂：停两年，分数和 RR（${r0.rr}）一直没动`)
    check(places[0] > (r0.pos ?? 0) && places.every((x, i) => x >= (i ? places[i - 1] : 0)), `第 ${P} 名左右：每停一周名次都不会往前（第 1 周 ${n(r0.pos)} → ${n(places[0])}）`)
    // the 10th and down have run into it inside two years; the first has not
    const floorHit = P >= 10 ? Math.abs((r.pos ?? 0) - foot) <= foot * 0.01 + 1 : (r.pos ?? 0) <= foot * 1.01 + 1
    check(floorHit, `第 ${P} 名左右：停两年 ${n(r.pos)}，${P >= 10 ? '停在' : '没掉过'} ${r.name} 最后一名（第 ${n(foot)} 名）${P >= 10 ? '' : '后面'}`)
    const b = bounds[P]
    if (b) {
      check(out >= b[0] && out <= b[1] && /^神话 [123]$/.test(r.name) && r.rr === r0.rr,
        `第 ${P} 名左右：第 ${out} 周掉出前 500（应在 ${b[0]}–${b[1]} 周），之后读作 ${r.name}，RR 还是 ${r.rr}`)
    }
  }
  check(firstWeek[480] > firstWeek[300] && firstWeek[300] > firstWeek[100] && firstWeek[100] > 0,
    `停第一周掉的名次：第 100 名掉 ${firstWeek[100]}、第 300 名掉 ${firstWeek[300]}、第 480 名掉 ${firstWeek[480]}——越往后，身边的人越多`)
  const kr = at(scoreAt(100, at(0, 0, 2026, 100, 'Korea')), 0, 2026, 100, 'Korea')
  const kr0 = rankAt(kr)
  let krOut = 0
  for (let w = 1; w <= 104 && !krOut; w++) { ladderWeekly(kr, false); if (!rankAt(kr).radiant) krOut = w }
  info(`韩服第 ${n(kr0.pos)} 名（${kr0.rr} RR）：${krOut ? `第 ${krOut} 周掉出前 500` : '两年没掉出前 500'}——人少的服务器名次一样按倍数往后掉`)
}

/* ---- 三 ---- */
console.log('\n三、一直在打、水平不变的人：名次不往下滑')
const steady = career(7)
{
  const me = steady.me!
  const p = steady.players[me.id]
  lift(steady, 72)
  const target = skillToLadder(p.overall)
  const RUNS = 8
  // RUNS years from where his play keeps him, each on one stream, as a week's settle rolls on one (me/week.ts)
  const run = (aps: number, skipEvery: number, label: string): { mean: number; start: number; rise: number } => {
    let sum = 0
    let riseMax = 0
    let start = 0
    for (let k = 0; k < RUNS; k++) {
      me.pre.ladder = target + 3
      me.pre.ladderPeak = me.pre.ladder
      me.pre.rise = 0
      start = standingOf(steady)
      const rng = new Rng(hashStr(`steady:${label}:${k}`))
      const stand: number[] = []
      for (let w = 0; w < 52; w++) {
        const off = skipEvery > 0 && w % skipEvery === skipEvery - 1
        p.form = 70
        p.fatigue = 30
        if (!off) for (let a = 0; a < aps; a++) playRanked(steady, rng)
        ladderWeekly(steady, !off)
        stand.push(standingOf(steady))
        riseMax = Math.max(riseMax, me.pre.rise ?? 0)
      }
      sum += stand.slice(26).reduce((a, b) => a + b, 0) / 26
    }
    const mean = sum / RUNS
    const pos = (x: number) => rankAt(like(steady, x)).pos
    info(`${label}（${RUNS} 年平均）：起点 ${rankText(rankAt(like(steady, start)))}（站位 ${start.toFixed(1)}），后半年平均站位 ${mean.toFixed(1)}（${rankText(rankAt(like(steady, mean)))}），差 ${(mean - start).toFixed(1)}（第 ${n(pos(start))} → ${n(pos(mean))} 名）；榜单最多越过他 ${Math.round(riseMax)} RR`)
    return { mean, start, rise: riseMax }
  }
  info(`综合 ${p.overall.toFixed(1)}，实力对应 ${rankText(rankAt(like(steady, target)))}`)
  const two = run(2, 0, '每周打 2 点排位')
  check(two.rise === 0 && Math.abs(two.mean - two.start) <= 1.5, `每周都打：榜单没有越过他（${two.rise} RR），后半年平均站位 ${two.mean.toFixed(1)}，和起点 ${two.start.toFixed(1)} 差不过 1.5`)
  const one = run(1, 0, '每周打 1 点排位')
  check(one.rise === 0 && Math.abs(one.mean - one.start) <= 1.5, `每周只打 1 点也算一直在打：后半年平均 ${one.mean.toFixed(1)}，起点 ${one.start.toFixed(1)}`)
  const skip = run(2, 4, '每 4 周停 1 周')
  info(`（每 4 周停 1 周：停的那周名次掉一点，打的那几周靠 RR 追回来——名次守得住，RR 要比一直打的人高一截）`)
  check(skip.mean >= skip.start - 2, `每 4 周停 1 周：后半年平均站位 ${skip.mean.toFixed(1)}，不比起点 ${skip.start.toFixed(1)} 低过 2`)
}

/* ---- 四 ---- */
console.log('\n四、停排之后回来打：名次跟着 RR 回来')
{
  const s = steady
  const me = s.me!
  const p = s.players[me.id]
  const theta = rrPerLn(s)
  const breakOff = (): { r0: ReturnType<typeof rankAt>; idle: number; outAt: number } => {
    // where his own play keeps him (三): about 3 over the skill's spot
    me.pre.ladder = skillToLadder(p.overall) + 3
    me.pre.ladderPeak = me.pre.ladder
    me.pre.rise = 0
    const r0 = rankAt(s)
    let idle = 0
    let outAt = 0
    while (idle < 80 && (!outAt || idle < outAt + 6)) {
      ladderWeekly(s, false)
      idle++
      if (!outAt && !rankAt(s).radiant) outAt = idle
    }
    return { r0, idle, outAt }
  }
  const { r0, idle, outAt } = breakOff()
  const riseBack = me.pre.rise ?? 0
  const rBack = rankAt(s)
  check(!rBack.radiant && rBack.rr === r0.rr, `第 ${n(r0.pos)} 名停了 ${idle} 周：${rankFull(r0)} → ${rankFull(rBack)}（第 ${outAt} 周掉出前 500），榜单越过他 ${Math.round(riseBack)} RR`)

  // the first session back
  const rng = new Rng(hashStr('back'))
  p.form = 70
  p.fatigue = 30
  const first = playRanked(s, rng)
  const r1 = rankAt(s)
  const reset = rankAt(s, me.pre.ladder)
  check(me.pre.rise === riseBack && r1.pos !== reset.pos,
    `回来打的第一点排位（${first.wins} 胜 ${first.losses} 负）：榜单还越过他 ${Math.round(me.pre.rise ?? 0)} RR，没有清零——现在 ${rankFull(r1)}，要是一打就清零会是 ${rankText(reset)}`)
  check(first.delta > 0 ? (r1.pos ?? 0) <= (rBack.pos ?? 0) : (r1.pos ?? 0) >= (rBack.pos ?? 0), `第一点排位：RR ${rBack.rr} → ${r1.rr}，名次 ${n(rBack.pos)} → ${n(r1.pos)}，同一个方向`)

  let apBad = 0
  let aps = 1
  let settleBad = 0
  let settles = 0
  let lnSettleBack = 0
  let backIn = 0
  let backNear = 0
  let posNear = 0
  let rrIn = 0
  let riseIn = 0
  const path: string[] = []
  for (let w = 1; w <= 30; w++) {
    for (let k = w === 1 ? 1 : 0; k < 2; k++) {
      p.form = 70
      p.fatigue = 30
      const b = rankAt(s)
      const riseB = me.pre.rise
      const res = playRanked(s, rng)
      const a = rankAt(s)
      aps++
      // playing takes none of the climb off: the place moves only as the RR does, and the same way
      if (me.pre.rise !== riseB || (res.delta > 0 && (a.pos ?? 0) > (b.pos ?? 0)) || (res.delta < 0 && (a.pos ?? 0) < (b.pos ?? 0))) apBad++
    }
    const b = rankAt(s)
    const lB = me.pre.ladder
    const riseB = me.pre.rise ?? 0
    ladderWeekly(s, true)
    const a = rankAt(s)
    settles++
    // the week's settle moves no RR, and lifts the place by no more than what settled
    const gain = Math.log((b.pos ?? 1) / (a.pos ?? 1))
    if (!backNear) lnSettleBack += gain
    if (me.pre.ladder !== lB || a.rr !== b.rr || gain > ((riseB - (me.pre.rise ?? 0)) / theta) * 1.05 + 1 / (a.pos ?? 1)) settleBad++
    if (!backIn && a.radiant) { backIn = w; rrIn = a.rr; riseIn = me.pre.rise ?? 0 }
    if (!backNear && (a.pos ?? Infinity) <= (r0.pos ?? 0) * 1.1) { backNear = w; posNear = a.pos ?? 0 }
    if ([1, 2, 3, 4, 6, 8, 12, 20, 30].includes(w)) path.push(`${w} 周 ${a.name} 第 ${n(a.pos)}（${a.rr} RR，榜单越过 ${Math.round(me.pre.rise ?? 0)}）`)
  }
  const lnBack = Math.log((rBack.pos ?? 1) / (posNear || 1))
  info(`回来以后每周打 2 点：${path.join(' · ')}`)
  check(apBad === 0, `${aps} 点排位里，榜单越过他的一分都没少，名次每一次都只跟着 RR 走（不对的 ${apBad} 次）`)
  check(settleBad === 0, `${settles} 次周结算：RR 一分不动，名次最多回来回落的那一点（不对的 ${settleBad} 次）`)
  check(backNear > 0 && lnBack > 0 && lnSettleBack / lnBack <= 0.15, `回到停排前名次附近的路上（第 ${n(rBack.pos)} → 第 ${n(posNear)} 名），回落只占 ${((lnSettleBack / lnBack) * 100).toFixed(1)}%，其余是打回来的 RR`)
  check(backIn > 0 && backIn <= 12, `第 ${backIn} 周打回前 500：那时 ${rrIn} RR（榜单还越过他 ${Math.round(riseIn)} RR）`)
  check(rrIn > r0.rr, `打回前 500 要的 RR（${rrIn}）比停之前（${r0.rr}）多——榜单涨了`)
  check(backNear > 0 && backNear <= 26, `第 ${backNear} 周回到停排前的名次附近（第 ${n(r0.pos)} 名的 1.1 倍以内）`)

  // a man back who only loses gets no place back
  breakOff()
  const riseL = me.pre.rise
  const rL = rankAt(s)
  let worse = true
  for (let k = 0; k < 2; k++) {
    playRanked(s, { chance: () => false } as unknown as Rng)
    if ((rankAt(s).pos ?? Infinity) < (rL.pos ?? 0) || me.pre.rise !== riseL) worse = false
  }
  check(worse, `回来连输 2 点排位：${rankFull(rL)} → ${rankFull(rankAt(s))}，名次一名也没回来，榜单越过他的也没少`)
}

/* ---- 五 ---- */
console.log('\n五、俱乐部看现在的名次：邀请、试训评估、谈判底气、事件、存档卡都按掉过的名次算')
const club = career(7)
{
  const s = club
  const me = s.me!
  lift(s, 70)
  me.week = 30
  me.fans = 0
  me.pre.wasPro = false
  const block = inviteBlock(s)
  check(!block, `探针设置：这周俱乐部能来电话${block ? `（${block}）` : ''}`)
  const snap = { log: me.log.slice(), pending: me.pending.slice(), scout: me.pre.scoutSeen }
  const draws = (ladder: number, rise: number): string[] => {
    const got: string[] = []
    for (let i = 0; i < 200; i++) {
      me.pre.invites = []
      me.log = snap.log.slice()
      me.pending = snap.pending.slice()
      me.pre.scoutSeen = snap.scout
      me.pre.ladder = ladder
      me.pre.rise = rise
      rollInvites(s, new Rng(hashStr(`idle:call:${i}`)))
      got.push(me.pre.invites.map((v) => `${v.via}:${v.teamId}:${v.direct}`).join('|'))
    }
    return got
  }
  const X = 70
  const R = 60
  const Y = scoreFor(s, X, R)
  const calls = (xs: string[]): number => xs.filter(Boolean).length
  const stands = draws(X, 0)
  const slipped = draws(Y, R)
  const stopped = draws(X, BOARD_RISE_MAX)
  const stopRead = rankText(rankAt(like(s, X, BOARD_RISE_MAX)))
  info(`站在 ${rankText(rankAt(like(s, X)))} 的人；分数 ${Y.toFixed(2)}（光看分数 ${rankText(rankAt(like(s, Y)))}）、榜单越过他 ${R} RR 的人；分数 ${X}、榜单越过他 ${BOARD_RISE_MAX} RR 的人（${stopRead}）`)
  check(calls(stands) > 0, `站在那里的人：200 次同样的抽签来了 ${calls(stands)} 个电话`)
  check(slipped.join('\n') === stands.join('\n'), `分数高、名次被超过到同一处的人：来的电话一模一样（${calls(slipped)} 个）——邀请看名次，不看分数`)
  check(calls(stopped) === 0, `分数没变、名次掉到 ${stopRead} 的人：天梯这条路一个电话也没有（${calls(stopped)}）`)

  me.pre.invites = []
  me.pre.ladder = X
  me.pre.rise = 0
  const tStand = tryoutSkill(s)
  me.pre.ladder = Y
  me.pre.rise = R
  const tSlip = tryoutSkill(s)
  me.pre.ladder = X
  me.pre.rise = BOARD_RISE_MAX
  const tStop = tryoutSkill(s)
  check(Math.abs(tSlip - tStand) < 1e-6 && Math.abs(tStop - (tStand - (X - standingOf(s)) * 0.05)) < 1e-6 && tStop < tStand,
    `试训评估（tryoutSkill）读名次：同一处站位 ${tStand.toFixed(2)} = ${tSlip.toFixed(2)}；分数不变、名次掉了 ${tStop.toFixed(2)}`)

  const team = Object.values(s.teams).find((t) => t.tier === 2 && !t.dormant && !t.id.startsWith('CUP_'))!
  const lev = (ladder: number, rise: number): number => {
    me.pre.ladder = ladder
    me.pre.rise = rise
    return makeDeal(s, team.id, 'sign', 'B', new Rng(1)).leverage
  }
  const Z = 90
  const levStand = lev(Z, 0)
  const levSlip = lev(scoreFor(s, Z, R), R)
  const levStop = lev(Z, BOARD_RISE_MAX)
  check(levSlip === levStand && levStop < levStand, `谈判底气（makeDeal）读名次：同一处站位 ${levStand} = ${levSlip}；分数不变、名次掉了 ${levStop}`)

  const ev = (id: string) => EVENTS.find((e) => e.id === id)!
  me.pre.ladder = X
  me.pre.rise = 0
  const dmOn = ev('scout_dm').when(s)
  me.pre.rise = BOARD_RISE_MAX
  const dmOff = ev('scout_dm').when(s)
  check(dmOn && !dmOff, `「青训教练加你」按名次：站在 ${X} 会来，分数 ${X}、名次掉到 ${standingOf(s).toFixed(1)} 那里不来`)

  const meta = buildSaveMeta(s)
  check(!!meta && meta.ladder === ladderLabel(s) && ladderLabel(s) === rankText(rankAt(s)) && (rankAt(s).pos ?? 0) > (rankAt(s, X).pos ?? 0),
    `存档卡读掉过的名次：${meta?.ladder}（光看分数是 ${rankText(rankAt(s, X))}）`)
  const lines = `${rankBar(s, INVITE_LADDER)} / ${rankBar(s, INVITE_LADDER_T1)}`
  me.pre.rise = 0
  check(lines === `${rankBar(s, INVITE_LADDER)} / ${rankBar(s, INVITE_LADDER_T1)}`, `要打到的线不跟着名次动：${lines}`)
}

/* ---- 六 ---- */
console.log('\n六、最高、「前一百」、第一次到达的卡：按真正站到过的名次算')
{
  const s = club
  const me = s.me!
  const p = s.players[me.id]
  const l = scoreAt(300, s)
  me.pre.ladder = l
  me.pre.ladderPeak = l
  me.pre.rise = 0
  for (let w = 0; w < 20; w++) ladderWeekly(s, false)
  check(me.pre.ladderPeak === l, `停排 20 周，最高还是 ${rankText(rankAt(s, me.pre.ladderPeak))}`)
  // his RR has climbed back past the board to the place he held: RR the board as it stood would put in the top 100,
  // at a place that is not — and an even session lifts both a little
  me.pre.ladder = scoreFor(s, l, me.pre.rise ?? 0)
  p.form = 70
  p.fatigue = 30
  playRanked(s, evenRng())
  const held = rankAt(s)
  const raw = rankAt(s, me.pre.ladder)
  const best = rankAt(s, me.pre.ladderPeak)
  const top100 = ACHIEVEMENTS.find((a) => a.key === 'ladder_100')!
  check(me.pre.ladderPeak > l && (raw.pos ?? Infinity) <= 100 && (held.pos ?? 0) > 100 && Math.abs((best.pos ?? 0) - (held.pos ?? 0)) <= 1 && !top100.cond(s),
    `打回来 3 胜 3 负：RR ${raw.rr} 光看分数是 ${rankText(raw)}，实际 ${rankText(held)}；最高记作 ${rankText(best)}，「前一百」没有给`)

  // a tier's first card: the RR of a 辐能战魂 at a place outside the 500 is no 辐能战魂
  const card = (region: Region, rr: number, place: number): { before: string; after: ReturnType<typeof rankAt>; peakRead: string; got: boolean; name: string } => {
    me.region = region
    me.moments = []
    delete me.flags['reached:辐能战魂']
    me.pre.ladder = scoreOfRR(s, rr)
    me.pre.rise = riseTo(s, me.pre.ladder, place)
    me.pre.ladderPeak = standingOf(s)
    const before = rankFull(rankAt(s))
    playRanked(s, evenRng())
    const after = rankAt(s)
    const m = (me.moments ?? []).find((x) => x.kind === 'rank' && x.tier === '辐能战魂')
    return { before, after, peakRead: rankFull(rankAt(s, me.pre.ladderPeak)), got: !!me.flags['reached:辐能战魂'] && !!m, name: m?.rank ?? '' }
  }
  const cn = card('China', 400, 3000)
  check(!cn.after.radiant && !cn.got, `国服：RR 够辐能战魂、名次在第 3,000 名的人打一点排位（${cn.before} → ${rankFull(cn.after)}）：没有「第一次到达辐能战魂」`)
  // 巴西服: 辐能战魂 asks 200 RR, and the 500th on the board as it stands has fewer — a place inside the 500 with the RR of a
  // board that climbed is a 辐能战魂 on the screen, where the best read on the board as it stands is a 神话 3
  const br = card('Brazil', 260, 510)
  check(br.after.radiant && br.got && br.name === br.after.name && !/辐能战魂/.test(br.peakRead),
    `巴西服：名次打进前 500 的那一点排位（${br.before} → ${rankFull(br.after)}）给了「第一次到达${br.name}」，按屏幕上的段位（最高按榜单原样读是 ${br.peakRead}）`)
  me.region = 'China'
  me.moments = []
  me.pre.rise = 0
}

/* ---- 七 ---- */
console.log('\n七、事件里「这周不排位」不再扣分')
{
  const s = club
  const me = s.me!
  me.pre.ladder = 70
  me.pre.rise = 0
  const put = EVENTS.flatMap((e) => e.a).filter((o) => (o.e.ladder ?? 0) < 0)
  info(`会把排位推掉的选项：${put.map((o) => `「${o.t}」`).join('')}`)
  const lines = applyEffect(s, { ladder: -2, mental: 2 })
  check(me.pre.ladder === 70 && me.pre.rise === BOARD_CLIMB && lines.includes(PUT_OFF_CN),
    `神话以上选「这周不排位」（天梯 −2）：分数 70 → ${me.pre.ladder}，榜单越过他 ${me.pre.rise} RR（一周的量），结算写「${lines.join(' · ')}」`)
  applyEffect(s, { ladder: -1 })
  check(me.pre.ladder === 70 && me.pre.rise === BOARD_CLIMB * 1.5, `「今晚不排了」（天梯 −1）：再加半周的量，榜单越过他 ${me.pre.rise} RR`)
  check(describeEffect({ ladder: -2 }, s) === PUT_OFF_CN, `按钮上写「${describeEffect({ ladder: -2 }, s)}」`)
  me.pre.ladder = 30
  me.pre.rise = 0
  const low = applyEffect(s, { ladder: -2 })
  check(me.pre.ladder === 30 && me.pre.rise === 0 && low.length === 0 && describeEffect({ ladder: -2 }, s) === '',
    `神话以下：分数 30 → ${me.pre.ladder}，什么都不掉，按钮上也不写（「${describeEffect({ ladder: -2 }, s)}」）`)
  me.pre.ladder = 70
  const up = applyEffect(s, { ladder: 2 })
  check(me.pre.ladder === 72 && up.includes('天梯 +2'), `多打的（天梯 +2）照旧加分：${me.pre.ladder}`)
  me.pre.rise = 0
}

/* ---- 八 ---- */
console.log('\n八、边上的情况：分数到顶、离队')
{
  const s = club
  const me = s.me!
  const p = s.players[me.id]
  lift(s, 92)
  const target = skillToLadder(p.overall)
  me.pre.ladder = 100
  me.pre.rise = 300
  me.pre.ladderPeak = standingOf(s)
  const r0 = rankAt(s)
  const rng = new Rng(hashStr('top'))
  let top = 0
  for (let week = 1; week <= 20 && !top; week++) {
    for (let k = 0; k < 2; k++) { p.form = 70; p.fatigue = 30; playRanked(s, rng) }
    ladderWeekly(s, true)
    if ((rankAt(s).pos ?? Infinity) <= 3) top = week
  }
  // the settle alone would have left 300 × 0.985^weeks of it
  const settleOnly = 300 * Math.pow(1 - BOARD_SETTLE, top)
  check(top > 0 && top <= 8 && (me.pre.rise ?? 0) < settleOnly * 0.8,
    `综合 ${p.overall.toFixed(1)}（实力对应 ${rankText(rankAt(s, target))}）、分数已经到顶 100、榜单越过他 300 RR：${rankFull(r0)} → 第 ${top} 周 ${rankFull(rankAt(s))}；赢的分用来追榜单，越过他的剩 ${Math.round(me.pre.rise ?? 0)} RR（光靠回落会剩 ${Math.round(settleOnly)}）`)

  // leaving a club: back on the ladder where the skill puts it, less a season off the top, and no RR taken
  const pro = career(11, 'Europe', 'chal')
  const pm = pro.me!
  const pp = pro.players[pm.id]
  lift(pro, 72)
  const floor = clamp(45 + (pp.overall - 60) * 1.7 - 6, 0, 100)
  pm.pre.ladder = floor + 20
  pm.pre.rise = BOARD_RISE_MAX
  const before = pm.pre.ladder
  const standBefore = standingOf(pro)
  leaveClub(pro, 'release')
  check(pm.phase === 'free' && pm.pre.ladder === before && standBefore < floor && Math.abs(standingOf(pro) - floor) < 1e-6,
    `离队的人（综合 ${pp.overall.toFixed(1)}，线在 ${floor.toFixed(1)}）：分数 ${before.toFixed(1)} 没动，站位 ${standBefore.toFixed(1)} → ${standingOf(pro).toFixed(1)}，榜单越过他 ${BOARD_RISE_MAX} → ${Math.round(pm.pre.rise ?? 0)} RR`)
  const q = like(pro, floor - 5, 40)
  standAtLeast(q, floor)
  check(q.me!.pre.ladder === floor && q.me!.pre.rise === 0, `分数在线下的：抬到线上 ${q.me!.pre.ladder.toFixed(1)}，榜单从零算`)
  const hi = like(pro, floor + 10, 0)
  standAtLeast(hi, floor)
  check(hi.me!.pre.ladder === floor + 10 && hi.me!.pre.rise === 0, '站位在线上的：什么都不动')
}

/* ---- 九 ---- */
console.log('\n九、老存档')
{
  const o = JSON.parse(JSON.stringify(club)) as GameState
  o.me!.pre.ladder = 57.3
  o.me!.pre.ladderPeak = 60
  delete (o.me!.pre as { rise?: number }).rise
  const before = ladderLabel(o)
  const back = migratePlayerSave(JSON.parse(JSON.stringify(o)) as GameState)
  check(back.me!.pre.rise === 0 && back.me!.pre.ladder === 57.3 && back.me!.pre.ladderPeak === 60 && ladderLabel(back) === before,
    `没有这个字段的存档：分数 ${back.me!.pre.ladder}、最高 ${back.me!.pre.ladderPeak} 原样，榜单从 ${back.me!.pre.rise} 开始算，读作 ${ladderLabel(back)}`)
  for (const [bad, want] of [[Number.NaN, 0], [null, 0], [-5, 0], [1e6, BOARD_RISE_MAX], [33.5, 33.5]] as [number, number][]) {
    back.me!.pre.rise = bad
    check(migratePlayerSave(back).me!.pre.rise === want, `坏掉的榜单值 ${bad} 读成 ${back.me!.pre.rise}`)
  }
  // the best is a place: a save whose RR is over its best place keeps its best where the place was
  back.me!.pre.ladder = 75
  back.me!.pre.rise = 200
  back.me!.pre.ladderPeak = 55
  const stand = standingOf(back)
  migratePlayerSave(back)
  check(back.me!.pre.ladderPeak === Math.max(55, stand) && back.me!.pre.ladderPeak < 75,
    `分数 75、榜单越过他 200 RR、最高 55 的存档：最高读成 ${back.me!.pre.ladderPeak.toFixed(2)}（站位 ${stand.toFixed(2)}），没抬到分数 75`)
  back.me!.pre.ladder = 57.3
  back.me!.pre.ladderPeak = 60
  back.me!.pre.rise = 0
  let threw = ''
  try {
    for (let i = 0; i < 3; i++) autoWeek(back)
  } catch (e) {
    threw = String(e)
  }
  check(!threw && Number.isFinite(back.me!.pre.ladder) && Number.isFinite(back.me!.pre.rise ?? 0), `读档后接着打 3 周：${threw || ladderLabel(back)}`)
}

console.log(`\n${fails ? `✗ ${fails} 项不对` : '✓ 全部通过'}（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
if (fails) process.exit(1)
