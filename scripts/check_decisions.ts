/**
 * In-match decisions: the 关键回合 system and the rounds its calls are about.
 *
 * Players sent two things in (2026-09-12). 「做出正确选择显示我把人都杀完了，结果
 * 这个回合却输了」: a call's line was picked before its round was played, and one
 * line in eight said the opposite of the round record beside it. And 「选择做对了
 * 增加的赢面也不大…都直接跳过看结果了」: a call moved the next few rounds by a
 * point or two, so skipping was as good as playing. Now a call settles the round
 * it is on, the line is read off that round, and 快进 makes the coach's calls with
 * nobody in the chair. This check keeps all of it that way.
 *
 *   一、the copy and the hints: four lines per option (two for a node that decides
 *       its round), each saying the result its case is for and nothing about my
 *       kills unless picked by my kill count; hints that never claim a result
 *   二、matches played call by call on fixed seeds, answered five ways: every line
 *       read against the round record it is pinned to; every call asked in a key
 *       round and only where its premise holds (the round record's side and buy);
 *       what the buttons said against what happened (§7.1 #5, hard)
 *   三、the engine: a round given its winner plays out exactly as the same round
 *       left to the roll when they agree, so AI-only matches cannot tell the
 *       parameter is there (§7.1 #14, hard). The before and after of the change
 *       were also hashed in full when it went in: 720 AI matches, e65e672b… both.
 *   四、the numbers the design set out to hit (策划稿 §7.1): a VCT rookie against a
 *       weaker, an even and a stronger five, six ways of playing on the same seeds.
 *       Hard: following the coach is never worse than 快进 (#7). The rest are bands
 *       and are only warned; the tuning history sits by the constants in me/nodes.ts.
 *
 *   npx tsx scripts/check_decisions.ts [series per cell=300] [full]
 *   (full: also a veteran on 80s and a Challengers starter)
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MeMatch, mapWinProb } from '../src/engine/me/matchplay'
import { NODES, NODE_HINTS, NODE_HL, nodeLine } from '../src/engine/me/nodes'
import type { HlCell, HlOpt, NodeCtx, NodeDef } from '../src/engine/me/nodes'
import type { NodeLogEntry } from '../src/engine/me/types'
import { MatchSim, buildLineup, poolFor, simulateMatch } from '../src/engine/match'
import type { MapSim } from '../src/engine/match'
import { Rng, hashStr } from '../src/engine/rng'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'

const PER = Number(process.argv[2] ?? 300)
const FULL = process.argv.includes('full')
let bad = 0
let warned = 0
const fail = (m: string) => { bad++; if (bad <= 30) console.log(`  ✗ ${m}`) }
const warn = (m: string) => { warned++; console.log(`  ⚠ ${m}`) }
const t0 = Date.now()
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} 秒`
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0)
const f1 = (v: number) => v.toFixed(1)

/** a kill of mine, said in words */
const KILL = /放倒|打掉|带走|收掉|击杀|首杀|双杀|两个都|收的|换掉/
const TWO = /两个|连着|双杀/
/** the round, said in words — a line has to say which, and must not say both */
const WIN = /(?<!没)拿下|收下|抢了回来|赢了下来/
const LOSS = /丢了|没拿下|没收住|溜走|交了出去|没翻过来|没扛住|没打起来/
/** words from another game: the official ones are 辐能芯片、安装、拆除 */
const FOREIGN = /下包|炸包|拆包|包点|包已经/
const CELLS: HlCell[] = ['okWin', 'okLoss', 'failWin', 'failLoss']
/** the nodes whose premise is which side of the round we are on */
const ATTACKING = new Set(['entry', 'clutch', 'ahead_rush'])
const DEFENDING = new Set(['behind_site'])

/** force whether the next call lands, touching only that roll: choose() draws the round from the same stream next */
function chooseForced(mm: MeMatch, idx: number, lands: boolean | undefined): NodeLogEntry {
  if (lands === undefined) return mm.choose(idx)
  const nr = (mm as unknown as { nodeRng: Rng }).nodeRng
  const orig = nr.chance
  let first = true
  nr.chance = (p: number) => {
    if (!first) return orig.call(nr, p)
    first = false
    nr.next()
    return lands
  }
  try { return mm.choose(idx) } finally { nr.chance = orig }
}

