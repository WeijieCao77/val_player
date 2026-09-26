/**
 * 赛前 / 赛后采访 on the key matches (me/interview.ts, the author's plan of 2026-09-26).
 *
 * 一 which matches: a first start, a grand final, an upper-bracket final, a lower-bracket tie, an international's
 *    playoffs, a former club — yes; an ordinary league round — no; the bench, a lay-off — never
 * 二 the season's cap (IV_CAP), the bigger kinds keep their room
 * 三 托管 / the × take the first answer: no follower, heat or 心态 lost, no edge on the match
 * 四 狠 + a win is 说到做到 (followers up), 狠 + a loss is 打脸 (followers down) and asks 认错 / 嘴硬 / 甩锅; the
 *    match's MVP is asked whose night it was
 * 五 bounded: only 心态, 状态, followers, heat, trust and bonds move; 狠's edge is this match's calls only, and the
 *    series it moves by at most two points, measured on paired simulations (the same fixture, the same draws)
 * 六 a save round-trip keeps the waiting card and what was said
 * 七 the real lines: at least 50, each with a source, a date, situation tags and a short quote; one is found for its
 *    own match and round, and that exact line comes before any 类似的时刻
 * 七b a moment with no line of its own gets one said at a moment like it, never twice in a career until every line
 *    for that kind of moment has been shown
 * 八 a long 托管 career: never more than IV_CAP a season, every one on a start, the generic press card kept apart;
 *    no question asked twice in a season, pre-match or post-match, and no pre-match question twice in the career
 *    (the author, 2026-09-26: 「不然玩家很快就会发现重复」)
 *
 *   npx tsx scripts/check_interviews.ts [pairs=800] [seasons=4]
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import {
  IV_ATE, IV_BOLD_NODE, IV_CAP, IV_KEPT, IV_KEPT_BIG, IV_MOMENTS, IV_BANK_SIZE,
  interviewAfterMatch, interviewBeforeMatch, ivAnswer, ivCard, ivCount, ivEdge, ivQuiet, keyKind, likeMoment, momentFor,
} from '../src/engine/me/interview'
import type { IvSituation } from '../src/engine/me/interview'
import { MeMatch } from '../src/engine/me/matchplay'
import { packState, unpackState } from '../src/engine/save'
import { eventOf } from '../src/engine/me/events'
import type { Fixture, GameState } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const PAIRS = Number(process.argv[2] ?? 800)
const SEASONS = Number(process.argv[3] ?? 4)
const t0 = Date.now()
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }

const base = createCareer({ name: '采访', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 3, year: 2025 })
assert.equal(base.me!.phase, 'pro')

/** the career named in the five, nothing waiting */
function fresh(): GameState {
  const s = structuredClone(base)
  const t = s.teams[s.myTeam]
  if (!t.starters.includes(s.me!.id)) t.starters = [s.me!.id, ...t.starters.filter((id) => id !== s.me!.id).slice(0, 4)]
  s.me!.pending = []
  s.me!.pendingEvent = undefined
  s.players[s.me!.id].injuredUntil = 0
  // a name with a following to lose, so a loss is measured rather than floored at nothing
  s.me!.fans = 500
  s.me!.heat = 100
  return s
}
const opp = (s: GameState, k = 0): string => Object.values(s.teams).filter((t) => t.id !== s.myTeam && !t.dormant && t.starters.length >= 5 && t.tier === 1)[k].id
/** the year's second Masters as this world has it — booked by the season's set-up, or put in for the check */
function intlComp(s: GameState) {
  const hit = Object.values(s.comps).find((c) => c.stage === 'masters2')
  if (hit) return hit
  const c = { key: 'masters2', name: '多伦多大师赛', stage: 'masters2', format: 'masters', teams: [], finished: [], standings: {} }
  ;(s.comps as Record<string, unknown>)[c.key] = c
  return s.comps[c.key]
}
const compOf = (s: GameState, cls: 'league' | 'intl' = 'league') => {
  const all = Object.values(s.comps)
  return cls === 'intl' ? intlComp(s) : all.find((c) => c.teams.includes(s.myTeam) && c.stage !== 'masters1' && c.stage !== 'masters2' && c.stage !== 'champions') ?? all[0]
}
let seq = 0
function fx(s: GameState, label: string, o = opp(s), comp = compOf(s)): Fixture {
  const f: Fixture = { id: `IV${seq++}`, day: s.day, stage: comp.stage as Fixture['stage'], comp: comp.key, teamA: s.myTeam, teamB: o, bo: 3, label, played: false }
  s.fixtures.push(f)
  return f
}
/** one start already on the books, so a fixture is not the debut */
function started(s: GameState): GameState {
  s.me!.seasonStart.starts = Math.max(1, s.me!.seasonStart.starts)
  s.me!.flags.ivDebut = s.year
  return s
}
const rec = (f: Fixture, won: boolean, mvp = false, isStarted = true): MeMatchRecord =>
  ({ fixtureId: f.id, day: 0, year: 0, comp: '', label: '', opp: '', oppTag: '', friendly: false, started: isStarted, won, score: won ? '2-1' : '1-2', maps: 3, rounds: 60, kills: 0, deaths: 0, assists: 0, firstKills: 0, clutches: 0, acs: 0, rating: 1, mvp, carried: false, nodes: [], rank: 1, highlights: [] }) as unknown as MeMatchRecord
