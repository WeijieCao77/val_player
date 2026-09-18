/**
 * 「我改写了历史」: the season's ledger of what this world came out otherwise than history (engine/me/worldline.ts),
 * and the title card's one line of it (ui/me/MomentQueue.tsx) — the author's brief of 2026-09-18, phase A.
 *
 * 一 careers, played by 托管 — 2021 North America at Sentinels, 2021 Europe over two seasons — the ledger read every
 *    week: every entry is an event this world played, never one replayed as it really went and never one nobody has
 *    played yet; its real champion is the one realPlacesOf quotes and its champion this world's; my club's placings
 *    are the event's own, here and in history; each place it says went elsewhere is one the later event's draw
 *    really gave elsewhere; it is heaviest first; its words never say 「因为」 and never set a side against itself.
 *    Reading it writes nothing: the world serialises byte for byte the same before and after.
 * 二 the title card: its line names the real champion exactly when that was not the club that won it here — and
 *    says the same once the year has turned and the event is gone from the season (MomentItem.teamId)
 * 三 built cases on a 2021 world: a Masters won by another side, and by the real one; a club here that bears the real
 *    champion's name; the real champion renamed since, and a club named by history's table (TSM, TSM FTX from
 *    4 June 2021); the real champion dissolved; a place passed down past a dissolved club (circuit.ts nextFinisher);
 *    an event replayed as it went, and one nobody has played, never in the ledger
 * 四 a 2026 start: its ledger holds only 2026's real events, and from 2027 — every event projected — it is empty
 *
 *   npx tsx scripts/check_worldline.ts
 */
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

import { createCareer, emptyTalents, startPool } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { clubNameAt, historyLedger, placeMoved, rewriteLines, rewriteOf, titleRealChamp } from '../src/engine/me/worldline'
import type { Rewrite } from '../src/engine/me/worldline'
import { isIntlComp } from '../src/engine/me/compclass'
import { eventOf, eventsOf, progressCircuit, realPlacesOf, realSideOf, worldIdOf } from '../src/engine/circuit'
import type { MomentItem } from '../src/engine/me/types'
import type { Competition, GameState } from '../src/engine/types'

let bad = 0
const check = (ok: boolean, what: string) => {
  if (!ok) { bad++; console.log(`  ✗ ${what}`) }
  return ok
}
const pass = (what: string) => console.log(`  ✓ ${what}`)

const placeOf = (comp: Competition, id: string): number | null => {
  const at = comp.finished.indexOf(id)
  return at < 0 ? null : comp.places?.[at] ?? at + 1
}
const nm = (s: GameState, id: string | null | undefined) => (id ? s.teams[id]?.name ?? id : '（空）')

