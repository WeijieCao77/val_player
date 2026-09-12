import { clamp } from '../rng'
import { WORLD_END } from '../era'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState } from '../types'
import { pushLog } from './log'
import { addMoney } from './money'
import { bondProtege, bondRoleCount } from './bond'
import { CAP_EXP_MAX } from './bottleneck'
import type { MeMatchRecord, MeSeason, MeState } from './types'
import { compClass, isIntlComp } from './compclass'
import type { CompClass } from './compclass'

/**
 * Achievements, laid out along the roads a career actually takes.
 *
 * Deliberately scattered across paths that exclude each other — the ladder or
 * a Challengers start, staying or leaving, a trophy or eight years without one
 * — so one career sees a third of them and a second career sees different
 * ones. Every condition asks the save a question; none is a counter kept for
 * its own sake, and none asks for more of the same thing (no 「解锁 N 项」).
 *
 * Each pays once, small: a point of 心态 or 体质, a 称号 for the profile, a
 * little heat or following, now and then a few thousand dollars through the
 * one door (me/money.ts). What has been paid is written down by key, so a save
 * from before rewards existed is paid for what it already holds, once.
 */

export type AchRoute =
  | 'ladder' | 'sign' | 'bench' | 'chal' | 'promo' | 'league' | 'crown' | 'world' | 'move'
  | 'fans' | 'bond' | 'calls' | 'stats' | 'break' | 'back' | 'vet' | 'grit' | 'life'

/** The screen's order: roughly the order a career meets them in. */
export const ACH_ROUTES: { key: AchRoute; name: string }[] = [
  { key: 'ladder', name: '天梯与杯赛' },
  { key: 'sign', name: '试训与签约' },
  { key: 'bench', name: '替补到首发' },
  { key: 'chal', name: '挑战者联赛' },
  { key: 'promo', name: '晋级之路' },
  { key: 'league', name: 'VCT 联赛' },
  { key: 'crown', name: '大师赛与冠军赛' },
  { key: 'world', name: '国际赛场' },
  { key: 'move', name: '转会与出海' },
  { key: 'fans', name: '直播与人气' },
  { key: 'bond', name: '队友' },
  { key: 'calls', name: '临场决策' },
  { key: 'stats', name: '残局与数据' },
  { key: 'break', name: '瓶颈与成长' },
  { key: 'back', name: '跌倒再起' },
  { key: 'vet', name: '老将与退役' },
  { key: 'grit', name: '失败与坚持' },
  { key: 'life', name: '场外' },
]

export interface AchReward {
  mental?: number
  body?: number
  fans?: number
  heat?: number
  /** dollars, booked as 其他收入 */
  money?: number
  /** a 称号 the profile can wear */
  title?: string
}

export interface AchDef {
  key: string
  name: string
  desc: string
  route: AchRoute
  secret?: boolean
  reward?: AchReward
  cond: (s: GameState) => boolean
}

/* ------------------------------------------------------------------ */
/*  what kind of competition a stored name is                          */
/* ------------------------------------------------------------------ */

export { compClass, isIntlComp }
export type { CompClass }

/** A series that decides the whole event — not a semi-final, not an upper-bracket final. */
const isFinal = (label: string): boolean => {
  const l = (label ?? '').trim()
  return /总决赛$|^决赛$|\s决赛$|Grand Final|^Final/i.test(l) && !/(胜者组|败者组|半|四分之一)决赛$/.test(l)
}

/* ------------------------------------------------------------------ */
/*  reading the save                                                    */
/* ------------------------------------------------------------------ */

const M = (s: GameState): MeState => s.me!
const P = (s: GameState) => s.players[s.me!.id]
const official = (s: GameState) => M(s).matches.filter((m) => !m.friendly)
const starts = (s: GameState) => official(s).filter((m) => m.started)
const proSeasons = (s: GameState) => M(s).seasons.filter((x) => x.tier > 0).length
const titlesIn = (s: GameState, cls: CompClass) => M(s).titles.filter((t) => compClass(t.title) === cls)
const cupWon = (s: GameState, key: string) => M(s).pre.cups.some((c) => c.key === key && c.won)
const nodes = (s: GameState) => M(s).matches.flatMap((m) => m.nodes ?? [])
const mates = (s: GameState) => Object.values(M(s).mates ?? {})
const opened = (s: GameState, k: keyof Attrs) => (M(s).bottleneck?.mech[k] ?? 0) + (M(s).bottleneck?.mile[k] ?? 0)

