/**
 * 「c不动」 — whether a clearly better player stands out, and whether a cup can
 * be won by one (2026-09-24).
 *
 * The mailbox's most common complaint, in several voices: 「努力训练了还是打不过…
 * c不动」「评分一直在那个区间」「夸张的数据很少」「明星选手的作用被低估了」「网吧赛
 * 公开赛这种比赛分到的队友到后面和对面差距太大，基本打不赢」. Measured first
 * (scratchpad carry-feel_probe): the win curve and the player's own leverage were
 * sound and the same as an NPC's — +20 overall is about +20 points of series won
 * for either — but a night's numbers were one flat band for everybody, and a cup
 * was lost in the later rounds whatever the player was. This keeps what changed:
 *
 *   一、the win curve did not move: the map swing is the same width with the five
 *       nights inside it, the stronger NPC club wins as often by gap as before
 *       (engine/match.ts MAP_SWING, NIGHT_EDGE), and a BO3 goes to the third map
 *       about as often as a real one does
 *   二、a night is a night: a man's 手感 deals him kills and his side rounds — his
 *       rating and his side's map result both follow it
 *   三、a star shows: a 95-overall 决斗者 on a VCT five tops his side's scoreboard
 *       more often than not and has big nights and bad ones; the league's season
 *       numbers stay inside real VCT's range (top K/D, top ACS, the KPR floor)
 *   四、symmetry: what twenty points of overall do for the career's own player's
 *       club is what they do for an NPC's
 *   五、cups: the four I queue with follow my level, the other five do not climb
 *       past the band's top, and a player far above the café takes a cup now and
 *       then while one below it does not (engine/me/cups.ts MATE_TRACK, OPP_FINAL)
 *
 *   npx tsx scripts/check_carry.ts [series=300]
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MeMatch } from '../src/engine/me/matchplay'
import { MapSim, MatchSim, buildLineup, poolFor } from '../src/engine/match'
import { performanceRating } from '../src/engine/performance'
import { Rng, hashStr } from '../src/engine/rng'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, MapLine, Player, Team } from '../src/engine/types'
import { MATE_TRACK, TEMP_MINE, TEMP_OPP, cupFor, dropTempTeams, makePickupMates, mountCupMatch } from '../src/engine/me/cups'

const N = Number(process.argv[2] ?? 300)
let bad = 0
const fail = (m: string) => { bad++; console.log(`  ✗ ${m}`) }
const ok = (cond: boolean, m: string) => { if (cond) console.log(`  ✓ ${m}`); else fail(m) }
const t0 = Date.now()
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} 秒`
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0)
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) }
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y)
  return mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sd(x) * sd(y))
}

function setup(role: Player['role'], seed = 7): { state: GameState; meId: string } {
  const state = createCareer({ name: 'Carry', region: 'EMEA', role, talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed })
  const me = state.me!
  const mine = state.teams[state.myTeam]
  if (!mine.starters.includes(me.id)) mine.starters = [me.id, ...mine.starters.filter((id) => id !== me.id)].slice(0, 5)
  // an ordinary night for everybody: the engine's form/morale/fatigue as it calls ordinary
  for (const p of Object.values(state.players)) { p.form = 70; p.morale = 70; p.fatigue = 20 }
  me.mental = 60
  me.tilt = 0
  return { state, meId: me.id }
}
const strOf = (state: GameState, id: string) => {
  const pool = poolFor(state)
  return pool.reduce((acc, m) => { const L = buildLineup(state, id, m); return acc + (L.atk + L.def) / 2 }, 0) / pool.length
}
/** every attribute moved by the same amount until overall reads `target` */
function setOverall(p: Player, target: number): void {
  for (let it = 0; it < 30 && Math.abs(target - p.overall) >= 0.5; it++) {
    const d = target - p.overall
    for (const k of ATTR_KEYS) p.attrs[k] = Math.max(20, Math.min(99, p.attrs[k] + d))
    recomputeOverall(p)
  }
}
const clubs = (state: GameState): Team[] => Object.values(state.teams).filter((t) => !t.dormant && t.starters.length === 5 && t.roster.length >= 5 && !t.id.startsWith('CUP_'))
const blank = (): MapLine => ({ kills: 0, deaths: 0, assists: 0, damage: 0, firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 0, acs: 0 })
function addLine(t: MapLine, l: MapLine): void {
  for (const k of ['kills', 'deaths', 'assists', 'damage', 'firstKills', 'firstDeaths', 'clutches', 'rounds'] as const) t[k] += l[k]
}

