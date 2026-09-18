/**
 * Does every career actually reach an ending?
 *
 * A save is supposed to be two or three hours and then a verdict. It was not:
 * the engine's own retirement sweep treated the career player as one more
 * ageing pro, flagged him at 29 and deleted his Player object a year later —
 * after which every `state.players[me.id]` in the player layer threw, and a
 * career that made it into its thirties ended on a white screen instead of
 * on the card.
 *
 * So this runs careers from all three starting points to their natural end
 * and asserts three things: it terminates, `me.ending` is set, and the player
 * still exists to be drawn.
 *
 * Each seed × door opens where the new-career screen would let it (reported
 * 2026-09-18 by an outside audit: every seed was China, and 2026's China has no
 * second-tier club on New Year's Day — the screen greys that door out
 * (startBlocked) and createCareer refuses it, so 6 of 18 careers here threw
 * before a week was played, and the && chain in check:me:full never reached
 * check_pool). China where the door is open, as before; where it is greyed,
 * the regions whose door is open, in the screen's order, one per seed. A door
 * the screen greys out is checked on its own: createCareer has to refuse it in
 * the engine's words, never start it and never throw a TypeError.
 *
 *   npx tsx scripts/check_career_end.ts [seeds=6]
 */
import { careerRegions, createCareer, emptyTalents, startBlocked } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { StartPoint } from '../src/engine/me/career'
import type { Region } from '../src/engine/types'

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

const SEEDS = [1, 3, 7, 13, 19, 29].slice(0, Number(process.argv[2] ?? 6))
const STARTS: StartPoint[] = ['pre', 'chal', 't1']
/** the year createCareer opens in when none is given — the one the new-career screen defaults to */
const YEAR = 2026
/** where the careers here opened before 2026-09-18, kept wherever that door is open */
const HOME: Region = 'China'

const listed = careerRegions(YEAR)
/** the regions the screen lists whose `start` door is open that year, in its order */
const openFor = (start: StartPoint): Region[] => listed.filter((r) => !startBlocked(r, start, YEAR))

let bad = 0
const t0 = Date.now()

// 1. a door the screen greys out is refused in words, not started and not crashed
const greyed: string[] = []
for (const region of listed) {
  for (const start of STARTS) {
    const why = startBlocked(region, start, YEAR)
    if (!why) continue
    greyed.push(`${region}·${start}`)
    try {
      createCareer({ name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed: 1, year: YEAR })
      bad++
      console.log(`✗ ${YEAR} ${region} ${start}：开局按钮是灰的（${why}），createCareer 却开了`)
    } catch (e) {
      const words = e instanceof Error && !(e instanceof TypeError) && e.message.startsWith(`${YEAR} 年开季时`)
      if (!words) {
        bad++
        console.log(`✗ ${YEAR} ${region} ${start}：灰掉的开局没有好好拒绝 —— ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
      }
    }
  }
}
console.log(`${YEAR} 年灰掉的开局 ${greyed.length} 个，createCareer 都拒绝了：${greyed.join('、') || '无'}`)

// 2. every door, from where the screen lets it open, played to its end
let ran = 0
SEEDS.forEach((seed, i) => {
  for (const start of STARTS) {
    const open = openFor(start)
    const region = open.includes(HOME) ? HOME : open[i % Math.max(1, open.length)]
    let line = `  seed ${String(seed).padStart(2)} ${start.padEnd(4)} ${(region ?? '—').padEnd(14)} `
    if (!region) {
      bad++
      console.log(`✗ ${line.trim()}：${YEAR} 年没有一个地区能从这个开局开始`)
      continue
    }
    try {
      const state = createCareer({
        name: 'Probe', region, role: '决斗者',
        talents: emptyTalents(), originKey: 'netcafe', start, seed, year: YEAR,
      })
      ran++
      const me = state.me!
      let weeks = 0
      while (me.phase !== 'retired' && weeks++ < 60 * 22) {
        if (autoWeek(state).kind === 'game-over') break
      }
      const p = state.players[me.id]
      if (me.phase !== 'retired' || !me.ending || !p) {
        bad++
        console.log(`✗ ${line.trim()}: phase=${me.phase} ending=${me.ending?.title ?? '无'} 选手还在=${!!p} 周数=${weeks}`)
      } else {
        line += `${String(me.seasons.length).padStart(2)} 季 · ${me.titles.length} 冠 · 「${me.ending.title}」`
        console.log(line)
      }
    } catch (e) {
      bad++
      console.log(`✗ ${line.trim()} 抛错：${(e as Error).message}`)
    }
  }
})

const want = SEEDS.length * STARTS.length
// every seed × door has to have been played, not skipped
if (ran !== want) {
  bad++
  console.log(`✗ 只开出了 ${ran}/${want} 个档`)
}
const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log(bad ? `\n✗ ${bad} 项不对（${secs} 秒）。` : `\n✓ ${want} 个档全部退役并拿到结局；灰掉的开局都被拒绝。（${secs} 秒）`)
if (bad) process.exit(1)
