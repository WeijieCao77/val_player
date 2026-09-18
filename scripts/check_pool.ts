/**
 * Does the world stay real, and stay a world?
 *
 * Everyone in this game is a real professional until the roster book runs out
 * (engine/timeline.ts, through 2026); from 2027 the scene also takes in made-up
 * newcomers, marked as such (engine/me/newcomers.ts). The world only ages
 * otherwise, so the question is whether the leagues keep their people, and
 * whether everyone on a roster is someone the game can account for.
 *
 * This plays a career season by season, the way the game advances its world
 * (me/auto.ts autoWeek: the book's winters, New Year's free agency and the
 * newcomers all run at the career's season turn), and at every New Year counts
 * who is on a club's roster, by where he comes from:
 *
 *  - the roster book: world_2021.json, or someone timeline.json meets later
 *  - the reserve: prospects.json, the professionals below the leagues
 *  - a newcomer: made up by the game, `fictional`, from 2027 on
 *
 * Where someone comes from is read off the data files themselves, not off the
 * letter his id starts with. Reported 2026-09-18 by an outside audit: this
 * counted only `P…` (world.json, the old 2026 world) and `Y…` ids as real, so on
 * today's worlds — built from the 2021 book, whose people are `V…` — it printed
 * 「原始真人 0，其他 1047，开局百大 0/100」 for 2026; it only printed warnings, so
 * nothing failed; and it deleted the career and advanced the world on the
 * manager game's day loop, where no newcomer ever arrives, out to 2038, three
 * years past the end of the world line (era.ts WORLD_END), where no career goes.
 *
 * Fails when: the career did not live through the seasons asked for; anyone on
 * a roster is from none of those sources; a roster names someone who is not in
 * the world, or is on two rosters at once, or someone whose own club is another;
 * a newcomer is there in a year the book covers or before 2027, carries a real
 * person's data or handle, or a real person is marked made up; a club with
 * somewhere to play (timeline.ts hasPlace) is under five after the first week
 * or at any New Year.
 *
 * The old line 「平均每队」 divided everyone on a roster by five seats at every
 * club in the world, whether it had anywhere to play or not; the table keeps
 * that figure (旧算法每队) beside the clubs that play, and how many are short.
 *
 *   npx tsx scripts/check_pool.ts [seasons=9] [seed=7]
 */
import RAW_2021 from '../src/data/world_2021.json'
import TIMELINE from '../src/data/timeline.json'
import { careerRegions, createCareer, emptyTalents, startBlocked } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { FIRST_FICTIONAL } from '../src/engine/me/newcomers'
import { PROSPECTS } from '../src/engine/prospects'
import { WORLD_PLAYERS } from '../src/engine/world'
import { bookCovers, hasPlace } from '../src/engine/timeline'
import { WORLD_END } from '../src/engine/era'
import type { GameState, Player, Region } from '../src/engine/types'

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

const seasons = Number(process.argv[2] ?? 9)
const seed = Number(process.argv[3] ?? 7)
/** 2026, the entry the new-career screen defaults to: everything past the book is this world's own */
const YEAR = 2026
/**
 * The career is only the world's clock: a 替补 start is on a first-division roster from day one and, at 18,
 * nowhere near an age ending before the world line ends. China where it is open, as before.
 */
const START: StartPoint = 't1'
const HOME: Region = 'China'

let fails = 0
/** every failure counts; the first 40 are printed */
const fail = (m: string) => { if (fails++ < 40) console.log(`  ✗ ${m}`) }
const t0 = Date.now()

if (!Number.isInteger(seasons) || seasons < 1 || YEAR + seasons > WORLD_END) {
  console.log(`✗ 要跑 ${process.argv[2]} 季：这条世界线 ${WORLD_END} 年到头（era.ts WORLD_END），${YEAR} 年开局的生涯最多走 ${WORLD_END - YEAR} 季。`)
  process.exit(1)
}

/* ---------------------------------------------------------------- where people come from, from the files */

