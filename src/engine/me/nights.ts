import { clamp } from '../rng'
import { AGENT_ROLE, MAP_META, agentCn, mapCn } from '../content'
import { ratingOf } from '../player'
import { REGION_CN } from '../types'
import type { Attrs, GameState, Player, Team } from '../types'
import type { CerDef, CerPick } from './ceremony'
import type { CerKind, CerTier, Ceremony, MeAward } from './types'
import { pushLog } from './log'
import { push } from './pending'
import { cerCounted } from './cerbudget'
import { bondAll, bondCardLines } from './bond'
import { compCn } from './compname'
import { outletRecap } from './outlets'
import { ARRIVALS_UNTIL, arrivalsBetween, arrivedBy } from './releases'
import type { Arrival } from './releases'

/**
 * Five more nights that are not matches: 年度颁奖夜, 退役仪式, 版本发布会,
 * 表演赛之夜 and 试训第一天.
 *
 * They run on me/ceremony.ts's machine — a story, a little game or a choice,
 * a tier, and 「直接过去」 is 银档 — and keep their own books here. What each
 * one is allowed to say is most of the work:
 *
 *  - the awards are read off the save's own season lines against the save's
 *    own league, and they are a media night's awards, never Riot's;
 *  - the patch night names an agent or a map only where releases.ts has the
 *    day it went live; past that table it names nothing;
 *  - the showmatch is a streaming platform's, on a Champions weekend — no
 *    official event is claimed;
 *  - the retirement is told from the career's own records and nothing else.
 */

export type NightKind = 'awards' | 'retire' | 'patch' | 'showmatch' | 'tryout'

const TIER_WORD: Record<CerTier, string> = { gold: '金档', silver: '银档', bronze: '铜档' }

export const isNight = (kind: CerKind): kind is NightKind => kind in NIGHTS

const busy = (state: GameState): boolean =>
  !!state.me!.cer || state.me!.pending.some((x) => x.kind === 'ceremony')

/** Once per key, on the same capped list ceremony.ts keeps. */
function seen(state: GameState, key: string): boolean {
  const me = state.me!
  me.cerSeen ??= []
  if (me.cerSeen.includes(key)) return false
  me.cerSeen.push(key)
  if (me.cerSeen.length > 160) me.cerSeen.splice(0, me.cerSeen.length - 160)
  return true
}

function open(state: GameState, kind: NightKind, about: string): void {
  state.me!.cer = { kind, step: 0, about }
  push(state, { kind: 'ceremony', id: kind })
  // the season's count of nights (me/cerbudget.ts): these five are never crowded out, but they take their place
  cerCounted(state, kind)
}

/** Training progress, without growth.ts (which imports ceremony.ts): rolls over at the next session. */
function bumpXp(p: Player, k: keyof Attrs, n: number): void {
  p.xp[k] = Math.min((p.xp[k] ?? 0) + n, 199)
}

/* ------------------------------------------------------------------ */
/*  年度颁奖夜                                                          */
/* ------------------------------------------------------------------ */

interface AwardRow { id: string; ign: string; team: string; role: string; maps: number; rating: number; acs: number; rookie: boolean }
export interface AwardCat { key: MeAward['key']; name: string; top: AwardRow[] }
export interface AwardsResult { league: string; cats: AwardCat[]; mine: AwardRow | null }

/** fans a trophy brings on the night — a following that grows with results, not a switch */
const AWARD_FANS: Record<MeAward['key'], number> = { mvp: 60, role: 35, rookie: 30 }

/** My club's league at my club's tier — a Challengers league by its scene, from 2023. The VCT clubs read a Challengers man's season off the same league (me/transfer.ts). */
export function leaguePool(state: GameState, club: Team): Team[] {
  return Object.values(state.teams).filter((t) => !t.dormant && t.tier === club.tier
    && (club.scene ? t.scene === club.scene : t.league === club.league))
}

/**
 * Rounds behind a man before this season: what vlr had on him before this
 * year's line was laid in, and what this save has played before this season.
 * 2021 is everybody's first VALORANT year, and this reads it that way.
 */
function priorRounds(p: Player): number {
  return Math.max(0, (p.rounds ?? 0) - (p.vlr?.rounds ?? 0)) + Math.max(0, p.career.rounds - p.season.rounds)
}