/* ---- 一、the copy and the hints ---- */
{
  let lines = 0
  let hints = 0
  const ids = new Set(NODES.map((n) => n.id))
  for (const id of Object.keys(NODE_HL)) if (!ids.has(id)) fail(`文案表里有不存在的节点 ${id}`)
  for (const n of NODES) {
    for (const s of [n.q, n.ctx, ...n.a.map((o) => o.t)]) if (FOREIGN.test(s)) fail(`${n.id}：「${s}」用了别的游戏的说法`)
    const rows: HlOpt[] | undefined = NODE_HL[n.id]
    if (!rows || rows.length !== n.a.length) { fail(`${n.id}：文案 ${rows?.length ?? 0} 组，选项 ${n.a.length} 个`); continue }
    rows.forEach((o, i) => {
      const need: HlCell[] = n.decides ? ['okWin', 'failLoss'] : CELLS
      for (const c of CELLS) {
        const t = o[c]
        const where = `${n.id}「${n.a[i].t}」${c}`
        if (!need.includes(c)) { if (t != null) fail(`${where}：这个节点定这一回合，这一格不可能出现，不该写`); continue }
        if (t == null) { fail(`${where}：没写`); continue }
        const win = c.endsWith('Win')
        const variants: [string, string][] = typeof t === 'string' ? [['', t]] : Object.entries(t).filter((e): e is [string, string] => typeof e[1] === 'string')
        for (const [k, s] of variants) {
          lines++
          if (win ? !WIN.test(s) : !LOSS.test(s)) fail(`${where}${k && `.${k}`}：没说这回合${win ? '拿下' : '丢了'}：${s}`)
          if (win ? LOSS.test(s) : WIN.test(s)) fail(`${where}${k && `.${k}`}：说反了：${s}`)
          if ((k === '' || k === 'k0') && KILL.test(s)) fail(`${where}${k && `.${k}`}：不按击杀数挑，却说了你杀了人：${s}`)
          if ((k === 'k1' || k === 'k2') && !KILL.test(s)) fail(`${where}.${k}：按击杀数挑的句子没说击杀：${s}`)
          if (k === 'k1' && TWO.test(s)) fail(`${where}.k1：一杀的句子说了两个：${s}`)
          if (FOREIGN.test(s)) fail(`${where}${k && `.${k}`}：用了别的游戏的说法：${s}`)
        }
      }
    })
    // every node that can be asked reads out a hint, one set of lines per option
    if (n.id === 'pistol_rush') continue
    const h = NODE_HINTS[n.id]
    if (!h || h.length !== n.a.length || h.some((x) => !x.length)) { fail(`${n.id} 会被问到，局面提示没有覆盖每个选项`); continue }
    for (const s of h.flat()) {
      hints++
      if (WIN.test(s) || LOSS.test(s) || KILL.test(s)) fail(`${n.id} 的局面提示说了回合结果或击杀：${s}`)
      if (FOREIGN.test(s)) fail(`${n.id} 的局面提示用了别的游戏的说法：${s}`)
    }
  }
  for (const id of Object.keys(NODE_HINTS)) if (!ids.has(id)) fail(`提示表里有不存在的节点 ${id}`)
  const decides = NODES.filter((n) => n.decides).map((n) => n.id)
  console.log(`一、${NODES.length} 个节点、${NODES.reduce((s, n) => s + n.a.length, 0)} 个选项，文案 ${lines} 句，局面提示 ${hints} 句；定这一回合的节点：${decides.join('、')}`)
}

/* ---- 二、matches, call by call ---- */
type Answer = 'coach' | 'random' | 'allok' | 'allfail' | 'bail'
const ANSWERS: Answer[] = ['coach', 'random', 'allok', 'allfail', 'bail']
const SCN: any[] = [
  { name: 'DecA', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 },
  { name: 'DecB', region: 'Pacific', role: '哨卫', talents: emptyTalents(), originKey: 'streamer', start: 'chal', seed: 11, year: 2026 },
]
const PER2 = 60
const st = {
  calls: 0, series: 0, contra: 0, killZero: 0, killBucket: 0, unpinned: 0, plumbing: 0,
  decided: 0, forced: 0, fallback: 0, mapClaim: 0, noRound: 0, premise: 0, slot: 0, pistol: 0, overQuota: 0,
  cells: { okWin: 0, okLoss: 0, failWin: 0, failLoss: 0 } as Record<HlCell, number>,
  killLines: 0,
  // #5: what the buttons said against what happened (answered naturally, not forced)
  shownP: 0, landed: 0, naturalCalls: 0,
  okShown: 0, okWon: 0, okN: 0, failShown: 0, failWon: 0, failN: 0,
}

