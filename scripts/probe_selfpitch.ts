/**
 * 自荐 and 主动接触 over whole careers: is it a shortcut, and is the button honest (engine/me/selfpitch.ts).
 *
 *   npx tsx scripts/probe_selfpitch.ts pre [careers=24] [years=3] [year=2026]
 *     the same seeds twice, a serious ladder player: waiting only (托管's week), and the same week with the best
 *     自荐 the transfer screen offers sent whenever one can be — how many transfer periods earlier the first contract
 *     comes; and every answer's chance against what came of it
 *   npx tsx scripts/probe_selfpitch.ts vct [careers=24] [years=2] [year=2026]
 *     a man who never played professionally, writing only to first-tier clubs, kept on the ladder (every call and
 *     every offer set aside, unanswered) so the sample runs on: what the VCT clubs' answers came to
 *   npx tsx scripts/probe_selfpitch.ts pro [careers=12] [seasons=3] [year=2026]
 *     club starts twice: 托管's week, and the same week contacting the best-chance club rated above mine whenever a
 *     contact can be made — moves a transfer period against the control
 *   npx tsx scripts/probe_selfpitch.ts roll [draws=40000]
 *     the draw itself: the engine's answer on each chance from 2% to 75%, many times
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoPlan, autoResolve, autoWeek } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { ORIGINS } from '../src/engine/me/origins'
import { pop } from '../src/engine/me/pending'
import { periodKey } from '../src/engine/me/window'
import { NEVPRO_TOP, ODDS_MAX, ODDS_MIN, pitchBlock, pitchHit, pitchTargets, sendPitch } from '../src/engine/me/selfpitch'
import type { PitchRow } from '../src/engine/me/selfpitch'
import type { EntryYear } from '../src/engine/era'
import type { GameState, Region, Role } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const part = process.argv[2] ?? 'pre'
const N = Number(process.argv[3] ?? (part === 'pro' ? 12 : part === 'roll' ? 40000 : 24))
const YEARS = Number(process.argv[4] ?? (part === 'vct' ? 2 : 3))
const YEAR = Number(process.argv[5] ?? 2026) as EntryYear
const t0 = Date.now()
const REGIONS: Region[] = YEAR <= 2021 ? ['China', 'Korea', 'North America', 'Europe'] : ['China', 'Pacific', 'Americas', 'EMEA']
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

const make = (i: number, start: StartPoint): GameState => createCareer({
  name: `Pitch${i}`, region: REGIONS[i % 4], role: ROLES[Math.floor(i / 4) % 4], talents: emptyTalents(),
  originKey: ORIGINS[i % ORIGINS.length].key, start, seed: 7100 + i * 41, year: YEAR,
})

interface Sent { odds: number; tier: number; nevpro: boolean; ok?: boolean; cancelled?: boolean }
const tallyOf = (s: GameState) => ({ ...(s.me!.pitch?.tally ?? { sent: 0, replied: 0, ok: 0, cancelled: 0, odds: 0 }) })

/** The best 自荐 or contact the transfer screen offers today, among the rows `f` lets through, and send it. */
function pitchBest(s: GameState, f: (r: PitchRow) => boolean, log: Sent[]): Sent | null {
  if (pitchBlock(s)) return null
  const row = pitchTargets(s).rows.filter((r) => !r.why && f(r)).sort((a, b) => b.odds.pct - a.odds.pct)[0]
  if (!row || sendPitch(s, row.team.id)) return null
  const rec: Sent = { odds: row.odds.pct, tier: row.team.tier, nevpro: row.odds.nevpro }
  log.push(rec)
  return rec
}

/** After a week: what came of the one waiting. */
function settle(s: GameState, before: ReturnType<typeof tallyOf>, rec: Sent | null): Sent | null {
  if (!rec) return null
  const now = tallyOf(s)
  if (now.cancelled > before.cancelled) { rec.cancelled = true; return null }
  if (now.replied > before.replied) { rec.ok = now.ok > before.ok; return null }
  return rec
}