/**
 * The year's honours, from the season lines as they stand in the off-season —
 * before the winter wipes them. Rating first, ACS to break a tie; a line needs
 * 40% of the busiest man's maps to be judged at all. Three names a category.
 */
export function computeAwards(state: GameState): AwardsResult | null {
  const me = state.me!
  const club = state.teams[state.myTeam]
  const mine = state.players[me.id]
  if (me.phase !== 'pro' || !club || !mine) return null
  const ids = new Set<string>([me.id])
  for (const t of leaguePool(state, club)) for (const id of t.roster) ids.add(id)
  const firstPro = !me.seasons.some((s) => s.tier > 0)
  const rows: AwardRow[] = []
  for (const id of ids) {
    const p = state.players[id]
    if (!p || !p.season.rounds) continue
    rows.push({
      id, ign: p.ign, team: p.teamId ? state.teams[p.teamId]?.name ?? '' : '', role: p.role,
      maps: p.season.maps, rating: ratingOf(p.season), acs: (p.season.damage / p.season.rounds) * 1.45,
      rookie: id === me.id ? firstPro : p.age <= 21 && priorRounds(p) < 600,
    })
  }
  if (rows.length < 6) return null
  const need = Math.max(6, Math.round(Math.max(...rows.map((r) => r.maps)) * 0.4))
  const field = rows.filter((r) => r.maps >= need).sort((a, b) => b.rating - a.rating || b.acs - a.acs)
  if (field.length < 3) return null
  const cats: AwardCat[] = [{ key: 'mvp', name: '年度最佳选手', top: field.slice(0, 3) }]
  const role = field.filter((r) => r.role === mine.role)
  if (role.length >= 3) cats.push({ key: 'role', name: `最佳${mine.role}`, top: role.slice(0, 3) })
  const rookies = field.filter((r) => r.rookie)
  if (rookies.length >= 2) cats.push({ key: 'rookie', name: '年度最佳新人', top: rookies.slice(0, 3) })
  return {
    league: club.league || `${REGION_CN[club.region]}${club.tier === 1 ? '一线' : '二线'}`,
    cats, mine: field.find((r) => r.id === me.id) ?? null,
  }
}

const thisYear = (state: GameState): MeAward[] => (state.me!.awards ?? []).filter((a) => a.year === state.year)

/**
 * The off-season's first week. Every pro's year is judged and the result goes
 * in the log; only a name on a list gets a night. What was won is a fact the
 * moment it is read out, so it is booked here, whether or not I go up.
 */
export function awardsNight(state: GameState): boolean {
  const me = state.me!
  if (me.phase !== 'pro' || state.stage !== 'offseason' || busy(state)) return false
  if (!seen(state, `awards:${state.year}`)) return false
  const aw = computeAwards(state)
  if (!aw) return false
  const up = aw.cats.filter((c) => c.top.some((r) => r.id === me.id))
  if (!up.length) {
    const best = aw.cats[0].top[0]
    pushLog(state, 'info', `年度奖项：${aw.league}的年度最佳选手是 ${best.ign}${best.team ? `（${best.team}）` : ''}。名单上没有你。`)
    return false
  }
  me.awards ??= []
  for (const c of up) {
    const won = c.top[0].id === me.id
    me.awards.push({
      year: state.year, key: c.key, name: c.name, league: aw.league, won,
      winner: c.top[0].ign, winnerTeam: c.top[0].team, nominees: c.top.map((r) => r.ign),
      rating: Math.round((aw.mine?.rating ?? 0) * 100) / 100,
    })
    if (won) me.fans += AWARD_FANS[c.key]
  }
  const won = up.filter((c) => c.top[0].id === me.id).map((c) => c.name)
  const lost = up.filter((c) => c.top[0].id !== me.id).map((c) => c.name)
  me.heat += won.length ? 10 : 4
  pushLog(state, won.length ? 'good' : 'info', won.length
    ? `年度奖项：你拿到<b>${won.join('、')}</b>${lost.length ? `，另外入围了${lost.join('、')}` : ''}。`
    : `年度奖项：你入围了${lost.join('、')}，没拿到。`)
  open(state, 'awards', aw.league)
  return true
}

