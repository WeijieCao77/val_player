import { clamp } from '../rng'
import type { Fixture, GameState, MapScore, Player } from '../types'
import type { BoxRow, MeMatchRecord } from './types'
import { pushLog } from './log'
import { compCn } from './compname'

/**
 * 宿敌 — who keeps standing in the way, read off what happened in this save.
 *
 * Borrowed from 破晓's rivals.ts, whose rule is the whole design: nobody is a
 * rival because of who he is, only because of what he did to you. There is no
 * list of nemeses here and no script. A name becomes a rival from the box
 * scores already on the record — the man in my position I keep meeting, the
 * series that went the distance, the side that knocked us out, the final we
 * lost, the team-mate who left or took my place — and stops being one when the
 * results stop coming.
 *
 * Each entry keeps a temperature. Meetings warm it, a clear night against him
 * cools it, and every week it cools a little by itself. Only a few are declared
 * at a time; the rest are names being watched.
 *
 * What it does to a match is small and on purpose: a few points on the odds of
 * my calls while he is on the other five, read off 心态, and a little tilt
 * after the result. The rest is the one line before and the one line after.
 */

export type RivalKind = 'final' | 'elim' | 'pushed' | 'mate' | 'close' | 'often'
const RANK: Record<RivalKind, number> = { final: 6, elim: 5, pushed: 4, mate: 3, close: 2, often: 1 }

export interface RivalEntry {
  id: string
  ign: string
  role: string
  /** temperature, 0-100 */
  heat: number
  peak: number
  /** series where we were both on the floor */
  n: number
  /** of those, won by my side / by his */
  w: number
  l: number
  /** of those, went the distance or into overtime */
  close: number
  /** the strongest thing that happened between us; kept after the heat is gone */
  why?: { k: RivalKind; text: string; year: number }
  /** declared: a rival, not just a name I keep meeting */
  on?: boolean
  since?: number
  first: number
  lastYear: number
  lastDay: number
  /** the first meeting since he stopped being my team-mate has been paid */
  mateMet?: boolean
}

export interface RivalBook {
  list: Record<string, RivalEntry>
  /** knockout losses still waiting to learn whether they ended the run */
  ko?: { comp: string; name: string; year: number; day: number; foe: string; intl: boolean }[]
  /** last week's five at my club, to see who took my place */
  was?: { team: string; starter: boolean; five: string[] }
}

/** what each thing that happens adds to the temperature */
const HEAT = {
  meet: 3, close: 4, hisNight: 3, myNight: -4,
  elim: 9, final: 16,
  pushed: 6, pushedMet: 8, mate: 5, mateLong: 8, bystander: 2,
}
const INTL = 1.4
/** declared at this temperature once we have met twice… */
export const RIVAL_DECLARE = 22
/** …or at this one straight away */
const DECLARE_ONCE = 28
/** a declared rivalry below this has cooled off */
const COOL = 9
export const RIVAL_ACTIVE_MAX = 3
const TRACK_MAX = 30
/** weekly cooling: about half in half a year without a meeting */
const DECAY = 0.975

function book(state: GameState): RivalBook {
  const me = state.me!
  me.rivals ??= { list: {} }
  return me.rivals
}

function entry(state: GameState, p: Player): RivalEntry {
  const b = book(state)
  let e = b.list[p.id]
  if (!e) {
    e = b.list[p.id] = {
      id: p.id, ign: p.ign, role: p.role, heat: 0, peak: 0, n: 0, w: 0, l: 0, close: 0,
      first: state.year, lastYear: state.year, lastDay: state.day,
    }
  }
  e.ign = p.ign
  e.role = p.role
  return e
}

function warm(e: RivalEntry, d: number): void {
  e.heat = clamp(e.heat + d, 0, 100)
  e.peak = Math.max(e.peak, e.heat)
}

function story(e: RivalEntry, k: RivalKind, text: string, year: number): void {
  if (!e.why || RANK[k] >= RANK[e.why.k]) e.why = { k, text, year }
}

/**
 * The event, short enough for a line: 「2023 FGC 邀请赛」, not 「2028 2028 揭幕赛公开资格赛」,
 * and the circuit's own name without the family it belongs to
 * (「挑战者联赛 · 拉美南区 · 第一赛段」 → 「拉美南区 · 第一赛段」).
 */
