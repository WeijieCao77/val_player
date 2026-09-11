/**
 * Does the era table agree with the history we actually scraped?
 *
 * `engine/era.ts` encodes what the circuit looked like each year: which
 * regions were live, what the calendar was, what circuit points paid. All of
 * it was typed in by hand from Riot's announcements and Liquipedia — so it can
 * be wrong in exactly the way a hand-typed table is wrong, and typechecking
 * will never notice.
 *
 * `src/data/history.json` is 270 real events. This checks the table against
 * them: every region the table claims for a year has to actually appear in
 * that year's events, and every calendar has to be a covering, non-overlapping
 * partition of the season.
 *
 *   npx tsx scripts/check_era.ts
 */
import { readFileSync } from 'node:fs'
import {
  CIRCUIT_POINTS_2021, DOMESTIC_POINT_CEILING_2021, ENTRY_YEARS, PARTNER_TEAMS_2023,
  formatOf, layerOf, regionIn, regionsOf, stageAtIn, stagesOf,
} from '../src/engine/era'
import { REGION_CN } from '../src/engine/types'
import type { Region } from '../src/engine/types'

const history: Record<string, { year: number; name: string; teams: { name: string }[] }> =
  JSON.parse(readFileSync('src/data/history.json', 'utf8'))

let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }

/* ---- 1. the calendar must partition the season, every year ---- */
// 2026 twice: the 2026 entrance's calendar, and a 2021 world's, which is 2026 as it is really played; 2027 keeps that shape
for (const [year, timeline] of [[2021], [2022], [2023], [2024], [2025], [2026, false], [2026, true], [2027, true]] as [number, boolean?][]) {
  const st = stagesOf(year, timeline)
  if (st[0].start !== 0) fail(`${year} 赛历不是从第 0 天开始（${st[0].start}）`)
  for (let i = 1; i < st.length; i++) {
    if (st[i].start !== st[i - 1].end + 1) {
      fail(`${year} 赛历有缝或重叠：${st[i - 1].key} 到 ${st[i - 1].end}，`
        + `${st[i].key} 从 ${st[i].start} 开始`)
    }
  }
  const keys = st.map((s) => s.key)
  if (new Set(keys).size !== keys.length) fail(`${year} 赛历有重复的 key`)
  // and every day of the season must land in exactly one stage
  for (const day of [0, 1, 100, 200, 300, st[st.length - 1].end]) {
    if (!stageAtIn(year, day, timeline)) fail(`${year} 第 ${day} 天落不到任何赛段`)
  }
  console.log(`  ${year}${timeline === undefined ? '' : timeline ? '（2021 入口）' : '（2026 入口）'} 赛历 ${st.length} 段，覆盖 0–${st[st.length - 1].end} 天，无缝无重叠`)
}

/* ---- 1b. and it must hold the real events: every international inside its own window ---- */
const circuit: Record<string, { cn: string; stage: string | null; region: string | null; start: number; end: number }[]> =
  JSON.parse(readFileSync('src/data/circuit.json', 'utf8'))
for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
  const st = stagesOf(year, true)
  // LOCK//IN was 2023's international kickoff; from 2024 each league holds its own
  const held = ['masters1', 'masters2', 'champions', ...(year === 2021 ? ['lcq'] : []), ...(year === 2023 ? ['kickoff'] : [])]
  for (const e of circuit[String(year)] ?? []) {
    if (!e.stage || !held.includes(e.stage)) continue
    const w = st.find((s) => s.key === e.stage)
    if (!w || e.start < w.start || e.end > w.end) {
      fail(`${year} ${e.cn} 打在第 ${e.start}–${e.end} 天，赛历的「${w?.name}」窗口是 ${w?.start}–${w?.end}`)
    }
  }
  // a regional stage: most of its events should open inside its window
  for (const w of st) {
    const starts = (circuit[String(year)] ?? []).filter((e) => e.stage === w.key && e.region).map((e) => e.start).sort((a, b) => a - b)
    if (!starts.length || held.includes(w.key)) continue
    const mid = starts[Math.floor(starts.length / 2)]
    if (mid < w.start || mid > w.end) fail(`${year}「${w.name}」的赛事多数在第 ${mid} 天开打，不在窗口 ${w.start}–${w.end} 里`)
  }
  console.log(`  ${year} 的国际赛都落在各自的窗口里，赛区赛段的开打日多数在窗口内`)
}

