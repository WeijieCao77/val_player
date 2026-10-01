import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { openWorldAt, syncYear, syncEvent } from '../src/engine/timeline'
import { migrateRegionalRuler } from '../src/engine/me/regionalRulerMigrate'
import { shiftPlayer, regionalCalibration, regionalRulerShiftForSample } from '../src/engine/ruler'
import { recomputeOverall } from '../src/engine/player'
import { legacyRulerShift } from '../src/engine/npcLegacyRuler'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Player } from '../src/engine/types'
import circuit from '../src/data/circuit.json'
import timeline from '../src/data/timeline.json'
import world2021 from '../src/data/world_2021.json'

// DeepSeek-v4-pro supplied the audit outline; corrected and reviewed against actual APIs.
Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline')), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
const fresh = (year: number) => {
  const s = createCareer({ name: '数值审计', region: 'EMEA', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 1001, year: 2021 })
  if (year > 2021) openWorldAt(s, year)
  return s
}
const numeric = (p: Player) => JSON.stringify({ attrs: p.attrs, overall: p.overall, potential: p.potential })
const snapshot = (s: GameState) => Object.fromEntries(Object.values(s.players).map(p => [p.id, numeric(p)]))
const unchanged = (s: GameState, before: Record<string, string>, context: string) => {
  for (const [id, value] of Object.entries(before)) assert.equal(numeric(s.players[id]), value, `${context}: ${id}`)
}
const events = circuit as unknown as Record<string, { rosters?: Record<string, string[]> }[]>
type Rating = { a: number[]; o: number; p: number; r: string; n: number; v: (number | null)[] }
const book = timeline as unknown as { years: Record<string, { ratings: Record<string, Rating> }> }
// Reconstruct the published baseline using the saved raw sample, not current-year guessing.
function beforeCalibration(p: Player, year: number): Player {
  const id = p.id.slice(1), sample = p.vlr
  assert.ok(sample, `${p.id}: raw sample required for a before/after comparison`)
  const candidates: Player[] = []
  for (let y = year; y >= 2021; y--) {
    const r = book.years[String(y)]?.ratings[id]
    if (!r || r.n !== sample.rounds || r.v[0] !== sample.rating || r.v[1] !== sample.acs) continue
    const before = structuredClone(p), d = legacyRulerShift(y, id)
    before.attrs = Object.fromEntries(ATTR_KEYS.map((k, i) => [k, Math.max(20, Math.min(99, r.a[i] + d))])) as Player['attrs']
    recomputeOverall(before)
    before.potential = Math.max(before.overall, Math.min(99, r.p + d))
    candidates.push(before)
  }
  const w = world2021.players.find(w => w.id === p.id)
  if (w?.vlr && w.vlr.rounds === sample.rounds && w.vlr.rating === sample.rating && w.vlr.acs === sample.acs) {
    const before = structuredClone(p)
    before.attrs = { ...w.attrs }; before.overall = w.overall; before.potential = w.potential
    shiftPlayer(before, legacyRulerShift(2021, id))
    candidates.push(before)
  }
  assert.ok(candidates.length, `${p.id}: matched historical source required`)
  assert.ok(candidates.every(c => numeric(c) === numeric(candidates[0])), `${p.id}: ambiguous baseline must not be guessed`)
  return candidates[0]
}
let eventChecks = 0
for (let year = 2021; year <= 2026; year++) {
  const s = fresh(year)
  const groups = new Map<string, Player[]>()
  const seen = new Set<string>()
  for (const t of Object.values(s.teams)) {
    if (t.dormant || t.tier !== 1) continue
    for (const id of t.roster) {
      const p = s.players[id]
      if (!p || id === s.me!.id || seen.has(id)) continue
      seen.add(id)
      for (const key of [t.region, `${t.region}/${p.role}`]) groups.set(key, [...(groups.get(key) ?? []), p])
    }
  }
  const distribution = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, ps]) => {
    const os = ps.map(p => p.overall).sort((a, b) => a - b)
    return { group, n: os.length, median: os[Math.floor((os.length - 1) * .5)], p90: os[Math.floor((os.length - 1) * .9)], max: os.at(-1) }
  })
  const cn = groups.get('China') ?? []
  const cnChanges = cn.map(p => {
    const before = beforeCalibration(p, year)
    return { id: p.id, name: p.ign, role: p.role, before: before.overall, after: p.overall, delta: p.overall - before.overall, attributesChanged: ATTR_KEYS.some(k => p.attrs[k] !== before.attrs[k]) }
  })
  const cnTop = cnChanges.slice().sort((a, b) => b.after - a.after).slice(0, 10)
  const c = regionalCalibration(year)
  console.log(JSON.stringify({ year, distribution, cnTop, cnChanges: cnChanges.filter(p => p.attributesChanged || p.delta), calibration: { n: c.localSamples, peerN: c.peerSamples, localP90: c.localP90, peerP90: c.peerP90, discount: c.maxDiscount, affected: c.shifts.size } }))
  const main = JSON.stringify(s.players[s.me!.id])
  assert.equal(migrateRegionalRuler(s), 0, 'fresh worlds already carry the regional stamp')
  syncYear(s, year)
  const once = snapshot(s)
  syncYear(s, year)
  unchanged(s, once, `same-year ${year} reread cannot compound the rating shift`)
  for (const ev of events[String(year)] ?? []) {
    if (!ev.rosters) continue
    const before = snapshot(s)
    syncEvent(s, ev.rosters)
    unchanged(s, before, `${year} event must not rerate existing players`)
    eventChecks++
  }
  assert.equal(JSON.stringify(s.players[s.me!.id]), main, 'main player preserved by all historical reads')
}

const s = fresh(2026), npc = s.players.V55085
assert.ok(npc, 'real Erv fixture must exist; never silently skip')
assert.equal(regionalRulerShiftForSample(2026, '55085', npc.vlr), -4)
const source = JSON.stringify(npc.vlr)
shiftPlayer(npc, 4) // Undo the regional component to reconstruct the old save.
shiftPlayer(npc, 1) // Independent simulated growth.
npc.attrs.aim -= 3 // Independent manual customization, also retained.
recomputeOverall(npc)
assert.equal(JSON.stringify(npc.vlr), source, 'attribute shifts never modify raw statistical fingerprints')
const expected = structuredClone(npc)
shiftPlayer(expected, -4)
const main = JSON.stringify(s.players[s.me!.id])
delete s.regionalRuler
assert.ok(migrateRegionalRuler(s) > 0)
assert.equal(numeric(npc), numeric(expected), 'only the regional delta is applied; growth and customization retained')
assert.equal(JSON.stringify(s.players[s.me!.id]), main)
const once = snapshot(s)
assert.equal(migrateRegionalRuler(s), 0)
unchanged(s, once, 'repeated regional migration')
console.log(`PASS October CN audit: six actual-world region/role distributions, ${eventChecks} event reads, annual rerating idempotence, ME/growth/customization preserved`)
