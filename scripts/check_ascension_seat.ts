/**
 * Does an Ascension the player's club wins send it up into next season's league?
 *
 * Reported 2026-09-23 (「为什么我玩lizhi赢了晋升赛没上一级联赛呀」): a league's field from 2024 to 2026 is its real
 * seeds, and an Ascension is the season before it, so a club that won one played the next season in the
 * Challengers. engine/circuit.ts ascensionSeat reads it at the season turn: the club takes the seat of the side that
 * Ascension really sent up, where it finished no lower than that side did (engine/season.ts openYear).
 *
 *  - the rule, on every 2023–2025 Ascension: which real side's seat, and when there is none
 *  - a career: a Chinese club hand-given 2023's China Ascension plays 2024's China Kickoff in Dragon Ranger
 *    Gaming's seat, and Dragon Ranger Gaming is in the Challengers
 *
 *   npx tsx scripts/check_ascension_seat.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { declineDeal } from '../src/engine/me/contract'
import { advanceDay } from '../src/engine/season'
import { ascensionSeat, eventOf, eventsOf } from '../src/engine/circuit'
import type { Competition, GameState, Team } from '../src/engine/types'

const t0 = Date.now()
let checks = 0
const ok = (label: string) => { checks++; console.log(`OK ${label}`) }

// ---- the rule, off each real Ascension
const base = createCareer({ name: '晋级赛回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 3, year: 2021 })
const ascensions = [2023, 2024, 2025].flatMap((y) => eventsOf(y).filter((e) => e.stage === 'ascension' && !e.plan).map((e) => ({ y, e })))
assert.equal(ascensions.length, 12, 'four leagues, three seasons')

function seatFor(year: number, region: string, place: number, prep?: (s: GameState) => void, asked = year + 1) {
  const s = structuredClone(base)
  const { e } = ascensions.find((x) => x.y === year && x.e.region === region)!
  const club = s.myTeam
  // every side the Ascension or the next Kickoff names is a club here, as a later world would hold it
  const template = s.teams[club]
  for (const v of [...e.places.map(([t]) => t), ...eventsOf(year + 1).flatMap((k) => k.seeds)]) {
    const id = `V21T${v}`
    if (!v.startsWith('N:') && !s.teams[id]) s.teams[id] = { ...structuredClone(template), id, name: e.names[v] ?? v, roster: [] } as Team
  }
  const others = e.places.map(([t]) => `V21T${t}`).filter((t) => t !== club)
  const finished = [...others.slice(0, place - 1), club, ...others.slice(place - 1)]
  const comp = { ...Object.values(s.comps).find((c) => c.circuit)!, key: `ev:${e.id}`, champion: finished[0], finished, places: finished.map((_, i) => i + 1) } as Competition
  comp.circuit = { ...comp.circuit!, id: e.id, mode: 'sim', done: undefined }
  s.comps = { [comp.key]: comp }
  s.year = year + 1
  prep?.(s)
  return { up: ascensionSeat(s, asked), club }
}
const expect: [number, string, string | null][] = [
  // [season, league, the vlr id of the side whose seat the winner takes — null: the next season had none]
  [2023, 'China', '11981'], [2023, 'EMEA', '12694'], [2023, 'Pacific', '6387'], [2023, 'Americas', null],
  [2024, 'China', '13581'], [2024, 'EMEA', '11479'], [2024, 'Americas', '15072'], [2024, 'Pacific', '466'],
  [2025, 'China', '11981'], [2025, 'EMEA', '18019'], [2025, 'Americas', '427'], [2025, 'Pacific', '11060'],
]
for (const [y, region, real] of expect) {
  const { up, club } = seatFor(y, region, 1)
  assert.ok(up, `${y} ${region}: the winner is promoted, or told there is no seat`)
  assert.equal(up.club, club)
  assert.equal(up.league, region)
  assert.equal(up.from, y + 1)
  assert.equal(up.displaced, real && `V21T${real}`, `${y} ${region}: the seat taken`)
  assert.match(up.leagueCn, /联赛$/)
}
ok('each 2023–2025 Ascension winner takes the seat of the side it really sent up; 2023 Americas had none')
// 2024 Pacific really sent up its runner-up (BOOM Esports), and 2025 Pacific its runner-up (Nongshim RedForce):
// second is enough there, third is not; and FULL SENSE, seventh in 2025 and in 2026's Kickoff by another road, is no seat
assert.equal(seatFor(2024, 'Pacific', 2).up?.displaced, 'V21T466')
assert.equal(seatFor(2024, 'Pacific', 2).up?.place, 2)
assert.equal(seatFor(2024, 'Pacific', 3).up, null)
assert.equal(seatFor(2025, 'Pacific', 2).up?.displaced, 'V21T11060')
assert.equal(seatFor(2025, 'Pacific', 7).up, null)
assert.equal(seatFor(2023, 'China', 2).up, null, 'China 2023 sent up its winner only')
assert.equal(seatFor(2023, 'Americas', 2).up, null, 'no seat, and not the winner: nothing to say')
ok('the place earned: no lower than the side really sent up')
assert.equal(seatFor(2023, 'China', 1, (s) => { s.seat = { club: 'X', displaced: 'Y', league: 'EMEA', from: 2023 } }).up, null)
assert.equal(seatFor(2023, 'China', 1, (s) => { s.comps[Object.keys(s.comps)[0]].circuit!.mode = 'history' }).up, null)
assert.equal(seatFor(2023, 'China', 1, undefined, 2025).up, null, 'only last season\'s Ascension')
ok('a seat already held, an Ascension replayed as history, or one from two seasons back: nothing')

// ---- a career through the turn: 2023's China Ascension, handed to Attacking Soul Esports
const club = 'V21T1837'
const s = createCareer({ name: '晋级赛回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 3, year: 2021 })
const asc = eventsOf(2023).find((e) => e.stage === 'ascension' && e.region === 'China')!
let g = 0
while (g++ < 400 && (s.year < 2023 || s.day < asc.start! - 12)) autoWeek(s)
assert.equal(s.year, 2023)
assert.ok(s.teams[club] && !s.teams[club].dormant, 'Attacking Soul Esports plays 2023')
const moveMe = () => {
  const me = s.players[s.me!.id]
  const old = s.teams[s.myTeam]
  if (old && old.id !== club) { old.roster = old.roster.filter((x) => x !== me.id); old.starters = old.starters.filter((x) => x !== me.id) }
  if (!s.teams[club].roster.includes(me.id)) s.teams[club].roster.push(me.id)
  me.teamId = club
  s.myTeam = club
  s.me!.phase = 'pro'
}
moveMe()
let won = false
while (s.year === 2023 && g++ < 900) {
  advanceDay(s, [])
  const c = Object.values(s.comps).find((x) => x.circuit?.id === asc.id)
  if (c?.champion && !won) {
    won = true
    assert.equal(c.circuit?.mode, 'sim')
    if (c.champion !== club) { c.finished = [club, ...c.finished.filter((t) => t !== club)]; c.champion = club; c.places = c.finished.map((_, i) => i + 1) }
  }
}
assert.ok(won, 'the Ascension was played')
while (g++ < 900 && s.day < 60) {
  for (const d of [...s.me!.deals]) if (d.kind !== 'renew') declineDeal(s, d.id)
  if (s.myTeam !== club) moveMe()
  autoWeek(s)
}
assert.equal(s.year, 2024)
assert.deepEqual(s.seat, { club, displaced: 'V21T11981', league: 'China', from: 2024 })
assert.equal(s.teams[club].tier, 1)
assert.equal(s.teams[club].league, 'VCT China')
assert.equal(s.teams.V21T11981.tier, 2, 'Dragon Ranger Gaming goes without the seat')
const kickoff = Object.values(s.comps).find((c) => c.circuit && eventOf(c.circuit.id)?.stage === 'kickoff' && eventOf(c.circuit.id)?.region === 'China')!
assert.ok(kickoff.circuit!.seeds.includes(club), '2024 China Kickoff seats the Ascension winner')
assert.ok(!kickoff.circuit!.seeds.includes('V21T11981'))
assert.equal(kickoff.circuit!.mode, 'sim')
assert.ok(s.news.some((n) => n.year === 2024 && n.text.includes('通过中国 · 晋级赛升入中国联赛')), 'the turn says so')
ok('a career: 2023 China Ascension won → 2024 China Kickoff in Dragon Ranger Gaming\'s seat')

console.log(`PASS ${checks} Ascension-seat checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
