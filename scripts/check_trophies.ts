/**
 * 本局奖杯 — the career's trophy case (me/trophies.ts), headless.
 *
 * Two careers played by 托管 — 2021 from a second-tier club and 2026 from the ladder — and then, on each:
 *
 *  - one card per title on the shelf, and nothing that is not a title
 *  - the order is the game's own: 冠军赛 > 大师赛 / LOCK//IN > 赛区冠军, one I started in above one I watched,
 *    then the earlier year — the same ranking the career-end card's wall uses
 *  - every fact on a card is in the save's own records: the club, the final, the run, my part, the campaign,
 *    the season's ledger entry, the ladder's first big tier
 *  - the passage states nothing the records do not hold — every name, every figure and every 「一张图都没让」
 *    is held against the record it came from — and no two trophies of a career read the same
 *  - a save without the newer fields (no 明细, no 国际赛记录, no 世界线, no 大事卡) still builds every card
 *  - a career with no trophy at all says its one plain line
 *
 *   npx tsx scripts/check_trophies.ts [seasons=4] [--dump]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { eventsOf } from '../src/engine/circuit'
import { onTimeline, stagesOf } from '../src/engine/era'
import { compClass } from '../src/engine/me/compclass'
import { compCn } from '../src/engine/me/compname'
import { BIG_TIERS } from '../src/engine/me/moments'
import {
  TROPHY_RANK, careerTrophies, trophyNone, trophyOrder, trophyPart, trophyProse, trophyTier,
} from '../src/engine/me/trophies'
import type { Trophy } from '../src/engine/me/trophies'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
G.fetch = () => Promise.reject(new Error('offline'))

const seasons = Number(process.argv[2] ?? 4)
const dump = process.argv.includes('--dump')
let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

function play(label: string, o: Partial<CareerOpts>, stop?: (s: GameState) => boolean): GameState {
  const t0 = Date.now()
  const state = createCareer({ name: 'Trophy', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', ...o } as CareerOpts)
  const me = state.me!
  const until = state.year + seasons
  let weeks = 0
  while (me.phase !== 'retired' && state.year < until && weeks++ < 70 * seasons) {
    if (autoWeek(state).kind === 'game-over') break
    // the cards are taken as they come, the way the screen takes them
    if (me.moments?.length) me.moments = []
    if (stop?.(state)) break
  }
  console.log(`${label}：${state.year} 年停 · ${me.titles.length} 冠（首发 ${me.titles.filter((t) => t.started).length}）· 明细 ${me.matches.length} 场 · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return state
}

/* ------------------------------------------------------------------ */
/*  one card per title, in the game's own order                        */
/* ------------------------------------------------------------------ */

function judgeShelf(label: string, state: GameState, list: Trophy[]): void {
  const me = state.me!
  const keys = list.map((t) => t.key)
  check(list.length === me.titles.length && new Set(keys).size === keys.length
    && me.titles.every((t) => keys.includes(`title:${t.year}:${t.title}`)),
    `${label}：${me.titles.length} 个冠军各一张卡，不多不少`)
  // 出线 is not a title and never reaches the shelf (me/compclass.ts isQualifier)
  check(list.every((t) => !(me.quals ?? []).some((q) => q.year === t.year && q.title === t.comp)),
    `${label}：出线的资格赛没有当成奖杯`)

  const sorted = [...list].sort(trophyOrder)
  check(list.every((t, i) => t.key === sorted[i].key), `${label}：卡按游戏自己的重要程度排（${list.map((t) => t.tier).join(' ')}）`)
  check(list.every((t) => t.tier === trophyTier(t.comp)
    && TROPHY_RANK[t.tier] === (compClass(t.comp) === 'champions' ? 0 : compClass(t.comp) === 'masters' || compClass(t.comp) === 'lockin' ? 1 : 2)),
    `${label}：冠军赛 > 大师赛 / LOCK//IN > 赛区冠军，按赛事本身判，不按名字里的英文`)
  const drop = list.map((t) => TROPHY_RANK[t.tier] * 1e6 + (t.started ? 0 : 1e5) + t.year)
  check(drop.every((x, i) => i === 0 || drop[i - 1] <= x), `${label}：同一档里首发的在前，再按年份`)
}

