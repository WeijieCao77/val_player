import type { GameState } from '../types'

/**
 * A line from the manager's desk, which a player's week has no use for.
 *
 * A stop-gap for as long as the manager game's systems still run inside the
 * world's day (engine/season.ts): a bid for one of "our" players waiting on
 * "our" answer, a team-mate asking for a raise or sulking about his minutes, a
 * contract a manager has to renew, a veteran to be talked round on his profile
 * page, the board, sponsors, the finance screen. None of it is a player's
 * business and none of it can be answered from his screens, so it never reaches
 * his week. The manager's ordinary paperwork — the market board, the staff,
 * whom to rest — was kept out here already.
 */
const DESK_NOTE = new RegExp([
  // kept out from the start
  '董事会', '行动力', '赞助', '商务', '联盟', '捆绑', '报价', '问价', '教练组', '分析师', '申请', '工作邀请',
  '设施', '经理', '来谈', '轮休', '状态正热', '状态低迷', '新挂牌',
  // and what still got through: bids and clauses (engine/transfer.ts), raises and rumours (engine/life.ts),
  // promised minutes (engine/training.ts), expiries, retirement talks and job offers (engine/season.ts),
  // sponsors and the league's capsule (engine/commercial.ts, engine/leagueShare.ts), trust (engine/trust.ts)
  '等待我们答复', '我们无权拒绝', '解约金', '配不上现在的表现', '希望谈到', '对出场时间不满', '不续约他就走',
  '必须续约', '合同进入最后一年', '资料页当面谈', '执教', '达标奖金', '特别企划', '财务', '终止了合作', '婉拒了合作',
  '不信任管理层', '合理使用他', '正在关注',
].join('|'))

/** The roster news a manager's desk wrote for itself: a bid for one of ours, a clause we could not refuse, a man we had asked about. */
const DESK_NEWS = /等待我们答复|我们无权拒绝|你此前正在接触/

/** Engine digest lines that belong to the manager's desk (see DESK_NOTE). */
export const deskLine = (line: string): boolean => DESK_NOTE.test(line)

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
  const news = state.news.filter((n) => inWeek(n.day) && !DESK_NEWS.test(n.text))
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