/** One entry against the event itself. */
function verify(state: GameState, e: Rewrite, where: string): void {
  const comp = state.comps[e.key]
  const c = comp?.circuit
  const ev = c && eventOf(c.id)
  if (!check(!!comp && !!ev && c!.mode === 'sim' && !ev!.projected && !ev!.plan,
    `${where} ${e.name}：账本里只能有这个世界打过、真实历史有结果的赛事（mode ${c?.mode}，${ev?.projected ? '还没有发生' : '真实赛事'}）`)) return
  check(comp.champion === e.champ.id, `${where} ${e.name}：这个世界的冠军应是 ${nm(state, comp.champion)}，账本写 ${e.champ.name}`)
  const rp = realPlacesOf(comp)
  const first = rp.find((r) => r.place === 1)?.name
  check(e.real?.name === first, `${where} ${e.name}：真实冠军应是 ${first}（realPlacesOf），账本写 ${e.real?.name}`)
  if (e.real?.id) check(e.real.place === placeOf(comp, e.real.id), `${where} ${e.name}：${e.real.name} 在这个世界的名次对不上`)
  if (e.champChanged) {
    check(!!e.real && e.real.name !== e.champ.name, `${where} ${e.name}：冠军换了人，两边却是同一个名字 ${e.champ.name}`)
    check(e.real?.id !== comp.champion && worldIdOf(e.real!.vlr) !== comp.champion && realSideOf(state, ev!, e.real!.vlr) !== comp.champion,
      `${where} ${e.name}：真实冠军 ${e.real?.name} 就是这个世界的冠军 ${e.champ.name}，不该算改写`)
  } else {
    check(e.seats.length > 0 || (!!e.mine && placeMoved(e.mine)), `${where} ${e.name}：冠军没换人、名额也没变的条目，只能是我的俱乐部名次变了`)
  }
  if (e.kind === 'intl') check(isIntlComp(e.name) && e.champChanged, `${where} ${e.name}：国际赛冠军一档只给大师赛 / 冠军赛换了冠军的`)
  const m = e.mine
  if (m) {
    check(m.place === placeOf(comp, m.id), `${where} ${e.name}：${m.name} 这个世界第 ${placeOf(comp, m.id)}，账本写 ${m.place}`)
    if (m.realPlace != null && m.realPlace <= 8) check(rp.some((r) => r.place === m.realPlace), `${where} ${e.name}：${m.name} 真实第 ${m.realPlace}，realPlacesOf 没有这个名次`)
    if (m.realPlace != null) check(ev!.places.some(([, p]) => p === m.realPlace), `${where} ${e.name}：真实名次表里没有第 ${m.realPlace}`)
    if (m.realPlace == null) check(!ev!.places.some(([v]) => worldIdOf(v) === m.id || realSideOf(state, ev!, v) === m.id),
      `${where} ${e.name}：说 ${m.name} 真实历史里没打进这一站，名次表里却有它`)
  }
  for (const s of e.seats) {
    const t = state.comps[s.key]
    check(!!t?.circuit?.swaps?.some((x) => x.from === e.key) && (s.now == null || t.circuit.seeds.includes(s.now)),
      `${where} ${e.name}：说 ${t?.name ?? s.key} 的名额给了 ${s.nowName}，那项赛事的抽签里没有这回事`)
    check(s.real !== s.nowName, `${where} ${e.name}：名额两边是同一个名字 ${s.real}`)
  }
  for (const l of rewriteLines(e)) {
    check(!/因为/.test(l), `${where}：「${l}」——只说真实历史和这个世界各是什么，不说因为`)
    const two = /真实历史里(?:的冠军)?是 (.+?)；这个世界里是 (.+?)(?:，|。)/.exec(l)
    check(!two || two[1] !== two[2], `${where}：「${l}」——一句话里两边是同一个名字`)
  }
}

interface Card { m: MomentItem; line: string | null; comp: string }

/** The title card's line, against the event: present exactly when the real champion was not the club that won it. */
function verifyTitle(state: GameState, m: MomentItem, where: string): Card | null {
  const line = titleRealChamp(state, m)
  const comp = Object.values(state.comps).find((c) => c.name === m.comp && c.champion === m.teamId && !!c.circuit)
  if (!check(!!m.teamId, `${where} ${m.comp}：冠军卡上要记着是哪家俱乐部拿的`)) return null
  if (!comp) return { m, line, comp: '' }
  const ev = eventOf(comp.circuit!.id)!
  const firstVlr = ev.projected ? undefined : ev.places.find(([, p]) => p === 1)?.[0]
  if (!firstVlr || comp.circuit!.mode !== 'sim') {
    check(line == null, `${where} ${m.comp}：没有真实结果可比，卡上不该有这一行（写了「${line}」）`)
    return { m, line, comp: comp.key }
  }
  const realName = realPlacesOf(comp).find((r) => r.place === 1)?.name
  const ours = worldIdOf(firstVlr) === m.teamId || state.heirs?.[worldIdOf(firstVlr) ?? ''] === m.teamId
    || realSideOf(state, ev, firstVlr) === m.teamId || realName === state.teams[m.teamId!]?.name
  if (line != null) check(line === realName && !ours, `${where} ${m.comp}：卡上写「真实历史里，这座奖杯属于 ${line}」，真实冠军是 ${realName}${ours ? '，就是我们' : ''}`)
  else check(ours || (ev.rosters?.[firstVlr] ?? []).filter((p) => (state.players[`V${p}`]?.titles ?? []).some((t) => t.year === m.year && t.title === m.comp)).length >= 3,
    `${where} ${m.comp}：真实冠军 ${realName} 不是我们（${nm(state, m.teamId)}），卡上却没有这一行`)
  return { m, line, comp: comp.key }
}