const pendingIv = (s: GameState) => s.me!.pending.filter((x) => x.kind === 'interview')

check('一 which matches are key', () => {
  const s = fresh()
  const f0 = fx(s, '常规赛 第3轮')
  assert.equal(keyKind(s, f0)?.kind, 'debut', 'the first start is a debut')
  started(s)
  assert.equal(keyKind(s, f0), null, 'an ordinary league round is not a key match')
  assert.equal(interviewBeforeMatch(s, f0), false)
  assert.equal(keyKind(s, fx(s, 'KO:6:总决赛'))?.kind, 'final')
  assert.equal(keyKind(s, fx(s, 'KO:3:胜者组决赛'))?.kind, 'ubf')
  assert.equal(keyKind(s, fx(s, 'KO:4:败者组半决赛'))?.kind, 'elim')
  s.me!.flags.ivIntl = s.year
  assert.equal(keyKind(s, fx(s, 'KO:2:胜者组第二轮', opp(s), compOf(s, 'intl')))?.kind, 'intl_po')
  // a former club, by the name I played a season under
  const o = opp(s, 3)
  s.me!.seasons.push({ year: s.year - 1, team: s.teams[o].name, tier: 1, matches: 10, starts: 10, wins: 5, acs: 200, overallFrom: 60, overallTo: 62, titles: [] })
  assert.equal(keyKind(s, fx(s, '常规赛 第5轮', o))?.kind, 'club')
})

check('一 never from the bench, hurt or away; a pre card is pushed for a key match on the five', () => {
  const s = started(fresh())
  const t = s.teams[s.myTeam]
  const f = fx(s, 'KO:6:总决赛')
  const five = [...t.starters]
  t.starters = t.roster.filter((id) => id !== s.me!.id).slice(0, 5)
  assert.equal(interviewBeforeMatch(s, f), false, 'the bench')
  t.starters = five
  s.players[s.me!.id].injuredUntil = s.day + 5
  assert.equal(interviewBeforeMatch(s, f), false, 'hurt')
  s.players[s.me!.id].injuredUntil = 0
  assert.equal(interviewBeforeMatch(s, f), true)
  assert.equal(pendingIv(s).length, 1)
  assert.equal(interviewBeforeMatch(s, f), false, 'once a fixture')
  assert.equal(ivQuiet(s), false, 'the generic 赛后采访 stays away while one waits')
  assert.equal(eventOf('interview')!.when(s), false)
})

