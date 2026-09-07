import { Rng, hashStr } from '../rng'
import type { GameState } from '../types'
import type { Axis, EffectSpec } from './types'
import { pushLog } from './log'
import { push, pop } from './pending'
import { applyEffect } from './fx'
import { addAxis } from './traits'
import { addQuest } from './quests'

export interface EventOpt { t: string; g: Axis; e: EffectSpec }
export interface EventDef {
  id: string
  /** weight in the weekly draw; 0 = only fired by a hook */
  w: number
  /** at most this many times a career */
  max: number
  when: (s: GameState) => boolean
  q: string
  ctx: string
  a: EventOpt[]
  /** the steady choice — what 按推荐 and 托管 take */
  rec: number
}

/** how often the dice roll at all; the content pool decides the rest */
export const EVENT_CHANCE = 0.14

const pro = (s: GameState) => s.me!.phase === 'pro'
const pre = (s: GameState) => s.me!.phase !== 'pro'
const starter = (s: GameState) => pro(s) && s.teams[s.myTeam]?.starters.includes(s.me!.id)
const benched = (s: GameState) => pro(s) && !s.teams[s.myTeam]?.starters.includes(s.me!.id)
const famous = (s: GameState, n: number) => s.me!.fans >= n
const streams = (s: GameState) => s.me!.stream.total >= 3

/**
 * The pool. Anything that can follow from a real event is fired by a hook
 * (w: 0) rather than drawn; the draw is for the things that just happen.
 * Every option has a cost somewhere, and every option leans on one of the
 * four axes that add up to who I am.
 */