const base = setup('决斗者')

/* ---- 一、the win curve ---- */
{
  console.log(`\n一、胜负曲线没动 · ${secs()}`)
  const { state } = base
  const all = clubs(state).filter((t) => t.id !== state.myTeam)
  const sOf: Record<string, number> = {}
  for (const c of all) sOf[c.id] = strOf(state, c.id)
  // the side's whole swing on a map, rebuilt many times: it is still MAP_SWING (6) wide
  const L = [buildLineup(state, all[0].id, 'Ascent'), buildLineup(state, all[1].id, 'Ascent')]
  const sw: number[] = []
  for (let i = 0; i < 4000; i++) sw.push((new MapSim('Ascent', L[0], L[1], new Rng(hashStr(`carry-sw:${i}`))) as unknown as { swingA: number }).swingA)
  ok(Math.abs(sd(sw) - 6) <= 0.4 && Math.abs(mean(sw)) <= 0.3, `一张图的整体发挥仍是 6 宽：标准差 ${f2(sd(sw))}，均值 ${f2(mean(sw))}`)
  const rng = new Rng(hashStr('carry-curve'))
  const B = [[0, 4], [4, 8], [8, 12], [12, 24]] as const
  const t = B.map(() => ({ n: 0, w: 0, three: 0 }))
  const per = Math.max(150, N)
  for (let i = 0; i < per * 20 && t.some((x) => x.n < per); i++) {
    const a = all[rng.int(0, all.length - 1)].id
    const b = all[rng.int(0, all.length - 1)].id
    if (a === b) continue
    const gap = sOf[a] - sOf[b]
    const k = B.findIndex(([lo, hi]) => Math.abs(gap) >= lo && Math.abs(gap) < hi)
    if (k < 0 || t[k].n >= per) continue
    const r = new MatchSim(state, a, b, 3, new Rng(hashStr(`carry-curve:${i}`))).runOut()
    const strongA = gap >= 0
    t[k].n++
    t[k].w += +((strongA ? r.mapsWonA : r.mapsWonB) > (strongA ? r.mapsWonB : r.mapsWonA))
    t[k].three += +(r.maps.length === 3)
  }
  // measured before 2026-09-24 (600 a bucket): 57.0 / 72.8 / 86.0 / 95.5; after: 57.8 / 71.0 / 84.8 / 96.3
  const want: [number, number][] = [[48, 67], [62, 82], [76, 94], [89, 100]]
  B.forEach(([lo, hi], k) => ok(pct(t[k].w, t[k].n) >= want[k][0] && pct(t[k].w, t[k].n) <= want[k][1],
    `实力差 ${lo}–${hi}：强队赢系列 ${f1(pct(t[k].w, t[k].n))}%（${t[k].n} 场，应在 ${want[k][0]}–${want[k][1]}%）`))
  const n = t.reduce((s, x) => s + x.n, 0)
  const three = t.reduce((s, x) => s + x.three, 0)
  ok(pct(three, n) >= 28 && pct(three, n) <= 46, `BO3 打满三图 ${f1(pct(three, n))}%（真实 VCT 约 35–40%，应在 28–46%）`)
}

