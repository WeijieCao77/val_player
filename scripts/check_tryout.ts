/**
 * The four gates from invitation to signature.
 *
 * 邀请 → 试训 → 评级 → 谈判. Each of the four has to actually be reachable and
 * actually be able to end badly — a tryout you always pass and a negotiation
 * that never blows up are decoration.
 *
 * And the answer 「不」: a club turned down, a renewal refused, stays away for
 * the rest of that year — and only that year, as the screen says.
 *
 *   npx tsx scripts/check_tryout.ts [seeds=8]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { clubBars, reachableClubs, tryoutSkill } from '../src/engine/me/prepro'
import { GRADE_TEXT, gradeOf, tryoutDays } from '../src/engine/me/tryout'
import { ASKS, askDeal, declineDeal, makeDeal } from '../src/engine/me/contract'
import { vctNeeds } from '../src/engine/me/transfer'
import { regionIn } from '../src/engine/era'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import { Rng, hashStr } from '../src/engine/rng'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17].slice(0, Number(process.argv[2] ?? 8))

const grades: Record<string, number> = {}
let signed = 0
let neverSigned = 0
let blown = 0
let asked = 0
let agreed = 0

for (const seed of SEEDS) {
  const state = createCareer({
    name: 'Probe', region: 'China', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed,
  })
  const me = state.me!
  // walk the pre-pro years and record every grade handed out
  const seenGrades = new Set<string>()
  let guard = 0
  while (me.phase === 'pre' && guard++ < 60 * 5) {
    const before = me.tryout?.grade
    if (autoWeek(state).kind === 'game-over') break
    void before
    for (const l of me.log) {
      const m = l.text.match(/试训评级 <b>(A\+|A|B|C|D)<\/b>/)
      if (m && !seenGrades.has(`${l.day}:${m[1]}`)) { seenGrades.add(`${l.day}:${m[1]}`); grades[m[1]] = (grades[m[1]] ?? 0) + 1 }
    }
  }
  if (me.phase === 'pro') signed++
  else neverSigned++

  // and push a fresh offer until it either lands or blows up. The autopilot
  // has already signed whatever was on the table, so one is made here rather
  // than waiting for a leftover — the first run of this probe reported
  // 「提了 0 次」, which tested nothing.
  const teamId = state.players[me.id].teamId ?? Object.keys(state.teams)[0]
  const deal = makeDeal(state, teamId, 'sign', 'B', new Rng(hashStr(`probe:deal:${seed}`)))
  me.deals.push(deal)
  for (const a of ASKS) {
    if (!me.deals.find((x) => x.id === deal.id)) break
    if (!a.can(deal)) continue
    asked++
    const r = askDeal(state, deal.id, a.key, new Rng(hashStr(`probe:${seed}:${a.key}`)))
    if (r.ok) agreed++
    if (r.blown && !me.deals.find((x) => x.id === deal.id)) { blown++; break }
  }
}

console.log(`${SEEDS.length} 个档，每档最多跑五年职业前\n`)
console.log('试训评级分布：' + (['A+', 'A', 'B', 'C', 'D'].map((g) => `${g} ${grades[g] ?? 0}`).join(' · ') || '（没有一次试训）'))
console.log(`签上约的 ${signed} 个，五年没上岸的 ${neverSigned} 个`)
console.log(`谈判：提了 ${asked} 次，答应 ${agreed} 次，谈崩 ${blown} 次`)

// every grade needs its sentence, or a letter reaches the player with nothing attached
const missing = ['A+', 'A', 'B', 'C', 'D'].filter((g) => !GRADE_TEXT[g])
// the boundary values of gradeOf must land where the screen says they do
const bounds: [number, string][] = [[16, 'A+'], [15.9, 'A'], [8, 'A'], [7.9, 'B'], [0, 'B'], [-0.1, 'C'], [-9, 'C'], [-9.1, 'D']]
const wrong = bounds.filter(([v, g]) => gradeOf(v) !== g)

// a pro trialling elsewhere skips day one
const probe = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7,
})
const proDays = tryoutDays(probe).length
const rookieDays = 4

let bad = 0
if (missing.length) { bad++; console.log(`✗ 这些评级没有对应的话：${missing.join('、')}`) }
if (wrong.length) { bad++; console.log(`✗ 评级分界和面板写的不一致：${wrong.map(([v, g]) => `${v}→${gradeOf(v)}（应为 ${g}）`).join('、')}`) }
if (proDays !== 3) { bad++; console.log(`✗ 职业选手的试训应该是 3 天（跳过单排考核），实际 ${proDays} 天`) }
if (!asked) { bad++; console.log('✗ 谈判一次都没跑到，这一段根本没被检查。') }
if (asked && !blown) { console.log('⚠ 这批种子里没有一次谈崩——不一定是 bug，但值得看一眼。') }
console.log(`\n试训天数：新人 ${rookieDays} 天 · 已经打过职业 ${proDays} 天`)

const bars = clubBars(probe)
console.log(`门槛阶梯（你 ${Math.round(tryoutSkill(probe))}）：` + bars.map((b) => `${b.name} ${b.expect}${b.ok ? '（够了）' : `（差 ${b.gap}）`}`).join(' · '))
if (!bars.length) { bad++; console.log('✗ 门槛阶梯是空的。') }

// 「今年不再来」: turned down in year Y, a club stays away for the rest of Y and may come again in Y+1.
// The year is moved by hand around pure reads (vctNeeds, reachableClubs), and put back.
{
  const s = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7,
  })
  const m = s.me!
  const p = s.players[m.id]
  const y = s.year
  const inYear = <T>(year: number, read: () => T): T => { s.year = year; try { return read() } finally { s.year = y } }
  // a Challengers man every VCT club of his league would start
  for (const k of ATTR_KEYS) p.attrs[k] = 95
  recomputeOverall(p)
  const league = regionIn(s.teams[s.myTeam].region, y)
  const asks = (id: string) => vctNeeds(s, league).some((n) => n.team.id === id)
  const vct = vctNeeds(s, league)[0]?.team.id
  const parts: string[] = []
  if (!vct) { bad++; console.log('✗ 探针设置不对：综合 95 的 Challengers 选手，本联赛却没有一家 VCT 俱乐部用得着他。') } else {
    const offer = makeDeal(s, vct, 'transfer', 'B', new Rng(hashStr('probe:declined')))
    m.deals.push(offer)
    declineDeal(s, offer.id)
    const same = asks(vct)
    const next = inYear(y + 1, () => asks(vct))
    parts.push(`拒绝报价：${y} 年${same ? '又来了' : '不再来'}，${y + 1} 年${next ? '可以再来' : '还是不来'}`)
    if (same) { bad++; console.log(`✗ ${y} 年拒绝了 ${s.teams[vct].name} 的报价，同一年它又出现在来找你的 VCT 俱乐部里。`) }
    if (!next) { bad++; console.log(`✗ ${y} 年拒绝了 ${s.teams[vct].name}，${y + 1} 年它还是不来——「今年不再来」应该只管这一年。`) }
    // a save from before kept the club with no year: that has lapsed
    const keep = m.declined
    m.declined = [vct] as unknown as typeof m.declined
    const old = asks(vct)
    m.declined = keep
    parts.push(`老存档里没有年份的记录：${old ? '已失效' : '还在挡'}`)
    if (!old) { bad++; console.log('✗ 老存档里没有年份的回绝记录应该当作已过期，现在还在挡着这家俱乐部。') }
  }
  // the renewal refused: he goes on the spot, and the club does not come back for him that year
  const club = s.myTeam
  const renew = makeDeal(s, club, 'renew', 'B', new Rng(hashStr('probe:renew')))
  m.deals.push(renew)
  declineDeal(s, renew.id)
  const reach = () => reachableClubs(s, 99).some((t) => t.id === club)
  const same = reach()
  const next = inYear(y + 1, reach)
  const keep = m.declined
  m.declined = []
  const control = inYear(y + 1, reach)
  m.declined = keep
  parts.push(`拒绝续约：${m.phase === 'free' ? '当场成了自由人' : `还是 ${m.phase}`}，${y} 年${same ? '又来了' : '不再来'}，${y + 1} 年${next ? '可以再来' : control ? '还是不来' : '（这家俱乐部那年本来就不招人，没测到）'}`)
  if (m.phase !== 'free') { bad++; console.log('✗ 拒绝续约应该当场成为自由人。') }
  if (same) { bad++; console.log(`✗ ${y} 年拒绝了 ${s.teams[club].name} 的续约，同一年它又出现在能去试训的俱乐部里。`) }
  if (control && !next) { bad++; console.log(`✗ ${y} 年拒绝了 ${s.teams[club].name} 的续约，${y + 1} 年它还是不来。`) }
  console.log(`\n今年不再来：${parts.join(' · ')}`)
}

console.log(bad ? '\n✗ 有问题。' : '\n✓ 四段都走得通，评级有分布、谈判会崩、门槛看得见；回绝过的俱乐部当年不再来，第二年可以再来。')
if (bad) process.exit(1)
