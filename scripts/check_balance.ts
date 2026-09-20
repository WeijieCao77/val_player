/**
 * 数值的那把尺子 — the rules the 2026-09-20 rebalance put in, so they cannot drift back out.
 *
 * The author's brief that day, after scripts/probe_balance.ts measured where the game stood:
 * 「这些都要改，然后我希望达到的效果是比现在游戏容易但是比破晓难度大……明星选手的数值也要增长的高于
 * 普通选手而不是让那些不知名选手分数达到 90+。还有就是取消掉锁……我需要一些数值随年龄下降的更明显一些，
 * 不能三十岁了还是枪法大师这样……练习的勤奋或者天赋好那就下滑慢一点或者稳定住，但是随着年龄增大怎么样
 * 最终都会是下滑的」, and 「年轻的时候提升的快一点，老了就慢一点」.
 *
 * 一 the year's re-rating moves a man at most ratingStep(age) — measured on a running 2021 world by
 *    cloning the week before the turn and running the book path alone, the way probe_balance does
 * 二 no freeze: the people at the player's own club are re-rated with everybody else, so nothing is
 *    owed and paid in one step the year they leave
 * 三 growth favours the people this world has something on: a full season at a side it rates beats a
 *    benched name at the same side, and a big club cannot carry a man who is not playing (STAND_CARRY)
 * 四 the age curve: which attribute turns when, that the turn is never undone by work or talent
 *    (HOLD_MAX < 1), and that the slope steepens rather than flattening out
 * 五 what a week of practice is worth falls with age and reaches zero, and never rises
 * 六 the difficulty band, as a band and not a seed: where an ordinary full career ends, and that the
 *    world's best is still clear of it
 *
 *   npx tsx scripts/check_balance.ts [runs] [years]
 */
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

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { syncYear } from '../src/engine/timeline'
import { ratingStep, STEP_KNOTS } from '../src/engine/timeline'
import { FALL_MAX, HOLD_MAX, LATE_FROM, TURN, attrDrift, holdOff, trainAgeMul } from '../src/engine/age'
import { REVISE_LO, REVISE_SPAN, STAND_HI, STAND_LO, standingShare, seasonRollover } from '../src/engine/training'
import { Rng, hashStr } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, Player, Region, Role, Team } from '../src/engine/types'

const t0 = Date.now()
let fails = 0
const ok = (good: boolean, what: string) => {
  console.log(`  ${good ? '✓' : '✗'} ${what}`)
  if (!good) fails++
}
const med = (xs: number[]): number => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState

const RUNS = Number(process.argv[2] ?? 3)
const YEARS = Number(process.argv[3] ?? 7)

/* ------------------------------------------------------ 一 + 二 the book, on a running world */

