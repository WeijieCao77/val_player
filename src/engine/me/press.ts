import type { GameState } from '../types'
import { nextRealFixtureFor } from '../season'

/**
 * The week's paper, written for a player.
 *
 * What I did (my matches, a cup run, a contract), what changed around me —
 * who left, who was signed, who is now on which roster — and what is next.
 * The manager's desk stays out of it: market listings, sponsors and whom to
 * rest are not news to a player, they are somebody else's job.
 */
export function weekReport(state: GameState): string[] {
  const me = state.me!
  const from = state.day - 7
  const out: string[] = []
  const inWeek = (day: number) => day > from && day <= state.day

  // mine first
  const MINE = new Set(['match', 'cup', 'deal', 'team', 'good', 'bad', 'season'])
  for (const l of me.log.filter((l) => inWeek(l.day) && MINE.has(l.kind)).slice(-4)) out.push(l.text)

  // roster moves: who left, who was signed — my club's first, then the big ones
  const myTeam = me.phase === 'pro' ? state.teams[state.myTeam] : null
  const news = state.news.filter((n) => inWeek(n.day))
  const moves = news.filter((n) => n.kind === 'transfer' || n.kind === 'player')
  const ranked = [
    ...moves.filter((n) => myTeam && n.text.includes(myTeam.name)),
    ...moves.filter((n) => n.important && !(myTeam && n.text.includes(myTeam.name))),
    ...moves.filter((n) => !n.important && !(myTeam && n.text.includes(myTeam.name))),
  ]
  const seen = new Set<string>()
  for (const n of ranked) {
    if (seen.has(n.text)) continue
    seen.add(n.text)
    out.push(`📰 ${n.text}`)
    if (seen.size >= 3) break
  }

  // the league itself: a title, a qualification, a relegation
  for (const n of news.filter((n) => n.kind === 'league' && n.important).slice(-2)) out.push(`🏆 ${n.text}`)

  // what is next for me
  if (myTeam) {
    const f = nextRealFixtureFor(state, state.myTeam)
    if (f) {
      const opp = state.teams[f.teamA === state.myTeam ? f.teamB : f.teamA]
      const weeks = Math.ceil((f.day - state.day) / 7)
      const comp = state.comps[f.comp]?.name ?? f.comp
      out.push(`📅 下一场 · vs ${opp?.name ?? '?'}（${comp}）· ${weeks <= 0 ? '本周' : `${weeks} 周后`}`)
    }
  }
  return out
}
