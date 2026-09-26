/**
 * Who opens a series' map veto, read off the fixture — and the grand final's upper-bracket hand.
 *
 * Reported 2026-09-26: 「胜者组进决赛没有获得两ban一选，导致打的第一张图是劣势地图」. Every series
 * ran the same alternating veto from side A, so a club that came through the upper bracket banned one
 * map, the side from the lower bracket banned the other, and in the few brackets written with the
 * upper finalist second the first map was the other side's.
 *
 * What the real circuit did, off vlr.gg's veto lines:
 *
 *  - 2022 on, Masters and Champions grand finals: the upper-bracket finalist makes both bans, then the
 *    picks alternate from him (maps one and three his, two and four the other side's, the last left is
 *    the decider). Masters Reykjavík 2022 (vlr.gg/85530, LOUD), Copenhagen 2022 (vlr.gg/112327, PRX),
 *    Champions 2022 (vlr.gg/130685, LOUD), Tokyo 2023 (vlr.gg/220448, FNC), Champions 2023
 *    (vlr.gg/248277, PRX), Madrid 2024 (vlr.gg/312779, GEN), Toronto 2025 (vlr.gg/498628, PRX),
 *    Santiago 2026 (vlr.gg/626544, NS), London 2026 (vlr.gg/670471, PRX).
 *  - 2023 on, the VCT leagues' playoff grand finals, the same: Americas 2023 (vlr.gg/189055, LOUD),
 *    Pacific Stage 2 2024 (vlr.gg/365321, GEN), EMEA Stage 1 2024 (vlr.gg/341821, TH), China Stage 1
 *    2024 (vlr.gg/342363, FPX).
 *  - 2024 on, Ascension's grand final, the same: China 2024 (vlr.gg/400164, RA). 2023's is not on
 *    record here (Pacific's was a single elimination), so 2023 is played as Challengers.
 *  - 2021, and Challengers throughout: the upper-bracket side opens an ordinary alternating veto.
 *    Masters Reykjavík 2021 (vlr.gg/19089, five maps: 「SEN pick Split; FNC pick Bind; …」), NA
 *    Challengers 2021 (vlr.gg/25200 XSET, vlr.gg/29398 SEN), NA Challengers Stage 1 2022
 *    (vlr.gg/77792, OPTC ban · TGRD ban · OPTC pick …). NA Challengers 2024 Stage 2 (vlr.gg/372553)
 *    shows the upper side could take the second slot instead; opening it is the hand this game gives.
 *  - Every other series: the fixture's side A — the higher seed, as the bracket writes it — opens.
 *
 * Not modelled: 2021's first Challengers finals gave the upper finalist a one-map lead instead
 * (「1 Map Advantage」, vlr.gg/9289); here they open the veto like the rest of 2021.
 */
import { eventOf, isLeagueEvent } from '../circuit'
import type { VetoLead } from '../match'
import type { Competition, Fixture, GameState } from '../types'
import { isIntlComp } from './compclass'

const roundOf = (f: Fixture): string => f.label.replace(/^(KO|SW):\d+:/, '').trim()
const isGrandFinal = (f: Fixture): boolean => /总决赛$|grand\s*finals?$/i.test(roundOf(f))
const isLower = (round: string): boolean => /败者组|lower/i.test(round)
const isUpper = (round: string): boolean => /胜者组|upper/i.test(round)

const fixtureNo = (f: Fixture): number => Number(/^F(\d+)$/.exec(f.id)?.[1] ?? 0)

/** The side's last played tie in this event before `f`: its round, and whether it won. */
function cameFrom(state: GameState, f: Fixture, team: string): { round: string; won: boolean } | null {
  let last: Fixture | null = null
  for (const x of state.fixtures) {
    if (x.comp !== f.comp || x.id === f.id || !x.played || !x.result || x.day > f.day) continue
    if (x.teamA !== team && x.teamB !== team) continue
    if (!last || x.day > last.day || (x.day === last.day && fixtureNo(x) > fixtureNo(last))) last = x
  }
  if (!last?.result) return null
  const won = (last.result.mapsWonA > last.result.mapsWonB) === (last.teamA === team)
  return { round: roundOf(last), won }
}

/**
 * The grand final side that came through the upper bracket unbeaten: its last tie an upper-bracket
 * win, the other side's a lower-bracket win or a loss. Null when the bracket does not say.
 */
export function upperFinalist(state: GameState, f: Fixture): 'a' | 'b' | null {
  if (!isGrandFinal(f)) return null
  const a = cameFrom(state, f, f.teamA)
  const b = cameFrom(state, f, f.teamB)
  if (!a || !b) return null
  const up = (x: { round: string; won: boolean }) => x.won && isUpper(x.round) && !isLower(x.round)
  const down = (x: { round: string; won: boolean }) => !x.won || isLower(x.round)
  if (up(a) && down(b)) return 'a'
  if (up(b) && down(a)) return 'b'
  return null
}

/** Does this event's grand final give the upper finalist both bans (see the note above)? */
function bothBans(state: GameState, comp: Competition | undefined): boolean {
  if (!comp) return false
  const year = state.year
  if (isIntlComp(comp.name)) return year >= 2022
  const ev = comp.circuit ? eventOf(comp.circuit.id) : undefined
  if (ev && isLeagueEvent(year, ev)) return true
  if (comp.stage === 'ascension' || ev?.stage === 'ascension' || /晋级赛|Ascension/i.test(comp.name)) return year >= 2024
  return false
}

/**
 * The veto's lead for a fixture of a career. Undefined — side A opens, as always — for a scrim, a
 * manager's save (its watched matches run their own veto, ui/MatchLive.tsx), and anything but a grand
 * final whose upper finalist the bracket shows.
 */
export function vetoLeadOf(state: GameState, f: Fixture): VetoLead | undefined {
  if (!state.me || f.scrim) return undefined
  const side = upperFinalist(state, f)
  if (!side) return undefined
  return { side, both: f.bo === 5 && bothBans(state, state.comps[f.comp]), upper: true }
}
