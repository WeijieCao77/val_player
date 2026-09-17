/**
 * 无冠就是无冠。
 *
 * 「无冠就是无冠不要写远征」 (the author, 2026-09-17). 「远征」 sits above
 * 泯然众人 / 昙花一现 in the ordered list (me/endings.ts) and used to ask one
 * thing only — two seasons in another region — so a career that won nothing
 * read as an expedition: a travel note standing where the verdict goes, and the
 * autopilot takes a spell abroad often. It now asks for a trophy as well, and
 * the trip a trophyless career did make is said inside that ending's own words.
 *
 * What this holds to:
 *  一 every ending is still reachable — one fixture each, 「远征」 among them, so
 *    narrowing it did not quietly kill it; a new ending with no fixture fails here
 *  二 a career with nothing on the shelf never reads 「远征」: any number of
 *    seasons abroad, any length of career, any tenure at one club
 *  三 a career that went abroad and won something still reads 「远征」
 *  四 a trophy only ever watched from the bench is 「板凳上的冠军」, not 「远征」
 *  五 the words: a trophyless career that went abroad still has those seasons in
 *    its ending, one that stayed home has no such line, and 「远征」 never says it twice
 *
 *   npx tsx scripts/check_endings.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ENDINGS_ME, endingFor, retire } from '../src/engine/me/endings'
import type { GameState } from '../src/engine/types'
import type { MeSeason } from '../src/engine/me/types'

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

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

const fresh = (seed: number): GameState => createCareer({
  name: 'Verdict', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2026,
})

/**
 * Trophies by the name the timeline books them under, never by key: me/compclass.ts
 * reads the kind of event off the stored name, and it is what judges the ending.
 */
const L = (year: number, started = true) => ({ year, title: 'VCT 中国 · 第一赛段', started })
const M = (year: number, started = true) => ({ year, title: '东京大师赛', started })
const C = (year: number, started = true) => ({ year, title: `${year} 全球冠军赛`, started })

interface Case {
  titles?: { year: number; title: string; started: boolean }[]
  /** me.flags.abroadSeasons — seasons finished at a club outside my home region (me/week.ts) */
  abroad?: number
  /** pro seasons, the tier > 0 ones the list counts */
  pro?: number
  /** seasons at the club I am at now */
  tenure?: number
  champFinalLost?: boolean
}

const season = (year: number): MeSeason => ({
  year, team: '某俱乐部', tier: 1, matches: 20, starts: 14, wins: 8, acs: 210, overallFrom: 60, overallTo: 62, titles: [],
})

/** One career, dressed as the case: everything the ordered list reads, and nothing else. */
const fix = (state: GameState, c: Case): GameState => {
  const me = state.me!
  me.titles = c.titles ?? []
  me.flags = { ...(c.abroad ? { abroadSeasons: c.abroad } : {}), ...(c.champFinalLost ? { champFinalLost: 1 } : {}) }
  me.tenure = c.tenure ?? 0
  me.seasons = Array.from({ length: c.pro ?? 0 }, (_, i) => season(2026 + i))
  for (const s of me.seasons) s.titles = me.titles.filter((t) => t.year === s.year).map((t) => t.title)
  return state
}

const board = fresh(5)
const keyOf = (c: Case): string => endingFor(fix(board, c)).key

// ------------------------------------------------------------------ 一 every ending is reachable
console.log('\n每个结局都还够得着')
const CASES: { key: string; what: string; c: Case }[] = [
  { key: 'breaker', what: '同一年大师赛 + 冠军赛', c: { titles: [M(2028), C(2028)], pro: 6 } },
  { key: 'dynasty', what: '两座冠军赛', c: { titles: [C(2027), C(2029)], pro: 7 } },
  { key: 'world', what: '一座冠军赛', c: { titles: [C(2028)], pro: 5 } },
  { key: 'master', what: '一座大师赛', c: { titles: [M(2028)], pro: 5 } },
  { key: 'uncrowned', what: '打进冠军赛决赛输了', c: { champFinalLost: true, pro: 5 } },
  { key: 'regional', what: '三个赛区冠军', c: { titles: [L(2026), L(2027), L(2028)], pro: 5 } },
  { key: 'ring', what: '冠军全在替补席上看的', c: { titles: [C(2028, false)], pro: 5 } },
  { key: 'oneclub', what: '一家俱乐部六个赛季', c: { tenure: 6, pro: 6 } },
  { key: 'evergreen', what: '八个职业赛季', c: { pro: 8 } },
  { key: 'abroad', what: '外赛区三季，手里有冠军', c: { abroad: 3, titles: [L(2027)], pro: 5, tenure: 2 } },
  { key: 'titled', what: '一个赛区冠军，没出过赛区', c: { titles: [L(2027)], pro: 5 } },
  { key: 'journeyman', what: '四个赛季，无冠', c: { pro: 4 } },
  { key: 'flash', what: '两个赛季，无冠', c: { pro: 2 } },
  { key: 'shore', what: '从没签上', c: { pro: 0 } },
]
for (const t of CASES) {
  const got = keyOf(t.c)
  check(got === t.key, `${t.what} → 「${ENDINGS_ME.find((e) => e.key === t.key)?.title}」${got === t.key ? '' : `（判成了「${ENDINGS_ME.find((e) => e.key === got)?.title ?? got}」）`}`)
}
const covered = new Set(CASES.map((t) => t.key))
const orphan = ENDINGS_ME.filter((e) => !covered.has(e.key)).map((e) => e.title)
check(!orphan.length, `${ENDINGS_ME.length} 个结局都有一个够得着它的生涯${orphan.length ? `（够不着：${orphan.join('、')}）` : ''}`)

