/**
 * 事件里的练习，落在已经卡住的一项上：算进破瓶颈，或者当场说清楚给不了。
 *
 * Reported 2026-09-16: an option that says 「练枪 +10」 was worth exactly zero
 * once 枪法 sat at its ceiling — addXp drops it, nothing is banked, and the
 * button had promised progress anyway — so the player stopped reading the cards
 * and answered at random. The two older rules still hold and are held here:
 * 「卡在瓶颈时不再存点」 and 「练满的突破进度一定要兑现成看得见的突破」.
 *
 *  一 the four counted paths a week board books (排位、复盘、道具与跑图、训练赛):
 *    an event's xp adds to that path's count, the 「怎么破」 card shows the new
 *    number, and a count events finish opens the ceiling at the next settlement
 *  二 the cap: events may hand a path at most a third of what it needs, and past
 *    that they say so instead of taking the xp
 *  三 the paths an event cannot honestly join (枪法's weeks in a row, 残局 and
 *    指挥's matches): refused in plain words, never silently
 *  四 the whole pool, card by card, each on a fresh path: no option promises xp
 *    that has nowhere to go, the button's sentence is the result's sentence,
 *    and no line is empty
 *  五 one real card fired and answered: the button, the result and the log all
 *    say the same sentence
 *  六 a career with all eight pinned at their ceilings: nothing banks anywhere,
 *    and the ceilings still open
 *
 *   npx tsx scripts/check_eventxp.ts [weeks=80]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { applyEffect } from '../src/engine/me/fx'
import { EVENTS, describeEffect, eventOf, fireEvent, resolveEvent } from '../src/engine/me/events'
import {
  BREAK_PATHS, EVT_PATHS, EVT_XP_PER, bottleneckWeek, breakCount, breakInfo,
  ceilingPotential, ceilingXp, ensureCeilings, evtCap,
} from '../src/engine/me/bottleneck'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_CN, ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState } from '../src/engine/types'

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

type K = keyof Attrs
const WEEKS = Number(process.argv[2] ?? 80)
let bad = 0
const fail = (m: string): void => { bad++; console.log(`  ✗ ${m}`) }
const pass = (m: string): void => { console.log(`  ✓ ${m}`) }

/** one event's worth of practice: what the cards actually hand out */
const XP = 12
const REFUSED = ['先破瓶颈', '顶满']
const isRefusal = (t: string): boolean => REFUSED.some((w) => t.includes(w))

/** Pin one attribute where it stands: that is its ceiling now, with a clean book under it. */
function pin(s: GameState, k: K): number {
  const p = s.players[s.me!.id]
  const bn = ensureCeilings(s)!
  const at = Math.min(95, Math.max(60, p.attrs[k]))
  p.caps![k] = at
  p.attrs[k] = at
  p.xp[k] = 0
  bn.count[k] = 0
  bn.mech[k] = 0
  if (bn.mechV) bn.mechV[k] = 0
  if (bn.evt) bn.evt[k] = 0
  recomputeOverall(p)
  p.potential = ceilingPotential(p)
  bn.pot = p.potential
  return at
}

/** Answer one option's practice, as the card does: the promise first, then what happened. */
function give(s: GameState, k: K, xp = XP): { promise: string; label: string; line: string } {
  const promise = ceilingXp(s, k, xp).text
  const label = describeEffect({ xp: { [k]: xp } }, s)
  const lines = applyEffect(s, { xp: { [k]: xp } })
  return { promise, label, line: lines[0] ?? '' }
}

/** Nothing banked at a ceiling, and the bar did not move. */
function held(s: GameState, k: K, where: string, attr0: number): void {
  const p = s.players[s.me!.id]
  if (p.attrs[k] !== attr0) fail(`${where}：${ATTR_CN[k]} 从 ${attr0} 变成了 ${p.attrs[k]}`)
  if ((p.xp[k] ?? 0) !== 0) fail(`${where}：${ATTR_CN[k]} 卡在瓶颈上还存下了 ${Math.round(p.xp[k] ?? 0)} xp`)
}

