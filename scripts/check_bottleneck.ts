/**
 * Do the eight ceilings hold, open, and survive a save from before them?
 *
 * me/bottleneck.ts makes these promises. No attribute ever passes its ceiling,
 * whichever system trains it — my own hours, the club's programme, the
 * winter's ageing — and `potential` is always what the ceilings add up to.
 * Ceilings actually open over a career, and say so in the log. A save from
 * before them keeps the 上限 it had, without announcing eight bottlenecks the
 * week it loads. This walks the steady plan through a career and holds it to
 * all three, twice on the same seed so the whole thing is deterministic.
 *
 * And, since 2026-09-14 (「复盘练了六次从0/6到6/6之后就归零了，始终没有突破……把这个存点数的功能去掉」):
 *  - every practice path, on every role, until it is finished: a full count opens
 *    its own attribute's ceiling, said in the log, with room left under it to see;
 *    or the card has already said why it cannot — a count never empties in silence
 *  - the card and the week board read the engine's own count, and say the week's share beside it
 *  - nothing banks xp at a ceiling any more, anywhere in a career, and the bank is gone from the source
 *  - a save that banked some loads with it dropped, said once, without a jump
 *
 *   npx tsx scripts/check_bottleneck.ts [seasons=6] [seed=7]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { ATTR_CN, ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, Role } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'
import { recomputeOverall } from '../src/engine/player'
import { addXp as clubXp } from '../src/engine/training'
import { addXp as myXp } from '../src/engine/me/growth'
import { bottleneckWeek, breakCount, breakInfo, ceilingNote, ceilingPotential, ensureCeilings } from '../src/engine/me/bottleneck'

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

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)
let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }
type K = keyof Attrs

/** The log from a mark on: the log is capped, so a mark is the last line, not a length. */
const markOf = (s: GameState) => s.me!.log[s.me!.log.length - 1]
const since = (s: GameState, m: ReturnType<typeof markOf>): string[] => {
  const log = s.me!.log
  return log.slice(m ? log.lastIndexOf(m) + 1 : 0).map((l) => l.text)
}

function held(state: GameState, when: string): void {
  const p = state.players[state.me!.id]
  for (const k of ATTR_KEYS) {
    if (p.attrs[k] > p.caps![k]) fail(`${when}：${ATTR_CN[k]} ${p.attrs[k]} 超过瓶颈 ${p.caps![k]}`)
    // no 存点数: a bar at its ceiling holds nothing to land later
    if (p.attrs[k] >= p.caps![k] && (p.xp[k] ?? 0) > 0) fail(`${when}：${ATTR_CN[k]} 卡在瓶颈 ${p.caps![k]}，还存着 ${Math.round(p.xp[k] ?? 0)} xp`)
  }
  if (p.potential !== ceilingPotential(p)) fail(`${when}：上限 ${p.potential} 和八项瓶颈合起来的 ${ceilingPotential(p)} 对不上`)
}

function career(): GameState {
  // a Challengers start is a European club's, as in check_money
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
  })
  const year0 = state.year
  let guard = 0
  while (state.year - year0 < seasons && guard++ < 60 * seasons) {
    const before = { ...(state.me!.bottleneck?.count ?? {}) }
    const m = markOf(state)
    if (autoWeek(state).kind === 'game-over') break
    const when = `${state.year} 第 ${state.day} 天`
    held(state, when)
    // a count goes down only by breaking
    const broke = since(state, m).some((t) => t.startsWith('瓶颈松动'))
    for (const k of ATTR_KEYS) {
      const now = state.me!.bottleneck?.count[k] ?? 0
      if (now < (before[k] ?? 0) && !broke) fail(`${when}：${ATTR_CN[k]} 的计数 ${before[k]} 没破开就清零了（现在 ${now}）`)
    }
  }
  return state
}

const a = career()
const me = a.me!
const p = a.players[me.id]
const opened = me.log.filter((l) => l.text.startsWith('瓶颈松动'))
console.log(`${seasons} 季，seed ${seed}：综合 ${p.overall} / 上限 ${p.potential}`)
console.log(`  ${ATTR_KEYS.map((k) => `${ATTR_CN[k]} ${p.attrs[k]}/${p.caps![k]}`).join(' · ')}`)
console.log(`  瓶颈松动 ${opened.length} 次，赛季经验 ${me.bottleneck!.exp} 次`)
for (const l of opened.slice(0, 4)) console.log(`    ${l.year} ${l.text}`)
if (!opened.length) fail('一整个生涯没有一项瓶颈被破开')
for (const k of ATTR_KEYS.filter((x) => p.attrs[x] >= p.caps![x])) {
  const b = breakInfo(a, k)
  console.log(`  卡在瓶颈：${ATTR_CN[k]} —— ${b.dead ?? `${b.how}（${b.prog}）`}`)
}

