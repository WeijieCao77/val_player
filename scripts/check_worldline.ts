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
 * 五 phase B, the season's row (engine/me/worldline.ts seasonLedger, me/rewrites.ts): at every turn of the year in 一's
 *    careers, a copy of the world taken the week before is played up to the moment before the winter
 *    (engine/season.ts beforeSeasonEnd) and the row must hold exactly the ledger read there — at most KEEP, the card's
 *    SHOWN the heaviest, the count of trophies that changed hands the ledger's own; each 你首发 / 你在名单上 against my
 *    own match records, my club's placing only where I was there, a title called ours against the fixture's sides, and
 *    「因为你」 exactly where the title went to my club and I started. Then the careers are hung up: the hall's card counts
 *    what the rows kept, round-trips, and gives the new-career line; the share card's strip is one I started in or my
 *    club's title. A save from before keeps nothing and says nothing — never 「暂无」.
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

import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents, startPool } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { KEEP, SHOWN, clubNameAt, historyLedger, keptOf, placeMoved, rewriteLines, rewriteOf, seasonLedger, titleRealChamp } from '../src/engine/me/worldline'
import type { Rewrite, SeasonLedger } from '../src/engine/me/worldline'
import { REWRITE_WEIGHT, becauseOfMe, careerLine, careerRewrites, keptOrder, partLine, retitledLine, shareLine } from '../src/engine/me/rewrites'
import { cleanHall, careerIdOf, lastCareerLine, lastRewriteLine, noteHall, readHall } from '../src/engine/me/hall'
import { retire } from '../src/engine/me/endings'
import { isIntlComp, isQualifier } from '../src/engine/me/compclass'
import { eventOf, eventsOf, progressCircuit, realPlacesOf, realSideOf, worldIdOf } from '../src/engine/circuit'
import { SEASON_DAYS, advanceDay } from '../src/engine/season'
import type { MeSeason, MomentItem } from '../src/engine/me/types'
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

// ---------------------------------------------------------------- 五 the season's row (phase B)
const J = (x: unknown) => JSON.stringify(x)
const tellable = (e: Rewrite) => e.kind !== 'place' || !!e.mine?.there

/**
 * The season's ledger as its row must keep it, read off a copy of the world taken before the week the year turned
 * in and played up to the moment before the winter (engine/season.ts beforeSeasonEnd) — then checked against that
 * world: the cap, the card's three being the heaviest, the title count, my part in each against my own match records,
 * a title called ours against the fixture's sides, and 「因为你」 exactly under its rule.
 */
