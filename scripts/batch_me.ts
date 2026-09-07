/**
 * Many careers, one table. What the numbers say about the balance:
 * how soon a contract comes, where, how many starts, titles, fans, money,
 * events, traits, endings. Run after every change that touches a number.
 *
 *   npx tsx scripts/batch_me.ts [runs=24] [seasons=10] [start=pre]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { ORIGINS } from '../src/engine/me/origins'
import { fanTier } from '../src/engine/me/fans'
import type { Region, Role } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const runs = Number(process.argv[2] ?? 24)
const seasons = Number(process.argv[3] ?? 10)
const start = (process.argv[4] ?? 'pre') as StartPoint
const REGIONS: Region[] = ['China', 'Pacific', 'Americas', 'EMEA']
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

interface Row {
  seed: number; region: Region; role: Role; origin: string
  signedYear: number; entryTier: number; proSeasons: number; starts: number; matches: number; startRate: number
  wins: number; titles: number; masters: number; champs: number; regional: number
  clubs: number; abroad: boolean; fans: number; tier: string; money: number; salary: number
  events: number; traits: number; ach: number; ending: string; retiredAge: number; overall: number
  nodes: number; nodeOk: number; storedStarts: number; weeks: number; crashed: string
}

const rows: Row[] = []
const t0 = Date.now()
for (let i = 0; i < runs; i++) {
  const seed = 1000 + i * 37
  const region = REGIONS[i % 4]
  const role = ROLES[Math.floor(i / 4) % 4]
  const origin = ORIGINS[i % ORIGINS.length].key
  const state = createCareer({ name: `Bot${i}`, region, role, talents: emptyTalents(), originKey: origin, start, seed })
  const me = state.me!
  const p = state.players[me.id]
  let weeks = 0
  let crashed = ''
  let signedYear = 0
  let entryTier = 0
  try {
    while (state.year < 2026 + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
      const stop = autoWeek(state)
      weeks++
      if (!signedYear && me.phase === 'pro') { signedYear = state.year; entryTier = state.teams[state.myTeam].tier }
      if (stop.kind === 'game-over') break
    }
  } catch (e) {
    crashed = String((e as Error).message ?? e).slice(0, 80)
  }
  const played = me.matches.filter((m) => !m.friendly)
  const started = played.filter((m) => m.started)
  const nodes = started.flatMap((m) => m.nodes)
  const pro = me.seasons.filter((s) => s.tier > 0)
  rows.push({
    seed, region, role, origin, signedYear, entryTier,
    proSeasons: pro.length, starts: pro.reduce((s, x) => s + x.starts, 0), matches: pro.reduce((s, x) => s + x.matches, 0),
    startRate: 0, wins: pro.reduce((s, x) => s + x.wins, 0),
    titles: me.titles.length, masters: me.titles.filter((t) => /Masters/.test(t.title)).length,
    champs: me.titles.filter((t) => /Champions/.test(t.title)).length,
    regional: me.titles.filter((t) => !/Masters|Champions/.test(t.title)).length,
    clubs: new Set((p.clubHist ?? []).map((h) => h.team)).size, abroad: (me.flags.abroadSeasons ?? 0) > 0,
    fans: Math.round(me.fans), tier: fanTier(me.fans).name, money: Math.round(me.money), salary: p.salary,
    events: me.eventsSeen, traits: me.traits.length, ach: me.achievements.length,
    ending: me.ending?.title ?? '(未退役)', retiredAge: me.ending ? p.age : 0, overall: p.overall,
    nodes: nodes.length, nodeOk: nodes.filter((n) => n.ok).length, storedStarts: started.length, weeks, crashed,
  })
  rows[rows.length - 1].startRate = rows[rows.length - 1].matches ? rows[rows.length - 1].starts / rows[rows.length - 1].matches : 0
  process.stderr.write(`run ${i + 1}/${runs} ${region} ${role} ${origin} → ${me.ending?.title ?? me.phase} ${crashed ? 'CRASH ' + crashed : ''}\n`)
}

const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`
const count = (f: (r: Row) => boolean) => rows.filter(f).length
console.log(`\n${rows.length} careers × ${seasons} seasons from '${start}' in ${((Date.now() - t0) / 1000).toFixed(0)}s; crashes ${count((r) => !!r.crashed)}`)
console.log(`signed: never ${pct(count((r) => !r.signedYear))} · year1 ${pct(count((r) => r.signedYear === 2026))} · year2 ${pct(count((r) => r.signedYear === 2027))} · later ${pct(count((r) => r.signedYear > 2027))}`)
console.log(`entry: T1 ${pct(count((r) => r.entryTier === 1))} · T2 ${pct(count((r) => r.entryTier === 2))}`)
console.log(`pro seasons med ${med(rows.map((r) => r.proSeasons))} · start rate med ${(med(rows.map((r) => r.startRate)) * 100).toFixed(0)}% · starts med ${med(rows.map((r) => r.starts))}`)
console.log(`titles: any ${pct(count((r) => r.titles > 0))} · regional ${pct(count((r) => r.regional > 0))} · Masters ${pct(count((r) => r.masters > 0))} · Champions ${pct(count((r) => r.champs > 0))} · double-year ${pct(count((r) => r.masters > 0 && r.champs > 0))}`)
console.log(`clubs med ${med(rows.map((r) => r.clubs))} · abroad ${pct(count((r) => r.abroad))} · overall end med ${med(rows.map((r) => r.overall))}`)
console.log(`fans med ${med(rows.map((r) => r.fans))} · tiers: ${Object.entries(rows.reduce((m, r) => ({ ...m, [r.tier]: (m[r.tier] ?? 0) + 1 }), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
console.log(`money med $${med(rows.map((r) => r.money)).toLocaleString()} · salary med $${med(rows.map((r) => r.salary)).toLocaleString()}`)
console.log(`events med ${med(rows.map((r) => r.events))} · traits: ${[0, 1, 2].map((n) => `${n}:${count((r) => r.traits === n)}`).join(' ')} · achievements med ${med(rows.map((r) => r.ach))}`)
console.log(`nodes/stored match ${(rows.reduce((s, r) => s + r.nodes, 0) / Math.max(1, rows.reduce((s, r) => s + r.storedStarts, 0))).toFixed(1)} · node ok ${Math.round(100 * rows.reduce((s, r) => s + r.nodeOk, 0) / Math.max(1, rows.reduce((s, r) => s + r.nodes, 0)))}%`)
console.log(`endings: ${Object.entries(rows.reduce((m, r) => ({ ...m, [r.ending]: (m[r.ending] ?? 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
console.log(`retired age med ${med(rows.filter((r) => r.retiredAge).map((r) => r.retiredAge))}`)
console.log('\nseed region role origin | signed T | seasons starts/matches wins | titles(R/M/C) clubs abroad | fans money | ev tr ach | ending')
for (const r of rows) console.log(`${r.seed} ${r.region} ${r.role} ${r.origin} | ${r.signedYear || '-'} T${r.entryTier} | ${r.proSeasons} ${r.starts}/${r.matches} ${r.wins} | ${r.titles}(${r.regional}/${r.masters}/${r.champs}) ${r.clubs} ${r.abroad ? '海' : ''} | ${r.fans} $${Math.round(r.money / 1000)}k | ${r.events} ${r.traits} ${r.ach} | ${r.ending}${r.crashed ? ' CRASH ' + r.crashed : ''}`)
