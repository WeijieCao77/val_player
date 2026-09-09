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
 *   npx tsx scripts/check_career_end.ts [seeds=6]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { StartPoint } from '../src/engine/me/career'

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

let bad = 0
for (const seed of SEEDS) {
  for (const start of STARTS) {
    let line = `  seed ${String(seed).padStart(2)} ${start.padEnd(4)} `
    try {
      const state = createCareer({
        name: 'Probe', region: 'China', role: '决斗者',
        talents: emptyTalents(), originKey: 'netcafe', start, seed,
      })
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
}
console.log(bad ? `\n✗ ${bad}/${SEEDS.length * STARTS.length} 个档没能正常收尾。` : `\n✓ ${SEEDS.length * STARTS.length} 个档全部退役并拿到结局。`)
if (bad) process.exit(1)