/** the call's line against its round, read straight off the engine — nothing taken from MeMatch's own bookkeeping */
function verify(node: NodeDef, ctx: NodeCtx, idx: number, e: NodeLogEntry, m: MapSim, at: number, killsBefore: number | null, meId: string, mineIsA: boolean, natural: boolean): void {
  st.calls++
  const rl = m.rounds[at]
  if (!rl || rl.n !== e.round) { st.noRound++; fail(`${node.id}：决定记在第 ${e.round} 回合，引擎这一格是第 ${rl?.n} 回合`); return }
  const won = (rl.winner === 'A') === mineIsA
  const kills = killsBefore == null ? (e.kills ?? 0) : m.lines[meId].kills - killsBefore
  const line = nodeLine(node.id, idx, e.ok, { won, kills })
  const hl = e.hl ?? ''
  // the tail only a round that closed the map carries, from the score (a scrim can close level)
  const lastRound = at === m.rounds.length - 1 && m.over
  const mine = mineIsA ? m.a : m.b
  const theirs = mineIsA ? m.b : m.a
  const tail = lastRound ? (mine > theirs ? '这张图拿下了。' : mine < theirs ? '这张图丢了。' : '这张图打平了。') : ''
  if (rl.hl?.[0] !== hl) st.unpinned++
  if (hl !== line.text + tail || e.won !== won || e.kills !== kills) st.plumbing++
  const body = hl.slice(0, hl.length - tail.length)
  if (won ? (!WIN.test(body) || LOSS.test(body)) : (!LOSS.test(body) || WIN.test(body))) st.contra++
  if (KILL.test(body)) { st.killLines++; if (kills === 0) st.killZero++ }
  if ((line.kills === 1 && kills < 1) || (line.kills === 2 && kills < 2) || (line.kills === 0 && kills > 0)) st.killBucket++
  if (/这张图(拿下了|丢了|打平了)/.test(hl) !== lastRound) st.mapClaim++
  if (node.decides) { st.decided++; if (e.ok !== won) st.forced++ }
  if (line.fallback) st.fallback++
  st.cells[line.cell]++
  // asked in a key round, never on a pistol round
  const r = ctx.round
  if (r === 1 || r === 13) st.pistol++
  if ((ctx.slot === 'half1' && !(r >= 5 && r <= 12)) || (ctx.slot === 'half2' && !(r >= 14 && r <= 24)) ||
      (ctx.slot === 'point' && !(ctx.mapPoint || r === 25))) st.slot++
  // and only where its premise holds, by the round record itself
  const myAttack = rl.aAttack === mineIsA
  const myBuy = mineIsA ? rl.buyA : rl.buyB
  if ((ATTACKING.has(node.id) && !myAttack) || (DEFENDING.has(node.id) && myAttack) ||
      (node.id === 'eco_gun' && myBuy !== 'eco') ||
      (node.id === 'map_point_mine' && ctx.mapPoint !== 'mine') || (node.id === 'map_point_theirs' && ctx.mapPoint !== 'theirs') ||
      (node.id === 'ot' && r !== 25)) {
    st.premise++
    if (st.premise <= 5) fail(`${node.id} 在第 ${r} 回合被问到，前提不成立（${myAttack ? '进攻' : '防守'}，${myBuy}）`)
  }
  // #5, answered naturally: the chance the button showed against how often it landed, and the round odds against the rounds
  if (natural) {
    st.naturalCalls++
    st.shownP += e.p / 100
    st.landed += +e.ok
  }
  if (natural && !node.decides && e.qok != null && e.qfail != null) {
    if (e.ok) { st.okN++; st.okShown += e.qok / 100; st.okWon += +won } else { st.failN++; st.failShown += e.qfail / 100; st.failWon += +won }
  }
}