// ------------------------------------------------------------------ a career to probe
const base = createCareer({
  name: 'Probe', region: 'Europe', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7,
})
for (let i = 0; i < 20; i++) if (autoWeek(base).kind === 'game-over') break
ensureCeilings(base)
const pro = base.me!.phase === 'pro'
console.log(`探针：${base.year} 年第 ${base.day} 天，${pro ? '有俱乐部' : '还没签约'}\n`)

// ------------------------------------------------------------------ 一、二 the counted paths, and the cap
console.log('一、二 能算进的四条路：算进计数，封顶之后明说')
for (const k of EVT_PATHS) {
  const s = structuredClone(base)
  if (BREAK_PATHS[k].pro && s.me!.phase !== 'pro') { console.log(`  ${ATTR_CN[k]}：还没签约，这条路开不了，跳过`); continue }
  const at = pin(s, k)
  const need = breakCount(s, k)!.need
  const cap = evtCap(need)
  let took = 0
  for (let i = 0; i < cap + 2; i++) {
    const have0 = breakCount(s, k)!.have
    const r = give(s, k)
    held(s, k, `${ATTR_CN[k]} 第 ${i + 1} 次`, at)
    const have1 = breakCount(s, k)!.have
    if (!r.line) { fail(`${ATTR_CN[k]}：第 ${i + 1} 次事件练习一句话都没说，${have1 > have0 ? '计数却动了' : 'xp 就这么没了'}`); break }
    if (r.line !== r.promise || !r.label.includes(r.promise)) {
      fail(`${ATTR_CN[k]}：按钮上写「${r.label}」，实际是「${r.line}」`)
    }
    if (i < cap) {
      took += have1 - have0
      if (have1 !== have0 + 1) fail(`${ATTR_CN[k]}：一次事件练习应该算 1 次，计数 ${have0} → ${have1}`)
      if (!r.line.includes('算进')) fail(`${ATTR_CN[k]}：算进了计数，说的却是「${r.line}」`)
      const prog = breakInfo(s, k).prog
      if (!prog.includes(`${Math.min(have1, need)}/${need}`)) fail(`${ATTR_CN[k]}：卡片上的「${prog}」没跟上计数 ${have1}/${need}`)
    } else {
      if (have1 !== have0) fail(`${ATTR_CN[k]}：事件最多顶 ${cap} 次，第 ${i + 1} 次还是算进去了（${have0} → ${have1}）`)
      if (!isRefusal(r.line)) fail(`${ATTR_CN[k]}：顶满之后没说清楚，只说了「${r.line}」`)
    }
  }
  pass(`${ATTR_CN[k]}：${need} 次里事件最多顶 ${cap} 次（实际算进 ${took} 次，每次 ${XP} xp）；再来就写明「${ceilingXp(s, k, XP).text}」`)
}

// a count events finish opens the ceiling at the next settlement, and the book starts over
{
  const k: K = 'awareness'
  const s = structuredClone(base)
  const p = s.players[s.me!.id]
  const at = pin(s, k)
  const bn = s.me!.bottleneck!
  const need = breakCount(s, k)!.need
  bn.count[k] = need - 1
  const r = give(s, k)
  held(s, k, '事件补上最后一次复盘', at)
  if (breakCount(s, k)!.have !== need) fail(`事件补上最后一次：计数 ${breakCount(s, k)!.have}/${need}，没满`)
  const mark = s.me!.log[s.me!.log.length - 1]
  bottleneckWeek(s)
  const said = s.me!.log.slice(s.me!.log.lastIndexOf(mark) + 1).map((l) => l.text)
  const opened = p.caps![k] > at && said.some((t) => t.startsWith('瓶颈松动'))
  if (!opened) fail(`事件补满的计数没在周结算时破开瓶颈：${ATTR_CN[k]} 还是 ${p.caps![k]}，日志「${said.join(' | ') || '什么都没说'}」`)
  else if ((bn.evt?.[k] ?? 0) !== 0 || (bn.count[k] ?? 0) !== 0) fail(`破开之后计数没归零：计数 ${bn.count[k]}，事件顶过 ${bn.evt?.[k]}`)
  else pass(`事件补上最后一次复盘（${r.line}），周结算当场破开：${ATTR_CN[k]}的瓶颈 ${at} → ${p.caps![k]}，计数和事件额度都归零`)
}