function atTheTurn(c: GameState, y: number, where: string): SeasonLedger | null {
  let kept: SeasonLedger | null = null
  let guard = 0
  while (c.year === y && guard++ < 30) {
    const pro = c.me!.phase === 'pro'
    advanceDay(c, {
      deferMine: pro, holdMine: pro, autoScrims: true, autoResolveDrawDecisions: true,
      beforeSeasonEnd: (s) => {
        check(s.day >= SEASON_DAYS && s.year === y, `${where}：只在赛季最后一天、冬歇之前读（${s.year} 第 ${s.day} 天）`)
        const k = seasonLedger(s)
        kept = k
        const full = historyLedger(s)
        const told = full.filter(tellable)
        check(k.rewrites.length <= KEEP && k.rewrites.length === Math.min(KEEP, told.length),
          `${where}：一季最多存 ${KEEP} 条，能说的有 ${told.length} 条，存了 ${k.rewrites.length} 条`)
        check(k.retitled === full.filter((e) => e.champChanged && !isQualifier(e.name)).length,
          `${where}：换了主人的奖杯 ${k.retitled} 座，账本里是 ${full.filter((e) => e.champChanged && !isQualifier(e.name)).length} 座`)
        const pairs = k.rewrites.map((r) => ({ r, e: full.find((x) => J(keptOf(x)) === J(r)) }))
        check(pairs.every((p) => !!p.e), `${where}：存下的每一条都是那一刻账本里的一条`)
        const shown = Math.min(...k.rewrites.slice(0, SHOWN).map((r) => REWRITE_WEIGHT[r.kind]))
        const left = told.filter((e) => !pairs.some((p) => p.e === e))
        check(left.every((e) => e.weight <= shown), `${where}：赛季卡的三条是最重的（没存下的 ${left.filter((e) => e.weight > shown).map((e) => e.name).join('、')} 更重）`)
        const recs = s.me!.matches.filter((m) => m.year === y && !m.friendly)
        for (const { r, e } of pairs) {
          if (!e) continue
          const mine = recs.filter((m) => m.comp === e.name)
          if (r.there) check(mine.length > 0 && (r.there === 'started') === mine.some((m) => m.started),
            `${where} ${e.name}：写「${r.there === 'started' ? '你首发' : '你在名单上'}」，我自己的比赛记录是 ${mine.length} 场、首发 ${mine.filter((m) => m.started).length} 场`)
          else check(!r.lines.some((l) => l.startsWith('真实历史里 ')), `${where} ${e.name}：我不在名单上，就不写我的俱乐部的名次（${r.lines.join(' / ')}）`)
          if (r.ours) {
            // on the champion's side of one of its fixtures: the opponent I wrote down is the other side
            const onIt = mine.some((m) => {
              const f = s.fixtures.find((x) => x.id === m.fixtureId)
              const other = f?.teamA === e.champ.id ? f.teamB : f?.teamB === e.champ.id ? f.teamA : null
              return !!other && (s.teams[other]?.name === m.opp || s.teams[other]?.tag === m.oppTag)
            })
            check(!!r.title && onIt, `${where} ${e.name}：说冠军是我的俱乐部（${e.champ.name}），我的比赛记录里我不在它那一边`)
          }
          const says = [partLine(r) ?? '', ...(r.there ? [careerLine(r), shareLine(r)] : [])].join('｜')
          check(says.includes('因为你') === becauseOfMe(r) && (!becauseOfMe(r) || (!!r.title && !!r.ours && r.there === 'started')),
            `${where} ${e.name}：「因为你」只在冠军换成了我的俱乐部、而且我首发时说（${says}）`)
          check(![...r.lines, r.one].some((l) => /因为/.test(l)), `${where} ${e.name}：事实行只说真实历史和这个世界各是什么（${r.lines.join(' / ')}）`)
        }
      },
    })
  }
  return kept
}

// ---------------------------------------------------------------- 一、二 careers
function career(label: string, o: Partial<CareerOpts>, seasons: number): { seen: Map<string, Rewrite>; state: GameState } {
  const t0 = Date.now()
  const state = createCareer({ name: 'Worldline', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2021, ...o } as CareerOpts)
  const me = state.me!
  const seen = new Map<string, Rewrite>()
  const cards: Card[] = []
  let writes = 0
  let reads = 0
  let order = true
  let turns = 0
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
    // the week the year may turn in: a copy to play up to the moment before the winter (atTheTurn)
    const copy = state.day >= SEASON_DAYS - 10 ? before : null
    const stop = autoWeek(state)
    if (state.year !== y) {
      for (const c of cards.filter((x) => x.m.year === y && x.comp)) {
        const later = titleRealChamp(state, c.m)
        check(later === c.line, `${label}：${c.m.comp} 的冠军卡，跨年以后再读应该一样（当年「${c.line}」，跨年「${later}」）`)
      }
      const row = me.seasons.find((s) => s.year === y)
      const at = copy ? atTheTurn(JSON.parse(copy) as GameState, y, `${label} ${y} 赛季末`) : null
      if (check(!!row && !!at, `${label}：${y} 年底要有这一季的记录，也要能在冬歇前读到账本`)) {
        turns++
        check(J({ rewrites: row!.rewrites ?? [], retitled: row!.retitled }) === J({ rewrites: at!.rewrites, retitled: at!.retitled }),
          `${label}：${y} 赛季记录里存的，就是赛季最后一天、冬歇之前那一刻的账本`)
      }
    }
    if (stop.kind === 'game-over') break
  }
  check(turns >= Math.min(seasons, state.year - 2021), `${label}：每个跨年都核对了存下的账本（${turns} 次）`)
  check(writes === 0, `${label}：读账本 ${reads} 次，有 ${writes} 次改了世界`)
  check(order, `${label}：账本按分量排，国际赛冠军在前`)
  const all = [...seen.values()]
  const kinds = (k: Rewrite['kind']) => all.filter((e) => e.kind === k).length
  console.log(`${label}：${seasons} 季 ${((Date.now() - t0) / 1000).toFixed(1)}s · 账本 ${all.length} 条（国际赛冠军 ${kinds('intl')}、名额 ${kinds('qual')}、赛区冠军 ${kinds('region')}、只有名次 ${kinds('place')}）`
    + ` · 冠军卡 ${cards.length} 张，${cards.filter((c) => c.line).length} 张有「真实历史里，这座奖杯属于」`)
  for (const c of cards) console.log(`    冠军卡 ${c.m.year} ${c.m.comp}${c.m.bench ? '（替补）' : ''}：${c.line ? `真实历史里，这座奖杯属于 ${c.line}` : '（没有这一行）'}`)
  for (const e of all.sort((a, b) => a.year - b.year || b.weight - a.weight || a.end - b.end).slice(0, 14)) console.log(`    ${e.year} ${rewriteLines(e).join(' ')}`)
  check(reads > 20 && all.length > 0, `${label}：账本真的读到了东西（${all.length} 条）`)
  for (const s of me.seasons) {
    console.log(`    ${s.year} 赛季卡「这个赛季改写的历史」（存 ${s.rewrites?.length ?? 0} 条，换了主人的奖杯 ${s.retitled ?? '—'} 座）：`)
    for (const r of s.rewrites ?? []) console.log(`      [${r.kind}] ${r.lines.join(' / ')}${partLine(r) ? ` · ${partLine(r)}` : ''}`)
  }
  if (!bad) pass(`${label}：每一条都对得上真实名次和这个世界的结果，只读不写；每个赛季末存下的就是冬歇前那一刻的账本`)
  return { seen, state }
}