const pct = (x: number, n: number) => (n ? `${((x / n) * 100).toFixed(1)}%` : '—')
function calibration(label: string, rows: Sent[]): void {
  const done = rows.filter((r) => r.ok !== undefined)
  const buckets: [number, number][] = [[2, 5], [6, 10], [11, 20], [21, 35], [36, 55], [56, 75]]
  const shown = done.reduce((a, r) => a + r.odds, 0) / Math.max(1, done.length)
  const real = done.filter((r) => r.ok).length
  console.log(`${label}：回复 ${done.length} 份（作废 ${rows.filter((r) => r.cancelled).length}），按钮平均 ${shown.toFixed(1)}%，实际 ${pct(real, done.length)}`)
  for (const [a, b] of buckets) {
    const xs = done.filter((r) => r.odds >= a && r.odds <= b)
    if (!xs.length) continue
    const m = xs.reduce((s, r) => s + r.odds, 0) / xs.length
    const k = xs.filter((r) => r.ok).length
    const se = Math.sqrt((m / 100) * (1 - m / 100) / xs.length) * 100
    console.log(`  ${a}–${b}%：${xs.length} 份，按钮 ${m.toFixed(1)}%，实际 ${pct(k, xs.length)}（抽样误差 ±${(2 * se).toFixed(1)} 点）`)
  }
}

if (part === 'roll') {
  // the draw alone: each chance, `N` answers on fresh ids
  let worst = 0
  const lines: string[] = []
  for (let odds = ODDS_MIN; odds <= ODDS_MAX; odds++) {
    let k = 0
    const n = Math.round(N / (ODDS_MAX - ODDS_MIN + 1))
    for (let i = 0; i < n; i++) if (pitchHit({ seed: 91 } as GameState, { id: `roll:${odds}:${i}`, teamId: 'x', kind: 'pitch', year: 2026, day: 0, due: 0, odds })) k++
    const d = (k / n) * 100 - odds
    worst = Math.max(worst, Math.abs(d))
    if (odds % 8 === 2 || odds === ODDS_MAX) lines.push(`${odds}% → ${((k / n) * 100).toFixed(1)}%`)
  }
  console.log(`抽签：每个把握 ${Math.round(N / (ODDS_MAX - ODDS_MIN + 1))} 次 · ${lines.join(' · ')} · 最大偏差 ${worst.toFixed(2)} 点`)
}