const named = (year: number, comp: string): string => {
  const parts = compCn(comp).split(/\s*·\s*/)
  const cn = (parts.length >= 3 ? parts.slice(1) : parts).join(' · ')
  return /20\d\d/.test(cn) ? cn : `${year} ${cn}`
}

function meet(e: RivalEntry, rec: MeMatchRecord): void {
  e.n++
  if (rec.won) e.w++
  else if (!rec.drawn) e.l++
}

/** The one-line why. */
export function rivalReason(e: RivalEntry): string {
  const k = e.why?.k
  if (e.why && k !== 'close' && k !== 'often') return e.why.text
  if (e.close >= 2) return `交手 ${e.n} 次，${e.close} 次打满`
  return `同位置交手 ${e.n} 次`
}

export const heatWord = (h: number): string => (h >= 45 ? '炽热' : h >= 25 ? '升温' : '降温')
export const heatLevel = (h: number): 0 | 1 | 2 => (h >= 45 ? 2 : h >= 25 ? 1 : 0)

const onList = (b: RivalBook): RivalEntry[] => Object.values(b.list).filter((e) => e.on)

/** Declare him, if the history is there — making room by retiring the coldest. */
function declare(state: GameState, e: RivalEntry): boolean {
  if (e.on) return false
  const p = state.players[e.id]
  if (!p?.teamId || p.teamId === state.myTeam) return false
  if (!((e.heat >= RIVAL_DECLARE && e.n >= 2) || (e.heat >= DECLARE_ONCE && e.n >= 1))) return false
  const on = onList(book(state)).sort((a, b) => a.heat - b.heat)
  if (on.length >= RIVAL_ACTIVE_MAX) {
    if (on[0].heat >= e.heat) return false
    on[0].on = false
  }
  e.on = true
  e.since = state.year
  pushLog(state, 'event', `宿敌：${e.ign}（${state.teams[p.teamId]?.tag ?? '?'}）· ${rivalReason(e)}`)
  return true
}

/**
 * The man in my position on the other five: same primary role first, then
 * anyone who covers it; the one who played the most rounds of the series.
 */
function counterpart(state: GameState, box: BoxRow[], role: string): BoxRow | null {
  const theirs = box.filter((b) => !b.mine)
  const same = theirs.filter((b) => state.players[b.id]?.role === role)
  const flex = theirs.filter((b) => (state.players[b.id]?.roles ?? []).includes(role as Player['role']))
  return (same.length ? same : flex).sort((a, b) => b.rounds - a.rounds || b.rating - a.rating)[0] ?? null
}

const FINAL = /总决赛|^决赛$|grand\s*final/i
/** the engine marks bracket and Swiss rounds; a group or a league week is not where a run ends on one result */
const knockoutish = (label: string): boolean => /^(KO|SW):/.test(label)

export interface RivalMatchInfo {
  oppTeamId: string
  maps: MapScore[]
  fixture: Fixture
}

/**
 * After one of my club's official matches: who I met, how it went, and the one
 * line the post-match screen shows. Reads the box score already on `rec`.
 */