for (const o of SCN) {
  const state = createCareer(o)
  const me = state.me!
  const meId = me.id
  const club = state.teams[state.myTeam]
  if (!club.starters.includes(meId)) club.starters = [meId, ...club.starters.filter((id) => id !== meId)].slice(0, 5)
  const comp = Object.keys(state.comps).find((k) => state.comps[k]?.region) ?? ''
  const opps = Object.values(state.teams)
    .filter((t) => t.id !== state.myTeam && !t.dormant && t.roster.length >= 5 && t.tier === club.tier && !t.id.startsWith('CUP_'))
    .map((t) => t.id).sort().slice(0, 6)
  const snapMe = JSON.stringify(state.me)
  const snapP = JSON.stringify(state.players[meId])
  for (const ans of ANSWERS) {
    for (let i = 0; i < PER2; i++) {
      state.me = JSON.parse(snapMe)
      state.players[meId] = JSON.parse(snapP)
      const mm = new MeMatch(state, { aId: state.myTeam, bId: opps[i % opps.length], bo: 3, comp, label: `dec:${o.seed}:${ans}:${i}` })
      const prng = new Rng(hashStr(`decpol:${o.seed}:${i}`))
      st.series++
      let guard = 0
      while (guard++ < 2000) {
        const k = mm.step()
        if (k === 'done') break
        if (k !== 'node') continue
        const pend = mm.pending!
        const m = mm.map!
        const idx = ans === 'random' ? prng.int(0, pend.node.a.length - 1) : pend.coach
        const at = m.rounds.length
        if (ans === 'bail') {
          // walking away with a call on the table: runOut makes it the coach's way, and its round still tells the line
          mm.runOut()
          const e = mm.nodes.find((x) => x.map === m.map && x.round === pend.ctx.round)!
          verify(pend.node, pend.ctx, pend.coach, e, m, at, null, meId, mm.mineIsA, false)
          if (!e.auto) fail(`${pend.node.id}：快进替你做的决定没记成托管`)
          break
        }
        const killsBefore = m.lines[meId].kills
        const e = chooseForced(mm, idx, ans === 'allok' ? true : ans === 'allfail' ? false : undefined)
        if (e.hl) fail(`${pend.node.id}：回合还没打，句子已经写好了`)
        if (mm.step() !== 'round') { fail(`${pend.node.id}：选完之后下一拍不是这一回合`); break }
        verify(pend.node, pend.ctx, idx, e, m, at, killsBefore, meId, mm.mineIsA, ans === 'coach' || ans === 'random')
      }
      if (!mm.done) fail(`${o.start} ${ans} #${i}：比赛没打完`)
      const perMap = new Map<string, number>()
      for (const n of mm.nodes) perMap.set(n.map, (perMap.get(n.map) ?? 0) + 1)
      if ([...perMap.values()].some((v) => v > 3)) st.overQuota++
    }
  }
}
console.log(`\n二、${st.series} 场 BO3（2 个角色 × 5 种答法 × ${PER2}），${st.calls} 次决定，其中定回合的 ${st.decided} 次 · ${secs()}`)
console.log(`  四格出现：成+赢 ${st.cells.okWin} · 成+输 ${st.cells.okLoss} · 败+赢 ${st.cells.failWin} · 败+输 ${st.cells.failLoss} · 说到你击杀的句子 ${st.killLines}`)
console.log(`  句子和回合记录矛盾 ${st.contra}（${f1(pct(st.contra, st.calls))}%）· 说你杀了人而你这回合 0 杀 ${st.killZero} · 击杀档不对 ${st.killBucket}`)
console.log(`  定回合的决定和回合结果不符 ${st.forced} · 没钉在那一回合上 ${st.unpinned} · 引擎读数和记下的不一致 ${st.plumbing} · 说图打完了却没打完（或反过来）${st.mapClaim} · 缺句子 ${st.fallback}`)
console.log(`  问在手枪局 ${st.pistol} · 不在关键回合 ${st.slot} · 前提不成立 ${st.premise} · 一张图超过 3 次 ${st.overQuota}`)
const pShown = st.naturalCalls ? st.shownP / st.naturalCalls : 0
const pReal = st.naturalCalls ? st.landed / st.naturalCalls : 0
const okRatio = st.okShown ? st.okWon / st.okShown : 1
const failRatio = st.failShown ? st.failWon / st.failShown : 1
console.log(`  #5 显示对兑现（自己答的 ${st.naturalCalls} 次）：成功率 显示 ${f1(100 * pShown)}% · 实际 ${f1(100 * pReal)}%；成了之后这回合 显示 ${f1(pct(st.okShown, st.okN))}% · 实际 ${f1(pct(st.okWon, st.okN))}%（${st.okN} 次，比 ${okRatio.toFixed(2)}）；没成之后 显示 ${f1(pct(st.failShown, st.failN))}% · 实际 ${f1(pct(st.failWon, st.failN))}%（${st.failN} 次，比 ${failRatio.toFixed(2)}）`)
if (st.contra) fail(`#13：${st.contra} 句和回合记录矛盾`)
if (st.killZero) fail(`#13：${st.killZero} 句说你杀了人，你那回合 0 杀`)
if (st.killBucket) fail(`${st.killBucket} 句的击杀档和真实击杀数不符`)
if (st.forced) fail(`${st.forced} 次定回合的决定和回合结果不符`)
if (st.unpinned) fail(`${st.unpinned} 句没钉在它说的那一回合上`)
if (st.plumbing) fail(`${st.plumbing} 次记下的胜负、击杀或句子和引擎读数不一致`)
if (st.mapClaim) fail(`${st.mapClaim} 句说图打完了却没打完，或反过来`)
if (st.fallback) fail(`${st.fallback} 次没有对应的句子（定回合节点出现了不可能的格子也算在这里）`)
if (st.noRound) fail(`${st.noRound} 次找不到决定对应的回合`)
if (st.pistol) fail(`${st.pistol} 次决定问在了手枪局`)
if (st.slot) fail(`${st.slot} 次决定不在它那个关键回合的范围里`)
if (st.premise) fail(`${st.premise} 次决定的前提（攻防、经济、赛点、加时）和回合记录对不上`)
if (st.overQuota) fail(`${st.overQuota} 场有一张图问了超过 3 次`)
if (st.calls < PER2 * 5) fail(`只问了 ${st.calls} 次，样本太少`)
// #5 is asserted in 四, over thousands of calls: a few hundred here leave ±10% to chance