// ------------------------------------------------------------------ 三 the ones an event cannot join
console.log('\n三 算不进的几项：当场说清楚，不是静悄悄')
for (const k of ATTR_KEYS.filter((x) => !EVT_PATHS.includes(x))) {
  const s = structuredClone(base)
  const at = pin(s, k)
  const have0 = breakCount(s, k)?.have ?? 0
  const r = give(s, k)
  held(s, k, ATTR_CN[k], at)
  if ((breakCount(s, k)?.have ?? 0) !== have0) fail(`${ATTR_CN[k]}：这条路不该被事件顶，计数却动了`)
  if (!isRefusal(r.line)) fail(`${ATTR_CN[k]}：卡在瓶颈上的事件练习说的是「${r.line || '（什么都没说）'}」`)
  if (r.line !== r.promise || !r.label.includes(r.promise)) fail(`${ATTR_CN[k]}：按钮上写「${r.label}」，实际是「${r.line}」`)
}
pass(`${ATTR_KEYS.filter((x) => !EVT_PATHS.includes(x)).map((k) => ATTR_CN[k]).join('、')}：都写明「${ceilingXp((() => { const s = structuredClone(base); pin(s, 'aim'); return s })(), 'aim', XP).text}」这样的话`)

// ------------------------------------------------------------------ 四 the whole pool, card by card
console.log('\n四 事件池：没有一个选项在瓶颈上还说「有长进」')
let opts = 0
let promised = 0
let counted = 0
let refused = 0
for (const k of ATTR_KEYS) {
  const s = structuredClone(base)
  for (const ev of EVENTS) {
    for (const o of ev.a) {
      const xp = o.e.xp?.[k]
      if (!xp) continue
      opts++
      // each card judged on a path nobody has touched: what this one option is worth, on its own
      const at = pin(s, k)
      const label = describeEffect({ xp: { [k]: xp } }, s)
      if (label.includes(`${ATTR_CN[k]}有长进`)) { promised++; fail(`${ev.id}「${o.t}」：${ATTR_CN[k]} 已经到瓶颈，按钮还在说「有长进」`) }
      const have0 = breakCount(s, k)?.have ?? 0
      const line = applyEffect(s, { xp: { [k]: xp } })[0] ?? ''
      held(s, k, `${ev.id}「${o.t}」`, at)
      const moved = (breakCount(s, k)?.have ?? 0) > have0
      if (!line) fail(`${ev.id}「${o.t}」：${ATTR_CN[k]} 的 ${xp} xp 一声不响地没了`)
      else if (moved) counted++
      else if (isRefusal(line)) refused++
      else fail(`${ev.id}「${o.t}」：计数没动，话也没说明白——「${line}」`)
      if (label !== line) fail(`${ev.id}「${o.t}」：按钮「${label}」和结果「${line}」对不上`)
    }
  }
}
if (!promised) pass(`事件池里带训练的选项 ${opts} 次落在瓶颈上：${counted} 次算进计数，${refused} 次写明给不了，没有一次写成「有长进」，也没有一次悄悄消失`)