if (part === 'pre') {
  const log: Sent[] = []
  const rows: { i: number; region: Region; wait: number | null; self: number | null; sent: number; ok: number; via: string }[] = []
  const periodsOf = (s: GameState) => periodKey(s.year, s.day) - periodKey(YEAR, 0)
  for (let i = 0; i < N; i++) {
    // waiting only
    const a = make(i, 'pre')
    let g = 0
    while (a.me!.phase !== 'pro' && a.year < YEAR + YEARS && a.me!.phase !== 'retired' && g++ < YEARS * 60) if (autoWeek(a).kind === 'game-over') break
    const wait = a.me!.phase === 'pro' ? periodsOf(a) : null
    // the same seed, writing the best 自荐 whenever one can go
    const b = make(i, 'pre')
    const mine: Sent[] = []
    let rec: Sent | null = null
    g = 0
    while (b.me!.phase !== 'pro' && b.year < YEAR + YEARS && b.me!.phase !== 'retired' && g++ < YEARS * 60) {
      if (!rec && b.me!.pending.length === 0) rec = pitchBest(b, () => true, mine)
      const before = tallyOf(b)
      const stop = autoWeek(b)
      rec = settle(b, before, rec)
      if (stop.kind === 'game-over') break
    }
    const self = b.me!.phase === 'pro' ? periodsOf(b) : null
    const club = b.me!.phase === 'pro' ? b.teams[b.myTeam] : undefined
    const via = club ? (b.me!.log.some((l) => l.text.includes(`${club.name}（`) && /回复了你的自荐/.test(l.text)) ? '自荐' : '等来的') : '-'
    log.push(...mine)
    rows.push({ i, region: REGIONS[i % 4], wait, self, sent: mine.length, ok: mine.filter((x) => x.ok).length, via })
    process.stderr.write(`pre ${i + 1}/${N} ${REGIONS[i % 4]}: 只等 ${wait ?? '没签'} · 自荐 ${self ?? '没签'}（发 ${mine.length} 成 ${mine.filter((x) => x.ok).length}，${via}）\n`)
  }
  const both = rows.filter((r) => r.wait != null && r.self != null)
  const diff = both.map((r) => r.wait! - r.self!)
  const mean = diff.reduce((s, x) => s + x, 0) / Math.max(1, diff.length)
  const med = diff.slice().sort((x, y) => x - y)[Math.floor(diff.length / 2)] ?? 0
  console.log(`\n职业前 ${N} 条 × 最多 ${YEARS} 年（${YEAR} 起，同种子）：`)
  console.log(`  只等邀请：签约 ${rows.filter((r) => r.wait != null).length} 条，第一份合同平均在第 ${(rows.filter((r) => r.wait != null).reduce((s, r) => s + r.wait!, 0) / Math.max(1, rows.filter((r) => r.wait != null).length)).toFixed(2)} 个转会期`)
  console.log(`  会自荐：  签约 ${rows.filter((r) => r.self != null).length} 条，第一份合同平均在第 ${(rows.filter((r) => r.self != null).reduce((s, r) => s + r.self!, 0) / Math.max(1, rows.filter((r) => r.self != null).length)).toFixed(2)} 个转会期；${rows.filter((r) => r.via === '自荐').length} 条签的是自荐来的那家`)
  console.log(`  两边都签了的 ${both.length} 条：自荐早 ${mean.toFixed(2)} 个转会期（中位 ${med}），早两个转会期以上的 ${diff.filter((x) => x >= 2).length} 条，反而晚的 ${diff.filter((x) => x < 0).length} 条`)
  console.log(`  自荐一共发 ${log.length} 份，平均每条 ${(log.length / N).toFixed(1)} 份`)
  calibration('  把握对账', log)
}

import { startTryout, tryoutChoose, tryoutDays } from '../src/engine/me/tryout'

if (part === 'vct') {
  const log: Sent[] = []
  let trials = 0
  let signed = 0
  for (let i = 0; i < N; i++) {
    const s = make(i, 'pre')
    const me = s.me!
    let rec: Sent | null = null
    let g = 0
    while (s.year < YEAR + YEARS && me.phase === 'pre' && g++ < YEARS * 60) {
      // kept on the ladder: every call and offer set aside unanswered, so he stays a man who never played professionally —
      // except what a first-tier club's yes to a 自荐 comes to: its tryout played the steady way, and whether terms follow
      const clear = (): void => {
        let k = 0
        while (me.pending.length && k++ < 30) {
          const item = me.pending[0]
          const inv = item.kind === 'invite' ? me.pre.invites.find((x) => x.id === item.id) : undefined
          const club = inv ? s.teams[inv.teamId] : undefined
          if (inv && club && inv.via === 'self' && club.tier === 1 && !me.tryout) {
            trials++
            if (startTryout(s, inv.id) === null) { let t = 0; while (me.tryout && t++ < 6) tryoutChoose(s, tryoutDays(s)[me.tryout.step].rec) }
            if (me.deals.some((d) => d.teamId === club.id)) signed++
            for (const d of me.deals) pop(s, 'deal', d.id)
            me.deals = []
            me.declined = []
            continue
          }
          if (item.kind === 'invite') { me.pre.invites = me.pre.invites.filter((x) => x.id !== item.id); pop(s, 'invite', item.id) }
          else if (item.kind === 'deal') { me.deals = me.deals.filter((x) => x.id !== item.id); pop(s, 'deal', item.id) }
          else autoResolve(s, item)
        }
        me.pre.invites = []
      }
      clear()
      if (!rec) rec = pitchBest(s, (r) => r.team.tier === 1, log)
      const before = tallyOf(s)
      autoPlan(s)
      let stop = advanceWeek(s)
      let k = 0
      while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && k++ < 40) {
        if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
        else clear()
        stop = advanceWeek(s)
      }
      rec = settle(s, before, rec)
      if (stop.kind === 'game-over') break
    }
    process.stderr.write(`vct ${i + 1}/${N} ${REGIONS[i % 4]}: 发 ${log.length}\n`)
  }
  const nev = log.filter((r) => r.nevpro)
  console.log(`\n没打过职业、只投 ${YEAR >= 2023 ? 'VCT' : '一线'}：${N} 条 × ${YEARS} 年（${YEAR} 起）`)
  calibration('  投一线的回复', nev)
  const capped = nev.filter((r) => r.odds === NEVPRO_TOP).length
  console.log(`  按钮是封顶 ${NEVPRO_TOP}% 的 ${capped} 份，最低 ${ODDS_MIN}% 的 ${nev.filter((r) => r.odds === ODDS_MIN).length} 份`)
  console.log(`  一线俱乐部回复「来试训」${trials} 份：试训打完拿到合同 ${signed} 份（占投一线的回复 ${pct(signed, nev.filter((r) => r.ok !== undefined).length)}）`)
}