/* ------------------------------------------------------------------ */
/*  every fact against the record it came from                         */
/* ------------------------------------------------------------------ */

function judgeFacts(label: string, state: GameState, list: Trophy[]): void {
  const me = state.me!
  const p = state.players[me.id]
  const wrong: string[] = []
  const say = (t: Trophy, why: string) => wrong.push(`${t.year} ${t.name}：${why}`)

  for (const t of list) {
    const title = me.titles.find((x) => x.year === t.year && x.title === t.comp)
    if (!title) { say(t, '这张卡不在 me.titles 里'); continue }
    if (t.started !== title.started) say(t, '首发/替补和记录不符')
    if (trophyPart(t) !== (title.started ? '你首发出场' : '你在名单上，没有上场')) say(t, '那一行说错了我的位置')

    // the run: exactly my own records of that event, in order
    const recs = me.matches.filter((m) => !m.friendly && m.year === t.year && m.comp === t.comp)
    if (t.matches.length !== recs.length || t.matches.some((m, i) => m.label !== recs[i].label || m.opp !== recs[i].opp || m.score !== recs[i].score)) {
      say(t, '比赛列表和生涯明细不是同一批')
    }
    if (t.starts !== recs.filter((m) => m.started).length) say(t, '首发场次和明细对不上')
    const last = recs[recs.length - 1]
    if ((t.final == null) !== (last == null)) say(t, '决赛有无和明细不符')
    if (t.final && last && (t.final.opp !== last.opp || t.final.score !== last.score || t.final.started !== last.started)) say(t, '决赛不是明细里的最后一场')
    if (t.final && last && t.final.maps.join() !== (last.mapLog ?? []).map((x) => x.map).join()) say(t, '地图和 mapLog 不符')
    if (t.final?.line && last && t.final.line.mvp !== last.mvp) say(t, 'MVP 和明细不符')
    if (t.final && last && (t.final.line != null) !== last.started) say(t, '没上场的比赛却有个人数据')
    // a title is only ever won: the last match of it was not a defeat
    if (t.final && !t.final.won) say(t, '拿了冠军，最后一场却不是赢的')

    // the club
    if (t.clubId && !state.teams[t.clubId]) say(t, '俱乐部 id 不在这个世界里')
    if (t.clubId && t.club !== state.teams[t.clubId]?.name) say(t, '俱乐部名字和 id 不是同一家')
    if (t.clubId) {
      const comp = t.year === state.year ? Object.values(state.comps).find((c) => c.name === t.comp && c.champion === t.clubId) : undefined
      const hist = (p.clubHist ?? []).filter((h) => h.from <= t.year && t.year <= h.to)
      if (!comp && !hist.some((h) => h.team === t.clubId)) say(t, '这一年我不在这家俱乐部')
    }
    if (!t.clubId && t.club) say(t, '说了俱乐部却没有依据')

    // the event on the books
    if (t.city && t.city !== Object.values(state.comps).find((c) => c.name === t.comp)?.city) say(t, '主办城市不是赛事记的那个')
    if (t.stage) {
      const names = stagesOf(t.year, onTimeline(state)).map((s) => s.name)
      if (!names.includes(t.stage) && !/挑战者联赛|晋级赛|公开资格赛/.test(t.stage)) say(t, `赛段名「${t.stage}」不是这一年的赛段`)
      if (t.stage === t.name) say(t, '赛段名和赛事名说了两遍')
    }
    // the clubs a year was spent at are the ones the player's own club history holds
    for (const c of t.clubs) if (!(p.clubHist ?? []).some((h) => h.from <= t.year && t.year <= h.to && state.teams[h.team]?.name === c)) say(t, `「${c}」不是这一年待过的俱乐部`)
    if (t.club && !t.clubs.includes(t.club) && t.clubs.length) say(t, '夺冠俱乐部不在这一年的俱乐部里')
    if (t.runnerUp) {
      const comp = Object.values(state.comps).find((c) => c.name === t.comp && !!c.champion)
      const at = comp?.places ? comp.places.indexOf(2) : 1
      if (!comp || state.teams[comp.finished[at] ?? '']?.name !== t.runnerUp) say(t, '亚军不是赛事记的那支')
    }
    if (t.realChamp) {
      const names = eventsOf(t.year).filter((e) => e.cn === t.comp).flatMap((e) => Object.values(e.names ?? {}))
      if (!names.includes(t.realChamp)) say(t, `真实历史的冠军「${t.realChamp}」不在这一站的参赛方里`)
      if (t.realChamp === t.club) say(t, '把真实冠军说成了自己')
    }
    if (t.run && (t.run.year !== t.year || t.run.comp !== t.comp)) say(t, '国际赛记录不是这一站的')
    if (t.rewrite && t.rewrite.comp !== t.comp) say(t, '世界线记录不是这一站的')
    if (t.season && t.season.year !== t.year) say(t, '赛季记录不是这一年的')
    if (t.season && !t.season.titles.includes(t.comp)) say(t, '这一年的赛季记录里没有这个冠军')
    if (t.ladderFirst && me.flags[`reached:${t.ladderFirst}`] !== t.year) say(t, '天梯段位不是这一年第一次到的')
    if (t.ladderFirst && !BIG_TIERS.includes(t.ladderFirst)) say(t, '天梯段位不是大段位')
    if (t.name !== compCn(t.comp)) say(t, '赛事名不是 compCn 写的那个')
  }
  check(!wrong.length, `${label}：每张卡的事实都对得上存档（${list.length} 张）${wrong.length ? `\n      ${wrong.join('\n      ')}` : ''}`)
}