/** Started from the ladder: remembered at the start, or read off an older save's cup runs. */
const fromLadder = (s: GameState) => !!M(s).flags.fromLadder || (!M(s).pre.wasPro && M(s).pre.cups.length > 0)
const everPro = (s: GameState) => M(s).phase === 'pro' || M(s).seasons.some((x) => x.tier > 0)

/** The tier of the first club: its season on the record, or the one under way. */
function firstTier(s: GameState): number {
  const f = M(s).seasons.find((x) => x.tier > 0)
  if (f) return f.tier
  return M(s).phase === 'pro' ? (s.teams[s.myTeam]?.tier ?? 0) : 0
}

/** Seasons back to back, on the record. */
function pairs(s: GameState): [MeSeason, MeSeason][] {
  const xs = M(s).seasons
  const out: [MeSeason, MeSeason][] = []
  for (let i = 1; i < xs.length; i++) if (xs[i].year === xs[i - 1].year + 1) out.push([xs[i - 1], xs[i]])
  return out
}

function maxPerYear(ts: { year: number }[]): number {
  const n = new Map<number, number>()
  for (const t of ts) n.set(t.year, (n.get(t.year) ?? 0) + 1)
  return Math.max(0, ...n.values())
}

function lossRun(ms: MeMatchRecord[]): number {
  let run = 0
  let best = 0
  for (const m of ms) {
    if (!m.won && !m.drawn) { run++; best = Math.max(best, run) } else run = 0
  }
  return best
}

function benchToStart(s: GameState): boolean {
  const xs = M(s).seasons.filter((x) => x.tier > 0)
  return xs.some((a, i) => a.matches >= 8 && a.starts / a.matches < 0.3
    && xs.slice(i + 1).some((b) => b.matches >= 10 && b.starts / b.matches >= 0.9))
}

function yoYo(s: GameState): boolean {
  const t = M(s).seasons.filter((x) => x.tier > 0 && x.matches > 0).map((x) => x.tier)
  const up = t.indexOf(1)
  if (up < 0) return false
  const down = t.indexOf(2, up + 1)
  return down > 0 && t.indexOf(1, down + 1) > 0
}

function intlSameYear(s: GameState): boolean {
  const by = new Map<number, Set<CompClass>>()
  for (const m of starts(s)) {
    const c = compClass(m.comp)
    if (c !== 'masters' && c !== 'champions') continue
    if (!by.has(m.year)) by.set(m.year, new Set())
    by.get(m.year)!.add(c)
  }
  return [...by.values()].some((x) => x.has('masters') && x.has('champions'))
}

function skidTitle(s: GameState): boolean {
  const years = new Set(M(s).titles.filter((t) => t.started).map((t) => t.year))
  return [...years].some((y) => lossRun(starts(s).filter((m) => m.year === y)) >= 3)
}

/* ------------------------------------------------------------------ */
/*  the list                                                            */
/* ------------------------------------------------------------------ */

