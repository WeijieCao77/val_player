import type { GameState } from '../types'

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

  // what is next for me is the week board's own 下一场 panel, right beside this; not repeated here
  return out
}
