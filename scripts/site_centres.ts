/**
 * Where the match map board puts its site circles and spawn dots (src/data/minimaps.ts), read off the
 * official minimaps themselves (public/minimaps/<Map>.png).
 *
 * Reported 2026-09-19 by the author with a screenshot of the match board on Sunset: 「地图里AB的位置标的是歪的，
 * 不在下包区的中心」. The circles sat where valorant-api.com's callouts put the words 「A Site」「B Site」, and that
 * is where the in-game minimap prints the name, not where the plant zone is: on Sunset B the circle stood at the
 * far left edge (4.4%, 56%), a whole zone below and left of the tint (13%, 42%); Pearl's A, Breeze's B, Split's A
 * were a zone off as well. The API's transform is right — every other callout lands on its corridor — only
 * the label spot is not the zone.
 *
 * So the sites come from the picture. Each image paints its plant zones one flat yellow-green over the grey
 * floor (floor r = g = b; the tint ≈ (144, 144, 112), yellowness (r+g)/2−b ≈ 32): every opaque pixel at
 * yellowness ≥ TINT_MIN is tint. Pixels closer than MERGE_PX (Chebyshev) are one zone — a zone is often cut
 * by a wall or a box drawn over it (Sunset B, Fracture A, Icebox A) — and the circle goes on the zone's
 * centroid. Which zone is which letter: the API's 「A Site」「B Site」「C Site」 callout, each to its nearest
 * zone, one zone per letter or the script stops.
 *
 * The spawns are not painted, so they stay where the API's 「Attacker/Defender Side Spawn」 callout puts them,
 * unless the dot (MapSchematic's r = SPAWN_R) would not fit on the floor there: then it moves to the nearest
 * spot where the whole dot is on the floor. That pulls in Pearl's two (both past the edge of their room),
 * Sunset's two, Bind's attackers and a few that overhung a wall. One callout is plain wrong and is given here
 * by hand (HINT_FIX).
 *
 *   npx tsx scripts/site_centres.ts          rewrites src/data/minimaps.ts
 *
 * Its inputs: the PNGs and scripts/minimap_callouts.json (the API's own positions, as fractions of the image),
 * both written by scripts/fetch_minimaps.ts. scripts/check_minimaps.ts holds the result to the pictures.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export type Pt = [number, number]
export interface MapPoints { sites: Record<string, Pt>; atk: Pt; def: Pt }

/** yellowness (r+g)/2−b that counts as the site tint: the floor sits at 0, the tint at about 32 (any cut from 8 to 28 moves a centre under 0.5%) */
export const TINT_MIN = 16
/** a pixel is part of the drawing when it is at least this opaque (the ground around the map is transparent) */
export const OPAQUE = 100
/** tint pixels this close (px on the 1024 image, either axis) belong to one zone */
export const MERGE_PX = 12
/** a patch of tint smaller than this is not a plant zone (none exist today; a zone is 3,700 px and up) */
export const MIN_ZONE_PX = 1000
/** the spawn dot's radius in MapSchematic, in percent of the image */
export const SPAWN_R = 3.2

/**
 * The API's Summit 「Attacker Side Spawn」 is at game (1100, −100), which puts it at (4%, 90%): 26% of the image
 * away from anything drawn. Its x (image height 89.6%) is the height of the one dead end on the attackers'
 * side, the stem under both lobbies; the y it pairs with is not. The stem's middle column is used instead
 * (the defenders' spawn above sits at 51%).
 */
const HINT_FIX: Record<string, Partial<Record<'atk' | 'def', Pt>>> = {
  Summit: { atk: [50.5, 89.6] },
}

// ------------------------------------------------------------------ the picture

export interface Png { w: number; h: number; px: Uint8Array }

/** 8-bit RGBA, not interlaced — what valorant-api.com ships; anything else is refused rather than misread */
export function readPng(path: string): Png {
  const b = readFileSync(path)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`)
  let w = 0
  let h = 0
  const idat: Buffer[] = []
  for (let i = 8; i < b.length;) {
    const len = b.readUInt32BE(i)
    const type = b.toString('latin1', i + 4, i + 8)
    const data = b.subarray(i + 8, i + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${path}: depth ${data[8]} colour ${data[9]} interlace ${data[12]}, want 8-bit RGBA flat`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    i += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[row + x - 4] : 0
      const up = y > 0 ? px[row - stride + x] : 0
      const c = x >= 4 && y > 0 ? px[row - stride + x - 4] : 0
      const v = raw[src + x]
      let o: number
      if (f === 0) o = v
      else if (f === 1) o = v + a
      else if (f === 2) o = v + up
      else if (f === 3) o = v + ((a + up) >> 1)
      else if (f === 4) {
        const p = a + up - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - c)
        o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)
      } else throw new Error(`${path}: filter ${f} on row ${y}`)
      px[row + x] = o & 255
    }
  }
  return { w, h, px }
}

