/**
 * The MVP label reads what the screens now say it reads.
 *
 * A player asked, 2026-09-20: 「他 ACS 和评分都不如 NPC，但是最后 MVP 给到了他，这是为什么？」
 * Both numbers are honest and so is the award — they are just not the same sum.
 * The label takes each map's own ACS and averages it over the maps a man
 * played, plus a nod to the winning side; the scoreboard adds the damage and
 * the rounds of the whole series up first, so a big map that ran short weighs
 * less there than it does in the average. The author's decision the same day
 * was that the rule stays and the screens explain it (me/postmatch.ts mvpNote,
 * shown beside the label on the match sheet, the post-match screen and the
 * recent-matches list).
 *
 * That makes the rule a promise to the player, so this pins it:
 *
 *  一 every match award is the highest average of per-map ACS with the winning
 *    side's nod on top, worked out here from the per-map lines alone — the
 *    engine is never asked what it thinks
 *  二 the per-map label is the same rule on that map's own ACS, against that
 *    map's own winner
 *  三 the two read one scorer: the nod is the same number for both
 *  四 and the whole set of decisions hashes, so a refactor that was meant to
 *    change nothing can be shown to have changed nothing
 *
 *   npx tsx scripts/check_mvp.ts [series=400] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MVP_WIN_NOD, mapMvp, simulateMatch } from '../src/engine/match'
import { mvpNote } from '../src/engine/me/postmatch'
import { Rng } from '../src/engine/rng'
import type { GameState, MapScore, MatchResult } from '../src/engine/types'

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

const series = Number(process.argv[2] ?? 400)
const seed = Number(process.argv[3] ?? 7)

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

/** the rule in words, written out again here from the per-map lines alone */
function awardByHand(state: GameState, r: MatchResult, aId: string, bId: string): string | null {
  const sum = new Map<string, { acs: number; maps: number }>()
  for (const m of r.maps) {
    for (const [pid, l] of Object.entries(m.lines)) {
      const t = sum.get(pid) ?? { acs: 0, maps: 0 }
      t.acs += l.acs
      t.maps++
      sum.set(pid, t)
    }
  }
  const winner = r.mapsWonA === r.mapsWonB ? null : (r.mapsWonA > r.mapsWonB ? aId : bId)
  const nod = new Set(winner ? state.teams[winner]?.roster ?? [] : [])
  let best = -1
  let who: string | null = null
  for (const [pid, t] of sum) {
    if (!t.maps) continue
    const s = t.acs / t.maps + (nod.has(pid) ? MVP_WIN_NOD : 0)
    if (s > best) { best = s; who = pid }
  }
  return who
}

/** the same rule on one map's own ACS, judged against that map's own winner */
function mapBestByHand(map: MapScore, lineups?: { a: string[]; b: string[] }): string | null {
  const winners = new Set(map.scoreA > map.scoreB ? lineups?.a ?? [] : lineups?.b ?? [])
  let best = -1
  let who: string | null = null
  for (const [pid, l] of Object.entries(map.lines)) {
    const s = l.acs + (winners.has(pid) ? MVP_WIN_NOD : 0)
    if (s > best) { best = s; who = pid }
  }
  return who
}

