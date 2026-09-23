import type { GameState } from '../types'
import { SEASON_DAYS } from '../calendar'
import { mateLine } from './chatter'

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
  // the manager's own trophy line (engine/season.ts settleCompetition): 「🏆 我们夺得 X 冠军！」 beside the league's
  // 「🏆 TSM 夺得 X 冠军！」 read as a second title won by a club called 我们 (reported 2026-09-21, 7161c4da:
  // 「有些战队的名字出错」). The league's line and my own 冠军 line already say it.
  '我们夺得',
].join('|'))

/** The roster news a manager's desk wrote for itself: a bid for one of ours, a clause we could not refuse, a man we had asked about. */
const DESK_NEWS = /等待我们答复|我们无权拒绝|你此前正在接触/

/** Engine digest lines that belong to the manager's desk (see DESK_NOTE). */
export const deskLine = (line: string): boolean => DESK_NOTE.test(line)

/**
 * A news line that already opens on its own icon keeps just that one. Found 2026-09-18 in a copy audit: a title
 * read 「🏆 🏆 BESTIA 夺得 挑战者联赛 · 拉美南区 · LATAM South ACE Masters 冠军！」 in the weekly report — the
 * engine writes 🏆 on a champion's line (engine/season.ts), 👋 on a retirement, 🏛️ on a seat, and this page put its
 * own 🏆 or 📰 in front of every one of them.
 */
const OWN_ICON = /^\p{Extended_Pictographic}/u
const marked = (icon: string, text: string): string => (OWN_ICON.test(text) ? text : `${icon} ${text}`)

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
  const now = state.year * SEASON_DAYS + state.day
  const out: string[] = []
  // The simulation has 364-day seasons. A day number alone would replay last
  // year's news, while a Gregorian date would drop days at the season boundary.
  const inWeek = (year: number | undefined, day: number) => {
    if (!Number.isInteger(year) || year! > state.year || !Number.isInteger(day) || day < 0 || day > SEASON_DAYS) return false
    const at = year! * SEASON_DAYS + day
    return at > now - 7 && at <= now
  }

  // What the week has already put on its paper as it happened — an achievement, a ceiling that gave, the
  // season's turn (me/achievements.ts, me/bottleneck.ts say): those writers log the line and put it in the week
  // at once, so reading them back from the log said each of them twice in one report (reported 2026-09-21,
  // 7161c4da: 「把以前发生的事再次拿出来说」 — a 2021 week read 「成就：第一次首发」 at the top and again at the
  // bottom). The paper is unshifted in front of the week's notes (me/week.ts), so a line already there is left out.
  const onPaper = new Set(me.weekNotes)
  const fresh = (text: string) => !onPaper.has(text)

  // mine first
  const MINE = new Set(['match', 'cup', 'deal', 'team', 'good', 'bad', 'season'])
  for (const l of me.log.filter((l) => inWeek(l.year, l.day) && MINE.has(l.kind) && fresh(l.text)).slice(-4)) out.push(l.text)
  // and one of the five saying something about it, when something happened (me/chatter.ts)
  const said = mateLine(state)
  if (said) out.push(said)

  // roster moves: who left, who was signed — my club's first, then the big ones
  const myTeam = me.phase === 'pro' ? state.teams[state.myTeam] : null
  // Old news lacking a year stays in the saved history, but is not evidence
  // of something happening this week. Every new writer now records its year.
  const news = state.news.filter((n) => inWeek(n.year, n.day) && !DESK_NEWS.test(n.text) && fresh(n.text))
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
    out.push(marked('📰', n.text))
    if (seen.size >= 3) break
  }

  // the league itself: a title, a qualification, a relegation
  for (const n of news.filter((n) => n.kind === 'league' && n.important).slice(-2)) out.push(marked('🏆', n.text))

  // what is next for me is the week board's own 下一场 panel, right beside this; not repeated here
  return out
}
