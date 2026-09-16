import { compClass, isIntlComp } from './compclass'
import { compCn } from './compname'
import type { Competition, GameState } from '../types'
import type { MeState } from './types'

/**
 * 大师赛 and 冠军赛, on the record.
 *
 * Reported 2026-09-16: 「点击推进到赛季末从来都不会模拟大师赛和冠军赛，我都已经是赛区
 * mvp 的选手了也有成就弹窗我打进了冠军赛，但是在点击推进到赛季末然后看总结的时候从没
 * 显示过世界赛的俱乐部战绩」.
 *
 * They are simulated. 「快进到赛季末」 plays them exactly as a week at a time does —
 * four careers run both ways, thirteen 大师赛 / 冠军赛 fields between them, and not
 * one tie different (scripts/probe_seasonend.ts). What was missing is that nothing
 * ever wrote them down: the season's own line kept 冠军 and 出线 and nothing else
 * (me/week.ts onSeasonEnd), so a club that flew out to a Masters and lost its Swiss
 * round left no trace anywhere — not on the 赛季结束 card, not in the 生涯 table.
 * Eleven of those thirteen campaigns said nothing at all; the two that showed up
 * were the two the club won, and they showed up as titles.
 *
 * A substitute is the one who feels it: at 圣地亚哥大师赛 the career sat all four
 * matches on the bench, so no match screen ever opened either, and from that seat
 * the event may as well not have happened.
 *
 * So every 大师赛 / 冠军赛 / LOCK//IN my club plays is written down the day it ends,
 * off my own record of it — the matches I started and the ones I watched from the
 * bench alike. It is kept rather than read back later because the year's
 * competitions are cleared the moment the year turns (engine/season.ts openYear),
 * before the season's row is built.
 */

const over = (comp: Competition): boolean => !!comp.champion || !!comp.circuit?.done

/** The place a side finished in, joint places counted the way the prize table counts them (me/money.ts placeAt). */
function placeOf(comp: Competition, club: string): number | null {
  const at = comp.finished.indexOf(club)
  if (at < 0) return null
  return comp.places?.[at] ?? at + 1
}

/**
 * An international of my club's that has just ended: its record, in words.
 *
 * Only an event I was on the books for — my own record has to hold a match of it —
 * so a club's campaign from before I signed is not written into my season. Once per
 * event per year.
 */
export function noteIntlRun(state: GameState): void {
  const me = state.me
  const club = state.myTeam
  if (!me || me.phase !== 'pro' || !club) return
  for (const comp of Object.values(state.comps)) {
    if (!isIntlComp(comp.name) || !over(comp)) continue
    const key = `${state.year}:${comp.key}`
    const runs = (me.intlRuns ??= [])
    if (runs.some((r) => r.key === key)) continue
    // matchplay.ts writes the competition's name into my record, not its key
    const mine = me.matches.filter((m) => m.year === state.year && !m.friendly && m.comp === comp.name)
    if (!mine.length) continue
    const wins = mine.filter((m) => m.won).length
    const losses = mine.filter((m) => !m.won && !m.drawn).length
    const starts = mine.filter((m) => m.started).length
    // the champion's own placing, so the number and the word can never disagree
    const place = comp.champion === club ? (placeOf(comp, club) ?? 1) : placeOf(comp, club)
    const how = comp.champion === club ? '夺冠' : place ? `第 ${place} 名` : '没能排上名次'
    runs.push({
      year: state.year, key, comp: comp.name, matches: mine.length, starts, wins,
      // the two facts the line states in words, kept apart from it so a campaign can be
      // ranked without reading the prose back — 冠军赛 above 大师赛, and a 3–4 finish
      // above a group exit. The line itself is unchanged: it is rendered as authored.
      cls: compClass(comp.name), ...(place != null ? { place } : {}),
      line: `${compCn(comp.name)} ${wins} 胜 ${losses} 负 · ${how}`
        + `（你${starts ? `首发 ${starts} 场` : '没有出场'}）`,
    })
    if (runs.length > 40) runs.splice(0, runs.length - 40)
  }
}

/** That season's 大师赛 / 冠军赛 lines: the season's row, the card that closes it, and the 生涯 table. */
export const intlLinesOf = (me: MeState, year: number): string[] =>
  (me.intlRuns ?? []).filter((r) => r.year === year).map((r) => r.line)
