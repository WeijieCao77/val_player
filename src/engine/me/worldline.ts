import { eventOf, eventsOf, onwardOf, realSideOf, worldIdOf } from '../circuit'
import type { CEvent, Onward } from '../circuit'
import { realName } from '../names'
import type { Competition, Fixture, GameState } from '../types'
import { compClass, isIntlComp, isQualifier } from './compclass'
import { compCn } from './compname'
import { KEEP, REWRITE_WEIGHT, SHOWN } from './rewrites'
import type { RewriteKind } from './rewrites'
import type { MeMatchRecord, MeRewrite, MomentItem } from './types'

/**
 * 「我改写了历史」: the events this world played that came out otherwise than they really did.
 *
 * The author's brief of 2026-09-18: the world starts from real VCT history, and the biggest reason to play a
 * second career is to see it go differently — 「真实历史里这座奖杯属于 X，在你的世界线里，是你的」. The engine
 * has known this all along (circuit.ts: each event's real placings, and `swaps`, the places that went to
 * somebody else); it only ever surfaced as grey text on the standings page. This is the one reading of it the
 * career's screens share. Phase A shows one line of it, on the title card (ui/me/MomentQueue.tsx).
 *
 * Read, never written. Worked out from the season's finished events each time it is asked, so there is nothing to
 * keep in step and nothing a read-only page could write into the world (scripts/check_worldline.ts serialises the
 * world before and after). The year's competitions are cleared when the year turns (engine/season.ts setupSeason),
 * so this is the season's ledger.
 *
 * Only an event this world played ('sim') and that history has a result for: an event replayed as it really went
 * cannot differ, and one nobody has played yet (`projected`, 2026's Champions and every event from 2027) has no
 * history to differ from.
 *
 * It states two kinds of thing and nothing else: 「真实历史里是 X，这个世界里是 Y」, and whether I was there —
 * on the roster, starting or not. Never 「因为你」: other clubs' results after the fork are not necessarily mine.
 * Each side is named as it was named at that event: a real side as the event named it (circuit.ts reads that off
 * engine/names.ts), a club here by clubNameAt.
 *
 * Phase B (2026-09-18): the year's competitions are gone once the year turns, so the season's last day keeps its
 * heaviest few on the season's row (seasonLedger, called from me/week.ts before the winter runs), worded then; the
 * season's card, the ending's, the hall's and the share card read them back (me/rewrites.ts). That is the career's
 * own record, like me/intl.ts's campaigns — the world is still only read.
 */

export type { RewriteKind } from './rewrites'
export { REWRITE_WEIGHT } from './rewrites'

/** A place at a later event this one decided, that went to another side than it really did. */
export interface RewriteSeat {
  /** the later event: its competition key and its stored name */
  key: string
  event: string
  /** the side that really took it, as that event named it, and the club here that side is, if any */
  real: string
  realId: string | null
  /** that club here has been let go (engine/timeline.ts): its own place was emptied and filled (circuit.ts vacate) */
  realGone: boolean
  /** who has it here — null: nobody could be seated in it */
  now: string | null
  nowName: string | null
  /**
   * finishers of this event the later event's places went past because history had let them go by its draw, so the
   * place went down to the next finisher (circuit.ts nextFinisher, onwardOf's `gone`) — the same list on every seat
   * of that event, named as they were at this one
   */
  passed: string[]
}

export interface Rewrite {
  /** the competition's key and stored name, the real event's id, the day it ended */
  key: string
  name: string
  event: string
  year: number
  end: number
  kind: RewriteKind
  weight: number
  /** the real champion: its vlr id, its name at the event, the club here it is, where that club finished here */
  real: { vlr: string; name: string; id: string | null; place: number | null; gone: boolean } | null
  /** this world's champion, named as it was at the event */
  champ: { id: string; name: string }
  /** the title went to another side than it really did */
  champChanged: boolean
  /**
   * My club at this event — the one my own record of its matches puts me on, else the one I play for now — its
   * real placing (null: 真实历史里没打进这一站), its placing here (null: not in this world's field; `played`: it
   * played a match of the event here all the same, a qualifier's decider it lost), and whether I was there:
   * started a match of it, or on the roster for its matches and started none.
   */
  mine: { id: string; name: string; realPlace: number | null; place: number | null; played: boolean; there: 'started' | 'bench' | null } | null
  seats: RewriteSeat[]
}

