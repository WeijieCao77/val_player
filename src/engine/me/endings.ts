import type { Rng } from '../rng'
import type { GameState } from '../types'
import { pushLog } from './log'
import { push } from './pending'
import { leaveClub } from './contract'

export interface EndingDef { key: string; title: string; text: string; cond: (s: GameState) => boolean }

const intl = (s: GameState, re: RegExp) => s.me!.titles.filter((t) => re.test(t.title))
const proSeasons = (s: GameState) => s.me!.seasons.filter((x) => x.tier > 0).length

/** In order: the first that holds is the ending. */
export const ENDINGS_ME: EndingDef[] = [
  { key: 'breaker', title: '破局者', text: '同一年捧起大师赛和冠军赛。这个赛区的天花板，是你亲手推上去的。',
    cond: (s) => { const y = new Set(intl(s, /Masters/).filter((t) => t.started).map((t) => t.year)); return intl(s, /Champions/).some((t) => t.started && y.has(t.year)) } },
  { key: 'dynasty', title: '王朝', text: '两座冠军赛奖杯。以后人们提起这个时代，会先提你的名字。', cond: (s) => intl(s, /Champions/).filter((t) => t.started).length >= 2 },
  { key: 'world', title: '世界冠军', text: '你站在了那个舞台的最中央。一次就够写进历史。', cond: (s) => intl(s, /Champions/).some((t) => t.started) },
  { key: 'master', title: '大师', text: '大师赛冠军。离最高处只差一步，但你确实站上去过。', cond: (s) => intl(s, /Masters/).some((t) => t.started) },
  { key: 'uncrowned', title: '无冕之王', text: '打进过冠军赛决赛，输了。那一晚很多人记得你，没有奖杯记得你。', cond: (s) => !!s.me!.flags.champFinalLost },
  { key: 'regional', title: '赛区功勋', text: '三个以上赛区冠军。国际赛没有站上顶点，但这个赛区的每个人都认识你。', cond: (s) => s.me!.titles.filter((t) => !/Masters|Champions/.test(t.title) && t.started).length >= 3 },
  { key: 'ring', title: '板凳上的冠军', text: '你的名字在冠军名单上，你的位置在替补席。这枚戒指是真的，也是别人的。', cond: (s) => s.me!.titles.length > 0 && !s.me!.titles.some((t) => t.started) },
  { key: 'oneclub', title: '一队终老', text: '六个赛季，一家俱乐部。这在这个行业里比冠军还少见。', cond: (s) => s.me!.tenure >= 6 },
  { key: 'evergreen', title: '常青树', text: '八个赛季。天赋比你高的人来了又走，你还在名单上。', cond: (s) => proSeasons(s) >= 8 },
  { key: 'abroad', title: '远征', text: '在外赛区打了两个赛季以上。语言、时差、想家——你都熬过了。', cond: (s) => (s.me!.flags.abroadSeasons ?? 0) >= 2 },
  // A player with one regional title used to fall through to 「没有冠军」,
  // which the career card contradicts on the same screen — it lists the trophy
  // right above the verdict. 3+ is 赛区功勋; 1–2 is still a trophy.
  { key: 'titled', title: '拿过冠军', text: '赛区冠军捧过，国际赛没走远。奖杯柜里不空——这一行里，这已经把你和绝大多数人分开了。',
    cond: (s) => s.me!.titles.some((t) => t.started) },
  { key: 'journeyman', title: '泯然众人', text: '三个赛季以上的职业生涯，没有冠军。大多数职业选手的故事就是这样，而且不丢人。', cond: (s) => proSeasons(s) >= 3 },
  { key: 'flash', title: '昙花一现', text: '签过约，打过正赛，然后没有下一份合同。这行的门槛在门外，也在门里。', cond: (s) => proSeasons(s) >= 1 },
  { key: 'shore', title: '没能上岸', text: '几年的天梯和杯赛，电话没有响。你比绝大多数人打得都好，只是不够。', cond: () => true },
]

export function endingFor(state: GameState): EndingDef {
  for (const e of ENDINGS_ME) {
    try { if (e.cond(state)) return e } catch { /* next */ }
  }
  return ENDINGS_ME[ENDINGS_ME.length - 1]
}

/** Hang them up. */
export function retire(state: GameState, why: string): void {
  const me = state.me!
  if (me.phase === 'retired') return
  const e = endingFor(state)
  if (me.phase === 'pro') leaveClub(state, why)
  me.phase = 'retired'
  me.ending = { key: e.key, title: e.title, text: e.text, year: state.year }
  state.gameOver = `${why}——${e.title}`
  state.finished = true
  pushLog(state, 'season', `${why}。结局：${e.title}。`)
  push(state, { kind: 'ending' })
}

/**
 * The winter's question. Nobody plays forever: the body decides after thirty,
 * the market decides for a free agent nobody calls, and a player with five
 * seasons behind him may decide for himself.
 */
export function retirementTick(state: GameState, rng: Rng): void {
  const me = state.me!
  const p = state.players[me.id]
  if (me.phase === 'retired') return
  if (me.phase === 'pre' && me.pre.year >= 4) { retire(state, '四年没有签到合同，你放弃了'); return }
  if (me.phase === 'free' && me.freeYears >= 2) { retire(state, '两年没有俱乐部来电话，你宣布退役'); return }
  if (p.age >= 33) { retire(state, '33 岁，你宣布退役'); return }
  if (p.age >= 30 && me.phase === 'pro' && rng.chance(0.25 + (p.age - 30) * 0.1)) { retire(state, `${p.age} 岁，手已经跟不上眼了，你宣布退役`); return }
  const pro = me.seasons.filter((x) => x.tier > 0).length
  me.retireAsk = pro >= 5
}