// ---------------------------------------------------------------- 一、二 careers
function career(label: string, o: Partial<CareerOpts>, seasons: number): Map<string, Rewrite> {
  const t0 = Date.now()
  const state = createCareer({ name: 'Worldline', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2021, ...o } as CareerOpts)
  const me = state.me!
  const seen = new Map<string, Rewrite>()
  const cards: Card[] = []
  let writes = 0
  let reads = 0
  let order = true
  const until = state.year + seasons
  let weeks = 0
  while (me.phase !== 'retired' && state.year < until && weeks++ < 70 * seasons) {
    const before = JSON.stringify(state)
    const led = historyLedger(state)
    for (const m of me.moments ?? []) if (m.kind === 'title' && m.year === state.year) titleRealChamp(state, m)
    for (const e of led) rewriteLines(e)
    if (JSON.stringify(state) !== before) writes++
    reads++
    for (let i = 1; i < led.length; i++) if (led[i - 1].weight < led[i].weight) order = false
    for (const e of led) { verify(state, e, `${label} ${state.year}`); seen.set(`${state.year}:${e.key}`, e) }
    // the cards, as the full-screen card takes them: the line is read the week it comes, and again once the year is gone
    for (const m of me.moments ?? []) if (m.kind === 'title') { const c = verifyTitle(state, m, label); if (c) cards.push(c) }
    me.moments = []
    const y = state.year
    if (autoWeek(state).kind === 'game-over') break
    if (state.year !== y) {
      for (const c of cards.filter((x) => x.m.year === y && x.comp)) {
        const later = titleRealChamp(state, c.m)
        check(later === c.line, `${label}：${c.m.comp} 的冠军卡，跨年以后再读应该一样（当年「${c.line}」，跨年「${later}」）`)
      }
    }
  }
  check(writes === 0, `${label}：读账本 ${reads} 次，有 ${writes} 次改了世界`)
  check(order, `${label}：账本按分量排，国际赛冠军在前`)
  const all = [...seen.values()]
  const kinds = (k: Rewrite['kind']) => all.filter((e) => e.kind === k).length
  console.log(`${label}：${seasons} 季 ${((Date.now() - t0) / 1000).toFixed(1)}s · 账本 ${all.length} 条（国际赛冠军 ${kinds('intl')}、名额 ${kinds('qual')}、赛区冠军 ${kinds('region')}、只有名次 ${kinds('place')}）`
    + ` · 冠军卡 ${cards.length} 张，${cards.filter((c) => c.line).length} 张有「真实历史里，这座奖杯属于」`)
  for (const c of cards) console.log(`    冠军卡 ${c.m.year} ${c.m.comp}${c.m.bench ? '（替补）' : ''}：${c.line ? `真实历史里，这座奖杯属于 ${c.line}` : '（没有这一行）'}`)
  for (const e of all.sort((a, b) => a.year - b.year || b.weight - a.weight || a.end - b.end).slice(0, 14)) console.log(`    ${e.year} ${rewriteLines(e).join(' ')}`)
  check(reads > 20 && all.length > 0, `${label}：账本真的读到了东西（${all.length} 条）`)
  if (!bad) pass(`${label}：每一条都对得上真实名次和这个世界的结果，只读不写`)
  return seen
}

const A = career('一 2021 北美 · Sentinels', { region: 'North America', teamId: 'V21T2', seed: 1 }, 1)
const B = career('一 2021 欧洲 · 强队替补', { region: 'Europe', seed: 1 }, 2)
check([...A.values(), ...B.values()].some((e) => e.kind === 'intl'), '两局里至少有一项国际赛换了冠军（否则这一步什么也没验）')
check([...A.values(), ...B.values()].some((e) => !!e.mine?.there), '两局里至少有一条写了我在不在场（否则这一步什么也没验）')

