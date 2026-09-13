/**
 * Do the ceremonies actually fire, once each, and does skipping cost nothing?
 *
 * The design rule is the thing worth testing: 「跳过 = 银档」. A player who
 * never wants to play a reflex game should end a career in the same place as
 * one who plays them all and does averagely — so the autopilot, which always
 * skips, must never be worse off for it.
 *
 * The five added later (me/nights.ts) are held one by one as well: each has to
 * open where it belongs, close both ways, and leave exactly what its tier says.
 * So is the budget they were added under — four to eight nights in a
 * professional season, every kind counted — and the table the patch night
 * names agents from, against the professional data in the repo.
 *
 *   npx tsx scripts/check_ceremony.ts [seasons=6] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { CEREMONIES, cerClose, cerFinish, cerSkip } from '../src/engine/me/ceremony'
import { SHOWMATCH_FANS, awardsNight, computeAwards, leaguePool, seasonBar, showmatchNight } from '../src/engine/me/nights'
import { ARRIVALS, ARRIVALS_UNTIL, arrivedBy } from '../src/engine/me/releases'
import { AGENT_CN, MAP_CN, agentCn } from '../src/engine/content'
import { retire } from '../src/engine/me/endings'
import { startTryout } from '../src/engine/me/tryout'
import type { GameState } from '../src/engine/types'
import type { CerKind } from '../src/engine/me/types'
import STATS from '../src/data/stats_players.json'

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

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)
const kinds = Object.keys(CEREMONIES) as CerKind[]
let bad = 0
const fail = (why: string) => { bad++; console.log(`✗ ${why}`) }
const open = (s: GameState) => !!s.me!.cer || s.me!.pending.some((x) => x.kind === 'ceremony')
const snap = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState

const state = createCareer({
  // 2026 opens on the real 2026, whose Chinese second-tier clubs play their first event in the summer:
  // a Challengers start is a European club's
  name: 'Probe', region: 'Europe', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
})
const me = state.me!
const year0 = state.year
// copies taken on the way, for the nights that need a moment the run only passes once
// Count from the log, not from `cerSeen`: the seen-list is capped so a long
// career does not carry every key forever, and counting a capped list quietly
// under-reports. The log is what the player actually saw — but it keeps its
// last 400 lines too, so it is read a week at a time, as it is written.
const kindOf = (text: string): CerKind | null => kinds.find((k) => text.includes(CEREMONIES[k].name)) ?? null
const lines: { year: number; kind: CerKind }[] = []
let judged = 0
let lastLine: (typeof me.log)[number] | undefined
const readLog = () => {
  const from = lastLine ? me.log.lastIndexOf(lastLine) + 1 : 0
  for (const l of me.log.slice(from)) {
    if (l.text.startsWith('年度奖项')) judged++
    const k = kindOf(l.text)
    if (k) lines.push({ year: l.year, kind: k })
  }
  lastLine = me.log[me.log.length - 1] ?? lastLine
}

let atChampions: GameState | null = null
let atOffseason: GameState | null = null
let guard = 0
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  const stop = autoWeek(state)
  readLog()
  if (stop.kind === 'game-over') break
  if (me.phase === 'pro' && !atChampions && state.stage === 'champions') atChampions = snap(state)
  if (me.phase === 'pro' && !atOffseason && state.stage === 'offseason') atOffseason = snap(state)
}

// let whatever is on screen finish, the way a player would before stopping
for (let i = 0; i < 4 && (me.cer || me.pending.length); i++) { autoWeek(state); readLog() }

const byKind: Record<string, number> = {}
const proYears = new Set(me.seasons.filter((s) => s.tier > 0).map((s) => s.year))
const perYear = new Map<number, number>()
for (const l of lines) {
  byKind[l.kind] = (byKind[l.kind] ?? 0) + 1
  if (proYears.has(l.year)) perYear.set(l.year, (perYear.get(l.year) ?? 0) + 1)
}
console.log(`${year0}–${state.year}，${me.seasons.length} 季，seed ${seed}\n`)
console.log('仪式触发次数（自动托管全部走银档）')
for (const k of kinds) console.log(`  ${CEREMONIES[k].name.padEnd(6)} ${String(byKind[k] ?? 0).padStart(3)}`)
const counts = [...proYears].sort().map((y) => perYear.get(y) ?? 0)
const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0
console.log(`\n职业赛季每季仪式数：${[...proYears].sort().map((y, i) => `${y} ${counts[i]}`).join(' · ') || '（没打过职业）'}，平均 ${avg.toFixed(1)}`)

// nothing may be left half-open
const stuck = open(state)
// skipping is silver, so none of the tier-scoped effects may be set
const effects = [me.cerRest ? '出征的休整修正' : '', me.cerMatch ? '决赛入场的场上修正' : ''].filter(Boolean)
console.log(`\n卡住的仪式：${stuck ? '有' : '无'}`)
console.log(`跳过后残留的档位效果：${effects.length ? effects.join('、') : '无'}`)
if (stuck) fail('有仪式没有关掉，时钟会停在那里。')
if (effects.length) fail('跳过应该等于银档，不该留下任何修正。')
if (!Object.keys(byKind).length) fail('一个仪式都没触发。')

// the budget: a media day comes before matches now, so it is counted over seasons that had them
const playing = me.seasons.filter((s) => s.tier > 0 && s.matches >= 10).length
if ((byKind.media ?? 0) < playing * 2) fail(`媒体日只触发了 ${byKind.media ?? 0} 次；打满比赛的职业赛季有 ${playing} 个，每季至少该有两次。`)
if (counts.length && (Math.max(...counts) > 10 || avg > 8.5)) fail(`职业赛季的仪式太密：最多 ${Math.max(...counts)}，平均 ${avg.toFixed(1)}（设计 4–8）。`)
if ((byKind.patch ?? 0) < seasons) fail(`版本发布会 ${seasons} 年只开了 ${byKind.patch ?? 0} 次，应该一年一次。`)
if (!judged) fail('休赛期没有评年度奖项。')

// a name inside another name would count one night as two
for (const a of kinds) {
  for (const b of kinds) {
    if (a !== b && CEREMONIES[b].name.includes(CEREMONIES[a].name)) fail(`仪式名「${CEREMONIES[a].name}」是「${CEREMONIES[b].name}」的一部分，日志计数会串。`)
  }
}

/* ------------------------------------------------------------------ */
/*  the release table, against the professional data                   */
/* ------------------------------------------------------------------ */