export const ACHIEVEMENTS: AchDef[] = [
  // ---- 天梯与杯赛
  { key: 'ladder_100', route: 'ladder', name: '前一百', desc: '天梯打进辐能战魂前 100', reward: { fans: 20 }, cond: (s) => M(s).pre.ladderPeak >= 72 },
  { key: 'ladder_top', route: 'ladder', name: '登顶', desc: '天梯打到国服第一', reward: { title: '天梯之巅' }, cond: (s) => M(s).pre.ladderPeak >= 96 },
  { key: 'cup_city', route: 'ladder', name: '网吧之王', desc: '拿下一次网吧赛或本地线下赛', reward: { heat: 15 }, cond: (s) => cupWon(s, 'city') },
  { key: 'cup_premier', route: 'ladder', name: '业余联赛冠军', desc: '拿下官方业余联赛或开放海选', reward: { fans: 30 }, cond: (s) => cupWon(s, 'premier') },
  { key: 'cup_streamer', route: 'ladder', name: '镜头前夺冠', desc: '拿下主播杯', reward: { fans: 30 }, cond: (s) => cupWon(s, 'streamer') },

  // ---- 试训与签约
  { key: 'signed_first', route: 'sign', name: '名字进了名单', desc: '从天梯走到第一份职业合同', reward: { money: 2000 }, cond: (s) => fromLadder(s) && everPro(s) },
  { key: 'signed_t1', route: 'sign', name: '一步登天', desc: '从天梯直接签进一线俱乐部', reward: { title: '直通一线' }, cond: (s) => fromLadder(s) && firstTier(s) === 1 },
  { key: 'sign_year1', route: 'sign', name: '当年就有人要', desc: '天梯出发，第一年就签约', reward: { money: 1000 }, cond: (s) => fromLadder(s) && !M(s).pre.wasPro && M(s).pre.year === 1 && M(s).phase === 'pro' },
  { key: 'sign_grind', route: 'sign', name: '第三个冬天', desc: '天梯上熬到第三年才签约', reward: { heat: 15 }, cond: (s) => fromLadder(s) && !M(s).pre.wasPro && M(s).pre.year >= 3 && M(s).phase === 'pro' },
  { key: 't1_starter_deal', route: 'sign', name: '写进合同的首发', desc: '和一线俱乐部签下首发合同', reward: { heat: 15 },
    cond: (s) => { const role = P(s).contract?.promisedRole; return M(s).phase === 'pro' && s.teams[s.myTeam]?.tier === 1 && (role === 'starter' || role === 'star') } },
  { key: 'salary500k', route: 'sign', name: '顶薪', desc: '年薪 $500,000', reward: { heat: 20 }, cond: (s) => P(s).salary >= 500000 },

  // ---- 替补到首发
  { key: 'first_start', route: 'bench', name: '第一次首发', desc: '打上一场正赛的首发', reward: { heat: 10 }, cond: (s) => starts(s).length >= 1 },
  { key: 'first_win', route: 'bench', name: '第一场胜利', desc: '首发赢下一场正赛', reward: { fans: 10 }, cond: (s) => starts(s).some((m) => m.won) },
  { key: 'trial_pass', route: 'bench', name: '试用期转正', desc: '靠对位挑战拿到试用期并打下首发', reward: { mental: 1 }, cond: (s) => !!M(s).flags.trialPassed },
  { key: 'bench_to_start', route: 'bench', name: '从第六人开始', desc: '一季首发不到三成，后来一季九成以上', reward: { title: '后来居上' }, cond: benchToStart },
  { key: 'started_title', route: 'bench', name: '亲手捧起', desc: '作为首发拿冠军', reward: { heat: 20 }, cond: (s) => M(s).titles.some((t) => t.started) },
  { key: 'bench_title', route: 'bench', secret: true, name: '替补席上的冠军', desc: '一个冠军，你全程在替补席', reward: { heat: 10 }, cond: (s) => M(s).titles.some((t) => !t.started) },

  // ---- 挑战者联赛
  { key: 'chal_title', route: 'chal', name: '挑战者冠军', desc: '拿下一个挑战者联赛冠军', reward: { fans: 20 }, cond: (s) => titlesIn(s, 'chal').length >= 1 },
  { key: 'chal_double', route: 'chal', name: '一年两冠', desc: '同一年拿下两个挑战者联赛冠军', reward: { heat: 20 }, cond: (s) => maxPerYear(titlesIn(s, 'chal')) >= 2 },
  { key: 'chal_years', route: 'chal', name: '挑战者老面孔', desc: '在次级联赛打满四个赛季', reward: { body: 1 }, cond: (s) => M(s).seasons.filter((x) => x.tier === 2).length >= 4 },
  { key: 'chal_mvp', route: 'chal', name: '决赛之夜', desc: '挑战者联赛决赛赢球，MVP 是你', reward: { fans: 30 },
    cond: (s) => starts(s).some((m) => m.won && m.mvp && isFinal(m.label) && compClass(m.comp) === 'chal') },

  // ---- 晋级之路（2023–2026 的晋级赛，2027 起的公开资格赛）
  { key: 'asc_title', route: 'promo', name: '从晋级赛出来', desc: '拿下一次晋级赛', reward: { fans: 40 },
    cond: (s) => M(s).titles.some((t) => /晋级赛(（[^）]*）)?$|Ascension/i.test(t.title) && !/资格赛/.test(t.title)) },
  // a qualifier won is 出线, not a title (me/compclass.ts isQualifier): read off the 出线 list, and off an older save's titles
  { key: 'oq_title', route: 'promo', name: '海选打穿', desc: '从一次公开资格赛或公开季后赛出线', reward: { fans: 30 },
    cond: (s) => [...(M(s).quals ?? []), ...M(s).titles].some((t) => /公开资格赛|公开季后赛|Open Qualifier|Open Playoffs/i.test(t.title)) },
  { key: 'promoted', route: 'promo', name: '升上去了', desc: '随队从次级联赛升入一线', reward: { title: '晋级功臣' },
    cond: (s) => pairs(s).some(([a, b]) => a.team === b.team && a.tier === 2 && b.tier === 1) },
  { key: 'yo_yo', route: 'promo', name: '又打回来了', desc: '掉到次级联赛之后，又回到一线', reward: { title: '卷土重来' }, cond: yoYo },

  // ---- VCT 联赛（2021–2022 是一线赛区赛事）
  { key: 't1_debut', route: 'league', name: '一线的灯光', desc: '在一线俱乐部打上首发', reward: { fans: 20 },
    cond: (s) => M(s).seasons.some((x) => x.tier === 1 && x.starts > 0) || (M(s).phase === 'pro' && s.teams[s.myTeam]?.tier === 1 && M(s).seasonStart.starts > 0) },
  { key: 'title_regional', route: 'league', name: '赛区冠军', desc: '随队拿下一个一线赛区赛事冠军', reward: { fans: 40 }, cond: (s) => titlesIn(s, 'league').length >= 1 },
  { key: 't1_seasons3', route: 'league', name: '站稳一线', desc: '在一线俱乐部打满三个赛季', reward: { body: 1 }, cond: (s) => M(s).seasons.filter((x) => x.tier === 1 && x.matches > 0).length >= 3 },
  { key: 'league_three', route: 'league', name: '三座赛区奖杯', desc: '首发拿下三个一线赛区赛事冠军', reward: { title: '赛区柱石' }, cond: (s) => titlesIn(s, 'league').filter((t) => t.started).length >= 3 },

  // ---- 大师赛与冠军赛
  { key: 'title_masters', route: 'crown', name: '大师', desc: '随队夺得大师赛冠军', reward: { title: '大师赛冠军' }, cond: (s) => titlesIn(s, 'masters').length >= 1 },
  { key: 'title_champs', route: 'crown', name: '世界之巅', desc: '随队夺得冠军赛冠军', reward: { title: '世界冠军' }, cond: (s) => titlesIn(s, 'champions').length >= 1 },
  { key: 'double', route: 'crown', name: '双冠', desc: '同一年拿下大师赛和冠军赛', reward: { mental: 1 },
    cond: (s) => { const y = new Set(titlesIn(s, 'masters').map((t) => t.year)); return titlesIn(s, 'champions').some((t) => y.has(t.year)) } },
  { key: 'champs_back2back', route: 'crown', name: '蝉联', desc: '连续两年拿下冠军赛', reward: { title: '双料世界冠军' },
    cond: (s) => { const y = new Set(titlesIn(s, 'champions').map((t) => t.year)); return [...y].some((x) => y.has(x + 1)) } },
  { key: 'champs_final_lost', route: 'crown', secret: true, name: '差一场', desc: '首发打冠军赛决赛，输了', reward: { title: '差一步' },
    cond: (s) => starts(s).some((m) => !m.won && !m.drawn && isFinal(m.label) && compClass(m.comp) === 'champions') },

  // ---- 国际赛场
  { key: 'intl_debut', route: 'world', name: '第一次出征', desc: '首发打一场国际赛', reward: { fans: 30 }, cond: (s) => starts(s).some((m) => isIntlComp(m.comp)) },
  { key: 'intl_mvp', route: 'world', name: '世界看见了', desc: '国际赛拿下一场 MVP', reward: { fans: 50 }, cond: (s) => starts(s).some((m) => m.mvp && isIntlComp(m.comp)) },
  { key: 'intl_same_year', route: 'world', name: '两站都在', desc: '同一年首发打过大师赛和冠军赛', reward: { heat: 30 }, cond: intlSameYear },
  { key: 'lockin', route: 'world', secret: true, name: '圣保罗', desc: '首发打过 LOCK//IN 圣保罗', reward: { title: 'LOCK//IN 一代' }, cond: (s) => starts(s).some((m) => compClass(m.comp) === 'lockin') },

  // ---- 转会与出海
  { key: 'abroad', route: 'move', name: '出海', desc: '在外赛区效力', reward: { heat: 20 }, cond: (s) => M(s).abroad },
  { key: 'abroad2', route: 'move', name: '他乡两年', desc: '在外赛区打满两个赛季', reward: { title: '远行者' }, cond: (s) => (M(s).flags.abroadSeasons ?? 0) >= 2 },
  { key: 'home_again', route: 'move', name: '回到熟悉的服务器', desc: '出海之后，回本赛区打职业', reward: { fans: 20 },
    cond: (s) => (M(s).flags.abroadSeasons ?? 0) >= 1 && M(s).phase === 'pro' && !M(s).abroad },
  { key: 'clubs3', route: 'move', name: '流浪者', desc: '效力过三家俱乐部', reward: { fans: 15 }, cond: (s) => new Set((P(s).clubHist ?? []).map((h) => h.team)).size >= 3 },
  { key: 'loyal5', route: 'move', name: '一队五年', desc: '在一家俱乐部待满五个赛季', reward: { title: '老队员' }, cond: (s) => M(s).tenure >= 5 },
  { key: 't2_to_t1_move', route: 'move', name: '被一线挖走', desc: '从次级联赛转会去一线俱乐部', reward: { fans: 30 },
    cond: (s) => pairs(s).some(([a, b]) => a.tier === 2 && b.tier === 1 && a.team !== b.team) },
  { key: 'declined_rich', route: 'move', secret: true, name: '不为所动', desc: '拒绝一家豪门的报价', reward: { mental: 1 }, cond: (s) => !!M(s).flags.declinedRich },

  // ---- 直播与人气
  { key: 'stream_deal', route: 'fans', name: '签了独家', desc: '签下一份直播独家', reward: { heat: 15 }, cond: (s) => !!M(s).stream.deal || !!M(s).flags.hadStreamDeal },
  // on a club: signed with the rival platform, the one the manager does not like (stream.ts answerStreamOffer)
  { key: 'stream_rival', route: 'fans', name: '另起炉灶', desc: '有队时签下对家平台的独家', reward: { heat: 20 },
    cond: (s) => { const d = M(s).stream.deal; return !!d && !d.club && d.clubCut > 0 } },
  { key: 'fans350', route: 'fans', name: '平台头部', desc: '粉丝到「平台头部」', reward: { money: 1000 }, cond: (s) => M(s).fans >= 350 },
  { key: 'fans900', route: 'fans', name: '全网知名', desc: '粉丝到「全网知名」', reward: { money: 2500 }, cond: (s) => M(s).fans >= 900 },
  { key: 'fans2000', route: 'fans', name: '出圈', desc: '粉丝到「出圈了」', reward: { title: '出圈选手' }, cond: (s) => M(s).fans >= 2000 },
  { key: 'fans3500', route: 'fans', name: '项目的门面', desc: '粉丝到「这个项目的门面」', reward: { title: '门面' }, cond: (s) => M(s).fans >= 3500 },

  // ---- 队友（me/bond.ts 的账本）
  { key: 'bond_long', route: 'bond', name: '老搭档', desc: '和同一名队友并肩十二个赛段', reward: { fans: 15 }, cond: (s) => mates(s).some((e) => (e.stages ?? 0) >= 12) },
  { key: 'bond_titles', route: 'bond', name: '一起举杯', desc: '和同一名队友一起拿三个冠军', reward: { fans: 20 }, cond: (s) => mates(s).some((e) => (e.titles?.length ?? 0) >= 3) },
  { key: 'bond_protege', route: 'bond', secret: true, name: '青出于蓝', desc: '你带过的年轻人，现在比你强', reward: { title: '引路人' }, cond: (s) => !!bondProtege(s) },
  // a man who retired is taken off the world's books, so a gone entry with nobody left behind it has retired
  { key: 'bond_carried_retired', route: 'bond', name: '送他退役', desc: '刚进队时带你的人退役了', reward: { heat: 10 },
    cond: (s) => mates(s).some((e) => bondRoleCount(e, 'carried') >= 2 && (e.gone === 'retired' || (!!e.gone && !s.players[e.id]))) },

  // ---- 临场决策（只有亲手打的比赛才有）
  // first measured over two hand-played seasons (~690 calls, random picks). Re-measured for 关键回合
  // (2026-09-12): 6000 BO3s on random picks, the thresholds moved so each stays about as rare as it was.
  // A call that lands under 40% turns up in 33 matches in 100 (under 60% used to: 38). A landed call that
  // lifts the map 20 points — counted on the round it really won, not a projection — in 11 in 100 (the old
  // 12-point projection: 8). 4+ calls all landing in 3 in 100 (5+ used to be 5, but calls land less often
  // now and no count brings that back). Every call missed and the match won stays at 3+, about 1 in 500.
  // Keys are unchanged, so an achievement already earned stays earned.
  { key: 'call_long', route: 'calls', name: '不到四成', desc: '成功率不到 40% 的决策赌赢了', reward: { mental: 1 }, cond: (s) => nodes(s).some((n) => n.ok && n.p < 40) },
  { key: 'call_swing', route: 'calls', name: '一句话翻盘', desc: '一个做成的决策，把地图胜率拉高 20 点', reward: { heat: 20 }, cond: (s) => nodes(s).some((n) => n.ok && n.after - n.before >= 20) },
  { key: 'call_clean', route: 'calls', name: '句句算数', desc: '一场做 4 个以上决策，全部成功', reward: { title: '读秒决断' },
    cond: (s) => M(s).matches.some((m) => (m.nodes?.length ?? 0) >= 4 && m.nodes.every((n) => n.ok)) },
  { key: 'call_all_fail_win', route: 'calls', secret: true, name: '嘴上输了', desc: '决策全砸（至少 3 个），比赛还是赢了', reward: { heat: 15 },
    cond: (s) => M(s).matches.some((m) => m.won && (m.nodes?.length ?? 0) >= 3 && m.nodes.every((n) => !n.ok)) },

  // ---- 残局与数据
  { key: 'first_mvp', route: 'stats', name: '全场最佳', desc: '拿一次比赛 MVP', reward: { fans: 15 }, cond: (s) => starts(s).some((m) => m.mvp) },
  { key: 'mvp10', route: 'stats', name: '常客', desc: '10 次 MVP', reward: { heat: 15 }, cond: (s) => starts(s).filter((m) => m.mvp).length >= 10 },
  { key: 'acs300', route: 'stats', name: '爆种', desc: '一场比赛 ACS 300+', reward: { fans: 20 }, cond: (s) => starts(s).some((m) => m.acs >= 300) },
  { key: 'clutch3', route: 'stats', name: '残局大师', desc: '一场比赛赢下 3 个残局', reward: { mental: 1 }, cond: (s) => starts(s).some((m) => m.clutches >= 3) },
  { key: 'clutch120', route: 'stats', name: '最后一个人', desc: '生涯赢下 120 个残局', reward: { title: '残局专家' }, cond: (s) => P(s).career.clutches >= 120 },
  { key: 'rating150', route: 'stats', name: '满屏都是你', desc: '一场比赛评分 1.50 以上', reward: { fans: 20 }, cond: (s) => starts(s).some((m) => m.rating >= 1.5) },

  // ---- 瓶颈与成长（me/bottleneck.ts）
  { key: 'break_first', route: 'break', name: '第一道缝', desc: '第一次破开瓶颈', reward: { fans: 10 }, cond: (s) => ATTR_KEYS.some((k) => opened(s, k) > 0) },
  { key: 'break_aim', route: 'break', name: '千发之后', desc: '连着三周苦练，破开枪法瓶颈', reward: { body: 1 }, cond: (s) => (M(s).bottleneck?.mech.aim ?? 0) >= 2 },
  { key: 'break_mile', route: 'break', name: '大场面开窍', desc: '一座冠军破开了瓶颈', reward: { mental: 1 }, cond: (s) => ATTR_KEYS.some((k) => (M(s).bottleneck?.mile[k] ?? 0) > 0) },
  // the key says four: saves hold it. Four was reached by every probe career in eight seasons, so it asks for five
  { key: 'break_four', route: 'break', name: '五路破壁', desc: '五项属性都破开过瓶颈', reward: { title: '破壁者' }, cond: (s) => ATTR_KEYS.filter((k) => opened(s, k) > 0).length >= 5 },
  { key: 'exp_full', route: 'break', name: '越打越老练', desc: `${CAP_EXP_MAX} 个职业赛季把经验瓶颈松满`, reward: { body: 1 }, cond: (s) => (M(s).bottleneck?.exp ?? 0) >= CAP_EXP_MAX },
  { key: 'ovr85', route: 'break', name: '一线水平', desc: '综合达到 85', reward: { fans: 20 }, cond: (s) => P(s).overall >= 85 },
  { key: 'ovr90', route: 'break', name: '世界级', desc: '综合达到 90', reward: { title: '世界级' }, cond: (s) => P(s).overall >= 90 },
  { key: 'attr99', route: 'break', name: '九十九', desc: '一项属性练到 99', reward: { heat: 20 }, cond: (s) => ATTR_KEYS.some((k) => P(s).attrs[k] >= 99) },

  // ---- 跌倒再起
  { key: 'comeback', route: 'back', name: '被换下，又回来', desc: '被教练换下之后重新打上首发', reward: { mental: 1 }, cond: (s) => !!M(s).flags.cameBack },
  { key: 'back_from_free', route: 'back', name: '电话又响了', desc: '被放走之后，又签回职业', reward: { mental: 1 }, cond: (s) => M(s).pre.wasPro && M(s).phase === 'pro' },
  { key: 'relegated_stay', route: 'back', name: '降级也不走', desc: '随队掉进次级联赛，第二年还在', reward: { fans: 10 },
    cond: (s) => pairs(s).some(([a, b]) => a.team === b.team && a.tier === 1 && b.tier === 2) },
  { key: 'skid_title', route: 'back', name: '连败之后', desc: '同一年首发连输三场，还是拿了冠军', reward: { heat: 20 }, cond: skidTitle },

  // ---- 老将与退役
  { key: 'matches100', route: 'vet', name: '一百场', desc: '首发打满 100 场正赛', reward: { heat: 10 }, cond: (s) => starts(s).length >= 100 },
  { key: 'seasons8', route: 'vet', name: '常青树', desc: '打满八个职业赛季', reward: { title: '老将' }, cond: (s) => proSeasons(s) >= 8 },
  { key: 'age30', route: 'vet', name: '三十而立', desc: '30 岁还在打', reward: { body: 1 }, cond: (s) => P(s).age >= 30 && M(s).phase === 'pro' },
  { key: 'seasons12', route: 'vet', name: '十二年', desc: '打满十二个职业赛季', reward: { title: '元老' }, cond: (s) => proSeasons(s) >= 12 },
  { key: 'world_end', route: 'vet', name: '世界线尽头', desc: `职业生涯打到 ${WORLD_END - 1} 赛季`, reward: { title: '见证者' }, cond: (s) => M(s).phase === 'pro' && s.year >= WORLD_END - 1 },
  // checked on the day of retirement too (endings.ts retire): the last season's titles carry the year before
  { key: 'retire_title', route: 'vet', name: '带着奖杯走', desc: '退役前的最后一季拿过冠军', reward: { title: '功成身退' },
    cond: (s) => { const e = M(s).ending; return M(s).phase === 'retired' && !!e && M(s).titles.some((t) => t.started && t.year >= e.year - 1) } },

  // ---- 失败与坚持
  { key: 'carry5', route: 'grit', name: '一个人在扛', desc: '5 场败局里你是全队最高', reward: { mental: 1 }, cond: (s) => starts(s).filter((m) => m.carried).length >= 5 },
  { key: 'bench_year', route: 'grit', name: '坐满一季', desc: '一个职业赛季没打上首发（至少 8 场）', reward: { body: 1 },
    cond: (s) => M(s).seasons.some((x) => x.tier > 0 && x.matches >= 8 && x.starts === 0) },
  { key: 'final_lost3', route: 'grit', name: '三次倒在决赛', desc: '首发输掉三场决赛', reward: { mental: 1 }, cond: (s) => starts(s).filter((m) => !m.won && !m.drawn && isFinal(m.label)).length >= 3 },
  { key: 'losing_skid', route: 'grit', name: '八连败', desc: '首发连输八场', reward: { heat: 10 }, cond: (s) => lossRun(starts(s)) >= 8 },
  { key: 'shore', route: 'grit', secret: true, name: '天梯上的四年', desc: '四年没签到合同，一直打到最后', reward: { title: '路人王' },
    cond: (s) => M(s).phase === 'retired' && M(s).ending?.key === 'shore' },
  { key: 'no_title_8', route: 'grit', secret: true, name: '空奖杯柜', desc: '八个职业赛季，一个冠军都没有', reward: { title: '一直在路上' },
    cond: (s) => proSeasons(s) >= 8 && M(s).titles.length === 0 },

  // ---- 场外
  { key: 'trait', route: 'life', name: '有了性格', desc: '获得第一个特质', reward: { heat: 10 }, cond: (s) => M(s).traits.length >= 1 },
  { key: 'traits2', route: 'life', name: '立体的人', desc: '两个特质', reward: { heat: 10 }, cond: (s) => M(s).traits.length >= 2 },
  { key: 'events20', route: 'life', name: '人生不止比赛', desc: '经历 20 个事件', reward: { fans: 10 }, cond: (s) => M(s).eventsSeen >= 20 },
  { key: 'money100k', route: 'life', name: '第一桶金', desc: '存款 $100,000', reward: { heat: 10 }, cond: (s) => M(s).money >= 100000 },
  { key: 'money1m', route: 'life', name: '财务自由', desc: '存款 $1,000,000', reward: { heat: 20 }, cond: (s) => M(s).money >= 1000000 },
]

