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
  TROPHY_RANK, careerTrophies, stampTitleClubs, trophyNone, trophyOrder, trophyPart, trophyProse, trophyTier,
} from '../src/engine/me/trophies'
import { syncTitles } from '../src/engine/me/week'
import { joinClub, makeDeal } from '../src/engine/me/contract'
import { Rng } from '../src/engine/rng'
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

/**
 * The clubs of a year, as the club history can hold them: a line covering it, or the line left during it — a club's
 * line is only carried to a year at the year's end (engine/season.ts), so one left in the year ends the year before.
 * Written out here on its own rather than imported, so the check does not grade the code with the code.
 */
function yearClubsOf(p: GameState['players'][string], year: number): string[] {
  const hist = p.clubHist ?? []
  return hist.filter((h, i) => (h.from <= year && year <= h.to) || (h.to === year - 1 && hist.slice(i + 1).some((n) => n.from === year))).map((h) => h.team)
}

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
    // the name is the one the title wrote down the day it was won, else the club's name today
    if (t.clubId && t.club !== (title.teamId === t.clubId && title.team ? title.team : state.teams[t.clubId]?.name)) say(t, '俱乐部名字和 id 不是同一家')
    if (t.clubId) {
      const comp = t.year === state.year ? Object.values(state.comps).find((c) => c.name === t.comp && c.champion === t.clubId) : undefined
      if (!comp && title.teamId !== t.clubId && !yearClubsOf(p, t.year).includes(t.clubId)) say(t, '这一年我不在这家俱乐部')
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
    for (const c of t.clubs) if (!yearClubsOf(p, t.year).some((id) => state.teams[id]?.name === c)) say(t, `「${c}」不是这一年待过的俱乐部`)
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

/** Match the exact recorded opponent after a result verb. The comeback
 * production template says 拿下, not 击败; a bare name elsewhere is not enough. */
function mentionsFinalOpponent(t: Trophy, text: string): boolean {
  if (!t.final?.opp) return false
  const quoted = t.final.opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(赢下|击败|拿下|对|和) ?${quoted}`).test(text)
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
      && !mentionsFinalOpponent(t, text)) {
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

/* ---- actual final wording; missing and wrong opponents still fail ---- */
{
  const source = ct.find(t => !!t.final)!
  for (const [score, comeback] of [['3-1', true], ['3-0', false], ['3-1', false]] as const) {
    const t: Trophy = { ...source, final: { ...source.final!, score, comeback } }
    const text = trophyProse(t).join('')
    check(mentionsFinalOpponent(t, text),
      `对手措辞回归：${comeback ? '先丢图逆转' : score === '3-0' ? '横扫' : '普通胜场'}真实模板说出记录对手`)
    check(!mentionsFinalOpponent(t, text.split(t.final!.opp).join('')),
      '对手措辞回归：删除真实对手名字仍必须失败')
    check(!mentionsFinalOpponent(t, text.split(t.final!.opp).join('不存在的队伍')),
      '对手措辞回归：替换成错误对手仍必须失败')
  }
  const escaped: Trophy = { ...source, final: { ...source.final!, opp: 'A+B (CN)' } }
  check(mentionsFinalOpponent(escaped, '总决赛 3-1 拿下 A+B (CN)。')
    && !mentionsFinalOpponent(escaped, '总决赛 3-1 拿下 AAB CN。'),
    '对手措辞回归：正则特殊字符按记录名字字面匹配')
  check(!mentionsFinalOpponent(source, `决赛发挥很好，${source.final!.opp} 也在现场。`),
    '对手措辞回归：只提到队名却没写对阵，不算说了决赛对手')
}

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
  for (const t of me.titles) { delete t.teamId; delete t.team }
  const list = careerTrophies(old)
  const ok = list.length === me.titles.length
    && list.every((t) => t.matches.length === 0 && t.final === null && t.run === null && t.rewrite === null
      && !!t.name && t.tier === trophyTier(t.comp) && trophyProse(t).length > 0)
  check(ok, `老存档（没有明细、没有国际赛记录、没有世界线、没有大事卡）照样每个冠军一张卡：${list.length} 张`)
  judgeShelf('老存档', old, list)
  judgeProse('老存档', old, list)
}

/* ---- a trophy keeps the club it was lifted with (reported 2026-09-24, 85f2b9e4) ---- */
// 「2024年我在nrg夺冠，2025年我转会到g2夺冠后，成就界面会显示我2024年的冠军是在g2拿的」: a club's line in the club
// history is carried to a year at that year's end, so the club left that winter still ended the year before, and the
// only club of 2024 the history held was G2.
{
  const s = JSON.parse(JSON.stringify(B)) as GameState
  const me = s.me!
  const p = s.players[me.id]
  const [nrg, g2] = Object.values(s.teams).filter((t) => t.id !== me.id && t.roster.length >= 5 && t.id !== s.myTeam).slice(0, 2)
  const Y = s.year - 2
  p.clubHist = [{ team: nrg.id, from: Y - 1, to: Y - 1 }, { team: g2.id, from: Y, to: Y + 1 }]
  me.titles = [{ year: Y, title: '测试 · 第二赛段', started: true }, { year: Y + 1, title: '测试 · 第一赛段', started: true }]
  me.moments = []
  me.seasons = me.seasons.filter((x) => x.year !== Y)
  me.seasons.push({ ...(B.me!.seasons[0] ?? {}), year: Y, team: g2.name, titles: ['测试 · 第二赛段'] } as never)
  // the men who lifted it with me: they stayed, and their lines ran through the year
  for (const id of nrg.roster.slice(0, 4)) {
    const q = s.players[id]
    q.titles = [...(q.titles ?? []), { year: Y, title: '测试 · 第二赛段' }]
    q.clubHist = [{ team: nrg.id, from: Y - 1, to: Y + 1 }]
  }
  const find = (st: GameState, y: number) => careerTrophies(st).find((t) => t.year === y)!
  check(find(s, Y).club === nrg.name && find(s, Y).clubId === nrg.id,
    `转会前的冠军：${Y} 年的奖杯记在 ${nrg.name}，不是后来的 ${g2.name}（现在：${find(s, Y).club ?? '说不清'}）`)
  check(find(s, Y + 1).club === g2.name, `转会后的冠军：${Y + 1} 年的奖杯记在 ${g2.name}`)
  check(find(s, Y).clubs.includes(nrg.name) && find(s, Y).clubs.includes(g2.name), `${Y} 年待过的俱乐部两家都算：${find(s, Y).clubs.join('、')}`)
  // an old save gets the club written onto the title once, where it can be told
  stampTitleClubs(s)
  check(me.titles[0].teamId === nrg.id && me.titles[1].teamId === g2.id, '老存档：读档时把夺冠俱乐部补写进冠军记录')
  // and a club renamed since keeps the name it had that day, once the title wrote it down
  me.titles[0].team = nrg.name
  const was = nrg.name
  s.teams[nrg.id].name = '改名以后'
  check(find(s, Y).club === was, `俱乐部后来改了名，奖杯上还是当时的名字「${was}」`)
  s.teams[nrg.id].name = was
  // nobody to ask and two clubs in the year: it says it cannot tell, never the later club
  const u = JSON.parse(JSON.stringify(s)) as GameState
  for (const t of u.me!.titles) { delete t.teamId; delete t.team }
  for (const id of nrg.roster.slice(0, 4)) u.players[id].titles = []
  check(find(u, Y).club === null, `问不到队友、那一年又待过两家：说不清是哪家，不硬写成 ${g2.name}`)
}
{
  // the move itself carries the club I leave through the year I played in it (me/contract.ts joinClub)
  const s = JSON.parse(JSON.stringify(C)) as GameState
  const me = s.me!
  const p = s.players[me.id]
  const from = s.myTeam
  const to = Object.values(s.teams).find((t) => t.id !== from && !t.dormant && t.tier === s.teams[from].tier)!
  p.clubHist = [{ team: from, from: s.year - 1, to: s.year - 1 }]
  const deal = makeDeal(s, to.id, 'transfer', 'B', new Rng(1))
  const why = joinClub(s, deal, { quiet: true })
  check(!why && me.seasonStart.matches > 0 && yearClubsOf(p, s.year).includes(from) && p.clubHist.find((h) => h.team === from)!.to === s.year,
    `年中转会：离开的 ${s.teams[from].name} 在履历里算到 ${s.year} 年（${JSON.stringify(p.clubHist)}${why ? `，${why}` : ''}）`)
}
{
  // the day it is won, syncTitles writes the club and its name down (me/week.ts)
  const s = JSON.parse(JSON.stringify(C)) as GameState
  const me = s.me!
  const got = me.titles[me.titles.length - 1]
  me.titles = me.titles.filter((t) => t !== got)
  syncTitles(s)
  const t = me.titles.find((x) => x.year === got.year && x.title === got.title)!
  const comp = Object.values(s.comps).find((c) => c.name === got.title && !!c.champion)
  check(!!t.teamId && t.teamId === comp?.champion && t.team === s.teams[t.teamId]?.name,
    `夺冠当天记下俱乐部：${t.team ?? '没记'}（冠军是 ${comp ? s.teams[comp.champion!]?.name : '?'}）`)
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