type Source = 'book' | 'reserve' | 'world26' | 'newcomer' | 'stray'
// the 2021 book's people, and everyone the timeline meets after — the game makes each one `V<vlr>` (engine/timeline.ts ensurePlayer)
const BOOK = new Set<string>((RAW_2021 as unknown as { players: { id: string }[] }).players.map((p) => p.id))
const BOOK_HANDLES: string[] = (RAW_2021 as unknown as { players: { ign: string }[] }).players.map((p) => p.ign)
for (const Y of Object.values((TIMELINE as unknown as { years: Record<string, { debuts: Record<string, { ign: string }> }> }).years)) {
  for (const [vlr, d] of Object.entries(Y.debuts)) { BOOK.add(`V${vlr}`); BOOK_HANDLES.push(d.ign) }
}
// prospects.json, as the game makes them (engine/prospects.ts makeProspect keeps the row's id)
const RESERVE = new Set(PROSPECTS.map((r) => r.id))
// world.json, the old 2026 world: nobody from it should turn up in a world built from the book, but they are real
const WORLD26 = new Set(WORLD_PLAYERS.map((p) => p.id))
// a newcomer's handle is checked against every real one the same way newcomers.ts takes them (handleKey)
const handleKey = (s: string): string => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
const REAL_HANDLES = new Set([...BOOK_HANDLES, ...PROSPECTS.map((r) => r.ign), ...WORLD_PLAYERS.map((p) => p.ign)].map(handleKey).filter(Boolean))

const linked = (id: string): Source | null =>
  BOOK.has(id) ? 'book' : RESERVE.has(id) ? 'reserve' : WORLD26.has(id) ? 'world26' : null
const sourceOf = (p: Player): Source => linked(p.id) ?? (p.fictional ? 'newcomer' : 'stray')

/* ---------------------------------------------------------------- the career that keeps the clock */

const listed = careerRegions(YEAR)
const open = listed.filter((r) => !startBlocked(r, START, YEAR))
const region = open.includes(HOME) ? HOME : open[0]
if (!region) { console.log(`✗ ${YEAR} 年没有地区能从「${START}」开局`); process.exit(1) }
const state: GameState = createCareer({
  name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: START, seed, year: YEAR,
})
const me = state.me!

/* ---------------------------------------------------------------- the count */

interface Census {
  year: number
  rostered: number
  by: Record<Source, number>
  clubs: number
  active: number
  activeRostered: number
  short: string[]
  dormant: number
  /** the old line's figure: everyone on a roster, me too, over every club in the world */
  oldAvg: number
  stars: number
}

/** the 100 best people on a roster on day one, from the files — the names a fan would recognise */
let stars = new Set<string>()

function census(s: GameState): Census {
  const where = new Map<string, string>()
  const by: Record<Source, number> = { book: 0, reserve: 0, world26: 0, newcomer: 0, stray: 0 }
  const strays: string[] = []
  let clubs = 0, active = 0, activeRostered = 0, dormant = 0, starsLeft = 0
  const short: string[] = []
  for (const t of Object.values(s.teams)) {
    if (t.id.startsWith('CUP_')) continue
    clubs++
    if (t.dormant) dormant++
    const plays = hasPlace(s, t)
    if (plays) {
      active++
      activeRostered += t.roster.length
      if (t.roster.length < 5) short.push(`${t.name}(${t.roster.length})`)
    }
    for (const id of t.roster) {
      const p = s.players[id]
      if (!p) { fail(`${s.year}：${t.name} 的名单上有 ${id}，世界里没有这个人`); continue }
      if (p.teamId !== t.id) fail(`${s.year}：${p.ign}（${id}）在 ${t.name} 的名单上，自己的俱乐部却是 ${p.teamId ?? '无'}`)
      if (where.has(id)) { fail(`${s.year}：${p.ign}（${id}）同时在 ${where.get(id)} 和 ${t.name} 的名单上`); continue }
      where.set(id, t.name)
      if (id === me.id) continue
      const src = sourceOf(p)
      by[src]++
      if (src === 'stray' && strays.length < 6) strays.push(`${id}(${p.ign})`)
      if (stars.has(id)) starsLeft++
    }
  }
  if (by.stray) fail(`${s.year}：名单上有 ${by.stray} 个人既不在 world_2021.json / timeline.json，也不在 prospects.json / world.json，又不是标明的新人：${strays.join('、')}`)
  // newcomers: none while the book covers the year; each one nobody real, and nobody real marked made up
  for (const p of Object.values(s.players)) {
    if (p.id === me.id) continue
    const src = linked(p.id)
    if (p.fictional && src) fail(`${s.year}：${p.ign}（${p.id}）在数据文件里（${src}），却标成了编出来的新人`)
    if (!p.fictional) continue
    if (bookCovers(s.year) || s.year < FIRST_FICTIONAL) fail(`${s.year}：名单书还管着这一年，却出现了编出来的新人 ${p.ign}（${p.id}）`)
    if ((p.fictionalSince ?? 0) < FIRST_FICTIONAL) fail(`${p.ign}（${p.id}）进圈年份是 ${p.fictionalSince ?? '无'}，新人 ${FIRST_FICTIONAL} 年才开始有`)
    if (REAL_HANDLES.has(handleKey(p.ign))) fail(`${s.year}：编出来的新人 ${p.ign}（${p.id}）用了真人的 ID`)
  }
  return {
    year: s.year, rostered: where.size - (where.has(me.id) ? 1 : 0), by, clubs, active, activeRostered, short, dormant,
    oldAvg: where.size / Math.max(1, clubs), stars: starsLeft,
  }
}

