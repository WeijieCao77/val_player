/**
 * Does an Ascension the player's club plays move the league seats it should?
 *
 * Reported 2026-09-23 (「为什么我玩lizhi赢了晋升赛没上一级联赛呀」): a league's field from 2024 to 2026 is its real
 * seeds, and an Ascension is the season before it, so a club that won one played the next season in the
 * Challengers. engine/circuit.ts ascensionSeats reads it at the season turn (engine/season.ts openYear): the club
 * takes the seat of the side that Ascension really sent up, where it finished no lower than that side did; and where
 * the player's club was that side and did not earn the place here, the winner goes up in its seat instead.
 *
 *  - the rule, on every 2023–2025 Ascension: which real side's seat, and when there is none
 *  - the other way round: the player's club was history's side and lost the place
 *  - a career: a Chinese club hand-given 2023's China Ascension plays 2024's China Kickoff in Dragon Ranger
 *    Gaming's seat, while an earlier club's 方案 C seat in EMEA still plays; and Dragon Ranger Gaming, the player's
 *    club, second there, leaves its seat to the winner
 *
 *   npx tsx scripts/check_ascension_seat.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { declineDeal } from '../src/engine/me/contract'
import { advanceDay } from '../src/engine/season'
import { ascensionSeat, ascensionSeats, eventOf, eventsOf } from '../src/engine/circuit'
import type { AscensionSeat } from '../src/engine/circuit'
import type { Competition, GameState, Team } from '../src/engine/types'

const t0 = Date.now()
let checks = 0
const ok = (label: string) => { checks++; console.log(`OK ${label}`) }

// ---- the rule, off each real Ascension
const base = createCareer({ name: '晋级赛回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 3, year: 2021 })
const ascensions = [2023, 2024, 2025].flatMap((y) => eventsOf(y).filter((e) => e.stage === 'ascension' && !e.plan).map((e) => ({ y, e })))
assert.equal(ascensions.length, 12, 'four leagues, three seasons')

/** The player's club (`mine`, the career's own unless given) at `place` of that Ascension, played here. */
function world(year: number, region: string, place: number, mine?: string): GameState {
  const s = structuredClone(base)
  const { e } = ascensions.find((x) => x.y === year && x.e.region === region)!
  const template = s.teams[s.myTeam]
  // every side the Ascension or the next Kickoff names is a club here, as a later world would hold it
  for (const v of [...e.places.map(([t]) => t), ...eventsOf(year + 1).flatMap((k) => k.seeds)]) {
    const id = `V21T${v}`
    if (!v.startsWith('N:') && !s.teams[id]) s.teams[id] = { ...structuredClone(template), id, name: e.names[v] ?? v, roster: [] } as Team
  }
  if (mine) s.myTeam = mine
  const club = s.myTeam
  const others = e.places.map(([t]) => `V21T${t}`).filter((t) => t !== club)
  const finished = [...others.slice(0, place - 1), club, ...others.slice(place - 1)]
  const comp = { ...Object.values(base.comps).find((c) => c.circuit)!, key: `ev:${e.id}`, champion: finished[0], finished, places: finished.map((_, i) => i + 1) } as Competition
  comp.circuit = { ...comp.circuit!, id: e.id, mode: 'sim', done: undefined }
  s.comps = { [comp.key]: comp }
  s.year = year + 1
  return s
}
function seatFor(year: number, region: string, place: number, prep?: (s: GameState) => void, asked = year + 1) {
  const s = world(year, region, place)
  prep?.(s)
  return { up: ascensionSeat(s, asked), club: s.myTeam }
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
// a seat 方案 C gave an earlier club of the player's does not stand in the way; a seat already won, or a holder already moved, does
assert.equal(seatFor(2023, 'China', 1, (s) => { s.seat = { club: 'X', displaced: 'Y', league: 'EMEA', from: 2023 } }).up?.displaced, 'V21T11981')
assert.equal(seatFor(2023, 'China', 1, (s) => { s.seats = [{ club: s.myTeam, displaced: 'Y', league: 'China', from: 2024 }] }).up, null)
assert.equal(seatFor(2023, 'China', 1, (s) => { s.seats = [{ club: 'X', displaced: 'V21T11981', league: 'China', from: 2024 }] }).up, null)
assert.equal(seatFor(2023, 'China', 1, (s) => { s.comps[Object.keys(s.comps)[0]].circuit!.mode = 'history' }).up, null)
assert.equal(seatFor(2023, 'China', 1, undefined, 2025).up, null, 'only last season\'s Ascension')
ok('an earlier club\'s seat is no bar; a seat held, a holder moved, a replay as history, or two seasons back: nothing')

// ---- the other way round: the player's club is the side history sent up, and here it did not earn the place
const lostFor = (year: number, region: string, realVlr: string, place: number): AscensionSeat[] =>
  ascensionSeats(world(year, region, place, `V21T${realVlr}`), year + 1)
{
  const got = lostFor(2023, 'China', '11981', 2)
  assert.equal(got.length, 1)
  assert.equal(got[0].lost, true)
  assert.equal(got[0].displaced, 'V21T11981', 'Dragon Ranger Gaming\'s seat')
  assert.notEqual(got[0].club, 'V21T11981')
  assert.equal(got[0].place, 2)
  assert.equal(ascensionSeat(world(2023, 'China', 2, 'V21T11981'), 2024), null, 'nothing for the player\'s own club')
  assert.deepEqual(lostFor(2023, 'China', '11981', 1), [], 'history\'s side that also won here: nothing moves')
  assert.deepEqual(lostFor(2024, 'Pacific', '466', 2), [], 'BOOM Esports really went up from second: second keeps it')
  assert.equal(lostFor(2024, 'Pacific', '466', 3)[0]?.lost, true)
}
ok('the player\'s club was history\'s side and lost the place here: the winner goes up in its seat')

// ---- careers through the turn: 2023's China Ascension
const asc = eventsOf(2023).find((e) => e.stage === 'ascension' && e.region === 'China')!
function career(club: string, win: boolean, prep?: (s: GameState) => void): GameState {
  const s = createCareer({ name: '晋级赛回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 3, year: 2021 })
  let g = 0
  while (g++ < 400 && (s.year < 2023 || s.day < asc.start! - 12)) autoWeek(s)
  assert.equal(s.year, 2023)
  assert.ok(s.teams[club] && !s.teams[club].dormant, `${club} plays 2023`)
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
  prep?.(s)
  let played = false
  while (s.year === 2023 && g++ < 900) {
    advanceDay(s, [])
    const c = Object.values(s.comps).find((x) => x.circuit?.id === asc.id)
    if (c?.champion && !played) {
      played = true
      assert.equal(c.circuit?.mode, 'sim')
      const rest = c.finished.filter((t) => t !== club)
      // lost: behind a side that plays 2024 and is not a partner already — one bound for the league, or one history
      // lets go at the turn (Monarch Effect), passes the place on, here to the player's club and nothing moves
      const ids = (es: typeof asc[]) => new Set(es.flatMap((e) => e.seeds.map((v) => `V21T${v}`)))
      const bound = ids(eventsOf(2024).filter((e) => e.stage === 'kickoff' && e.region === 'China'))
      const alive = ids(eventsOf(2024))
      const lead = rest.find((t) => !bound.has(t) && alive.has(t))!
      c.finished = win ? [club, ...rest] : [lead, club, ...rest.filter((t) => t !== lead)]
      c.champion = c.finished[0]
      c.places = c.finished.map((_, i) => i + 1)
    }
  }
  assert.ok(played, 'the Ascension was played')
  while (g++ < 900 && s.day < 60) {
    for (const d of [...s.me!.deals]) if (d.kind !== 'renew') declineDeal(s, d.id)
    if (s.myTeam !== club) moveMe()
    autoWeek(s)
  }
  assert.equal(s.year, 2024)
  return s
}
const kickoffOf = (s: GameState, region: string) =>
  Object.values(s.comps).find((c) => c.circuit && eventOf(c.circuit.id)?.stage === 'kickoff' && eventOf(c.circuit.id)?.region === region)!

// won, with an earlier club of the player's holding a 方案 C seat in EMEA: both seats are played
{
  const club = 'V21T1837'
  let earlier: NonNullable<GameState['seat']> | undefined
  const s = career(club, true, (w) => {
    const emea = eventsOf(2024).find((e) => e.stage === 'kickoff' && e.region === 'EMEA')!
    const displaced = emea.seeds.map((v) => `V21T${v}`).find((id) => w.teams[id] && !w.teams[id].dormant)!
    const other = Object.values(w.teams).find((t) => t.region === 'Europe' && t.tier === 2 && !t.dormant && t.roster.length >= 5)!
    earlier = { club: other.id, displaced, league: 'EMEA', from: 2023 }
    w.seat = earlier
  })
  assert.deepEqual(s.seat, earlier)
  assert.deepEqual(s.seats, [{ club, displaced: 'V21T11981', league: 'China', from: 2024 }])
  assert.equal(s.teams[club].tier, 1)
  assert.equal(s.teams[club].league, 'VCT China')
  assert.equal(s.teams.V21T11981.tier, 2, 'Dragon Ranger Gaming goes without the seat')
  const cn = kickoffOf(s, 'China').circuit!
  assert.ok(cn.seeds.includes(club), '2024 China Kickoff seats the Ascension winner')
  assert.ok(!cn.seeds.includes('V21T11981'))
  assert.equal(cn.mode, 'sim')
  const eu = kickoffOf(s, 'EMEA').circuit!
  assert.ok(eu.seeds.includes(earlier!.club) && !eu.seeds.includes(earlier!.displaced), 'the earlier seat still plays')
  assert.ok(s.news.some((n) => n.year === 2024 && n.text.includes('通过中国 · 晋级赛升入中国联赛')), 'the turn says so')
  ok('a career: 2023 China Ascension won → 2024 China Kickoff in Dragon Ranger Gaming\'s seat, beside an earlier club\'s EMEA seat')
}
// lost, as the side history sent up: the winner here plays the league, the player's club the Challengers
{
  const club = 'V21T11981'
  const s = career(club, false)
  assert.equal(s.seats?.length, 1)
  const [seat] = s.seats!
  assert.equal(seat.displaced, club)
  assert.notEqual(seat.club, club)
  assert.equal(s.teams[seat.club].tier, 1)
  assert.equal(s.teams[club].tier, 2)
  const cn = kickoffOf(s, 'China').circuit!
  assert.ok(cn.seeds.includes(seat.club) && !cn.seeds.includes(club), '2024 China Kickoff seats the winner, not Dragon Ranger Gaming')
  ok(`a career: Dragon Ranger Gaming second in 2023's China Ascension → ${s.teams[seat.club].name} plays 2024 in its seat`)
}

console.log(`PASS ${checks} Ascension-seat checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