console.log('一 每年的重评：幅度有上限，而且队里的人也参与')
{
  const state = createCareer({
    name: 'Cap', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'net', start: 'chal', seed: 4242, year: 2021,
  })
  const me = state.me!
  let over = 0
  let overSaid = ''
  let moved = 0
  let held = 0
  let mates = 0
  let matesMoved = 0
  let turns = 0
  let weeks = 0
  const y0 = state.year
  // 2021 → 2026: every year of the book, measured on its own by cloning the week before the turn
  while (state.year < y0 + 5 && me.phase !== 'retired' && weeks < 5 * 60) {
    const yr = state.year
    const before = clone(state)
    const stop = autoWeek(state)
    weeks++
    if (state.year !== yr) {
      turns++
      const after = clone(before)
      after.year = yr + 1
      syncYear(after, yr + 1)
      const mine = new Set(before.teams[before.myTeam]?.roster ?? [])
      for (const p of Object.values(after.players)) {
        const b = before.players[p.id]
        if (!b || p.id === after.me?.id || !/^V\d+$/.test(p.id)) continue
        const d = Math.abs(p.overall - b.overall)
        // one point of slack: the eight are each moved at most `step`, and the weighted sum of them is rounded
        const cap = ratingStep(b.age) + 1
        if (d > cap) { over++; if (!overSaid) overSaid = `${b.ign} ${b.age} 岁 ${b.overall} → ${p.overall}（上限 ${cap}）` }
        if (d > 0) moved++
        else held++
        if (mine.has(p.id)) { mates++; if (p.overall !== b.overall || ATTR_KEYS.some((k) => p.attrs[k] !== b.attrs[k])) matesMoved++ }
      }
    }
    if (stop.kind === 'game-over') break
  }
  console.log(`  ${turns} 个年关，动了 ${moved} 人次、没动 ${held} 人次；其中我队里的 ${mates} 人次，动了 ${matesMoved}`)
  ok(turns >= 3, `跑到了 ${turns} 个年关（要 ≥3，不然这一节什么都没量到）`)
  ok(over === 0, `没有人一年跳超过 ratingStep：${over} 次${overSaid ? `，例如 ${overSaid}` : ''}`)
  ok(moved > 0, '书确实还在改人的数值')

  console.log('二 锁取消了：我队里的人和别人一样参与重评')
  ok(mates > 0, `年关时我队里有 ${mates} 人次被书评到（要 >0，否则这一条没量到）`)
  ok(matesMoved / Math.max(1, mates) >= 0.5, `我队里被书评到的人有 ${(100 * matesMoved / Math.max(1, mates)).toFixed(0)}% 在年关动了（要 ≥50%；以前是 0%，全部攒到离队那年一次付清）`)
}

/* ------------------------------------------------------ 三 who grows */

console.log('三 成长偏向这个世界已经有证据的人')
{
  const team = (id: string, rating: number, tier: 1 | 2): Team =>
    ({ id, name: id, rating, tier, roster: [], starters: [], facilities: 60, coach: null, dormant: false } as unknown as Team)
  const guy = (id: string, rounds: number, kills: number): Player => ({
    id, ign: id, teamId: 'big', age: 21, isIgl: false, role: '决斗者' as Role, region: 'EMEA' as Region,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, 78])) as Attrs, overall: 78, potential: 84,
    form: 70, morale: 75, fatigue: 20, salary: 0, value: 0, contractYears: 2, loyalty: 60, ambition: 60,
    xp: {} as Record<keyof Attrs, number>, injuredUntil: 0, career: { maps: 0, clutches: 0 },
    season: { maps: 24, rounds, kills, deaths: Math.round(rounds * 0.62), assists: Math.round(rounds * 0.3), firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 },
  } as unknown as Player)

  const st = { teams: { big: team('big', 92, 1), small: team('small', 72, 2) }, training: {}, players: {} } as unknown as GameState
  const playing = guy('playing', 900, 810)            // 1.25-ish over a full season
  const benched = guy('benched', 20, 12)              // at the same club, never on the field
  const poorClub = guy('poorClub', 900, 810)
  poorClub.teamId = 'small'
  const bad = guy('bad', 900, 500)                    // a full season, a poor line

  const s = (p: Player) => standingShare(st, p)
  console.log(`  站位分：强队打满 ${s(playing).toFixed(2)} · 强队坐板凳 ${s(benched).toFixed(2)} · 弱队打满 ${s(poorClub).toFixed(2)} · 强队但数据差 ${s(bad).toFixed(2)}`)
  ok(s(playing) > s(benched) + 0.2, '同一家强队里，打满一个赛季的人明显高于没上场的人')
  ok(s(benched) < s(poorClub), '强队的板凳低于弱队里打满赛季的人 —— 俱乐部抬不动一个没上场的人（STAND_CARRY）')
  ok(s(bad) < s(playing) - 0.2, '同一家强队里，数据差的人明显低于数据好的人')
  ok(s(playing) <= 1 && s(benched) >= 0, '站位分落在 0…1')
  ok(STAND_LO < 1 && STAND_HI > 1, `成长倍率跨过 1（${STAND_LO}…${STAND_HI}），所以它是分配而不是整体加速`)
  ok(REVISE_LO + REVISE_SPAN > REVISE_LO * 2, `潜力重评的概率随证据拉开（${REVISE_LO} → ${(REVISE_LO + REVISE_SPAN).toFixed(2)}）`)
}

