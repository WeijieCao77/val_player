/**
 * The ladder as the client shows it (engine/me/rank.ts), held to the rules it
 * says it follows — the author's report of 2026-09-14 was a 「辐能战魂」 with no
 * place, outside the 500 there are.
 *
 * - 辐能战魂 only inside the server's top 500 and over its RR floor, and always then
 * - a place shown from 神话 up, and never below
 * - up the score, up the ladder: division, RR and place never go backwards
 * - the rules of the day: no 超凡入圣 before Episode 5, one 神话 before 3.05,
 *   China on 亚服 until 国服 opened
 * - the places 国服 was calibrated to, a board that wanders slowly and the same
 *   for the same save, the invitation line a 辐能战魂 on every server
 * - old saves: the 52–62 「辐能战魂」 is 神话 3 with a place; a broken score is mended
 * - the achievements and the origin card read the server
 *
 *   npx tsx scripts/check_rank.ts
 */
import { RADIANT_SLOTS, SERVERS, boardPop, rankAt, rankFull, rankText, rulesAt, serverAt } from '../src/engine/me/rank'
import { INVITE_LADDER, ladderLabel } from '../src/engine/me/prepro'
import { ACHIEVEMENTS } from '../src/engine/me/achievements'
import { ORIGINS, originName } from '../src/engine/me/origins'
import { migratePlayerSave } from '../src/engine/me/save'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { GameState, Region } from '../src/engine/types'

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
let checks = 0
const ok = (cond: boolean, msg: string) => {
  checks++
  if (!cond) { fails++; if (fails <= 40) console.log(`FAIL ${msg}`) }
}

/** all rank.ts reads of a save: the date, the seed, where I come from, the score */
const at = (region: Region, year: number, day: number, ladder = 0, seed = 7): GameState =>
  ({ year, day, seed, me: { region, pre: { ladder, ladderPeak: ladder } } } as unknown as GameState)

const REGIONS: Region[] = ['China', 'Korea', 'Japan', 'North America', 'Europe', 'Turkey', 'MENA', 'Brazil', 'LATAM', 'Oceania']
const DATES: [number, number][] = [[2021, 5], [2021, 249], [2021, 250], [2022, 171], [2022, 172], [2023, 191], [2023, 192], [2026, 0], [2026, 200], [2031, 300]]

/* ---- servers and the rules of the day ---- */
ok(serverAt('China', 2023, 191).key === 'AP' && serverAt('China', 2023, 192).key === 'CN', 'China queues on 亚服 until 2023-07-12, 国服 from then')
ok(serverAt('China', 2021, 0).name === '亚服' && serverAt('China', 2026, 0).name === '国服', 'China 2021 亚服, 2026 国服')
ok(serverAt('Korea', 2026, 0).key === 'KR' && serverAt('Japan', 2026, 0).key === 'AP' && serverAt('Turkey', 2021, 0).key === 'EU'
  && serverAt('MENA', 2026, 0).key === 'EU' && serverAt('Brazil', 2026, 0).key === 'BR' && serverAt('LATAM', 2026, 0).key === 'LATAM'
  && serverAt('North America', 2021, 0).key === 'NA' && serverAt('Oceania', 2026, 0).key === 'AP', 'each scene on its real server')
ok(!rulesAt(2021, 249).immortalDivs && rulesAt(2021, 250).immortalDivs, '神话 1/2/3 from patch 3.05, 2021-09-08')
ok(!rulesAt(2022, 171).ascendant && rulesAt(2022, 172).ascendant, '超凡入圣 from Episode 5, 2022-06-22')
ok(rankAt(at('China', 2021, 100, 35)).tier === '钻石', '2021: the score of 超凡入圣 is 钻石, there being no 超凡入圣')
ok(rankAt(at('China', 2021, 100, 50)).name === '神话', '2021 before 3.05: 神话 is one rank')
ok(rankAt(at('China', 2026, 100, 35)).tier === '超凡入圣', '2026: 超凡入圣')

