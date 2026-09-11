/**
 * 导览：第一周怎么过，和第一次签约以后多出来的几件事。
 *
 * The career opened on a week screen that said nothing about how a week works,
 * and a first game is kept or dropped in that first week. 破晓 walks a new
 * player through its screens once before going pro and once in the first
 * season, and keeps the same text on a help page; this is that mechanism, in
 * our own words. One real element lit at a time, one or two short sentences,
 * skippable at every step.
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
 */
import { useSyncExternalStore } from 'react'
import type { GameState } from '../../engine/types'
import { ACTION_BY_KEY, AP_HURT, AP_SEASON, DUELS_PER_WEEK } from '../../engine/me/actions'
import { AP_PRE } from '../../engine/me/prepro'
import { TRIAL_MATCHES } from '../../engine/me/coach'
import { WEEK_END_FATIGUE } from '../../engine/me/auto'
import { PLAYER_WINDOWS, windowLabel } from '../../engine/me/transfer'
import { weekInDays } from '../../engine/me/week'

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

export function tourSteps(kind: TourKind, g: GameState): TourStep[] {
  if (kind === 'season') return seasonSteps()
  const pro = kind === 'club'
  const days = pro && weekInDays(g)
  const calm = 100 - WEEK_END_FATIGUE
  const week: TourStep[] = [
    {
      screen: WEEK, at: [{ sel: '.hero' }, { sel: '.pinbar' }], title: '这一块是你',
      body: `${pro ? '效力的队、首发还是替补' : '段位、粉丝、资金'}、体力、状态都在这里。下面一行是八项属性，卡在瓶颈的那项是金色。`,
    },
    {
      screen: WEEK, at: [{ sel: '.pins-fab' }], title: '文字还是数字',
      body: '属性默认用文字说：职业级、一流、顶级……右下角「数值」换成具体数字，再点一下换回来。',
    },
    {
      screen: WEEK, at: [{ sel: '.nav' }], title: '左边的栏目',
      body: pro
        ? '「队伍」看名单和首发之争，「赛程」看你队的比赛，「转会」看合同和报价。「帮助」里有规则说明，也能重看导览。'
        : '「我的」看属性和瓶颈，「转会」看各档俱乐部要什么水平。「帮助」里有规则说明，也能重看导览。',
    },
    {
      screen: WEEK, at: [{ sel: '.topbar .chip' }], title: '行动点',
      body: pro
        ? `签约后每周 ${AP_SEASON} 点，受伤时只有 ${AP_HURT} 点。推进以后，没用完的作废。`
        : `没有队伍时每周 ${AP_PRE} 点，签约后每周 ${AP_SEASON} 点。推进以后，没用完的作废。`,
    },
    {
      screen: WEEK, at: [{ sel: '.act-group' }], title: '行动卡',
      body: '点一下卡片就安排一次，「−」退回，一周结束时一起结算。灰掉的卡下面写着还差什么。',
    },
    {
      screen: WEEK, at: [{ sel: '.winbar-row', text: '体力' }], title: '体力',
      body: '安排的事先从这条上扣，休息和身体自己回的那些在周末补上。低于四成，状态和比赛发挥明显下滑。',
    },
    {
      screen: WEEK, at: [{ sel: '.advance-me button', text: '按推荐安排' }], title: '按推荐安排',
      body: pro
        ? `把剩下的点按稳妥的路子填满，这周要打的比赛也算进去，周末体力留在 ${calm} 上下。填完还能改。`
        : `把剩下的点按稳妥的路子填满：补短板、打排位，周末体力留在 ${calm} 上下。填完还能改。`,
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
        body: '「推进一周」结算这周，时间往前走。旁边的按钮一次推几周：没排的周按推荐来，途中的事按稳妥的选法替你定。',
      },
    {
      screen: WEEK, at: [{ sel: '.advance-me .hint' }], title: '停下来等你的事',
      body: `${pro ? '事件、报价、仪式' : '杯赛、试训邀请、事件'}会弹成卡片，时钟停下来等你选，选完接着走。`,
    },
  ]
  const side: TourStep[] = pro
    ? [
      { screen: WEEK, at: [panel('下一场')], title: '下一场', body: '对手、赛事、纸面赢面，还有教练这周排没排你首发。' },
      { screen: WEEK, at: [panel('教练怎么看你')], title: '教练怎么看你', body: '他的信任决定你能不能留在首发。跟队训练赛、对位挑战和正赛表现都会改变它。' },
    ]
    : [
      { screen: WEEK, at: [panel('天梯')], title: '天梯', body: '一点行动打六把排位，分数朝你的真实水平走，越高越难爬。' },
      { screen: WEEK, at: [panel('今年的赛事')], title: '今年的赛事', body: '到了开打那一周，会弹卡片问你报不报名。四个路人队友，走得越远越容易被俱乐部记住。' },
      { screen: WEEK, at: [panel('怎么被看见')], title: '怎么被看见', body: '俱乐部从杯赛、天梯、粉丝三处发现你。邀请来了去试训，拿到合同就进了职业。' },
    ]
  return [...week, ...side]
}

/** The first club: who plays, how to get in, what a match asks of you, and when the market opens. */
function seasonSteps(): TourStep[] {
  return [
    {
      screen: 'team', at: [panel('名单')], title: '首发名单',
      body: '教练每周一排出首发五人，看综合、状态、疲劳和他对你的信任。合同写明首发的，他会让你首发。',
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
      body: `一年开两次：${PLAYER_WINDOWS.map(windowLabel).join('、')}。赛段里打得好，别队教练会记下你，窗口一开就来报价。`,
    },
  ]
}