check(`二 at most ${IV_CAP} a season; a crowded season lets the grudges go first`, () => {
  const s = started(fresh())
  let n = 0
  for (let i = 0; i < 20; i++) {
    const f = fx(s, 'KO:6:总决赛')
    if (interviewBeforeMatch(s, f)) { n++; ivAnswer(s, `pre:${f.id}`, 0, true); s.me!.pending = [] }
  }
  assert.equal(n, IV_CAP)
  assert.equal(ivCount(s), IV_CAP)
  const t = started(fresh())
  t.me!.iv = { year: t.year, n: IV_CAP - 3, total: 0, seen: [], asked: [] }
  const o = opp(t, 3)
  t.me!.seasons.push({ year: t.year - 1, team: t.teams[o].name, tier: 1, matches: 1, starts: 1, wins: 0, acs: 0, overallFrom: 0, overallTo: 0, titles: [] })
  assert.equal(interviewBeforeMatch(t, fx(t, '常规赛 第5轮', o)), false, 'a former club gives way with three places left')
  assert.equal(interviewBeforeMatch(t, fx(t, 'KO:6:总决赛')), true, 'a final does not')
  // a new season counts from nothing
  t.year++
  assert.equal(ivCount(t), 0)
})

const snap = (s: GameState) => ({ fans: s.me!.fans, heat: s.me!.heat, mental: s.me!.mental, tilt: s.me!.tilt, trust: s.me!.coachTrust })

check('三 托管 answers with the first answer and loses nothing', () => {
  const s = started(fresh())
  const f = fx(s, 'KO:6:总决赛')
  interviewBeforeMatch(s, f)
  const was = snap(s)
  const line = autoResolve(s, pendingIv(s)[0])
  assert.ok(line.includes('赛前采访'))
  const now = snap(s)
  assert.ok(now.fans >= was.fans && now.heat >= was.heat && now.mental >= was.mental && now.tilt <= was.tilt && now.trust >= was.trust, JSON.stringify({ was, now }))
  assert.equal(ivEdge(s, f.id), 0)
  assert.equal(s.me!.iv!.pre!.tone, 'steady')
  // after the match: steady asked nothing back of a claim; 托管 again takes the first
  interviewAfterMatch(s, rec(f, false))
  assert.equal(s.me!.iv!.post!.out, 'out')
  const was2 = snap(s)
  autoResolve(s, pendingIv(s)[0])
  const now2 = snap(s)
  assert.ok(now2.fans >= was2.fans && now2.heat >= was2.heat && now2.mental >= was2.mental && now2.trust >= was2.trust)
  assert.equal(pendingIv(s).length, 0)
})

const results: string[] = []
check('四 狠 + a win is 说到做到; 狠 + a loss is 打脸 with 认错 / 嘴硬 / 甩锅; the MVP is asked about it', () => {
  // won
  const s = started(fresh())
  const f = fx(s, 'KO:3:胜者组决赛')
  interviewBeforeMatch(s, f)
  ivAnswer(s, `pre:${f.id}`, 1)
  assert.equal(ivEdge(s, f.id), IV_BOLD_NODE, '狠 carries onto this match')
  assert.equal(ivEdge(s, 'another'), 0, 'and no other')
  const fans0 = s.me!.fans
  interviewAfterMatch(s, rec(f, true))
  assert.equal(s.me!.iv!.post!.out, 'kept')
  assert.equal(s.me!.fans - fans0, IV_KEPT.fans)
  assert.equal(ivEdge(s, f.id), 0, 'gone once the match is played')
  const kept = ivCard(s, `post:${f.id}`)!
  assert.ok(kept.ctx.some((c) => c.includes('说到做到')), kept.ctx.join(' / '))
  results.push(`说到做到：${kept.q} → ${kept.opts.map((o) => o.t).join(' / ')}`)
  ivAnswer(s, `post:${f.id}`, 1)
  assert.ok(s.me!.iv!.best, 'the line is kept for the career page')
  // lost
  const t = started(fresh())
  const g = fx(t, 'KO:6:总决赛')
  interviewBeforeMatch(t, g)
  ivAnswer(t, `pre:${g.id}`, 1)
  const fans1 = t.me!.fans
  interviewAfterMatch(t, rec(g, false))
  assert.equal(t.me!.iv!.post!.out, 'ate')
  assert.equal(t.me!.fans - fans1, IV_ATE.fans)
  const ate = ivCard(t, `post:${g.id}`)!
  assert.deepEqual(ate.opts.map((o) => o.tag), ['认错', '嘴硬', '甩锅'])
  results.push(`打脸：${ate.q} → ${ate.opts.map((o) => o.t).join(' / ')}`)
  const pal = t.me!.iv!.post!.pal
  ivAnswer(t, `post:${g.id}`, 2)
  assert.ok(pal, 'a named team-mate for 甩锅')
  // a final 说到做到 is the big one
  const u = started(fresh())
  const h = fx(u, 'KO:6:总决赛')
  interviewBeforeMatch(u, h)
  ivAnswer(u, `pre:${h.id}`, 1)
  const fans2 = u.me!.fans
  interviewAfterMatch(u, rec(h, true))
  assert.equal(u.me!.fans - fans2, IV_KEPT_BIG.fans)
  // MVP of a match said steadily
  const v = started(fresh())
  const k = fx(v, 'KO:4:败者组决赛')
  interviewBeforeMatch(v, k)
  ivAnswer(v, `pre:${k.id}`, 0)
  interviewAfterMatch(v, rec(k, true, true))
  assert.equal(v.me!.iv!.post!.out, 'mvp')
  results.push(`MVP：${ivCard(v, `post:${k.id}`)!.q}`)
  // named and then not on the floor: nothing is asked
  const w = started(fresh())
  const m = fx(w, 'KO:6:总决赛')
  interviewBeforeMatch(w, m)
  ivAnswer(w, `pre:${m.id}`, 1)
  const fans3 = w.me!.fans
  interviewAfterMatch(w, rec(m, false, false, false))
  assert.equal(pendingIv(w).length, 0)
  assert.equal(w.me!.fans, fans3)
})

