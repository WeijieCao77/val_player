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
 *  - the people: each of the thirty is either a man who never played professionally or one who
 *    did and then went to a staff, with the month he stopped
 *  - a man who turned coach never appears as a player in any later year, in the book or in a
 *    world built out to 2026; a man who never played is nobody's player on any day; and an
 *    ex-professional's playing years are exactly as they were
 *  - 2026's coaching staff in world.json: Bilibili Gaming's Anaks, Titan Esports Club's AfteR,
 *    Karmine Corp's assistant simoz, and Muggle on nobody's roster
 *
 *   npx tsx scripts/check_staff.ts
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { CLUB_FLOOR } from '../src/engine/me/club'
import { migratePlayerSave } from '../src/engine/me/save'
import { migrateStaff } from '../src/engine/me/staffMigrate'
import { packState, unpackState } from '../src/engine/save'
import { STAFF_PEOPLE, STAFF_STAMP, STAFF_STINTS, dateOf, offPoolOn, staffPeople, staffStintOn } from '../src/engine/staffStints'
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

console.log('人：当过选手的和纯教练')
{
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/
  const ok = STAFF_PEOPLE.filter((p) => /^\d+$/.test(p.vlr) && !!p.ign && typeof p.played === 'boolean'
    && (p.coachFrom === null || ym.test(p.coachFrom))
    // 从没打过职业的人不需要「哪个月收手」
    && (p.played || p.coachFrom === null)
    && p.source === `https://www.vlr.gg/player/${p.vlr}` && /^\d{4}-\d{2}-\d{2}$/.test(p.checked))
  const named = new Set(STAFF_PEOPLE.map((p) => p.vlr))
  check(ok.length === STAFF_PEOPLE.length && named.size === STAFF_PEOPLE.length
    && staffPeople().every((v) => named.has(v)) && STAFF_PEOPLE.length === staffPeople().length,
    `${STAFF_PEOPLE.length} 人各一行，和 ${staffPeople().length} 位有任期的人一一对应，都注明了 vlr 页面和查证日期`)
  const pure = STAFF_PEOPLE.filter((p) => !p.played)
  check(pure.length === 12, `其中 ${pure.length} 人从没打过职业：${pure.map((p) => p.ign).join('、')}`)
  const noDate = STAFF_PEOPLE.filter((p) => p.played && !p.coachFrom)
  check(noDate.every((p) => !!p.note),
    `当过选手但收手月份查不准的 ${noDate.length} 人都写明了原因，只按任期算：${noDate.map((p) => p.ign).join('、')}`)
}

// 名册给过的每一个出场日子，按人分
const playedOn = new Map<string, string[]>()
for (const [y, evs] of Object.entries(circuit)) {
  for (const e of evs) {
    if (e.start == null) continue
    const date = dateOf(Number(y), e.start)
    for (const ids of Object.values(e.rosters ?? {})) {
      for (const pid of ids) playedOn.set(pid, [...(playedOn.get(pid) ?? []), date])
    }
  }
}
for (const [y, Y] of Object.entries(book.years)) {
  for (const [club, ids] of Object.entries(Y.rosters)) {
    const date = dateOf(Number(y), Y.clubs[club].d)
    for (const pid of ids) playedOn.set(pid, [...(playedOn.get(pid) ?? []), date])
  }
}

console.log('转教练之后，再也不当选手')
{
  const dated = STAFF_PEOPLE.filter((p) => !!p.coachFrom)
  const after: string[] = []
  for (const p of dated) {
    const from = `${p.coachFrom}-01`
    for (const d of playedOn.get(p.vlr) ?? []) if (d >= from) after.push(`${p.ign} ${d}（${p.coachFrom} 起是教练）`)
    for (const [y, Y] of Object.entries(book.years)) if (Number(y) > Number(p.coachFrom!.slice(0, 4)) && Y.ratings[p.vlr]) after.push(`${p.ign} ${y} 年有评分`)
  }
  check(dated.length === 16 && !after.length,
    `${dated.length} 位查得到收手月份的人，那个月之后名册里再没有他们的席位和评分${after.length ? '：' + after.slice(0, 6).join('；') : ''}`)
  // 引擎问的就是这一条，任期之外也算数
  check(offPoolOn('1851', '2024-06-01') === false && offPoolOn('1851', '2025-11-15') === true,
    'oderus：2024 年 6 月还是 Moist x Shopify 的选手；2025 年 11 月 Apeks 那段任期已结束，但他仍是教练，不回选手池')
  check(offPoolOn('6021', '2024-08-01') === false && offPoolOn('6021', '2024-11-01') === true,
    'York：2024 年 6—10 月又回 Titan Esports Club 打了一段，10 月之后才彻底转教练')
  check(offPoolOn('1003', '2024-05-01') === false && offPoolOn('1003', '2026-05-01') === true,
    'Reita：2024 年 5 月是 Murash Gaming 的选手，2026 年 5 月是他们的教练')
  check(offPoolOn('7456', '2025-06-01') === true && offPoolOn('12335', '2024-01-01') === true,
    'Zeus 和 Jumpy 最后一段任期结束之后仍然不是选手（两人从没打过职业）')
}