/* ---- the sweep: every rule, every server, every era ---- */
let maxLen = 0
for (const region of REGIONS) {
  for (const [year, day] of DATES) {
    for (const seed of [1, 7]) {
      const rules = rulesAt(year, day)
      let prev: ReturnType<typeof rankAt> | null = null
      for (let i = 0; i <= 2000; i++) {
        const l = i / 20
        const s = at(region, year, day, l, seed)
        const r = rankAt(s)
        const where = `${region} ${year}d${day} seed ${seed} l=${l} (${rankFull(r)})`
        const floor = r.server.radiantRR
        ok(!r.radiant || (r.pos !== null && r.pos <= RADIANT_SLOTS && r.rr >= floor), `辐能战魂 only in the top ${RADIANT_SLOTS} and over ${floor} RR: ${where}`)
        ok(r.radiant || r.pos === null || r.pos > RADIANT_SLOTS || r.rr < floor, `top ${RADIANT_SLOTS} and over the floor is 辐能战魂: ${where}`)
        ok((r.pos !== null) === (l >= 42) && (r.pos !== null) === (r.tier === '神话' || r.tier === '辐能战魂'), `a place from 神话 up, never below: ${where}`)
        const text = rankText(r)
        ok(/第 [\d,]+ 名$|第一$/.test(text) === (r.pos !== null), `the words show the place exactly when there is one: ${where} → ${text}`)
        ok(r.pos === null || r.board === null || r.pos <= r.board, `a place on the board: ${where}`)
        ok(rules.ascendant || !text.includes('超凡入圣'), `no 超凡入圣 before Episode 5: ${where}`)
        ok(rules.immortalDivs || r.tier !== '神话' || r.div === 0, `one 神话 before 3.05: ${where}`)
        ok(!rules.immortalDivs || r.tier !== '神话' || (r.div >= 1 && r.div <= 3), `神话 1–3 after 3.05: ${where}`)
        ok(r.rr >= 0 && (r.pos !== null || r.rr <= 99), `RR 0–99 in a division below 神话: ${where}`)
        ok(r.server.key === 'CN' || !text.includes('国服'), `国服 only on 国服: ${where}`)
        if (prev) {
          ok(r.order >= prev.order, `the ladder never goes backwards up the score: ${where} after ${rankFull(prev)}`)
          ok(r.pos === null || prev.pos === null || r.pos <= prev.pos, `the place never falls up the score: ${where} after ${rankFull(prev)}`)
          ok(!prev.radiant || r.radiant, `辐能战魂 stays 辐能战魂 up the score: ${where}`)
        }
        maxLen = Math.max(maxLen, ladderLabel(s).length)
        prev = r
      }
      // the line the invitations open at is a 辐能战魂 on every server, as the pages say
      ok(rankAt(at(region, year, day, INVITE_LADDER, seed)).radiant, `the ladder invitation line is 辐能战魂 on ${region} ${year}d${day}`)
    }
  }
}
// the save-list card keeps 24 characters of it (me/saveMeta.ts)
ok(maxLen <= 24, `the label fits the save card: longest ${maxLen}`)

/* ---- 国服's calibration, and the tier floors ---- */
const cn = (l: number, seed: number, week: number) => rankAt(at('China', 2026, week * 7, l, seed))
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const placeOn = (l: number) => median([1, 2, 3, 5, 7, 11, 13, 17].flatMap((seed) => [0, 13, 26, 39].map((w) => cn(l, seed, w).pos ?? 0)))
ok(Math.abs(placeOn(62) - 500) <= 50, `国服 62 → about 500th (${placeOn(62)})`)
ok(Math.abs(placeOn(72) - 100) <= 15, `国服 72 → about 100th (${placeOn(72)})`)
ok(placeOn(82) >= 8 && placeOn(82) <= 12, `国服 82 → about 10th (${placeOn(82)})`)
ok(placeOn(96) <= 2, `国服 96 → first (${placeOn(96)})`)
const t26 = (l: number) => rankAt(at('China', 2026, 100, l)).name
ok(t26(15.99) === '铂金 3' && t26(16) === '钻石 1' && t26(29.99) === '钻石 3' && t26(30) === '超凡入圣 1' && t26(41.99) === '超凡入圣 3' && t26(42) === '神话 1',
  `the tier floors: ${[15.99, 16, 29.99, 30, 41.99, 42].map(t26).join(' / ')}`)
const r2 = rankAt(at('China', 2026, 100, 50))
ok(r2.tier === '神话' && r2.rr > 100 && r2.rr < 160, `a 神话 on 国服 carries RR past 100 (${rankFull(r2)})`)
ok(rankAt(at('China', 2026, 100, 62)).rr >= SERVERS.CN.radiantRR, '国服 500th is over its floor')