export function rivalAfterMatch(state: GameState, rec: MeMatchRecord, info: RivalMatchInfo): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || rec.friendly || !rec.started || !rec.box?.length) return
  const mine = rec.box.find((r) => r.me)
  if (!mine) return
  const b = book(state)
  const f = info.fixture
  const lost = !rec.won && !rec.drawn
  const close = (f.bo >= 3 && info.maps.length >= f.bo) || info.maps.some((m) => Math.min(m.scoreA, m.scoreB) >= 12)
  const comp = state.comps[f.comp]
  const intl = !!comp && !comp.region
  const wasOn = new Set(onList(b).map((e) => e.id))
  // a knockout loss earlier in this event did not end the run: here we are again
  if (b.ko) b.ko = b.ko.filter((k) => !(k.year === rec.year && k.name === rec.comp))

  const touched: RivalEntry[] = []
  const touch = (e: RivalEntry) => { if (!touched.includes(e)) touched.push(e) }
  const cp = counterpart(state, rec.box, state.players[me.id].role)
  const cpPlayer = cp ? state.players[cp.id] : undefined
  if (cp && cpPlayer) {
    const e = entry(state, cpPlayer)
    meet(e, rec)
    warm(e, HEAT.meet)
    if (close) { e.close++; warm(e, HEAT.close) }
    if (lost && cp.rating > mine.rating) warm(e, HEAT.hisNight)
    if (rec.won && mine.rating > cp.rating) warm(e, HEAT.myNight)
    story(e, e.close >= 2 ? 'close' : 'often', '', rec.year)
    touch(e)
  }

  // a former team-mate on the other five, whatever he plays
  for (const r of rec.box) {
    if (r.mine) continue
    const p = state.players[r.id]
    const bond = me.mates?.[r.id]
    const pushed = b.list[r.id]?.why?.k === 'pushed'
    const shared = !!bond?.gone && ((bond.stages ?? 0) >= 1 || (bond.matches ?? 0) >= 5)
    if (!p || (!shared && !pushed)) continue
    const e = entry(state, p)
    if (r.id !== cp?.id) { meet(e, rec); warm(e, HEAT.bystander) }
    if (!e.mateMet) {
      e.mateMet = true
      if (pushed) warm(e, HEAT.pushedMet)
      else if (bond) {
        warm(e, (bond.stages ?? 0) >= 2 ? HEAT.mateLong : HEAT.mate)
        story(e, 'mate', `${bond.team} 时的队友`, bond.lastYear)
      }
    }
    touch(e)
  }

  // the final we lost, or a knockout loss that may turn out to be the end of the run
  if (lost) {
    const foeRow = cp ?? rec.box.filter((r) => !r.mine).sort((x, y) => y.rating - x.rating)[0]
    const foe = foeRow ? state.players[foeRow.id] : undefined
    const round = f.label.replace(/^(KO|SW):\d+:/, '')
    if (foe && FINAL.test(round)) {
      const e = entry(state, foe)
      if (!touched.includes(e)) meet(e, rec)
      warm(e, HEAT.final * (intl ? INTL : 1))
      story(e, 'final', `${named(rec.year, rec.comp)} 决赛输给他`, rec.year)
      touch(e)
    } else if (foe && knockoutish(f.label)) {
      (b.ko ??= []).push({ comp: f.comp, name: rec.comp, year: rec.year, day: rec.day, foe: foe.id, intl })
      if (b.ko.length > 8) b.ko.splice(0, b.ko.length - 8)
    }
  }

  let fresh: RivalEntry | null = null
  for (const e of touched) {
    e.lastYear = rec.year
    e.lastDay = rec.day
    if (declare(state, e)) fresh ??= e
  }

  // the one line, and the little it does to the head
  const rival = touched.filter((e) => e.on).sort((x, y) => y.heat - x.heat)[0]
  if (rival) {
    const row = rec.box.find((r) => r.id === rival.id)
    const nums = row ? ` · 评分 ${mine.rating.toFixed(2)} 对 ${row.rating.toFixed(2)}` : ''
    rec.rivalNote = fresh === rival
      ? { t: `${rival.ign} 成了你的宿敌：${rivalReason(rival)}。`, ok: false }
      : rec.won ? { t: `赢了宿敌 ${rival.ign}${nums}。`, ok: true }
        : rec.drawn ? { t: `和宿敌 ${rival.ign} 打平${nums}。`, ok: true }
          : { t: `又输给宿敌 ${rival.ign}${nums}。`, ok: false }
    if (wasOn.has(rival.id)) me.tilt = clamp(me.tilt + (rec.won ? -4 : rec.drawn ? 0 : 3), 0, 100)
    // one line about him, not two
    if (row && rec.starBeat?.includes(row.ign)) delete rec.starBeat
  } else if (cp && !rec.starBeat) {
    const d = mine.rating - cp.rating
    if (d >= 0.25) rec.rivalNote = { t: `对位 ${cp.ign}：你 ${mine.rating.toFixed(2)}，他 ${cp.rating.toFixed(2)}。`, ok: true }
    else if (d <= -0.25) rec.rivalNote = { t: `对位 ${cp.ign} 压了你一头：${cp.rating.toFixed(2)} 对 ${mine.rating.toFixed(2)}。`, ok: false }
  }
}

/**
 * The week: who took my place in the five, which knockout losses ended a run,
 * and the cooling. Called from the weekly settlement.
 */