const rows = Object.values(STATS as unknown as Record<string, { year: number; agents?: string[] }[]>).flat()
const dataFrom = Math.min(...rows.map((r) => r.year))
const firstSeen = new Map<string, number>()
for (const r of rows) for (const a of r.agents ?? []) firstSeen.set(a, Math.min(firstSeen.get(a) ?? 9999, r.year))
let prev = 0
for (const a of ARRIVALS) {
  const at = a.year * 400 + a.day
  if (at < prev) fail(`上线表没按时间排：${a.name}`)
  prev = at
  if (a.year > ARRIVALS_UNTIL) fail(`上线表写到了 ${ARRIVALS_UNTIL} 年以后：${a.name}`)
  if (a.kind === 'map') { if (!MAP_CN[a.name]) fail(`地图 ${a.name} 没有官方中文名`); continue }
  if (!AGENT_CN[a.name]) fail(`特工 ${a.name} 没有官方中文名`)
  const seen = firstSeen.get(a.name.toLowerCase().replace(/[^a-z]/g, ''))
  if (a.year >= dataFrom && (seen === undefined || seen < a.year || seen > a.year + 1)) {
    fail(`特工 ${a.name} 定在 ${a.year} 年上线，职业数据里第一次出现是 ${seen ?? '从没出现'}。`)
  }
}

/* ------------------------------------------------------------------ */
/*  the five, one at a time                                            */
/* ------------------------------------------------------------------ */

const results: string[] = []

