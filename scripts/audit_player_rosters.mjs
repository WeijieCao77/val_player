/** Read-only identity/roster audit. This validates references, not every person's real-world biography.
 * Run: node scripts/audit_player_rosters.mjs [--details]
 * Historical roster snapshots may overlap after transfers/rebrands; warnings are NOT automatic fixes.
 */
import { readFileSync } from 'node:fs'
const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8'))
const worlds = { world_2021: read('world_2021'), world: read('world') }
const timeline = read('timeline'), circuit = read('circuit'), bridge = read('bridge_2026'), dossier = read('dossier')
const errors = [], warnings = { sameYearTeams: [], sameEventTeams: [], sharedHandles: [], missingLegacyBridge: [], clubBridgeNameDifference: [] }
const coverage = { worlds: {}, timelineYears: {}, events: 0, eventRosters: 0, eventSlots: 0 }
const identities = new Map()
for (const p of worlds.world_2021.players) identities.set(p.id.slice(1), p.ign)
for (const year of Object.values(timeline.years)) for (const [id, p] of Object.entries(year.debuts)) identities.set(id, p.ign)
for (const [name, world] of Object.entries(worlds)) {
  const ps = new Map(world.players.map(p => [p.id, p])), ts = new Map(world.teams.map(t => [t.id, t])), seats = new Map()
  coverage.worlds[name] = { players: ps.size, teams: ts.size, rosterSlots: 0 }
  if (ps.size !== world.players.length || ts.size !== world.teams.length) errors.push({ name, kind: 'duplicate-id' })
  for (const t of world.teams) for (const id of t.roster) {
    coverage.worlds[name].rosterSlots++
    if (!ps.has(id) || ps.get(id).teamId !== t.id) errors.push({ name, team: t.id, id, kind: 'roster-pointer' })
    if (seats.has(id)) errors.push({ name, team: t.id, id, kind: 'duplicate-seat' })
    seats.set(id, t.id)
  }
  for (const p of world.players) if (p.teamId && !ts.get(p.teamId)?.roster.includes(p.id)) errors.push({ name, id: p.id, kind: 'reverse-pointer' })
}
const introduced = new Set(worlds.world_2021.players.map(p => p.id.slice(1)))
const openingRatings = new Set(introduced)
for (const [year, book] of Object.entries(timeline.years)) {
  for (const id of Object.keys(book.debuts)) introduced.add(id)
  const seen = new Map()
  coverage.timelineYears[year] = { clubs: Object.keys(book.clubs).length, rosters: Object.keys(book.rosters).length, ratings: Object.keys(book.ratings).length, debuts: Object.keys(book.debuts).length, slots: 0 }
  for (const [team, ids] of Object.entries(book.rosters)) {
    if (!book.clubs[team]) errors.push({ year, team, kind: 'unknown-club' })
    if (new Set(ids).size !== ids.length) errors.push({ year, team, kind: 'duplicate-in-roster' })
    for (const id of ids) {
      coverage.timelineYears[year].slots++
      if (!introduced.has(id)) errors.push({ year, team, id, kind: 'not-yet-introduced' })
      // The 2021 book intentionally omits ratings already supplied by world_2021.
      if (!book.ratings[id] && !(year === '2021' && openingRatings.has(id))) errors.push({ year, team, id, kind: 'missing-rating' })
      if (seen.has(id)) warnings.sameYearTeams.push({ year, id, ign: identities.get(id), teams: [seen.get(id), team] })
      seen.set(id, team)
    }
  }
  for (const event of circuit[year] ?? []) {
    coverage.events++
    const eventSeen = new Map()
    for (const [team, ids] of Object.entries(event.rosters ?? {})) {
      coverage.eventRosters++
      if (new Set(ids).size !== ids.length) errors.push({ year, event: event.id, team, kind: 'duplicate-in-event-roster' })
      for (const id of ids) {
        coverage.eventSlots++
        if (!introduced.has(id)) errors.push({ year, event: event.id, team, id, kind: 'event-not-yet-introduced' })
        if (eventSeen.has(id)) warnings.sameEventTeams.push({ year, event: event.id, name: event.name, start: event.start, end: event.end, id, ign: identities.get(id), teams: [eventSeen.get(id), team], names: [event.names?.[eventSeen.get(id)], event.names?.[team]] })
        eventSeen.set(id, team)
      }
    }
  }
}
const handles = new Map()
for (const [id, ign] of identities) {
  const key = ign.toLowerCase()
  if (!handles.has(key)) handles.set(key, [])
  handles.get(key).push(id)
}
for (const [handle, ids] of handles) if (ids.length > 1) warnings.sharedHandles.push({ handle, ids })
const bridgeSeen = new Map()
for (const p of worlds.world.players) {
  const id = bridge.players[p.id]
  if (!id) warnings.missingLegacyBridge.push({ id: p.id, ign: p.ign, team: p.teamId })
  else {
    if (dossier.players[p.id]?.vlr !== id) errors.push({ id: p.id, kind: 'bridge-dossier-mismatch' })
    if (bridgeSeen.has(id)) errors.push({ id, players: [bridgeSeen.get(id), p.id], kind: 'duplicate-bridge-identity' })
    bridgeSeen.set(id, p.id)
  }
}
const clubNames = Object.assign({}, ...Object.values(timeline.years).map(y => Object.fromEntries(Object.entries(y.clubs).map(([id, c]) => [id, c.n]))))
// Independently verified identities, not a blanket demand that every historical alias match.
// https://enterpriseesports.cz/en/teams/valorant
// https://esports.eintracht.de/news/eintracht-frankfurt-stellt-neues-valorant-team-fuer-2026-vor-174658/
for (const [id, expected] of [['T61', 'Enterprise Esports'], ['T62', 'Eintracht Frankfurt']]) {
  const found = worlds.world.teams.find(t => t.id === id)?.name
  if (found !== expected) errors.push({ id, found, expected, kind: 'verified-club-name' })
}
const norm = s => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
for (const t of worlds.world.teams) {
  const id = bridge.teams[t.id]
  if (id && norm(t.name) !== norm(clubNames[id])) warnings.clubBridgeNameDifference.push({ legacyId: t.id, name: t.name, timelineId: id, timelineName: clubNames[id] })
}
coverage.uniqueHistoricalPlayers = identities.size
const summary = { coverage, errors, warningCounts: Object.fromEntries(Object.entries(warnings).map(([k, v]) => [k, v.length])) }
console.log(JSON.stringify(process.argv.includes('--details') ? { ...summary, warnings } : summary, null, 2))
process.exitCode = errors.length ? 1 : 0
