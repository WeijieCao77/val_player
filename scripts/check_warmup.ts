/**
 * 决赛入场's warm-up: applied on the maps, and said on the pre-match card (reported 2026-09-24:
 * 「不是决赛热身没有用呀，进去还是劣势啊」).
 *
 * 一 a gold warm-up puts its edge on the opening round of every map and on every call; bronze takes some off;
 *    silver leaves nothing, and the edge is gone once its three days are
 * 二 the pre-match card says what it gave, and that the verdict above it reads the two fives alone
 * 三 the result card no longer claims 「每张图开局就占优」
 *
 *   npx tsx scripts/check_warmup.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { CEREMONIES, cerApply, cerMatchEdge, cerMatchLine, cerStart } from '../src/engine/me/ceremony'
import { MeMatch } from '../src/engine/me/matchplay'
import type { GameState } from '../src/engine/types'
import type { CerTier } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) bad++ }

const base = createCareer({ name: 'Warm', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2024 })
const json = JSON.stringify(base)
const opp = Object.values(base.teams).find((t) => t.id !== base.myTeam && t.tier === base.teams[base.myTeam].tier && t.roster.length >= 5)!

function walkOut(tier: CerTier | null): GameState {
  const s = JSON.parse(json) as GameState
  if (tier) {
    cerStart(s, 'final', '测试 总决赛')
    cerApply(s, tier, false)
  }
  return s
}
/** my side's edge on the first round of the first map, and the call's chance term */
function opening(s: GameState): number {
  const mm = new MeMatch(s, { aId: s.myTeam, bId: opp.id, bo: 3, comp: 'test', label: '总决赛' })
  while (mm.step() !== 'map-start') { /* to the first map */ }
  return mm.map!.nudge[mm.side!]
}

const none = walkOut(null), gold = walkOut('gold'), silver = walkOut('silver'), bronze = walkOut('bronze')
check(opening(none) === 0 && opening(silver) === 0, '一：没热身、银档，第一张图开局没有额外的手感')
check(opening(gold) > 0 && cerMatchEdge(gold).node > 0, `一：金档，每张图开局带着手感进去（+${opening(gold)}），决策成功率也加上`)
check(opening(bronze) < 0 && cerMatchEdge(bronze).node < 0, '一：铜档，开局吃亏一点，决策也难成一点')
const later = JSON.parse(JSON.stringify(gold)) as GameState
later.day += 4
check(cerMatchEdge(later).nudge === 0 && cerMatchLine(later, true) === null, '一：三天一过，热身就不算了，赛前也不再提')

const g = cerMatchLine(gold, false) ?? ''
check(g.includes('金档') && g.includes('实力对比') && !/\d/.test(g), `二：金档在赛前卡上说清给了什么、没给什么（数值关）：「${g}」`)
check((cerMatchLine(gold, true) ?? '').includes('+5%'), `二：数值开时写出决策成功率：「${cerMatchLine(gold, true)}」`)
check((cerMatchLine(bronze, false) ?? '').includes('没找到手感'), `二：铜档照实说：「${cerMatchLine(bronze, false)}」`)
check(cerMatchLine(silver, true) === null && cerMatchLine(none, true) === null, '二：银档、没热身，赛前卡不多一行')

check(!Object.values(CEREMONIES.final.blurb).some((t) => t.includes('开局就占优')), '三：结果卡不再说「每张图开局就占优」')

console.log(bad ? `\n${bad} 项不对` : '\n决赛热身：全部通过')
process.exit(bad ? 1 : 0)
