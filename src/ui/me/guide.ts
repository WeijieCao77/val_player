/**
 * 导览：这一段要干什么，这周怎么过，和第一次签约以后多出来的几件事。
 *
 * The career opened on a week screen that said nothing about how a week works,
 * and a first game is kept or dropped in that first week. 破晓 walks a new
 * player through its screens once before going pro and once in the first
 * season, and keeps the same text on a help page; this is that mechanism, in
 * our own words. One real element lit at a time, one or two short sentences,
 * skippable at every step.
 *
 * Goal first (reported 2026-09-18: 「没有进来的引导教学，不知道下一步要点哪，不知道
 * 哪些是重要的事情哪些是休赛期点的」). The tour used to be twelve steps naming the
 * regions of the page — 这一块是你, 数值, 栏目, 天梯 … — and never said what they
 * were for. Now it opens on the phase's goal (engine/me/goal.ts), then answers
 * 「现在做什么」 in five steps: which cards serve the goal, the recommended plan,
 * the clock, and what stops it. What a region of the page is has moved to 帮助
 * (pageNotes), in the same words.
 *
 * Every sentence says what the code does, and the numbers in it — the action
 * points, the recommended plan's 体力, the transfer windows — are read from the
 * engine's own constants, so the tour cannot drift away from them.
 *
 * A step finds what it lights by what the player sees: a panel by its title, a
 * button by its label. Nothing is added to the screens it points at, and a
 * target that is not on the page is skipped rather than pointed at wrongly.
 *
 * What has been seen belongs to the browser, as the numbers switch does
 * (words.ts). A tour finished or skipped does not come back by itself;
 * 「不再显示」 stops every tour coming back by itself. 帮助 reopens any of them.
 * The 下一步 card put away (「收起」) is the browser's as well, one flag a phase.
 */
import { useSyncExternalStore } from 'react'
import type { GameState } from '../../engine/types'
import { ACTION_BY_KEY, AP_HURT, AP_SEASON, DUELS_PER_WEEK } from '../../engine/me/actions'
import { AP_PRE } from '../../engine/me/prepro'
import { PROMISE_FLOOR, TRIAL_MATCHES } from '../../engine/me/coach'
import { WEEK_END_FATIGUE } from '../../engine/me/auto'
import { windowLine } from '../../engine/me/window'
import { weekInDays } from '../../engine/me/week'
import { cupAhead, goalOf } from '../../engine/me/goal'
import type { GoalPhase } from '../../engine/me/goal'

/** The week screen without a club, the week screen with one, and what signing adds. */
export type TourKind = 'pre' | 'club' | 'season'

const SEEN = 'val_player.tour.'
const OFF = 'val_player.tour.off'