/* ---- 三、the engine ---- */
{
  const state = createCareer(SCN[0])
  const teams = Object.values(state.teams)
    .filter((t) => !t.dormant && t.roster.length >= 5 && !t.id.startsWith('CUP_') && t.id !== state.myTeam)
    .map((t) => t.id).sort()
  let same = 0
  let flipped = 0
  const BO = [3, 1, 3, 5, 2] as const
  for (let i = 0; i < 200; i++) {
    const a = teams[(i * 7) % teams.length]
    const b = teams[(i * 13 + 5) % teams.length]
    if (a === b) continue
    const bo = BO[i % BO.length]
    const seed = hashStr(`decengine:${i}`)
    const natural = simulateMatch(state, a, b, bo, new Rng(seed))
    const again = simulateMatch(state, a, b, bo, new Rng(seed))
    // the same match with every round told the winner the roll gave it
    const winners = natural.maps.map((mp) => (mp.rounds ?? []).map((r) => (r.winner === 'A' ? 'a' : 'b') as 'a' | 'b'))
    const sim = new MatchSim(state, a, b, bo, new Rng(seed))
    let mi = 0
    while (!sim.decided && sim.nextMap()) {
      let ri = 0
      while (!sim.current!.over) sim.current!.playRound(winners[mi]?.[ri++])
      sim.closeMap()
      mi++
    }
    const n = JSON.stringify(natural)
    if (n === JSON.stringify(again) && n === JSON.stringify(sim.finish())) same++
    else fail(`#14：AI 对 AI #${i} ${a} vs ${b}：同一个种子两次打出来不一样，或指定成原本的胜者后不一样`)
    // and told the other side every round, it really is the other side's, with the rest still played out
    if (i % 20 === 0) {
      const s2 = new MatchSim(state, a, b, bo, new Rng(seed))
      while (!s2.decided && s2.nextMap()) {
        while (!s2.current!.over) s2.current!.playRound('b')
        s2.closeMap()
      }
      const r2 = s2.finish()
      const kills = r2.maps.reduce((s, mp) => s + Object.values(mp.lines).reduce((x, l) => x + l.kills, 0), 0)
      if (r2.mapsWonA === 0 && r2.mapsWonB > 0 && kills > 0) flipped++
      else fail(`AI 对 AI #${i}：每回合都指定 B 赢，结果是 ${r2.mapsWonA}-${r2.mapsWonB}，击杀 ${kills}`)
    }
  }
  console.log(`\n三、#14 ${same} 场 AI 对 AI：不指定胜者两次一样，指定成原本胜者也一模一样；${flipped} 场每回合指定 B 赢，B 全拿且击杀照常分配 · ${secs()}`)
}

