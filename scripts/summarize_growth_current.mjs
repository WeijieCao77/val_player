/** Descriptive paired summary only; no population/balance success assertion. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.ok(process.argv[2], 'Provide a completed probe_growth_current JSONL file')
const records = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse)
const header = records.find(r => r.type === 'metadata')
const summary = records.at(-1)
assert.equal(summary.type, 'summary', 'Probe did not finish; do not summarize partial evidence as complete')
assert.equal(summary.complete, true)
assert.equal(summary.sourceUnchanged, true)
assert.ok(!records.some(r => r.type === 'failure'))
const rows = records.filter(r => r.type === 'career')
assert.equal(rows.length, header.cells.length)
assert.equal(summary.reachedTarget, rows.length, 'Censored careers need separate treatment')
for (const r of rows) {
  assert.equal(r.error, null)
  assert.equal(r.completedTarget, true)
  assert.equal(r.sourceSha256, header.sourceSha256)
  assert.equal(r.reason, 'target-year')
  assert.equal(r.deniedFetches, 0, 'Unexpected outgoing request attempt during offline probe')
  for (const snap of [r.initial, ...r.yearly, r.final]) {
    assert.ok(snap.overall <= snap.potential && snap.potential <= 99, 'Overall/potential guard')
    for (const [attr, value] of Object.entries(snap.attrs)) {
      assert.ok(value <= snap.caps[attr] && snap.caps[attr] <= 99, 'Attribute ceiling guard')
      assert.ok((snap.xp[attr] ?? 0) >= 0 && (snap.xp[attr] ?? 0) < 100, 'XP is not banked past a point')
    }
  }
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null
}
const pairs = [...new Set(rows.map(r => r.pairKey))].map(key => {
  const pair = rows.filter(r => r.pairKey === key)
  assert.equal(pair.length, 2)
  const a = pair.find(r => r.variant === 'baseline'), b = pair.find(r => r.variant === 'candidate')
  assert.ok(a && b)
  assert.deepEqual(a.initial, b.initial, 'Different starting conditions invalidate the pair')
  assert.equal(a.settledWeeks, b.settledWeeks)
  const thresholds = {}
  for (const threshold of [80, 85, 90]) {
    const aw = a.firstReached[threshold]?.careerWeek ?? null
    const bw = b.firstReached[threshold]?.careerWeek ?? null
    thresholds[threshold] = { baselineWeek: aw, candidateWeek: bw,
      differenceWeeks: aw !== null && bw !== null ? bw - aw : null }
  }
  return { role: a.role, seed: a.seed,
    baseline: a.final.overall, candidate: b.final.overall, delta: b.final.overall - a.final.overall,
    potential: [a.final.potential, b.final.potential], titles: [a.final.titleCount, b.final.titleCount],
    injuryWeeks: [a.final.totals.injuryWeeks, b.final.totals.injuryWeeks],
    starts: [a.final.totals.official.starts, b.final.totals.official.starts], thresholds,
    yearly: a.yearly.map((year, i) => {
      assert.equal(year.year, b.yearly[i].year)
      return { year: year.year, baseline: year.overall, candidate: b.yearly[i].overall }
    }) }
})
const variants = {}
for (const variant of ['baseline', 'candidate']) {
  const selected = rows.filter(r => r.variant === variant)
  variants[variant] = { count: selected.length, endpointMedian: median(selected.map(r => r.final.overall)),
    endpointMin: Math.min(...selected.map(r => r.final.overall)), endpointMax: Math.max(...selected.map(r => r.final.overall)),
    potentialMedian: median(selected.map(r => r.final.potential)),
    thresholds: Object.fromEntries([80, 85, 90].map(t => [t, {
      reached: selected.filter(r => r.firstReached[t] !== null).length,
      total: selected.length,
      // Conditional on reaching; unequal achievers cannot be compared as a pace estimate.
      reachedOnlyMedianWeek: median(selected.filter(r => r.firstReached[t]).map(r => r.firstReached[t].careerWeek)),
    }])) }
}
console.log(JSON.stringify({ design: header.design, sourceSha256: header.sourceSha256,
  seconds: summary.seconds, variants, pairs,
  improved: pairs.filter(p => p.delta > 0).length, same: pairs.filter(p => p.delta === 0).length,
  worse: pairs.filter(p => p.delta < 0).length,
  caveat: 'Descriptive 10-pair pilot; not population proof. Endpoints combine training, opportunities, trophies and caps. Threshold medians are conditional on reaching and are not directly comparable when achievers differ.' }, null, 2))