const b = career()
if (JSON.stringify([p, me.bottleneck, me.log]) !== JSON.stringify([b.players[b.me!.id], b.me!.bottleneck, b.me!.log])) {
  fail('同一个种子跑两遍，瓶颈或日志不一样')
}

// every practice path on every role, from a fresh pool at 80, until its card says it is finished
interface Path { k: K; act: MeAction; need: number; adds: number; have: (s: GameState) => number; soon?: string }
const PATHS: Path[] = [
  { k: 'aim', act: 'aim', need: 3, adds: 1, have: (s) => s.me!.bottleneck!.aimStreak },
  { k: 'awareness', act: 'vod', need: 6, adds: 2, have: (s) => breakCount(s, 'awareness')!.have, soon: '这周又复盘了 2 次' },
  { k: 'utility', act: 'util', need: 6, adds: 2, have: (s) => breakCount(s, 'utility')!.have, soon: '这周又练了 2 次道具与跑图' },
  { k: 'reaction', act: 'ranked', need: 12, adds: 2, have: (s) => breakCount(s, 'reaction')!.have, soon: '这周又打了 2 次排位' },
  { k: 'teamwork', act: 'scrim', need: 4, adds: 2, have: (s) => breakCount(s, 'teamwork')!.have, soon: '这周又打了 2 次训练赛' },
]
const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
for (const role of ROLES) {
  const said: string[] = []
  for (const path of PATHS) {
    const { k, act, need, adds } = path
    const r = structuredClone(a)
    const rm = r.me!
    const rp = r.players[rm.id]
    if (path.k === 'teamwork' && rm.phase !== 'pro') { said.push('协同（不在职业队，跳过）'); continue }
    const bn = rm.bottleneck!
    rp.role = role
    rp.caps![k] = 80
    rp.attrs[k] = 80
    rp.xp[k] = 0
    bn.mechV![k] = 0
    bn.mech[k] = 0
    bn.count[k] = 0
    bn.aimStreak = 0
    recomputeOverall(rp)
    rp.potential = ceilingPotential(rp)
    bn.pot = rp.potential
    let breaks = 0
    let dead: string | null = null
    for (let wk = 0; wk < 80; wk++) {
      // practised back up to the ceiling between settlements
      if (rp.attrs[k] < rp.caps![k]) { rp.attrs[k] = rp.caps![k]; rp.xp[k] = 0; recomputeOverall(rp) }
      rm.plan = { [act]: 2 }
      const info = breakInfo(r, k)
      if (info.dead) { dead = info.dead; break }
      const have = path.have(r)
      // the card and the week board read this very count, and say the week's share beside it
      const note = ceilingNote(r, act) ?? ''
      const shown = k === 'aim' ? `已连续 ${Math.min(have, need)}/${need} 周` : `${Math.min(have, need)}/${need}`
      if (!info.prog.includes(shown) || !note.includes(shown)) fail(`${role} ${ATTR_CN[k]}：卡片「${info.prog}」、周计划「${note}」和引擎的计数 ${have}/${need} 对不上`)
      if (path.soon && !(info.prog.includes(path.soon) && info.prog.includes('周结算时算进去'))) fail(`${role} ${ATTR_CN[k]}：卡片没说这周做过的 2 次（要「${path.soon}，周结算时算进去」，实际「${info.prog}」）`)
      const cap0 = rp.caps![k]
      const m = markOf(r)
      bottleneckWeek(r)
      const lines = since(r, m)
      const now = path.have(r)
      if (have + adds >= need) {
        const openedLine = lines.some((t) => t.startsWith('瓶颈松动') && t.includes(`${ATTR_CN[k]}的瓶颈 ${cap0} → ${rp.caps![k]}`))
        if (rp.caps![k] > cap0 && openedLine) {
          breaks++
          if (now !== 0) fail(`${role} ${ATTR_CN[k]}：破开了，计数却还是 ${now}`)
          if (rp.attrs[k] >= rp.caps![k]) fail(`${role} ${ATTR_CN[k]}：破开当场属性就顶到新瓶颈 ${rp.caps![k]}，看不出破开了`)
        } else {
          const why = lines.some((t) => t.includes('没能破开'))
          fail(`${role} ${ATTR_CN[k]}：计数 ${have}+${adds} 满了，瓶颈 ${cap0} → ${rp.caps![k]}，${why ? '说了没破开' : '没说为什么'}，计数变成 ${now}`)
          break
        }
      } else if (now !== have + adds) {
        fail(`${role} ${ATTR_CN[k]}：计数 ${have}+${adds} 变成了 ${now}`)
        break
      }
      held(r, `${role} ${ATTR_CN[k]} 第 ${wk + 1} 周`)
    }
    if (!dead) fail(`${role} ${ATTR_CN[k]}：80 周以后这条路既没破到头、卡片也没说为什么`)
    else if (!breaks) fail(`${role} ${ATTR_CN[k]}：一次都没破开就到头了（${dead}）`)
    // a finished path is greyed with its reason, and its count stops
    else {
      rm.plan = { [act]: 2 }
      const before = path.have(r)
      bottleneckWeek(r)
      if (k !== 'aim' && path.have(r) !== before) fail(`${role} ${ATTR_CN[k]}：到头以后还在计数（${before} → ${path.have(r)}）`)
      if (!(ceilingNote(r, act) ?? '').includes(dead)) fail(`${role} ${ATTR_CN[k]}：到头以后周计划上没写为什么`)
    }
    said.push(`${ATTR_CN[k]} 破 ${breaks} 次`)
  }
  console.log(`  ${role}：${said.join(' · ')}，然后卡片写明到头`)
}