/* ---- 二、a night is a night ---- */
{
  console.log(`\n二、手感：一个人的一张图 · ${secs()}`)
  const { state } = base
  const t1 = clubs(state).filter((t) => t.tier === 1)
  const night: number[] = []
  const rating: number[] = []
  const edge: number[] = []
  const won: number[] = []
  for (let i = 0; i < N; i++) {
    const a = t1[i % t1.length].id
    const b = t1[(i * 7 + 3) % t1.length].id
    if (a === b) continue
    const m = new MapSim('Ascent', buildLineup(state, a, 'Ascent', b), buildLineup(state, b, 'Ascent', a), new Rng(hashStr(`carry-night:${i}`)))
    const ids = [...m.A.players, ...m.B.players].map((p) => p.id)
    if (ids.some((id) => typeof m.night[id] !== 'number')) { fail(`第 ${i} 张图有人没有手感`); break }
    m.runOut()
    const res = m.result().score
    for (const id of ids) { night.push(m.night[id]); rating.push(performanceRating(res.lines[id])) }
    const sum = (ps: Player[]) => ps.reduce((s, p) => s + m.night[p.id], 0)
    edge.push(sum(m.A.players) - sum(m.B.players))
    won.push(res.scoreA > res.scoreB ? 1 : 0)
  }
  const cr = corr(night, rating)
  const cw = corr(edge, won)
  ok(Math.abs(mean(night)) < 0.08 && Math.abs(sd(night) - 1) < 0.08, `手感是 N(0,1)：均值 ${f2(mean(night))}，标准差 ${f2(sd(night))}`)
  ok(cr >= 0.3, `手感和这张图的评分同向：相关 ${f2(cr)}（应 ≥0.30）`)
  ok(cw >= 0.15, `五个人的手感和这张图的输赢同向：相关 ${f2(cw)}（应 ≥0.15）`)
}