stars = new Set(
  Object.values(state.teams).filter((t) => !t.id.startsWith('CUP_')).flatMap((t) => t.roster)
    .map((id) => state.players[id]).filter((p): p is Player => !!p && p.id !== me.id && !!linked(p.id))
    .sort((a, b) => b.overall - a.overall).slice(0, 100).map((p) => p.id),
)
if (stars.size < 100) fail(`开局名单上从数据文件来的人不到 100 个（${stars.size}）`)

const year0 = state.year
console.log(`起点 ${year0}，${region}「${START}」开局，seed ${seed}，跑 ${seasons} 季（生涯每周推进，世界跟着走）\n`)
console.log('年份  在册   名单书  梯队  新人  其他 │ 俱乐部 休眠 有比赛打 每队(有比赛的) 不满五人 │ 旧算法每队 │ 开局百大')
const row = (c: Census) => console.log(
  `${c.year}  ${String(c.rostered).padStart(4)}  ${String(c.by.book + c.by.world26).padStart(6)}  ${String(c.by.reserve).padStart(4)}  ${String(c.by.newcomer).padStart(4)}  ${String(c.by.stray).padStart(4)} │ `
  + `${String(c.clubs).padStart(6)} ${String(c.dormant).padStart(4)} ${String(c.active).padStart(8)} ${(c.activeRostered / Math.max(1, c.active)).toFixed(2).padStart(14)} ${String(c.short.length).padStart(8)} │ `
  + `${c.oldAvg.toFixed(2).padStart(10)} │ ${c.stars}/100`,
)
const rows: Census[] = [census(state)]
row(rows[0])

// Squads. The book opens 2026 with a dozen clubs under five on New Year's Day (Alter Ego and FUTURE ACADEMY TEAM with
// nobody, KRÜ with two); the world's first day signs free agents into those seats (season.ts ensureMinimumRosters), and
// by the end of the first week none is short (measured 2026-09-18). From then on every club with somewhere to play
// fields five at every New Year. The old 4.33 a club in 2038 was the manager game's day loop, which takes in no
// newcomers and runs no New Year's free agency, three seasons past the end of the world line.
const shortNote = (c: Census) => `${c.short.slice(0, 8).join('、')}${c.short.length > 8 ? ' …' : ''}`
let weeks = 0
let lastYear = state.year
while (state.year - year0 < seasons && weeks++ < 60 * (seasons + 1)) {
  const stop = autoWeek(state)
  if (weeks === 1) {
    const c = census(state)
    if (c.short.length) fail(`开局第一周过完，还有 ${c.short.length} 家有比赛打的俱乐部不满五人：${shortNote(c)}`)
  }
  if (state.year !== lastYear) {
    lastYear = state.year
    const c = census(state)
    rows.push(c)
    row(c)
    if (c.short.length) fail(`${c.year} 年初：有比赛打的俱乐部 ${c.short.length} 家不满五人：${shortNote(c)}`)
  }
  if (stop.kind === 'game-over') break
}

const covered = state.year - year0
if (covered < seasons) fail(`只跑到 ${state.year}：${covered}/${seasons} 季（生涯 ${me.phase}${me.ending ? `，「${me.ending.title}」` : ''}，推进了 ${weeks} 周）`)
if (rows.length !== covered + 1) fail(`应该有 ${covered + 1} 次年初统计，只有 ${rows.length} 次`)

const end = rows[rows.length - 1]
const real = end.by.book + end.by.world26 + end.by.reserve
console.log(`\n${end.year} 年：名单上 ${end.rostered} 人，真人 ${real}（${((real / Math.max(1, end.rostered)) * 100).toFixed(1)}%），编出来的新人 ${end.by.newcomer}；`
  + `有比赛打的俱乐部 ${end.active} 家，平均每队 ${(end.activeRostered / Math.max(1, end.active)).toFixed(2)} 人，不满五人 ${end.short.length} 家${end.short.length ? `：${shortNote(end)}` : ''}`)
const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log(fails ? `\n✗ ${fails} 项不对（${secs} 秒）。` : `\n✓ ${covered} 季都跑到了；名单上每个人都查得到出处，新人 ${FIRST_FICTIONAL} 年起才有、都标着、没有用真人的 ID；开局第一周以后，有比赛打的俱乐部每个年初都满五人。（${secs} 秒）`)
process.exit(fails ? 1 : 0)