/* ---- 2. the regions a year claims must appear in that year's events ---- */
const seenNames = (year: number): string =>
  Object.values(history).filter((e) => e.year === year).map((e) => e.name).join(' | ')

// how each region shows up in an event name, when it is not the plain word
const ALIAS: Partial<Record<Region, RegExp>> = {
  'North America': /North America/i,
  Europe: /\bEurope\b|EMEA/i,
  LATAM: /LATAM|Latin America/i,
  SEA: /\bSEA\b|Southeast Asia|Asia-Pacific|APAC/i,
  'Malaysia & Singapore': /Malaysia/i,
  'Hong Kong & Taiwan': /Hong Kong/i,
  China: /China|FGC|PangHu|Huya/i,
  Americas: /Americas/i,
  EMEA: /EMEA/i,
  Pacific: /Pacific/i,
}

for (const year of [2021, 2022]) {
  const blob = seenNames(year)
  const missing = regionsOf(year).filter((r) => !(ALIAS[r] ?? new RegExp(r, 'i')).test(blob))
  if (missing.length) {
    fail(`${year} 的赛区表里这些在真实赛事名里找不到：${missing.map((r) => REGION_CN[r]).join('、')}`)
  } else {
    console.log(`  ${year} 的 ${regionsOf(year).length} 个赛区全部在真实赛事里出现过`)
  }
}

/* ---- 3. mergers must resolve forward ---- */
const merges: [Region, number, Region][] = [
  ['Turkey', 2026, 'EMEA'],
  ['Thailand', 2026, 'Pacific'],
  ['Thailand', 2022, 'SEA'],
  ['Thailand', 2021, 'Thailand'],
  ['China', 2026, 'China'],
]
for (const [from, year, want] of merges) {
  const got = regionIn(from, year)
  if (got !== want) fail(`${REGION_CN[from]} 在 ${year} 年应该属于 ${REGION_CN[want]}，实际是 ${REGION_CN[got]}`)
}
console.log('  赛区合并链条解析正确')

/* ---- 4. circuit points: the shape the real chart had ---- */
if (CIRCUIT_POINTS_2021.s2finals[0] !== 0 || CIRCUIT_POINTS_2021.s3finals[0] !== 0) {
  fail('Challengers 决赛冠军应该是 0 分（他直接晋级大师赛了）')
}
if (CIRCUIT_POINTS_2021.masters1[0] !== 400) fail('雷克雅未克冠军应该是 400 分')
if (CIRCUIT_POINTS_2021.s1masters[0] !== 100) fail('赛区大师赛冠军应该是 100 分')
if (CIRCUIT_POINTS_2021.masters2[0] !== 0) fail('柏林冠军应该直接晋级冠军赛，不给分')
if (DOMESTIC_POINT_CEILING_2021 !== 225) {
  fail(`打不出赛区的队全年上限应该是 225 分，实际算出来 ${DOMESTIC_POINT_CEILING_2021}`)
}
for (const [k, arr] of Object.entries(CIRCUIT_POINTS_2021)) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1] && arr[i - 1] !== 0) fail(`${k} 的第 ${i + 1} 名比第 ${i} 名分高`)
  }
}
console.log(`  积分表结构正确；国内天花板 ${DOMESTIC_POINT_CEILING_2021} 分，`
  + `一次国际赛冠军 ${CIRCUIT_POINTS_2021.masters1[0]} 分（是国内一整年的 ${(CIRCUIT_POINTS_2021.masters1[0] / DOMESTIC_POINT_CEILING_2021).toFixed(1)} 倍；对赛区冠军是 ${CIRCUIT_POINTS_2021.masters1[0] / CIRCUIT_POINTS_2021.s1masters[0]} 倍）`)