/** Masters, Champions, LOCK//IN, and the doors to them: a Last Chance Qualifier, Ascension (me/compclass.ts). */
const opensTheWay = (name: string): boolean => isIntlComp(name) || compClass(name) === 'qual'

/** A real side's name at the event, as realPlacesOf gives it. */
const sideName = (ev: CEvent, vlr: string): string => ev.names[vlr] ?? vlr.replace(/^N:/, '')

/** A club's place in an event here, joint places as the event counts them. */
function placeIn(comp: Competition, id: string): number | null {
  const at = comp.finished.indexOf(id)
  return at < 0 ? null : comp.places?.[at] ?? at + 1
}

/**
 * A club here, named as it was on `day` of `year`. A club this world names by history's table (engine/names.ts)
 * wore that table's name of the day — TSM, until TSM FTX on 4 June 2021 — and one that has left the table's name
 * behind (the player's club keeps the name he signed for; a side that took another's name, circuit.ts adoptName)
 * is named as it is.
 */
export function clubNameAt(state: GameState, id: string, year: number, day: number): string {
  const t = state.teams[id]
  if (!t) return id
  const vlr = /^V21T(\d+)$/.exec(id)?.[1]
  const then = vlr ? realName(vlr, year, day) : null
  const now = vlr ? realName(vlr, state.year, state.day) : null
  return then && now && t.name === now.name ? then.name : t.name
}

/**
 * Is the real side `vlr` the club `id` here? The same club, or the one it carried on as (circuit.ts teamOf); or,
 * for a title, the same people — three of the five the side really brought lifted this one here too, whatever the
 * club is called now. And a club here that bears the side's own name at the event is never set against it:
 * no line may read 「X 的冠军成了 X 的」.
 */
function sameSide(state: GameState, ev: CEvent, vlr: string, id: string, title: { year: number; name: string } | null, idName: string): boolean {
  if (realSideOf(state, ev, vlr) === id) return true
  const direct = worldIdOf(vlr)
  if (direct && (direct === id || state.heirs?.[direct] === id)) return true
  if (sideName(ev, vlr) === idName) return true
  if (!title) return false
  const lifted = (ev.rosters?.[vlr] ?? []).filter((pid) =>
    (state.players[`V${pid}`]?.titles ?? []).some((t) => t.year === title.year && t.title === title.name)).length
  return lifted >= 3
}

/** The club here a real side is, if it is any: its own, the one it carried on as, or the club its people are on. */
function clubOf(state: GameState, ev: CEvent, vlr: string): string | null {
  const t = realSideOf(state, ev, vlr)
  if (t) return t
  const direct = worldIdOf(vlr)
  const heir = direct ? state.heirs?.[direct] : undefined
  return heir && state.teams[heir] ? heir : direct && state.teams[direct] ? direct : null
}

/** My side of one of my matches: the side I played for, else the side my own box score names, else the side that is not the opponent I wrote down. */
function mySide(state: GameState, f: Fixture, rec: MeMatchRecord): string | null {
  const me = state.me!.id
  const ups = f.result?.lineups
  if (ups?.a.includes(me)) return f.teamA
  if (ups?.b.includes(me)) return f.teamB
  const mates = (rec.box ?? []).filter((r) => r.mine).map((r) => r.id)
  if (mates.length && ups?.a.some((p) => mates.includes(p))) return f.teamA
  if (mates.length && ups?.b.some((p) => mates.includes(p))) return f.teamB
  const a = state.teams[f.teamA]
  const b = state.teams[f.teamB]
  if (a?.name === rec.opp && b?.name !== rec.opp) return f.teamB
  if (b?.name === rec.opp && a?.name !== rec.opp) return f.teamA
  return null
}

interface Reading { fixtures: Map<string, Fixture> }