// ---------------------------------------------------------------- 三 built cases
console.log('\n三 造出来的情形（2021 年的世界）')
const REYKJAVIK = '353'
const PLAYOFFS = '376' // EMEA Stage 2 Challengers Playoffs: Reykjavík's EMEA places, its first and second
const NA_CH1 = '291' // North America Stage 1 Challengers 1, 26 January – 6 February: Sentinels
const [SEN, FNATIC, LIQUID, GAMBIT, OXYGEN, FPX, GUILD, BBL, FUT, TSM, NUTURN] = ['2', '2593', '474', '682', '921', '628', '1209', '397', '1184', '106', '2328'].map((v) => worldIdOf(v)!)

function built(): { state: GameState; club: string } {
  const busy = new Set([...eventOf(REYKJAVIK)!.seeds, ...eventOf(PLAYOFFS)!.seeds].map((v) => worldIdOf(v)))
  const club = startPool('Europe', 't1', 2021).find((c) => !busy.has(c.id))!.id
  const state = createCareer({ name: 'Built', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2021, seed: 3, teamId: club } as CareerOpts)
  return { state, club: state.myTeam }
}

/** An event as this world played it: `order`, first to last. */
function playedHere(comp: Competition, order: string[]): void {
  comp.circuit!.mode = 'sim'
  comp.circuit!.why = 'home'
  comp.teams = [...order]
  comp.finished = [...order]
  comp.places = order.map((_, i) => i + 1)
  comp.champion = order[0]
}

const lines = (e: Rewrite | null) => (e ? rewriteLines(e) : [])
const say = (what: string, e: Rewrite | null) => console.log(`  · ${what}：${lines(e).join(' ') || '（不在账本里）'}`)

