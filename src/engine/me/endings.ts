import type { Rng } from '../rng'
import type { GameState } from '../types'
import { pushLog } from './log'
import { push } from './pending'
import { leaveClub } from './contract'
import { WORLD_END } from '../era'
import { checkAchievements } from './achievements'
import { retireNight } from './nights'
import { compClass, isIntlComp } from './compclass'
import { lifeLines } from './shop'
import { outletLines } from './outlets'
import { track } from './telemetry'
import { queueEndingFeedback } from './endingFeedback'
import { careerMarksFor } from './careerMarks'

export interface EndingDef { key: string; title: string; text: string; cond: (s: GameState) => boolean }

/**
 * Why a career ended, as one of a fixed list.
 *
 * `why` itself is a sentence built for the screen — it carries an age and a
 * year in it — and a sentence is not something to report (engine/me/telemetry.ts:
 * only this game's own enumerated values go out). So every caller says which of
 * these it is, and that is what the record gets.
 */
export type RetireWhy = 'world_end' | 'pre_unsigned' | 'free_uncalled' | 'age_cap' | 'age_decline' | 'chose' | 'other'

// by what the event is, not by an English word in its name: on the timeline Masters is 「伦敦大师赛」
const intl = (s: GameState, kind: 'masters' | 'champions') => s.me!.titles.filter((t) => compClass(t.title) === kind)
const proSeasons = (s: GameState) => s.me!.seasons.filter((x) => x.tier > 0).length

export const RETIREMENT_AGE_CAP = 33
export const RETIREMENT_DECLINE_AGE = 30

/** One compact line for the season card about when the road ends; never a seasons-remaining count. */
export function seasonHorizonLine(state: GameState): string {
  const age = state.players[state.me!.id]?.age ?? 0
  return `世界线到 ${WORLD_END - 1} 赛季为止（不是你的年龄上限）。你现在 ${age} 岁。${RETIREMENT_DECLINE_AGE} 岁起每次赛季结算可能因年龄退役，${RETIREMENT_AGE_CAP} 岁是年龄上限；连续四年未签约或连续两年自由身也会结束生涯。`
}