/** The career hung up and noted in the hall: its card counts exactly the titles its rows kept. */
function hallOf(label: string, state: GameState): void {
  const me = state.me!
  const c = careerRewrites(me)
  if (me.phase !== 'retired') retire(state, '世界线检查到此为止', 'chose')
  noteHall(state, true)
  const h = readHall()!
  const card = h.cards.find((x) => x.id === careerIdOf(state))
  const sum = me.seasons.reduce((n, s) => n + (s.retitled ?? 0), 0)
  check(!!card && (card.rw?.n ?? 0) === sum, `${label}：殿堂卡上「改写了 N 座奖杯的归属」是 ${card?.rw?.n}，各赛季存下的加起来是 ${sum}`)
  check(card?.rw?.top === (c?.top ? careerLine(c.top) : undefined), `${label}：殿堂卡上最重的一笔（${card?.rw?.top}）就是生涯总览那一笔`)
  check(J(cleanHall(JSON.parse(J(h))).cards.find((x) => x.id === card?.id)?.rw) === J(card?.rw), `${label}：殿堂导出再读回，这一项原样`)
  check(lastRewriteLine(readHall()) === (sum ? `上一局，你的世界线改写了 ${sum} 座奖杯的归属。` : ''), `${label}：开新生涯那一行（${lastRewriteLine(readHall())}）`)
  // the page shows it folded into the line about how the last career began (me/hall.ts lastCareerLine, 2026-09-18)
  const onPage = lastCareerLine(readHall(), 2026, () => true)
  check(sum ? onPage.includes(`世界线改写了 ${sum} 座奖杯的归属`) : !onPage.includes('改写'), `${label}：开新生涯页上并成一行的样子（${onPage}）`)
  const all = me.seasons.flatMap((s) => (s.rewrites ?? []).map((r) => ({ ...r, year: s.year })))
  const mine = all.filter((r) => r.there === 'started' || (!!r.ours && !!r.there))
  check(!!c?.share === mine.length > 0, `${label}：有我首发或我的俱乐部夺冠的一条才有生涯名片那一条（${mine.length} 条能写）`)
  if (c?.share) {
    check(c.share.there === 'started' || (!!c.share.ours && !!c.share.there), `${label}：生涯名片上那一条，要么我首发，要么冠军是我的俱乐部`)
    check(!mine.some((r) => keptOrder(r, c.share!) < 0), `${label}：生涯名片上那一条是能写的里面最重的（「因为你」在前，再按分量）`)
  }
  if (c?.top) {
    const started = all.filter((r) => r.there === 'started')
    check(!!c.top.there && (c.top.there === 'started' || !started.length), `${label}：生涯总览那一笔先挑我首发的，没有才挑我在名单上的`)
    check(!(c.top.there === 'started' ? started : all.filter((r) => !!r.there)).some((r) => keptOrder(r, c.top!) < 0), `${label}：生涯总览那一笔是同一类里最重的`)
  }
  console.log(`    殿堂卡：${card?.rw ? [retitledLine({ retitled: card.rw.n, from: card.rw.from }), card.rw.top].filter(Boolean).join(' ｜ ') : '（没有这一项）'}`)
  console.log(`    生涯名片：${c?.share ? shareLine(c.share) : '（没有这一条）'}`)
  console.log(`    开新生涯：${lastCareerLine(readHall(), 2026, () => true) || '（没有这一行）'}`)
}