export function rivalWeek(state: GameState): void {
  const me = state.me
  if (!me || (!me.rivals && me.phase !== 'pro')) return
  const b = book(state)
  const mineP = state.players[me.id]

  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (team && mineP) {
    const starter = team.starters.includes(me.id)
    const hurt = mineP.injuredUntil > state.day
    const was = b.was
    if (was?.team === team.id && was.starter && !starter && !hurt) {
      const inn = team.starters
        .map((id) => state.players[id])
        .find((p) => p && p.id !== me.id && !was.five.includes(p.id) && (p.roles ?? [p.role]).includes(mineP.role))
      if (inn) {
        const e = entry(state, inn)
        warm(e, HEAT.pushed)
        story(e, 'pushed', `在 ${team.name} 顶掉你首发的人`, state.year)
        e.mateMet = false
      }
    }
    b.was = { team: team.id, starter, five: [...team.starters] }
  } else {
    b.was = undefined
  }

  if (b.ko?.length) {
    const keep: NonNullable<RivalBook['ko']> = []
    for (const k of b.ko) {
      const c = state.comps[k.comp]
      const same = !!c && c.name === k.name && state.year === k.year
      if (same && !c.champion && !c.circuit?.done) { keep.push(k); continue }
      if (same && c.champion === state.myTeam) continue
      const foe = state.players[k.foe]
      if (!foe) continue
      const e = entry(state, foe)
      warm(e, HEAT.elim * (k.intl ? INTL : 1))
      story(e, 'elim', `${named(k.year, k.name)} 被他淘汰`, k.year)
      declare(state, e)
    }
    b.ko = keep
  }

  for (const e of Object.values(b.list)) {
    const p = state.players[e.id]
    const mate = !!p && me.phase === 'pro' && p.teamId === state.myTeam
    e.heat *= mate ? 0.8 : !p?.teamId ? 0.9 : DECAY
    if (!e.on) continue
    if (mate) {
      e.on = false
      pushLog(state, 'info', `${e.ign} 成了你的队友，和他的旧账先放下。`)
    } else if (e.heat < COOL) {
      e.on = false
      pushLog(state, 'info', `和 ${e.ign} 的旧账淡了（${e.w} 胜 ${e.l} 负）。`)
    }
  }
  for (const [id, e] of Object.entries(b.list)) {
    if (!e.on && e.heat < 1 && RANK[e.why?.k ?? 'often'] < RANK.mate) delete b.list[id]
  }
  const idle = Object.values(b.list).filter((e) => !e.on).sort((x, y) => x.heat - y.heat)
  while (Object.keys(b.list).length > TRACK_MAX && idle.length) delete b.list[idle.shift()!.id]
}

export interface RivalView {
  id: string
  ign: string
  role: string
  /** his club's tag now */
  team: string
  heat: number
  word: string
  level: 0 | 1 | 2
  reason: string
  w: number
  l: number
}

const view = (state: GameState, e: RivalEntry): RivalView => {
  const p = state.players[e.id]
  return {
    id: e.id, ign: e.ign, role: e.role,
    team: p?.teamId ? state.teams[p.teamId]?.tag ?? '' : '',
    heat: Math.round(e.heat), word: heatWord(e.heat), level: heatLevel(e.heat),
    reason: rivalReason(e), w: e.w, l: e.l,
  }
}

/** The declared rivals, hottest first. */
export function activeRivals(state: GameState): RivalView[] {
  const b = state.me?.rivals
  if (!b) return []
  return onList(b).sort((x, y) => y.heat - x.heat).map((e) => view(state, e))
}

/** The hottest declared rival on that club's roster tonight, if any. */
export function rivalOnTeam(state: GameState, teamId: string): RivalView | null {
  const team = state.teams[teamId]
  const b = state.me?.rivals
  if (!team || !b) return null
  const hit = onList(b)
    .filter((e) => team.roster.includes(e.id))
    .sort((x, y) => Number(team.starters.includes(y.id)) - Number(team.starters.includes(x.id)) || y.heat - x.heat)[0]
  return hit ? view(state, hit) : null
}

/**
 * What a rival on the other five does to my calls: a steady head plays up to
 * him, a shaky one tightens. At most three points either way.
 */
export function rivalNodeEdge(state: GameState, oppTeamId: string): number {
  const me = state.me
  if (!me || !rivalOnTeam(state, oppTeamId)) return 0
  return clamp((me.mental - 50) / 400 - (me.tilt >= 55 ? 0.01 : 0), -0.03, 0.03)
}