check('五 only 心态, 状态, followers, heat, trust and bonds move; every answer is small', () => {
  const s = started(fresh())
  const f = fx(s, 'KO:6:总决赛')
  interviewBeforeMatch(s, f)
  const card = ivCard(s, `pre:${f.id}`)!
  const allowed = new Set(['fans', 'heat', 'mental', 'tilt', 'form', 'coachTrust'])
  for (const o of card.opts) for (const k of Object.keys(o.e)) assert.ok(allowed.has(k), `pre ${k}`)
  for (const e of [IV_KEPT, IV_KEPT_BIG, IV_ATE]) {
    for (const [k, v] of Object.entries(e)) {
      assert.ok(allowed.has(k), k)
      assert.ok(Math.abs(v as number) <= (k === 'fans' ? 90 : k === 'heat' ? 35 : 6), `${k} ${v}`)
    }
  }
  const money = s.me!.money
  const attrs = { ...s.players[s.me!.id].attrs }
  ivAnswer(s, `pre:${f.id}`, 2)
  assert.equal(s.me!.money, money)
  assert.deepEqual(s.players[s.me!.id].attrs, attrs)
  assert.ok(IV_BANK_SIZE >= 40, `${IV_BANK_SIZE} questions`)
})

let measured = ''
check(`五 狠's edge moves a series by at most two points (${PAIRS} paired BO3s)`, () => {
  const s = started(fresh())
  const comp = compOf(s)
  // an even match, where a few points show if they are there at all: the side whose five against mine (me in it)
  // reads nearest a coin toss at kickoff — a lopsided one sits at the tail, where nothing moves
  const kick = (id: string): number => {
    const c = structuredClone(s)
    const f: Fixture = { id: 'KICK', day: c.day, stage: comp.stage as Fixture['stage'], comp: comp.key, teamA: c.myTeam, teamB: id, bo: 3, label: 'KO:6:总决赛', played: false }
    const mm = new MeMatch(c, f)
    mm.step()
    return mm.rosterProb()
  }
  const cands = Object.values(s.teams).filter((t) => t.id !== s.myTeam && t.tier === 1 && !t.dormant && t.starters.length >= 5)
    .sort((a, b) => a.rating - b.rating)
  let o = cands[0].id
  let best = 1
  for (const t of cands.filter((_, i) => i % Math.max(1, Math.floor(cands.length / 12)) === 0)) {
    const p = kick(t.id)
    if (Math.abs(p - 0.5) < best) { best = Math.abs(p - 0.5); o = t.id }
  }
  const mine = s.teams[s.myTeam].rating
  let wBase = 0, wBold = 0, calls = 0, flips = 0
  for (let i = 0; i < PAIRS; i++) {
    const play = (edge: boolean): boolean => {
      const c = structuredClone(s)
      const f: Fixture = { id: `PAIR${i}`, day: c.day, stage: comp.stage as Fixture['stage'], comp: comp.key, teamA: c.myTeam, teamB: o, bo: 3, label: 'KO:6:总决赛', played: false }
      c.fixtures.push(f)
      if (edge) c.me!.iv = { year: c.year, n: 1, total: 1, seen: [], asked: [], edge: { fx: f.id, node: IV_BOLD_NODE, until: c.day + 3 } }
      const mm = new MeMatch(c, f)
      if (i === 0 && !edge) { mm.step(); console.log(`   对手 ${c.teams[o].name}（${c.teams[o].rating.toFixed(1)}） vs 我方 ${mine.toFixed(1)}，开局两队五人对比的回合胜率 ${(mm.rosterProb() * 100).toFixed(0)}%，我首发 ${mm.playing}`) }
      let guard = 0
      // played by hand, the coach's pick every time: the chair is filled
      while (!mm.done && guard++ < 2000) { if (mm.step() === 'node') { calls++; mm.choose(mm.pending!.coach) } }
      return mm.record!.won
    }
    const a = play(false)
    const b = play(true)
    if (a) wBase++
    if (b) wBold++
    if (a !== b) flips++
  }
  const d = ((wBold - wBase) / PAIRS) * 100
  // the same draws both ways, so only the pairs a call turned apart differ: the noise is theirs (√flips / pairs)
  const se = (Math.sqrt(flips) / PAIRS) * 100
  measured = `狠：系列赛胜率 ${(wBase / PAIRS * 100).toFixed(1)}% → ${(wBold / PAIRS * 100).toFixed(1)}%（${d >= 0 ? '+' : ''}${d.toFixed(1)} 个百分点 ±${se.toFixed(1)}，${PAIRS} 对里 ${flips} 对结果不同，平均每场 ${(calls / PAIRS / 2).toFixed(1)} 个关键回合）`
  console.log(`   ${measured}`)
  // two points is the design's bound; a measurement one standard error above it is still inside it (800 pairs: +1.1 ±0.8)
  assert.ok(d - se <= 2 && d >= -se, measured)
})

