/**
 * 数值调研 · 名字对照 — measure only, changes nothing.
 *
 * What the world a career opens in says about people a VALORANT follower can
 * check: the whole rating table at the start of 2021 and of 2026, and where a
 * named handle sits in it. Written for the 2026-09-20 survey, beside
 * scripts/probe_balance.ts.
 *
 *   npx tsx scripts/probe_names.ts <out.json> [name ...]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { GameState, Player } from '../src/engine/types'
import { writeFileSync } from 'node:fs'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const out: Record<string, unknown> = {}
const row = (state: GameState, p: Player) => {
  const t = p.teamId ? state.teams[p.teamId] : undefined
  return {
    ign: p.ign, real: p.realName ?? null, o: p.overall, pot: p.potential, age: p.age,
    team: t?.name ?? '(无)', tier: t?.tier ?? 0, league: t?.league ?? '', role: String(p.role), region: String(p.region),
  }
}

for (const year of [2021, 2026] as const) {
  const state = createCareer({
    name: 'Probe', region: year === 2021 ? 'Europe' : 'EMEA', role: '决斗者',
    talents: emptyTalents(), originKey: 'net', start: 'pre', seed: 4242, year,
  })
  const on = Object.values(state.players).filter((p) => p.id !== state.me?.id && p.teamId && !state.teams[p.teamId]?.dormant)
  const all = on.slice().sort((a, b) => b.overall - a.overall).map((p) => row(state, p))
  out[String(year)] = {
    n: all.length,
    hist: Object.fromEntries([99, 96, 95, 94, 92, 90, 88, 85, 80, 75, 70].map((v) => [v, all.filter((r) => r.o >= v).length])),
    top60: all.slice(0, 60),
    // a league's starters, so the words (职业级 / 一流 / 顶级 / 世界级) can be checked against who wears them
    tier1: all.filter((r) => r.tier === 1).map((r) => r.o),
    tier2: all.filter((r) => r.tier === 2).map((r) => r.o),
  }
  for (const q of process.argv.slice(3)) {
    const hit = all.find((r) => r.ign.toLowerCase() === q.toLowerCase())
    if (hit) (out[String(year)] as Record<string, unknown>)[`?${q}`] = hit
  }
}
writeFileSync(process.argv[2] ?? 'names.json', JSON.stringify(out, null, 1))
console.log('names written')