{
  const { state, club } = built()
  const mk = state.comps[`ev:${REYKJAVIK}`]
  const rest = [NUTURN, LIQUID].filter((t) => state.teams[t])
  // 1 another side lifts it, my club, which history never had there, third; the real champion second
  playedHere(mk, [FNATIC, SEN, club, ...rest])
  const before = JSON.stringify(state)
  let e = rewriteOf(state, mk)
  check(JSON.stringify(state) === before, '造出来的世界：读账本不改世界')
  say('雷克雅未克 FNATIC 夺冠', e)
  check(e?.kind === 'intl' && e.champChanged && e.real?.name === 'Sentinels' && e.real.place === 2 && e.champ.id === FNATIC,
    '另一支队夺冠：国际赛冠军一档，真实冠军 Sentinels（这次第 2 名），这个世界 FNATIC')
  check(e?.mine?.id === club && e.mine.realPlace == null && e.mine.place === 3 && e.mine.there == null
    && lines(e).some((l) => l.includes(`真实历史里 ${nm(state, club)} 没打进这一站；这个世界里第 3 名`)) && !lines(e).some((l) => l.includes('你首发') || l.includes('你在名单上')),
    `我的俱乐部真实历史里没打进：「真实历史里 ${nm(state, club)} 没打进这一站」，我没打过这项赛事的比赛，就不说我在场`)
  const card: MomentItem = { kind: 'title', key: 't', year: 2021, day: mk.circuit!.end, comp: mk.name, teamId: FNATIC }
  check(titleRealChamp(state, card) === 'Sentinels', `冠军卡：「真实历史里，这座奖杯属于 Sentinels」（${titleRealChamp(state, card)}）`)

  // 2 the real champion lifts it: nothing about the title
  playedHere(mk, [SEN, FNATIC, club, ...rest])
  e = rewriteOf(state, mk)
  check(!!e && !e.champChanged && !lines(e).some((l) => l.includes('冠军是')), '真实冠军照样夺冠：不说冠军换了人（只剩我的俱乐部的名次）')
  check(titleRealChamp(state, { ...card, teamId: SEN }) == null, '冠军卡：奖杯本来就是这支队的，没有这一行')

  // 3 a club here that bears the real champion's name: never 「Sentinels 的冠军成了 Sentinels 的」
  playedHere(mk, [FNATIC, club, SEN, ...rest])
  const fnaticName = state.teams[FNATIC].name
  state.teams[FNATIC].name = 'Sentinels'
  e = rewriteOf(state, mk)
  say('夺冠的俱乐部现在也叫 Sentinels', e)
  check(!e?.champChanged && !lines(e).some((l) => /Sentinels.*Sentinels/.test(l)), '和真实冠军同名的俱乐部夺冠：不写「Sentinels……Sentinels」')
  check(titleRealChamp(state, card) == null, '冠军卡：同名的不写这一行')
  state.teams[FNATIC].name = fnaticName

  // 4 the real champion renamed since: it is still the same club, and history is quoted by the name of the day
  state.teams[SEN].name = 'Sentinels Academy'
  playedHere(mk, [SEN, FNATIC, club, ...rest])
  e = rewriteOf(state, mk)
  check(!e?.champChanged, '真实冠军后来改了名、这个世界照样夺冠：同一家俱乐部，不算改写')
  playedHere(mk, [FNATIC, SEN, club, ...rest])
  e = rewriteOf(state, mk)
  say('Sentinels 后来改了名，FNATIC 夺冠', e)
  check(!!e && lines(e).some((l) => l.includes(`真实历史里的冠军是 Sentinels；这个世界里是 ${nm(state, FNATIC)}，Sentinels 第 2 名`)), '真实冠军按那一站的名字写（Sentinels），不写后来的名字')
  state.teams[SEN].name = 'Sentinels'

  // 5 a club named by history's table: TSM won 2021's first North American Challengers here in February, and is TSM FTX since June
  const ch1 = state.comps[`ev:${NA_CH1}`]
  playedHere(ch1, [TSM, SEN])
  const day = state.day
  state.day = 200
  state.teams[TSM].name = 'TSM FTX'
  e = rewriteOf(state, ch1)
  say('2 月的挑战者赛 TSM 夺冠，7 月读', e)
  check(clubNameAt(state, TSM, 2021, ch1.circuit!.end) === 'TSM' && e?.champ.name === 'TSM' && !lines(e).some((l) => l.includes('TSM FTX')),
    '按那一站的名字写这个世界的冠军：2 月是 TSM，6 月 4 日以后才叫 TSM FTX')
  state.day = day

  // 6 the real champion dissolved: it played nothing here
  playedHere(mk, [FNATIC, club, ...rest])
  state.teams[SEN].dormant = true
  e = rewriteOf(state, mk)
  say('Sentinels 在这个世界里已经解散', e)
  check(!!e && lines(e).some((l) => l.includes(`真实历史里的冠军是 Sentinels；这个世界里是 ${nm(state, FNATIC)}，Sentinels 在这个世界里已经解散`)), '真实冠军已经解散：说它解散了，不给它编名次')
  state.teams[SEN].dormant = false

  // 7 replayed as it really went, and nobody has played it yet: never in the ledger
  mk.circuit!.mode = 'history'
  check(rewriteOf(state, mk) == null && !historyLedger(state).some((x) => x.key === mk.key), '照真实历史走的赛事不进账本，哪怕结果被改过')
  mk.circuit!.mode = 'sim'
  const ahead = eventsOf(2027)[0]
  const fake: Competition = { key: `ev:${ahead.id}`, name: ahead.cn, stage: 'champions', teams: [FNATIC, SEN], standings: {}, finished: [FNATIC, SEN], places: [1, 2], champion: FNATIC,
    format: 'circuit', circuit: { id: ahead.id, start: ahead.start ?? 0, end: ahead.end ?? 0, seeds: [], mode: 'sim', why: 'ahead' } }
  state.comps[fake.key] = fake
  check(rewriteOf(state, fake) == null && !historyLedger(state).some((x) => x.key === fake.key), `还没有发生的赛事（${ahead.cn}）不进账本`)
  check(titleRealChamp(state, { kind: 'title', key: 'f', year: state.year, day: 0, comp: fake.name, teamId: FNATIC }) == null, '还没有发生的赛事：冠军卡没有这一行')
  delete state.comps[fake.key]

  // 8 the card after the year has turned: the event is gone from the season, its real result is not
  const saved = state.comps
  state.comps = {}
  state.year = 2022
  check(titleRealChamp(state, card) === 'Sentinels' && titleRealChamp(state, { ...card, teamId: SEN }) == null,
    '跨年以后才弹的冠军卡：照样按真实冠军写这一行，本来就是我们的照样不写')
  check(titleRealChamp(state, { ...card, teamId: undefined }) == null, '跨年以后、卡上没记俱乐部的老卡：说不准就不写')
  state.year = 2021
  state.comps = saved
}