/* ---- a board that wanders slowly, the same for the same save ---- */
let worst = 0
for (let year = 2024; year <= 2027; year++) {
  for (let week = 0; week < 52; week++) {
    const a = boardPop({ year, day: week * 7, seed: 7 }, SERVERS.CN)
    const b = boardPop(week === 51 ? { year: year + 1, day: 0, seed: 7 } : { year, day: (week + 1) * 7, seed: 7 }, SERVERS.CN)
    worst = Math.max(worst, Math.abs(b - a) / a)
  }
}
ok(worst <= 0.04, `a week moves a server's size at most 4% (worst ${(worst * 100).toFixed(1)}%)`)
ok(rankText(rankAt(at('Korea', 2027, 77, 70, 99))) === rankText(rankAt(at('Korea', 2027, 77, 70, 99))), 'the same save and day read the same')
ok([1, 2, 3, 4, 5].some((seed) => rankAt(at('China', 2026, 70, 60, seed)).pos !== rankAt(at('China', 2026, 70, 60, 7)).pos), 'the wander belongs to the save')
ok((rankAt(at('Korea', 2026, 100, 62)).pos ?? 0) < (rankAt(at('China', 2026, 100, 62)).pos ?? 0), 'the same score stands higher on a smaller server')

/* ---- old saves ---- */
for (let l = 52; l < 62; l += 0.5) {
  const r = rankAt(at('China', 2026, 150, l))
  ok(!r.radiant && r.name === '神话 3' && (r.pos ?? 0) > RADIANT_SLOTS, `an old 52–62 「辐能战魂」 is 神话 3 outside the 500: l=${l} → ${rankFull(r)}`)
}
{
  const s = createCareer({ name: 'Old', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 3 })
  s.me!.pre.ladder = 57
  s.me!.pre.ladderPeak = Number.NaN
  const back = migratePlayerSave(JSON.parse(JSON.stringify(s)) as GameState)
  ok(back.me!.pre.ladder === 57 && back.me!.pre.ladderPeak === 57, `a broken peak is mended to the score (${back.me!.pre.ladder}/${back.me!.pre.ladderPeak})`)
  ok(/^神话 3 · 国服第 [\d,]+ 名$/.test(ladderLabel(back)), `an old 57 reads 神话 3 with its place: ${ladderLabel(back)}`)
  back.me!.pre.ladder = 140
  ok(migratePlayerSave(back).me!.pre.ladder === 100, 'a score past 100 is held to 100')
}

/* ---- achievements and the origin card read the server ---- */
const ach = (key: string) => ACHIEVEMENTS.find((a) => a.key === key)!
const firstAt = (key: string, region: Region) => {
  for (let i = 0; i <= 1000; i++) if (ach(key).cond(at(region, 2026, 100, i / 10))) return i / 10
  return Infinity
}
ok(Math.abs(firstAt('ladder_100', 'China') - 72) <= 1.5, `前一百 on 国服 at the score it always took, 72 (${firstAt('ladder_100', 'China')})`)
ok(firstAt('ladder_100', 'Korea') < firstAt('ladder_100', 'China'), '前一百 comes earlier on a smaller server')
ok(Math.abs(firstAt('ladder_top', 'China') - 96) <= 2, `登顶 on 国服 about 96 (${firstAt('ladder_top', 'China')})`)
const radiantCard = ORIGINS.find((o) => o.key === 'radiant')!
ok(originName(radiantCard, serverAt('China', 2026, 0)) === '国服榜一路人王', 'the card on 国服')
ok(originName(radiantCard, serverAt('Korea', 2026, 0)) === '韩服榜一路人王', 'the card from Korea')
ok(originName(radiantCard, serverAt('China', 2021, 0)) === '亚服榜一路人王', 'the card from 2021 China')
ok(originName(radiantCard, serverAt('North America', 2026, 0)) === '北美服榜一路人王', 'the card from North America')
ok(ORIGINS.filter((o) => o.key !== 'radiant').every((o) => originName(o, SERVERS.KR) === o.name), 'no other card changes its name')

/* ---- what a career shows ---- */
for (const [region, year] of [['China', 2026], ['Korea', 2026], ['LATAM', 2026], ['China', 2021]] as [Region, number][]) {
  console.log(`${region} ${year}: ${[36, 45, 50, 55, 62, 72, 82, 96].map((l) => `${l} ${rankFull(rankAt(at(region, year, 200, l)))}`).join(' | ')}`)
}

console.log(`\n${checks} checks, ${fails} failed`)
if (fails) process.exit(1)
