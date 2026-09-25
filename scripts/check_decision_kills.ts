/**
 * A landed call that was me taking the fight has my kill in its round (reported 2026-09-24:
 * 「决策成功了击杀数也应该增加，或者调高触发1v3/4/5的概率，不然成功绕后却一个人都不杀有点奇怪」).
 *
 * 一 of the landed calls whose option is me taking the fight (me/nodes.ts landedKills), almost none end with no
 *    kill of mine in the round — 37% did (3000 BO3s at 1c44607: 890 of 2402) — and the line said about it reads
 *    the kills the box shows
 * 二 only who took the kills moved: on every map my side's kills are still their side's deaths, nobody has more
 *    opening kills than kills, and a quad, an ace or a 1vX line on a round still names a man with those kills
 * 三 a hide, a fake, a held line or a call on the voice is not credited: its k0 line can still be read
 *
 *   npx tsx scripts/check_decision_kills.ts [matches=300]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MeMatch } from '../src/engine/me/matchplay'
import { NODES, landedKills, nodeLine } from '../src/engine/me/nodes'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) bad++ }

const N = Number(process.argv[2] ?? 300)
const byId = new Map(NODES.map((n) => [n.id, n]))
const base = createCareer({ name: 'Kills', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2024 })
base.teams[base.myTeam].starters = [base.me!.id, ...base.teams[base.myTeam].starters.filter((x) => x !== base.me!.id)].slice(0, 5)
const myTeam = base.myTeam
const opp = Object.values(base.teams).filter((t) => t.id !== myTeam && t.tier === base.teams[myTeam].tier && t.roster.length >= 5)
  .sort((a, b) => Math.abs(a.rating - base.teams[myTeam].rating) - Math.abs(b.rating - base.teams[myTeam].rating))[0]
const json = JSON.stringify(base)

let fight = 0, fightZero = 0, lineWrong = 0, plain = 0, plainZero = 0, boxWrong = 0, firstWrong = 0, hlWrong = 0, hlSeen = 0
for (let i = 0; i < N; i++) {
  const s = JSON.parse(json) as GameState
  s.seed = 700 + i
  const mm = new MeMatch(s, { aId: myTeam, bId: opp.id, bo: 3, comp: 'test', label: '决赛' })
  const rec = mm.runOut()
  if (!rec.started) continue
  for (const e of mm.nodes) {
    if (!e.ok || e.id == null || e.opt == null || e.won == null) continue
    const node = byId.get(e.id)!
    if (landedKills(node, e.opt, e.won)) {
      fight++
      if (!e.kills) fightZero++
    } else if (typeof (nodeLine(e.id, e.opt, true, { won: e.won, kills: 0 }).kills) === 'number') {
      plain++
      if (!e.kills) plainZero++
    }
    // the line on the call reads the kills the box shows
    if (e.hl && !e.hl.startsWith(nodeLine(e.id, e.opt, e.ok, { won: e.won, kills: e.kills ?? 0 }).text)) lineWrong++
  }
  const mine = new Set(s.teams[myTeam].roster)
  for (const m of mm.sim.played) {
    const ids = Object.keys(m.lines)
    const ourKills = ids.filter((id) => mine.has(id)).reduce((x, id) => x + m.lines[id].kills, 0)
    const theirDeaths = ids.filter((id) => !mine.has(id)).reduce((x, id) => x + m.lines[id].deaths, 0)
    if (ourKills !== theirDeaths) boxWrong++
    if (ids.some((id) => m.lines[id].firstKills > m.lines[id].kills)) firstWrong++
    // a round's quad / ace / 1vX line names somebody with at least that many kills on the map
    for (const r of m.rounds ?? []) {
      for (const h of r.hl ?? []) {
        const who = ids.find((id) => h.includes(s.players[id]?.ign ?? '\u0000') && /五杀|带走四个/.test(h))
        if (who) hlSeen++
        if (who && /五杀/.test(h) && m.lines[who].kills < 5) hlWrong++
        if (who && /带走四个/.test(h) && m.lines[who].kills < 4) hlWrong++
      }
    }
  }
}
const share = fightZero / Math.max(1, fight)
check(fight > 50 && share <= 0.05, `一：我亲自去打的决策成功了，这回合没有我的击杀的只剩 ${(share * 100).toFixed(1)}%（${fightZero}/${fight}；修之前 37%）`)
check(lineWrong === 0, `一：决策那一行按我这回合真实的击杀数挑（${lineWrong} 处对不上）`)
check(boxWrong === 0 && firstWrong === 0, `二：每张图我方击杀 = 对面阵亡，首杀不多于击杀（${boxWrong} / ${firstWrong} 处不对）`)
check(hlSeen > 0 && hlWrong === 0, `二：回合里的四杀、五杀还是那个人的（${hlSeen} 条，${hlWrong} 处不对）`)
check(plain > 0 && plainZero > 0, `三：藏、假拆、看住一条路这类决策不硬塞击杀（${plainZero}/${plain} 次成功时本回合没有我的击杀）`)

console.log(bad ? `\n${bad} 项不对` : '\n决策与击杀：全部通过')
process.exit(bad ? 1 : 0)