export const ACH_BY_KEY: Record<string, AchDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]))

/* ------------------------------------------------------------------ */
/*  rewards                                                             */
/* ------------------------------------------------------------------ */

/** The reward in the words the list and the unlock card use. */
export function rewardText(r?: AchReward): string {
  if (!r) return ''
  const out: string[] = []
  if (r.title) out.push(`称号「${r.title}」`)
  if (r.mental) out.push(`心态 +${r.mental}`)
  if (r.body) out.push(`体质 +${r.body}`)
  if (r.fans) out.push(`粉丝 +${r.fans}`)
  if (r.heat) out.push(`热度 +${r.heat}`)
  if (r.money) out.push(`$${r.money.toLocaleString()}`)
  return out.join(' · ')
}

/** The save's own book of rewards; an older save gets an empty one, so what it already holds is paid once. */
export function achBook(me: MeState): NonNullable<MeState['achState']> {
  if (!me.achState) me.achState = { paid: [], seen: me.achievements.length }
  if (!Array.isArray(me.achState.paid)) me.achState.paid = []
  if (typeof me.achState.seen !== 'number') me.achState.seen = me.achievements.length
  return me.achState
}

function grant(state: GameState, r?: AchReward): void {
  const me = state.me!
  if (!r) return
  if (r.mental) me.mental = clamp(me.mental + r.mental, 0, 100)
  if (r.body) me.body = clamp(me.body + r.body, 0, 100)
  if (r.fans) me.fans = Math.max(0, me.fans + r.fans)
  if (r.heat) me.heat = Math.max(0, me.heat + r.heat)
  if (r.money) addMoney(state, 'inother', r.money)
}