/* ---- 三 + 四、a star shows, and the same for everybody ---- */
{
  console.log(`\n三、明星：箱子里看得出来 · ${secs()}`)
  const { state, meId } = setup('决斗者')
  const myS = strOf(state, state.myTeam)
  const near = clubs(state).filter((t) => t.id !== state.myTeam)
    .map((t) => ({ id: t.id, gap: myS - strOf(state, t.id) }))
    .sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap)).slice(0, 4)
  const comp = Object.keys(state.comps).find((k) => state.comps[k]?.region) ?? ''
  const snapP = JSON.stringify(state.players[meId])
  const snapMe = JSON.stringify(state.me)
  const levels: Record<number, { w: number; rt: number[]; acs: number[]; r1: number }> = {}
  for (const lv of [70, 90, 95]) {
    const L = levels[lv] = { w: 0, rt: [] as number[], acs: [] as number[], r1: 0 }
    for (let i = 0; i < N; i++) {
      state.players[meId] = JSON.parse(snapP)
      state.me = JSON.parse(snapMe)
      setOverall(state.players[meId], lv)
      const rec = new MeMatch(state, { aId: state.myTeam, bId: near[i % near.length].id, bo: 3, comp, label: `carry-star:${i}` }).runOut()
      L.w += +rec.won
      if (!rec.started) continue
      L.rt.push(rec.rating)
      L.acs.push(rec.acs)
      L.r1 += +(rec.rank === 1)
    }
  }
  state.players[meId] = JSON.parse(snapP)
  state.me = JSON.parse(snapMe)
  const s95 = levels[95]
  // before 2026-09-24 (600 BO3s): 1.16 rating, sd 0.15, 243 ACS, top of his side 53.3%; after: 1.23, 0.20, 260, 55.8%
  ok(mean(s95.rt) >= 1.18, `综合 95 的决斗者平均评分 ${f2(mean(s95.rt))}（应 ≥1.18）`)
  ok(pct(s95.r1, s95.rt.length) >= 48, `综合 95 在本队评分第一 ${f1(pct(s95.r1, s95.rt.length))}% 的场次（应 ≥48%）`)
  ok(sd(s95.rt) >= 0.17, `综合 95 一场系列赛的评分起伏 ${f2(sd(s95.rt))}（应 ≥0.17，原来 0.15）`)
  ok(mean(s95.acs) >= 250, `综合 95 的平均 ACS ${f1(mean(s95.acs))}（应 ≥250）`)
  ok(mean(levels[90].rt) - mean(levels[70].rt) >= 0.2, `综合 70 → 90 平均评分 ${f2(mean(levels[70].rt))} → ${f2(mean(levels[90].rt))}（差应 ≥0.20）`)

  // the league's season numbers stay where real VCT's are
  const t1 = clubs(state).filter((t) => t.tier === 1 && t.id !== state.myTeam)
  const byReg: Record<string, Team[]> = {}
  for (const t of t1) (byReg[t.region] ??= []).push(t)
  const tot: Record<string, MapLine> = {}
  const rng = new Rng(hashStr('carry-season'))
  let k = 0
  for (const list of Object.values(byReg)) {
    if (list.length < 4) continue
    for (let g = 0; g < list.length * 16; g++) {
      const a = list[rng.int(0, list.length - 1)].id
      const b = list[rng.int(0, list.length - 1)].id
      if (a === b) continue
      const r = new MatchSim(state, a, b, 3, new Rng(hashStr(`carry-season:${k++}`))).runOut()
      for (const m of r.maps) for (const [id, l] of Object.entries(m.lines)) addLine(tot[id] ??= blank(), l)
    }
  }
  const rows = Object.values(tot).filter((l) => l.rounds >= 400)
  const kd = rows.map((l) => l.kills / Math.max(1, l.deaths))
  const acs = rows.map((l) => (l.damage / l.rounds) * 1.45)
  const kpr = rows.map((l) => l.kills / l.rounds)
  // real VCT: a season's top K/D about 1.3–1.45, its top ACS 250–270 and past 280 over an event, the lowest
  // regular's KPR about 0.5. Before 2026-09-24 this world topped out at 1.25 and 235: stars did not show
  ok(Math.max(...kd) <= 1.5 && Math.max(...kd) >= 1.25, `联赛赛季最高 K/D ${f2(Math.max(...kd))}（应在 1.25–1.50）`)
  ok(Math.max(...acs) <= 285 && Math.max(...acs) >= 240, `联赛赛季最高 ACS ${f1(Math.max(...acs))}（应在 240–285）`)
  ok(Math.min(...kpr) >= 0.42, `联赛赛季最低 KPR ${f2(Math.min(...kpr))}（应 ≥0.42）`)

  console.log(`\n四、对称：你和 NPC 一样 · ${secs()}`)
  // the same twenty points on an NPC of an NPC club, NPC against NPC
  const pairs: [string, string][] = []
  const sOf: Record<string, number> = {}
  for (const c of t1) sOf[c.id] = strOf(state, c.id)
  const prng = new Rng(hashStr('carry-pairs'))
  for (let g = 0; g < 4000 && pairs.length < 12; g++) {
    const a = t1[prng.int(0, t1.length - 1)].id
    const b = t1[prng.int(0, t1.length - 1)].id
    if (a !== b && Math.abs(sOf[a] - sOf[b]) < 2) pairs.push([a, b])
  }
  const snap = JSON.stringify(state.players)
  const npcWin: Record<number, number> = {}
  for (const X of [70, 90]) {
    let w = 0
    for (let i = 0; i < N; i++) {
      const [a, b] = pairs[i % pairs.length]
      state.players = JSON.parse(snap)
      const star = state.teams[a].starters.map((id) => state.players[id]).sort((x, y) => y.attrs.aim - x.attrs.aim)[0]
      setOverall(star, X)
      const r = new MatchSim(state, a, b, 3, new Rng(hashStr(`carry-npc:${i}`))).runOut()
      w += +(r.mapsWonA > r.mapsWonB)
    }
    npcWin[X] = pct(w, N)
  }
  state.players = JSON.parse(snap)
  const mine = pct(levels[90].w, N) - pct(levels[70].w, N)
  const npc = npcWin[90] - npcWin[70]
  ok(mine >= 10 && npc >= 10 && Math.abs(mine - npc) <= 14,
    `综合 70 → 90：你的队系列赛胜率 +${f1(mine)}，NPC 的队 +${f1(npc)}（都应 ≥10，差不超过 14）`)
}