{
  // 9 a place passed down: the Playoffs played here, their second let go by Reykjavík's draw (scripts/check_gone_seat.ts)
  const { state } = built()
  const po = state.comps[`ev:${PLAYOFFS}`]
  const mk = state.comps[`ev:${REYKJAVIK}`]
  playedHere(po, [FPX, GAMBIT, OXYGEN, LIQUID, FNATIC, GUILD, BBL, FUT])
  state.teams[GAMBIT].dormant = true
  state.day = eventOf(REYKJAVIK)!.start! - 1
  progressCircuit(state, mk, [])
  const e = rewriteOf(state, po)
  say('EMEA 挑战者季后赛第二名 Gambit 抽签前解散', e)
  const seats = e?.seats.filter((s) => s.key === mk.key) ?? []
  check(seats.length === 2 && seats.some((s) => s.real === 'Team Liquid' && s.now === FPX) && seats.some((s) => s.real === 'FNATIC' && s.now === OXYGEN),
    `名额顺延：雷克雅未克的两个 EMEA 名额，真实历史里是 Team Liquid、FNATIC，这个世界是 ${seats.map((s) => s.nowName).join('、')}（第二名 Gambit 解散，给了下一名 Oxygen）`)
  check(e?.kind === 'qual' && !seats.some((s) => s.now === GAMBIT) && !lines(e).some((l) => /这个世界里是 Gambit/.test(l)), '解散的 Gambit 不会被写成拿了名额')
  check(lines(e).filter((l) => l.includes('给雷克雅未克大师赛的名额')).length === 1, '冠军那一行已经说了的名额（Team Liquid 的给了 FunPlus Phoenix）不再重复一行')
  check(lines(e).some((l) => l.includes('真实历史里是 FNATIC；这个世界里是 Oxygen Esports；Gambit Esports 在这个世界里已经解散，名额往下顺延')),
    '名额越过了解散的 Gambit：说它解散了、名额往下顺延，一项赛事只说一次')
}

// ---------------------------------------------------------------- 四 a 2026 start
{
  const t0 = Date.now()
  const state = createCareer({ name: 'Ahead', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2026, seed: 11 } as CareerOpts)
  const me = state.me!
  check(historyLedger(state).length === 0, '2026 开局第一天：账本是空的')
  const seen = new Map<string, Rewrite>()
  let after = 0
  let weeks = 0
  let checked2027 = 0
  while (me.phase !== 'retired' && state.year <= 2027 && weeks++ < 64) {
    const led = historyLedger(state)
    for (const e of led) { verify(state, e, `四 ${state.year}`); seen.set(e.key, e) }
    if (state.year >= 2027) { checked2027++; after += led.length }
    me.moments = []
    if (autoWeek(state).kind === 'game-over') break
  }
  const projected = [...seen.values()].filter((e) => eventOf(e.event)?.projected)
  console.log(`\n四 2026 开局（中国 · 一线替补）：${((Date.now() - t0) / 1000).toFixed(1)}s · 2026 年账本 ${seen.size} 条，都是 2026 年真实打过的赛事：${[...seen.values()].map((e) => e.name).join('、') || '无'}`)
  check(projected.length === 0, `账本里没有还没发生的赛事（${projected.map((e) => e.name).join('、')}）`)
  check(checked2027 > 0 && after === 0, `2027 年（全部是还没发生的赛事）账本一直是空的（读了 ${checked2027} 周，${after} 条）`)
}

if (bad) {
  console.log(`\n✗ 世界线账本有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 世界线账本只记这个世界打过、结果和真实历史不一样的赛事，逐条对得上真实名次；只读不写；改名、解散、名额顺延都按那一站的样子写；冠军卡的那一行只在奖杯本来不属于我们时出现。')