export const pngOf = (map: string): Png => readPng(`public/minimaps/${map}.png`)

/** the tint: opaque and yellow-green over the grey floor */
export function tintMask(p: Png): Uint8Array {
  const m = new Uint8Array(p.w * p.h)
  for (let i = 0; i < m.length; i++) {
    const r = p.px[i * 4]
    const g = p.px[i * 4 + 1]
    const b = p.px[i * 4 + 2]
    if (p.px[i * 4 + 3] > OPAQUE && (r + g) / 2 - b >= TINT_MIN) m[i] = 1
  }
  return m
}

/** the drawn floor, walls' lines included: anything opaque */
export function floorMask(p: Png): Uint8Array {
  const m = new Uint8Array(p.w * p.h)
  for (let i = 0; i < m.length; i++) if (p.px[i * 4 + 3] > OPAQUE) m[i] = 1
  return m
}

export interface Zone {
  /** centroid, percent of the image */
  c: Pt
  n: number
  /** the zone's own tint pixels, as indices y*w+x */
  pixels: Int32Array
}

/** the tint's zones, biggest first */
export function tintZones(p: Png): Zone[] {
  const { w, h } = p
  const m = tintMask(p)
  // grow the tint by MERGE_PX both ways (a square), then the grown shapes are the zones
  const rowGrown = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let last = -1e9
    for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= MERGE_PX) rowGrown[y * w + x] = 1 }
    last = 1e9
    for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= MERGE_PX) rowGrown[y * w + x] = 1 }
  }
  const grown = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    let last = -1e9
    for (let y = 0; y < h; y++) { if (rowGrown[y * w + x]) last = y; if (y - last <= MERGE_PX) grown[y * w + x] = 1 }
    last = 1e9
    for (let y = h - 1; y >= 0; y--) { if (rowGrown[y * w + x]) last = y; if (last - y <= MERGE_PX) grown[y * w + x] = 1 }
  }
  const label = new Int32Array(w * h)
  const stack: number[] = []
  const zones: Zone[] = []
  let next = 0
  for (let s = 0; s < w * h; s++) {
    if (!grown[s] || label[s]) continue
    next++
    label[s] = next
    stack.push(s)
    const mine: number[] = []
    while (stack.length) {
      const i = stack.pop()!
      if (m[i]) mine.push(i)
      const x = i % w
      const y = (i - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (grown[j] && !label[j]) { label[j] = next; stack.push(j) }
        }
      }
    }
    if (mine.length < MIN_ZONE_PX) continue
    let sx = 0
    let sy = 0
    for (const i of mine) { sx += (i % w) + 0.5; sy += Math.floor(i / w) + 0.5 }
    zones.push({ c: [(sx / mine.length / w) * 100, (sy / mine.length / h) * 100], n: mine.length, pixels: Int32Array.from(mine) })
  }
  return zones.sort((a, b) => b.n - a.n)
}

/** each pixel's distance (px) to the nearest pixel off the floor — exact Euclidean (Felzenszwalb & Huttenlocher) */
export function clearance(p: Png): Float64Array {
  const { w, h } = p
  const floor = floorMask(p)
  const INF = 1e12
  const d = new Float64Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = floor[i] ? INF : 0
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const out = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const pass = (len: number) => {
    let k = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x]
    pass(h)
    for (let y = 0; y < h; y++) d[y * w + x] = out[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x]
    pass(w)
    for (let x = 0; x < w; x++) d[y * w + x] = Math.sqrt(out[x])
  }
  return d
}

// ------------------------------------------------------------------ the points

const r1 = (n: number): number => Math.round(n * 10) / 10
const pxOf = (p: Png, pt: Pt): [number, number] => [
  Math.min(p.w - 1, Math.max(0, Math.floor((pt[0] / 100) * p.w))),
  Math.min(p.h - 1, Math.max(0, Math.floor((pt[1] / 100) * p.h))),
]

/** the spawn dot's centre must be this far (px) from the edge of the floor for the whole dot to be on it */
export const spawnNeed = (p: Png): number => (SPAWN_R / 100) * p.w

