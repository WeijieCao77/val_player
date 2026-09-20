/**
 * The 成就殿堂 (me/hall.ts), headless.
 *
 * Three careers played and hung up — 2026 from the ladder, 2021 from a second-
 * tier club, 2026 from a first-tier bench — with the hall noted after every
 * week, the way PlayerGame's commit does. Then:
 *
 *  - every career's unlocks are in the hall, each career counted once
 *  - each ended career has exactly one card
 *  - 「跨时代」 unlocks once, for the career that completed it, and not again
 *  - noting again, reloading (pack → unpack), or losing the stored id changes nothing
 *  - a milestone that needs two careers is not done by one
 *  - export → clear → import gives the same hall; importing twice adds nothing
 *  - saving and deleting a save, or starting a career, leaves the hall alone
 *  - a broken record reads as an empty hall
 *  - a browser whose storage throws plays a whole career; one that cannot write keeps the hall as it was
 *  - 卡面 (2026-09-18, 「但是殿堂不影响游戏里的数值」): each look opens with its condition, credited to the
 *    career that met it; every look is drawn (a palette for the picture, a block for the card) and only an open
 *    one can be chosen; 另一条世界线 opens on a 「因为你」 and on nothing else; the choice survives export → import;
 *    a hall that cannot store has only the default. And no number reads them: the same career played with every
 *    look open and one chosen, and with an empty hall, is the same career byte for byte — and nothing in
 *    the engine but the hall itself (and the save tile's count) imports the hall
 *
 *   npx tsx scripts/check_hall.ts
 */
import { candidateClubs, careerRegions, createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { retire } from '../src/engine/me/endings'
import { regionsOf } from '../src/engine/era'
import { deleteSave, packState, saveGame, setSaveNamespace, unpackState } from '../src/engine/save'
import type { GameState, Region } from '../src/engine/types'
import {
  HALL_KEY, LOOKS, MILESTONES, careerIdOf, chooseLook, cleanHall, endingKinds, exportHall, hallLine, hallRecords, importHall,
  lookOf, milestoneDone, noteHall, openLooks, readHall,
} from '../src/engine/me/hall'
import type { Hall, HallCard, LookKey } from '../src/engine/me/hall'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mem: Record<string, string> = {}
const good = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => {},
  key: () => null,
  length: 0,
}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = good
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const snap = () => mem[HALL_KEY]