export const EVENTS: EventDef[] = [
  // ---- life
  { id: 'family_call', w: 8, max: 6, when: () => true, rec: 0,
    q: '妈妈打电话来，问你什么时候回家一趟。', ctx: '你已经三个月没回去了。',
    a: [{ t: '这周回去两天', g: 'warm', e: { fatigue: -10, mental: 2, tilt: -8, note: '这周少两个行动点的时间，但人轻了' } },
      { t: '等打完这个赛段', g: 'grind', e: { mental: -1, xp: { awareness: 8 } } },
      { t: '寄点钱回去', g: 'warm', e: { money: -1500, mental: 1 } }] },
  { id: 'old_friend', w: 6, max: 3, when: () => true, rec: 1,
    q: '一个初中同学突然找你，说想借五千。', ctx: '他知道你现在有收入。',
    a: [{ t: '借', g: 'warm', e: { money: -5000, mental: 1 } }, { t: '借一千，别的免谈', g: 'hard', e: { money: -1000 } }, { t: '不借', g: 'hard', e: { mental: -1, note: '他把你拉黑了' } }] },
  { id: 'airport', w: 5, max: 4, when: (s) => famous(s, 300), rec: 0,
    q: '机场被粉丝堵住了，有人举着灯牌。', ctx: '航班还有四十分钟。',
    a: [{ t: '停下来签一会儿', g: 'warm', e: { heat: 25, fatigue: 4 } }, { t: '戴上帽子走人', g: 'hard', e: { heat: -10, fatigue: -2 } }, { t: '拍个合照发出去', g: 'show', e: { heat: 40, fatigue: 3 } }] },
  { id: 'insomnia', w: 7, max: 8, when: (s) => s.players[s.me!.id].fatigue >= 55, rec: 0,
    q: '连着几天睡不着，早上手是麻的。', ctx: '疲劳已经写在脸上。',
    a: [{ t: '这周多休息', g: 'grind', e: { fatigue: -15, form: -2 } }, { t: '吃褪黑素扛过去', g: 'grind', e: { body: -1, fatigue: -5 } }, { t: '去看医生', g: 'warm', e: { money: -800, fatigue: -12, body: 1 } }] },
  { id: 'car', w: 3, max: 1, when: (s) => s.me!.money >= 40000 && pro(s), rec: 1,
    q: '存款够买人生第一辆车了。', ctx: '队友都说不用买，俱乐部有班车。',
    a: [{ t: '买', g: 'show', e: { money: -35000, heat: 20, mental: 2 } }, { t: '再存存', g: 'grind', e: { mental: 1 } }] },
  // ---- the room
  { id: 'locker_blame', w: 0, max: 6, when: pro, rec: 1,
    q: '输球之后，一个队友在语音里把责任推给了你。', ctx: '所有人都听见了。',
    a: [{ t: '当场怼回去', g: 'hard', e: { bond: -12, mental: 1, tilt: 5 } }, { t: '先认，回头私下说', g: 'warm', e: { bond: 4, tilt: 3 } }, { t: '不说话，用下一场回答', g: 'grind', e: { quest: 'rumor', tilt: 6 } }] },
  { id: 'locker_dinner', w: 7, max: 9, when: pro, rec: 0,
    q: '队友约了聚餐，你今晚本来想加练。', ctx: '关系是聚出来的。',
    a: [{ t: '去', g: 'warm', e: { bond: 8, money: -300, fatigue: 2 } }, { t: '练完再去', g: 'grind', e: { bond: 3, xp: { aim: 10 }, fatigue: 5 } }, { t: '不去', g: 'grind', e: { bond: -4, xp: { aim: 16 } } }] },
  { id: 'coach_talk', w: 6, max: 6, when: benched, rec: 0,
    q: '教练把你叫到办公室，问你最近在想什么。', ctx: '他在给你机会说话。',
    a: [{ t: '说想上场，并且说为什么', g: 'hard', e: { coachTrust: 5, quest: 'scrim' } }, { t: '说会继续练', g: 'grind', e: { coachTrust: 3 } }, { t: '问他自己差在哪', g: 'warm', e: { coachTrust: 4, xp: { awareness: 12 } } }] },
  { id: 'rookie_help', w: 5, max: 5, when: starter, rec: 0,
    q: '队里新来的替补问你能不能带他复盘。', ctx: '他现在的处境和你当初一样。',
    a: [{ t: '带', g: 'warm', e: { bond: 10, fatigue: 3, coachTrust: 2 } }, { t: '没空', g: 'hard', e: { bond: -5, xp: { aim: 8 } } }] },
  { id: 'mate_leaves', w: 0, max: 5, when: pro, rec: 0,
    q: '和你最熟的队友官宣离队。', ctx: '更衣室空了一块。',
    a: [{ t: '发一条长文送别', g: 'show', e: { heat: 20, mental: -1 } }, { t: '私下吃顿饭', g: 'warm', e: { mental: 1, money: -400 } }, { t: '照常训练', g: 'grind', e: { xp: { teamwork: 10 } } }] },
  // ---- the trade
  { id: 'ad', w: 5, max: 5, when: (s) => famous(s, 120), rec: 0,
    q: '一个外设品牌找你拍广告，先付一半。', ctx: '尾款要求三周内直播两次。',
    a: [{ t: '接', g: 'show', e: { money: 4000, quest: 'ad' } }, { t: '不接，专心打比赛', g: 'grind', e: { mental: 1 } }] },
  { id: 'bible', w: 4, max: 1, when: (s) => pro(s) && famous(s, 200), rec: 1,
    q: '有人把你的语录做成了「圣经」，全网在传。', ctx: '有些话确实是你说的。',
    a: [{ t: '亲自下场玩梗', g: 'show', e: { heat: 60, coachTrust: -3 } }, { t: '当没看见，闷头训练', g: 'grind', e: { quest: 'bible' } }, { t: '发文澄清', g: 'hard', e: { heat: 15, fans: -10 } }] },
  { id: 'rumor', w: 0, max: 2, when: pro, rec: 1,
    q: '论坛上有人造谣你打假赛，帖子在首页。', ctx: '俱乐部让你先别回应。',
    a: [{ t: '直接回怼', g: 'hard', e: { heat: 35, gmTrust: -6, tilt: 8 } }, { t: '不回应，用下一场说话', g: 'grind', e: { quest: 'rumor' } }, { t: '让俱乐部发律师函', g: 'warm', e: { gmTrust: 3, heat: 5 } }] },
  { id: 'caster', w: 4, max: 2, when: (s) => starter(s) && famous(s, 100), rec: 0,
    q: '解说在直播里给你起了个外号，弹幕刷疯了。', ctx: '外号不算好听，但很上口。',
    a: [{ t: '认了，改成 ID 后缀', g: 'show', e: { heat: 45, fans: 20 } }, { t: '不理', g: 'grind', e: { heat: 10 } }] },
  { id: 'variety', w: 3, max: 4, when: (s) => famous(s, 400) && pro(s), rec: 1,
    q: '一档综艺邀请你录一期，要三天。', ctx: '教练不会高兴。',
    a: [{ t: '去', g: 'show', e: { heat: 80, money: 6000, coachTrust: -5, fatigue: 8 } }, { t: '推了', g: 'grind', e: { coachTrust: 2 } }] },
  { id: 'stream_gift', w: 0, max: 4, when: streams, rec: 1,
    q: '直播间有人刷了一个大的，要你连麦。', ctx: '看起来是真粉，也可能是想蹭。',
    a: [{ t: '连', g: 'show', e: { heat: 20, money: 800 } }, { t: '感谢，不连', g: 'warm', e: { heat: 5, money: 800 } }] },
  { id: 'stream_ladder', w: 4, max: 5, when: (s) => streams(s) && pre(s), rec: 0,
    q: '粉丝起哄让你直播冲国服前十。', ctx: '冲分内容永远有人看。',
    a: [{ t: '冲', g: 'show', e: { quest: 'ladder' } }, { t: '不冲，练该练的', g: 'grind', e: { xp: { awareness: 8 } } }] },
  // ---- the ladder years
  { id: 'cafe_coach', w: 6, max: 1, when: pre, rec: 0,
    q: '网吧里一个老哥看你打了一下午，说他以前打过职业。', ctx: '他说的东西有一半你没听过。',
    a: [{ t: '听他讲两小时', g: 'warm', e: { xp: { awareness: 18, utility: 10 }, fatigue: 2 } }, { t: '客气两句继续排', g: 'grind', e: { ladder: 1 } }] },
  { id: 'boost', w: 5, max: 1, when: pre, rec: 1,
    q: '有人私信你：代练一单三千，一周内。', ctx: '钱是真的，风险也是。',
    a: [{ t: '接', g: 'hard', e: { money: 3000, fatigue: 8, mental: -1, note: '这件事以后可能被翻出来' } }, { t: '不接', g: 'grind', e: { mental: 1 } }] },
  { id: 'scout_dm', w: 4, max: 2, when: (s) => pre(s) && s.me!.pre.ladder >= 60, rec: 0,
    q: '一个自称青训教练的人加你，说想看你打几把。', ctx: '真的假的不知道。',
    a: [{ t: '打给他看', g: 'show', e: { scoutSeen: 1, fatigue: 3 } }, { t: '先问清楚是哪家', g: 'hard', e: { scoutSeen: 1, mental: 1 } }, { t: '不理', g: 'grind', e: {} }] },
  { id: 'parents', w: 5, max: 2, when: (s) => pre(s) && s.me!.pre.year >= 2, rec: 0,
    q: '父母问你还要打多久，隔壁家孩子已经工作了。', ctx: '第二年了。',
    a: [{ t: '再给我一年', g: 'hard', e: { mental: 2, tilt: 5 } }, { t: '答应边打边找工作', g: 'warm', e: { mental: -1, fatigue: 4 } }] },
  { id: 'gear_deal', w: 4, max: 1, when: (s) => famous(s, 60), rec: 0,
    q: '一个小外设品牌想送你一套设备，条件是直播时用。', ctx: '东西不算顶级。',
    a: [{ t: '收', g: 'show', e: { money: 1500, heat: 10 } }, { t: '不收', g: 'hard', e: { mental: 1 } }] },
  // ---- form
  { id: 'hot_week', w: 0, max: 6, when: pro, rec: 1,
    q: '这周训练赛你怎么打怎么有，教练在边上笑。', ctx: '手感好的时候要多打。',
    a: [{ t: '要求多打两场', g: 'grind', e: { form: 3, fatigue: 8, coachTrust: 3 } }, { t: '按计划来', g: 'warm', e: { form: 2, coachTrust: 1 } }] },
  { id: 'cold_week', w: 0, max: 6, when: pro, rec: 0,
    q: '这周训练赛你打得一塌糊涂，没人说什么。', ctx: '没人说才可怕。',
    a: [{ t: '找教练聊', g: 'warm', e: { coachTrust: 3, tilt: -6 } }, { t: '加练到凌晨', g: 'grind', e: { xp: { aim: 14 }, fatigue: 10, tilt: 2 } }, { t: '关掉游戏两天', g: 'hard', e: { fatigue: -12, tilt: -10, form: -2 } }] },
  // ---- after real things (fired by hooks)
  { id: 'after_title', w: 0, max: 6, when: pro, rec: 0,
    q: '夺冠之夜。队友要去庆功，经理要你先接采访。', ctx: '今晚所有人都想要你一块。',
    a: [{ t: '先采访再庆功', g: 'show', e: { heat: 60, gmTrust: 4, fatigue: 6 } }, { t: '跟队友走', g: 'warm', e: { bond: 12, heat: 25, gmTrust: -2 } }, { t: '回房间睡觉', g: 'grind', e: { fatigue: -10, heat: 10 } }] },
  { id: 'after_upset', w: 0, max: 6, when: pro, rec: 1,
    q: '你们爆冷赢了一支强队，热搜上有你的名字。', ctx: '记者在门口。',
    a: [{ t: '说几句狠的', g: 'hard', e: { heat: 50, coachTrust: -2 } }, { t: '把功劳给队友', g: 'warm', e: { heat: 25, bond: 6 } }] },
  { id: 'after_skid', w: 0, max: 6, when: pro, rec: 1,
    q: '连输三场，弹幕开始喊换人。', ctx: '换的可能就是你。',
    a: [{ t: '跟教练要一场轮换，调整一下', g: 'warm', e: { tilt: -15, coachTrust: -2, note: '教练同意了' } }, { t: '硬扛', g: 'hard', e: { tilt: 5, mental: 1 } }, { t: '关评论，闷头练', g: 'grind', e: { xp: { awareness: 10 }, tilt: -4 } }] },
  { id: 'after_bench', w: 0, max: 4, when: pro, rec: 1,
    q: '被换下来的那个晚上，你一个人在训练室。', ctx: '门没关。',
    a: [{ t: '给经理发消息问情况', g: 'hard', e: { gmTrust: -3, mental: 1 } }, { t: '练到保洁来赶人', g: 'grind', e: { xp: { aim: 12, reaction: 8 }, fatigue: 10 } }, { t: '找队友聊', g: 'warm', e: { bond: 6, tilt: -8 } }] },
  { id: 'after_sign', w: 0, max: 4, when: pro, rec: 0,
    q: '官宣签约的那条微博下面，第一条评论问你是谁。', ctx: '很正常。',
    a: [{ t: '回一句「打给你看」', g: 'hard', e: { heat: 15, mental: 1 } }, { t: '不回', g: 'grind', e: {} }, { t: '发一段训练视频', g: 'show', e: { heat: 25 } }] },
  { id: 'abroad', w: 0, max: 2, when: (s) => s.me!.abroad, rec: 0,
    q: '外赛区的第一周，队友的玩笑你一个都没听懂。', ctx: '语言课不是白报的。',
    a: [{ t: '硬着头皮多说', g: 'hard', e: { xp: { communication: 14 }, bond: 3, mental: -1 } }, { t: '找翻译软件先撑着', g: 'grind', e: { bond: -2 } }, { t: '请全队吃饭', g: 'warm', e: { money: -800, bond: 8 } }] },
  { id: 'injury_scare', w: 0, max: 3, when: pro, rec: 0,
    q: '手腕疼了一周，队医说要么休要么打封闭。', ctx: '下周有比赛。',
    a: [{ t: '休一周', g: 'warm', e: { fatigue: -20, coachTrust: -2, body: 1 } }, { t: '打封闭上', g: 'hard', e: { body: -3, coachTrust: 3, mental: 1 } }] },
  // ---- more of the ordinary
  { id: 'patch', w: 6, max: 6, when: () => true, rec: 1,
    q: '新版本把你最熟的英雄削了。', ctx: '教练问要不要换。',
    a: [{ t: '硬用，我熟', g: 'hard', e: { form: -2, xp: { aim: 10 } } }, { t: '换，跟版本走', g: 'grind', e: { xp: { utility: 14, awareness: 6 }, form: -1 } }, { t: '两个都练', g: 'grind', e: { fatigue: 8, xp: { utility: 8, aim: 8 } } }] },
  { id: 'fan_letter', w: 5, max: 5, when: (s) => famous(s, 80), rec: 0,
    q: '一个粉丝寄来手写信，说因为你才开始打这个游戏。', ctx: '信很长。',
    a: [{ t: '回一封', g: 'warm', e: { mental: 1, heat: 8 } }, { t: '发到社媒', g: 'show', e: { heat: 25 } }, { t: '收着', g: 'grind', e: { mental: 1 } }] },
  { id: 'teammate_ranked', w: 6, max: 6, when: pro, rec: 0,
    q: '半夜两点，一个队友喊你双排。', ctx: '明天有训练。',
    a: [{ t: '上', g: 'warm', e: { bond: 6, fatigue: 6, form: 1 } }, { t: '睡了', g: 'grind', e: { fatigue: -3, bond: -1 } }] },
  { id: 'hater', w: 5, max: 5, when: (s) => famous(s, 150), rec: 1,
    q: '一个黑粉天天在你直播间刷屏。', ctx: '有人建议你回应。',
    a: [{ t: '当场怼', g: 'hard', e: { heat: 30, tilt: 4 } }, { t: '拉黑，不理', g: 'grind', e: { tilt: -2 } }, { t: '开个玩笑带过', g: 'show', e: { heat: 15, mental: 1 } }] },
  { id: 'gear_broke', w: 5, max: 4, when: () => true, rec: 0,
    q: '鼠标坏了，比赛在三天后。', ctx: '临时换设备手会生。',
    a: [{ t: '买同款', g: 'grind', e: { money: -600 } }, { t: '趁机升级', g: 'show', e: { money: -1500, mental: 1 } }, { t: '借队友的先用', g: 'warm', e: { form: -2, bond: 2 } }] },
  { id: 'interview', w: 5, max: 5, when: (s) => pro(s) && famous(s, 100), rec: 1,
    q: '赛后采访，记者问你怎么看对面的指挥。', ctx: '镜头对着你。',
    a: [{ t: '说他今天没打好', g: 'hard', e: { heat: 30, gmTrust: -3 } }, { t: '夸一句', g: 'warm', e: { heat: 10, gmTrust: 2 } }, { t: '「我们只看自己」', g: 'grind', e: { heat: 5 } }] },
  { id: 'ranked_flame', w: 6, max: 5, when: pre, rec: 1,
    q: '排位里遇到一个职业选手，他挂机骂人。', ctx: '你认出他了。',
    a: [{ t: '录下来发出去', g: 'show', e: { heat: 35, mental: -1 } }, { t: '打完这把，不理', g: 'grind', e: { ladder: 1 } }, { t: '私聊问他要不要一起排', g: 'warm', e: { scoutSeen: 1 } }] },
]