/* ------------------------------------------------------ 四 the age curve */

console.log('四 年龄曲线：拐点、越来越陡、压得慢但压不成正的')
{
  ok(TURN.reaction <= 24 && TURN.aim <= 25, `手先走：反应 ${TURN.reaction} 岁、枪法 ${TURN.aim} 岁`)
  ok(TURN.awareness >= 28 && TURN.communication >= 28 && TURN.igl >= 29,
    `读比赛的后走：意识 ${TURN.awareness}、沟通 ${TURN.communication}、指挥 ${TURN.igl}`)
  for (const k of ['aim', 'reaction', 'clutch'] as (keyof Attrs)[]) {
    ok(TURN[k] < TURN.awareness && TURN[k] < TURN.igl, `${k} 的拐点早于意识和指挥`)
  }
  ok(LATE_FROM <= TURN.awareness, '「枪不行了但会打」那扇窗在意识开始掉之前')

  let positive = 0
  let notSteeper = 0
  for (const k of ATTR_KEYS) {
    let last = 0
    for (let age = TURN[k]; age <= 45; age++) {
      const d = attrDrift({ age, isIgl: true }, k)
      // the most anyone can hold off, and it still has to be a fall
      if (d * (1 - HOLD_MAX) >= 0) positive++
      if (age > TURN[k] && d > last && Math.abs(last) < FALL_MAX) notSteeper++
      last = d
    }
  }
  ok(positive === 0, '拐点之后，就算把勤奋和天赋都拉满，这一项也一定在掉（HOLD_MAX < 1）')
  ok(notSteeper === 0, '拐点之后每往后一岁掉得更多，直到封顶')
  ok(HOLD_MAX < 1, `压慢的上限 ${HOLD_MAX} < 1`)

  // and the same thing on a real pair of careers: one who practises what he is built for, one who does neither
  const make = (id: string, top: keyof Attrs): Player => ({
    id, ign: id, teamId: 'T', age: 22, isIgl: false, role: '决斗者' as Role, region: 'EMEA' as Region,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, k === top ? 88 : 74])) as Attrs,
    overall: 80, potential: 92, form: 70, morale: 75, fatigue: 20, salary: 0, value: 0,
    contractYears: 2, loyalty: 60, ambition: 60, xp: {} as Record<keyof Attrs, number>,
    injuredUntil: 0, career: { maps: 0, clutches: 0 },
    season: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 },
  } as unknown as Player)
  const dAim: number[] = []
  const lAim: number[] = []
  for (let seed = 0; seed < 120; seed++) {
    const d = make('D', 'aim')
    const l = make('L', 'utility')
    const st = { year: 2030, seed, players: { D: d, L: l }, teams: {}, myTeam: '', training: { D: 'aim', L: 'rest' } } as unknown as GameState
    for (let y = 0; y < 8; y++) seasonRollover(st, new Rng(hashStr(`bal:${seed}:${y}`)))
    dAim.push(d.attrs.aim)
    lAim.push(l.attrs.aim)
  }
  console.log(`  30 岁的枪法：勤练+天赋 ${mean(dAim).toFixed(1)}（起点 88）· 混日子、又不是长项 ${mean(lAim).toFixed(1)}（起点 74）`)
  ok(mean(dAim) < 88, '勤奋的那个也掉了 —— 没有人能停在原地')
  ok(88 - mean(dAim) < 74 - mean(lAim), '勤练、又正好是长项的那一项，掉得比不练、又不是长项的少')
  ok(88 - mean(dAim) >= 1.5, `三十岁不再是枪法大师：勤奋的人也掉了 ${(88 - mean(dAim)).toFixed(1)} 点`)
}

/* ------------------------------------------------------ 五 what practice is worth */