/** The line I go up with: what was won decides what gets said. */
export function speechOf(state: GameState): { parts: string[]; fillers: string[] } {
  const list = thisYear(state)
  const won = (k: MeAward['key']) => list.some((a) => a.key === k && a.won)
  const fillers = ['呃……', '那个']
  if (won('mvp')) return { parts: ['谢谢队友', '谢谢教练组', '这一年', '每一场', '都算数'], fillers }
  if (won('role')) return { parts: ['这座奖杯', '有一半', '属于', '身后', '那四个人'], fillers }
  if (won('rookie')) return { parts: ['一年前', '没人', '知道我', '是谁', '谢谢你们记住'], fillers }
  return { parts: ['恭喜', list[0]?.winner ?? '他', '他配得上', '明年', '再来'], fillers }
}

function awardsAfter(state: GameState, tier: CerTier): string {
  if (tier === 'gold') return '一口气说完，没卡壳。热度 +12，心态 +2。'
  if (tier === 'bronze') return `${thisYear(state).some((a) => a.won) ? '领奖台上' : '镜头前'}卡了壳，片段被剪出来传开了。热度 +4，心态 −2。`
  return '说完了，挑不出毛病。'
}

/* ------------------------------------------------------------------ */
/*  表演赛之夜                                                          */
/* ------------------------------------------------------------------ */

/** 全网知名 — enough of a name that a platform wants it on the poster */
export const SHOWMATCH_FANS = 900

/**
 * Champions is on and my club is not in it. A platform's showmatch that
 * weekend, stars and streamers mixed — the one big-event night open to a
 * name without a seat. A club that did qualify has 出征 and 抽签 instead.
 */
export function showmatchNight(state: GameState): boolean {
  const me = state.me!
  if (me.phase !== 'pro' || state.stage !== 'champions' || me.fans < SHOWMATCH_FANS || busy(state)) return false
  const champs = Object.values(state.comps).find((c) => c.stage === 'champions' && !c.champion)
  if (!champs || champs.teams.includes(state.myTeam)) return false
  if (!seen(state, `showmatch:${state.year}`)) return false
  open(state, 'showmatch', champs.city ?? '')
  return true
}

const SHOW_EFFECT: Record<CerTier, { heat: number; fans: number }> = {
  gold: { heat: 20, fans: 30 }, silver: { heat: 8, fans: 0 }, bronze: { heat: 3, fans: 0 },
}

/* ------------------------------------------------------------------ */
/*  版本发布会                                                          */
/* ------------------------------------------------------------------ */

/** mid-January: every year this game plays opened on a big patch by then */
const PATCH_FROM = 14
const PATCH_TO = 70

/** The year's first big patch, for anyone still playing — with a club or without one. */
export function patchNight(state: GameState): boolean {
  const me = state.me!
  if (me.phase === 'retired' || state.day < PATCH_FROM || state.day > PATCH_TO || busy(state)) return false
  if (!state.players[me.id]) return false
  if (!seen(state, `patch:${state.year}`)) return false
  open(state, 'patch', String(state.year))
  return true
}

/** What went live since last year's patch night: this year's, and last year's after it. */
function patchNews(state: GameState): { fresh: Arrival[]; past: Arrival[] } {
  const all = arrivalsBetween(state.year - 1, PATCH_FROM, state.year, state.day)
  return { fresh: all.filter((a) => a.year === state.year), past: all.filter((a) => a.year < state.year) }
}

function listOf(l: Arrival[]): string {
  const agents = l.filter((a) => a.kind === 'agent').map((a) => agentCn(a.name))
  const maps = l.filter((a) => a.kind === 'map').map((a) => mapCn(a.name))
  return [agents.length ? `特工${agents.join('、')}` : '', maps.length ? `地图${maps.join('、')}` : ''].filter(Boolean).join('，')
}

/**
 * The agent 「跟版本走」 puts in my pool: one that just went live and fits my
 * job, else the one my job is played on across the most maps. Never one that
 * has not gone live yet by this date.
 */