function mineAt(state: GameState, comp: Competition, ev: CEvent, read: Reading): Rewrite['mine'] {
  const me = state.me
  if (!me) return null
  const c = comp.circuit!
  // my own record of this event's matches: the fixture says which event, where two of a year share a name
  const recs = me.matches.filter((m) => !m.friendly && m.year === state.year && read.fixtures.get(m.fixtureId)?.comp === comp.key)
  let onRoster: string | null = null
  for (const r of recs) {
    onRoster = mySide(state, read.fixtures.get(r.fixtureId)!, r)
    if (onRoster) break
  }
  const club = onRoster ?? (me.phase === 'pro' && state.myTeam ? state.myTeam : null)
  if (!club || !state.teams[club]) return null
  const name = clubNameAt(state, club, state.year, c.end)
  let realPlace: number | null = null
  for (const [v, p] of ev.places) {
    if (!sameSide(state, ev, v, club, null, name)) continue
    realPlace = p
    break
  }
  const place = placeIn(comp, club)
  if (realPlace == null && place == null) return null
  const played = [...read.fixtures.values()].some((f) => f.comp === comp.key && (f.teamA === club || f.teamB === club))
  // there: on that club's roster for the event's matches — my record of them says so
  const there = !onRoster ? null : recs.some((m) => m.started) ? 'started' : 'bench'
  return { id: club, name, realPlace, place, played, there }
}

/**
 * My club's placing came out otherwise, where it matters: one of the two is in the top eight — the placings the
 * standings page quotes history for (circuit.ts realPlacesOf) — or the club made the event in one world and not
 * the other. Thirteenth here against fourteenth there in a 128-side open bracket is not a history rewritten.
 */
export const placeMoved = (m: NonNullable<Rewrite['mine']>): boolean =>
  m.realPlace !== m.place && (m.realPlace == null || m.place == null || Math.min(m.realPlace, m.place) <= 8)

/**
 * The places at a Masters, Champions or LOCK//IN, or at a door to one, that this event decided and that went to
 * other sides than they really did — read off the later event's draw (its `swaps`, each seat as the draw finally
 * seated it). Netted within the event: 2021's North America Stage 2 Challengers Finals really sent Sentinels and
 * Version1 to Reykjavík, and a world where 100 Thieves won it and Sentinels were second sent 100 Thieves and
 * Sentinels — both of the seats moved, and what changed is that Version1's place is 100 Thieves'. Two sides that
 * only traded seats changed nothing.
 */
function seatsFrom(state: GameState, comp: Competition, year: number): RewriteSeat[] {
  const out: RewriteSeat[] = []
  let onward: Onward[] | undefined
  for (const t of Object.values(state.comps)) {
    const tc = t.circuit
    if (!tc?.swaps?.length || tc.mode !== 'sim' || !opensTheWay(t.name)) continue
    const tev = eventOf(tc.id)
    if (!tev || tev.projected) continue
    const reals: { name: string; id: string | null }[] = []
    const nows: (string | null)[] = []
    for (const s of tc.swaps) {
      if (s.from !== comp.key) continue
      const at = tev.seeds.indexOf(s.real)
      reals.push({ name: sideName(tev, s.real), id: clubOf(state, tev, s.real) })
      nows.push(at >= 0 ? tc.seeds[at] ?? null : s.now)
    }
    // a side on both lists — by club, or a club here named as the real side was — kept its place
    const nameOf = (id: string) => clubNameAt(state, id, year, tc.start)
    const same = (r: { name: string; id: string | null }, n: string | null) => !!n && (r.id === n || r.name === nameOf(n))
    const lost = reals.filter((r) => !nows.some((n) => same(r, n)))
    const took = nows.filter((n) => !reals.some((r) => same(r, n)))
    if (!lost.length) continue
    onward ??= onwardOf(state, comp)
    const passed = (onward.find((o) => `ev:${o.event}` === t.key)?.gone ?? []).map((id) => clubNameAt(state, id, year, comp.circuit!.end))
    lost.forEach((r, i) => {
      const now = took[i] ?? null
      out.push({
        key: t.key, event: t.name, real: r.name, realId: r.id,
        realGone: !!r.id && !!state.teams[r.id]?.dormant, now, nowName: now ? nameOf(now) : null, passed,
      })
    })
  }
  return out
}

