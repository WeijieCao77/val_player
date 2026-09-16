/**
 * 转会窗口的两个量，改前改后同一个脚本都能跑（engine/me/window.ts）：
 *
 *  一、正赛席位的锁定从哪天开始：每家在自己第一场比赛之前被锁了几天（中位、最大）
 *  二、生涯里的报价和试训邀请：2023 / 2026 起步，VCT 和 Challengers 各一组，每职业季多少份
 *
 *   npx tsx scripts/probe_window_phase.ts [careers=4] [seasons=3]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { eventOf, eventsOf, floorOf } from '../src/engine/circuit'
import type { CEvent } from '../src/engine/circuit'
import { setupSeason } from '../src/engine/season'
import type { Competition, GameState, Region, Role } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const careers = Number(process.argv[2] ?? 4)
const seasons = Number(process.argv[3] ?? 3)
const t0 = Date.now()
const med = (xs: number[]): number => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : 0)

/* ---- 一、席位的锁定从哪天开始 ---- */
/** the seats an event's own matches are drawn from, and the first day each of them plays */
function seatDays(ev: CEvent): Map<number, number> {
  const out = new Map<number, number>()
  for (const u of ev.units) {
    if (u.type === 'open') continue
    for (const n of u.nodes ?? []) for (const s of [n.a, n.b]) {
      if (s[0] !== 's') continue
      const had = out.get(s[1])
      if (had == null || n.day < had) out.set(s[1], n.day)
    }
  }
  return out
}
/** the event drawn as history had it, nothing played */
function asHistory(s: GameState, ev: CEvent): Competition {
  const seeds = ev.projected ? [] : ev.seeds.map((v) => (s.teams[`V21T${v}`] ? `V21T${v}` : null))
  return {
    key: `ev:${ev.id}`, name: ev.cn, stage: ev.stage ?? 'offseason', teams: [...new Set(seeds.filter((x): x is string => !!x))],
    standings: {}, finished: [], format: 'circuit',
    circuit: { id: ev.id, start: ev.start!, end: ev.end!, seeds, mode: 'history' },
  }
}

{
  const base = createCareer({ name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 77, year: 2026 })
  for (const Y of [2023, 2024, 2025, 2026]) {
    const s = structuredClone(base) as GameState
    s.year = Y
    s.day = 0
    setupSeason(s)
    const lead: number[] = []
    const cut: number[] = []
    for (const comp of Object.values(s.comps)) {
      const ev = comp.circuit && eventOf(comp.circuit.id)
      if (!ev || ev.start == null) continue
      const c = asHistory(s, ev)
      s.comps[comp.key] = c
      const seats = seatDays(ev)
      const held = floorOf(s, c) as unknown as Map<string, number> | Set<string>
      const day = (id: string): number => (held instanceof Map ? held.get(id) ?? c.circuit!.start : c.circuit!.start)
      for (const [i, first] of seats) {
        const id = c.circuit!.seeds[i]
        if (!id || !(held instanceof Map ? held.has(id) : held.has(id))) continue
        // days the roster is locked before the club's own first match, and how many of them this rule gives back
        lead.push(Math.max(0, first - day(id)))
        cut.push(Math.max(0, day(id) - c.circuit!.start))
      }
    }
    // the seats the rule moves at all: how long they were held before their own first match
    const moved = lead.filter((_, i) => cut[i] > 0)
    const movedLead = cut.map((d, i) => lead[i] + d).filter((_, i) => cut[i] > 0)
    console.log(`${Y}：${lead.length} 个正赛席位 · 第一场之前锁着 中位 ${med(lead)} 天、最多 ${Math.max(0, ...lead)} 天 · 比赛事第一天晚锁 中位 ${med(cut)} 天、最多 ${Math.max(0, ...cut)} 天`)
    console.log(`     其中 ${moved.length} 个席位晚锁了：这些席位改之前第一场前锁 中位 ${med(movedLead)} 天、最多 ${Math.max(0, ...movedLead)} 天，改之后 中位 ${med(moved)} 天、最多 ${Math.max(0, ...moved)} 天`)
  }
}

/* ---- 二、生涯里的报价和试训邀请 ---- */
const PLACES_2026: [Region, StartPoint][] = [
  ['Europe', 'chal'], ['Americas', 't1'], ['Pacific', 'chal'], ['EMEA', 't1'],
  ['Americas', 'chal'], ['Pacific', 't1'], ['China', 't1'], ['EMEA', 'chal'],
]
// 2023 年只有三个联赛，赛区名也只有这几个
const PLACES_2023: [Region, StartPoint][] = [
  ['Americas', 'chal'], ['Americas', 't1'], ['EMEA', 'chal'], ['EMEA', 't1'],
  ['Pacific', 'chal'], ['Pacific', 't1'], ['Americas', 't1'], ['EMEA', 'chal'],
]
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
const OFFER = /开价了|直接开了报价|想请你去试训|那边给首发|按之前谈的开出了报价/
const INVITE = /想请你去试训|邀请你去试训|来找你——/
for (const year of [2023, 2026] as const) {
  const tot: Record<string, { offers: number; invites: number; pro: number; moves: number }> = {
    t1: { offers: 0, invites: 0, pro: 0, moves: 0 }, chal: { offers: 0, invites: 0, pro: 0, moves: 0 },
  }
  const PLACES = year === 2023 ? PLACES_2023 : PLACES_2026
  for (let i = 0; i < careers; i++) {
    const [region, start] = PLACES[i % PLACES.length]
    const s = createCareer({ name: `Win${i}`, region, role: ROLES[i % 4], talents: emptyTalents(), originKey: 'netcafe', start, seed: 4100 + i * 53, year })
    const me = s.me!
    const box = tot[start]
    let weeks = 0
    while (s.year < year + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
      const last = me.log[me.log.length - 1]
      const wasPro = me.phase === 'pro'
      if (autoWeek(s).kind === 'game-over') break
      weeks++
      for (const l of me.log.slice(last ? me.log.lastIndexOf(last) + 1 : 0)) {
        if (INVITE.test(l.text)) box.invites++
        if (l.kind !== 'deal') continue
        if (OFFER.test(l.text)) box.offers++
        if (wasPro && l.text.startsWith('签约 ')) box.moves++
      }
    }
    box.pro += me.seasons.filter((x) => x.tier > 0).length
  }
  for (const [k, v] of Object.entries(tot)) {
    const n = Math.max(1, v.pro)
    console.log(`${year} 起 ${k === 't1' ? 'VCT' : 'Challengers'}：报价每职业季 ${(v.offers / n).toFixed(2)} · 试训邀请每职业季 ${(v.invites / n).toFixed(2)} · 转会 ${v.moves} 次（${v.pro} 个职业季）`)
  }
}
console.log(`（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
