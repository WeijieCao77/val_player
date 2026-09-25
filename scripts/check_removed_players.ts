/**
 * The people the author took out of the game are nowhere a player can see (decided 2026-09-25:
 * 「把这个选手直接踢出游戏」, KovaQ — src/data/removed_players.json).
 *
 *  - the list: every row well formed, with the seats he held recorded
 *  - the code and data the game ships: no handle and no real name anywhere under src/ but the
 *    list itself and the two changelogs, which say he was taken out
 *  - the raw files (history.json, bios.json, stats_players.json, lp_events.json) and the files the
 *    game reads (timeline.json, circuit.json, world_2021.json, world.json): no id, no handle
 *  - his clubs: every side he played for at a circuit event still has four or more, every opening
 *    roster he was on still has four or more, a league club's still five
 *  - the pool: engine/staffStints.ts offPoolOn keeps him off it on every day
 *  - a new world, opened in 2021 and in 2026 (2021 brought up to it on the book): no id, no handle,
 *    and the clubs he played for in 2026 field five
 *  - a save from before, twice — him at an AI club and him at the player's own — with his handle in
 *    the news, the log, a box score, a trophy's roster, bonds, training, the map sheet: loaded, he is
 *    out of the pool and every record, both clubs field five, the news says nothing, the log one line
 *    that names nobody, and loading again changes nothing
 *
 *   npx tsx scripts/check_removed_players.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { CLUB_FLOOR } from '../src/engine/me/club'
import { migratePlayerSave } from '../src/engine/me/save'
import { cleanHall } from '../src/engine/me/hall'
import { packState, unpackState } from '../src/engine/save'
import { REMOVED_LABEL, REMOVED_PLAYERS, REMOVED_STAMP, removedPlayer } from '../src/engine/removedPlayers'
import { offPool, offPoolOn } from '../src/engine/staffStints'
import type { GameState, Player } from '../src/engine/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const t0 = Date.now()

interface Seat { year: number; event: string; eventName: string; team: string; club: string }
const LIST = JSON.parse(readFileSync('src/data/removed_players.json', 'utf8')) as { players: (typeof REMOVED_PLAYERS[number] & { seats: Seat[] })[] }
const VLR = REMOVED_PLAYERS.map((p) => p.vlr)
const PIDS = VLR.map((v) => `V${v}`)
// his handle, and his real name as bios.json had it: nothing the game shows may carry either
const NAMES = [...REMOVED_PLAYERS.map((p) => p.ign), 'Blendi Kovaci']
const nameRe = new RegExp(NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
const idRe = new RegExp(`"(?:${PIDS.join('|')})"`)
const read = <T>(f: string): T => JSON.parse(readFileSync(`src/data/${f}`, 'utf8')) as T

console.log('名单：removed_players.json')
{
  const ok = LIST.players.filter((p) => /^\d+$/.test(p.vlr) && !!p.ign && !!p.reason && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
    && Array.isArray(p.seats) && p.seats.every((s) => /^\d+$/.test(s.event) && /^\d+$/.test(s.team) && s.year >= 2021))
  check(LIST.players.length > 0 && ok.length === LIST.players.length && REMOVED_PLAYERS.length === LIST.players.length,
    `${LIST.players.length} 人，编号、名字、原因、日期、席位都齐：${LIST.players.map((p) => `${p.ign}（${p.seats.length} 个席位）`).join('、')}`)
  check(REMOVED_PLAYERS.some((p) => p.vlr === '7987' && p.ign === 'KovaQ'), 'KovaQ（vlr 7987）在名单上')
}

console.log('游戏的代码和数据里没有他的名字')
{
  const allowed = new Set(['src/data/removed_players.json', 'src/data/changelog.ts', 'src/data/changelog_me.ts'])
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f).replace(/\\/g, '/')
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx|json|css|html)$/.test(p) || allowed.has(p)) continue
      if (nameRe.test(readFileSync(p, 'utf8'))) hits.push(p)
    }
  }
  walk('src')
  check(!hits.length, `src/ 下除了名单和两份更新日志，没有一个文件出现他的名字或真名${hits.length ? '：' + hits.join('、') : ''}`)
  const idHits = ['world.json', 'world_2021.json', 'dossier.json', 'records.json', 'bridge_2026.json', 'prospects.json']
    .filter((f) => idRe.test(readFileSync(`src/data/${f}`, 'utf8')))
  check(!idHits.length, `2026 世界、2021 世界、档案、纪录、衔接、新秀文件里没有他的选手编号${idHits.length ? '：' + idHits.join('、') : ''}`)
}

console.log('原始数据和名册')
interface CEvent { id: string; name: string; rosters?: Record<string, string[]>; names: Record<string, string> }
interface BookYear { clubs: Record<string, { n: string; l: string | null }>; rosters: Record<string, string[]>; ratings: Record<string, unknown>; debuts: Record<string, unknown> }
const circuit = read<Record<string, CEvent[]>>('circuit.json')
const book = read<{ years: Record<string, BookYear>; last: Record<string, number> }>('timeline.json')
{
  const history = read<Record<string, { teams: { players: { id: string; ign: string }[] }[] }>>('history.json')
  const cards = Object.values(history).flatMap((e) => e.teams.flatMap((t) => t.players)).filter((p) => VLR.includes(p.id) || nameRe.test(p.ign))
  const bios = read<Record<string, unknown>>('bios.json')
  const stats = read<Record<string, unknown>>('stats_players.json')
  const lp = read<Record<string, { teams?: { players?: unknown[] }[] }>>('lp_events.json')
  const lpHits = Object.values(lp).flatMap((e) => e?.teams ?? []).flatMap((t) => (Array.isArray(t.players) ? t.players : [])).filter((n) => typeof n === 'string' && nameRe.test(n))
  check(!cards.length && VLR.every((v) => !bios[v] && !stats[v]) && !lpHits.length,
    'history.json 的队伍名片、bios.json、stats_players.json、lp_events.json 的名单里都没有他')

  const seats = Object.entries(circuit).flatMap(([y, evs]) => evs.flatMap((e) => Object.entries(e.rosters ?? {})
    .filter(([, ids]) => ids.some((x) => VLR.includes(x))).map(([t]) => `${y} ${e.names[t] ?? t}（${e.name}）`)))
  check(!seats.length, `circuit.json 的赛事名单席位里没有他${seats.length ? '：' + seats.join('；') : ''}`)
  const inBook = Object.entries(book.years).flatMap(([y, Y]) => [
    ...VLR.filter((v) => Y.ratings[v]).map(() => `${y} 评分`),
    ...VLR.filter((v) => Y.debuts[v]).map(() => `${y} 新面孔`),
    ...Object.entries(Y.rosters).filter(([, ids]) => ids.some((x) => VLR.includes(x))).map(([t]) => `${y} ${Y.clubs[t]?.n} 开季名单`),
  ])
  check(!inBook.length && VLR.every((v) => book.last[v] === undefined), `timeline.json 里没有他的评分、新面孔、开季名单和最后在役年份${inBook.length ? '：' + inBook.join('；') : ''}`)
  const w21 = read<{ players: { id: string }[] }>('world_2021.json')
  const w26 = read<{ players: { ign: string }[] }>('world.json')
  check(!w21.players.some((p) => PIDS.includes(p.id)) && !w26.players.some((p) => nameRe.test(p.ign)), '2021 和 2026 的世界文件里都没有他')
}

console.log('他打过的队伍')
{
  const byId = new Map(Object.values(circuit).flat().map((e) => [e.id, e]))
  const recorded = LIST.players.flatMap((p) => p.seats)
  const short = recorded.filter((s) => (byId.get(s.event)?.rosters?.[s.team]?.length ?? 0) < 4)
  check(recorded.length > 0 && !short.length,
    `记下的 ${recorded.length} 个赛事席位（${[...new Set(recorded.map((s) => `${s.year} ${s.club}`))].join('、')}），拿掉他以后这些队的名单都还有至少四人${short.length ? '：' + short.map((s) => `${s.club} ${s.eventName}`).join('；') : ''}`)
  const opens: string[] = []
  const thin: string[] = []
  for (const s of recorded) {
    const Y = book.years[String(s.year)]
    const ids = Y?.rosters[s.team]
    if (!ids) continue
    const line = `${s.year} ${Y.clubs[s.team].n} ${ids.length} 人`
    if (!opens.includes(line)) opens.push(line)
    if (ids.length < 4 || (Y.clubs[s.team].l && ids.length < 5)) thin.push(line)
  }
  check(!thin.length, `他在的开季名单：${opens.join('、')}——都至少四人，联赛席位俱乐部至少五人（四人的换季时引擎从自由人补到五人）`)
}

console.log('选手池')
{
  check(VLR.every((v) => offPoolOn(v, '2021-01-01') && offPoolOn(v, '2024-06-01') && offPoolOn(v, '2031-12-31'))
    && PIDS.every((id) => offPool(id, '2026-05-01') && removedPlayer(id)),
  '任何一天都不在选手池里（offPoolOn：签约、自由市场、补人、替补上场都问这一条）')
  check(!removedPlayer('V21T7987') && !offPoolOn('7986', '2026-05-01'), '同号的队伍（No Namers，V21T7987）和别的选手不受影响')
}

const clean = (s: GameState): string[] => {
  const txt = JSON.stringify(s)
  const out: string[] = []
  if (nameRe.test(txt)) out.push(`存档里还有他的名字：…${txt.slice(Math.max(0, txt.search(nameRe) - 60), txt.search(nameRe) + 30)}…`)
  for (const id of PIDS) {
    if (s.players[id]) out.push('他还在选手里')
    for (const t of Object.values(s.teams)) {
      if (t.roster.includes(id) || t.starters.includes(id) || t.igl === id) out.push(`${t.name} 的名单、首发或指挥里还有他`)
    }
    if (Object.keys(s.bonds ?? {}).some((k) => k.split('|').includes(id))) out.push('关系表里还有他')
    if (s.training?.[id] || Object.values(s.mapAgents ?? {}).some((m) => m[id])) out.push('训练或地图特工表里还有他')
    if (s.me?.mates?.[id]) out.push('队友记录里还有他')
  }
  return out
}

console.log('新开的世界')
{
  const s21 = createCareer({ name: 'R21', region: 'Europe', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 5, year: 2021 })
  const bad21 = clean(s21)
  check(!bad21.length && s21.removedSync === REMOVED_STAMP, `2021 年开局：世界里没有他，存档一出生就记上名单版本${bad21.length ? '：' + bad21.join('；') : ''}`)
  const s26 = createCareer({ name: 'R26', region: 'EMEA', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 5, year: 2026 })
  const bad26 = clean(s26)
  check(!bad26.length, `2026 年开局（2021 的名册一路推到 2026）：世界里、自由人里都没有他${bad26.length ? '：' + bad26.join('；') : ''}`)
  for (const [vlr, name] of [['5214', 'CGN Esports'], ['11328', 'FunPlus Phoenix']]) {
    const t = s26.teams[`V21T${vlr}`]
    check(!!t && t.roster.length >= 5 && t.starters.length === 5,
      `2026 年的 ${name}：${t ? `${t.roster.length} 人，${t.roster.map((id) => s26.players[id]?.ign).join('、')}` : '不在世界里'}`)
  }
  const rosters = (s: GameState) => JSON.stringify([Object.keys(s.players).sort(), Object.values(s.teams).map((t) => [t.id, t.roster])])
  const again = migratePlayerSave(unpackState(packState(s26)))
  check(rosters(again) === rosters(s26) && again.news.length === s26.news.length, '新存档读档：一个人都不动，也不多一条新闻')
}

console.log('读档：老存档里的他')
const clone = (from: Player, teamId: string | null): Player => ({
  ...structuredClone(from), id: PIDS[0], ign: 'KovaQ', realName: 'Blendi Kovaci', teamId, isIgl: false, iglSource: undefined,
  clubHist: teamId ? [{ team: teamId, from: 2026, to: 2026 }] : [],
})
/** An old save: him signed to `where`, and his handle in the records a career keeps. */
function oldSave(where: 'ai' | 'mine'): { s: GameState; club: string } {
  const s = createCareer({ name: 'Old', region: 'EMEA', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 9, year: 2026 })
  const me = s.me!
  const mine = s.teams[s.myTeam]
  const target = where === 'mine' ? mine
    : Object.values(s.teams).find((t) => !t.dormant && t.id !== s.myTeam && t.roster.length === 5 && t.roster.every((id) => s.players[id]))!
  // his seat: one of five out to the free agents, him in it
  const out = target.roster.find((id) => id !== me.id && !target.starters.slice(0, 1).includes(id))!
  s.players[out].teamId = null
  target.roster = target.roster.filter((id) => id !== out)
  target.starters = target.starters.filter((id) => id !== out)
  if (where === 'mine') {
    // mine at the floor with him on it, so his seat has to be filled
    while (target.roster.length > CLUB_FLOOR - 1) {
      const x = target.roster.filter((id) => id !== me.id).pop()!
      s.players[x].teamId = null
      target.roster = target.roster.filter((id) => id !== x)
      target.starters = target.starters.filter((id) => id !== x)
    }
  }
  const mate = s.players[target.roster.find((id) => id !== me.id)!]
  const him = clone(mate, target.id)
  s.players[him.id] = him
  target.roster.push(him.id)
  if (target.starters.length < 5) target.starters.push(him.id)
  target.igl = him.id
  // and the records
  s.news.push({ year: 2026, day: s.day, kind: 'transfer', text: `${target.name} 签下 KovaQ。` })
  s.news.push({ year: 2026, day: s.day, kind: 'match', text: `${target.name} 2:0 获胜，kovaq 拿下全场最佳。`, important: true })
  me.log.push({ year: 2026, day: s.day, kind: 'team', text: '和 KovaQ 一起加练了残局。' })
  s.bonds = { ...(s.bonds ?? {}), [[me.id, him.id].sort().join('|')]: 40 }
  s.training = { ...(s.training ?? {}), [him.id]: 'aim' }
  s.mapAgents = { Ascent: { [him.id]: 'Sova', [me.id]: 'Jett' } }
  me.mates = { ...(me.mates ?? {}), [him.id]: { id: him.id, ign: 'KovaQ', role: '先锋', firstYear: 2026, lastYear: 2026, team: target.id, stages: 1, matches: 3, titles: ['VCT 中国联赛第一赛段'], peakBond: 40, roles: {} } }
  s.fixtures.push({
    id: 'old-box', day: s.day - 3, stage: 'stage1', comp: 'x', teamA: target.id, teamB: s.myTeam === target.id ? Object.keys(s.teams)[0] : s.myTeam, bo: 3, label: '第一轮', played: true,
    result: { mapsWonA: 2, mapsWonB: 0, maps: [], vetoLog: ['KovaQ 的队伍禁用 Bind'], mvp: him.id, highlights: ['KovaQ 1v3 残局'] },
  })
  const trophy = { year: 2026, title: '冠军', roster: ['KovaQ', mate.ign] }
  ;(me as unknown as { oldTrophy: unknown }).oldTrophy = trophy
  delete s.removedSync
  return { s, club: target.id }
}
for (const where of ['ai', 'mine'] as const) {
  const { s, club } = oldSave(where)
  const newsBefore = s.news.length
  const logBefore = s.me!.log.length
  const name = s.teams[club].name
  const loaded = migratePlayerSave(unpackState(packState(s)))
  const left = clean(loaded)
  check(!left.length, `${where === 'ai' ? `他在 AI 俱乐部 ${name}` : `他在你的队伍 ${name}`}：读档后选手池、名单、首发、指挥、关系、训练、地图特工、队友记录和所有记录里都没有他${left.length ? '：' + left.join('；') : ''}`)
  const t = loaded.teams[club]
  const floor = where === 'mine' ? CLUB_FLOOR : 5
  check(t.roster.length >= floor && t.starters.length === 5 && t.starters.every((id) => t.roster.includes(id) && !!loaded.players[id]),
    `${name} 补回到 ${t.roster.length} 人，首发五人都在队里：${t.roster.map((id) => loaded.players[id]?.ign).join('、')}`)
  const caller = t.roster.map((id) => loaded.players[id]).find((p) => p?.isIgl)
  check(!!caller, `${name} 有人指挥：${caller?.ign}`)
  const added = loaded.news.length - (newsBefore - 2)
  check(added >= 0 && added <= (where === 'ai' ? 0 : 1),
    `关于他的两条新闻不在了，读档只多了 ${added} 条（${where === 'ai' ? '别人的队伍补人不上新闻' : '本队补人时的签约'}）`)
  const said = loaded.me!.log.filter((l) => l.text.includes('移出'))
  check(loaded.me!.log.length >= logBefore - 1, `日志里提到他的那一行不在了，其余照旧（${logBefore} → ${loaded.me!.log.length} 行）`)
  check(where === 'ai' ? !said.length : said.length === 1 && !nameRe.test(said[0].text),
    where === 'ai' ? '别人的队伍补人：日志里一句都没有' : `日志里一句话说明空出了位置，不提名字：「${said[0]?.text}」`)
  const trophy = (loaded.me as unknown as { oldTrophy: { roster: string[] } }).oldTrophy
  const fx = loaded.fixtures.find((f) => f.id === 'old-box')
  check(trophy.roster[0] === REMOVED_LABEL && fx?.result?.highlights[0].startsWith(REMOVED_LABEL) === true && loaded.me!.log.every((l) => !nameRe.test(l.text)),
    `记录保留原样，名字换成「${REMOVED_LABEL}」：奖杯名单「${trophy.roster.join('、')}」，比赛集锦「${fx?.result?.highlights[0]}」`)
  check(loaded.removedSync === REMOVED_STAMP, '存档记上了名单版本')
  const again = migratePlayerSave(unpackState(packState(loaded)))
  // who is where, what the records say and how long the feeds are; the save's key order is not ours to hold (other load steps reorder it)
  const print = (x: GameState) => JSON.stringify([Object.keys(x.players).sort(), Object.values(x.teams).map((t) => [t.id, t.roster, t.starters]).sort(),
    x.news.length, x.me?.log.length, x.fixtures.find((f) => f.id === 'old-box')?.result?.highlights, (x.me as unknown as { oldTrophy: unknown }).oldTrophy, x.removedSync])
  check(print(again) === print(loaded), '再读一次什么都不变')
}

console.log('殿堂')
{
  const card = { id: 'c1abc', name: 'Old', ending: { key: 'k', title: '冠军' }, clubs: ['FunPlus Phoenix'], rw: { n: 1, top: '和 KovaQ 一起改写了 2026 年的冠军' } }
  const h = cleanHall({ v: 1, ach: {}, hx: {}, looks: {}, cards: [card] })
  check(h.cards.length === 1 && !nameRe.test(JSON.stringify(h)) && h.cards[0].rw?.top?.includes(REMOVED_LABEL) === true,
    `殿堂里留下的生涯卡照常读，字里没有他的名字：「${h.cards[0]?.rw?.top}」`)
}

console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`)
console.log(bad ? `\n${bad} 项没过` : '\n全部通过')
if (bad) process.exit(1)