// nothing banks at a ceiling: my own hours, the club's programme, a point that reaches it
{
  const s = structuredClone(a)
  const sp = s.players[s.me!.id]
  const k: K = 'utility'
  sp.caps![k] = Math.max(sp.caps![k], 60)
  sp.attrs[k] = sp.caps![k]
  sp.xp[k] = 0
  myXp(sp, k, 250)
  clubXp(sp, k, 250)
  if ((sp.xp[k] ?? 0) !== 0 || sp.attrs[k] !== sp.caps![k]) fail(`卡在瓶颈上练：${ATTR_CN[k]} ${sp.attrs[k]}/${sp.caps![k]}，存着 ${sp.xp[k]} xp`)
  sp.attrs[k] = sp.caps![k] - 1
  myXp(sp, k, 350)
  if (sp.attrs[k] !== sp.caps![k] || (sp.xp[k] ?? 0) !== 0) fail(`练到瓶颈那一下多出来的：${ATTR_CN[k]} ${sp.attrs[k]}/${sp.caps![k]}，存着 ${sp.xp[k]} xp`)
  sp.attrs[k] = sp.caps![k] - 1
  sp.xp[k] = 90
  clubXp(sp, k, 150)
  if (sp.attrs[k] !== sp.caps![k] || (sp.xp[k] ?? 0) !== 0) fail(`俱乐部训练练到瓶颈那一下多出来的：${ATTR_CN[k]} ${sp.attrs[k]}/${sp.caps![k]}，存着 ${sp.xp[k]} xp`)
}
{
  const root = new URL('../src/', import.meta.url)
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f))
  for (const f of files) {
    const text = readFileSync(join(decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, '$1'), f), 'utf8')
    for (const word of ['CEILING_BANK', 'BANK_POINTS', 'rollBanked']) if (text.includes(word)) fail(`${f} 里还有 ${word}`)
    if (/bottleneck\.ts$/.test(f) || /MeScreen\.tsx$/.test(f) || /Week\.tsx$/.test(f)) {
      for (const word of ['最多存', '先存着', '已存 ', '存了 ']) if (text.includes(word)) fail(`${f} 还在说「${word}」`)
    }
    // the screens read a path's count through breakInfo / ceilingNote, never off the book
    if (f.startsWith('ui') && /bottleneck\??\.(count|aimStreak|mechV|mileV)/.test(text)) fail(`${f} 直接读了瓶颈的计数，没有经过 breakInfo / ceilingNote`)
  }
}

// a save from before the ceilings, mid-career: the 上限 it had is the 上限 it keeps
// (its trophies are left out here: what they are owed is paid once, and checked below)
const old = structuredClone(a)
const op = old.players[old.me!.id]
delete op.caps
delete old.me!.bottleneck
old.me!.titles = []
const was = op.potential
ensureCeilings(old)
if (op.potential < was || op.potential > was + 1) fail(`老存档的上限从 ${was} 变成了 ${op.potential}`)
held(old, '老存档读进来')
for (let i = 0; i < 12; i++) { autoWeek(old); held(old, `老存档第 ${i + 1} 周`) }

