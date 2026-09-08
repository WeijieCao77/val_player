/**
 * Simplified floor plans of the real maps, drawn by hand from their layouts.
 *
 * A 100×100 square, defenders at the top, attackers at the bottom. Each map
 * lists its sites, both spawns, the main lanes as polylines from the attacker
 * spawn, and the odd link (Bind's teleporters, Fracture's ziplines). Nothing
 * here is a navigation mesh — it is the drawing a coach makes on a whiteboard
 * so a round has a place to happen on screen.
 *
 * Coordinates are approximate on purpose and easy to move: fix a shape here,
 * nothing else changes.
 */
export type Pt = [number, number]

export interface MapSchematic {
  /** site letter → centre */
  sites: Record<string, Pt>
  atk: Pt
  def: Pt
  /** mid, if the map has one worth naming */
  mid?: Pt
  /** attacker lanes: first point at (or near) the attacker spawn, last point at a site */
  lanes: { to: string; label: string; pts: Pt[] }[]
  /** teleporters / ziplines / ropes */
  links?: { kind: 'tp' | 'zip' | 'rope'; from: Pt; to: Pt }[]
  /** rough playable outline, as an SVG path in the same square */
  floor?: string
}

const two = (aName = 'A', bName = 'B'): Record<string, Pt> => ({ [aName]: [76, 26], [bName]: [24, 26] })