console.log('纯教练：从来不是选手')
{
  const pure = STAFF_PEOPLE.filter((p) => !p.played)
  const seen: string[] = []
  for (const p of pure) {
    if ((playedOn.get(p.vlr) ?? []).length) seen.push(`${p.ign} 有 ${playedOn.get(p.vlr)!.length} 个席位`)
    if (book.last[p.vlr] !== undefined) seen.push(`${p.ign} 有最后在役年份`)
    if (Object.values(book.years).some((Y) => Y.ratings[p.vlr] || Y.debuts[p.vlr])) seen.push(`${p.ign} 有评分或新面孔`)
    if (w21.players.some((x) => x.id === `V${p.vlr}`)) seen.push(`${p.ign} 在 2021 的世界里`)
    if (!offPoolOn(p.vlr, '2021-01-01') || !offPoolOn(p.vlr, '2030-01-01')) seen.push(`${p.ign} 有某一天算选手`)
  }
  check(!seen.length, `${pure.length} 位纯教练在任何一年都不是选手${seen.length ? '：' + seen.slice(0, 6).join('；') : ''}`)
}

console.log('当过选手的人，打球的年份原样保留')
{
  const exPro = STAFF_PEOPLE.filter((p) => p.played)
  const empty = exPro.filter((p) => !(playedOn.get(p.vlr) ?? []).length
    && !Object.values(book.years).some((Y) => Y.ratings[p.vlr]) && !w21.players.some((x) => x.id === `V${p.vlr}`))
  check(exPro.length === 18 && !empty.length,
    `${exPro.length} 位当过选手的人，名册里都还留着他们打球的记录${empty.length ? '（少了：' + empty.map((p) => p.ign).join('、') + '）' : ''}`)
  const reita = (playedOn.get('1003') ?? []).length
  check(reita > 0 && (playedOn.get('1003') ?? []).every((d) => d < '2025-12-01'),
    `Reita 打球的 ${reita} 个席位都在 2025 年 12 月他转教练之前，一个都没少`)
  const od = (playedOn.get('1851') ?? []).length
  check(od > 0 && (playedOn.get('1851') ?? []).every((d) => d < '2024-12-01'),
    `oderus 打球的 ${od} 个席位都在 2024 年 12 月之前（其中有他 2024 年回 Moist x Shopify 的那一段）`)
}

console.log('2026 的教练组（world.json）')
{
  const world = read<{
    teams: { tag: string; name: string; coach: { name: string; assistants?: string[] } | null }[]
    players: { ign: string }[]
  }>('world.json')
  const at = (tag: string) => world.teams.find((t) => t.tag === tag)
  check(at('BLG')?.coach?.name === 'Anaks', `Bilibili Gaming 的主教练是 Anaks：${at('BLG')?.coach?.name}`)
  check(at('TEC')?.coach?.name === 'AfteR', `Titan Esports Club 的主教练是 AfteR：${at('TEC')?.coach?.name}`)
  check(!!at('KC')?.coach?.assistants?.includes('simoz'),
    `Karmine Corp 的助理教练里有 simoz：${at('KC')?.coach?.assistants?.join('、')}`)
  const staffNames = world.teams.flatMap((t) => (t.coach ? [t.coach.name, ...(t.coach.assistants ?? [])] : []))
  check(!staffNames.includes('Muggle') && !world.players.some((p) => p.ign === 'Muggle'),
    'Muggle 不占 world.json 的任何教练席位，也不在选手里')
}

console.log('世界里没有教练组成员')
{
  const s21 = createCareer({ name: 'Y21', region: 'Europe', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 11, year: 2021 })
  const pureIn21 = STAFF_PEOPLE.filter((p) => !p.played && !!s21.players[`V${p.vlr}`])
  check(!pureIn21.length, `2021 年开局的世界里没有一位纯教练${pureIn21.length ? '：' + pureIn21.map((p) => p.ign).join('、') : ''}`)
  check(!!s21.players.V1003, 'Reita 2021 年在世界里，是选手')

  const s26 = createCareer({ name: 'Y26', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 11, year: 2026 })
  const left = staffPeople().filter((v) => !!s26.players[`V${v}`])
  check(!left.length, `2026 年开局的世界（2021 一路推到 2026）里，这 ${staffPeople().length} 人一个都不在选手池里${left.length ? '：' + left.map((v) => ignOf.get(v)).join('、') : ''}`)
  const free = Object.values(s26.players).filter((p) => p.teamId === null)
  check(!free.some((p) => staffPeople().includes(p.id.replace(/^[A-Z]/, ''))),
    `2026 年的 ${free.length} 名自由人里没有教练组成员`)
}

console.log(bad ? `\n${bad} 项没过` : '\n全部通过')
if (bad) process.exit(1)
