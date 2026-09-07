/**
 * The whole player career, headless: the same setPlan / doDuel / advanceWeek /
 * MeMatch / autoResolve path the buttons use, from the ladder to retirement.
 *
 *   npx tsx scripts/bot_me.ts [seasons=10] [seed=7] [region=China] [role=决斗者] [start=pre|chal|t1] [origin=netcafe] [clubId]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { Region, Role } from '../src/engine/types'

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
const region = (process.argv[4] ?? 'China') as Region
const role = (process.argv[5] ?? '决斗者') as Role
const start = (process.argv[6] ?? 'pre') as StartPoint
const originKey = process.argv[7] ?? 'netcafe'
const teamId = process.argv[8]

const t0 = Date.now()
const state = createCareer({ name: 'Bot', region, role, talents: emptyTalents(), originKey, start, seed, teamId })
const me = state.me!
const p = state.players[me.id]
console.log(`start=${start} origin=${originKey} me: ${p.role} overall ${p.overall} potential ${p.potential} age ${p.age} ladder ${Math.round(me.pre.ladder)} money $${me.money}`)
if (me.phase === 'pro') {
  const team = state.teams[state.myTeam]
  console.log(`club ${team.name} (${team.tag}) rating ${team.rating}, roster ${team.roster.length}; starters ${team.starters.map((id) => `${state.players[id].ign}(${state.players[id].overall})`).join(' ')}`)
}

const startYear = state.year
let weeks = 0
let signedWeek = 0
while (state.year < startYear + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
  const stop = autoWeek(state)
  weeks++
  if (!signedWeek && me.phase === 'pro') signedWeek = weeks
  if (stop.kind === 'game-over') break
  const t = state.teams[state.myTeam]
  if (me.phase === 'pro') {
    if (!t.roster.includes(me.id)) throw new Error(`week ${weeks}: me not on roster`)
    if (t.starters.length !== 5) throw new Error(`week ${weeks}: starters ${t.starters.length}`)
    if (state.players[me.id].teamId !== state.myTeam) throw new Error(`week ${weeks}: teamId drifted`)
  } else if (state.players[me.id].teamId) throw new Error(`week ${weeks}: unsigned but teamId set`)
  if (me.ap < 0) throw new Error(`week ${weeks}: ap ${me.ap}`)
  if (Object.keys(state.teams).some((id) => id.startsWith('CUP_'))) throw new Error(`week ${weeks}: temp team left behind`)
}

console.log(`\n${weeks} weeks in ${((Date.now() - t0) / 1000).toFixed(1)}s; signed at week ${signedWeek || '-'}; phase ${me.phase}${me.ending ? ` · ending ${me.ending.title}` : ''}`)
for (const s of me.seasons) {
  console.log(`${s.year} ${s.team}${s.tier ? ` T${s.tier}` : ''}: matches ${s.matches} starts ${s.starts} wins ${s.wins} acs ${s.acs} overall ${s.overallFrom}→${s.overallTo}${s.titles.length ? ' titles ' + s.titles.join('/') : ''}`)
}
const played = me.matches.filter((m) => m.started && !m.friendly)
const cups = me.matches.filter((m) => m.friendly)
const nodes = played.flatMap((m) => m.nodes)
console.log(`league matches ${me.matches.filter((m) => !m.friendly).length}, started ${played.length}, won ${played.filter((m) => m.won).length}; cup matches ${cups.length} won ${cups.filter((m) => m.won).length}`)
console.log(`nodes ${nodes.length} (${(nodes.length / Math.max(1, played.length)).toFixed(1)}/match), ok ${nodes.filter((n) => n.ok).length}`)
console.log(`cups: ${me.pre.cups.map((c) => `${c.key}${c.year} ${c.reached}/${c.rounds}${c.won ? '🏆' : ''}`).join(', ')}`)
console.log(`me now: overall ${p.overall} pot ${p.potential} age ${p.age} proven ${me.proven} trust ${Math.round(me.coachTrust)} fans ${Math.round(me.fans)} money $${Math.round(me.money)} clubs ${(p.clubHist ?? []).map((h) => `${state.teams[h.team]?.tag}:${h.from}-${h.to}`).join(',')}`)
console.log(`events ${me.eventsSeen}, traits ${me.traits.join(',') || '-'}, axes ${JSON.stringify(me.axes)}, quests left ${me.quests.length}, achievements ${me.achievements.length}, titles ${me.titles.length}, stream deal ${me.stream.deal ? me.stream.deal.platform : '-'}`)
console.log(`log lines ${me.log.length}; last 12:`)
for (const l of me.log.slice(-12)) console.log(`  [${l.year} d${l.day} ${l.kind}] ${l.text}`)