// ------------------------------------------------------------------ 五 one real card, fired and answered
console.log('\n五 真事件走一遍：按钮、结果和日志是同一句话')
{
  const s = structuredClone(base)
  // Warm-up may stop with a real card awaiting an answer (seed 7, day 140:
  // ch_show_ok). fireEvent correctly refuses to cover it with a second card.
  // Answer that card normally before preparing this isolated patch-XP case;
  // do not bypass event conditions or change the warm state used elsewhere.
  if (s.me!.pendingEvent) {
    const waiting = eventOf(s.me!.pendingEvent)
    if (!waiting) throw new Error(`探针有找不到定义的待处理事件：${s.me!.pendingEvent}`)
    resolveEvent(s, waiting.id, waiting.rec)
  }
  const k: K = 'utility'
  pin(s, k)
  const ev = eventOf('patch')!
  const pick = ev.a.findIndex((o) => !!o.e.xp?.[k])
  const xp = ev.a[pick]?.e.xp?.[k] ?? 0
  const promise = ceilingXp(s, k, xp).text
  const label = describeEffect(ev.a[pick].e, s)
  if (pick < 0 || !fireEvent(s, ev.id)) fail('探针设置不对：这张卡发不出来')
  else {
    const lines = resolveEvent(s, ev.id, pick)
    const log = s.me!.log[s.me!.log.length - 1]?.text ?? ''
    if (!label.includes(promise)) fail(`按钮上写的是「${label}」，不是「${promise}」`)
    if (!lines.includes(promise)) fail(`结果里没有那句话：「${lines.join('，')}」`)
    if (!log.includes(promise)) fail(`日志里没有那句话：「${log}」`)
    if ((breakCount(s, k)?.have ?? 0) !== 1) fail(`${ATTR_CN[k]} 的计数没跟着动：${breakCount(s, k)?.have}/${breakCount(s, k)?.need}`)
    else pass(`「${ev.a[pick].t}」（${ATTR_CN[k]} ${xp} xp）：按钮、结果、日志都是「${promise}」`)
  }
}

// ------------------------------------------------------------------ 六 a career with all eight pinned
console.log('\n六 八项全卡在瓶颈上，托管一段')
{
  const s = structuredClone(base)
  const p = s.players[s.me!.id]
  const bn = ensureCeilings(s)!
  // pinned where he stands, with the bars emptied: a bar that reaches a ceiling keeps nothing anyway (me/growth.ts addXp)
  for (const k of ATTR_KEYS) { p.caps![k] = p.attrs[k]; p.xp[k] = 0 }
  p.potential = ceilingPotential(p)
  bn.pot = p.potential
  const from = s.me!.log.length
  let weeks = 0
  while (weeks++ < WEEKS) {
    if (autoWeek(s).kind === 'game-over') break
    for (const k of ATTR_KEYS) {
      if (p.attrs[k] >= p.caps![k] && (p.xp[k] ?? 0) > 0) fail(`第 ${weeks} 周：${ATTR_CN[k]} 卡在瓶颈 ${p.caps![k]}，还存着 ${Math.round(p.xp[k] ?? 0)} xp`)
      if (p.attrs[k] > p.caps![k]) fail(`第 ${weeks} 周：${ATTR_CN[k]} ${p.attrs[k]} 超过瓶颈 ${p.caps![k]}`)
    }
  }
  const said = s.me!.log.slice(from)
  const evs = said.filter((l) => l.kind === 'event')
  const took = evs.filter((l) => l.text.includes('算进')).length
  const told = evs.filter((l) => isRefusal(l.text)).length
  const broke = said.filter((l) => l.text.startsWith('瓶颈松动')).length
  console.log(`  ${weeks} 周，事件 ${evs.length} 张：${took} 张把练习算进了计数，${told} 张写明练不动了；这段里瓶颈松动 ${broke} 次`)
  if (!broke) fail(`${weeks} 周里一个瓶颈都没破开，这一段测不出东西`)
  else pass('八项全卡在瓶颈上跑完一段：没有一项存下 xp，瓶颈照样破得开')
}

console.log(bad
  ? `\n✗ ${bad} 处不对`
  : `\n✓ 卡在瓶颈上的事件练习不再白给：排位、复盘、道具与跑图、训练赛按 ${EVT_XP_PER} xp 算 1 次、最多顶三分之一，其余几项当场写明「先破瓶颈」；按钮上的话就是结果那句话，瓶颈上依旧不存点。`)
if (bad) process.exit(1)
