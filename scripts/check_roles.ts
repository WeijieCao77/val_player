/**
 * 阵容位置 (the author's rule, 2026-09-20): 「一个队伍里至少要有一个指挥，一个决斗，一个先锋，
 * 一个烟位（控场），一个哨位，最后一个可以是其他的位置的自由人」 — and the report it came from:
 * 「玩家反映他选的哨卫，但是去 PRX 替换掉的是 something 而不是 d4v41，something 不是决斗吗？」
 *
 * 一 every club's five carries the four jobs, one man one job, whenever its own roster can —
 *    and a club whose roster cannot is as close as the roster allows, never worse
 * 二 the caller goes out with the team, at every club that has one
 * 三 a joining or promoted player takes the place of a man who plays his job: the sentinel's,
 *    not the second duelist's — 2026's Paper Rex is the case that was reported, and a duelist,
 *    a controller and an initiator are asked of a club strong at their job and one weak at it
 * 四 the four screens agree about who he is competing with: 对位挑战 (me/coach.ts duelTarget),
 *    the man the coach's own five drops for him, and the 转会 page's 「比首发 X 强」 /
 *    「缺控场」 (me/selfpitch.ts needOf, me/transfer.ts vctNeeds)
 * 五 a weak specialist does not walk into a strong five, and a clearly better one does
 * 六 over a run of careers, how often a club's five doubles up on a job
 *
 *   npx tsx scripts/check_roles.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { coachStarters, coachView, duelTarget, promiseSeat } from '../src/engine/me/coach'
import { needOf } from '../src/engine/me/selfpitch'
import { autoStarters, confidentRating } from '../src/engine/world'
import { CORE_ROLES, jobsOf, mainJobs, placeFor, roleGaps, shapeOf } from '../src/engine/five'
import { callerOf } from '../src/engine/roster'
import { recomputeOverall } from '../src/engine/player'
import { autoWeek } from '../src/engine/me/auto'
import type { GameState, Player, Role } from '../src/engine/types'

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

let fails = 0
const fail = (m: string) => { fails++; console.log(`  ✗ ${m}`) }
const ok = (c: boolean, m: string) => { if (!c) fail(m) }
const t0 = Date.now()

const card = (p: Player) => `${p.ign}[${(p.roles ?? [p.role]).join('')}${p.isIgl ? '·指挥' : ''} ${p.overall}]`
const line = (s: GameState, ids: string[]) => ids.map((id) => card(s.players[id])).join(' · ')

const WORLDS = [2021, 2026] as const
const worlds = WORLDS.map((year) => ({
  year,
  s: createCareer({ name: 'Role', region: 'Pacific', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7, year }),
}))

console.log('一、每支队都排得出四个位置')
for (const { year, s } of worlds) {
  let clubs = 0, short = 0, worse = 0
  const said: string[] = []
  for (const t of Object.values(s.teams)) {
    if (t.id.startsWith('CUP_') || t.roster.length < 5) continue
    clubs++
    const squad = t.roster.map((id) => s.players[id]).filter((p): p is Player => !!p)
    const five = autoStarters(s, t.id).map((id) => s.players[id])
    ok(five.length === 5 && new Set(five.map((p) => p.id)).size === 5, `${t.tag} 的首发不是五个不同的人：${five.map((p) => p.ign).join(' ')}`)
    const gaps = roleGaps(five)
    const best = roleGaps(squad)
    if (best.length) short++
    if (gaps.length > best.length) {
      worse++
      said.push(`${t.tag} 缺${gaps.join('、')}，名单里明明排得出（${squad.map(card).join(' ')}）`)
    }
  }
  ok(worse === 0, `${year}：${worse} 支队的首发少排了位置：${said.slice(0, 3).join('；')}`)
  console.log(`  ${year}：${clubs} 支队，名单本身就缺位置的 ${short} 支，首发比名单还差的 ${worse} 支`)
}

console.log('二、指挥跟着队伍上场')
for (const { year, s } of worlds) {
  let withCaller = 0, out = 0
  const said: string[] = []
  for (const t of Object.values(s.teams)) {
    if (t.id.startsWith('CUP_') || t.roster.length < 5) continue
    const caller = callerOf(s, t.id)
    if (!caller) continue
    withCaller++
    const five = autoStarters(s, t.id)
    if (!five.includes(caller.id)) { out++; said.push(`${t.tag} 的 ${caller.ign}`) }
  }
  ok(out === 0, `${year}：${out} 支队把指挥放在替补席：${said.slice(0, 4).join('、')}`)
  console.log(`  ${year}：${withCaller} 支有指挥的队，指挥不在首发的 ${out} 支`)
}

/** a career player put on a club's roster at the level asked, with the contract asked */
function joinAs(year: 2021 | 2026, role: Role, tag: string, overall: number, promise: 'starter' | 'rotation') {
  const s = createCareer({ name: 'Me', region: 'Pacific', role, talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7, year })
  const me = s.me!
  const p = s.players[me.id]
  const old = s.teams[s.myTeam]
  const team = Object.values(s.teams).find((t) => t.tag === tag)
  if (!team) return null
  old.roster = old.roster.filter((id) => id !== p.id)
  old.starters = old.starters.filter((id) => id !== p.id)
  s.myTeam = team.id
  p.teamId = team.id
  p.contract = { ...p.contract!, promisedRole: promise }
  for (const k of Object.keys(p.attrs) as (keyof Player['attrs'])[]) p.attrs[k] = overall
  recomputeOverall(p)
  p.overall = overall
  // a professional's sample, so the rookie discount is not what this is about
  p.rounds = 3000
  // the coach's own five before I arrive, read the same way it will be read after
  const before = coachStarters(s)
  team.starters = before
  team.roster = [...team.roster, p.id]
  team.starters = coachStarters(s)
  return { s, p, team, before, after: team.starters }
}