// storage can be blocked outright; what was decided this session holds either way
const mem = new Map<string, boolean>()
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function flag(key: string): boolean {
  const v = mem.get(key)
  if (v !== undefined) return v
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

function setFlag(key: string, v: boolean): void {
  mem.set(key, v)
  try {
    if (v) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch { /* private mode: lasts the session */ }
  emit()
}

export const tourSeen = (kind: TourKind): boolean => flag(SEEN + kind)
export const markTourSeen = (kind: TourKind): void => setFlag(SEEN + kind, true)
/** 「不再显示」: no tour opens by itself in this browser; 帮助 still opens them. */
export const toursOff = (): boolean => flag(OFF)
export const setToursOff = (v: boolean): void => setFlag(OFF, v)
export const useToursOff = (): boolean => useSyncExternalStore(subscribe, toursOff, toursOff)

/** the tour on screen; `seq` tells one opening from the next, so a reopened tour starts from its first step */
let open: { kind: TourKind | null; seq: number } = { kind: null, seq: 0 }
export function openTour(kind: TourKind): void {
  open = { kind, seq: open.seq + 1 }
  emit()
}
export function closeTour(): void {
  if (!open.kind) return
  open = { kind: null, seq: open.seq }
  emit()
}
const readOpen = () => open
export const useOpenTour = (): { kind: TourKind | null; seq: number } => useSyncExternalStore(subscribe, readOpen, readOpen)

/** The week screen's tour for where the career is now: the screen differs with a club and without. */
export const weekTourOf = (g: GameState | null | undefined): TourKind => (g?.me?.phase === 'pro' ? 'club' : 'pre')

/**
 * The 下一步 card (ui/me/NextStep.tsx) put away, a phase at a time: put away without a club, it is up
 * again the week a contract is signed, when the goal changes; 帮助 brings either back.
 */
const NEXT = 'val_player.next.hide.'
export const nextHidden = (phase: GoalPhase): boolean => flag(NEXT + phase)
export const setNextHidden = (phase: GoalPhase, v: boolean): void => setFlag(NEXT + phase, v)
const readNextPre = () => nextHidden('pre')
const readNextPro = () => nextHidden('pro')
export const useNextHidden = (phase: GoalPhase): boolean =>
  useSyncExternalStore(subscribe, phase === 'pre' ? readNextPre : readNextPro, phase === 'pre' ? readNextPre : readNextPro)

/**
 * Whether the 下一步 card is on the week page: a goal to name, in the phase's first stretch — the
 * whole of the time without a club, a professional career's first season — and not put away.
 */
export function nextCardDue(g: GameState): boolean {
  const goal = nextCardWindow(g)
  return !!goal && !nextHidden(goal.phase)
}

/** The goal, while the card belongs on the week page whether or not it has been put away. */
export function nextCardWindow(g: GameState): ReturnType<typeof goalOf> {
  const goal = goalOf(g)
  if (!goal) return null
  if (goal.phase === 'pro' && !g.me!.seasons.every((s) => s.tier === 0)) return null
  return goal
}

/**
 * The tour that opens by itself now, if any. The week screen's, in a career's
 * first week, for the start it was given. What signing adds, once there is a
 * club and no professional season behind it — and only after the clock has
 * moved at least a day, so a club start is not handed two tours back to back.
 * A save already past its first week gets neither: 帮助 has them.
 */
export function dueTour(g: GameState): TourKind | null {
  const me = g.me
  if (!me || me.phase === 'retired' || g.gameOver || toursOff()) return null
  const week = weekTourOf(g)
  if (me.week === 0 && !tourSeen(week)) return week
  if (me.phase === 'pro' && !tourSeen('season') && (me.week > 0 || me.weekDay > 0) && me.seasons.every((s) => s.tier === 0)) return 'season'
  return null
}

/** What a step lights: the first element matching `sel` — when `text` is given, the first whose label holds it (a panel's label is its title). */
export interface TourTarget { sel: string; text?: string | string[] }

export interface TourStep {
  /** the page it is on; the tour takes the player there */
  screen: string
  /** lit together; with none, the card stands in the middle */
  at?: TourTarget[]
  title: string
  body: string
}

const WEEK = 'week'
const panel = (title: string): TourTarget => ({ sel: '.panel', text: title })
const ADVANCE: TourTarget = { sel: '.advance-me button', text: ['推进一周', '推进一天', '打今天的比赛'] }

/**
 * The phase's goal, lit on the 下一步 card when it is up (ui/me/NextStep.tsx), standing in the middle
 * when it has been put away. Without a club: the four roads, which the card measures.
 */
function goalStep(g: GameState, title: (goal: string) => string): TourStep[] {
  const goal = goalOf(g)
  if (!goal) return []
  const card = nextCardDue(g)
  const how = goal.phase === 'pre'
    ? `${goal.how}${card ? '这张卡写着每条路还差多远，和这周最值得做的一件事。' : ''}`
    : `${goal.how}${card ? '这张卡写着离它还差什么，和这周最值得做的一件事。' : ''}`
  return [{ screen: WEEK, at: card ? [{ sel: '.next-step' }] : undefined, title: title(goal.title), body: how }]
}

/** the blocks of the week board holding this goal's 重点 cards (Week.tsx data-group) */
function focusGroups(g: GameState): TourTarget[] {
  const kind = goalOf(g)?.kind
  if (kind === 'contract') return [{ sel: '.act-group[data-group="train"]' }]
  if (kind === 'seat') return [{ sel: '.act-group[data-group="team"]' }]
  return [{ sel: '.act-group[data-group="train"]' }, { sel: '.act-group[data-group="team"]' }]
}

/** what the 重点 tags mark for this goal, and when the 调剂 ones are right (engine/me/goal.ts weightsOf, fillerNote) */
function focusBody(g: GameState): string {
  const kind = goalOf(g)?.kind
  const tap = '点卡片安排一次，「−」退回。'
  if (kind === 'contract') {
    return `标「重点」的卡对目标最有用：枪法、复盘、道具涨综合，杯赛和试训都看它；打排位爬天梯。标「调剂」的几张，体力见底、缺钱或想走粉丝这条路时再点。${tap}`
  }
  const filler = '标「调剂」的几张，体力见底、缺钱或签了直播合约时再点。'
  if (kind === 'seat') return `标「重点」的是对位挑战和跟队训练赛：对位当场就打，训练赛让教练看得见你。${filler}${tap}`
  return `标「重点」的是跟队训练赛和眼下最值的一项练习：教练看得见你，综合也在涨。${filler}${tap}`
}

export function tourSteps(kind: TourKind, g: GameState): TourStep[] {
  if (kind === 'season') return seasonSteps(g)
  const pro = kind === 'club'
  const days = pro && weekInDays(g)
  const calm = 100 - WEEK_END_FATIGUE
  const cup = pro ? null : cupAhead(g)
  const week: TourStep[] = [
    ...goalStep(g, (goal) => `目标：${goal}`),
    {
      screen: WEEK, at: [{ sel: '.ap-chip' }], title: '行动点',
      body: pro
        ? `签约后每周 ${AP_SEASON} 点，受伤时只有 ${AP_HURT} 点。推进以后，没用完的作废。`
        : `没有队伍时每周 ${AP_PRE} 点，签约后每周 ${AP_SEASON} 点。推进以后，没用完的作废。`,
    },
    {
      screen: WEEK, at: focusGroups(g), title: '这周做什么',
      body: focusBody(g),
    },
    {
      screen: WEEK, at: [{ sel: '.advance-me button', text: '按推荐安排' }], title: '按推荐安排',
      body: pro
        ? `不知道怎么排就按这个：剩下的点按稳妥的路子填满，这周要打的比赛也算进去，周末体力留在 ${calm} 上下。填完还能改。`
        : `不知道怎么排就按这个：剩下的点按稳妥的路子填满，补短板、打排位，周末体力留在 ${calm} 上下。填完还能改。`,
    },
    pro
      ? {
        screen: WEEK, at: [{ sel: '.week-days' }, ADVANCE], title: days ? '一天一推' : '推进',
        body: days
          ? '这周你队有两场以上比赛，改成一天一推：上面七格是这一周，比赛日当天开打，打完回到这里。'
          : '一次推一周，推到你队的比赛就停下来让你打。一周有两场以上比赛时，改成一天一推。',
      }
      : {
        screen: WEEK, at: [ADVANCE], title: '推进',
        body: '「推进一周」结算这周。空窗期用旁边的「快进到…」一次推几周：没排的周按推荐来，小事替你定，合同和试训邀请会停下来等你。',
      },
    {
      screen: WEEK, at: [{ sel: '.advance-me .hint' }], title: '停下来等你的事',
      body: pro
        ? '比赛日、事件、报价、仪式会弹成卡片，时钟停下来等你选，选完接着走。'
        : `杯赛报名、试训邀请、合同会弹成卡片，时钟停下来等你选，选完接着走。${cup ? (cup.weeks === 0 ? `这周就是${cup.name}报名。` : `下一项杯赛是 ${cup.weeks} 周后的${cup.name}。`) : ''}`,
    },
  ]
  return week
}

/**
 * What each region of the week page is, for 帮助: the steps the tour used to walk before it went goal
 * first, in the same words, so the page and the help cannot say two things.
 */
export function pageNotes(g: GameState): { title: string; body: string }[] {
  const pro = g.me?.phase === 'pro'
  const notes = [
    {
      title: '下一步',
      body: '本周页最上面那张卡：这一段的目标、这周最值得做的一件事；没有队伍时还写着离每条路还差多远。没有队伍的整段时间和签约后的第一个赛季里都在；点「收起」就不再显示，这一页最上面能恢复。',
    },
    {
      title: '「重点」和「调剂」',
      body: '行动卡右上角的小字。「重点」对眼下的目标最有用；「调剂」是赛场外的事，体力见底、缺钱、想走粉丝这条路或者签了直播合约时，它们才是对的选择。没有标的卡，看情况。',
    },
    {
      title: '上面一块是你',
      body: `第一行是名字、${pro ? '效力的队、首发还是替补、' : ''}赛段和日期，第二行是段位、粉丝、资金、状态。下面贴顶的那一行往下翻也一直在：本周还剩几点行动、体力，然后是综合能力，有卡在瓶颈的会点出来；八项属性的细节在「我的」页。`,
    },
    {
      title: '文字还是数字',
      body: '属性默认用文字说：职业级、一流、顶级……「综合」那一行右端的「数值」换成具体数字，再点一下换回来。',
    },
    {
      title: '栏目',
      body: pro
        ? '「队伍」看名单和首发之争，「赛程」看你队的比赛，「转会」看合同和报价。「帮助」里有规则说明，也能重看导览。'
        : '「我的」看属性和瓶颈，「转会」看各档俱乐部要什么水平、发自荐。「帮助」里有规则说明，也能重看导览。',
    },
    {
      title: '体力',
      body: '贴顶那一行和「本周行动」里的体力条是同一个数。安排的事先从这里扣，排了会累的事，旁边写「安排后」还剩多少；休息和身体自己回的那些在周末补上。低于四成，状态和比赛发挥明显下滑。',
    },
  ]
  return notes.concat(pro
    ? [
      { title: '下一场', body: '对手、赛事、纸面赢面，还有教练这周排没排你首发。' },
      { title: '教练怎么看你', body: '他的信任决定你能不能留在首发。跟队训练赛、对位挑战和正赛表现都会改变它。' },
    ]
    : [
      { title: '天梯', body: '一点行动打六把排位，分数朝你的真实水平走，越高越难爬。不打分数不掉，但神话起别人还在涨分，名次会往后掉。' },
      { title: '今年的赛事', body: '到了开打那一周，会弹卡片问你报不报名。四个路人队友，走得越远越容易被俱乐部记住。' },
      { title: '怎么被看见', body: '俱乐部从杯赛、天梯、粉丝三处发现你；不想干等，也可以在「转会」页挑一家发自荐。邀请来了去试训，拿到合同就进了职业。' },
    ])
}

/**
 * The first club: the new goal, who plays, how to get in, what a match asks of you, and when the market
 * opens. A club start was told its goal on the week's own tour a day or two before, so it is not told twice.
 */
function seasonSteps(g: GameState): TourStep[] {
  const told = tourSeen('club') && (g.me?.week ?? 0) <= 2
  return [
    ...(told ? [] : goalStep(g, (goal) => `新目标：${goal}`)),
    {
      // the roster panel is titled with the club's name, so 「名单」 found nothing and this step was always skipped
      screen: 'team', at: [panel('首发之争')], title: '首发之争',
      body: `教练每周一排出首发五人，看综合、状态、疲劳和他对你的信任。合同写明首发的，前 ${PROMISE_FLOOR} 场写死是你的，之后归教练排。`,
    },
    {
      screen: WEEK, at: [{ sel: '.act-card', text: '对位挑战' }], title: '对位挑战',
      body: `坐替补时花 ${ACTION_BY_KEY.duel.cost} 点，向同位置的首发发起三局两胜的对位，每周最多 ${DUELS_PER_WEEK} 次。攒够资本，教练给你 ${TRIAL_MATCHES} 场正赛的试用期。`,
    },
    {
      screen: WEEK, at: [panel('下一场')], title: '比赛里的决定',
      body: '你首发的比赛，每张图会停下来问你几次怎么打；每个选项看一项属性或心态，越冒险输赢摆得越大。坐替补和快进的比赛不问。',
    },
    {
      screen: 'transfer', at: [panel('市场怎么看你')], title: '转会窗',
      // the year's own rule and today's state (engine/me/window.ts); the full rule is on the help page.
      // An open-era line already says there is no fixed window: the rule is not said a second time
      body: (() => {
        const line = windowLine(g)
        const rule = g.year <= 2022 ? '这两年没有固定窗口，俱乐部不打大赛就能转' : '俱乐部打赛事期间整段锁名单，只有两项赛事之间的空档和休赛期开窗'
        return `${line}${line.includes('没有固定窗口') ? '' : `。${rule}`}（详见「帮助」）。赛段里打得好，别队教练会记下你，窗口开着就可能来报价。`
      })(),
    },
  ]
}