// 年度颁奖夜: a line that tops the league opens the night, the trophy is on the books, gold pays
if (!atOffseason) fail('主档没有在职业身份下走到休赛期，颁奖夜没测到。')
else {
  const s = atOffseason
  const m = s.me!
  if (m.cer) cerSkip(s)
  m.pending = []
  m.cerSeen = (m.cerSeen ?? []).filter((k) => !k.startsWith('awards:'))
  m.awards = (m.awards ?? []).filter((a) => a.year !== s.year)
  const p = s.players[m.id]
  // the best line in the league by a distance, on an ordinary starter's maps: the league's median starter's.
  // The bar is a share of that (me/nights.ts seasonBar). It used to be 40% of the busiest man's, who had
  // played every qualifier and cup too, and a Challengers EMEA starter on a normal season was never judged.
  const pool = leaguePool(s, s.teams[s.myTeam])
  const others = pool.flatMap((t) => t.starters).filter((id) => id !== m.id)
    .map((id) => s.players[id]?.season.maps ?? 0).filter((x) => x > 0).sort((a, b) => a - b)
  const maps = Math.max(6, others[Math.floor(others.length / 2)] ?? 0)
  const busiest = Math.max(0, ...pool.flatMap((t) => t.roster).map((id) => s.players[id]?.season.maps ?? 0))
  const rounds = maps * 24
  p.season = { ...p.season, maps, rounds, kills: rounds, deaths: Math.round(rounds * 0.45), assists: Math.round(rounds * 0.3), damage: rounds * 180 }
  const bar = seasonBar(s, pool)
  const aw = computeAwards(s)
  if (!aw) fail(`首发中位数的出场（${maps} 张图）、全联赛最好的数据，却算不出颁奖名单（门槛 ${bar ?? '—'}，联赛出场最多 ${busiest} 张）。`)
  else if (aw.cats.some((c) => c.top.length !== 3)) fail('有奖项不是三个人入围。')
  m.mental = 50
  const opened = awardsNight(s)
  if (!opened || m.cer?.kind !== 'awards') fail(`数据全联赛第一、出场是首发中位数（${maps} 张图），却没开颁奖夜（门槛 ${bar ?? '—'}，联赛出场最多 ${busiest} 张）。`)
  if (!(m.awards ?? []).some((a) => a.year === s.year && a.key === 'mvp' && a.won)) fail('年度最佳选手没记进存档。')
  const heat = m.heat
  cerFinish(s, 'gold', { ms: 4200, stumbles: 0 })
  cerClose(s)
  if (open(s)) fail('颁奖夜没关掉。')
  // heat is a float that has been through a career: +12 is +12 to within rounding
  if (Math.abs(m.heat - heat - 12) > 1e-9 || m.mental !== 52) fail(`颁奖夜金档应热度 +12、心态 +2，实际热度 +${m.heat - heat}、心态 ${m.mental}。`)
  results.push(`颁奖夜 ${aw?.league}：${aw?.cats.map((c) => c.name).join('、')}（${maps} 张图参评，门槛 ${bar}，联赛出场最多 ${busiest} 张）`)
}

// 表演赛之夜: Champions weekend, enough of a name, a club that is not there; walked past is 银档
if (!atChampions) fail('主档没有在职业身份下走到冠军赛，表演赛没测到。')
else {
  const s = atChampions
  const m = s.me!
  if (m.cer) cerSkip(s)
  m.pending = []
  m.cerSeen = (m.cerSeen ?? []).filter((k) => !k.startsWith('showmatch:'))
  const comp = Object.values(s.comps).find((c) => c.stage === 'champions' && !c.champion)
  if (!comp) fail('冠军赛期间找不到还没打完的冠军赛。')
  else {
    comp.teams = comp.teams.filter((id) => id !== s.myTeam)
    m.fans = SHOWMATCH_FANS - 1
    if (showmatchNight(s)) fail('粉丝不够也开了表演赛。')
    m.fans = SHOWMATCH_FANS
    const heat = m.heat
    if (!showmatchNight(s) || m.cer?.kind !== 'showmatch') fail('粉丝够、队伍没进冠军赛，却没开表演赛。')
    cerSkip(s)
    if (open(s)) fail('表演赛没关掉。')
    // heat is a float that has been through a career: +8 is +8 to within rounding
    if (Math.abs(m.heat - heat - 8) > 1e-9 || m.fans !== SHOWMATCH_FANS) fail(`跳过表演赛应是银档：热度 +8、粉丝不变，实际热度 +${m.heat - heat}、粉丝 ${m.fans}。`)
    results.push(`表演赛：${comp.name} ${comp.city ?? '（没有城市）'}`)
  }
}