console.log('三、顶掉的是打他这个位置的人')
{
  // the reported case: a sentinel signs for Paper Rex on a starting contract
  const prx = joinAs(2026, '哨卫', 'PRX', 70, 'starter')!
  const { s } = prx
  const out = prx.before.filter((id) => !prx.after.includes(id)).map((id) => s.players[id])
  console.log(`  2026 PRX 之前：${line(s, prx.before)}`)
  console.log(`         之后：${line(s, prx.after)}`)
  ok(promiseSeat(s) === 'start', '（检查本身）首发合同的保底场次没有生效，这一节测不到签约就进首发')
  ok(prx.after.includes(prx.p.id), '签了首发合同的哨卫没有进首发')
  ok(out.length === 1 && jobsOf(out[0]).includes('哨卫'),
    `哨卫加入 PRX，顶掉的是 ${out.map(card).join('、')}——他不打哨位`)
  ok(roleGaps(prx.after.map((id) => s.players[id])).length === 0, `哨卫进了 PRX 的首发以后，四个位置排不齐`)
}
for (const { year, s } of worlds) {
  // every club of the top division, for each of the four jobs, at a level that earns a place —
  // so a club strong at that job and a club weak at it are both among the cases
  const clubs = Object.values(s.teams).filter((t) => t.tier === 1 && t.roster.length >= 5).slice(0, 14)
  let cases = 0, his = 0, forced = 0
  const bad: string[] = []
  for (const t of clubs) {
    if (t.starters.length < 5) continue
    for (const role of CORE_ROLES) {
      const level = Math.max(...t.starters.map((id) => s.players[id]?.overall ?? 0)) + 2
      const got = joinAs(year, role, t.tag, level, 'starter')
      if (!got) continue
      cases++
      const g = got.s
      const five = got.before.map((id) => g.players[id]).filter((q): q is Player => !!q)
      const out = got.before.filter((id) => !got.after.includes(id)).map((id) => g.players[id])
      if (!got.after.includes(got.p.id)) { bad.push(`${t.tag}/${role}：比全队都强还没进首发`); continue }
      if (out.length !== 1) { bad.push(`${t.tag}/${role}：顶掉了 ${out.length} 个人`); continue }
      const gone = out[0]
      // the rule, in the author's words: his own job first — unless every man in the five who
      // plays it is the one holding another job up, or is the man the club calls through
      const was = roleGaps(five).length
      const canGo = (q: Player) => !q.isIgl && roleGaps(five.filter((x) => x !== q).concat(got.p)).length <= was
      const mine = five.filter((q) => q.id !== got.p.id && jobsOf(q).includes(role) && canGo(q))
      if (jobsOf(gone).includes(role)) his++
      else if (!mine.length) forced++
      else bad.push(`${t.tag}/${role}：顶掉的是 ${card(gone)}，队里打这个位置又换得动的是 ${mine.map((q) => q.ign).join('、')}`)
      if (gone.isIgl && five.some((q) => q.id !== gone.id && canGo(q))) bad.push(`${t.tag}/${role}：把喊指挥的 ${gone.ign} 换了下去`)
      if (roleGaps(got.after.map((id) => g.players[id])).length > was) bad.push(`${t.tag}/${role}：他进了首发以后四个位置排不齐`)
    }
  }
  ok(bad.length === 0, `${year}：${bad.length} / ${cases} 个签约顶错了人：${bad.slice(0, 4).join('；')}`)
  console.log(`  ${year}：${cases} 次签约（${clubs.length} 支一线队 × 四个位置），顶掉同位置的 ${his} 次，位置上没人可换的 ${forced} 次，顶错的 ${bad.length} 次`)
}