/** A finished event this world played that history has a result for, and its real event; null for any other. */
function settledHere(comp: Competition): CEvent | null {
  const c = comp.circuit
  if (!c || c.mode !== 'sim' || !comp.champion) return null
  const ev = eventOf(c.id)
  return !ev || ev.projected || ev.plan || !ev.places.length ? null : ev
}

/** The title: who really won it, who won it here, and whether that is another side. */
function titleOf(state: GameState, comp: Competition, ev: CEvent): Pick<Rewrite, 'real' | 'champ' | 'champChanged'> {
  const champ = { id: comp.champion!, name: clubNameAt(state, comp.champion!, state.year, comp.circuit!.end) }
  const first = ev.places.find(([, p]) => p === 1)?.[0]
  if (!first) return { real: null, champ, champChanged: false }
  const id = clubOf(state, ev, first)
  return {
    real: { vlr: first, name: sideName(ev, first), id, place: id ? placeIn(comp, id) : null, gone: !!id && !!state.teams[id]?.dormant },
    champ,
    champChanged: !sameSide(state, ev, first, champ.id, { year: state.year, name: comp.name }, champ.name),
  }
}

/** One finished event's entry, or null where it came out as it really did, or cannot be set against history. */
export function rewriteOf(state: GameState, comp: Competition, read: Reading = readingOf(state)): Rewrite | null {
  const ev = settledHere(comp)
  if (!ev) return null
  const c = comp.circuit!
  const { real, champ, champChanged } = titleOf(state, comp, ev)
  const mine = mineAt(state, comp, ev, read)
  const seats = seatsFrom(state, comp, state.year)
  const moved = !!mine && placeMoved(mine)
  if (!champChanged && !seats.length && !moved) return null
  const cls = compClass(comp.name)
  const kind: RewriteKind = champChanged && isIntlComp(comp.name) ? 'intl'
    : seats.length || (champChanged && cls === 'qual') ? 'qual'
      : champChanged ? 'region'
        : 'place'
  return {
    key: comp.key, name: comp.name, event: ev.id, year: state.year, end: c.end,
    kind, weight: REWRITE_WEIGHT[kind],
    real, champ, champChanged, mine, seats,
  }
}

function readingOf(state: GameState): Reading {
  return { fixtures: new Map(state.fixtures.map((f) => [f.id, f])) }
}

/** The season's ledger, heaviest first, and in the order they ended within a weight. */
export function historyLedger(state: GameState): Rewrite[] {
  const read = readingOf(state)
  const out: Rewrite[] = []
  for (const comp of Object.values(state.comps)) {
    const e = rewriteOf(state, comp, read)
    if (e) out.push(e)
  }
  return out.sort((a, b) => b.weight - a.weight || a.end - b.end || a.key.localeCompare(b.key))
}

const placeCn = (p: number): string => (p === 1 ? '夺冠' : `第 ${p} 名`)

/** An entry's facts, each without the event's name in front: its title, the places it gave, my club's placing. */
function factsOf(e: Rewrite): { title: string | null; seats: string[]; place: string | null } {
  let title: string | null = null
  if (e.champChanged && e.real) {
    const r = e.real
    const after = r.place != null ? `，${r.name} ${placeCn(r.place)}`
      : r.id && r.gone ? `，${r.name} 在这个世界里已经解散`
        : r.id ? `，${r.name} 没有参加这一站` : ''
    title = `真实历史里的冠军是 ${r.name}；这个世界里是 ${e.champ.name}${after}`
  }
  const seats: string[] = []
  const told = new Set<string>()
  e.seats.forEach((s, i) => {
    // the title's own place (a Masters' winner's at Champions, a Last Chance Qualifier's): the line above says it
    const own = e.champChanged && !!e.real && s.now === e.champ.id && (s.realId ? s.realId === e.real.id : s.real === e.real.name)
    // after the event's last seat, once: who the places went past, let go by history
    const last = !e.seats.slice(i + 1).some((x) => x.key === s.key)
    const past = last && s.passed.length && !told.has(s.key)
      ? `${s.passed.join('、')} 在这个世界里已经解散，名额往下顺延` : ''
    if (past) told.add(s.key)
    if (own && !past) return
    seats.push(own
      ? `给${compCn(s.event)}的名额：${past}`
      : `给${compCn(s.event)}的名额：真实历史里是 ${s.real}；这个世界里是 ${s.nowName ?? '空缺'}${s.realGone ? `，${s.real} 在这个世界里已经解散` : ''}${past ? `；${past}` : ''}`)
  })
  let place: string | null = null
  const m = e.mine
  if (m && placeMoved(m)) {
    const was = m.realPlace == null ? `真实历史里 ${m.name} 没打进这一站` : `真实历史里 ${m.name} ${placeCn(m.realPlace)}`
    const now = m.place != null ? `这个世界里${placeCn(m.place)}` : m.played ? '这个世界里没打进这一站' : '这个世界里没有参加这一站'
    place = `${was}；${now}`
  }
  return { title, seats, place }
}

