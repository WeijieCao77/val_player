/**
 * In-match decisions against the rounds they are about.
 *
 * Players sent it in (2026-09-12): 「做出正确选择显示我把人都杀完了，结果这个回合
 * 却输了」. A call's line used to be picked before its round was played, and the
 * round was rolled on its own afterwards: one line in eight said the opposite of
 * the round record beside it, and 「两个都是你打的」 sat on rounds where I had no
 * kill at all 44% of the time. Now the round is played first and the line is read
 * off it; this check keeps it that way.
 *
 *   一、the copy: four lines per option (two for a node that decides its round),
 *       each one saying the result its case is for, and nothing about my kills
 *       unless it is picked by my kill count
 *   二、matches played call by call on fixed seeds, answered five ways: every line
 *       read against the round record it is pinned to — who took the round, my
 *       kills in it, whether the map ended — and every call that decides its round
 *       against that round
 *   三、the engine: a round given its winner plays out exactly as the same round
 *       left to the roll when the two agree, and a match given no winner is the
 *       match simulateMatch plays — so AI-only matches cannot tell the difference.
 *       (A stored hash would fail on every deliberate engine change; the before
 *       and after of the change that added the parameter were compared in full
 *       when it went in: 720 AI matches and 80 skipped ones, e65e672b… both.)
 *
 *   npx tsx scripts/check_decisions.ts [matches per scenario and answer=60]
 */
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MeMatch } from '../src/engine/me/matchplay'
import { NODES, NODE_HL, nodeLine } from '../src/engine/me/nodes'
import type { HlCell, HlOpt, NodeDef } from '../src/engine/me/nodes'
import type { NodeLogEntry } from '../src/engine/me/types'
import { MatchSim, simulateMatch } from '../src/engine/match'
import type { MapSim } from '../src/engine/match'
import { Rng, hashStr } from '../src/engine/rng'

const PER = Number(process.argv[2] ?? 60)
let bad = 0
const fail = (m: string) => { bad++; if (bad <= 30) console.log(`  ✗ ${m}`) }
const t0 = Date.now()

/** a kill of mine, said in words */
const KILL = /放倒|打掉|带走|收掉|击杀|首杀|双杀|两个都|收的|换掉/
const TWO = /两个|连着|双杀/
/** the round, said in words — a line has to say which, and must not say both */
const WIN = /(?<!没)拿下|收下|抢了回来|赢了下来/
const LOSS = /丢了|没拿下|没收住|溜走|交了出去|没翻过来|没扛住|没打起来/
/** words from another game: the official ones are 辐能芯片、安装、拆除 */
const FOREIGN = /下包|炸包|拆包|包点|包已经/
const CELLS: HlCell[] = ['okWin', 'okLoss', 'failWin', 'failLoss']

/* ---- 一、the copy ---- */
{
  let lines = 0
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
  }
  const decides = NODES.filter((n) => n.decides).map((n) => n.id)
  console.log(`一、${NODES.length} 个节点、${NODES.reduce((s, n) => s + n.a.length, 0)} 个选项，文案 ${lines} 句；定这一回合的节点：${decides.join('、')}`)
  if (!decides.length) fail('没有定这一回合的节点')
}

/* ---- 二、matches, call by call ---- */
type Answer = 'coach' | 'random' | 'allok' | 'allfail' | 'bail'
const ANSWERS: Answer[] = ['coach', 'random', 'allok', 'allfail', 'bail']
const SCN: any[] = [
  { name: 'DecA', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 },
  { name: 'DecB', region: 'Pacific', role: '哨卫', talents: emptyTalents(), originKey: 'streamer', start: 'chal', seed: 11, year: 2026 },
]
const st = {
  calls: 0, series: 0, contra: 0, killZero: 0, killBucket: 0, unpinned: 0, plumbing: 0,
  decided: 0, forced: 0, fallback: 0, mapClaim: 0, noRound: 0,
  cells: { okWin: 0, okLoss: 0, failWin: 0, failLoss: 0 } as Record<HlCell, number>,
  killLines: 0,
}

