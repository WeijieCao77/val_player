import type { GameState } from '../types'
import { pushLog } from './log'

export interface AchDef { key: string; name: string; desc: string; group: string; secret?: boolean; cond: (s: GameState) => boolean }

const titlesOf = (s: GameState) => s.me!.titles
const intl = (s: GameState, re: RegExp) => titlesOf(s).filter((t) => re.test(t.title))
const played = (s: GameState) => s.me!.matches.filter((m) => !m.friendly)
const starts = (s: GameState) => played(s).filter((m) => m.started)
const proSeasons = (s: GameState) => s.me!.seasons.filter((x) => x.tier > 0).length

/**
 * Deliberately scattered across paths that exclude each other — some want a
 * specialist, some a rounded player; some reward staying, some reward
 * leaving — so one career sees a third of them and a second career sees
 * different ones. Every condition asks the save a question; none is a flag.
 */
export const ACHIEVEMENTS: AchDef[] = [
  { key: 'first_start', name: '第一次首发', desc: '打上一场正赛的首发', group: '里程碑', cond: (s) => starts(s).length >= 1 },
  { key: 'first_win', name: '第一场胜利', desc: '首发赢下一场正赛', group: '里程碑', cond: (s) => starts(s).some((m) => m.won) },
  { key: 'first_mvp', name: '全场最佳', desc: '拿一次比赛 MVP', group: '里程碑', cond: (s) => starts(s).some((m) => m.mvp) },
  { key: 'mvp10', name: '常客', desc: '10 次 MVP', group: '战绩', cond: (s) => starts(s).filter((m) => m.mvp).length >= 10 },
  { key: 'acs300', name: '爆种', desc: '一场比赛 ACS 300+', group: '战绩', cond: (s) => starts(s).some((m) => m.acs >= 300) },
  { key: 'clutch3', name: '残局大师', desc: '一场比赛打出 3 次残局', group: '战绩', cond: (s) => starts(s).some((m) => m.clutches >= 3) },
  { key: 'carry5', name: '院长', desc: '5 场败局里你是全队最高', group: '逆境', cond: (s) => starts(s).filter((m) => m.carried).length >= 5 },
  { key: 'matches100', name: '一百场', desc: '打满 100 场正赛', group: '里程碑', cond: (s) => starts(s).length >= 100 },
  { key: 'title_regional', name: '赛区冠军', desc: '随队夺得一个赛区赛事冠军', group: '荣誉', cond: (s) => titlesOf(s).some((t) => !/Masters|Champions/.test(t.title)) },
  { key: 'title_masters', name: '大师', desc: '随队夺得大师赛冠军', group: '荣誉', cond: (s) => intl(s, /Masters/).length >= 1 },
  { key: 'title_champs', name: '世界之巅', desc: '随队夺得冠军赛冠军', group: '荣誉', cond: (s) => intl(s, /Champions/).length >= 1 },
  { key: 'double', name: '双冠', desc: '同一年拿下大师赛和冠军赛', group: '荣誉', cond: (s) => {
    const years = new Set(intl(s, /Masters/).map((t) => t.year))
    return intl(s, /Champions/).some((t) => years.has(t.year))
  } },
  { key: 'started_title', name: '亲手捧起', desc: '作为首发拿冠军', group: '荣誉', cond: (s) => titlesOf(s).some((t) => t.started) },
  { key: 'bench_title', name: '板凳上的戒指', desc: '一个冠军，你全程在替补席', group: '逆境', secret: true, cond: (s) => titlesOf(s).some((t) => !t.started) },
  { key: 'trial_pass', name: '试用期转正', desc: '靠对位挑战拿到试用期并打下首发', group: '成长', cond: (s) => !!s.me!.flags.trialPassed },
  { key: 'comeback', name: '被换下，又回来', desc: '被教练换下之后重新打上首发', group: '逆境', cond: (s) => !!s.me!.flags.cameBack },
  { key: 'ovr85', name: '一线水平', desc: '综合达到 85', group: '成长', cond: (s) => s.players[s.me!.id].overall >= 85 },
  { key: 'ovr90', name: '世界级', desc: '综合达到 90', group: '成长', cond: (s) => s.players[s.me!.id].overall >= 90 },
  { key: 'ladder_top', name: '国服第一', desc: '天梯登顶', group: '职业前', cond: (s) => s.me!.pre.ladderPeak >= 96 },
  { key: 'ladder_100', name: '前一百', desc: '天梯进前 100', group: '职业前', cond: (s) => s.me!.pre.ladderPeak >= 72 },
  { key: 'cup_city', name: '网吧之王', desc: '城市争霸赛冠军', group: '职业前', cond: (s) => s.me!.pre.cups.some((c) => c.key === 'city' && c.won) },
  { key: 'cup_premier', name: '业余联赛冠军', desc: '拿下官方业余联赛挑战者组', group: '职业前', cond: (s) => s.me!.pre.cups.some((c) => c.key === 'premier' && c.won) },
  { key: 'signed_t1', name: '一步登天', desc: '从业余直接签进 VCT 俱乐部', group: '职业前', cond: (s) => !!s.me!.flags.signedT1FromPre },
  { key: 'fans350', name: '平台头部', desc: '粉丝到「平台头部」', group: '人气', cond: (s) => s.me!.fans >= 350 },
  { key: 'fans900', name: '全网知名', desc: '粉丝到「全网知名」', group: '人气', cond: (s) => s.me!.fans >= 900 },
  { key: 'fans2000', name: '出圈', desc: '粉丝到「出圈了」', group: '人气', cond: (s) => s.me!.fans >= 2000 },
  { key: 'money100k', name: '第一桶金', desc: '存款 $100,000', group: '经济', cond: (s) => s.me!.money >= 100000 },
  { key: 'money1m', name: '财务自由', desc: '存款 $1,000,000', group: '经济', cond: (s) => s.me!.money >= 1000000 },
  { key: 'salary500k', name: '顶薪', desc: '年薪 $500,000', group: '经济', cond: (s) => s.players[s.me!.id].salary >= 500000 },
  { key: 'abroad', name: '出海', desc: '在外赛区效力', group: '生涯', cond: (s) => s.me!.abroad },
  { key: 'clubs3', name: '流浪者', desc: '效力过三家俱乐部', group: '生涯', cond: (s) => new Set((s.players[s.me!.id].clubHist ?? []).map((h) => h.team)).size >= 3 },
  { key: 'loyal5', name: '一队五年', desc: '在一家俱乐部待满五个赛季', group: '生涯', cond: (s) => s.me!.tenure >= 5 },
  { key: 'seasons8', name: '常青树', desc: '打满八个职业赛季', group: '生涯', cond: (s) => proSeasons(s) >= 8 },
  { key: 'trait', name: '有了性格', desc: '获得第一个特质', group: '人生', cond: (s) => s.me!.traits.length >= 1 },
  { key: 'traits2', name: '立体的人', desc: '两个特质', group: '人生', cond: (s) => s.me!.traits.length >= 2 },
  { key: 'events20', name: '人生不止比赛', desc: '经历 20 个事件', group: '人生', cond: (s) => s.me!.eventsSeen >= 20 },
  { key: 'declined_rich', name: '不为所动', desc: '拒绝一家豪门的报价', group: '人生', secret: true, cond: (s) => !!s.me!.flags.declinedRich },
  { key: 'stream_deal', name: '签了独家', desc: '签下一份直播独家', group: '经济', cond: (s) => !!s.me!.stream.deal || !!s.me!.flags.hadStreamDeal },
  { key: 'age30', name: '三十而立', desc: '30 岁还在打', group: '生涯', cond: (s) => s.players[s.me!.id].age >= 30 && s.me!.phase === 'pro' },
]

/** Newly earned this week. */
export function checkAchievements(state: GameState): AchDef[] {
  const me = state.me!
  const fresh: AchDef[] = []
  for (const a of ACHIEVEMENTS) {
    if (me.achievements.includes(a.key)) continue
    let ok = false
    try { ok = a.cond(state) } catch { ok = false }
    if (!ok) continue
    me.achievements.push(a.key)
    fresh.push(a)
    pushLog(state, 'good', `成就：${a.name}——${a.desc}。`)
  }
  return fresh
}