/**
 * An entry in words: only 「真实历史里是 X，这个世界里是 Y」 and whether I was there, each line with the event's name
 * in front. The title card says its one line itself (titleRealChamp); the season's row keeps its own wording (keptOf).
 */
export function rewriteLines(e: Rewrite): string[] {
  const ev = compCn(e.name)
  const f = factsOf(e)
  const out: string[] = []
  if (f.title) out.push(`${ev}：${f.title}。`)
  for (const s of f.seats) out.push(`${ev}${s}。`)
  if (f.place) out.push(`${ev}：${f.place}。`)
  if (e.mine?.there === 'started') out.push('你首发出场。')
  else if (e.mine?.there === 'bench') out.push('你在名单上，没有上场。')
  return out
}

/* ------------------------------------------------------------------ */
/*  the season's row: what the career keeps of the ledger               */
/* ------------------------------------------------------------------ */

export { KEEP, SHOWN } from './rewrites'

/** my part in an entry: on my club's roster for its matches — the club my own record of them puts me on — started or not */
const partOf = (e: Rewrite): 'started' | 'bench' | null => e.mine?.there ?? null
/** its title went elsewhere than history gave it — to my club at the event, with me on its roster */
const oursOf = (e: Rewrite): boolean => e.champChanged && !!e.mine?.there && e.champ.id === e.mine.id
/** how much of it was mine: started above the bench, and the title ours above not */
const partRank = (e: Rewrite): number => (partOf(e) === 'started' ? 4 : partOf(e) === 'bench' ? 2 : 0) + (oursOf(e) ? 1 : 0)

/**
 * The season card's order: phase A's weight — an international's title, a qualification place, a regional title,
 * my club's placing — and within a weight the one I was part of, then as they ended.
 */
const seasonOrder = (a: Rewrite, b: Rewrite): number =>
  b.weight - a.weight || partRank(b) - partRank(a) || a.end - b.end || a.key.localeCompare(b.key)

/**
 * My club's placing is said only where I was on its roster: the club the ledger falls back on is the one I play for
 * now, which at an event from before I signed was not mine. An entry that is nothing but that placing is not kept.
 */
const tellable = (e: Rewrite): boolean => e.kind !== 'place' || !!partOf(e)

/** A title the career would call a trophy: a qualifier's winner goes through, it lifts nothing (me/compclass.ts). */
const trophyRetitled = (e: Rewrite): boolean => e.champChanged && !isQualifier(e.name)

/** 「挑战者赛 3」 then 「的」: a space after a name that ends in a letter or a digit */
const glue = (s: string): string => (/[0-9A-Za-z]$/.test(s) ? `${s} ` : s)

/** The entry in one line, the year in front: its title, else the first place it gave elsewhere, else my club's placing. */
function oneOf(e: Rewrite): string {
  const cn = compCn(e.name)
  const at = cn.includes(String(e.year)) ? cn : `${e.year} ${cn}`
  if (e.champChanged && e.real) return `${glue(at)}的冠军是 ${e.champ.name}（真实历史：${e.real.name}）`
  const s = e.seats.find((x) => x.nowName) ?? e.seats[0]
  if (s) return `${glue(at)}给${compCn(s.event)}的名额${s.nowName ? `给了 ${s.nowName}` : '空着'}（真实历史：${s.real}）`
  const m = e.mine
  if (!m) return at
  const now = m.place != null ? placeCn(m.place) : m.played ? '没打进这一站' : '没有参加这一站'
  return `${at}，${m.name} ${now}（真实历史：${m.realPlace == null ? '没打进这一站' : placeCn(m.realPlace)}）`
}