// a save that banked at its ceilings (「存点数」): dropped on load, said once, nothing lands and nothing else goes
{
  const o = structuredClone(a)
  const om = o.me!
  const obn = om.bottleneck!
  const oq = o.players[om.id]
  delete obn.noBank
  const top: K = 'aim'
  const under = ATTR_KEYS.find((k) => k !== top && oq.caps![k] >= 22) ?? 'igl'
  oq.attrs[top] = oq.caps![top]
  oq.xp[top] = 300
  oq.attrs[under] = oq.caps![under] - 2
  oq.xp[under] = 250
  recomputeOverall(oq)
  oq.potential = ceilingPotential(oq)
  obn.pot = oq.potential
  obn.count.awareness = 4
  const attrs0 = JSON.stringify(oq.attrs)
  const pot0 = oq.potential
  const count0 = JSON.stringify(obn.count)
  const m = markOf(o)
  ensureCeilings(o)
  if (JSON.stringify(oq.attrs) !== attrs0 || oq.potential !== pot0) fail('老存档存着的点数读档时一次涨上去了')
  if ((oq.xp[top] ?? 0) !== 0) fail(`读档后卡在瓶颈的${ATTR_CN[top]}还存着 ${oq.xp[top]} xp`)
  if ((oq.xp[under] ?? 0) !== 50) fail(`读档后瓶颈下的${ATTR_CN[under]}应该留下 50 的进度，实际 ${oq.xp[under]}`)
  if (JSON.stringify(obn.count) !== count0) fail('读档时把破瓶颈的计数也动了')
  const notes = since(o, m).filter((t) => t.includes('存点数'))
  if (notes.length !== 1 || !notes[0].includes(`${ATTR_CN[top]} 3 点`) || !notes[0].includes(`${ATTR_CN[under]} 2 点`)) fail(`读档时的说明不对：${notes.join(' | ') || '没写'}`)
  ensureCeilings(o)
  if (since(o, m).filter((t) => t.includes('存点数')).length !== 1) fail('第二次读档又说了一遍存点数')
  held(o, '带存点的老存档读进来')
  for (let i = 0; i < 4; i++) { autoWeek(o); held(o, `带存点的老存档第 ${i + 1} 周`) }
  console.log(`  带存点的老存档：${notes[0] ?? '（没写）'}`)
}

// a book from a build that missed a title: a 2026 全球冠军赛 it started, and the final's MVP, paid once on load and not again
const owed = structuredClone(a)
const ob = owed.me!.bottleneck!
delete ob.mechV
delete ob.mileV
delete ob.rev
ob.seen = ob.seen.filter((k) => !k.startsWith('fmvp:'))
owed.me!.titles.push({ year: owed.year, title: '2026 全球冠军赛', started: false })
owed.me!.matches.push({ ...owed.me!.matches[owed.me!.matches.length - 1], year: owed.year, comp: '2026 全球冠军赛', label: '总决赛', started: true, won: true, mvp: true, friendly: false })
const owedPot = owed.players[owed.me!.id].potential
ensureCeilings(owed)
const paidPot = owed.players[owed.me!.id].potential
if (!owed.me!.titles.some((t) => t.title === '2026 全球冠军赛' && t.started)) fail('决赛首发的冠军赛读档后还是记成「没有出场」')
if (paidPot < owedPot + 1) fail(`漏发的冠军赛 + 决赛 MVP 读档后只把上限从 ${owedPot} 抬到 ${paidPot}`)
if (!owed.me!.log.some((l) => l.text.includes('补发'))) fail('补发的突破没有写进日志')
held(owed, '补发之后')
ensureCeilings(owed)
if (owed.players[owed.me!.id].potential !== paidPot) fail('补发在第二次读档时又发了一遍')
console.log(`  补发：漏掉的冠军赛 + 决赛 MVP，上限 ${owedPot} → ${paidPot}`)

// and one already stuck at its one number, with 99 枪法: every row at its ceiling, said once, not as news
const stuck = structuredClone(a)
const sp = stuck.players[stuck.me!.id]
delete sp.caps
delete stuck.me!.bottleneck
stuck.me!.titles = []
sp.attrs.aim = 99
recomputeOverall(sp)
sp.potential = sp.overall
ensureCeilings(stuck)
if (sp.potential !== sp.overall || sp.caps!.aim !== 99) fail('卡在上限的老存档读进来之后上限变了')
const logged = stuck.me!.log.length
autoWeek(stuck)
if (stuck.me!.log.slice(logged).some((l) => l.text.includes('练到瓶颈了'))) fail('老存档读进来的第一周把早就卡住的几项又报了一遍')

console.log(bad
  ? `\n✗ ${bad} 处不对`
  : '\n✓ 八项瓶颈守得住、破得开、写得出来：每条练习路做满就破开或写明到头，卡片读的就是引擎的计数，瓶颈上不再存点；老存档的上限原样保留、存点作废不涨，同一个种子结果一样。')
if (bad) process.exit(1)
