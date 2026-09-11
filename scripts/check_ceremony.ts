/**
 * Do the ceremonies actually fire, once each, and does skipping cost nothing?
 *
 * The design rule is the thing worth testing: 「跳过 = 银档」. A player who
 * never wants to play a reflex game should end a career in the same place as
 * one who plays them all and does averagely — so the autopilot, which always
 * skips, must never be worse off for it.
 *
 *   npx tsx scripts/check_ceremony.ts [seasons=6] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { CEREMONIES } from '../src/engine/me/ceremony'
import type { CerKind } from '../src/engine/me/types'

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

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)

const state = createCareer({
  // 2026 opens on the real 2026, whose Chinese second-tier clubs play their first event in the summer:
  // a Challengers start is a European club's
  name: 'Probe', region: 'Europe', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
})
const me = state.me!
const year0 = state.year
let guard = 0
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  if (autoWeek(state).kind === 'game-over') break
}

// let whatever is on screen finish, the way a player would before stopping
for (let i = 0; i < 4 && (me.cer || me.pending.length); i++) autoWeek(state)

// Count from the log, not from `cerSeen`: the seen-list is capped so a long
// career does not carry every key forever, and counting a capped list quietly
// under-reports. The log is what the player actually saw.
const byKind: Record<string, number> = {}
for (const l of me.log) {
  for (const kind of Object.keys(CEREMONIES) as CerKind[]) {
    if (l.text.includes(CEREMONIES[kind].name)) { byKind[kind] = (byKind[kind] ?? 0) + 1; break }
  }
}
console.log(`${year0}\u2013${state.year}\uff0c${me.seasons.length} \u5b63\uff0cseed ${seed}\n`)
console.log('\u4eea\u5f0f\u89e6\u53d1\u6b21\u6570\uff08\u81ea\u52a8\u6258\u7ba1\u5168\u90e8\u8d70\u94f6\u6863\uff09')
for (const kind of Object.keys(CEREMONIES) as CerKind[]) {
  console.log(`  ${CEREMONIES[kind].name.padEnd(6)} ${String(byKind[kind] ?? 0).padStart(3)}`)
}

// nothing may be left half-open
const stuck = !!me.cer || me.pending.some((x) => x.kind === 'ceremony')
// skipping is silver, so none of the tier-scoped effects may be set
const effects = [
  me.cerRest ? '\u51fa\u5f81\u7684\u4f11\u6574\u4fee\u6b63' : '',
  me.cerMatch ? '\u51b3\u8d5b\u5165\u573a\u7684\u573a\u4e0a\u4fee\u6b63' : '',
].filter(Boolean)

console.log(`\n\u5361\u4f4f\u7684\u4eea\u5f0f\uff1a${stuck ? '\u6709' : '\u65e0'}`)
console.log(`\u8df3\u8fc7\u540e\u6b8b\u7559\u7684\u6863\u4f4d\u6548\u679c\uff1a${effects.length ? effects.join('\u3001') : '\u65e0'}`)

let bad = 0
if (stuck) { bad++; console.log('\u2717 \u6709\u4eea\u5f0f\u6ca1\u6709\u5173\u6389\uff0c\u65f6\u949f\u4f1a\u505c\u5728\u90a3\u91cc\u3002') }
if (effects.length) { bad++; console.log('\u2717 \u8df3\u8fc7\u5e94\u8be5\u7b49\u4e8e\u94f6\u6863\uff0c\u4e0d\u8be5\u7559\u4e0b\u4efb\u4f55\u4fee\u6b63\u3002') }
if (!Object.keys(byKind).length) { bad++; console.log('\u2717 \u4e00\u4e2a\u4eea\u5f0f\u90fd\u6ca1\u89e6\u53d1\u3002') }
// a stage's media day is the metronome: roughly one a stage
const stages = (me.seasons.length || 1) * 5
if ((byKind.media ?? 0) < stages * 0.5) { bad++; console.log(`\u2717 \u5a92\u4f53\u65e5\u53ea\u89e6\u53d1\u4e86 ${byKind.media ?? 0} \u6b21\uff0c\u9884\u671f\u63a5\u8fd1\u6bcf\u8d5b\u6bb5\u4e00\u6b21\u3002`) }

console.log(bad ? `\n\u2717 ${bad} \u9879\u4e0d\u5bf9\u3002` : '\n\u2713 \u4eea\u5f0f\u6b63\u5e38\u89e6\u53d1\u3001\u6b63\u5e38\u5173\u95ed\uff0c\u8df3\u8fc7\u4e0d\u7559\u4efb\u4f55\u4ee3\u4ef7\u3002')
if (bad) process.exit(1)
