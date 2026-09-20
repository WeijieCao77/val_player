/** Read-only identity/date audit. No network, no writes, no implied factual verification.
 * node scripts/audit_player_bios.mjs [--json]
 * A name/country conflict is a review candidate, NOT proof against dual nationality.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = n => JSON.parse(fs.readFileSync(path.join(root, 'src/data', `${n}.json`), 'utf8'))
const bios = read('bios'), history = read('history'), timeline = read('timeline')
const world = read('world'), old = read('world_2021'), dossier = read('dossier'), prospects = read('prospects')
const errors = [], candidates = [], dates = [], ages = [], gaps = []
const raw = new Map(), pages = new Map(), live = new Map()
const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
for (const event of Object.values(history)) for (const team of event.teams ?? []) for (const p of team.players ?? []) {
  if (!raw.has(p.id)) raw.set(p.id, { names: new Set(), countries: new Set() })
  raw.get(p.id).names.add(p.ign)
  if (p.country) raw.get(p.id).countries.add(p.country.toLowerCase())
}
// Only known two-letter codes, not arbitrary AA-ZZ (deprecated FX/SU aliases
// otherwise silently overwrite France/Russia in Intl.DisplayNames).
const codes = new Set([...raw.values()].flatMap(p => [...p.countries]))
const names = new Intl.DisplayNames(['en'], { type: 'region' }), country = new Map()
for (const code of codes) if (/^[a-z]{2}$/.test(code)) country.set(names.of(code.toUpperCase()).toLowerCase(), code)
for (const [name, code] of Object.entries({ korea: 'kr', usa: 'us', turkey: 'tr', 'czech republic': 'cz', macao: 'mo', wales: 'wa' })) country.set(name, code)
export function normalizedBirth(value) {
  // Preserve unknown components as unknown. Only remove comments/quote debris.
  const clean = (value ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/['\s]+$/g, '').trim()
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean)
  if (!match) return null
  const [, ys, ms, ds] = match, y = +ys, m = +ms, d = +ds
  const stamp = new Date(Date.UTC(y, m - 1, d))
  if (y < 1900 || y > 2026 || stamp.getUTCFullYear() !== y || stamp.getUTCMonth() !== m - 1 || stamp.getUTCDate() !== d) return null
  return `${ys}-${ms.padStart(2, '0')}-${ds.padStart(2, '0')}`
}
const ageOnJanuary1 = (birth, year) => year - +birth.slice(0, 4) - (birth.slice(5) === '01-01' ? 0 : 1)
function record(id, p, source, year) {
  const row = { id, ign: p.ign, source, year, name: p.realName ?? p.name ?? p.real ?? null,
    birth: p.birth ?? p.born ?? null, age: p.age, estimated: p.ageEstimated ?? p.est }
  add(live, id, row)
  const clean = normalizedBirth(row.birth)
  if (row.birth && (!clean || row.birth !== clean)) errors.push({ type: 'runtime_birth_format', ...row })
  if (clean && row.age !== undefined && row.age !== ageOnJanuary1(clean, year)) ages.push({ ...row, actualOnJanuary1: ageOnJanuary1(clean, year) })
  if (row.birth && row.estimated) errors.push({ type: 'estimated_with_birth', ...row })
  if (row.estimated === false && !row.birth) errors.push({ type: 'exact_without_birth', ...row })
  const b = bios[id], known = normalizedBirth(b?.birth_date)
  if (known && !row.birth) gaps.push({ id, ign: row.ign, source, availableBirth: known, matchedBy: b.matchedBy })
  if (known && row.birth && known !== clean) errors.push({ type: 'cross_file_birth', id, source, birth: row.birth, bioBirth: known })
}
for (const p of old.players) record(p.id.replace(/^V/, ''), p, 'world_2021', old.meta.season)
for (const p of world.players) {
  const id = dossier.players[p.id]?.vlr
  if (!id) errors.push({ type: 'world_missing_vlr_link', id: p.id, ign: p.ign })
  record(id ?? `unlinked:${p.id}`, p, 'world', world.meta.season)
}
for (const [year, data] of Object.entries(timeline.years)) for (const [id, p] of Object.entries(data.debuts)) record(id, p, `timeline.${year}`, +year)
for (const p of prospects.players) record(p.id.replace(/^Y/, ''), p, 'prospects', 2027)
for (const [id, b] of Object.entries(bios)) {
  if (b.page) add(pages, b.page, id)
  if (b.vlr && b.vlr !== id) errors.push({ type: 'bio_vlr_mismatch', id, vlr: b.vlr })
  if (b.birth_date && b.birth_date !== normalizedBirth(b.birth_date)) dates.push({ id, ign: b.ign, raw: b.birth_date, normalized: normalizedBirth(b.birth_date) })
  const observed = raw.get(id), code = country.get(b.country?.toLowerCase())
  if (code && observed?.countries.size && !observed.countries.has(code)) candidates.push({ type: 'country_conflict', id, ign: b.ign, matchedBy: b.matchedBy,
    bioCountry: b.country, rawCountries: [...observed.countries], name: b.name, birth: b.birth_date, runtimeSources: (live.get(id) ?? []).map(x => x.source) })
  // Event records use the same field names, including vlr. Player ids alone
  // are insufficient: the scraper must first validate the infobox type.
  if (b.matchedBy === 'search' && (b.page.includes('/') || /\b(?:Series|League|Cup|Tour|Circuit|Split|Kickoff|Major|Arena)\b|#\d/i.test(b.name ?? ''))) errors.push({ type: 'event_in_player_bio', id, ign: b.ign, page: b.page, name: b.name, runtimeSources: (live.get(id) ?? []).map(x => x.source) })
}
const repeatedPages = [...pages].filter(([, ids]) => ids.length > 1).map(([page, ids]) => ({ page, ids, players: ids.map(id => ({ id, ign: bios[id].ign, matchedBy: bios[id].matchedBy, rawCountries: [...(raw.get(id)?.countries ?? [])] })) }))
const byMatch = Object.values(bios).reduce((a, p) => (a[p.matchedBy] = (a[p.matchedBy] ?? 0) + 1, a), {})
const report = { scope: 'All local identity/date rows; selected web verification is separate, not exhaustive external verification.',
  coverage: { bios: Object.keys(bios).length, historyIds: raw.size, world: world.players.length, world2021: old.players.length,
    timelineDebuts: Object.values(timeline.years).reduce((n, x) => n + Object.keys(x.debuts).length, 0), prospects: prospects.players.length,
    runtimeDistinctVlrIds: [...live.keys()].filter(id => !id.startsWith('unlinked:')).length, biographyMatchMethods: byMatch,
    runtimeBirthMissing: [...live.values()].flat().filter(x => !x.birth).length },
  errors, repeatedPages, countryCandidates: candidates, rawDateCleanup: dates, ageReferenceMismatches: ages, availableBirthGaps: gaps }
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
else {
  console.log(JSON.stringify(report.coverage, null, 2))
  console.log('Errors by type:', JSON.stringify(errors.reduce((a, p) => (a[p.type] = (a[p.type] ?? 0) + 1, a), {})))
  console.log(`Repeated biography pages: ${repeatedPages.length}; country conflict candidates: ${candidates.length}`)
  console.log(`Raw birthday cleanup: ${dates.length}; safely normalizable: ${dates.filter(x => x.normalized).length}; incomplete/invalid: ${dates.filter(x => !x.normalized).length}`)
  console.log(`Age/reference mismatches: ${ages.length}; locally available missing birthdates: ${gaps.length}`)
  for (const e of errors) console.log(JSON.stringify(e))
  for (const e of ages) console.log('age/reference', JSON.stringify(e))
  console.log('Use --json for all candidates. No files or network requests were made.')
}