console.log('四、几块屏幕说的是同一个对手')
{
  let cases = 0
  const bad: string[] = []
  for (const { year, s } of worlds) {
    const clubs = Object.values(s.teams).filter((t) => t.tier === 1 && t.roster.length >= 5).slice(0, 10)
    for (const t of clubs) {
      for (const role of CORE_ROLES) {
        // on a rotation contract, so nothing seats him and the coach's own reading decides
        const got = joinAs(year, role, t.tag, 78, 'rotation')
        if (!got) continue
        const { s: g, p } = got
        const five = got.after.map((id) => g.players[id]).filter((q): q is Player => !!q)
        if (five.some((q) => q.id === p.id)) continue   // he is already in: 对位挑战 is a different question
        cases++
        const duel = duelTarget(g)
        // the man the coach would drop for him, asked of the same rule
        const drop = placeFor(five, p, (q) => coachView(g, q), (q) => q.isIgl)
        if (duel?.id !== drop?.id) bad.push(`${year} ${t.tag}/${role}：对位挑战找 ${duel?.ign ?? '没有人'}，教练会换下 ${drop?.ign ?? '没有人'}`)
        // and the 转会 page, read from another club's side
        const nd = needOf(g, g.teams[t.id])
        const gap = roleGaps(five).includes(role)
        if (gap) {
          if (nd.kind !== 'hole') bad.push(`${year} ${t.tag}/${role}：首发里排不出这个位置，转会页却不说缺`)
        } else if (nd.kind === 'hole') {
          bad.push(`${year} ${t.tag}/${role}：首发排得出这个位置，转会页却说缺`)
        } else if (nd.mate && nd.mate.id !== drop?.id) {
          bad.push(`${year} ${t.tag}/${role}：转会页说的是 ${nd.mate.ign}，教练会换下 ${drop?.ign ?? '没有人'}`)
        }
      }
    }
  }
  ok(bad.length === 0, `${bad.length} / ${cases} 处对不上：${bad.slice(0, 4).join('；')}`)
  console.log(`  ${cases} 个「我在替补席」的局面，对位挑战、教练的名单、转会页说的是同一个人`)
}

console.log('五、位置是价钱，不是规矩')
{
  // Paper Rex have no sentinel by trade. A weak one does not walk in; a clearly better one does.
  const weak = joinAs(2026, '哨卫', 'PRX', 70, 'rotation')!
  ok(!weak.after.includes(weak.p.id), `70 的哨卫在 PRX 没有对手，轮换合同也直接进了首发：${line(weak.s, weak.after)}`)
  const strong = joinAs(2026, '哨卫', 'PRX', 92, 'rotation')!
  ok(strong.after.includes(strong.p.id), `92 的哨卫比 PRX 的替补强得多，还是进不了首发：${line(strong.s, strong.after)}`)
  const outS = strong.before.filter((id) => !strong.after.includes(id)).map((id) => strong.s.players[id])
  ok(outS.length === 1 && jobsOf(outS[0]).includes('哨卫'), `92 的哨卫顶掉的是 ${outS.map(card).join('、')}`)
  console.log(`  PRX 的哨位：70 的在替补席，92 的顶掉 ${outS.map((p) => p.ign).join('、')}`)
  // and the price is worth something: a specialist a little worse than the man covering his job still gets in
  const squad = strong.s.teams[strong.s.myTeam]
  const rest = squad.starters.map((id) => strong.s.players[id]).filter((p): p is Player => !!p)
  ok(shapeOf(rest).gaps.length === 0, 'PRX 的首发排不齐四个位置')
}

console.log('六、几段生涯里，一支队的首发有几个同位置的')
{
  const SEEDS = [7, 8, 9]
  let weeks = 0, dup = 0, three = 0, gap = 0, avoidable = 0
  for (const seed of SEEDS) {
    const s = createCareer({ name: `P${seed}`, region: 'Pacific', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2026 })
    const me = s.me!
    for (let w = 0; w < 140 && me.phase !== 'retired'; w++) {
      const stop = autoWeek(s)
      if (me.phase === 'pro' && s.myTeam) {
        const five = s.teams[s.myTeam].starters.map((id) => s.players[id]).filter((p): p is Player => !!p)
        if (five.length === 5) {
          weeks++
          const cnt: Record<string, number> = {}
          for (const p of five) for (const r of mainJobs(p)) cnt[r] = (cnt[r] ?? 0) + 1
          const max = Math.max(...Object.values(cnt), 0)
          if (max >= 2) dup++
          if (max >= 3) three++
          const g = roleGaps(five).length
          if (g) {
            gap++
            const squad = s.teams[s.myTeam].roster.map((id) => s.players[id]).filter((p): p is Player => !!p)
            if (roleGaps(squad).length < g) avoidable++
          }
        }
      }
      if (stop.kind === 'game-over') break
    }
  }
  const pc = (n: number) => `${((n / Math.max(1, weeks)) * 100).toFixed(1)}%`
  console.log(`  ${SEEDS.length} 段生涯 · ${weeks} 个有首发的周：两人同位置 ${pc(dup)} · 三人同位置 ${pc(three)} · 四个位置排不齐 ${pc(gap)}（名单里排得出却没排 ${avoidable} 次）`)
  ok(avoidable === 0, `有 ${avoidable} 个周，名单里排得出四个位置，教练却没排`)
  ok(three / Math.max(1, weeks) <= 0.35, `三个人同位置的周占 ${pc(three)}，超过三成`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log(fails ? `\n✗ ${fails} 项不对 · ${secs}s` : `\n✓ 每支队的首发都排得出四个位置、指挥在场上，签约顶掉的是打他位置的人，对位挑战、教练名单和转会页说的是同一个对手，位置是价钱不是规矩 · ${secs}s`)
process.exit(fails ? 1 : 0)