const A = career('一 2021 北美 · Sentinels', { region: 'North America', teamId: 'V21T2', seed: 1 }, 1)
const B = career('一 2021 欧洲 · 强队替补', { region: 'Europe', seed: 1 }, 2)
check([...A.seen.values(), ...B.seen.values()].some((e) => e.kind === 'intl'), '两局里至少有一项国际赛换了冠军（否则这一步什么也没验）')
check([...A.seen.values(), ...B.seen.values()].some((e) => !!e.mine?.there), '两局里至少有一条写了我在不在场（否则这一步什么也没验）')
// a Challengers start in Korea whose club takes 2021's third stage from Vision Strikers with me starting: 「因为你」
const C = career('一 2021 韩国 · 二线', { region: 'Korea', start: 'chal', seed: 7 }, 1)
check([A, B, C].some((x) => x.state.me!.seasons.some((s) => s.rewrites?.some((r) => !!r.there))), '存下的赛季记录里至少有一条写了我在场（否则这一步什么也没验）')
check([A, B, C].some((x) => x.state.me!.seasons.some((s) => s.rewrites?.some(becauseOfMe))), '存下的赛季记录里至少有一条「因为你」（否则这一步什么也没验）')

// ---------------------------------------------------------------- 五 the hall, and saves from before
console.log('\n五 殿堂、生涯名片、开新生涯')
hallOf('一 北美', A.state)
hallOf('一 欧洲', B.state)
hallOf('一 韩国', C.state)
{
  // a save from before 2026-09-18: its rows keep neither field, and nothing is said — never 「暂无」
  const strip = (s: MeSeason): MeSeason => { const x = { ...s }; delete x.rewrites; delete x.retitled; return x }
  const rows = B.state.me!.seasons
  check(careerRewrites({ seasons: rows.map(strip) }) == null, '老存档（赛季记录里没有账本）：生涯总览、殿堂卡、生涯名片都没有这一项')
  // a career that crossed the update: the count says from when
  const mixed = [strip(rows[0]), ...rows.slice(1)]
  const c = careerRewrites({ seasons: mixed })
  const later = rows.slice(1).reduce((n, s) => n + (s.retitled ?? 0), 0)
  check(!c || (c.from === rows[1].year && c.retitled === later && (!later || retitledLine(c).startsWith(`从 ${rows[1].year} 赛季起，`))),
    `跨过这次更新的存档：只数存下账本的赛季，说「从 ${rows[1].year} 赛季起」（${c ? retitledLine(c) : '无'}）`)
  const old = cleanHall({ v: 1, ach: {}, hx: {}, cards: readHall()!.cards.map((x) => { const y = { ...x }; delete y.rw; return y }) })
  check(old.cards.every((x) => !x.rw) && lastRewriteLine(old) === '' && !lastCareerLine(old, 2026, () => true).includes('改写'), '老殿堂卡：没有这一项，开新生涯也不写那一行')
  const quoted = ['src/ui/me/Worldline.tsx', 'src/engine/me/rewrites.ts', 'src/ui/me/share.ts', 'src/ui/me/HallScreen.tsx']
    .some((f) => /['"`][^'"`\n]*暂无/.test(readFileSync(f, 'utf8')))
  check(!quoted, '这几页没有一处写「暂无」')
  check([A, B].every((x) => x.state.me!.seasons.every((s) => (s.rewrites?.length ?? 0) <= KEEP)), `每一季最多存 ${KEEP} 条`)
  if (!bad) pass('老存档什么都不写；殿堂卡的数字就是各赛季存下的换了主人的奖杯数')
}

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
console.log('\n✓ 世界线账本只记这个世界打过、结果和真实历史不一样的赛事，逐条对得上真实名次；只读不写；改名、解散、名额顺延都按那一站的样子写；冠军卡的那一行只在奖杯本来不属于我们时出现；'
  + '赛季记录存的就是冬歇前那一刻的账本，最多五条，「因为你」只在冠军换成我的俱乐部且我首发时出现；殿堂卡的数字对得上，老存档什么都不写。')
