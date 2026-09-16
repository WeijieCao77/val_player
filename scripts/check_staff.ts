/**
 * Nobody on a club's staff plays as one of its five (reported 2026-09-14: Muggle,
 * EDward Gaming's coach since 2022, played matches in the game as one of EDG's five).
 *
 *  - the data: every stint in src/data/staff_stints.json is well formed and cites its vlr page
 *  - the book: nobody holds a seat at an event of circuit.json, or on an opening roster of
 *    timeline.json, on a day inside one of his staff stints; nobody is rated for a year he only
 *    stood in; January 2021's world holds nobody it had only for a staff stint
 *  - Muggle is nobody's player anywhere
 *  - enough players: every club-year opens with four or more, a league club with five or more,
 *    and a side that lost a stand-in coach off its team card still has four
 *  - a save from before: a staff person on an AI club and one on the player's own club leave the
 *    player pool quietly, both clubs fill the seat, a real player of that year stays, loading
 *    again changes nothing — and the day decides: Reita is Murash Gaming's player in 2024 and
 *    their coach in 2026
 *
 *   npx tsx scripts/check_staff.ts
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { CLUB_FLOOR } from '../src/engine/me/club'
import { migratePlayerSave } from '../src/engine/me/save'
import { migrateStaff } from '../src/engine/me/staffMigrate'
import { packState, unpackState } from '../src/engine/save'
import { STAFF_STAMP, STAFF_STINTS, dateOf, staffPeople, staffStintOn } from '../src/engine/staffStints'
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

interface CEvent { id: string; name: string; start: number | null; region: string | null; stage: string | null; names: Record<string, string>; rosters?: Record<string, string[]> }
interface BookYear { clubs: Record<string, { n: string; d: number; l: string | null }>; rosters: Record<string, string[]>; ratings: Record<string, unknown>; debuts: Record<string, unknown> }
const read = <T>(f: string): T => JSON.parse(readFileSync(`src/data/${f}`, 'utf8')) as T
const circuit = read<Record<string, CEvent[]>>('circuit.json')
const book = read<{ years: Record<string, BookYear>; last: Record<string, number> }>('timeline.json')
const w21 = read<{ players: { id: string; ign: string; teamId: string | null }[] }>('world_2021.json')
const history = read<Record<string, { year: number; dates?: string | null; teams: { id: string; players: { id: string }[] }[] }>>('history.json')
const ignOf = new Map(STAFF_STINTS.map((s) => [s.vlr, s.ign]))

console.log('数据：staff_stints.json')
{
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/
  const ok = STAFF_STINTS.filter((s) => /^\d+$/.test(s.vlr) && !!s.ign && !!s.club && !!s.role
    && (s.from === null || ym.test(s.from)) && (s.to === null || ym.test(s.to)) && (!!s.from || !!s.to)
    && (!s.from || !s.to || s.from <= s.to)
    && s.source === `https://www.vlr.gg/player/${s.vlr}` && /^\d{4}-\d{2}-\d{2}$/.test(s.checked))
  check(STAFF_STINTS.length > 0 && ok.length === STAFF_STINTS.length,
    `${STAFF_STINTS.length} 段任期、${staffPeople().length} 人，日期格式都对，都注明了 vlr 页面和查证日期`)
  check(!!staffStintOn('29401', '2025-02-08'), 'Muggle 2025 年 2 月（中国进化系列赛第一幕）在 EDward Gaming 教练组任期内')
}

console.log('名册：任期内不占选手席位')
const seatYears = new Map<string, Set<string>>()
{
  let seats = 0
  const inside: string[] = []
  for (const [y, evs] of Object.entries(circuit)) {
    for (const e of evs) {
      if (e.start == null) continue
      const date = dateOf(Number(y), e.start)
      for (const [club, ids] of Object.entries(e.rosters ?? {})) {
        for (const pid of ids) {
          seats++
          seatYears.set(pid, (seatYears.get(pid) ?? new Set()).add(y))
          const s = staffStintOn(pid, date)
          if (s) inside.push(`${s.ign} ${date} ${e.names[club] ?? club}（${e.name}）`)
        }
      }
    }
  }
  check(!inside.length, `circuit.json 的 ${seats} 个赛事名单席位里没有人在自己的教练组任期内${inside.length ? '：' + inside.slice(0, 5).join('；') : ''}`)

  let opening = 0
  const inOpen: string[] = []
  for (const [y, Y] of Object.entries(book.years)) {
    for (const [club, ids] of Object.entries(Y.rosters)) {
      const date = dateOf(Number(y), Y.clubs[club].d)
      for (const pid of ids) {
        opening++
        const s = staffStintOn(pid, date)
        if (s) inOpen.push(`${s.ign} ${y} ${Y.clubs[club].n}`)
      }
    }
  }
  check(!inOpen.length, `timeline.json 各年开季名单的 ${opening} 个席位里没有人在教练组任期内${inOpen.length ? '：' + inOpen.slice(0, 5).join('；') : ''}`)

  const ratedAsStaff = staffPeople().flatMap((pid) => Object.entries(book.years)
    .filter(([y, Y]) => Y.ratings[pid] && !seatYears.get(pid)?.has(y)).map(([y]) => `${ignOf.get(pid)} ${y}`))
  check(!ratedAsStaff.length, `有教练组任期的 ${staffPeople().length} 人只在有选手席位的年份有评分${ratedAsStaff.length ? '：' + ratedAsStaff.join('；') : ''}`)

  // January 2021's world: a person with a stint is there only for a card before the cut-off from outside it
  const MONTH: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
  const cardDates = new Map<string, string[]>()
  for (const e of Object.values(history)) {
    const m = /([A-Z][a-z]{2})\s+(\d+)/.exec(e.dates ?? '')
    const yy = /(20\d\d)/.exec(e.dates ?? '')
    if (e.year !== 2021 || !m || !yy || !MONTH[m[1]]) continue
    const date = `${yy[1]}-${String(MONTH[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`
    for (const t of e.teams) for (const p of t.players) cardDates.set(p.id, [...(cardDates.get(p.id) ?? []), date])
  }
  const staffIds = new Set(staffPeople())
  const heldForStaff = w21.players.filter((p) => staffIds.has(p.id.slice(1)))
    .filter((p) => !(cardDates.get(p.id.slice(1)) ?? []).some((d) => d <= '2021-06-30' && !staffStintOn(p.id.slice(1), d)))
  check(!heldForStaff.length, `2021 年 1 月的世界里 ${w21.players.filter((p) => staffIds.has(p.id.slice(1))).length} 名有任期的人，开季前都以选手身份上过场${heldForStaff.length ? '：' + heldForStaff.map((p) => p.ign).join('、') : ''}`)
  check(!w21.players.some((p) => p.id === 'V7456' || p.id === 'V3477'), '2021 世界不再有 Zeus（X10 Esports 教练）和 Evo（Kingsmen 主教练）')
}

console.log('Muggle')
{
  const M = '29401'
  const seats = Object.values(circuit).flat().filter((e) => Object.values(e.rosters ?? {}).some((ids) => ids.includes(M))).length
  const inBook = Object.values(book.years).some((Y) => Y.ratings[M] || Y.debuts[M] || Object.values(Y.rosters).some((ids) => ids.includes(M)))
  check(!seats && !inBook && book.last[M] === undefined && !w21.players.some((p) => p.id === `V${M}`),
    'Muggle 不在任何赛事名单、开季名单、评分、新面孔、最后在役年份，也不在 2021 的世界里')
}

console.log('人数够不够')
{
  const four: string[] = []
  const short: string[] = []
  const leagueShort: string[] = []
  for (const [y, Y] of Object.entries(book.years)) {
    for (const [club, ids] of Object.entries(Y.rosters)) {
      if (ids.length < 4) short.push(`${y} ${Y.clubs[club].n} ${ids.length} 人`)
      else if (ids.length === 4) four.push(`${y} ${Y.clubs[club].n}`)
      if (Y.clubs[club].l && ids.length < 5) leagueShort.push(`${y} ${Y.clubs[club].n} ${ids.length} 人`)
    }
  }
  check(!short.length, `每个俱乐部每年的开季名单至少四人${short.length ? '：' + short.slice(0, 6).join('；') : ''}`)
  check(four.length <= 8, `开季名单只有四人的 ${four.length} 家，都是替补上场的教练被拿掉：${four.join('、')}（读档和换季时引擎从自由人补到五人）`)
  check(!leagueShort.length, `联赛席位俱乐部的开季名单都至少五人${leagueShort.length ? '：' + leagueShort.join('；') : ''}`)
  const lost: string[] = []
  let sides = 0
  for (const [y, evs] of Object.entries(circuit)) {
    for (const e of evs) {
      if (e.start == null) continue
      const date = dateOf(Number(y), e.start)
      for (const t of history[e.id]?.teams ?? []) {
        if (!t.players.some((p) => staffStintOn(p.id, date))) continue
        sides++
        const n = e.rosters?.[t.id]?.length ?? 0
        if (n < 4) lost.push(`${e.names[t.id] ?? t.id} ${n} 人（${e.name}）`)
      }
    }
  }
  check(sides > 0 && !lost.length, `队伍名片上有教练替补的 ${sides} 支参赛队，拿掉教练后都还有至少四人${lost.length ? '：' + lost.join('；') : ''}`)
}

console.log('读档：老存档里的教练组成员')
{
  const print = (s: GameState) => JSON.stringify([Object.keys(s.players).sort(), Object.values(s.teams).map((t) => [t.id, t.roster, t.starters]), s.news.length, s.me?.log.length])
  const clone = (from: Player, id: string, ign: string, teamId: string): Player =>
    ({ ...structuredClone(from), id, ign, teamId, isIgl: false, iglSource: undefined, clubHist: [{ team: teamId, from: 2021, to: 2021 }] })

  const s0 = createCareer({ name: 'Old', region: 'Europe', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7, year: 2021 })
  const myClub = s0.myTeam
  check(s0.me?.phase === 'pro' && !!s0.teams[myClub], `开局在俱乐部：${s0.teams[myClub]?.name}`)
  const mine = s0.teams[myClub]
  const ai = Object.values(s0.teams).find((t) => !t.dormant && t.id !== myClub && t.id.startsWith('V21T') && t.roster.length === 5
    && t.roster.every((id) => s0.players[id]))!
  // the old book's world: one of the AI club's five a free agent and Muggle in his seat, Stunner on the books at mine
  const freed = s0.players[ai.roster[4]]
  freed.teamId = null
  ai.roster = ai.roster.slice(0, 4)
  const mug = clone(s0.players[ai.roster[0]], 'V29401', 'Muggle', ai.id)
  s0.players[mug.id] = mug
  ai.roster.push(mug.id)
  ai.starters = [...ai.roster]
  const mate = s0.players[mine.roster.find((id) => id !== s0.me!.id)!]
  // mine at the floor with Stunner on it, so his seat has to be filled
  while (mine.roster.length > CLUB_FLOOR - 1) {
    const out = mine.roster.filter((id) => id !== s0.me!.id && id !== mate.id).pop()!
    s0.players[out].teamId = null
    mine.roster = mine.roster.filter((id) => id !== out)
    mine.starters = mine.starters.filter((id) => id !== out)
  }
  const stun = clone(mate, 'V13109', 'Stunner', myClub)
  s0.players[stun.id] = stun
  mine.roster.push(stun.id)
  const hadReita = !!s0.players.V1003
  const newsBefore = s0.news.length
  const logBefore = s0.me!.log.length

  // a save from before staff_stints.json carries no stamp (me/staffMigrate.ts). A career created today is already
  // built from the corrected book and is stamped at birth (me/career.ts), so the fixture has to drop the stamp to
  // be the old save it stands for.
  delete s0.staffSync
  const loaded = migratePlayerSave(unpackState(packState(s0)))
  check(!loaded.players.V29401 && !loaded.players.V13109, 'Muggle（AI 俱乐部）和 Stunner（你的队伍）离开了选手池')
  check(Object.values(loaded.teams).every((t) => ![...t.roster, ...t.starters].some((id) => id === 'V29401' || id === 'V13109')), '两人不在任何名单和首发里')
  const aiL = loaded.teams[ai.id]
  check(aiL.roster.length >= 5 && aiL.starters.length === 5 && aiL.starters.every((id) => aiL.roster.includes(id) && !!loaded.players[id]),
    `${aiL.name} 拿掉 Muggle 只剩四人，从自由人补回到 ${aiL.roster.length} 人，首发五人都在队里`)
  const mineL = loaded.teams[myClub]
  check(mineL.roster.length >= CLUB_FLOOR && mineL.roster.includes(loaded.me!.id) && mineL.starters.length === 5 && mineL.starters.every((id) => mineL.roster.includes(id)),
    `你的队伍拿掉 Stunner 后补回到 ${mineL.roster.length} 人（五人加你），首发都在队里`)
  check(hadReita && !!loaded.players.V1003, 'Reita 2021 年是选手：留在世界里')
  const added = loaded.news.slice(newsBefore)
  check(!added.some((n) => /Muggle|Stunner/.test(n.text)) && added.length <= 1, `新闻没有提到这两人，读档只多了 ${added.length} 条（本队补人时的签约）`)
  const logs = loaded.me!.log.slice(logBefore)
  check(logs.some((l) => l.text.includes('Stunner') && l.text.includes('教练')) && logs.some((l) => l.text.includes('补进名单')),
    '日志里一句话说明 Stunner 为什么离队，一句俱乐部补人')
  check(loaded.staffSync === STAFF_STAMP, '存档记上了教练组数据的版本')
  const again = migratePlayerSave(unpackState(packState(loaded)))
  check(print(again) === print(loaded), '再读一次什么都不变')
}
{
  const s = createCareer({ name: 'Plain', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 3, year: 2021 })
  const n = Object.keys(s.players).length
  const old = unpackState(packState(s))
  delete old.staffSync
  const l = migratePlayerSave(old)
  check(Object.keys(l.players).length === n && l.staffSync === STAFF_STAMP, '没有教练组成员的老存档照常读，一个人都不动')

  check(!!s.players.V1003, 'Reita 在 2021 年的世界里')
  const s24 = unpackState(packState(s))
  s24.year = 2024
  s24.day = 130
  delete s24.staffSync
  migrateStaff(s24)
  check(!!s24.players.V1003, '同一个世界放到 2024 年 5 月：Reita 是 Murash Gaming 的选手，留下')
  const s26 = unpackState(packState(s))
  s26.year = 2026
  s26.day = 130
  delete s26.staffSync
  const move = migrateStaff(s26)
  check(!s26.players.V1003 && !!move?.gone.includes('Reita'), '放到 2026 年 5 月：Reita 已是 Murash Gaming 的教练（2025 年 12 月起），离开选手池')
}

console.log(bad ? `\n${bad} 项没过` : '\n全部通过')
if (bad) process.exit(1)