/** a stable digest of every decision, so a no-op refactor can be shown to be one */
function digest(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + text.charCodeAt(i) + 1, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

const t0 = Date.now()
const state = createCareer({
  name: 'MvpCheck', region: 'China', role: '决斗者', talents: emptyTalents(),
  originKey: 'netcafe', start: 'pre', seed,
})
const clubs = Object.keys(state.teams).filter((id) => (state.teams[id]?.roster?.length ?? 0) >= 5).sort()
if (clubs.length < 4) throw new Error(`这份世界里只有 ${clubs.length} 支满员的队，跑不了`)

const BOS: (1 | 2 | 3 | 5)[] = [1, 2, 3, 5]
const lines: string[] = []
let awardWrong = 0
let mapWrong = 0
let multi = 0
let notTopSeriesAcs = 0
let counted = 0

for (let i = 0; i < series; i++) {
  const a = clubs[(i * 7) % clubs.length]
  const b = clubs[(i * 13 + 3) % clubs.length]
  if (a === b) continue
  const bo = BOS[i % BOS.length]
  const r = simulateMatch(state, a, b, bo, new Rng(seed * 1000 + i))
  if (!r.maps.length) continue
  counted++
  if (r.maps.length > 1) multi++

  if (r.mvp !== awardByHand(state, r, a, b)) awardWrong++
  for (const m of r.maps) {
    if (mapMvp(m, r.lineups) !== mapBestByHand(m, r.lineups)) mapWrong++
  }

  // what the note promises a player he may see: the label need not sit on the
  // top row of a scoreboard that adds the series up by rounds
  if (r.mvp) {
    const t = new Map<string, { dmg: number; rounds: number }>()
    for (const m of r.maps) {
      for (const [pid, l] of Object.entries(m.lines)) {
        const x = t.get(pid) ?? { dmg: 0, rounds: 0 }
        x.dmg += l.damage; x.rounds += l.rounds
        t.set(pid, x)
      }
    }
    const acsOf = (pid: string): number => {
      const x = t.get(pid)
      return x?.rounds ? Math.round((x.dmg / x.rounds) * 1.45) : 0
    }
    const side = new Set(r.lineups?.a ?? [])
    const mine = side.has(r.mvp)
    const own = [...t.keys()].filter((pid) => side.has(pid) === mine)
    if (own.some((pid) => acsOf(pid) > acsOf(r.mvp!))) notTopSeriesAcs++
  }

  lines.push(`${i}|${bo}|${r.mapsWonA}-${r.mapsWonB}|${r.mvp ?? '-'}|${r.maps.map((m) => mapMvp(m, r.lineups) ?? '-').join(',')}`)
}

console.log(`\n一、比赛 MVP 就是「每张图 ACS 的平均 + 胜方的加成」里最高的那个（${counted} 场，其中多图 ${multi} 场）：`)
check(awardWrong === 0, `每一场都对得上手算的${awardWrong ? `（${awardWrong} 场对不上）` : ''}`)

console.log('\n二、本图最佳是同一条规则，只看这张图自己的 ACS 和这张图的胜方：')
check(mapWrong === 0, `每张图都对得上手算的${mapWrong ? `（${mapWrong} 张对不上）` : ''}`)

console.log('\n三、两处用的是同一个加成：')
check(MVP_WIN_NOD === 18, `胜方加成 ${MVP_WIN_NOD}，比赛 MVP 和本图最佳共用`)

console.log('\n四、屏幕上那行小字和规则一致：')
check(/每张图/.test(mvpNote(3)) && /平均/.test(mvpNote(3)) && /胜方/.test(mvpNote(3)),
  `多图的说法提到了「每张图」「平均」「胜方」：${mvpNote(3)}`)
check(!/每张图/.test(mvpNote(1)) && /胜方/.test(mvpNote(1)),
  `单图的说法不提平均：${mvpNote(1)}`)
check(notTopSeriesAcs > 0,
  `这批里有 ${notTopSeriesAcs} 场（${((notTopSeriesAcs / Math.max(1, counted)) * 100).toFixed(1)}%）MVP 不是本方盘面 ACS 最高的——小字说的就是这种场面，不是空话`)

const h = digest(lines.join('\n'))
console.log(`\n五、这 ${counted} 场的全部判定：${h}`)
console.log(`   （seed ${seed}、series ${series} 下，只要规则没动，这个值就不会变）`)

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (bad) {
  console.log(`\n✗ MVP 判定有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ MVP：比赛的按每张图 ACS 的平均加胜方加成评，本图最佳按这张图自己的 ACS 评，两处同一个加成；'
  + '屏幕上的小字和规则说的是同一件事。')