/* ---- 四、the design's numbers ---- */
type Pol = 'auto' | 'coach' | 'random' | 'oracle' | 'allok' | 'allfail'
const POLS: Pol[] = ['auto', 'coach', 'random', 'oracle', 'allok', 'allfail']
const POL_CN: Record<Pol, string> = { auto: '快进', coach: '全听教练', random: '随机', oracle: '期望最优', allok: '全成功', allfail: '全失败' }
const BUCKETS = { under: -7, even: 0, fav: 7 } as const
type Bucket = keyof typeof BUCKETS
const BUCKET_CN: Record<Bucket, string> = { under: '劣势', even: '五五开', fav: '优势' }

function setup(start: 'chal' | 't1', seed: number, vet: boolean) {
  const state = createCareer({ name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2026 } as any)
  const me = state.me!
  const meId = me.id
  const mine = state.teams[state.myTeam]
  if (!mine.starters.includes(meId)) mine.starters = [meId, ...mine.starters.filter((id) => id !== meId)].slice(0, 5)
  if (vet) {
    const p = state.players[meId]
    for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], 80)
    recomputeOverall(p)
    me.mental = Math.max(me.mental, 70)
  }
  const comp = Object.keys(state.comps).find((k) => state.comps[k]?.region) ?? ''
  const pool = poolFor(state)
  const str = (id: string) => pool.reduce((acc, m) => { const L = buildLineup(state, id, m); return acc + (L.atk + L.def) / 2 }, 0) / pool.length
  const myS = str(state.myTeam)
  const cands = Object.values(state.teams).filter((t) => t.id !== state.myTeam && !t.dormant && t.roster.length >= 5 && t.starters.length === 5 && !t.id.startsWith('CUP_'))
  const gaps = cands.map((t) => ({ id: t.id, tag: t.tag, tier: t.tier, gap: myS - str(t.id) }))
  const opps = {} as Record<Bucket, typeof gaps>
  for (const [b, tgt] of Object.entries(BUCKETS) as [Bucket, number][]) {
    const near = (xs: typeof gaps) => xs.slice().sort((x, y) => Math.abs(x.gap - tgt) - Math.abs(y.gap - tgt)).slice(0, 3)
    const same = near(gaps.filter((g) => g.tier === mine.tier))
    opps[b] = same.length === 3 && same.every((g) => Math.abs(g.gap - tgt) <= 2) ? same : near(gaps)
  }
  const snapMe = JSON.stringify(state.me)
  const snapP = JSON.stringify(state.players[meId])
  const restore = () => { state.me = JSON.parse(snapMe); state.players[meId] = JSON.parse(snapP) }
  return { state, comp, opps, restore }
}