/* ---- 5. the 2023 partner list must be 30, and must match the scraped leagues ---- */
const partners = Object.values(PARTNER_TEAMS_2023).flat()
if (partners.length !== 30) fail(`2023 合作战队应该是 30 支，表里是 ${partners.length}`)
const scraped2023 = new Set(
  Object.values(history)
    .filter((e) => e.year === 2023 && /2023: (Americas|EMEA|Pacific) League/.test(e.name))
    .flatMap((e) => e.teams.map((t) => t.name)),
)
/**
 * Clubs rename, and the scrape and the hand-typed list caught them at
 * different moments: `FURIA` / `FURIA Esports`, `Giants` / `Giants Gaming`,
 * `DRX` / `KIWOOM DRX`. Same clubs. So the match strips the filler words orgs
 * add and drop, then allows one name to contain the other — with a length
 * floor so that a three-letter tag cannot swallow an unrelated club.
 *
 * The game will need exactly this when it joins scraped rosters to the
 * partner list, so it is worth getting right here rather than special-casing.
 */
const norm = (s: string) => s.toLowerCase()
  .replace(/\b(esports|esport|gaming|club|team)\b/g, '')
  .replace(/[^a-z0-9]/g, '')
const same = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)]
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 3 && long.includes(short)
}
const unmatched = [...scraped2023].filter((n) => !partners.some((p) => same(p, n)))
if (unmatched.length) {
  fail(`抓到的 2023 联赛里有队不在合作名单上：${unmatched.join('、')}`)
} else {
  console.log(`  2023 合作战队 30 支，与抓到的 ${scraped2023.size} 支联赛队伍全部对得上`)
}
// the whole point of this list: the 2021 world champion is not on it
if (partners.some((p) => same(p, 'Acend'))) {
  fail('Acend 不应该在 2023 合作名单上——它没拿到席位，这正是这一条的意义')
}
console.log('  确认：2021 年的世界冠军 Acend 不在 2023 合作名单上')

/* ---- 6. world-line layers ---- */
const cases: [{ playing: boolean; ownRegion: boolean; ownClub: boolean }, number][] = [
  [{ playing: true, ownRegion: true, ownClub: true }, 0],
  [{ playing: false, ownRegion: true, ownClub: true }, 2],
  [{ playing: false, ownRegion: true, ownClub: false }, 1],
  [{ playing: false, ownRegion: false, ownClub: false }, 3],
]
for (const [inp, want] of cases) {
  if (layerOf(inp) !== want) fail(`世界线分层判错：${JSON.stringify(inp)} 应为 ${want}`)
}
console.log('  世界线分层：打的比赛 0 / 自己队 2 / 本赛区 1 / 够不着 3')

/* ---- 7. entry years ---- */
if (ENTRY_YEARS.length !== 2) fail(`入口应该只有两个（2021 和 2026），现在有 ${ENTRY_YEARS.length} 个`)
for (const y of ENTRY_YEARS) {
  if (!regionsOf(y).length) fail(`${y} 没有任何赛区`)
}
console.log(`  入口 ${ENTRY_YEARS.join(' 与 ')}；`
  + `${ENTRY_YEARS[0]} 有 ${regionsOf(ENTRY_YEARS[0]).length} 个赛区（${formatOf(ENTRY_YEARS[0])}），`
  + `${ENTRY_YEARS[1]} 有 ${regionsOf(ENTRY_YEARS[1]).length} 个（${formatOf(ENTRY_YEARS[1])}）`)

console.log(bad ? `\n✗ ${bad} 项和真实数据对不上。` : '\n✓ 纪元表与抓到的 270 场真实赛事一致。')
process.exit(bad ? 1 : 0)