/** Every 称号 earned, in the order they came. */
export function earnedTitles(me: MeState): string[] {
  return me.achievements.map((k) => ACH_BY_KEY[k]?.reward?.title).filter((t): t is string => !!t)
}

/** The one on the profile: the one picked, or the newest. */
export function wornTitle(me: MeState): string | undefined {
  const all = earnedTitles(me)
  const pick = me.achState?.worn
  return pick && all.includes(pick) ? pick : all[all.length - 1]
}

export function wearTitle(state: GameState, title: string): void {
  const me = state.me!
  if (!earnedTitles(me).includes(title)) return
  achBook(me).worn = title
}

/**
 * Newly earned this week — and whatever an earlier unlock has not been paid
 * for yet. Each key is paid exactly once: it is written into the book in the
 * same step that pays it.
 */
export function checkAchievements(state: GameState): AchDef[] {
  const me = state.me!
  const book = achBook(me)
  const fresh: AchDef[] = []
  for (const a of ACHIEVEMENTS) {
    if (me.achievements.includes(a.key)) continue
    let ok = false
    try { ok = a.cond(state) } catch { ok = false }
    if (!ok) continue
    me.achievements.push(a.key)
    fresh.push(a)
  }
  const paid = new Set(book.paid)
  const back: string[] = []
  for (const key of me.achievements) {
    if (paid.has(key)) continue
    paid.add(key)
    book.paid.push(key)
    const a = ACH_BY_KEY[key]
    if (!a) continue
    grant(state, a.reward)
    const r = rewardText(a.reward)
    if (fresh.includes(a)) {
      const line = `成就：${a.name}——${a.desc}。${r ? `奖励 ${r}。` : ''}`
      pushLog(state, 'good', line)
      me.weekNotes.push(line)
    } else if (r) {
      back.push(`${a.name}（${r}）`)
    }
  }
  if (back.length) {
    const line = `补发成就奖励：${back.join('；')}。`
    pushLog(state, 'good', line)
    me.weekNotes.push(line)
  }
  return fresh
}