/** One entry as the season's row keeps it: worded now, the names as they were at the event. */
export function keptOf(e: Rewrite): MeRewrite {
  const f = factsOf(e)
  const there = partOf(e)
  return {
    kind: e.kind, comp: e.name,
    lines: [f.title, ...f.seats, there ? f.place : null].filter((l): l is string => !!l),
    one: oneOf(e),
    ...(e.champChanged && e.real ? { title: 1 as const } : {}),
    ...(there ? { there } : {}),
    ...(oursOf(e) ? { ours: 1 as const } : {}),
  }
}

export interface SeasonLedger {
  /** at most KEEP, the season card's order: its SHOWN first, then what the career's pages need of mine */
  rewrites: MeRewrite[]
  /** trophies in the whole ledger that went to another side than they really did */
  retitled: number
}

/**
 * The season's ledger as its row keeps it, read on its last day (me/week.ts, before the winter). The card's three
 * come first; the other two places go to what the career's pages look for (me/rewrites.ts careerRewrites), where the
 * three are the world's — a title my club took with me starting, the heaviest I started in, a title my club took,
 * the heaviest I was on the roster for — so a season whose three are other people's Masters still keeps mine.
 */
export function seasonLedger(state: GameState): SeasonLedger {
  const led = historyLedger(state)
  const all = led.filter(tellable).sort(seasonOrder)
  const pick = all.slice(0, SHOWN)
  const add = (e: Rewrite | undefined) => { if (e && !pick.includes(e) && pick.length < KEEP) pick.push(e) }
  add(all.find((e) => oursOf(e) && partOf(e) === 'started'))
  add(all.find((e) => partOf(e) === 'started'))
  add(all.find(oursOf))
  add(all.find((e) => partOf(e) === 'bench'))
  for (const e of all) add(e)
  return { rewrites: pick.sort(seasonOrder).map(keptOf), retitled: led.filter(trophyRetitled).length }
}

/**
 * The title card's one line: who really lifted this trophy, where it was not us — 「真实历史里，这座奖杯属于 X」.
 * Null where it was us, where nobody has (an event of a year not played yet), or where it cannot be said for sure.
 *
 * The card can come up after the year has turned — a 托管 run to the season's end queues it — and then the event
 * is no longer among the competitions. Its real result is still on the books, found by its name if that year has
 * one event of that name, and the club that won it here is on the card (MomentItem.teamId).
 */
export function titleRealChamp(state: GameState, m: MomentItem): string | null {
  if (m.kind !== 'title' || !m.comp) return null
  if (m.year === state.year) {
    const me = state.me?.id
    const won = Object.values(state.comps).filter((c) => c.name === m.comp && !!c.champion && !!c.circuit)
    const comp = (m.teamId ? won.filter((c) => c.champion === m.teamId) : [])[0]
      ?? won.find((c) => !!me && !!state.teams[c.champion!]?.roster.includes(me))
      ?? won.find((c) => c.champion === state.myTeam)
    if (comp) {
      // the ledger's own reading of the title, without the rest of the entry
      const ev = settledHere(comp)
      const t = ev && titleOf(state, comp, ev)
      return t?.champChanged && t.real ? t.real.name : null
    }
  }
  if (!m.teamId || !state.teams[m.teamId]) return null
  const evs = eventsOf(m.year).filter((e) => !e.projected && !e.plan && e.cn === m.comp && e.places.length)
  if (evs.length !== 1) return null
  const ev = evs[0]
  const first = ev.places.find(([, p]) => p === 1)?.[0]
  if (!first) return null
  const name = clubNameAt(state, m.teamId, m.year, ev.end ?? 0)
  return sameSide(state, ev, first, m.teamId, { year: m.year, name: m.comp }, name) ? null : sideName(ev, first)
}