/* ------------------------------------------------------------------ */
/*  the passage says nothing the records do not hold                   */
/* ------------------------------------------------------------------ */

/** every number written in a sentence */
const numsIn = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number)

/** Parentheses inside a recorded proper name are part of that name, not a
 * claim about the final's maps (e.g. 晋级赛（2030 访客席位）). Remove only
 * complete known names containing parentheses; every remaining parenthetical
 * map claim still has to match the final's actual map ledger. Do NOT ignore
 * arbitrary parentheses merely because the current prose seldom lists maps.
 */
function unsupportedMapClaims(t: Trophy, text: string): string[] {
  let facts = text
  for (const name of [t.name, t.club, t.realChamp, t.final?.opp, t.final?.label, ...t.clubs]) {
    if (name?.includes('（')) facts = facts.split(name).join('')
  }
  return (facts.match(/（([^）]*)）/g) ?? []).map(m => m.slice(1, -1)).filter(claim =>
    !claim.split('、').every(map => (t.final?.maps ?? []).includes(map)) && !/^\d+-\d+$/.test(claim))
}

function judgeProse(label: string, state: GameState, list: Trophy[]): void {
  const wrong: string[] = []
  const seen = new Map<string, Trophy>()
  for (const t of list) {
    const lines = trophyProse(t)
    const text = lines.join('')
    const say = (why: string) => wrong.push(`${t.year} ${t.name}：${why}`)
    if (!lines.length) say('一句话都没有')

    // the bench, said exactly when it is true, and never otherwise (the line has a few wordings)
    if (/替补席|一场没上/.test(text) !== !t.started) say('替补席说反了')
    if (/MVP/.test(text) && !t.final?.line?.mvp) say('说了 MVP，明细里没有')
    if (/队里评分最高/.test(text) && t.final?.line?.rank !== 1) say('说了队内第一，明细里不是')
    if (/一张图都没让/.test(text) && Number(t.final?.score.split('-')[1]) !== 0) say('说了没丢图，比分里丢了')
    if (/先丢一张图/.test(text) && !t.final?.comeback) say('说了先丢一张图，mapLog 里没有')
    if (/第一座奖杯|生涯第一座/.test(text) && !t.first) say('说了第一座，其实不是')

    // every name in the passage is a name the record holds
    if (t.club && !text.includes(t.club) && !text.includes('你的俱乐部')) say('一句都没提俱乐部')
    if (t.final && /决赛/.test(text)
      && !new RegExp(`(赢下|击败|对|和) ?${t.final.opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) {
      say('说了决赛却没说对手')
    }
    if (t.realChamp && !text.includes(t.realChamp)) say('真实历史的冠军没写进去')
    if (!t.realChamp && /真实历史/.test(text)) say('没有可写的真实历史，却写了')
    // a map named in the passage is a map the record kept
    for (const claim of unsupportedMapClaims(t, text)) say(`括号里的「${claim}」不是明细里的地图`)
    // every figure the passage writes itself is the year, the score or the number of starts — the figures inside a
    // name the save chose (「挑战者赛 2」, 「杯赛 1」) belong to that name, so the names come out first
    let rest = text
    for (const n of [t.name, t.club, t.realChamp, t.final?.opp, t.final?.label, ...(t.final?.maps ?? []), ...t.clubs]) {
      if (n) rest = rest.split(n).join('')
    }
    const allow = new Set<number>([t.year, t.starts, ...(t.final?.score.split('-').map(Number) ?? [])])
    for (const n of numsIn(rest)) if (!allow.has(n)) say(`句子里的数字 ${n} 没有出处`)
    // and a Latin name never touches a Chinese character: 「属于 Acend。」, never 「属于Acend。」
    for (const n of [t.club, t.realChamp, t.final?.opp, t.name]) {
      if (!n) continue
      const q = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (/^[0-9A-Za-z]/.test(n) && new RegExp(`[\\u4e00-\\u9fff]${q}`).test(text)) say(`「${n}」前面少一个空格`)
      if (/[0-9A-Za-z]$/.test(n) && new RegExp(`${q}[\\u4e00-\\u9fff]`).test(text)) say(`「${n}」后面少一个空格`)
    }

    const twin = seen.get(text)
    if (twin) say(`和 ${twin.year} ${twin.name} 的描述一字不差`)
    seen.set(text, t)
    if (dump) {
      console.log(`    [${t.tier}] ${t.year} ${t.name} · ${t.club ?? '?'} · ${t.started ? '首发' : '替补'}`)
      for (const l of lines) console.log(`       ${l}`)
    }
  }
  check(!wrong.length, `${label}：描述只说存档里有的事（${list.length} 段）${wrong.length ? `\n      ${wrong.join('\n      ')}` : ''}`)
  void state
}

/* ------------------------------------------------------------------ */

// two careers with something on the shelf: 2021 as a strong club's substitute in Europe — a 赛区大师赛 and a
// Challengers stage, two of the three started — and 2026 in China, which goes all the way to a 全球冠军赛
const A = play('A 2021 强队替补 EMEA', { seed: 7, year: 2021, region: 'EMEA', start: 't1' })
const at = careerTrophies(A)
judgeShelf('A', A, at)
judgeFacts('A', A, at)
judgeProse('A', A, at)

const B = play('B 2026 强队替补 中国', { seed: 3, year: 2026, region: 'China', start: 't1' })
const bt = careerTrophies(B)
judgeShelf('B', B, bt)
judgeFacts('B', B, bt)
judgeProse('B', B, bt)

// and one stopped the week a trophy landed, while the year's competitions are still on the books and the detail
// still holds the run: the card that carries everything — the final, its maps, my line in it, the runner-up, the city
const C = play('C 刚夺冠那一周 2026 中国', { seed: 3, year: 2026, region: 'China', start: 't1' }, (s) => !!s.me!.titles.length)
const ct = careerTrophies(C)
judgeShelf('C', C, ct)
judgeFacts('C', C, ct)
judgeProse('C', C, ct)
check(ct.some((t) => !!t.final && t.final.maps.length > 0),
  `C：刚夺冠的卡上有决赛和地图（${ct.map((t) => `${t.name}:${t.final ? `${t.final.score}/${t.final.maps.length} 图` : '无'}`).join('、')}）`)
check(ct.every((t) => !t.clubId || !!t.club), 'C：夺冠俱乐部读得出来')

/* ---- names with parentheses are not map claims; genuine claims stay strict ---- */
{
  const source = ct.find(t => !!t.final)!
  const name = '中国 · 晋级赛（2030 访客席位）'
  const t: Trophy = { ...source, comp: name, name, tier: 'league',
    club: '测试队（华东）', realChamp: '历史队（青年）',
    final: { ...source.final!, label: '总决赛（BO5）', opp: '对手（华北）', maps: ['Ascent', 'Bind'] } }
  const lines = trophyProse(t)
  check(lines.join('').includes(name) && unsupportedMapClaims(t, lines.join('')).length === 0,
    '括号回归：实际生成的赛事/队名/轮次括号不误当地图')
  // Put claims in the final's own sentence, not the event title. Neither a
  // real-but-unplayed map nor a wholly invented map may become a passing test.
  const withFinalMaps = (maps: string) => lines.map((line, i) => i === 1 ? `${line}（${maps}）` : line).join('')
  check(unsupportedMapClaims(t, withFinalMaps('Ascent、Bind')).length === 0,
    '括号回归：含赛事括号时，决赛地图段仍接受明细中的地图')
  for (const map of ['Haven', 'InventedMap']) {
    const wrong = unsupportedMapClaims(t, withFinalMaps(`Ascent、${map}`))
    check(wrong.length === 1 && wrong[0] === `Ascent、${map}`,
      `括号回归：决赛地图段中的 ${map} 不在明细，必须失败`)
  }
  const old = { ...t, final: null }
  check(unsupportedMapClaims(old, trophyProse(old).join('')).length === 0
    && unsupportedMapClaims(old, `${trophyProse(old).join('')}（Ascent）`).length === 1,
    '括号回归：没有决赛明细时仍不能编造地图；赛事名称保留')
}

/* ---- a save from before any of the newer records ---- */
{
  const old = JSON.parse(JSON.stringify(A)) as GameState
  const me = old.me!
  // everything written after the case's facts were first kept: the year's detail, the campaigns, the cards,
  // the seasons' ledgers and the running totals. The titles themselves are all such a save ever had.
  me.matches = []
  delete me.intlRuns
  delete me.moments
  delete me.tally
  delete me.quals
  for (const s of me.seasons) { delete s.rewrites; delete s.retitled; delete s.intl; delete s.quals }
  const list = careerTrophies(old)
  const ok = list.length === me.titles.length
    && list.every((t) => t.matches.length === 0 && t.final === null && t.run === null && t.rewrite === null
      && !!t.name && t.tier === trophyTier(t.comp) && trophyProse(t).length > 0)
  check(ok, `老存档（没有明细、没有国际赛记录、没有世界线、没有大事卡）照样每个冠军一张卡：${list.length} 张`)
  judgeShelf('老存档', old, list)
  judgeProse('老存档', old, list)
}

/* ---- a career that never won anything ---- */
{
  const none = JSON.parse(JSON.stringify(B)) as GameState
  const me = none.me!
  me.titles = []
  check(careerTrophies(none).length === 0, '一冠未得：奖杯栏里一张卡都没有')
  const line = trophyNone(me)
  check(!!line && !line.includes('暂无') && line.split('\n').length === 1, `一冠未得：一句话说清「${line}」`)
  me.phase = 'retired'
  check(trophyNone(me) === '没有冠军。', `退役后一冠未得：「${trophyNone(me)}」`)
}

console.log(bad ? `\n${bad} 项不对` : '\n奖杯栏：全部通过')
process.exit(bad ? 1 : 0)
