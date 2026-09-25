/**
 * 评分、MVP 和选手榜 hold what the 2026-09-25 mailbox asked for.
 *
 * 「我主玩的决斗，一年四冠，acs240还只能排在末位」(14 votes) 「我杀46第三 36的是第一」
 * 「250acs倒四」「决斗太难拿mvp了」「杀人的评分也太低了」「除决斗位的其他位置首杀高得
 * 不正常」. Measured before the change over 600 NPC tier-1 BO3s (scratchpad
 * match-rating_probe): a 控场 took 18.5% of his side's openings, the side that won a
 * round took every one of them, rating followed ACS at 0.82, a side's top fragger
 * was not its top-rated 32% of the time, and the MVP was not the winners' top ACS
 * 37% of the time. This pins the shape that replaced it, with bounds, over NPC
 * matches only — the same engine the career's own player plays in:
 *
 *  一 openings: 决斗者 take the largest share of a side's first kills, 控场 the
 *     smallest; the side that draws first blood wins most rounds, not all
 *  二 the rating reads a scoreboard the way a VLR rating does: it follows ACS and
 *     kills, a side's top fragger is nearly always its top-rated, the roles'
 *     averages sit a little apart and none runs away
 *  三 MVP: nearly always a winner's, usually the winners' top ACS, and a 决斗者 is
 *     not locked out of it
 *  四 选手榜: rating first, the season's titles and series MVPs on top, by the
 *     sizes in engine/leaderboard.ts; qualifiers are not titles; the rule is on
 *     the screen in words
 *
 *   npx tsx scripts/check_rating_fair.ts [series=400]
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MapSim, MatchSim, buildLineup } from '../src/engine/match'
import { ROLE_PAR, UNDER_PAR, aggregateLines, performanceRating, underPar } from '../src/engine/performance'
import { AWARD_RULE, BOARD_MVP, BOARD_MVP_MAX, BOARD_RULE, BOARD_TITLE, boardLine, boardScore } from '../src/engine/leaderboard'
import { computeAwards, leaguePool } from '../src/engine/me/nights'
import { mvpNote } from '../src/engine/me/postmatch'
import { Rng, hashStr } from '../src/engine/rng'
import { emptyStats } from '../src/engine/types'
import type { MapLine, Player, Role, Team } from '../src/engine/types'

const N = Number(process.argv[2] ?? 400)
let bad = 0
const ok = (cond: boolean, m: string) => { console.log(`  ${cond ? '✓' : '✗'} ${m}`); if (!cond) bad++ }
const t0 = Date.now()
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) }
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); return mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sd(x) * sd(y)) }
const pc = (v: number) => `${(100 * v).toFixed(1)}%`
const f2 = (v: number) => v.toFixed(2)

const state = createCareer({ name: 'RatingFair', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
for (const p of Object.values(state.players)) { p.form = 70; p.morale = 70; p.fatigue = 20 }
const clubs = Object.values(state.teams).filter((t) => !t.dormant && t.tier === 1 && t.starters.length === 5 && t.id !== state.myTeam && !t.id.startsWith('CUP_'))
const byReg: Record<string, Team[]> = {}
for (const t of clubs) (byReg[t.region] ??= []).push(t)
const regs = Object.values(byReg).filter((l) => l.length >= 4)
if (!regs.length) throw new Error('这份世界里没有能打的一线赛区')

const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
const R: Record<string, { n: number; rt: number[]; fkShare: number[]; fkpr: number[]; mvp: number }> = {}
for (const r of ROLES) R[r] = { n: 0, rt: [], fkShare: [], fkpr: [], mvp: 0 }
const allRt: number[] = [], allAcs: number[] = []
let series = 0, teams = 0, fragFirst = 0, fragThird = 0, fragTeams = 0, mvpWin = 0, mvpTopAcs = 0
const rng = new Rng(hashStr('rating-fair'))
for (let i = 0; i < N; i++) {
  const list = regs[i % regs.length]
  const a = list[rng.int(0, list.length - 1)].id, b = list[rng.int(0, list.length - 1)].id
  if (a === b) { i--; continue }
  const r = new MatchSim(state, a, b, 3, new Rng(hashStr(`rating-fair:${i}`))).runOut()
  series++
  const tot = aggregateLines(r.maps)
  const sides = [r.lineups?.a ?? [], r.lineups?.b ?? []]
  const winIds = r.mapsWonA > r.mapsWonB ? sides[0] : sides[1]
  for (const ids of sides) {
    teams++
    const played = ids.filter((id) => tot[id]?.rounds)
    const teamFk = played.reduce((s, id) => s + tot[id].firstKills, 0)
    const rows = played.map((id) => ({ id, rt: performanceRating(tot[id]), k: tot[id].kills })).sort((x, y) => y.rt - x.rt)
    const most = Math.max(...rows.map((x) => x.k))
    if (rows.filter((x) => x.k === most).length === 1) {
      fragTeams++
      const pos = rows.findIndex((x) => x.k === most)
      if (pos === 0) fragFirst++
      if (pos >= 2) fragThird++
    }
    for (const x of rows) {
      const role = state.players[x.id].role
      allRt.push(x.rt); allAcs.push(tot[x.id].acs)
      const e = R[role]; if (!e) continue
      e.n++; e.rt.push(x.rt); e.fkpr.push(tot[x.id].firstKills / tot[x.id].rounds)
      if (teamFk) e.fkShare.push(tot[x.id].firstKills / teamFk)
    }
  }
  if (r.mvp) {
    if (R[state.players[r.mvp].role]) R[state.players[r.mvp].role].mvp++
    if (winIds.includes(r.mvp)) mvpWin++
    const top = winIds.filter((id) => tot[id]?.rounds).sort((x, y) => tot[y].acs - tot[x].acs)[0]
    if (top === r.mvp) mvpTopAcs++
  }
}
console.log(`${series} 场一线 BO3（NPC 对 NPC）`)
for (const r of ROLES) {
  const e = R[r]
  console.log(`  ${r}：${e.n} 人次，评分 ${f2(mean(e.rt))}，首杀占全队 ${pc(mean(e.fkShare))}（每回合 ${mean(e.fkpr).toFixed(3)}），每人次 MVP ${pc(e.mvp / e.n)}`)
}

console.log('\n一、首杀：')
ok(mean(R['决斗者'].fkShare) >= 0.26 && mean(R['决斗者'].fkShare) <= 0.36, `决斗者拿全队首杀的 ${pc(mean(R['决斗者'].fkShare))}（真实 VCT 约三成；应在 26–36%）`)
ok(mean(R['控场'].fkShare) >= 0.08 && mean(R['控场'].fkShare) <= 0.15, `控场拿全队首杀的 ${pc(mean(R['控场'].fkShare))}（改前 18.5%；应在 8–15%）`)
ok(mean(R['控场'].fkpr) <= 0.075, `控场每回合首杀 ${mean(R['控场'].fkpr).toFixed(3)}（改前 0.093；应不高于 0.075）`)
ok(ROLES.every((r) => r === '决斗者' || mean(R[r].fkShare) < mean(R['决斗者'].fkShare)), '决斗者的首杀份额比其他每个位置都高')
// first blood and the round: round by round on a few maps
let rounds = 0, fbWon = 0
for (let i = 0; i < 40; i++) {
  const list = regs[i % regs.length]
  const a = list[i % list.length].id, b = list[(i + 1) % list.length].id
  const sim = new MapSim('Ascent', buildLineup(state, a, 'Ascent', b), buildLineup(state, b, 'Ascent', a), new Rng(hashStr(`rating-fair-fb:${i}`)))
  const aIds = new Set(sim.A.players.map((p) => p.id))
  while (!sim.over) {
    const before = Object.fromEntries(Object.entries(sim.lines).map(([id, l]) => [id, l.firstKills]))
    sim.playRound()
    const opener = Object.keys(sim.lines).find((id) => sim.lines[id].firstKills > before[id])
    if (!opener) continue
    rounds++
    if (aIds.has(opener) === (sim.rounds[sim.rounds.length - 1].winner === 'A')) fbWon++
  }
}
ok(fbWon / rounds >= 0.65 && fbWon / rounds <= 0.8, `拿到首杀的一方赢下这回合 ${pc(fbWon / rounds)}（${rounds} 回合；改前 100%，真实约七成；应在 65–80%）`)

console.log('\n二、评分跟着击杀和 ACS：')
const c = corr(allRt, allAcs)
ok(c >= 0.85, `评分和 ACS 的相关 ${f2(c)}（改前 0.82；应不低于 0.85）`)
ok(fragFirst / fragTeams >= 0.72, `一方击杀最多的人是本方评分第一 ${pc(fragFirst / fragTeams)}（改前约 68%；应不低于 72%）`)
ok(fragThird / fragTeams <= 0.07, `一方击杀最多的人评分排到本方第三或更后 ${pc(fragThird / fragTeams)}（改前约 11%；应不高于 7%）`)
const means = ROLES.map((r) => mean(R[r].rt))
ok(means.every((m) => m >= 0.93 && m <= 1.1), `四个位置的平均评分都在 0.93–1.10（${ROLES.map((r, i) => `${r} ${f2(means[i])}`).join('、')}）`)
const gap = mean(R['决斗者'].rt) - mean(R['控场'].rt)
ok(gap >= 0.03 && gap <= 0.15, `决斗者比控场平均高 ${f2(gap)}（改前 −0.01；应在 0.03–0.15，别反过来一边倒）`)
ok(Math.abs(mean(allRt) - 1) <= 0.03, `一线平均评分 ${f2(mean(allRt))}（应在 1.00 ± 0.03）`)
// the coach's 「表现不合格」 is under the role's own par (me/coach.ts); the par has to be what the engine plays
ok(ROLES.every((r) => Math.abs(ROLE_PAR[r] - mean(R[r].rt)) <= 0.03),
  `教练用的各位置基准和实际平均相差不超过 0.03（${ROLES.map((r) => `${r} ${f2(ROLE_PAR[r])}/${f2(mean(R[r].rt))}`).join('、')}）`)
ok(underPar(0.94, '控场') === false && underPar(0.94, '决斗者') === true && underPar(0.94, undefined) === true && underPar(0.96, undefined) === false,
  `同样 0.94：控场不算不合格（基准 ${ROLE_PAR['控场']}），决斗者算（基准 ${ROLE_PAR['决斗者']}）；不知道位置时按 1.00 − ${UNDER_PAR}`)

console.log('\n三、MVP：')
ok(mvpWin / series >= 0.88, `MVP 出自胜方 ${pc(mvpWin / series)}（应不低于 88%）`)
ok(mvpTopAcs / series >= 0.68, `MVP 就是胜方 ACS 最高的人 ${pc(mvpTopAcs / series)}（改前 63%；应不低于 68%）`)
const perSlot = (r: Role) => R[r].mvp / R[r].n
ok(perSlot('决斗者') >= 0.13 && ROLES.every((r) => perSlot('决斗者') >= perSlot(r)), `决斗者每人次拿 MVP ${pc(perSlot('决斗者'))}，不低于任何位置（改前 11.5%，应不低于 13%）`)
ok(ROLES.every((r) => perSlot(r) >= 0.03), `每个位置都拿得到 MVP（最低 ${pc(Math.min(...ROLES.map(perSlot)))}，应不低于 3%）`)
ok(/击杀和伤害为主/.test(mvpNote(3, 1)) && /胜方/.test(mvpNote(3, 1)), `MVP 旁的小字说的是这条规则：${mvpNote(3, 1)}`)

console.log('\n四、选手榜：')
const line = (p: Partial<MapLine>) => ({ ...emptyStats(), maps: 40, rounds: 900, ...p })
const mk = (id: string, role: Role, season: ReturnType<typeof line>, titles: string[] = []): Player => ({
  ...structuredClone(Object.values(state.players)[0]), id, ign: id, role, season: { ...season, mvps: season.mvps ?? 0 },
  titles: titles.map((title) => ({ year: state.year, title })),
})
// a 240-ACS 决斗者 with a year of four titles, and a better-rated man with none
const champ = mk('champ', '决斗者', line({ kills: 700, deaths: 640, assists: 180, damage: 900 * 240 / 1.45, firstKills: 130, firstDeaths: 120, clutches: 20, mvps: 8 }),
  ['2026 全球冠军赛', '多伦多大师赛', 'EMEA 联赛 · 第一赛段', 'EMEA 联赛 · 第二赛段'])
const solo = mk('solo', '控场', line({ kills: 700, deaths: 560, assists: 300, damage: 900 * 235 / 1.45, firstKills: 80, firstDeaths: 60, clutches: 40, mvps: 6 }))
const bc = boardLine(state, champ), bs = boardLine(state, solo)
ok(bs.rating > bc.rating && bc.score > bs.score,
  `一年四冠、ACS 240 的决斗者（评分 ${f2(bc.rating)}，排名分 ${f2(bc.score)}）排在评分更高却没有冠军的人（${f2(bs.rating)} → ${f2(bs.score)}）前面`)
ok(Math.abs(bc.titleBonus - (BOARD_TITLE.champions + BOARD_TITLE.masters + 2 * BOARD_TITLE.league)) < 1e-9 && bc.titles === 4, `四冠按赛事分量加分：+${bc.titleBonus.toFixed(3)}`)
const door = mk('door', '先锋', line({ kills: 600, deaths: 600, assists: 250, damage: 900 * 200 / 1.45 }), ['挑战者联赛 · EMEA · 最后机会资格赛', '欧洲 · 公开资格赛'])
ok(boardLine(state, door).titles === 0 && boardLine(state, door).score === boardLine(state, door).rating, '资格赛出线不算冠军，不加分')
const old = mk('old', '先锋', line({ kills: 600, deaths: 600, assists: 250, damage: 900 * 200 / 1.45 }), [])
old.titles = [{ year: state.year - 1, title: '2026 全球冠军赛' }]
ok(boardLine(state, old).titles === 0, '往年的冠军不算进本季')
const mvpMan = mk('mvp', '哨卫', line({ kills: 600, deaths: 600, assists: 250, damage: 900 * 200 / 1.45, mvps: 99 }))
ok(Math.abs(boardLine(state, mvpMan).mvpBonus - BOARD_MVP_MAX) < 1e-9 && BOARD_MVP * 5 < BOARD_MVP_MAX, `整场 MVP 每次 +${BOARD_MVP}，封顶 +${BOARD_MVP_MAX}`)
// the rating stays in charge: a whole year's best honours cannot lift a poor season past a good one
const maxHonours = BOARD_TITLE.champions + 2 * BOARD_TITLE.masters + 3 * BOARD_TITLE.league + BOARD_MVP_MAX
ok(maxHonours <= 0.3, `一季最多的荣誉加分 +${maxHonours.toFixed(2)}，不超过 0.3（赛季评分从 P10 到 P90 约差 0.22）`)
ok(/评分为主/.test(BOARD_RULE) && /冠军/.test(BOARD_RULE) && /MVP/.test(BOARD_RULE), `榜单上写着规则：${BOARD_RULE}`)

console.log('\n五、年度奖项和选手榜同一个排法：')
{
  const s = structuredClone(state)
  const club = s.teams[s.myTeam]
  const ids = [...new Set([s.me!.id, ...leaguePool(s, club).flatMap((t) => t.roster)])].filter((id) => s.players[id])
  for (const id of ids) s.players[id].season = { ...emptyStats(), maps: 30, rounds: 700, kills: 460, deaths: 470, assists: 180, damage: 700 * 190 / 1.45, firstKills: 50, firstDeaths: 50, clutches: 10 }
  const [hi, titled] = ids.filter((id) => id !== s.me!.id)
  // hi: the better season line, no honours; titled: a little under it, with a 冠军赛 and a 大师赛
  Object.assign(s.players[hi].season, { kills: 560, damage: 700 * 225 / 1.45 })
  Object.assign(s.players[titled].season, { kills: 540, damage: 700 * 218 / 1.45, mvps: 5 })
  s.players[titled].titles = [{ year: s.year, title: '2026 全球冠军赛' }, { year: s.year, title: '多伦多大师赛' }]
  const aw = computeAwards(s)
  const top = aw?.cats.find((c) => c.key === 'mvp')?.top ?? []
  ok(performanceRating(s.players[hi].season) > performanceRating(s.players[titled].season) && top[0]?.id === titled,
    `年度最佳选手给了评分略低、拿了冠军赛和大师赛的人（${f2(performanceRating(s.players[titled].season))} + 荣誉），不是评分最高却没冠军的人（${f2(performanceRating(s.players[hi].season))}）`)
  ok(top.every((r, i) => i === 0 || boardScore(s, s.players[top[i - 1].id]) >= boardScore(s, s.players[r.id])), '入围三人按排名分排')
  ok(/冠军/.test(AWARD_RULE) && /MVP/.test(AWARD_RULE) && /选手榜/.test(AWARD_RULE), `颁奖夜和奖项卡上写着规则：${AWARD_RULE}`)
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (bad) {
  console.log(`\n✗ 评分 / MVP / 选手榜有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 首杀按位置、评分跟着击杀和 ACS、MVP 多半是胜方头号火力、选手榜评分为主加荣誉。')
