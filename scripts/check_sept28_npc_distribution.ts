import assert from 'node:assert/strict'
import timeline from '../src/data/timeline.json'
import { rulerShift } from '../src/engine/ruler'
import { legacyRulerShift } from '../src/engine/npcLegacyRuler'
import { overlayRating } from '../src/engine/npcRoleCalibration'

type Rating = { a: number[]; o: number; p: number; r: string; n: number; v: [number | null, number | null] }
const raw = timeline as unknown as { years: Record<string, { ratings: Record<string, Rating> }> }
const out: { summaries: Record<string, unknown>; samples: Record<string, unknown> } = { summaries: {}, samples: {} }
const med = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)] ?? 0
for (let year = 2021; year <= 2026; year++) {
  const data = Object.entries(raw.years[String(year)].ratings).map(([id, r]) => {
    const before = r.o + legacyRulerShift(year, id)
    const after = overlayRating(year, id, r).o + rulerShift(year, id)
    assert(Number.isFinite(before) && Number.isFinite(after))
    assert(after >= 20 && after <= 99)
    return { id, before, after, role: r.r.split('|')[0] }
  })
  if (year === 2026) assert(data.every(d => d.before === d.after))
  if (year === 2023) {
    // No role-source overlay exists in 2023. Removing one database member
    // changes only these four rounded global-curve results, by exactly -1.
    // Captured by comparing all surviving current shifts before/after deletion;
    // the published legacy migration shifts themselves remain frozen.
    assert.deepEqual(data.filter(d => d.before !== d.after).map(d => [d.id, d.after - d.before]), [
      ['565', -1], ['659', -1], ['7764', -1], ['37494', -1],
    ])
  }
  out.summaries[year] = {
    count: data.length,
    max: [Math.max(...data.map(d => d.before)), Math.max(...data.map(d => d.after))],
    median: [med(data.map(d => d.before)), med(data.map(d => d.after))],
    roleMedians: Object.fromEntries(['决斗者', '先锋', '控场', '哨卫'].map(role => {
      const subset = data.filter(d => d.role === role)
      return [role, [med(subset.map(d => d.before)), med(subset.map(d => d.after))]]
    })),
    changed: data.filter(d => d.before !== d.after).length,
  }
  const samples: Record<string, unknown> = {}
  for (const id of ['438', '3520', '4742', '872', '5022', '8480', '55085', '458', '1380']) {
    const d = data.find(d => d.id === id)
    if (!d) continue
    const r = raw.years[String(year)].ratings[id]
    samples[id] = { before: d.before, after: d.after, rawBefore: r.o, rawAfter: overlayRating(year, id, r).o }
  }
  out.samples[year] = samples
}
console.log(JSON.stringify(out, null, 2))