function play(label: string, o: Partial<CareerOpts>, seasons: number): { state: GameState; fresh: string[] } {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Probe', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', ...o,
  } as CareerOpts)
  const me = state.me!
  const until = state.year + seasons
  let weeks = 0
  while (me.phase !== 'retired' && state.year < until && weeks++ < 70 * seasons) {
    if (autoWeek(state).kind === 'game-over') break
    noteHall(state)
  }
  if (me.phase !== 'retired') retire(state, '探针：挂靴')
  const fresh = noteHall(state).map((m) => m.key)
  console.log(`${label}：${me.entryYear}–${me.ending?.year} · 职业 ${me.seasons.filter((x) => x.tier > 0).length} 季 · ${me.titles.length} 冠 · 成就 ${me.achievements.length} · 「${me.ending?.title}」 · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return { state, fresh }
}

// ------------------------------------------------------------------ three careers
const A = play('A 2026 天梯 中国 决斗者', { name: 'HallA', seed: 11, year: 2026, start: 'pre' }, 2)
let h = readHall()!
const idA = careerIdOf(A.state)
check(h.cards.length === 1 && h.cards[0].id === idA, 'A 收尾：殿堂里一张卡')
check(h.cards[0].entry === 2026 && h.cards[0].start === 'pre' && h.cards[0].role === '决斗者', 'A 的卡：2026 · 天梯开局 · 决斗者')
check(A.state.me!.achievements.every((k) => h.ach[k]?.ids.includes(idA) && h.ach[k].n === 1 && h.ach[k].first.id === idA),
  `A 的 ${A.state.me!.achievements.length} 项成就都记进殿堂，每项 1 局、首次是 A`)
check(A.fresh.length === 0 && Object.keys(h.hx).length === 0, '一局凑不齐任何殿堂成就')

let before = snap()
noteHall(A.state, true)
check(snap() === before, '同一局再记一遍：殿堂不变')
const reloaded = unpackState(packState(A.state))
noteHall(reloaded, true)
check(snap() === before, '读档（pack → unpack）再记：殿堂不变')
delete reloaded.me!.flags.hallId
noteHall(reloaded, true)
check(snap() === before, '存档里没有编号（老档）：算出来还是同一局，殿堂不变')

const r21 = regionsOf(2021).find((r) => r !== 'China' && candidateClubs(r, 2, 2021).length > 0) as Region
const B = play(`B 2021 二线 ${r21} 先锋`, { name: 'HallB', seed: 12, year: 2021, start: 'chal', region: r21, role: '先锋', originKey: 'academy' }, 2)
h = readHall()!
const idB = careerIdOf(B.state)
const cardB = h.cards.find((c) => c.id === idB)
check(h.cards.length === 2 && cardB?.entry === 2021 && cardB.start === 'chal', 'B 收尾：两张卡，B 是 2021 · 二线开局')
check(B.fresh.join() === 'eras' && h.hx.eras?.id === idB, `「跨时代」在 B 收尾时凑齐，记在 B 名下（这次解锁：${B.fresh.join() || '无'}）`)
check(!!cardB?.hx?.includes('eras') && !h.cards.find((c) => c.id === idA)?.hx, 'B 的卡上写着凑齐「跨时代」，A 的卡上没有')
check(hallLine(B.state).includes('跨时代'), `B 的生涯名片那一行：${hallLine(B.state)}`)
const both = A.state.me!.achievements.filter((k) => B.state.me!.achievements.includes(k))
check(both.every((k) => h.ach[k].n === 2 && h.ach[k].first.id === idA), `两局都有的 ${both.length} 项记 2 局，首次仍是 A`)
check(B.state.me!.achievements.filter((k) => !both.includes(k)).every((k) => h.ach[k].n === 1 && h.ach[k].first.id === idB), '只有 B 有的记 1 局、首次是 B')

const pacific = careerRegions(2026).find((r) => candidateClubs(r, 1, 2026).length > 0 && ['Korea', 'Japan'].includes(r)) ?? 'Pacific'
const C = play(`C 2026 替补 ${pacific} 控场`, { name: 'HallC', seed: 13, year: 2026, start: 't1', region: pacific as Region, role: '控场', originKey: 'late' }, 1)
h = readHall()!
check(h.cards.length === 3 && h.cards[2].start === 't1', 'C 收尾：三张卡，C 是替补开局')
check(!C.fresh.includes('eras') && h.hx.eras?.id === idB, '「跨时代」没有再解锁一次，仍记在 B 名下')
check(MILESTONES.every((m) => !!h.hx[m.key] === milestoneDone(m, h.cards)), `殿堂成就和三张卡对得上：${Object.keys(h.hx).join('、') || '无'}`)

before = snap()
for (const s of [A.state, B.state, C.state]) noteHall(s, true)
check(snap() === before, '三局各再记一遍：殿堂一个字不变')

const recs = hallRecords(h)
const maxOf = (f: (c: HallCard) => number) => Math.max(0, ...h.cards.map(f))
check((recs.find((r) => r.key === 'seasons')?.n ?? 0) === maxOf((c) => c.seasons), `纪录「职业赛季」= 三局里最长的 ${maxOf((c) => c.seasons)} 季`)
check((recs.find((r) => r.key === 'peak')?.n ?? 0) === maxOf((c) => c.peak), `纪录「综合巅峰」= ${maxOf((c) => c.peak)}`)
check(recs.every((r) => r.n > 0), `纪录只列有数的（${recs.map((r) => `${r.label} ${r.n}`).join(' · ')}）`)

// ------------------------------------------------------------------ milestones that need different careers
const fake = (id: string, extra: Partial<HallCard>): HallCard => ({ ...h.cards[0], id, ach: [], titles: [], hx: undefined, ...extra })
const ms = (k: string) => MILESTONES.find((m) => m.key === k)!
check(!milestoneDone(ms('stay_go'), [fake('cx1', { ach: ['loyal5', 'abroad2'] })]), '「去留」：一局里两样都有，不算')
check(milestoneDone(ms('stay_go'), [fake('cx1', { ach: ['loyal5'] }), fake('cx2', { ach: ['abroad2'] })]), '「去留」：分在两局，算')
check(milestoneDone(ms('roles'), ['决斗者', '先锋', '控场', '哨卫'].map((r, i) => fake(`cr${i}`, { role: r, seasons: 3 }))), '「全位置」：四个位置各一局')
check(!milestoneDone(ms('roles'), ['决斗者', '先锋', '控场', '哨卫'].map((r, i) => fake(`cr${i}`, { role: r, seasons: i ? 3 : 0 }))), '「全位置」：没打上职业的那一局不算')
check(milestoneDone(ms('leagues'), ['Thailand', 'Turkey', 'North America', 'China'].map((home, i) => fake(`cl${i}`, { home, seasons: 2 }))), '「四海」：2021 的泰国、土耳其、北美按今天的赛区算')
const champ = { year: 2030, name: '2030 全球冠军赛', cls: 'champions' as const, started: true }
check(milestoneDone(ms('lives'), [fake('cv1', {}), fake('cv2', { titles: [champ] })]), '「两种人生」：一局无冠、一局冠军赛')

// ------------------------------------------------------------------ 卡面: what opens them, and choosing one
console.log('\n卡面')
{
  const holds = (k: LookKey, cs: HallCard[]) => { const l = LOOKS.find((x) => x.key === k)!; return !l.open || l.open(cs) }
  const shut = LOOKS.filter((l) => l.open && !holds(l.key, h.cards)).map((l) => l.key)
  check(LOOKS.every((l) => !l.open || !!h.looks[l.key] === holds(l.key, h.cards)),
    `卡面和三张卡对得上：开了 ${Object.keys(h.looks).join('、') || '无'}；没开 ${shut.join('、')}`)
  check(LOOKS.every((l) => {
    const m = h.looks[l.key]
    if (!m) return true
    const i = h.cards.findIndex((_, k) => holds(l.key, h.cards.slice(0, k + 1)))
    return m.id === h.cards[i]?.id
  }), '每套卡面记在第一张凑齐条件的卡名下')
  check(!!h.looks.film && h.looks.film.id === idB && !!h.hx.eras, '「胶片档案」跟「跨时代」一起开，记在 B 名下')
  check(!!h.looks.night === (endingKinds(h.cards) >= 2), `「夜场转播」：${endingKinds(h.cards)} 种结局，${h.looks.night ? '开了' : '没开'}`)
  check(lookOf(h) === 'studio' && openLooks(h).has('studio'), '没选过：默认「演播室」')
  before = snap()
  const shutOne = LOOKS.find((l) => !openLooks(h).has(l.key))
  check(!shutOne || (!chooseLook(shutOne.key) && snap() === before), `没解锁的${shutOne ? `「${shutOne.name}」` : ''}选不了，殿堂不动`)
  check(chooseLook('film') && lookOf(readHall()) === 'film' && readHall()!.look === 'film', '选「胶片档案」：记进殿堂')
  noteHall(C.state, true)
  check(lookOf(readHall()) === 'film', '再记一遍生涯：选的卡面还在')
  check(chooseLook('studio') && readHall()!.look === undefined && chooseLook('film'), '换回默认，再换回来')
  // 「因为你」 as the hall card keeps it: the seasons' rows counted, a card with none carries none
  const { becauseOfMe } = await import('../src/engine/me/rewrites')
  const kept = (st: GameState) => st.me!.seasons.reduce((n, x) => n + (x.rewrites ?? []).filter(becauseOfMe).length, 0)
  check([A, B, C].every((r) => (h.cards.find((c) => c.id === careerIdOf(r.state))?.rw?.mine ?? 0) === kept(r.state)),
    `殿堂卡记下「因为你」几条：${[A, B, C].map((r) => kept(r.state)).join(' · ')}`)
  const rwCard = (id: string, rw: HallCard['rw']): HallCard => ({ ...h.cards[0], id, rw })
  const red = LOOKS.find((l) => l.key === 'redline')!
  check(!!red.open?.([rwCard('cw1', { n: 3, mine: 1 })]), '「另一条世界线」：有一局「因为你」，开')
  check(!!red.open?.([rwCard('cw2', { n: 2, top: '因为你，2026 挑战者联赛 · 北欧与东欧 · 揭幕赛的冠军是 X（真实历史：Y）· 你首发' })]),
    '「另一条世界线」：这一条之前记的卡，最重的一条写着「因为你」，也开')
  check(!red.open?.([rwCard('cw3', { n: 99, top: '2021 柏林大师赛的冠军是 X（真实历史：Y）· 你首发' })]) && !red.open?.([rwCard('cw4', undefined)]),
    '「另一条世界线」：改写得再多，没有一条是「因为你」，不开')
  // a hand-edited record naming a look it has not opened reads as the default
  check(lookOf(cleanHall({ ...JSON.parse(snap()), look: 'paper' })) === (openLooks(h).has('paper') ? 'paper' : 'studio'), '记录里写着没解锁的卡面：照默认画')
  h = readHall()!
}

// ------------------------------------------------------------------ carrying it to another device
const text = exportHall()!
before = snap()
delete mem[HALL_KEY]
check(importHall(text) === 'ok' && JSON.stringify(readHall()) === JSON.stringify(cleanHall(JSON.parse(before))), '导出 → 清空 → 导入：殿堂原样回来')
before = snap()
check(importHall(text) === 'ok' && snap() === before, '同一段再导入一次：不多算')
check(importHall('{"format":"nope"}') === 'bad' && importHall('not json') === 'bad', '不是殿堂的文本不收')
check(readHall()!.look === 'film' && JSON.stringify(readHall()!.looks) === JSON.stringify(h.looks), '导出 → 导入：选的卡面和解锁记录都在')

// ------------------------------------------------------------------ saves and new careers do not touch it
setSaveNamespace('player')
before = snap()
saveGame('probe', C.state)
deleteSave('probe')
check(snap() === before && Object.keys(mem).every((k) => !k.includes('save:probe')), '存档存下又删掉：殿堂不动')
const E = createCareer({ name: 'HallE', region: 'China', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 14, year: 2026 })
noteHall(E)
check(snap() === before && E.me!.originKey === 'netcafe', '开新生涯：殿堂不动')

const keep = snap()
mem[HALL_KEY] = '{"v":1,"cards":[{"id":'
const broken = readHall()
check(!!broken && broken.cards.length === 0, '半截记录读成空殿堂，不抛错')
mem[HALL_KEY] = keep

// ------------------------------------------------------------------ storage that fails
const boom = () => { throw new Error('blocked') }
G.localStorage = { getItem: boom, setItem: boom, removeItem: boom, clear: () => {}, key: () => null, length: 0 }
let threw = ''
try {
  const D = play('D 2026 天梯 中国 哨卫（存储一碰就抛错）', { name: 'HallD', seed: 15, year: 2026, role: '哨卫' }, 1)
  check(D.state.me!.phase === 'retired' && !!D.state.me!.ending, 'D 照常打完、照常有结局')
  check(readHall() === null && exportHall() === null && hallLine(D.state) === '' && importHall(text) === 'nostore', '读成「存不下」：名片那一行空着，导入说存不下')
  check(lookOf(readHall()) === 'studio' && openLooks(readHall()).size === 1 && !chooseLook('film'), '存不下：只有默认卡面，选别的也不抛错')
} catch (e) {
  threw = (e as Error).message
}
check(!threw, `存储抛错时一路没有抛出来${threw ? `：${threw}` : ''}`)

G.localStorage = { ...good, setItem: (_k: string, _v: string) => { throw new Error('quota') } }
before = snap()
threw = ''
try {
  const F = play(`F 2021 天梯 ${r21}（写不进去）`, { name: 'HallF', seed: 16, year: 2021, region: r21, role: '先锋' }, 1)
  check(snap() === before && F.fresh.length === 0, '写不进去：殿堂保持原样，不报解锁')
} catch (e) {
  threw = (e as Error).message
}
check(!threw, `写不进去时一路没有抛出来${threw ? `：${threw}` : ''}`)

// ------------------------------------------------------------------ a qualifier won is 出线, not a title
// (2026-09-12) Open qualifiers and a league cup's open playoffs send their winner on to another event:
// winning one must not count as a title anywhere a title counts, nor open a bottleneck break.
G.localStorage = good
{
  const { syncTitles } = await import('../src/engine/me/week')
  const { endingFor } = await import('../src/engine/me/endings')
  const { shelfOf } = await import('../src/engine/me/stars')
  const { isQualifier } = await import('../src/engine/me/compclass')
  console.log('\n出线不是冠军')
  const Q = createCareer({ name: 'HallQ', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 21, year: 2026 } as CareerOpts)
  const me = Q.me!
  const p = Q.players[me.id]
  const y = Q.year
  const quals = ['杯赛 1 公开资格赛 · 欧洲', `${y + 1} 揭幕赛公开资格赛 · 欧洲`, 'EMEA 联赛 · 杯赛 2 公开季后赛']
  const asc = `中国 · 晋级赛（${y + 1} 访客席位）`
  // started and won, the way the career reads it: a started match of mine in each event
  const played = (comp: string) => ({
    fixtureId: `probe:${comp}`, day: Q.day, year: y, comp, label: '决赛', opp: 'Probe', oppTag: 'PRB', started: true, won: true,
    score: '2-0', maps: 2, rounds: 26, kills: 20, deaths: 12, assists: 6, firstKills: 3, clutches: 1, acs: 240, rating: 1.2,
    mvp: false, carried: false, nodes: [], rank: 1,
  })
  for (const t of [...quals, asc]) me.matches.push(played(t))
  const bnBefore = JSON.stringify(me.bottleneck ?? null)
  const titlesBefore = me.titles.length
  p.titles = [...(p.titles ?? []), ...quals.map((title) => ({ year: y, title }))]
  syncTitles(Q)
  check(quals.every(isQualifier) && !isQualifier(asc) && !isQualifier('挑战者联赛 · 法国 · 第一赛段'), '公开资格赛、公开季后赛是出线；晋级赛、挑战者赛段不是')
  check(me.titles.length === titlesBefore && (me.quals ?? []).length === quals.length && (me.quals ?? []).every((t) => t.started), '三个出线都记进出线，冠军名单一个没多')
  check(JSON.stringify(me.bottleneck ?? null) === bnBefore, '出线不开任何瓶颈')
  check(quals.every((t) => me.log.some((l) => l.text.includes('出线') && l.text.includes(t.split(' · ')[0].replace(/^\d{4} /, '')))), '日志写「出线」')
  check(!['regional', 'titled', 'ring'].includes(endingFor(Q).key), `三个出线够不上赛区功勋，也不算拿过冠军（结局判成「${endingFor(Q).title}」）`)
  p.titles = [...p.titles, { year: y, title: asc }]
  syncTitles(Q)
  check(me.titles.length === titlesBefore + 1 && me.titles.some((t) => t.title === asc), '晋级赛照样是冠军')
  // a save from before: a qualifier already on the title list, and what it earned
  const old = '杯赛 2 公开资格赛 · 欧洲'
  me.titles.push({ year: y, title: old, started: true })
  me.achievements = [...me.achievements, 'oq_title']
  const achBefore = me.achievements.slice()
  syncTitles(Q)
  check(!me.titles.some((t) => t.title === old) && (me.quals ?? []).some((t) => t.title === old), '旧存档里记成冠军的出线挪到出线里')
  check(JSON.stringify(me.achievements) === JSON.stringify(achBefore), '已经拿到的成就不收回')
  // anyone's shelf: another player with a qualifier and a Challengers stage won in this save
  const other = Object.values(Q.players).find((x) => x.id !== me.id && !!x.teamId)!
  other.titles = [{ year: y, title: quals[0] }, { year: y, title: '挑战者联赛 · 法国 · 第一赛段' }]
  const shelf = shelfOf(Q, null, other.id)
  check(shelf.length === 1 && !shelf.some((h) => h.label.includes('资格赛')), '别人的奖杯柜：出线不上架，挑战者赛段照上')
}

// ------------------------------------------------------------------ 卡面 count for nothing
// The author, 2026-09-18: 殿堂可以解锁新的东西 — 「但是殿堂不影响游戏里的数值」. The same career, played
// the way PlayerGame plays it (the hall noted after every week), once beside a hall that opens every look with one
// chosen and once beside an empty one: every attribute, coin, action point, start and result must come out the same.
G.localStorage = good
{
  // a real 「因为你」: a 2026 start whose first season's Challengers title went to my club over history's champion
  //
  // The seed is a fixture, not the rule: it is picked because that world plays
  // out with the case in it, and only about one 2026 二线 start in seven does in
  // a single season. It was 7 until 2026-09-20, when the rebalance
  // (engine/age.ts, engine/ruler.ts) moved which clubs the ruler puts where and
  // seed 7 stopped winning its split; seed 8 plays the same case out — two
  // 因为你 in its first season, the 北欧与东欧 splits, as seed 7's one was.
  // Re-pick it the same way if a later change moves the world again: run a
  // season on a handful of seeds and take one whose 挑战者 title came to the
  // player's club over history's champion. Nothing about what is asserted below
  // may be loosened for it.
  {
    const { becauseOfMe } = await import('../src/engine/me/rewrites')
    delete mem[HALL_KEY]
    const R = play('R 2026 二线 欧洲 决斗者（一季）', { name: 'HallR', seed: 8, year: 2026, start: 'chal', region: 'Europe' as Region }, 1)
    const rh = readHall()!
    const rc = rh.cards.find((c) => c.id === careerIdOf(R.state))
    const mine = R.state.me!.seasons.reduce((n, x) => n + (x.rewrites ?? []).filter(becauseOfMe).length, 0)
    check(mine > 0 && rc?.rw?.mine === mine && !!rc.rw.top?.startsWith('因为你') && openLooks(rh).has('redline') && rh.looks.redline?.id === rc.id,
      `一局 2026 开局就有「因为你」（${rc?.rw?.top ?? '无'}）：「另一条世界线」开了，记在这一局名下`)
  }

  console.log('\n卡面不碰数值')
  const base = h.cards[0]
  const card = (id: string, x: Partial<HallCard>): HallCard => ({ ...base, id, ach: [], titles: [], hx: undefined, seasons: 3, ...x })
  const champ = { year: 2030, name: '2030 全球冠军赛', cls: 'champions' as const, started: true }
  const league = { year: 2029, name: 'VCT 太平洋联赛 · 第一赛段', cls: 'league' as const, started: true }
  const ends = ['world', 'journeyman', 'flash', 'shore', 'titled']
  const cards: HallCard[] = [
    ...['决斗者', '先锋', '控场', '哨卫'].map((role, i) => card(`cz${i}`, {
      role, entry: i % 2 ? 2021 : 2026, home: ['Korea', 'Turkey', 'North America', 'China'][i],
      start: (['pre', 'chal', 't1', 'pre'] as const)[i], titles: i < 3 ? [league] : [],
      ending: { key: ends[i], title: ends[i] }, ach: i === 0 ? ['loyal5'] : i === 1 ? ['abroad2'] : [],
    })),
    card('cz4', { titles: [champ], ending: { key: ends[4], title: ends[4] } }),
    { ...card('cz5', { ending: { key: 'world', title: 'world' } }), rw: { n: 9, mine: 1 } } as HallCard,
  ]
  const full: Hall = cleanHall({ v: 1, ach: {}, cards, hx: {}, looks: {}, look: 'paper' })
  check(LOOKS.every((l) => openLooks(full).has(l.key)) && lookOf(full) === 'paper', `满殿堂：${LOOKS.length} 套卡面全开，选的是「体育版头条」`)
  const runOnce = (label: string, hall: string | null): string => {
    if (hall === null) delete mem[HALL_KEY]
    else mem[HALL_KEY] = hall
    return JSON.stringify(play(label, { name: 'HallL', seed: 32, year: 2026 }, 2).state)
  }
  const withAll = runOnce('L1 2026 天梯 中国 决斗者（殿堂全开，选「体育版头条」）', JSON.stringify(full))
  const withNone = runOnce('L2 同一局（殿堂是空的）', null)
  let at = 0
  while (at < withAll.length && withAll[at] === withNone[at]) at++
  check(withAll === withNone, withAll === withNone
    ? `全开和空殿堂打出的是同一局：整局存档 ${(withAll.length / 1024).toFixed(0)} KB，一个字节不差`
    : `全开和空殿堂在第 ${at} 个字符分开：…${withAll.slice(Math.max(0, at - 80), at + 40)}…`)

  // and nothing that counts can reach it. The engine may write the hall — note a career (noteHall), fold in a hall
  // carried from elsewhere (mergeHallFrom) — carry its record inside a save backup beside the save, never in it
  // (backup.ts: readHall, cleanHall), and count its achievements for the save tile (saveMeta.ts). Nothing else.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const x = path.join(d, f)
    return statSync(x).isDirectory() ? walk(x) : /\.tsx?$/.test(f) ? [x] : []
  })
  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/')
  const src = walk(path.join(root, 'src')).map((f) => ({ f: rel(f), t: readFileSync(f, 'utf8') }))
  const uses = src.filter((x) => x.f.startsWith('src/engine/') && x.f !== 'src/engine/me/hall.ts').flatMap((x) =>
    [...x.t.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*'[./a-z]*\/hall'/g)]
      .map((m) => ({ f: x.f.replace('src/engine/me/', ''), type: !!m[1], names: m[2].split(',').map((n) => n.trim()).filter(Boolean) })))
  const CARRY: Record<string, string[]> = { 'backup.ts': ['readHall', 'cleanHall'], 'saveMeta.ts': ['hallAchCount', 'readHall'] }
  const fine = (u: (typeof uses)[number]) => u.type
    || u.names.every((n) => n === 'noteHall' || n === 'mergeHallFrom' || (CARRY[u.f] ?? []).includes(n))
  check(uses.length > 0 && uses.every(fine),
    `引擎里碰殿堂的只有：记生涯、合并带来的殿堂、把殿堂装进存档备份、存档卡片的成就计数——${uses.map((u) => `${u.f}（${u.names.join('、')}）`).join('；')}`)
  // nothing listed that cannot be drawn: every look has its palette on the picture and its block on the card
  const css = src.find((x) => x.f === 'src/ui/me/looks.css')?.t ?? readFileSync(path.join(root, 'src/ui/me/looks.css'), 'utf8')
  const share = src.find((x) => x.f === 'src/ui/me/share.ts')!.t
  const pal = share.slice(share.indexOf('const PALETTES'), share.indexOf('const FONT'))
  const undrawn = LOOKS.filter((l) => l.key !== 'studio' && (!css.includes(`.poster-me.look-${l.key} {`) || !new RegExp(`\\b${l.key}: \\{`).test(pal)))
  check(!undrawn.length, `每套卡面都画了（分享图的配色、名片的样式）${undrawn.length ? `：缺 ${undrawn.map((l) => l.name).join('、')}` : ''}`)
  const lookers = src.filter((x) => x.f !== 'src/engine/me/hall.ts' && /\b(lookOf|openLooks|chooseLook|LOOK_BY_KEY|LOOKS|useLook)\b/.test(x.t)).map((x) => x.f)
  check(lookers.length > 0 && lookers.every((f) => f.startsWith('src/ui/')), `读卡面的都是界面：${lookers.join('、')}`)
}

console.log(bad ? `\n✗ ${bad} 项没过。` : '\n✓ 殿堂探针全部通过。')
if (bad) process.exit(1)
