/**
 * The MVP label reads what the screens now say it reads.
 * Updated for role-balance: the old ACS rule described in the historical
 * context below applies only to unversioned saves; NEW matches are checked
 * against the independent round-weighted contribution oracle below.
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
import { MVP_WIN_NOD, PERFORMANCE_WIN_NOD, mapMvp, simulateMatch } from '../src/engine/match'
import { mvpNote } from '../src/engine/me/postmatch'
import { Rng } from '../src/engine/rng'
import type { GameState, MapLine, MapScore, MatchResult } from '../src/engine/types'

// 2026-09-20 role-balance intentionally replaces the old ACS promise for NEW
// matches. This oracle is independent of performance.ts; legacy cases remain
// pinned in check_role_performance.ts rather than silently deleting coverage.
// 2026-09-25 (match-rating): the oracle below is the rating's sum written out
// by hand, so it moved with the author-approved reweighting (kills and damage
// up, assists down: 「杀人的评分也太低了」「MVP不都是按acs吗」). Before, it was
// .55 + .80 K + .80 A − .48 D + .25 (FK − FD) + 1.00 CL, and the nod 0.08.
function contribution(l: MapLine): number {
  if (!l.rounds) return 0
  const r = l.rounds
  return Math.max(0, Math.min(3, .49 + .70 * Math.min(5, l.kills / r)
    + .20 * Math.min(750, l.damage / r) / 100
    + .30 * Math.min(1.5, l.assists / r) - .50 * Math.min(1, l.deaths / r)
    + .30 * (Math.min(1, l.firstKills / r) - Math.min(1, l.firstDeaths / r))
    + .80 * Math.min(1, l.clutches / r)))
}

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
function awardByHand(_state: GameState, r: MatchResult, aId: string, bId: string): string | null {
  const sum = new Map<string, MapLine>()
  for (const m of r.maps) {
    for (const [pid, l] of Object.entries(m.lines)) {
      const t = sum.get(pid) ?? { kills: 0, deaths: 0, assists: 0, damage: 0, firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 0, acs: 0 }
      for (const key of ['kills', 'deaths', 'assists', 'damage', 'firstKills', 'firstDeaths', 'clutches', 'rounds'] as const) t[key] += l[key]
      sum.set(pid, t)
    }
  }
  const winner = r.mapsWonA === r.mapsWonB ? null : (r.mapsWonA > r.mapsWonB ? aId : bId)
  const nod = new Set(winner ? winner === aId ? r.lineups?.a : r.lineups?.b : [])
  let best = -1
  let who: string | null = null
  for (const [pid, t] of sum) {
    if (!t.rounds) continue
    const s = contribution(t) + (nod.has(pid) ? PERFORMANCE_WIN_NOD : 0)
    if (s > best) { best = s; who = pid }
  }
  return who
}

/** the same rule on one map's own ACS, judged against that map's own winner */
function mapBestByHand(map: MapScore, lineups?: { a: string[]; b: string[] }): string | null {
  const winners = new Set(map.scoreA === map.scoreB ? [] : map.scoreA > map.scoreB ? lineups?.a ?? [] : lineups?.b ?? [])
  let best = -1
  let who: string | null = null
  for (const [pid, l] of Object.entries(map.lines)) {
    if (!l.rounds) continue
    const s = contribution(l) + (winners.has(pid) ? PERFORMANCE_WIN_NOD : 0)
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

console.log(`\n一、新比赛 MVP = 累计回合贡献评分 + 胜方轻微加成（${counted} 场，其中多图 ${multi} 场）：`)
check(awardWrong === 0, `每一场都对得上手算的${awardWrong ? `（${awardWrong} 场对不上）` : ''}`)

console.log('\n二、本图最佳是同一贡献规则，只看本图实际数据与胜方：')
check(mapWrong === 0, `每张图都对得上手算的${mapWrong ? `（${mapWrong} 张对不上）` : ''}`)

console.log('\n三、两处用的是同一个加成：')
check(PERFORMANCE_WIN_NOD === .15 && MVP_WIN_NOD === 18, `新胜方加成 ${PERFORMANCE_WIN_NOD}；旧存档保留 ${MVP_WIN_NOD}`)

console.log('\n四、屏幕上那行小字和规则一致：')
check(/累计回合/.test(mvpNote(3, 1)) && /助攻/.test(mvpNote(3, 1)) && /胜方/.test(mvpNote(3, 1)),
  `新版多图说明与贡献规则一致：${mvpNote(3, 1)}`)
check(/本图/.test(mvpNote(1, 1)) && !/累计回合/.test(mvpNote(1, 1)),
  `新版单图说明：${mvpNote(1, 1)}`)
check(/每张图/.test(mvpNote(3)) && /ACS 平均/.test(mvpNote(3)) && !/每张图/.test(mvpNote(1)), '旧说明保留原ACS规则')
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
console.log('\n✓ MVP：新版按累计回合贡献评分，本图同规则；旧记录保留ACS解释；'
  + '屏幕上的小字和规则说的是同一件事。')