/** the hint if the whole dot fits there, else the nearest spot where it does */
export function fitSpawn(p: Png, clr: Float64Array, hint: Pt): { at: Pt; moved: number } {
  const [hx, hy] = pxOf(p, hint)
  // one px of room so the rounding to 0.1% cannot tip it back over
  const need = spawnNeed(p) + 1
  if (clr[hy * p.w + hx] >= need) return { at: hint, moved: 0 }
  const tx = (hint[0] / 100) * p.w
  const ty = (hint[1] / 100) * p.h
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < clr.length; i++) {
    if (clr[i] < need) continue
    const x = (i % p.w) + 0.5
    const y = Math.floor(i / p.w) + 0.5
    const dd = (x - tx) ** 2 + (y - ty) ** 2
    if (dd < bestD) { bestD = dd; best = i }
  }
  if (best < 0) throw new Error('no spot on the floor fits the spawn dot')
  const at: Pt = [r1((((best % p.w) + 0.5) / p.w) * 100), r1(((Math.floor(best / p.w) + 0.5) / p.h) * 100)]
  return { at, moved: Math.hypot(at[0] - hint[0], at[1] - hint[1]) }
}

/** each lettered callout to its nearest zone; one zone per letter and every zone lettered, or it throws */
export function letterZones(map: string, zones: Zone[], hints: Record<string, Pt>): Record<string, Zone> {
  const keys = Object.keys(hints)
  if (zones.length !== keys.length) throw new Error(`${map}: ${zones.length} tinted zones for ${keys.length} sites (${keys.join('')})`)
  const out: Record<string, Zone> = {}
  const taken = new Set<Zone>()
  for (const k of keys) {
    const h = hints[k]
    const z = zones.reduce((a, b) => (Math.hypot(a.c[0] - h[0], a.c[1] - h[1]) <= Math.hypot(b.c[0] - h[0], b.c[1] - h[1]) ? a : b))
    if (taken.has(z)) throw new Error(`${map}: ${k} Site's callout is nearest a zone already lettered`)
    taken.add(z)
    out[k] = z
  }
  return out
}

export const CALLOUTS = 'scripts/minimap_callouts.json'
export const readCallouts = (): Record<string, MapPoints> => JSON.parse(readFileSync(CALLOUTS, 'utf8')) as Record<string, MapPoints>

/** every map in the callouts file, its points from its picture */
export function deriveAll(log = false): Record<string, MapPoints> {
  const api = readCallouts()
  const out: Record<string, MapPoints> = {}
  for (const [map, a] of Object.entries(api)) {
    const p = pngOf(map)
    const zones = letterZones(map, tintZones(p), a.sites)
    const sites: Record<string, Pt> = {}
    for (const k of Object.keys(a.sites)) sites[k] = [r1(zones[k].c[0]), r1(zones[k].c[1])]
    const clr = clearance(p)
    const fix = HINT_FIX[map] ?? {}
    const atk = fitSpawn(p, clr, fix.atk ?? a.atk)
    const def = fitSpawn(p, clr, fix.def ?? a.def)
    out[map] = { sites, atk: atk.at, def: def.at }
    if (log) {
      const s = Object.keys(sites).map((k) => `${k} ${fmt(a.sites[k])}→${fmt(sites[k])} (${Math.hypot(sites[k][0] - a.sites[k][0], sites[k][1] - a.sites[k][1]).toFixed(1)})`).join('  ')
      const sp = (name: string, from: Pt, r: { at: Pt; moved: number }, fixed: boolean) =>
        `${name} ${fmt(from)}${fixed ? '（改）' : ''}${r.moved ? `→${fmt(r.at)} (${r.moved.toFixed(1)})` : ''}`
      console.log(`${map.padEnd(9)} ${s}   ${sp('atk', a.atk, atk, !!fix.atk)}  ${sp('def', a.def, def, !!fix.def)}`)
    }
  }
  return out
}
const fmt = (p: Pt): string => `(${p[0]}, ${p[1]})`

export function writeMinimaps(log = true): void {
  const out = deriveAll(log)
  const ts = `/**
 * Where the sites and spawns sit on each official minimap, as percentages of
 * the image: each site circle on the centroid of the plant zone the image
 * tints, each spawn on the game's own callout, pulled onto the floor where the
 * dot would overhang it. Generated by scripts/site_centres.ts from
 * public/minimaps/*.png and scripts/minimap_callouts.json — do not edit by
 * hand, re-run the script (scripts/check_minimaps.ts holds it to the images).
 */
export type MiniPt = [number, number]
export interface MiniMap { sites: Record<string, MiniPt>; atk: MiniPt; def: MiniPt }
export const MINIMAPS: Record<string, MiniMap> = ${JSON.stringify(out, null, 2)}
`
  writeFileSync('src/data/minimaps.ts', ts)
  if (log) console.log('wrote src/data/minimaps.ts')
}

if ((process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/site_centres.ts')) writeMinimaps()