console.log('五 年轻长得快、老了长得慢')
{
  let rises = 0
  for (let a = 16; a < 40; a++) if (trainAgeMul(a + 1) > trainAgeMul(a) + 1e-9) rises++
  ok(rises === 0, '一周训练的价值随年龄单调不增')
  ok(trainAgeMul(17) >= trainAgeMul(24) * 1.9, `17 岁 ${trainAgeMul(17).toFixed(2)} 至少是 24 岁 ${trainAgeMul(24).toFixed(2)} 的两倍`)
  ok(trainAgeMul(35) === 0, '到了某个年纪，练也练不动了')
  ok(trainAgeMul(17) > 1.4 && trainAgeMul(30) < 0.4, `17 岁 ${trainAgeMul(17).toFixed(2)}、30 岁 ${trainAgeMul(30).toFixed(2)}`)
  ok(STEP_KNOTS[0][1] > STEP_KNOTS[STEP_KNOTS.length - 1][1], `年轻人的重评幅度更宽：${ratingStep(18)} 岁到 ${ratingStep(30)}`)
  const one = { id: 'X', attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, k === 'aim' ? 90 : 70])) } as unknown as Player
  ok(holdOff({ training: { X: 'aim' } } as unknown as GameState, one, 'aim') > holdOff({ training: {} } as unknown as GameState, one, 'aim'),
    '正在练的那一项，掉得更慢')
  ok(holdOff({ training: { X: 'aim' } } as unknown as GameState, one, 'aim') <= HOLD_MAX, '压慢不超过上限')
}

/* ------------------------------------------------------ 六 the band */

console.log(`六 难度区间（${RUNS} 局托管 × ${YEARS} 个赛季，宽带，不是某一个种子）`)
{
  const REGIONS: Region[] = ['EMEA', 'Americas', 'Pacific']
  const ends: number[] = []
  const caps: number[] = []
  let worldBest = 0
  let vctMed = 0
  for (let i = 0; i < RUNS; i++) {
    const state = createCareer({
      name: `Band${i}`, region: REGIONS[i % REGIONS.length], role: '决斗者',
      talents: emptyTalents(), originKey: 'net', start: i % 2 ? 't1' : 'chal', seed: 3100 + i * 211, year: 2026,
    })
    const me = state.me!
    const p = state.players[me.id]
    const y0 = state.year
    let weeks = 0
    while (state.year < y0 + YEARS && me.phase !== 'retired' && weeks < YEARS * 60) {
      const stop = autoWeek(state)
      weeks++
      if (stop.kind === 'game-over') break
    }
    ends.push(p.overall)
    caps.push(p.potential)
    const starters: number[] = []
    for (const t of Object.values(state.teams)) {
      if (t.dormant || t.tier !== 1) continue
      for (const o of t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)) starters.push(o)
    }
    worldBest = Math.max(worldBest, ...Object.values(state.players).filter((q) => q.id !== me.id).map((q) => q.overall))
    vctMed = med(starters)
  }
  const m = med(ends)
  console.log(`  终局综合 ${ends.slice().sort((a, b) => a - b).join(' ')}（中位 ${m}）· 上限中位 ${med(caps)} · 世界最高 ${worldBest} · VCT 首发中位 ${vctMed}`)
  ok(m >= 84 && m <= 93, `打满 ${YEARS} 个赛季的托管生涯，终局综合中位 ${m} 落在 84–93（比改之前的 84 高，离破晓的「超过所有职业选手」还远）`)
  ok(worldBest >= m + 2, `世界最高 ${worldBest} 仍然在中位生涯 ${m} 之上（差 ${worldBest - m}）`)
  ok(vctMed >= 80 && vctMed <= 89, `VCT 首发中位 ${vctMed} 落在 80–89 —— 世界没有被这次调整抬起来或压下去`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log(fails
  ? `\n✗ ${fails} 项不对 · ${secs}s`
  : `\n✓ 重评有上限且队里的人也参与，成长偏向有证据的人，年龄拐点和「压得慢但压不成正的」都在，练的价值随年龄下降到零，难度落在区间里 · ${secs}s`)
process.exit(fails ? 1 : 0)