const SCN4 = [
  { key: 't1', name: 'VCT 新人首发', start: 't1' as const, seed: 7, vet: false },
  ...(FULL ? [
    { key: 'vet', name: 'VCT 首发·个人属性≥80', start: 't1' as const, seed: 7, vet: true },
    { key: 'chal', name: 'Challengers 首发', start: 'chal' as const, seed: 7, vet: false },
  ] : []),
]
for (const sc of SCN4) {
  const S = setup(sc.start, sc.seed, sc.vet)
  const { state, comp } = S
  /** per bucket and way of playing, series by series: [series won, maps won, maps] */
  const res = {} as Record<Bucket, Record<Pol, number[][]>>
  let calls = 0, series = 0, pistolCalls = 0, pointMaps = 0, pointCalled = 0
  /** #5 over every call answered by a way of playing (not forced): what the button showed against what happened */
  const n5 = { calls: 0, shownP: 0, landed: 0, okN: 0, okShown: 0, okWon: 0, failN: 0, failShown: 0, failWon: 0 }
  const shownP: number[] = []
  let gapCalls = 0, gapBig = 0
  const eff = { ok: [] as number[], fail: [] as number[] }
  for (const bucket of Object.keys(BUCKETS) as Bucket[]) {
    res[bucket] = {} as Record<Pol, number[][]>
    for (const pol of POLS) res[bucket][pol] = []
    const list = S.opps[bucket]
    for (let i = 0; i < PER; i++) {
      const opp = list[i % list.length]
      for (const pol of POLS) {
        S.restore()
        const mm = new MeMatch(state, { aId: state.myTeam, bId: opp.id, bo: 3, comp, label: `dec4:${sc.key}:${bucket}:${i}` })
        const prng = new Rng(hashStr(`dec4pol:${sc.key}:${bucket}:${i}`))
        if (pol === 'auto') mm.runOut()
        else {
          const hadPoint = new Set<number>()
          const gotPoint = new Set<number>()
          let guard = 0
          while (guard++ < 2000) {
            const m = mm.map
            if (m && !m.over && mm.playing && m.format !== 'full24') {
              const r = m.round + 1
              const my = mm.myRounds, th = mm.theirRounds
              if (r !== 1 && r !== 13 && ((my === 12 && th < 12) || (th === 12 && my < 12) || r === 25)) hadPoint.add(mm.sim.mapIndex)
            }
            const k = mm.step()
            if (k === 'done') break
            if (k !== 'node') continue
            const pend = mm.pending!
            const odds = pend.node.a.map((_, j) => mm.optionOdds(j))
            const value = odds.map((x) => x.p * x.ok + (1 - x.p) * x.fail)
            let idx = pend.coach
            if (pol === 'random') idx = prng.int(0, odds.length - 1)
            else if (pol === 'oracle' || pol === 'allok') idx = value.indexOf(Math.max(...value))
            if (pol === 'coach') {
              calls++
              if (pend.ctx.round === 1 || pend.ctx.round === 13) pistolCalls++
              if (pend.ctx.slot === 'point') gotPoint.add(mm.sim.mapIndex)
              shownP.push(...odds.map((x) => x.p))
              if (odds.length >= 2) { gapCalls++; if (Math.abs(odds[0].p - odds[1].p) >= 0.15) gapBig++ }
            }
            // #4: what a call is worth to the map, from the odds the round was drawn on and what that round is worth
            const base = mm.roundProb()
            const my = mm.myRounds, th = mm.theirRounds
            const roundWorth = mapWinProb(my + 1, th, base) - mapWinProb(my, th + 1, base)
            const e = chooseForced(mm, idx, pol === 'allok' ? true : pol === 'allfail' ? false : undefined)
            if (pol === 'coach') (e.ok ? eff.ok : eff.fail).push(((e.ok ? odds[idx].ok : odds[idx].fail) - base) * roundWorth)
          }
          if (pol === 'coach') { pointMaps += hadPoint.size; pointCalled += [...hadPoint].filter((x) => gotPoint.has(x)).length }
        }
        const rec = mm.record!
        if (pol === 'coach' || pol === 'random' || pol === 'oracle') {
          for (const e of mm.nodes) {
            n5.calls++
            n5.shownP += e.p / 100
            n5.landed += +e.ok
            if (e.decided || e.qok == null || e.qfail == null || e.won == null) continue
            if (e.ok) { n5.okN++; n5.okShown += e.qok / 100; n5.okWon += +e.won } else { n5.failN++; n5.failShown += e.qfail / 100; n5.failWon += +e.won }
          }
        }
        res[bucket][pol].push([+rec.won, mm.mapLog.filter((x) => x.won).length, mm.mapLog.length])
        if (pol === 'coach') series++
      }
    }
  }
  const rate = (b: Bucket, p: Pol) => pct(res[b][p].reduce((s, r) => s + r[0], 0), res[b][p].length)
  const mapRate = (b: Bucket, p: Pol) => pct(res[b][p].reduce((s, r) => s + r[1], 0), res[b][p].reduce((s, r) => s + r[2], 0))
  /** paired difference in series won, with its 95% half-width */
  const paired = (b: Bucket, x: Pol, y: Pol) => {
    const d = res[b][x].map((r, i) => r[0] - res[b][y][i][0])
    const mean = d.reduce((s, v) => s + v, 0) / d.length
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, d.length - 1))
    return { mean: 100 * mean, ci: (196 * sd) / Math.sqrt(d.length) }
  }
  const pd = (v: { mean: number; ci: number }) => `${v.mean >= 0 ? '+' : ''}${f1(v.mean)}（±${f1(v.ci)}）`
  console.log(`\n四、${sc.name} · 每档 ${PER} 场 BO3，六种打法同一批种子 · ${secs()}`)
  console.log(`  系列赛胜率（单图胜率）：${POLS.map((p) => POL_CN[p]).join(' / ')}`)
  for (const b of Object.keys(BUCKETS) as Bucket[]) {
    console.log(`    ${BUCKET_CN[b]}：${POLS.map((p) => `${f1(rate(b, p))}（${f1(mapRate(b, p))}）`).join(' / ')}`)
  }
  const sorted = shownP.slice().sort((a, b) => a - b)
  const q = (x: number) => 100 * (sorted[Math.floor(x * (sorted.length - 1))] ?? 0)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)
  const perSeries = calls / Math.max(1, series)
  const m4ok = 100 * mean(eff.ok)
  const m4fail = 100 * mean(eff.fail)
  const d6 = paired('even', 'oracle', 'auto')
  const d8 = paired('even', 'oracle', 'random')
  const lost9 = 100 - rate('even', 'allok')
  const w10 = rate('under', 'allok')
  const w11 = rate('fav', 'allfail')
  const bands: [string, string, boolean][] = [
    ['#1 每场 BO3 决定次数', `${perSeries.toFixed(1)}（目标 5–7）；打到赛点或加时的图 ${pointMaps} 张，问了赛点关键回合的 ${pointCalled} 张`, perSeries >= 5 && perSeries <= 7 && pointCalled === pointMaps],
    ['#2 落在手枪局', `${f1(pct(pistolCalls, calls))}%（目标 ≤10%）`, pct(pistolCalls, calls) <= 10],
    ['#3 成功率区间', `P5 ${f1(q(0.05))}% · P95 ${f1(q(0.95))}%（目标 35–85%）；两个选项差 ≥15 的决定 ${f1(pct(gapBig, gapCalls))}%（目标 ≥50%）`, q(0.05) >= 35 && q(0.95) <= 85 && pct(gapBig, gapCalls) >= 50],
    ['#4 一次决定对图胜率', `成 ${m4ok >= 0 ? '+' : ''}${f1(m4ok)} · 败 ${f1(m4fail)}（目标 成 +4~+7，败 −3~−6）`, m4ok >= 4 && m4ok <= 7 && m4fail <= -3 && m4fail >= -6],
    ['#6 五五开 期望最优 − 快进', `${pd(d6)}（目标 +6~+10）`, d6.mean >= 6 && d6.mean <= 10],
    ['#8 五五开 期望最优 − 随机', `${pd(d8)}（目标 ≥+4）`, d8.mean >= 4],
    ['#9 五五开 全部成功仍输', `${f1(lost9)}%（目标 20–30%）`, lost9 >= 20 && lost9 <= 30],
    ['#10 劣势 全部成功的胜率', `${f1(w10)}%（目标 40–50%）`, w10 >= 40 && w10 <= 50],
    ['#11 优势 全部失败的胜率', `${f1(w11)}%（目标 ≥60%）`, w11 >= 60],
  ]
  for (const [k, v, ok] of bands) {
    if (ok) console.log(`  ${k}：${v}`)
    else warn(`${k}：${v}`)
  }
  console.log('  #12 决定占图结果方差：快速检查不测（逻辑回归在 策划稿 F 节的探针里）')
  // #5, hard: the chance a button showed against how often it happened, over every call a way of playing answered
  const r5: [string, number, number][] = [
    ['成功率', n5.shownP ? n5.landed / n5.shownP : 1, n5.calls],
    ['成了之后这回合', n5.okShown ? n5.okWon / n5.okShown : 1, n5.okN],
    ['没成之后这回合', n5.failShown ? n5.failWon / n5.failShown : 1, n5.failN],
  ]
  console.log(`  #5 实际 ÷ 显示：${r5.map(([l, v, n]) => `${l} ${v.toFixed(3)}（${n} 次）`).join(' · ')}`)
  for (const [l, v] of r5) if (v < 0.9 || v > 1.1) fail(`#5：${sc.name} ${l} 实际 ÷ 显示 = ${v.toFixed(3)}，不在 0.9–1.1`)
  // #7, hard: following the coach by hand is never worse than 快进, at any strength
  for (const b of Object.keys(BUCKETS) as Bucket[]) {
    const d7 = paired(b, 'coach', 'auto')
    console.log(`  #7 ${BUCKET_CN[b]} 全听教练 − 快进：${pd(d7)}`)
    if (d7.mean + d7.ci < 0) fail(`#7：${sc.name}·${BUCKET_CN[b]} 全听教练比快进差 ${f1(-d7.mean)}（±${f1(d7.ci)}），显著为负`)
  }
}

console.log(bad ? `\n✗ ${bad} 项不对。` : `\n✓ 决定的句子和它那一回合对得上，按钮上的数就是兑现的数，AI 对 AI 不受影响，照教练打不比快进差。${warned ? `（${warned} 项在目标区间外，见 ⚠）` : ''} · ${secs()}`)
if (bad) process.exit(1)
