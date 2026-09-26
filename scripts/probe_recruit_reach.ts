/**
 * How often the three asks are there to be made (2026-09-26): the research found 要求签人 open in 0 of 21 托管
 * seasons. This walks careers under 托管 and, every professional week, asks whether each ask could be made
 * right now — its gate open and somebody to ask for — under two players: 托管 as it is, and 托管 plus
 * 「与经理沟通」 whenever it can be had (托管 never talks to the manager; a player who wants to ask does).
 *
 *   npx tsx scripts/probe_recruit_reach.ts [seasons=4] [seeds=3,7,11]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { managerTalkBlock, talkToManager } from '../src/engine/me/gmTrust'
import { canSign, signTargets } from '../src/engine/me/clout'
import { pushGate, pushOptions, reinforceGate, reinforceOptions } from '../src/engine/me/recruit'
import type { Region } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, get length() { return 0 },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const seasons = Number(process.argv[2] ?? 4)
const seeds = (process.argv[3] ?? '3,7,11').split(',').map(Number)
const starts: { label: string; year: number; region: Region; start: 't1' | 'pre' }[] = [
  { label: '2021 中国 强队替补', year: 2021, region: 'China', start: 't1' },
  { label: '2026 欧洲 强队替补', year: 2026, region: 'Europe', start: 't1' },
  { label: '2026 中国 从天梯开始', year: 2026, region: 'China', start: 'pre' },
]
type Tally = { weeks: number; reinforce: number; sign: number; push: number; seasonsR: number; seasonsS: number; seasonsP: number; seasons: number; gmSum: number }
const blank = (): Tally => ({ weeks: 0, reinforce: 0, sign: 0, push: 0, seasonsR: 0, seasonsS: 0, seasonsP: 0, seasons: 0, gmSum: 0 })
const total: Record<string, Tally> = { plain: blank(), talk: blank() }
const t0 = Date.now()
for (const st of starts) {
  for (const seed of seeds) {
    for (const policy of ['plain', 'talk'] as const) {
      const s = createCareer({ name: 'Probe', region: st.region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: st.start, seed, year: st.year })
      const T = blank()
      const year0 = s.year
      let year = s.year
      let seen = { r: false, s: false, p: false, pro: false }
      const close = () => { if (seen.pro) { T.seasons++; if (seen.r) T.seasonsR++; if (seen.s) T.seasonsS++; if (seen.p) T.seasonsP++ } }
      let guard = 0
      while (s.year - year0 < seasons && guard++ < 60 * seasons) {
        const me = s.me!
        if (me.phase === 'pro') {
          if (policy === 'talk' && !managerTalkBlock(s)) talkToManager(s)
          const r = reinforceGate(s).ok && reinforceOptions(s).some((o) => !!o.pick)
          const sg = canSign(s).ok && signTargets(s).length > 0
          const p = pushGate(s).ok && pushOptions(s).some((o) => !o.why)
          T.weeks++; T.gmSum += me.gmTrust
          if (r) T.reinforce++
          if (sg) T.sign++
          if (p) T.push++
          seen = { r: seen.r || r, s: seen.s || sg, p: seen.p || p, pro: true }
        }
        if (autoWeek(s).kind === 'game-over') break
        if (s.year !== year) { close(); seen = { r: false, s: false, p: false, pro: false }; year = s.year }
      }
      const pct = (n: number) => (T.weeks ? `${(100 * n / T.weeks).toFixed(0)}%` : '—')
      console.log(`${st.label} · seed ${seed} · ${policy === 'plain' ? '托管' : '托管+沟通'}: ${T.weeks} 职业周，平均经理信任 ${T.weeks ? (T.gmSum / T.weeks).toFixed(0) : '—'}；`
        + `能提：提议补强 ${pct(T.reinforce)}（${T.seasonsR}/${T.seasons} 季）· 点名要人 ${pct(T.sign)}（${T.seasonsS}/${T.seasons} 季）· 推荐替补首发 ${pct(T.push)}（${T.seasonsP}/${T.seasons} 季）`)
      const A = total[policy]
      for (const k of Object.keys(A) as (keyof Tally)[]) A[k] += T[k]
    }
  }
}
for (const [k, A] of Object.entries(total)) {
  const pct = (n: number) => `${(100 * n / Math.max(1, A.weeks)).toFixed(1)}%`
  console.log(`\n合计 ${k === 'plain' ? '托管' : '托管+沟通'}：${A.weeks} 职业周，平均经理信任 ${(A.gmSum / Math.max(1, A.weeks)).toFixed(1)}`)
  console.log(`  提议补强 ${pct(A.reinforce)} 的周，${A.seasonsR}/${A.seasons} 季至少一次`)
  console.log(`  点名要人 ${pct(A.sign)} 的周，${A.seasonsS}/${A.seasons} 季至少一次`)
  console.log(`  推荐替补首发 ${pct(A.push)} 的周，${A.seasonsP}/${A.seasons} 季至少一次`)
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`)