// 版本发布会 and 试训第一天, on a 2021 career: the January patch names only what was out by then
{
  const s = createCareer({
    name: 'Probe', region: 'China', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed, year: 2021,
  })
  const m = s.me!
  for (let i = 0; i < 6 && m.cer?.kind !== 'patch'; i++) autoWeek(s)
  if (m.cer?.kind !== 'patch') fail('2021 年一月没有版本发布会。')
  else {
    const story = CEREMONIES.patch.story(s, m.cer.about ?? '')
    for (const a of ['Yoru', 'Killjoy', 'Skye']) if (!story.includes(agentCn(a))) fail(`2021 年一月的版本发布会没提到${agentCn(a)}。`)
    for (const a of ['Astra', 'KAY/O', 'Chamber']) if (story.includes(agentCn(a))) fail(`2021 年一月的版本发布会提前说出了${agentCn(a)}。`)
    const p = s.players[m.id]
    const pool = [...p.agentPool]
    const util = p.xp.utility ?? 0
    cerFinish(s, 'silver', { pick: 'adapt' })
    cerClose(s)
    if (open(s)) fail('版本发布会没关掉。')
    if ((p.xp.utility ?? 0) !== Math.min(util + 25, 199)) fail('「跟版本走」没有加道具的训练进度。')
    const added = p.agentPool.filter((a) => !pool.includes(a))
    if (added.some((a) => !arrivedBy(a, s.year, s.day))) fail(`「跟版本走」把还没上线的特工放进了池子：${added.join('、')}`)
    results.push(`发布会 2021：${story.split('\n').slice(1, 3).join(' ')}${added.length ? ` → 池子加了${added.map(agentCn).join('、')}` : ''}`)
  }

  m.cer = undefined
  m.pending = []
  const others = Object.values(s.teams).filter((t) => t.id !== s.myTeam && !t.dormant)
  const invite = (id: string, teamId: string) => m.pre.invites.push({ id, teamId, via: 'scout', day: s.day, expires: s.day + 14, direct: false })
  invite('probe-a', others[0].id)
  startTryout(s, 'probe-a')
  const ci = m.pending.findIndex((x) => x.kind === 'ceremony')
  const ti = m.pending.findIndex((x) => x.kind === 'tryout')
  if (m.cer?.kind !== 'tryout' || ci < 0 || ti < 0 || ci > ti) fail('试训第一天没有排在四天试训前面。')
  cerFinish(s, 'gold', { ms: 380, hits: 6 })
  cerClose(s)
  if (m.tryout?.score !== 1.5) fail(`试训第一天金档应让评估分 +1.5，实际 ${m.tryout?.score}。`)
  m.tryout = undefined
  m.pending = []
  invite('probe-b', others[1].id)
  startTryout(s, 'probe-b')
  if (m.cer?.kind !== 'tryout') fail('第二家的试训第一天没开。')
  cerSkip(s)
  if (m.tryout?.score !== 0) fail('跳过试训第一天不该动评估分。')
  if (open(s)) fail('试训第一天没关掉。')
  results.push('试训第一天：金档 +1.5，跳过 0')
}

// 退役仪式: before the card, told from the save, closed onto the card
{
  if (me.cer) cerSkip(state)
  me.pending = []
  const clubs = [...new Set(me.seasons.filter((x) => x.tier > 0).map((x) => x.team))]
  if (!clubs.length) fail('主档一个职业赛季都没打，退役仪式没测到。')
  else {
    retire(state, '探针让你退役')
    const ci = me.pending.findIndex((x) => x.kind === 'ceremony')
    const ei = me.pending.findIndex((x) => x.kind === 'ending')
    if (me.cer?.kind !== 'retire' || ci < 0 || ei < 0 || ci > ei) fail('退役仪式没有排在生涯名片前面。')
    const story = CEREMONIES.retire.story(state, me.cer?.about ?? '')
    if (!story.includes('个职业赛季')) fail('退役仪式没有生涯回顾。')
    for (const c of clubs) if (!story.includes(c)) fail(`退役回顾里漏了 ${c}。`)
    cerFinish(state, 'gold', { pick: 'bow' })
    cerClose(state)
    if (open(state)) fail('退役仪式没关掉。')
    if (!me.pending.some((x) => x.kind === 'ending')) fail('退役仪式关掉后，生涯名片不见了。')
    if (!me.log[me.log.length - 1]?.text.includes('退役仪式')) fail('退役仪式没写进日志。')
    results.push(`退役仪式：${story.split('\n')[0]}`)
  }
}

console.log('\n逐个检查')
for (const r of results) console.log(`  ${r}`)

console.log(bad
  ? `\n✗ ${bad} 项不对。`
  : `\n✓ ${kinds.length} 种仪式都能触发、都能关闭，跳过不留代价；职业赛季平均每季 ${avg.toFixed(1)} 个。`)
if (bad) process.exit(1)