check('六 a save round-trip keeps the waiting card and what was said', () => {
  const s = started(fresh())
  const f = fx(s, 'KO:6:总决赛')
  interviewBeforeMatch(s, f)
  ivAnswer(s, `pre:${f.id}`, 1)
  interviewAfterMatch(s, rec(f, false))
  const back = unpackState(packState(s))
  // as JSON: a key left undefined is not written, and that is the save's own way
  assert.deepEqual(back.me!.iv, JSON.parse(JSON.stringify(s.me!.iv)))
  assert.deepEqual(pendingIv(back), pendingIv(s))
  assert.ok(ivCard(back, `post:${f.id}`), 'the card reads back')
  // a save from before: no book at all
  const old = structuredClone(s)
  delete old.me!.iv
  old.me!.pending = []
  assert.equal(ivQuiet(old), true)
  assert.equal(ivEdge(old, f.id), 0)
})

const SITS: IvSituation[] = ['final', 'elim', 'comeback', 'intl_debut', 'vs_former', 'heavy_loss', 'mvp', 'retire', 'rookie', 'rivalry', 'upset', 'champion', 'runner_up', 'any_win', 'any_loss', 'pressure']
check('七 the real lines: at least 50, sourced, dated, tagged, short; found for their own match first', () => {
  assert.ok(IV_MOMENTS.length >= 50, `${IV_MOMENTS.length} lines`)
  const byYear = new Set(IV_MOMENTS.map((m) => m.year))
  for (const y of [2021, 2022, 2023, 2024, 2025, 2026]) assert.ok(byYear.has(y), `no line from ${y}`)
  const ids = new Set<string>()
  for (const m of IV_MOMENTS) {
    assert.ok(!ids.has(m.id), m.id); ids.add(m.id)
    assert.match(m.date, /^20\d\d-\d\d-\d\d$/, m.id)
    assert.equal(Number(m.date.slice(0, 4)), m.year, m.id)
    assert.ok(m.source.length && m.source.every((u) => /^https:\/\/[^\s]+$/.test(u)), `${m.id} source`)
    const words = m.quote.trim().split(/\s+/).length
    const cjk = (m.quote.match(/[一-鿿]/g) ?? []).length
    assert.ok(cjk ? cjk <= 20 : words <= 15, `${m.id} quote too long`)
    assert.ok((m.cn.match(/[一-鿿]/g) ?? []).length <= 20, `${m.id} cn too long`)
    assert.ok(['steady', 'bold', 'att'].includes(m.tone) && ['pre', 'post'].includes(m.when), m.id)
    // a match's two sides, or none for a line said away from one (a retirement, a press day)
    assert.ok(m.teams.length === 2 || m.teams.length === 0, m.id)
    if (m.teams.length) assert.ok(m.teams.includes(m.team), m.id)
    assert.ok(m.tags?.length && m.tags.every((t) => SITS.includes(t)), `${m.id} tags`)
  }
  // every kind of moment the cards ask for has lines
  for (const t of SITS) assert.ok(IV_MOMENTS.some((m) => m.tags.includes(t)), `no line tagged ${t}`)
  // the world reaches Toronto's final with the same two sides: f0rsakeN's line is on the card
  const s = createCareer({ name: '采访', region: 'Pacific', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 3, year: 2025 })
  const tag = (t: string) => Object.values(s.teams).find((x) => x.tag === t)!.id
  const comp = intlComp(s)
  const f: Fixture = { id: 'TOR', day: s.day, stage: 'masters2', comp: comp.key, teamA: tag('PRX'), teamB: tag('FNC'), bo: 5, label: 'KO:6:总决赛', played: false }
  assert.equal(momentFor(s, f, 'pre')?.id, 'toronto25_f0rsaken')
  assert.equal(momentFor(s, { ...f, label: 'KO:1:胜者组第一轮' }, 'pre'), undefined)
  // and on the card it is that line, as this very match — not a 类似的时刻, even with those still unseen
  const me = s.me!
  me.phase = 'pro'
  s.myTeam = tag('PRX')
  s.players[me.id].teamId = s.myTeam
  const t = s.teams[s.myTeam]
  t.roster = [...new Set([me.id, ...t.roster])]
  t.starters = [me.id, ...t.starters.filter((id) => id !== me.id).slice(0, 4)]
  me.seasonStart.starts = 3
  me.flags.ivDebut = s.year
  me.flags.ivIntl = s.year
  me.pending = []
  s.fixtures.push(f)
  assert.ok(interviewBeforeMatch(s, f))
  assert.equal(me.iv!.pre!.moment, 'toronto25_f0rsaken')
  assert.equal(me.iv!.pre!.like, undefined)
  const card = ivCard(s, 'pre:TOR')!
  assert.ok(card.moment!.includes('就是这一场') && !card.moment!.includes('类似的时刻'), card.moment)
  // a lower-bracket final with no line of its own: one said at a moment like it, as 类似的时刻
  ivAnswer(s, 'pre:TOR', 0)
  me.pending = []
  const g: Fixture = { ...f, id: 'TOR2', label: 'KO:4:败者组决赛' }
  s.fixtures.push(g)
  assert.ok(interviewBeforeMatch(s, g))
  assert.equal(me.iv!.pre!.like, 1)
  assert.ok(ivCard(s, 'pre:TOR2')!.moment!.includes('类似的时刻'))
  s.year = 2024
  assert.equal(momentFor(s, f, 'pre'), undefined, 'another year is another event')
})