/** In order: the first that holds is the ending. */
export const ENDINGS_ME: EndingDef[] = [
  { key: 'breaker', title: '破局者', text: '同一年捧起大师赛和冠军赛。这个赛区的天花板，是你亲手推上去的。',
    cond: (s) => { const y = new Set(intl(s, 'masters').filter((t) => t.started).map((t) => t.year)); return intl(s, 'champions').some((t) => t.started && y.has(t.year)) } },
  { key: 'dynasty', title: '王朝', text: '两座冠军赛奖杯。以后人们提起这个时代，会先提你的名字。', cond: (s) => intl(s, 'champions').filter((t) => t.started).length >= 2 },
  { key: 'world', title: '世界冠军', text: '你站在了那个舞台的最中央。一次就够写进历史。', cond: (s) => intl(s, 'champions').some((t) => t.started) },
  { key: 'master', title: '大师', text: '大师赛冠军。离最高处只差一步，但你确实站上去过。', cond: (s) => intl(s, 'masters').some((t) => t.started) },
  { key: 'uncrowned', title: '无冕之王', text: '打进过冠军赛决赛，输了。那一晚很多人记得你，没有奖杯记得你。', cond: (s) => !!s.me!.flags.champFinalLost },
  { key: 'regional', title: '赛区功勋', text: '三个以上赛区冠军。国际赛没有站上顶点，但这个赛区的每个人都认识你。', cond: (s) => s.me!.titles.filter((t) => !isIntlComp(t.title) && t.started).length >= 3 },
  { key: 'ring', title: '板凳上的冠军', text: '你的名字在冠军名单上，你的位置在替补席。这枚戒指是真的，也是别人的。', cond: (s) => s.me!.titles.length > 0 && !s.me!.titles.some((t) => t.started) },
  { key: 'oneclub', title: '一队终老', text: '六个赛季，一家俱乐部。这在这个行业里比冠军还少见。', cond: (s) => s.me!.tenure >= 6 },
  { key: 'evergreen', title: '常青树', text: '八个赛季。天赋比你高的人来了又走，你还在名单上。', cond: (s) => proSeasons(s) >= 8 },
  // 「无冠就是无冠不要写远征」 (the author, 2026-09-17). Two seasons abroad alone
  // used to be enough, and this line sits above 泯然众人 / 昙花一现, so a career
  // that won nothing usually read 「远征」 — a travel note where the verdict goes,
  // since the autopilot is fond of foreign spells.
  //
  // Moving the line down cannot fix it. Below 拿过冠军 the only careers left to
  // reach it are the ones with nothing on the shelf — exactly backwards — and
  // below 泯然众人 none reaches it at all: two seasons abroad are two pro seasons,
  // which 泯然众人 and 昙花一现 already take. Ordering ranks careers; it cannot
  // tell one apart. So the trophy goes into the condition: 远征 is a career that
  // went out and brought something back. A spell abroad that won nothing is said
  // in the ending's own words instead (abroadLine), never in its verdict.
  // 出海 is by country, not by league (me/contract.ts joinClub `me.abroad`), so this says 国外 and not 外赛区: a move
  // inside one VCT league — NAVI 到 Team Liquid, both EMEA — is 「国外俱乐部」 and never 外赛区 (reported 2026-09-20).
  { key: 'abroad', title: '远征', text: '在国外打了两个赛季以上，奖杯柜也不空。语言、时差、想家——你都熬过了。',
    cond: (s) => (s.me!.flags.abroadSeasons ?? 0) >= 2 && s.me!.titles.some((t) => t.started) },
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

/**
 * 退役后留在教练组: the coach asked once (me/events_more.ts vet_staff) and the
 * answer was taken down. It was asked and then forgotten — both answers wrote
 * nothing at all (2026-09-16) — so the last card says which way it went. The
 * year after retirement is not built here: this is one line, not a second life.
 */
const staffLines = (state: GameState): string[] => {
  const me = state.me!
  if (me.flags.staffYes) return ['退役第二天，你还是走进了那间训练室，只是坐到了教练组那一侧。']
  if (me.flags.staffNo) return ['教练问过你要不要留下来带队。你说你还能打——你把那句话打到了最后一天。']
  return []
}

/**
 * The trip, for a career the trophy cabinet judged. Taking 「远征」 away from a
 * trophyless career (ENDINGS_ME above) takes with it the only line that ever
 * said this career left home — so the ending says it in its own words, where a
 * travel note belongs. Said for exactly the two endings that lost the verdict
 * this way: 泯然众人 and 昙花一现, at the same two seasons abroad that used to
 * be the verdict. 没能上岸 never signed anywhere, at home or away.
 */
const abroadLine = (state: GameState, key: string): string[] => {
  const n = state.me!.flags.abroadSeasons ?? 0
  if (n < 2 || (key !== 'journeyman' && key !== 'flash')) return []
  return [`其中 ${n} 个赛季是在国外打的。语言、时差、想家你都熬过来了，只是没拿回奖杯。`]
}

/** Hang them up. What the money became off the stage (me/shop.ts LIFESTYLE, me/outlets.ts) is the ending's last words. */
export function retire(state: GameState, why: string, kind: RetireWhy = 'other'): void {
  const me = state.me!
  if (me.phase === 'retired') return
  const e = endingFor(state)
  if (me.phase === 'pro') leaveClub(state, why)
  me.phase = 'retired'
  me.ending = { key: e.key, title: e.title, text: `${e.text}${abroadLine(state, e.key).join('')}${lifeLines(state).join('')}${outletLines(state).join('')}${staffLines(state).join('')}`, year: state.year }
  const marks = careerMarksFor(state)
  if (marks.length) me.ending.marks = marks
  queueEndingFeedback(state)
  state.gameOver = `${why}——${e.title}`
  state.finished = true
  pushLog(state, 'season', `${why}。结局：${e.title}。`)
  // no week settles after this one: what the last day earned is counted now
  checkAchievements(state)
  // the night of it goes on screen before the card (me/nights.ts)
  retireNight(state)
  push(state, { kind: 'ending' })
  // Which of the fourteen endings a career reached, and what it took to get
  // there — every road out goes through this one function. The ending's key,
  // never its title or its text: those are sentences (engine/me/telemetry.ts).
  const seasons = me.seasons.filter((x) => x.tier > 0)
  track('ending', {
    key: e.key,
    why: kind,
    age: state.players[me.id]?.age ?? 0,
    pro_seasons: seasons.length,
    titles: me.titles.length,
    titles_started: me.titles.filter((t) => t.started).length,
    // the best rung ever stood on: 1 是 VCT，2 是 Challengers，0 是从没签上
    peak_tier: seasons.some((x) => x.tier === 1) ? 1 : seasons.some((x) => x.tier === 2) ? 2 : 0,
    year: state.year,
    entry_year: me.entryYear ?? 0,
  })
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
  // the world line itself ends: whatever the career is, it ends with it
  if (state.year >= WORLD_END) { retire(state, `${WORLD_END - 1} 赛季结束，这条世界线到这里为止`, 'world_end'); return }
  if (me.phase === 'pre' && me.pre.year >= 4) { retire(state, '四年没有签到合同，你放弃了', 'pre_unsigned'); return }
  if (me.phase === 'free' && me.freeYears >= 2) { retire(state, '两年没有俱乐部来电话，你宣布退役', 'free_uncalled'); return }
  if (p.age >= RETIREMENT_AGE_CAP) { retire(state, `${RETIREMENT_AGE_CAP} 岁，你宣布退役`, 'age_cap'); return }
  if (p.age >= RETIREMENT_DECLINE_AGE && me.phase === 'pro' && rng.chance(0.25 + (p.age - RETIREMENT_DECLINE_AGE) * 0.1)) { retire(state, `${p.age} 岁，手已经跟不上眼了，你宣布退役`, 'age_decline'); return }
  const pro = me.seasons.filter((x) => x.tier > 0).length
  me.retireAsk = pro >= 5
}
