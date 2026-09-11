/**
 * Events, 伏笔 → 回响 and countdown chains.
 *
 *   一、the pool: how many, and that every card is well-formed
 *   二、three careers left to the autopilot: events a season before and after
 *       going pro, how many different ones turn up, which chains ran and how
 *       they ended, how many seeds came back
 *   三、each chain forced open twice — once taken the recommended way, once
 *       left alone — and where it ends; and the three chains a seed can open
 *   四、seeds planted by hand, every way they can go, and whether they echo
 *
 *   npx tsx scripts/check_story.ts [seasons=3]
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan, autoResolve, autoWeek } from '../src/engine/me/auto'
import { EVENTS, eventOf, resolveEvent } from '../src/engine/me/events'
import { openChain } from '../src/engine/me/storyweek'
import { CHAIN_CN, chainLine, plantSeed, storyTag } from '../src/engine/me/story'
import { advanceWeek, setPlan } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { Rng } from '../src/engine/rng'

const seasons = Number(process.argv[2] ?? 3)
let bad = 0
const fail = (m: string) => { bad++; console.log(`  ✗ ${m}`) }
const clone = (s: any): any => JSON.parse(JSON.stringify(s))
const END_CN: Record<string, string> = { ok: '有了结果', miss: '没能如愿', drop: '就此放下', expired: '不了了之', live: '还没收尾', '?': '？' }

/* ---- 一、the pool ---- */
{
  const ids = new Set<string>()
  for (const e of EVENTS) {
    if (ids.has(e.id)) fail(`事件 id 重复：${e.id}`)
    ids.add(e.id)
    if (e.a.length < 2 || e.a.length > 3) fail(`${e.id} 有 ${e.a.length} 个选项`)
    if (!e.a[e.rec]) fail(`${e.id} 的推荐选项越界`)
    if (e.chain && e.a.some((o) => !o.ch)) fail(`${e.id} 是连锁的一步，但有选项没写它对连锁做什么`)
  }
  const drawn = EVENTS.filter((e) => e.w > 0).length
  const echo = EVENTS.filter((e) => e.echo).length
  const chain = EVENTS.filter((e) => e.chain).length
  const seeded = EVENTS.filter((e) => e.a.some((o) => o.seed)).length
  console.log(`一、事件 ${EVENTS.length} 个，选项 ${EVENTS.reduce((n, e) => n + e.a.length, 0)} 个`)
  console.log(`   抽取池 ${drawn} · 钩子触发 ${EVENTS.length - drawn - echo - chain} · 回响卡 ${echo} · 连锁步骤 ${chain} · 会埋伏笔的 ${seeded}`)
  if (EVENTS.length < 60) fail('事件不到 60 个')
}

