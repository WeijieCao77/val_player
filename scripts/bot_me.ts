/**
 * The whole player career, headless: the same setPlan / doDuel / advanceWeek /
 * MeMatch path the buttons use, run for N seasons, with the numbers that say
 * whether the game is balanced printed at the end.
 *
 *   npx tsx scripts/bot_me.ts [seasons=2] [seed=7] [region=China] [role=决斗者]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { Region, Role } from '../src/engine/types'

// the engine never touches the browser, but a couple of modules read storage lazily
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

const seasons = Number(process.argv[2] ?? 2)
const seed = Number(process.argv[3] ?? 7)
const region = (process.argv[4] ?? 'China') as Region
const role = (process.argv[5] ?? '决斗者') as Role

const t0 = Date.now()
const teamId = process.argv[6]
const state = createCareer({ name: 'Bot', region, role, talents: emptyTalents(), seed, teamId })
const me = state.me!
const p = state.players[me.id]
const team = state.teams[state.myTeam]
console.log(`club ${team.name} (${team.tag}) rating ${team.rating}, roster ${team.roster.length}`)
console.log(`me: ${p.role} overall ${p.overall} potential ${p.potential} salary ${p.salary}`)
console.log(`starters: ${team.starters.map((id) => `${state.players[id].ign}(${state.players[id].overall})`).join(' ')}`)

const startYear = state.year
let weeks = 0
let stops = 0
while (state.year < startYear + seasons && !state.gameOver && weeks < seasons * 60) {
  const stop = autoWeek(state)
  weeks++
  if (stop.kind === 'game-over') { console.log('game over:', state.gameOver); break }
  if (stop.kind !== 'week-end') stops++
  // invariants that must hold every week
  const t = state.teams[state.myTeam]
  if (!t.roster.includes(me.id)) throw new Error(`week ${weeks}: me not on roster`)
  if (t.starters.length !== 5) throw new Error(`week ${weeks}: starters ${t.starters.length}`)
  if (me.ap < 0) throw new Error(`week ${weeks}: ap ${me.ap}`)
  if (state.players[me.id].teamId !== state.myTeam) throw new Error(`week ${weeks}: teamId drifted`)
}

console.log(`\n${weeks} weeks in ${((Date.now() - t0) / 1000).toFixed(1)}s, unexpected stops ${stops}`)
for (const s of me.seasons) {
  console.log(`${s.year} ${s.team}: matches ${s.matches} starts ${s.starts} wins ${s.wins} acs ${s.acs} overall ${s.overallFrom}→${s.overallTo}${s.titles.length ? ' titles ' + s.titles.join('/') : ''}`)
}
const played = me.matches.filter((m) => m.started)
const nodes = played.flatMap((m) => m.nodes)
console.log(`matches ${me.matches.length}, started ${played.length}, won ${played.filter((m) => m.won).length}`)
console.log(`nodes ${nodes.length} (${(nodes.length / Math.max(1, played.length)).toFixed(1)}/match), ok ${nodes.filter((n) => n.ok).length}, avg swing ${(nodes.reduce((s, n) => s + (n.after - n.before), 0) / Math.max(1, nodes.length)).toFixed(1)}pt`)
console.log(`me now: overall ${p.overall} pot ${p.potential} age ${p.age} form ${Math.round(p.form)} fatigue ${Math.round(p.fatigue)} proven ${me.proven} trust ${Math.round(me.coachTrust)} fans ${Math.round(me.fans)} heat ${Math.round(me.heat)} money $${Math.round(me.money)}`)
console.log(`log lines ${me.log.length}; last 8:`)
for (const l of me.log.slice(-8)) console.log(`  [${l.kind}] ${l.text}`)