function poolCandidate(state: GameState): string | null {
  const p = state.players[state.me!.id]
  if (!p) return null
  const jobs: string[] = p.roles ?? [p.role]
  const fits = (a: string) => jobs.includes('自由人') || jobs.includes(AGENT_ROLE[a])
  const { fresh, past } = patchNews(state)
  const news = [...past, ...fresh].filter((x) => x.kind === 'agent' && fits(x.name) && !p.agentPool.includes(x.name))
  if (news.length) return news[news.length - 1].name
  const tally = new Map<string, number>()
  for (const list of Object.values(MAP_META)) {
    for (const a of list) {
      if (!AGENT_ROLE[a] || !fits(a) || p.agentPool.includes(a) || !arrivedBy(a, state.year, state.day)) continue
      tally.set(a, (tally.get(a) ?? 0) + 1)
    }
  }
  return [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
}

function patchAfter(state: GameState, pick: string | undefined): string {
  const a = poolCandidate(state)
  if (pick === 'adapt') return `${a ? `${agentCn(a)}进了池子。` : ''}道具和意识多涨一截，这阵子手感会乱一点。`
  if (pick === 'stick') return '手感稳一点，枪法多练一截。'
  return '池子照旧。'
}

/* ------------------------------------------------------------------ */
/*  试训第一天                                                          */
/* ------------------------------------------------------------------ */

/** Opened by startTryout, before day one: the first hour at the base. */
export function tryoutNight(state: GameState): void {
  const me = state.me!
  const t = me.tryout
  if (!t || busy(state)) return
  if (!seen(state, `tryout:${state.year}:${t.teamId}`)) return
  open(state, 'tryout', state.teams[t.teamId]?.name ?? '俱乐部')
}

/** a nudge on the four days' score — a grade band is 8 wide, a day swings up to 5 */
const TRYOUT_NUDGE: Record<CerTier, number> = { gold: 1.5, silver: 0, bronze: -1 }

/* ------------------------------------------------------------------ */
/*  退役仪式                                                            */
/* ------------------------------------------------------------------ */

/** Opened by retire(), before the career card. A career that never signed has no club to hold one. */
export function retireNight(state: GameState): void {
  const me = state.me!
  if (!me.seasons.some((s) => s.tier > 0) || busy(state)) return
  if (!seen(state, 'retire')) return
  open(state, 'retire', String(state.year))
}

/** The career in five or six lines, every one of them off the save's own records. */
export function retireRecap(state: GameState): string[] {
  const me = state.me!
  const pro = me.seasons.filter((s) => s.tier > 0)
  if (!pro.length) return []
  const lines: string[] = []
  const clubs = [...new Set(pro.map((s) => s.team))]
  const span = pro[0].year === pro[pro.length - 1].year ? `${pro[0].year} 年` : `${pro[0].year}–${pro[pro.length - 1].year}`
  lines.push(`${span}，${pro.length} 个职业赛季，效力过 ${clubs.join('、')}。`)
  const started = me.titles.filter((t) => t.started)
  const weight = (t: string) => (/Champions/.test(t) ? 3 : /Masters/.test(t) ? 2 : 1)
  if (started.length) {
    const top = started.slice().sort((a, b) => weight(b.title) - weight(a.title) || a.year - b.year).slice(0, 3)
    lines.push(`冠军 ${started.length} 座：${top.map((t) => `${t.year} ${compCn(t.title)}`).join('、')}${started.length > 3 ? ' 等' : ''}。`)
  } else {
    lines.push(me.titles.length ? '冠军名单上有过你的名字，那几场你都没上。' : '没有拿过冠军。')
  }
  const best = pro.filter((s) => s.starts >= 5).sort((a, b) => b.acs - a.acs)[0]
    ?? pro.slice().sort((a, b) => b.starts - a.starts)[0]
  if (best) lines.push(`最好的一年是 ${best.year}：${best.team}，首发 ${best.starts} 场${best.acs ? `，ACS ${best.acs}` : ''}。`)
  const won = (me.awards ?? []).filter((a) => a.won)
  if (won.length) lines.push(`年度奖项：${won.map((a) => `${a.year} ${a.name}`).join('、')}。`)
  // what the career earned, and some of where it went (me/outlets.ts)
  const earned = outletRecap(state)
  if (earned) lines.push(earned)
  lines.push(...bondCardLines(state).slice(0, 2))
  return lines
}

/** the ones still beside me in the last pro season, and the first one I ever played with */
function mates(state: GameState): { youngest?: string; first?: string; last?: string } {
  const me = state.me!
  const lastYear = Math.max(0, ...me.seasons.filter((s) => s.tier > 0).map((s) => s.year))
  const all = bondAll(state)
  const recent = all.filter((e) => e.lastYear >= lastYear && e.gone !== 'retired')
  const youngest = recent.slice().sort((a, b) => (state.players[a.id]?.age ?? 99) - (state.players[b.id]?.age ?? 99))[0]
  const first = all.slice().sort((a, b) => a.firstYear - b.firstYear)[0]
  const last = all.slice().sort((a, b) => b.lastYear - a.lastYear || b.stages - a.stages)[0]
  return { youngest: youngest?.ign, first: first?.ign, last: last?.ign }
}

function farewellPicks(state: GameState): CerPick[] {
  const m = mates(state)
  return [
    { key: 'bow', label: '对着看台鞠一躬', sub: '一句话都不用说。', tier: 'gold' },
    { key: 'gear', label: m.youngest ? `把鼠标留给 ${m.youngest}` : '把鼠标留在机位上', sub: m.youngest ? '最后一支队里最年轻的那个。' : '留给下一个坐这里的人。', tier: 'gold' },
    { key: 'names', label: '把队友的名字挨个念一遍', sub: m.first ? `从 ${m.first} 念起。` : '从第一支队伍念起。', tier: 'gold' },
  ]
}

function farewellLine(state: GameState, pick: string | undefined): string {
  const m = mates(state)
  if (pick === 'bow') return '你弯下腰，停了三秒。直起身的时候，看台上有人把你的 ID 喊了一遍，又喊了一遍。'
  if (pick === 'gear') return m.youngest ? `你把用了几年的鼠标放在 ${m.youngest} 的机位上，没留纸条。他知道是谁的。` : '你把鼠标留在机位上，没留纸条。'
  if (pick === 'names') {
    return m.first && m.last && m.first !== m.last
      ? `你从 ${m.first} 念起，念到 ${m.last}。中间停了一次，台下没有人催。`
      : '你一个一个念下去。中间停了一次，台下没有人催。'
  }
  return '你说了声谢谢，把话筒还给主持人，从侧门出去了。'
}

/* ------------------------------------------------------------------ */
/*  The five, as ceremony.ts reads them                                */
/* ------------------------------------------------------------------ */

export const NIGHTS: Record<NightKind, CerDef> = {
  awards: {
    kind: 'awards', name: '年度颁奖夜', game: 'speech', go: '上台',
    story: (s, about) => {
      const list = thisYear(s)
      const lines = list.map((a) => `· ${a.name}：${a.nominees.join('、')}——${a.won ? '念出来的是你' : `是 ${a.winner}`}。`)
      return `${about} · 年度颁奖夜。圈里的媒体办的，按这一季的数据评。\n${lines.join('\n')}\n${list.some((a) => a.won) ? '主持人把话筒递了过来。' : '镜头切到你，你得说两句。'}`
    },
    blurb: { gold: '一口气说完，没卡壳。', silver: '说完了，挑不出毛病。', bronze: '卡了壳，片段被剪出来传开了。' },
    after: (s, cer) => awardsAfter(s, cer.tier ?? 'silver'),
  },
  showmatch: {
    kind: 'showmatch', name: '表演赛之夜', game: 'ace', go: '下场',
    story: (_s, about) => `冠军赛${about ? `在${about}` : ''}开打，你们队没进。一家直播平台趁着这个周末办了场表演赛，人气选手和主播混着编队——名单上有你。\n规则只有一条：打得好看。`,
    blurb: {
      gold: '打出了五杀，全场站起来了。热度 +20，粉丝多了一截。',
      silver: '打得挺开心。热度 +8。',
      bronze: '手没热开，还被一个主播打了五杀。热度 +3，当个乐子。',
    },
  },
  patch: {
    kind: 'patch', name: '版本发布会', game: 'pick', go: '看改动',
    story: (s) => {
      const { fresh, past } = patchNews(s)
      const lines = ['新赛季的大版本上线了。']
      if (fresh.length) lines.push(`这个版本带来了${listOf(fresh)}。`)
      if (past.length) lines.push(`去年这一年，多了${listOf(past)}。`)
      if (!fresh.length && !past.length) lines.push(s.year > ARRIVALS_UNTIL + 1 ? '改动表很长，没有一条冲着你来，也没有一条能不管。' : '改动表很长。')
      lines.push(s.me!.phase === 'pro' ? '教练把白板转过来：「你的池子，动不动？」' : '车队群里有人问：「新版本，池子动不动？」')
      return lines.join('\n')
    },
    blurb: { gold: '', silver: '', bronze: '' },
    ask: '这个赛季怎么打，现在定。',
    skipNote: '「直接过去」就是照旧，什么都不变。',
    picks: (s) => {
      const a = poolCandidate(s)
      return [
        { key: 'adapt', label: a ? `把${agentCn(a)}练进池子` : '跟着版本改池子', sub: '道具和意识多涨一截；这阵子手感会乱一点。', tier: 'silver' },
        { key: 'stick', label: '守住手里的池子', sub: '手感稳一点，枪法多练一截；新东西以后再说。', tier: 'silver' },
      ]
    },
    after: (s, cer) => patchAfter(s, cer.detail?.pick),
  },
  tryout: {
    kind: 'tryout', name: '试训第一天', game: 'react', go: '热手',
    story: (_s, about) => `${about} 的训练基地。经理带你转了一圈：训练室、复盘室、宿舍，最后停在一台空机位前。\n「热热手，教练十分钟后过来。」`,
    blurb: {
      gold: '热手打得漂亮，教练在本子上记了一笔。评估分 +1.5。',
      silver: '正常热手。评估分不变。',
      bronze: '手一直没热起来，教练看在眼里。评估分 −1。',
    },
  },
  retire: {
    kind: 'retire', name: '退役仪式', game: 'pick', go: '上台', done: '看生涯名片',
    story: (s) => [...retireRecap(s), '灯打到台上，主持人把话筒递给你。'].join('\n'),
    blurb: { gold: '', silver: '', bronze: '' },
    ask: '最后一件事。',
    skipNote: '「直接过去」也有一个告别，只是不由你挑。',
    picks: farewellPicks,
    after: (s, cer) => farewellLine(s, cer.detail?.pick),
  },
}

/** The consequences and the line for the record, for the five. Skipping lands on silver, as ever. */
export function nightApply(state: GameState, kind: NightKind, tier: CerTier, skipped: boolean, cer: Ceremony | undefined): void {
  const me = state.me!
  const p = state.players[me.id]
  const def = NIGHTS[kind]
  const pick = skipped ? undefined : cer?.detail?.pick
  const color = tier === 'gold' ? 'good' : tier === 'bronze' ? 'bad' : 'info'
  switch (kind) {
    case 'awards': {
      if (tier === 'gold') { me.heat += 12; me.mental = clamp(me.mental + 2, 0, 100) }
      if (tier === 'bronze') { me.heat += 4; me.mental = clamp(me.mental - 2, 0, 100) }
      pushLog(state, color, skipped
        ? `${def.name}：你没上台${thisYear(state).some((a) => a.won) ? '，奖是经理替你领的' : ''}。`
        : `${def.name}的致辞 <b>${TIER_WORD[tier]}</b>：${awardsAfter(state, tier)}`)
      return
    }
    case 'showmatch': {
      me.heat += SHOW_EFFECT[tier].heat
      me.fans += SHOW_EFFECT[tier].fans
      pushLog(state, color, skipped
        ? `${def.name}：你去了，没下场，在解说席坐了一局。热度 +8。`
        : `${def.name}的五连靶 <b>${TIER_WORD[tier]}</b>：${def.blurb[tier]}`)
      return
    }
    case 'patch': {
      if (p && pick === 'adapt') {
        // read before the pool changes, so the log names what the screen named
        const line = patchAfter(state, pick)
        const a = poolCandidate(state)
        if (a && !p.agentPool.includes(a)) p.agentPool = [...p.agentPool, a]
        bumpXp(p, 'utility', 25)
        bumpXp(p, 'awareness', 10)
        p.form = clamp(p.form - 3, 30, 99)
        pushLog(state, 'info', `${def.name}：你决定跟版本走。${line}`)
      } else if (p && pick === 'stick') {
        bumpXp(p, 'aim', 15)
        p.form = clamp(p.form + 2, 30, 99)
        pushLog(state, 'info', `${def.name}：你守住了手里的池子。${patchAfter(state, pick)}`)
      } else {
        pushLog(state, 'info', `${def.name}：你没去开会，池子照旧。`)
      }
      return
    }
    case 'tryout': {
      const t = me.tryout
      if (t && t.step === 0) t.score += TRYOUT_NUDGE[tier]
      pushLog(state, color, skipped
        ? `${def.name}：你没热手，直接进了考核。评估分不变。`
        : `${def.name}的热手 <b>${TIER_WORD[tier]}</b>：${def.blurb[tier]}`)
      return
    }
    case 'retire': {
      pushLog(state, 'season', `<b>${def.name}。</b>${farewellLine(state, pick)}`)
      return
    }
  }
}
