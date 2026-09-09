/**
 * Does the world stay real?
 *
 * Every name in this game is a real professional. But the world only ages:
 * players retire and the only intake is prospects.json, which holds a fixed
 * number of real lower-tier players. If that reserve runs dry, squads either
 * shrink or get filled with someone the premise says should not exist.
 *
 * This walks the world forward season by season and counts, among everyone on
 * a league roster: how many are from the original world.json (id P…), how many
 * came from the prospect reserve (id Y…), and how many are neither.
 *
 *   npx tsx scripts/check_pool.ts [seasons=10] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { advanceDay, continuePastFive } from '../src/engine/season'
import type { GameState } from '../src/engine/types'

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

const seasons = Number(process.argv[2] ?? 10)
const seed = Number(process.argv[3] ?? 7)

const state: GameState = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed,
})

/** who is on a league roster right now, by where they came from */
function census(s: GameState) {
  const seen = new Set<string>()
  const strays: string[] = []
  let orig = 0, reserve = 0, other = 0, seats = 0
  for (const t of Object.values(s.teams)) {
    if (t.id.startsWith('CUP_')) continue
    seats += 5
    for (const id of t.roster) {
      if (seen.has(id)) continue
      seen.add(id)
      if (/^P\d+$/.test(id)) orig++
      else if (/^Y/.test(id)) reserve++
      else { other++; if (strays.length < 6) strays.push(`${id}(${s.players[id]?.ign ?? '?'})`) }
    }
  }
  return { orig, reserve, other, rostered: seen.size, seats, strays }
}

// The count staying real is not the whole story: the people who age out are
// the oldest, which is to say the famous ones. Track the names a fan would
// actually recognise — the top 100 by rating on day one.
const stars = new Set(
  Object.values(state.players)
    .filter((p) => /^P\d+$/.test(p.id))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 100)
    .map((p) => p.id),
)
const starsLeft = (s: GameState) => {
  let n = 0
  for (const t of Object.values(s.teams)) {
    if (t.id.startsWith('CUP_')) continue
    for (const id of t.roster) if (stars.has(id)) n++
  }
  return n
}

const year0 = state.year
console.log(`起点 ${year0}，模拟 ${seasons} 季，seed ${seed}\n`)
console.log('年份   在册人数  原始真人  梯队真人  其他   平均每队  开局百大还剩')

// The world on its own, with no career in it: the point is how the league
// population behaves as it ages, not how one player's story goes.
delete (state as { me?: unknown }).me

let guard = 0
let lastYear = state.year
const start = census(state)
console.log(`${year0}   ${String(start.rostered).padStart(6)}  ${String(start.orig).padStart(8)}  ${String(start.reserve).padStart(8)}  ${String(start.other).padStart(4)}   ${(start.rostered / (start.seats / 5)).toFixed(2)}      ${starsLeft(state)}/100`)

while (state.year - year0 < seasons && guard++ < 400 * seasons) {
  if (state.midReview) continuePastFive(state)
  // with no career in the state the engine reads this as a manager game and
  // will eventually sack the manager; the league population outlives him
  state.gameOver = false
  advanceDay(state, { autoScrims: true, autoResolveDrawDecisions: true })
  if (state.year !== lastYear) {
    lastYear = state.year
    const c = census(state)
    console.log(`${state.year}   ${String(c.rostered).padStart(6)}  ${String(c.orig).padStart(8)}  ${String(c.reserve).padStart(8)}  ${String(c.other).padStart(4)}   ${(c.rostered / (c.seats / 5)).toFixed(2)}      ${starsLeft(state)}/100`)
  }
}

const end = census(state)
const realShare = end.rostered ? ((end.orig + end.reserve) / end.rostered) * 100 : 0
console.log(`\n${state.year} 年：在册 ${end.rostered} 人，真人占 ${realShare.toFixed(1)}%，平均每队 ${(end.rostered / (end.seats / 5)).toFixed(2)} 人（满编 5）`)
if (end.other > 0) console.log(`⚠ 有 ${end.other} 个既不在 world.json 也不在 prospects.json 的人：${end.strays.join('、')}`)
if (end.rostered < end.seats * 0.9) console.log(`⚠ 阵容缺人：${end.seats} 个位置只有 ${end.rostered} 人`)