/** the call's line against its round, read straight off the engine — nothing taken from MeMatch's own bookkeeping */
function verify(node: NodeDef, idx: number, e: NodeLogEntry, m: MapSim, at: number, killsBefore: number | null, meId: string, mineIsA: boolean): void {
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
    for (let i = 0; i < PER; i++) {
      state.me = JSON.parse(snapMe)
      state.players[meId] = JSON.parse(snapP)
      const mm = new MeMatch(state, { aId: state.myTeam, bId: opps[i % opps.length], bo: 3, comp, label: `dec:${o.seed}:${ans}:${i}` })
      const inner = mm as unknown as { nodeRng: Rng }
      const prng = new Rng(hashStr(`decpol:${o.seed}:${i}`))
      st.series++
      let guard = 0
      while (guard++ < 2000) {
        const k = mm.step()
        if (k === 'done') break
        if (k !== 'node') continue
        const pend = mm.pending!
        const m = mm.map!
        const idx = ans === 'random' ? prng.int(0, pend.node.a.length - 1) : pend.node.rec
        const at = m.rounds.length
        if (ans === 'bail') {
          // walking away with a call on the table: runOut answers it, and its round still tells the line
          mm.runOut()
          const e = mm.nodes[mm.nodes.length - 1]
          verify(pend.node, pend.node.rec, e, m, at, null, meId, mm.mineIsA)
          break
        }
        const killsBefore = m.lines[meId].kills
        let e: NodeLogEntry
        if (ans === 'allok' || ans === 'allfail') {
          const nr = inner.nodeRng
          const orig = nr.chance
          nr.chance = () => { nr.next(); return ans === 'allok' }
          try { e = mm.choose(idx) } finally { nr.chance = orig }
        } else e = mm.choose(idx)
        if (e.hl) fail(`${pend.node.id}：回合还没打，句子已经写好了`)
        if (mm.step() !== 'round') { fail(`${pend.node.id}：选完之后下一拍不是这一回合`); break }
        verify(pend.node, idx, e, m, at, killsBefore, meId, mm.mineIsA)
      }
      if (!mm.done) fail(`${o.start} ${ans} #${i}：比赛没打完`)
    }
  }
}
const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : '0.0'}%`
console.log(`\n二、${st.series} 场 BO3（2 个角色 × 5 种答法 × ${PER}），${st.calls} 次决定，其中定回合的 ${st.decided} 次 · ${((Date.now() - t0) / 1000).toFixed(0)} 秒`)
console.log(`  四格出现：成+赢 ${st.cells.okWin} · 成+输 ${st.cells.okLoss} · 败+赢 ${st.cells.failWin} · 败+输 ${st.cells.failLoss} · 说到你击杀的句子 ${st.killLines}`)
console.log(`  句子和回合记录矛盾 ${st.contra}（${pct(st.contra, st.calls)}）· 说你杀了人而你这回合 0 杀 ${st.killZero} · 击杀档不对 ${st.killBucket}`)
console.log(`  定回合的决定和回合结果不符 ${st.forced} · 没钉在那一回合上 ${st.unpinned} · 引擎读数和记下的不一致 ${st.plumbing} · 说图打完了却没打完（或反过来）${st.mapClaim} · 缺句子 ${st.fallback}`)
if (st.contra) fail(`${st.contra} 句和回合记录矛盾`)
if (st.killZero) fail(`${st.killZero} 句说你杀了人，你那回合 0 杀`)
if (st.killBucket) fail(`${st.killBucket} 句的击杀档和真实击杀数不符`)
if (st.forced) fail(`${st.forced} 次定回合的决定和回合结果不符`)
if (st.unpinned) fail(`${st.unpinned} 句没钉在它说的那一回合上`)
if (st.plumbing) fail(`${st.plumbing} 次记下的胜负、击杀或句子和引擎读数不一致`)
if (st.mapClaim) fail(`${st.mapClaim} 句说图打完了却没打完，或反过来`)
if (st.fallback) fail(`${st.fallback} 次没有对应的句子（定回合节点出现了不可能的格子也算在这里）`)
if (st.noRound) fail(`${st.noRound} 次找不到决定对应的回合`)
if (st.calls < PER * 5) fail(`只问了 ${st.calls} 次，样本太少`)

/* ---- 三、the engine ---- */
{
  const state = createCareer(SCN[0])
  const teams = Object.values(state.teams)
    .filter((t) => !t.dormant && t.roster.length >= 5 && !t.id.startsWith('CUP_') && t.id !== state.myTeam)
    .map((t) => t.id).sort()
  let same = 0
  let flipped = 0
  const BO = [3, 1, 3, 5, 2] as const
  const M = 200
  for (let i = 0; i < M; i++) {
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
    const told = sim.finish()
    const n = JSON.stringify(natural)
    if (n === JSON.stringify(again) && n === JSON.stringify(told)) same++
    else fail(`AI 对 AI #${i} ${a} vs ${b}：同一个种子两次打出来不一样，或指定成原本的胜者后不一样`)
    // and told the other side every round, it really is the other side's, with the rest still played out
    if (i % 20 === 0) {
      const s2 = new MatchSim(state, a, b, bo, new Rng(seed))
      while (!s2.decided && s2.nextMap()) {
        while (!s2.current!.over) s2.current!.playRound('b')
        s2.closeMap()
      }
      const r2 = s2.finish()
      const kills = r2.maps.reduce((s, mp) => s + Object.values(mp.lines).reduce((x, l) => x + l.kills, 0), 0)
      if (r2.mapsWonB >= Math.min(r2.maps.length, Math.ceil(bo / 2)) && r2.mapsWonA === 0 && kills > 0) flipped++
      else fail(`AI 对 AI #${i}：每回合都指定 B 赢，结果是 ${r2.mapsWonA}-${r2.mapsWonB}，击杀 ${kills}`)
    }
  }
  console.log(`\n三、${same} 场 AI 对 AI：不指定胜者两次一样，指定成原本胜者也一模一样；${flipped} 场每回合指定 B 赢，B 全拿且击杀照常分配`)
}

console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 决定的句子和它那一回合对得上，定回合的节点定了回合，AI 对 AI 不受影响。')
if (bad) process.exit(1)