check('七b 类似的时刻: never twice in a career until the kind of moment has run out of lines', () => {
  for (const sits of [['final'], ['elim', 'pressure'], ['vs_former', 'rivalry'], ['retire'], ['mvp']] as IvSituation[][]) {
    const s = started(fresh())
    const pool = IV_MOMENTS.filter((m) => m.tags.some((t) => sits.includes(t))).map((m) => m.id)
    const got: string[] = []
    for (let i = 0; i < pool.length; i++) got.push(likeMoment(s, sits, i % 2 ? 'pre' : 'post', `c${i}`)!.id)
    assert.equal(new Set(got).size, pool.length, `${sits.join('+')}: ${pool.length} lines, a repeat before all were shown`)
    assert.deepEqual([...got].sort(), [...pool].sort())
    // run out, it starts again from the one shown longest ago
    assert.equal(likeMoment(s, sits, 'pre', 'again')!.id, got[0])
    // and survives a save
    const back = unpackState(packState(s))
    assert.deepEqual(back.me!.iv!.real, s.me!.iv!.real)
  }
})

check(`八 a ${SEASONS}-season 托管 career: at most ${IV_CAP} a season, every one on a start`, () => {
  // a Challengers starter (a 强队替补 start sits, and the bench is never asked): check_ceremony's career
  const s = createCareer({ name: '采访', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7 })
  const me = s.me!
  const y0 = s.year
  let generic = 0
  let lastLen = 0
  let guard = 0
  // every card as it comes up, read before 托管 answers it: the week run by hand, the way me/auto.ts autoWeek runs it
  const cards: { year: number; pre: boolean; key: string; fx: string; real: string }[] = []
  const clear = () => {
    let g = 0
    while (me.pending.length && g++ < 30) {
      const it = me.pending[0]
      if (it.kind === 'interview') {
        const c = ivCard(s, it.id!)
        if (c) cards.push({ year: s.year, pre: c.pre, key: c.pre ? me.iv!.pre!.q : `${me.iv!.post!.out}:${me.iv!.post!.ask}`, fx: it.id!.slice(it.id!.indexOf(':') + 1), real: c.moment ?? '' })
      }
      autoResolve(s, it)
    }
  }
  while (s.year - y0 < SEASONS && guard++ < 60 * SEASONS) {
    clear()
    if (me.phase === 'retired' || s.gameOver) break
    autoPlan(s)
    let stop = advanceWeek(s)
    let g = 0
    while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && g++ < 40) {
      if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
      else clear()
      stop = advanceWeek(s)
    }
    generic += me.log.slice(lastLen).filter((l) => l.text.startsWith('赛后采访，记者问你')).length
    lastLen = me.log.length
    if (stop.kind === 'game-over') break
  }
  clear()
  const pres = cards.filter((c) => c.pre)
  const posts = cards.filter((c) => !c.pre)
  const per = new Map<number, number>()
  for (const c of pres) per.set(c.year, (per.get(c.year) ?? 0) + 1)
  const counts = [...per.entries()].sort((a, b) => a[0] - b[0])
  const repeats = (xs: typeof cards, bySeason: boolean) => xs.length - new Set(xs.map((c) => `${bySeason ? c.year : ''}:${c.key}`)).size
  const reals = cards.filter((c) => c.real).map((c) => c.real)
  console.log(`   每季采访：${counts.map(([y, n]) => `${y} ${n}`).join(' · ') || '无'}；共 ${pres.length} 场；通用赛后采访 ${generic} 次`)
  console.log(`   赛前问题 ${pres.length} 次、不同 ${new Set(pres.map((c) => c.key)).size} 个（同季重复 ${repeats(pres, true)}，生涯重复 ${repeats(pres, false)}）；赛后问题 ${posts.length} 次、不同 ${new Set(posts.map((c) => c.key)).size} 个（同季重复 ${repeats(posts, true)}，生涯重复 ${repeats(posts, false)}）；真实的话 ${reals.length} 次、不同 ${new Set(reals).size} 句`)
  assert.ok(pres.length > 0, 'no interview in a whole career')
  for (const [, n] of counts) assert.ok(n <= IV_CAP, `${n} in a season`)
  assert.equal(repeats(pres, true), 0, 'a pre-match question twice in one season')
  assert.equal(repeats(posts, true), 0, 'a post-match question twice in one season')
  assert.equal(repeats(pres, false), 0, 'a pre-match question twice in one career while others were left')
  // every interviewed match that was played: I started it
  for (const c of pres) {
    const m = me.matches.find((x) => x.fixtureId === c.fx)
    if (m) assert.ok(m.started, `interviewed for ${c.fx} and did not start`)
  }
  assert.equal(pendingIv(s).length, 0, 'nothing left waiting')
})

console.log('\n' + results.map((r) => `  ${r}`).join('\n'))
console.log(`PASS ${checks} interview checks · ${measured} · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