export const eventOf = (id: string) => EVENTS.find((e) => e.id === id)

function canFire(state: GameState, ev: EventDef): boolean {
  const me = state.me!
  if ((me.eventCounts[ev.id] ?? 0) >= ev.max) return false
  try { return ev.when(state) } catch { return false }
}

/** The weekly draw. One event at a time; the clock stops on it. */
export function tryRandomEvent(state: GameState, rng: Rng): boolean {
  const me = state.me!
  if (me.pendingEvent) return false
  if (!rng.chance(EVENT_CHANCE)) return false
  const pool = EVENTS.filter((e) => e.w > 0 && canFire(state, e))
  if (!pool.length) return false
  const ev = rng.weighted(pool, pool.map((e) => e.w))
  return fireEvent(state, ev.id)
}

/** Something real happened; the event that follows from it. */
export function fireEvent(state: GameState, id: string): boolean {
  const me = state.me!
  const ev = eventOf(id)
  if (!ev || me.pendingEvent || !canFire(state, ev)) return false
  // a thing that follows from a real event does not follow from it every week
  const last = me.flags[`ev_${id}`]
  if (ev.w === 0 && last != null && state.day - last >= 0 && state.day - last < 42) return false
  me.flags[`ev_${id}`] = state.day
  me.pendingEvent = id
  me.eventCounts[id] = (me.eventCounts[id] ?? 0) + 1
  push(state, { kind: 'event', id })
  return true
}

/** Answer it. The snapshot-and-diff is what the card shows: what actually changed. */
export function resolveEvent(state: GameState, id: string, choice: number): string[] {
  const me = state.me!
  const ev = eventOf(id)
  if (!ev) return []
  const opt = ev.a[choice] ?? ev.a[ev.rec]
  const rng = new Rng(hashStr(`event:${state.seed}:${state.year}:${state.day}:${id}`))
  const lines = applyEffect(state, opt.e, rng)
  if (opt.e.quest) addQuest(state, opt.e.quest)
  const trait = addAxis(state, opt.g)
  me.eventsSeen++
  me.pendingEvent = undefined
  pop(state, 'event', id)
  pushLog(state, 'event', `${ev.q} → ${opt.t}${lines.length ? `（${lines.join('，')}）` : ''}`)
  if (trait) lines.push(`你成了「${trait}」`)
  return lines
}
