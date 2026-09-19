/**
 * The match map board's circles and dots (src/data/minimaps.ts) against the official images they sit on.
 *
 * Reported 2026-09-19 by the author, a screenshot of the board on Sunset: 「地图里AB的位置标的是歪的，不在下包区的中心」.
 * B's circle stood at the left edge of the map, a zone's width from the yellow-green B the image paints; the
 * circles had been put where valorant-api.com prints the words 「A Site」「B Site」. They are now read off the
 * picture (scripts/site_centres.ts), and this holds them there, reading every PNG in public/minimaps:
 *
 *   一 every image has an entry and every entry an image; each image tints exactly as many zones as the entry
 *      has sites, and each zone has exactly one circle
 *   二 each site circle's centre is inside its zone (the zone's convex outline) and within TOL of the zone's
 *      centroid
 *   三 each spawn dot lies wholly on the drawn floor (its centre at least the dot's radius from the edge)
 *   四 minimaps.ts is exactly what scripts/site_centres.ts writes today — nobody edited it by hand, and the
 *      images have not been redrawn since it was written
 *
 *   npx tsx scripts/check_minimaps.ts
 */
import { readdirSync } from 'node:fs'
import { MINIMAPS } from '../src/data/minimaps'
import { clearance, deriveAll, pngOf, spawnNeed, tintZones } from './site_centres'
import type { Png, Pt, Zone } from './site_centres'

/** a circle's centre may sit this far (percent of the image) from its zone's centroid: 0.05 is the rounding */
const TOL = 0.5

let bad = 0
const fail = (s: string) => { bad++; console.log(`  ✗ ${s}`) }
const t0 = Date.now()

/** the zone's pixels as squares, their convex outline (monotone chain), in px */
function hullOf(p: Png, z: Zone): [number, number][] {
  const lo = new Map<number, number>()
  const hi = new Map<number, number>()
  for (const i of z.pixels) {
    const x = i % p.w
    const y = (i - x) / p.w
    lo.set(y, Math.min(lo.get(y) ?? Infinity, x))
    hi.set(y, Math.max(hi.get(y) ?? -Infinity, x))
  }
  const pts: [number, number][] = []
  for (const [y, x] of lo) pts.push([x, y], [x, y + 1])
  for (const [y, x] of hi) pts.push([x + 1, y], [x + 1, y + 1])
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q) }
  const upper: [number, number][] = []
  for (const q of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q) }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}
const insideHull = (h: [number, number][], x: number, y: number): boolean => {
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[(i + 1) % h.length]
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false
  }
  return true
}
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1])

console.log('一 二 三 each image against its entry\n')
const images = readdirSync('public/minimaps').filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort()
const entries = Object.keys(MINIMAPS).sort()
for (const m of images) if (!MINIMAPS[m]) fail(`${m}.png has no entry in minimaps.ts — the board would draw nothing on it`)
for (const m of entries) if (!images.includes(m)) fail(`minimaps.ts has ${m} but public/minimaps has no ${m}.png`)

for (const m of entries.filter((x) => images.includes(x))) {
  const e = MINIMAPS[m]
  const p = pngOf(m)
  // MapSchematic reserves a 1024 square for the picture before it loads
  if (p.w !== 1024 || p.h !== 1024) fail(`${m}.png is ${p.w}×${p.h}, MapSchematic's <img> says 1024×1024`)
  const zones = tintZones(p)
  const keys = Object.keys(e.sites)
  if (zones.length !== keys.length) fail(`${m}: the image tints ${zones.length} zones, the entry has ${keys.length} sites (${keys.join('')})`)
  const claimed = new Map<Zone, string>()
  const row: string[] = []
  for (const k of keys) {
    const at = e.sites[k]
    const z = zones.reduce((a, b) => (dist(a.c, at) <= dist(b.c, at) ? a : b))
    if (claimed.has(z)) fail(`${m}: ${k} and ${claimed.get(z)} both sit on the zone at (${z.c[0].toFixed(1)}, ${z.c[1].toFixed(1)})`)
    claimed.set(z, k)
    const d = dist(z.c, at)
    const x = (at[0] / 100) * p.w
    const y = (at[1] / 100) * p.h
    const inside = insideHull(hullOf(p, z), x, y)
    if (!inside) fail(`${m} ${k}: the circle at (${at[0]}, ${at[1]}) is outside its zone`)
    if (d > TOL) fail(`${m} ${k}: the circle at (${at[0]}, ${at[1]}) is ${d.toFixed(2)}% from its zone's centre (${z.c[0].toFixed(2)}, ${z.c[1].toFixed(2)}), over ${TOL}%`)
    row.push(`${k} ${d.toFixed(2)}%${inside ? '' : ' 区外'}`)
  }
  const clr = clearance(p)
  const need = spawnNeed(p)
  const sp: string[] = []
  for (const [side, at] of [['atk', e.atk], ['def', e.def]] as const) {
    const x = Math.min(p.w - 1, Math.floor((at[0] / 100) * p.w))
    const y = Math.min(p.h - 1, Math.floor((at[1] / 100) * p.h))
    const c = clr[y * p.w + x]
    // one px for the rounding to 0.1%
    if (c < need - 1) fail(`${m} ${side}: the spawn dot at (${at[0]}, ${at[1]}) hangs off the floor (its centre ${c.toFixed(0)} px from the edge, the dot's radius ${need.toFixed(0)} px)`)
    sp.push(`${side} ${c.toFixed(0)}px`)
  }
  console.log(`  ${m.padEnd(9)} ${row.join('  ').padEnd(34)} spawn edge ${sp.join(' ')} (dot ${need.toFixed(0)}px)`)
}

console.log('\n四 minimaps.ts is what site_centres.ts writes')
const fresh = deriveAll()
for (const m of Object.keys(fresh)) {
  if (JSON.stringify(fresh[m]) !== JSON.stringify(MINIMAPS[m])) fail(`${m}: minimaps.ts says ${JSON.stringify(MINIMAPS[m])}, the images say ${JSON.stringify(fresh[m])} — run npx tsx scripts/site_centres.ts`)
}
for (const m of entries) if (!fresh[m]) fail(`${m} is in minimaps.ts but not in scripts/minimap_callouts.json`)
if (JSON.stringify(Object.keys(fresh)) !== JSON.stringify(Object.keys(MINIMAPS))) fail('minimaps.ts lists the maps in another order than site_centres.ts writes them')

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (bad) {
  console.log(`\n✗ 地图板有 ${bad} 处不对。`)
  process.exit(1)
}
console.log(`\n✓ ${entries.length} 张地图：每个包点的圈都在官方图着色的下包区里、离区中心不到 ${TOL}%；出生点整颗落在地面上；minimaps.ts 就是脚本从图里读出来的。`)