if (part === 'pro') {
  const log: Sent[] = []
  let movesA = 0
  let movesB = 0
  let periodsA = 0
  let periodsB = 0
  const everyA: number[] = []
  const everyB: number[] = []
  for (let i = 0; i < N; i++) {
    const start: StartPoint = i % 2 ? 't1' : 'chal'
    const run = (contact: boolean): { moves: number; periods: number; moved: Set<number> } => {
      const s = make(i, start)
      const me = s.me!
      let rec: Sent | null = null
      let g = 0
      let periods = 0
      let last = periodKey(s.year, s.day)
      const moved = new Set<number>()
      let club = s.myTeam
      while (s.year < YEAR + YEARS && me.phase !== 'retired' && g++ < YEARS * 60) {
        if (contact && !rec && me.phase === 'pro' && me.pending.length === 0) {
          const mine = s.teams[s.myTeam]
          rec = pitchBest(s, (r) => r.team.rating > (mine?.rating ?? 0), log)
        }
        const before = tallyOf(s)
        const stop = autoWeek(s)
        rec = settle(s, before, rec)
        const key = periodKey(s.year, s.day)
        if (key !== last) { if (me.phase === 'pro') periods++; last = key }
        if (me.phase === 'pro' && s.myTeam !== club) { if (club) moved.add(key); club = s.myTeam }
        if (me.phase !== 'pro') club = ''
        if (stop.kind === 'game-over') break
      }
      const moves = [...me.log].filter((l) => l.text.startsWith('签约 ')).length
      return { moves, periods: Math.max(1, periods), moved }
    }
    const a = run(false)
    const b = run(true)
    movesA += a.moves
    movesB += b.moves
    periodsA += a.periods
    periodsB += b.periods
    everyA.push(a.moved.size)
    everyB.push(b.moved.size)
    process.stderr.write(`pro ${i + 1}/${N} ${REGIONS[i % 4]} ${start}: 转会 ${a.moves} → ${b.moves}（${a.periods} / ${b.periods} 个转会期）\n`)
  }
  const sent = log.length
  console.log(`\n有合同 ${N} 条 × ${YEARS} 季（${YEAR} 起，chal / t1 各半，同种子）：`)
  console.log(`  托管的周：签约 ${movesA} 次 / ${periodsA} 个职业转会期 = 每转会期 ${(movesA / periodsA).toFixed(2)}`)
  console.log(`  每期接触：签约 ${movesB} 次 / ${periodsB} 个职业转会期 = 每转会期 ${(movesB / periodsB).toFixed(2)}；接触 ${sent} 次，成 ${log.filter((r) => r.ok).length} 次`)
  console.log(`  换过俱乐部的转会期（每条）：托管 ${everyA.join(' ')} · 接触 ${everyB.join(' ')}`)
  calibration('  接触的把握对账', log)
}

console.log(`\n（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