/* ---- 二、three careers on autopilot ---- */
const RUNS: { label: string; o: any }[] = [
  { label: '天梯开局 · 2021 中国', o: { name: 'ProbeA', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 11, year: 2021 } },
  { label: '二线首发 · 2026 欧洲', o: { name: 'ProbeB', region: 'Europe', role: '先锋', talents: emptyTalents(), originKey: 'streamer', start: 'chal', seed: 7 } },
  { label: '一线替补 · 2026 太平洋', o: { name: 'ProbeC', region: 'Pacific', role: '控场', talents: emptyTalents(), originKey: 'academy', start: 't1', seed: 23 } },
]
console.log(`\n二、全托管跑 ${seasons} 季`)
const union = new Set<string>()
const tot = { preW: 0, proW: 0, preE: 0, proE: 0, chains: {} as Record<string, number>, echoes: 0 }
for (const r of RUNS) {
  const t0 = Date.now()
  const s = createCareer(r.o)
  const me = s.me!
  const y0 = s.year
  const c = { preW: 0, proW: 0, preE: 0, proE: 0, maxAge: 0, lines: new Set<string>() }
  let guard = 0
  while (s.year - y0 < seasons && guard++ < 70 * seasons) {
    const pro = me.phase === 'pro'
    const before = me.eventsSeen
    const st = autoWeek(s)
    const n = me.eventsSeen - before
    if (pro) { c.proW++; c.proE += n } else { c.preW++; c.preE += n }
    if (me.chain) {
      c.maxAge = Math.max(c.maxAge, me.week - me.chain.wk)
      const l = chainLine(s)
      if (l) c.lines.add(l)
    }
    if (st.kind === 'game-over') break
  }
  for (const k of Object.keys(me.eventCounts)) union.add(k)
  const ends = (me.chainsDone ?? []).map((x) => `${CHAIN_CN[x.id]}·${END_CN[x.end]}`)
  for (const x of me.chainsDone ?? []) tot.chains[x.end] = (tot.chains[x.end] ?? 0) + 1
  const per = (e: number, w: number) => (w ? (e / w * 52).toFixed(1) : '—')
  const planted = Object.keys(me.seeds ?? {}).length
  tot.preW += c.preW; tot.proW += c.proW; tot.preE += c.preE; tot.proE += c.proE; tot.echoes += me.flags.echoes ?? 0
  console.log(`  ${r.label}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
  console.log(`    每季事件：职业前 ${per(c.preE, c.preW)}（${c.preW} 周）· 职业 ${per(c.proE, c.proW)}（${c.proW} 周）`)
  console.log(`    ${seasons} 季里出现过 ${Object.keys(me.eventCounts).length} 种事件 · 埋下伏笔 ${planted} 个，回响 ${me.flags.echoes ?? 0} 次`)
  console.log(`    连锁：${ends.length ? ends.join('、') : '无'}${me.chain ? ` · 进行中：${CHAIN_CN[me.chain.id]}` : ''}`)
  for (const l of [...c.lines].slice(0, 2)) console.log(`    周页那一行：${l}`)
  for (const l of me.log.filter((x) => x.text.startsWith('回响：')).slice(0, 2)) console.log(`    ${l.text}`)
  if (c.maxAge > 46) fail(`${r.label}：有连锁拖了 ${c.maxAge} 周没收尾`)
  if (me.pendingEvent && !me.pending.some((x) => x.kind === 'event')) fail(`${r.label}：pendingEvent 残留，时钟会卡住`)
  const proRate = c.proW ? c.proE / c.proW * 52 : 0
  if (c.proW >= 26 && (proRate < 5 || proRate > 22)) fail(`${r.label}：职业期每季 ${proRate.toFixed(1)} 个事件，不在 5–22 之间`)
  const preRate = c.preW ? c.preE / c.preW * 52 : 0
  if (c.preW >= 26 && (preRate < 2 || preRate > 16)) fail(`${r.label}：职业前每季 ${preRate.toFixed(1)} 个事件，不在 2–16 之间`)
}
console.log(`  合计：职业前每季 ${(tot.preE / Math.max(1, tot.preW) * 52).toFixed(1)} 个 · 职业每季 ${(tot.proE / Math.max(1, tot.proW) * 52).toFixed(1)} 个 · 三条生涯出现过 ${union.size} 种事件`)
console.log(`  连锁收尾：${Object.entries(tot.chains).map(([k, v]) => `${END_CN[k]} ${v}`).join(' · ') || '无'} · 回响 ${tot.echoes} 次`)

/* ---- 三、chains, forced ---- */
console.log('\n三、连锁：强制开启，一次按推荐走，一次放着不管')
const warm = createCareer({ name: 'ProbeD', region: 'Europe', role: '先锋', talents: emptyTalents(), originKey: 'streamer', start: 'chal', seed: 31 } as any)
for (let i = 0; i < 10; i++) autoWeek(warm)
{ let g = 0; while (warm.me!.pending.length && g++ < 20) autoResolve(warm, warm.me!.pending[0]) }
warm.me!.chain = undefined
warm.me!.pendingEvent = undefined

const prep: Record<string, (s: any) => void> = {
  showcase: (s) => { s.players[s.me.id].contractYears = 1; s.me.flags.showYear = 0; s.me.flags.renewPending = 0 },
  overseas: (s) => { s.me.tenure = 1; s.me.abroad = false },
  storm: (s) => { s.me.stream.total = 5; s.me.fans = Math.max(s.me.fans, 120) },
  rift: () => {},
}
const PLAN_TRACKS = ['scrim', 'vod', 'duo', 'stream', 'quiet']
/** leaving it alone: take an answer that sets a task, then do not do the task */
function ignorePick(ev: any): number {
  const i = ev.a.findIndex((o: any) => o.ch?.track && PLAN_TRACKS.includes(o.ch.track))
  if (i >= 0) return i
  const j = ev.a.findIndex((o: any) => o.ch && !o.ch.end && !o.ch.add)
  return j >= 0 ? j : ev.rec
}
function answer(s: any, strategy: 'rec' | 'ignore', cards: string[]) {
  const me = s.me
  let g = 0
  while (me.pending.length && g++ < 30) {
    const item = me.pending[0]
    const ev = item.kind === 'event' ? eventOf(item.id) : undefined
    if (ev?.chain) {
      const pick = strategy === 'rec' ? ev.rec : ignorePick(ev)
      cards.push(`${ev.id}「${ev.a[pick].t}」`)
      resolveEvent(s, ev.id, pick)
    } else autoResolve(s, item)
  }
}
function drive(id: string, strategy: 'rec' | 'ignore') {
  const s = clone(warm)
  const me = s.me
  prep[id](s)
  if (!openChain(s, id, new Rng(1234))) return null
  const cards: string[] = []
  const lines: string[] = []
  const done0 = (me.chainsDone ?? []).length
  let dealt = false
  for (let w = 0; w < 40; w++) {
    answer(s, strategy, cards)
    if ((me.chainsDone ?? []).length > done0) break
    if (strategy === 'rec') autoPlan(s)
    else if (me.chain?.track === 'quiet') setPlan(s, 'stream', 1)
    const l = chainLine(s)
    if (l && !lines.includes(l)) lines.push(l)
    let st = advanceWeek(s)
    let g = 0
    while (st.kind !== 'week-end' && st.kind !== 'game-over' && g++ < 40) {
      if (st.kind === 'match') new MeMatch(s, st.fixture).runOut()
      else answer(s, strategy, cards)
      st = advanceWeek(s)
    }
    if (me.pending.some((x: any) => x.kind === 'deal')) dealt = true
    if ((me.chainsDone ?? []).length > done0) break
  }
  const end = (me.chainsDone ?? []).slice(done0)[0]
  return { end: end?.end ?? (me.chain ? 'live' : '?'), steps: end?.steps ?? me.chain?.step ?? 0, weeks: end ? end.wk - (me.week - 40) : 40, cards, lines, dealt }
}
for (const id of ['showcase', 'overseas', 'storm', 'rift']) {
  for (const strategy of ['rec', 'ignore'] as const) {
    const r = drive(id, strategy)
    if (!r) { fail(`${CHAIN_CN[id]}：条件备齐了还是开不起来`); continue }
    console.log(`  ${CHAIN_CN[id]} · ${strategy === 'rec' ? '按推荐' : '放着不管'} → ${END_CN[r.end]}（答了 ${r.steps} 张）${r.dealt ? ' · 转会窗开时来了报价' : ''}`)
    console.log(`    ${r.cards.join(' → ')}`)
    if (r.lines.length) console.log(`    周页：${r.lines.slice(0, 3).join('  /  ')}`)
    const longest = Math.max(0, ...r.lines.map((l) => l.length))
    if (longest > 30) fail(`${CHAIN_CN[id]}：周页那一行有 ${longest} 个字，手机上放不下`)
    const want = strategy === 'ignore' ? ['miss'] : id === 'overseas' ? ['ok', 'miss'] : ['ok']
    if (!want.includes(r.end)) fail(`${CHAIN_CN[id]}·${strategy}：收在「${END_CN[r.end]}」，应该是 ${want.map((w) => END_CN[w]).join('或')}`)
    if (r.steps < 2) fail(`${CHAIN_CN[id]}·${strategy}：只答了 ${r.steps} 张就结束了`)
    if (strategy === 'rec' && id === 'overseas' && r.end === 'ok' && !r.dealt) fail('外区邀约说有了结果，但没有报价')
  }
}
// the chains a seed opens: the first card must be that seed's echo
for (const [id, key, v, t, opener] of [
  ['overseas', 'intlfriend', 'yes', '去，顺便看看他们怎么练', 'ch_abroad_friend'],
  ['storm', 'benchtalk', 'said', '实话实说：教练的决定', 'ch_storm_open'],
  ['rift', 'blame', 'fight', '当场怼回去', 'ch_rift_open'],
] as const) {
  const s = clone(warm)
  prep[id](s)
  plantSeed(s, key, v, t)
  s.me.seeds[key].wk -= 20
  const ok = openChain(s, id, new Rng(99), undefined)
  const ev = eventOf(s.me.pendingEvent ?? '')
  const tag = ev ? storyTag(s, ev) : []
  const echoed = (s.me.seeds[key].echo ?? -1) >= 0
  console.log(`  伏笔 ${key}:${v} → ${CHAIN_CN[id]}：${ok && ev ? ev.id : '没开'}${tag.length ? ` · ${tag.join(' · ')}` : ''}`)
  if (!ok || ev?.id !== opener || !echoed || !tag.some((x) => x.includes('回响'))) fail(`${key}:${v} 没有作为回响开启${CHAIN_CN[id]}`)
}

/* ---- 四、echoes ---- */
console.log('\n四、回响：手动埋下每一种伏笔，看会不会回来')
const ROUNDS: Record<string, string>[] = [
  { boost: 'took', cheat: 'cam', fill: 'off', notes: 'yes', rookie: 'mentor', home: 'later', cafe: 'listened', askpro: 'yes' },
  { boost: 'no', cheat: 'quiet', fill: 'own', notes: 'no', rookie: 'press', home: 'went' },
]
let fired = 0
let total = 0
for (const round of ROUNDS) {
  const s = clone(warm)
  const me = s.me
  me.fans = Math.max(me.fans, 200)
  for (const id of ['showcase', 'overseas', 'storm', 'rift']) me.flags[`chain_${id}`] = 99
  for (const [k, v] of Object.entries(round)) { plantSeed(s, k, v, '（探针）'); me.seeds[k].wk = me.week - 60 }
  const logFrom = me.log.length
  for (let w = 0; w < 80 && Object.keys(round).some((k) => me.seeds[k].echo == null); w++) autoWeek(s)
  for (const [k, v] of Object.entries(round)) {
    total++
    const x = me.seeds[k]
    const back = x.echo != null && x.echo >= 0
    if (back) fired++
    const card = EVENTS.find((e) => e.echo === k && me.eventCounts[e.id])
    console.log(`  ${k}:${v}${x.v !== v ? `（后来被改成 ${x.v}）` : ''} → ${back ? (card ? `回响卡「${card.q.slice(0, 24)}…」` : '回响（周报一行）') : '没回来'}`)
  }
  for (const l of me.log.slice(logFrom).filter((x: any) => x.text.startsWith('回响：')).slice(0, 2)) console.log(`    ${l.text}`)
}
console.log(`  ${fired}/${total} 个伏笔回来了`)
if (fired < total - 1) fail(`只有 ${fired}/${total} 个伏笔回来了`)

console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 事件池、连锁和回响都正常。')
if (bad) process.exit(1)