// ------------------------------------------------------------------ 二 无冠就是无冠
console.log('\n无冠的生涯，怎么走都不写「远征」')
let hit = ''
let seen = 0
for (let abroad = 0; abroad <= 8; abroad++) {
  for (let pro = 0; pro <= 12; pro++) {
    for (const tenure of [0, 2, 5, 6, 8]) {
      seen++
      if (keyOf({ abroad, pro, tenure }) === 'abroad') hit = `外赛区 ${abroad} 季 · 职业 ${pro} 季 · 一队 ${tenure} 季`
    }
  }
}
check(!hit, `一个冠军都没有的 ${seen} 种生涯，没有一种判到「远征」${hit ? `（${hit}）` : ''}`)
check(keyOf({ abroad: 4, pro: 4 }) === 'journeyman' && keyOf({ abroad: 4, pro: 2 }) === 'flash',
  '无冠而在外赛区打过的，照常是「泯然众人」和「昙花一现」')
check(keyOf({ abroad: 4, pro: 5, titles: [C(2028, false)] }) === 'ring' && keyOf({ abroad: 4, pro: 5, titles: [L(2027, false)] }) === 'ring',
  '冠军全是在替补席上看的，判「板凳上的冠军」，不是「远征」')

// ------------------------------------------------------------------ 三 出去过、也带回了东西的，照样是「远征」
console.log('\n出去打过、手里有冠军的，照样是「远征」')
let miss = ''
let ok = 0
for (let abroad = 2; abroad <= 6; abroad++) {
  for (let pro = 2; pro <= 7; pro++) {
    for (const titles of [[L(2027)], [L(2027), L(2028)]]) {
      const got = keyOf({ abroad, pro, tenure: 1, titles })
      if (got === 'abroad') ok++
      else miss = `外赛区 ${abroad} 季 · 职业 ${pro} 季 · ${titles.length} 冠 → ${got}`
    }
  }
}
check(!miss, `外赛区两季以上、奖杯柜不空的 ${ok} 种生涯全判「远征」${miss ? `（${miss}）` : ''}`)
check(keyOf({ abroad: 2, pro: 5, titles: [M(2028)] }) === 'master' && keyOf({ abroad: 2, pro: 5, titles: [L(2026), L(2027), L(2028)] }) === 'regional',
  '国际赛冠军、三冠赛区功勋仍排在「远征」前面')
check(keyOf({ abroad: 1, pro: 5, titles: [L(2027)] }) === 'titled', '只在外赛区打过一个赛季：还是「拿过冠军」')

// ------------------------------------------------------------------ 五 结局那段话里的外赛区
console.log('\n结局那段话')
const said = (seed: number, c: Case): { key: string; text: string } => {
  const s = fix(fresh(seed), c)
  retire(s, '探针：挂靴')
  const e = s.me!.ending!
  return { key: e.key, text: e.text }
}
const away = said(6, { abroad: 3, pro: 4 })
check(away.key === 'journeyman' && away.text.includes('外赛区') && away.text.includes('3 个赛季'),
  `无冠但出去打过的，结局里仍写着那几个赛季：${away.text.split('。').filter((x) => x.includes('外赛区')).join('。') || '（这一句没写出来）'}。`)
const home = said(7, { abroad: 0, pro: 4 })
check(home.key === 'journeyman' && !home.text.includes('外赛区'), '没出去过的，不多这一句')
const won = said(8, { abroad: 3, pro: 5, tenure: 1, titles: [L(2027)] })
check(won.key === 'abroad' && won.text.includes('奖杯柜也不空') && !won.text.includes('其中 3 个赛季'),
  '「远征」自己那段话不重复说一遍外赛区')
const one = said(9, { abroad: 1, pro: 4 })
check(!one.text.includes('外赛区'), '只在外赛区打过一个赛季：不写这一句（和「远征」是同一条线）')

console.log(bad ? `\n✗ ${bad} 项没过。` : '\n✓ 结局判定：无冠就是无冠，出去赢过的照样写「远征」。')
if (bad) process.exit(1)
