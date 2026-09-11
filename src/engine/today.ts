import idsRaw from '../data/bridge_2026.json'
import { freeAgentPool } from './prospects'
import { WORLD_TEAMS } from './teams'
import { reachOf } from './timeline'
import type { GameState, Region } from './types'

/**
 * What the game's own 2026 files know that the roster book does not.
 *
 * A world that entered in 2021 reaches 2026 on the book (engine/timeline.ts):
 * its clubs, its people and their ratings carried on out of 2025 the way 2026
 * really opened. The 2026 entrance's files were built separately and are
 * another view of the same people — world.json rates them on its own scale and
 * keeps 78 clubs where the book has 238 — so none of that is laid over this
 * world. Two things in them are not in the book at all, and those arrive as
 * 2026 opens:
 *
 *  - who coaches each club (world.json), for the clubs out of the player's reach
 *  - the professionals below the leagues (prospects.json), as free agents
 *
 * scripts/build_bridge_2026.py wrote which club and which person of those files
 * is which here.
 */

interface Ids { players: Record<string, string>; teams: Record<string, string | null> }
const IDS = idsRaw as unknown as Ids

/** A prospect's country, as the book places clubs (scripts/build_timeline.py COUNTRY_REGION). */
const NAT_REGION: Record<string, Region> = {}
for (const [region, codes] of [
  ['North America', 'us ca'], ['Brazil', 'br'], ['LATAM', 'mx ar cl co pe uy py bo ec ve cr pa gt sv hn ni do pr cu'],
  ['Europe', 'gb uk de fr es it pt nl be se no dk fi pl cz sk at ch ie is ee lv lt hu ro bg gr hr rs si ba mk al me cy lu mt md xk il'],
  ['CIS', 'ru ua by kz uz kg am az ge mn tj tm'], ['Turkey', 'tr'], ['MENA', 'sa ae eg ma dz tn jo kw qa bh om iq lb sy ps ly ye ir'],
  ['South Asia', 'in pk bd lk np'], ['Oceania', 'au nz'], ['Korea', 'kr'], ['Japan', 'jp'], ['China', 'cn'],
  ['Hong Kong & Taiwan', 'tw hk mo'], ['Vietnam', 'vn'], ['Thailand', 'th'], ['Philippines', 'ph'], ['Indonesia', 'id'],
  ['Malaysia & Singapore', 'my sg'], ['SEA', 'kh mm la bn'],
] as [Region, string][]) {
  for (const c of codes.split(' ')) NAT_REGION[c] = region
}

export function arrive2026(state: GameState, notes: string[]): { coaches: number; prospects: number } {
  const { club: mine } = reachOf(state)
  const byId = new Map(WORLD_TEAMS.map((t) => [t.id, t]))
  let coaches = 0
  for (const [T, vlr] of Object.entries(IDS.teams)) {
    if (!vlr) continue
    const id = state.heirs?.[`V21T${vlr}`] ?? `V21T${vlr}`
    const t = state.teams[id]
    const rt = byId.get(T)
    // the player's club keeps the staff it has
    if (!t || t.dormant || id === mine || !rt?.coach || t.coach?.name === rt.coach.name) continue
    t.coach = { ...rt.coach }
    coaches++
  }
  let prospects = 0
  for (const p of freeAgentPool(2026)) {
    // someone the book has already met is here under his vlr id
    if (state.players[p.id] || state.players[`V${p.id.slice(1)}`]) continue
    p.region = NAT_REGION[p.nat ?? ''] ?? p.region
    state.players[p.id] = p
    prospects++
  }
  if (coaches || prospects) {
    const line = `📋 2026 赛季开始：${coaches} 家俱乐部的教练组按真实的 2026 年名单就位，${prospects} 名联赛以下的职业选手进入自由市场。`
    notes.push(line)
    state.news.push({ day: state.day, kind: 'league', text: line })
  }
  return { coaches, prospects }
}