export const MAP_SCHEMATICS: Record<string, MapSchematic> = {
  Ascent: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[52, 90], [78, 76], [80, 48], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[48, 90], [22, 76], [20, 48], [24, 26]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 62], [52, 44], [66, 32], [76, 26]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 62], [48, 44], [34, 32], [24, 26]] },
    ],
    floor: 'M14 14 H86 V40 H70 V60 H86 V86 H14 V60 H30 V40 H14 Z',
  },
  Bind: {
    sites: two(), atk: [50, 92], def: [50, 8],
    lanes: [
      { to: 'A', label: 'A 短道', pts: [[52, 90], [66, 72], [72, 50], [76, 26]] },
      { to: 'A', label: 'A 浴室', pts: [[54, 90], [86, 70], [86, 44], [76, 26]] },
      { to: 'B', label: 'B 长道', pts: [[46, 90], [14, 70], [14, 44], [24, 26]] },
      { to: 'B', label: 'B 水烟', pts: [[48, 90], [36, 68], [30, 46], [24, 26]] },
    ],
    links: [{ kind: 'tp', from: [88, 62], to: [34, 56] }, { kind: 'tp', from: [12, 52], to: [68, 58] }],
    floor: 'M10 12 H90 V88 H60 V70 H40 V88 H10 Z',
  },
  Haven: {
    sites: { A: [78, 28], B: [50, 22], C: [22, 28] }, atk: [50, 92], def: [50, 8],
    lanes: [
      { to: 'A', label: 'A 长道', pts: [[54, 90], [82, 72], [82, 46], [78, 28]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 62], [50, 40], [50, 22]] },
      { to: 'C', label: 'C 长道', pts: [[46, 90], [18, 72], [18, 46], [22, 28]] },
      { to: 'C', label: '车库 → C', pts: [[48, 90], [34, 66], [30, 46], [22, 28]] },
    ],
    floor: 'M10 12 H90 V90 H10 Z',
  },
  Split: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [80, 74], [80, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [20, 74], [20, 46], [24, 26]] },
      { to: 'A', label: '中路 → A 天台', pts: [[50, 90], [50, 60], [58, 40], [76, 26]] },
      { to: 'B', label: '中路 → B 天台', pts: [[50, 90], [50, 60], [42, 40], [24, 26]] },
    ],
    links: [{ kind: 'rope', from: [58, 40], to: [66, 30] }, { kind: 'rope', from: [42, 40], to: [34, 30] }],
    floor: 'M12 12 H88 V88 H62 V56 H38 V88 H12 Z',
  },
  Icebox: {
    sites: { A: [78, 22], B: [24, 28] }, atk: [50, 92], def: [50, 8], mid: [50, 48],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [76, 72], [80, 46], [78, 22]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [24, 72], [22, 48], [24, 28]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 64], [44, 44], [30, 34], [24, 28]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 64], [58, 44], [70, 30], [78, 22]] },
    ],
    links: [{ kind: 'zip', from: [58, 44], to: [64, 26] }],
    floor: 'M12 10 H88 V90 H12 Z',
  },
  Breeze: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 52],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[56, 90], [82, 74], [84, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[44, 90], [18, 74], [16, 46], [24, 26]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 66], [54, 46], [68, 34], [76, 26]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 66], [46, 46], [32, 34], [24, 26]] },
    ],
    floor: 'M8 10 H92 V90 H8 Z',
  },
  Fracture: {
    sites: { A: [24, 46], B: [76, 46] }, atk: [50, 92], def: [50, 16],
    lanes: [
      { to: 'A', label: 'A 侧', pts: [[46, 90], [16, 78], [14, 60], [24, 46]] },
      { to: 'B', label: 'B 侧', pts: [[54, 90], [84, 78], [86, 60], [76, 46]] },
      { to: 'A', label: '滑索 → A 塔', pts: [[50, 90], [50, 74], [30, 62], [24, 46]] },
      { to: 'B', label: '滑索 → B 塔', pts: [[50, 90], [50, 74], [70, 62], [76, 46]] },
    ],
    links: [{ kind: 'zip', from: [50, 88], to: [12, 72] }, { kind: 'zip', from: [50, 88], to: [88, 72] }],
    floor: 'M8 10 H92 V90 H8 Z M38 28 H62 V72 H38 Z',
  },
  Pearl: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 46],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [80, 72], [82, 44], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [20, 72], [18, 44], [24, 26]] },
      { to: 'A', label: '中路 → A 连接', pts: [[50, 90], [50, 62], [54, 46], [68, 32], [76, 26]] },
      { to: 'B', label: '中路 → B 连接', pts: [[50, 90], [50, 62], [46, 46], [32, 32], [24, 26]] },
    ],
    floor: 'M10 10 H90 V90 H10 Z',
  },
  Lotus: {
    sites: { A: [78, 28], B: [50, 22], C: [22, 28] }, atk: [50, 92], def: [50, 8],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [82, 74], [82, 48], [78, 28]] },
      { to: 'B', label: 'B 主通道', pts: [[50, 90], [50, 64], [50, 42], [50, 22]] },
      { to: 'C', label: 'C 主通道', pts: [[46, 90], [18, 74], [18, 48], [22, 28]] },
      { to: 'A', label: 'A 连接（转门）', pts: [[50, 90], [50, 64], [64, 46], [78, 28]] },
      { to: 'C', label: 'C 连接（转门）', pts: [[50, 90], [50, 64], [36, 46], [22, 28]] },
    ],
    floor: 'M8 12 H92 V90 H8 Z',
  },
  Sunset: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [80, 74], [80, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [20, 74], [20, 46], [24, 26]] },
      { to: 'A', label: '中路 → A 连接', pts: [[50, 90], [50, 62], [56, 44], [68, 32], [76, 26]] },
      { to: 'B', label: '中路 → B 市场', pts: [[50, 90], [50, 62], [44, 44], [32, 32], [24, 26]] },
    ],
    floor: 'M10 10 H90 V90 H10 Z',
  },
  Abyss: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [78, 74], [80, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [22, 74], [20, 46], [24, 26]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 62], [56, 44], [76, 26]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 62], [44, 44], [24, 26]] },
    ],
    floor: 'M14 14 H86 V86 H14 Z',
  },
  Corrode: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [78, 74], [80, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [22, 74], [20, 46], [24, 26]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 62], [56, 44], [76, 26]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 62], [44, 44], [24, 26]] },
    ],
    floor: 'M10 10 H90 V90 H10 Z',
  },
  Summit: {
    sites: two(), atk: [50, 92], def: [50, 8], mid: [50, 50],
    lanes: [
      { to: 'A', label: 'A 主通道', pts: [[54, 90], [78, 74], [80, 46], [76, 26]] },
      { to: 'B', label: 'B 主通道', pts: [[46, 90], [22, 74], [20, 46], [24, 26]] },
      { to: 'A', label: '中路 → A', pts: [[50, 90], [50, 62], [56, 44], [76, 26]] },
      { to: 'B', label: '中路 → B', pts: [[50, 90], [50, 62], [44, 44], [24, 26]] },
    ],
    floor: 'M10 10 H90 V90 H10 Z',
  },
}

export const GENERIC_SCHEMATIC: MapSchematic = MAP_SCHEMATICS.Sunset

export const schematicFor = (map: string): MapSchematic => MAP_SCHEMATICS[map] ?? GENERIC_SCHEMATIC