/* ---- 五、cups ---- */
{
  console.log(`\n五、杯赛：队友跟着你走，对面不再越过签表的顶 · ${secs()}`)
  const runs = Math.max(60, Math.floor(N / 2))
  const champ: Record<string, Record<number, number>> = {}
  const mates: Record<number, number[]> = {}
  const finals: Record<string, number[]> = {}
  for (const ovr of [55, 85]) {
    const state = createCareer({ name: 'Cup', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 11 })
    const me = state.me!
    setOverall(state.players[me.id], ovr)
    const snapP = JSON.stringify(state.players[me.id])
    const snapMe = JSON.stringify(state.me)
    for (const key of ['city', 'premier', 'open']) {
      const cup = cupFor(state, key)!
      let won = 0
      for (let i = 0; i < runs; i++) {
        state.players[me.id] = JSON.parse(snapP)
        state.me = JSON.parse(snapMe)
        const rng = new Rng(hashStr(`carry-cup:${ovr}:${key}:${i}`))
        const pick = makePickupMates(state, cup, rng)
        ;(mates[ovr] ??= []).push(...pick.map((m) => m.overall))
        state.me!.pre.cup = { key, round: 0, alive: true, mates: pick, results: [], next: state.day, year: state.year }
        let alive = true
        for (let r = 0; r < cup.rounds.length && alive; r++) {
          state.players[me.id].fatigue = 20
          state.players[me.id].form = 70
          const m = mountCupMatch(state, cup, r, rng)
          if (r === cup.rounds.length - 1) (finals[key] ??= []).push(mean(state.teams[TEMP_OPP].starters.map((id) => state.players[id].overall)))
          alive = new MeMatch(state, { aId: TEMP_MINE, bId: TEMP_OPP, bo: m.bo, comp: cup.name, label: `${m.label}:${i}` }).runOut().won
          dropTempTeams(state)
        }
        won += +alive
      }
      ;(champ[key] ??= {})[ovr] = pct(won, runs)
    }
  }
  const dm = mean(mates[85]) - mean(mates[55])
  ok(Math.abs(dm - 30 * MATE_TRACK) <= 3, `队友跟着你的水平走：你 55 → 85，队友平均 ${f1(mean(mates[55]))} → ${f1(mean(mates[85]))}（应差约 ${f1(30 * MATE_TRACK)}）`)
  // before 2026-09-24 (100 runs a cup): an 85 won 4 / 0 / 1%, a 55 won 0 / 1 / 1%
  for (const key of ['city', 'premier', 'open']) {
    const c = champ[key]
    const cup = cupFor(base.state, key)!
    // before 2026-09-24 the final's five averaged about two over the band's top
    ok(mean(finals[key]) <= cup.band[1] - 1, `${cup.name}决赛的对手平均综合 ${f1(mean(finals[key]))}（签表 ${cup.band[0]}–${cup.band[1]}，应不超过 ${cup.band[1] - 1}）`)
    ok(c[85] >= 12 && c[55] <= 4, `${cupFor(base.state, key)!.name}：综合 85 夺冠 ${f1(c[85])}%（应 ≥12），综合 55 夺冠 ${f1(c[55])}%（应 ≤4）`)
  }
}

console.log(`\n${bad ? `✗ ${bad} 项没过` : '✓ 全部通过'} · ${secs()}`)
process.exit(bad ? 1 : 0)
