import { eventOf, eventsOf } from '../circuit'
import type { CEvent } from '../circuit'
import { onTimeline, stageNameIn } from '../era'
import type { Competition, GameState } from '../types'
import { compClass } from './compclass'
import type { CompClass } from './compclass'
import { compCn } from './compname'
import { BIG_TIERS } from './moments'
import type { MeIntlRun, MeMatchRecord, MeRewrite, MeSeason, MeState } from './types'
import { titleRealChamp } from './worldline'

/**
 * 本局奖杯: this career's trophy case.
 *
 * The author's brief of 2026-09-19: 「在成就栏目加一个当局的展示栏，专门放冠军详情，就是本局玩家拿的冠军，比如大师赛
 * 冠军，赛段冠军之类的。然后按照重要程度排好，还有有个点击按钮可以点进去查看当时夺冠的情况以及配一段文字描述」.
 *
 * **Read, never written**, the way the history ledger is (me/worldline.ts). A trophy is already written down the day
 * it is won — `me.titles` — and everything else about it is already written down somewhere too: the season's row, my
 * own record of the event's matches, the club's international campaign, the season's ledger of what came out
 * otherwise than history. Nothing here adds a field to the save, so nothing has to be kept in step, no old save has
 * to be migrated, and the case cannot drift from the records it reads.
 *
 * The price of that is that the case says less about an old trophy than a new one, and it must say less honestly.
 * The per-match detail covers the last year of the career's calendar and the rest is let go (me/detail.ts), and the
 * year's competitions are cleared when the year turns (engine/season.ts). So a trophy inside the window carries its
 * final, its maps and my line in it; a trophy from five years ago carries its year, its event, its club, my part in
 * it, whatever the season's row kept and whatever history says about the event. **Never a guess to fill the gap.**
 *
 * The order is the game's own and not a second one: 冠军赛 > 大师赛 / LOCK//IN > 赛区冠军, read off what the event is
 * (me/compclass.ts) — the same call the career-end card ranks its wall by (ui/me/Poster.tsx), the ending is judged by
 * (me/endings.ts) and the share card sorts by (ui/me/share.ts) — then one I started in above one I watched, then the
 * earlier year. trophyTier below is that call, and those screens import it rather than keeping copies.
 */

/* ------------------------------------------------------------------ */
/*  the order                                                          */
/* ------------------------------------------------------------------ */

export type TrophyTier = 'champions' | 'masters' | 'league'

/** 冠军赛 > 大师赛 > 赛区冠军. LOCK//IN is an international, so it stands with the 大师赛. */
export const TROPHY_RANK: Record<TrophyTier, number> = { champions: 0, masters: 1, league: 2 }

/**
 * Which of the three a trophy is, read off what the event is rather than off an English word in its name — the
 * timeline books a competition under its Chinese name (engine/circuit.ts: 「2024 全球冠军赛」), and a regex on
 * 「Champions」 ranked a world title level with a Challengers stage on every modern save.
 */
export function trophyTier(name: string): TrophyTier {
  const c = compClass(name)
  return c === 'champions' ? 'champions' : c === 'masters' || c === 'lockin' ? 'masters' : 'league'
}

/* ------------------------------------------------------------------ */
/*  what the save holds about one trophy                               */
/* ------------------------------------------------------------------ */

/** One match of the run, off my own record of it (me/detail.ts keeps the last year). */
export interface TrophyMatch {
  /** the series as the fixture labelled it: 决赛, 半决赛, 胜者组决赛… */
  label: string
  opp: string
  /** maps, my side first */
  score: string
  won: boolean
  started: boolean
  /** the maps played, where the record kept them */
  maps: string[]
  /** the opening map lost and the series still taken */
  comeback: boolean
  /** my line, where I started; null from the bench */
  line: { k: number; d: number; a: number; acs: number; rating: number; rank: number; mvp: boolean } | null
  /** the engine's own highlights with my name on them, where the record still holds them */
  highlights: string[]
}

export interface Trophy {
  /** one per title, as the title's card is keyed (me/moments.ts) */
  key: string
  year: number
  /** the competition's stored name, and the same in words (me/compname.ts) */
  comp: string
  name: string
  cls: CompClass
  tier: TrophyTier
  /** I started a match of this event (me/bottleneck.ts startedIn, as the title was written down) */
  started: boolean
  /** the career's first trophy of all, and the first of its tier — the passage says so */
  first: boolean
  firstOfTier: boolean
  /** the club, where the save can still say which: its name, and its id where that is certain */
  club: string | null
  clubId: string | null
  /** the clubs that year was spent at, where the save cannot pin the trophy to one of them */
  clubs: string[]
  /** the event on the books: the stage of the circuit it sat in, the day it ended, the host city */
  stage: string | null
  end: number | null
  city: string | null
  /** 「真实历史里，这座奖杯属于 X」 (me/worldline.ts titleRealChamp); null where it was ours in both worlds */
  realChamp: string | null
  /** the side that finished second here, while the year's competitions are still on the books */
  runnerUp: string | null
  /** that season's row, and my club's campaign if it was an international (me/intl.ts) */
  season: MeSeason | null
  run: MeIntlRun | null
  /** the season ledger's own entry for this very event, kept the day the season ended (me/worldline.ts keptOf) */
  rewrite: MeRewrite | null
  /** my record of its matches, oldest first; empty once the detail window has let the year go */
  matches: TrophyMatch[]
  starts: number
  /** the last match of the event in my record — the one we lifted it in (me/bottleneck.ts finalMvp reads it the same way) */
  final: TrophyMatch | null
  /** this is the year the ladder first reached one of the big tiers (me/moments.ts BIG_TIERS) */
  ladderFirst: string | null
}

/* ------------------------------------------------------------------ */
/*  reading it off the save                                            */
/* ------------------------------------------------------------------ */

/**
 * The competition, while the year it was won in is still the year being played: cleared the moment the year turns.
 * Found the way the title's own card finds it (me/week.ts syncTitles) — the one whose champion's roster holds me,
 * else the one my club won — so a competition that merely shares its name is never taken for mine.
 */
function compOf(state: GameState, year: number, title: string): Competition | null {
  if (year !== state.year) return null
  const me = state.me!
  const won = Object.values(state.comps).filter((c) => c.name === title && !!c.champion)
  return won.find((c) => !!state.teams[c.champion!]?.roster.includes(me.id))
    ?? won.find((c) => c.champion === state.myTeam)
    ?? null
}

/** The real event, by the competition's own booking where there is one, else by name where that year has exactly one. */
function eventFor(year: number, title: string, comp: Competition | null): CEvent | null {
  const booked = comp?.circuit && eventOf(comp.circuit.id)
  if (booked) return booked
  const evs = eventsOf(year).filter((e) => e.cn === title)
  return evs.length === 1 ? evs[0] : null
}

/**
 * The club that lifted it, as far as the save can say.
 *
 * Certain, in this order: the competition is still on the books and its champion is known; the title's own card is
 * still in the queue and wrote the club down (me/moments.ts); the player's club history has one club for that year.
 *
 * Club history is kept for the whole career but only by year (engine/types.ts clubHist), so a year I played for two
 * clubs cannot say which of them this trophy belongs to — 2021 as a European substitute ran Alliance then Acend, and
 * a Stage 2 Challengers title sits between them. The season's row names the club the season *ended* at, which is a
 * different question and would be a guess dressed as a fact. So the card says no club there, `clubs` says which
 * clubs that year was spent at, and the detail says the season's own row for what it is.
 */
function clubOf(state: GameState, year: number, title: string, comp: Competition | null): { id: string | null; name: string | null; clubs: string[] } {
  const me = state.me!
  const hist = (state.players[me.id]?.clubHist ?? []).filter((h) => h.from <= year && year <= h.to)
  const clubs = hist.map((h) => state.teams[h.team]?.name).filter((n): n is string => !!n)
  const one = (id: string | null): { id: string | null; name: string | null; clubs: string[] } =>
    ({ id, name: id ? state.teams[id]?.name ?? null : null, clubs })
  if (comp?.champion && state.teams[comp.champion]) return one(comp.champion)
  const card = (me.moments ?? []).find((m) => m.kind === 'title' && m.year === year && m.comp === title && !!m.teamId)
  if (card?.teamId && state.teams[card.teamId]) return one(card.teamId)
  if (hist.length === 1 && state.teams[hist[0].team]) return one(hist[0].team)
  return one(null)
}

/** One of my records of the event, in the case's own terms. */
function matchOf(rec: MeMatchRecord): TrophyMatch {
  const maps = (rec.mapLog ?? []).map((m) => m.map).filter(Boolean)
  const first = rec.mapLog?.[0]
  return {
    label: rec.label,
    opp: rec.opp,
    score: rec.score,
    won: rec.won,
    started: rec.started,
    maps,
    comeback: !!rec.won && !!first && !first.won,
    line: rec.started
      ? { k: rec.kills, d: rec.deaths, a: rec.assists, acs: rec.acs, rating: rec.rating, rank: rec.rank, mvp: rec.mvp }
      : null,
    highlights: rec.highlights ?? [],
  }
}

/** The side that finished second, off the competition's own finishing order and its joint placings. */
function runnerUpOf(state: GameState, comp: Competition | null): string | null {
  if (!comp?.finished.length) return null
  const at = comp.places ? comp.places.indexOf(2) : 1
  const id = at >= 0 ? comp.finished[at] : null
  return (id && state.teams[id]?.name) || null
}

/** The big ladder tier this year was the first to reach, if any — the flag the moment queue set (me/moments.ts). */
function ladderFirstIn(me: MeState, year: number): string | null {
  // BIG_TIERS runs upwards, so the last match is the highest first reached that year
  const hit = BIG_TIERS.filter((t) => me.flags[`reached:${t}`] === year)
  return hit.length ? hit[hit.length - 1] : null
}

function trophyOf(state: GameState, t: { year: number; title: string; started: boolean }): Trophy {
  const me = state.me!
  const comp = compOf(state, t.year, t.title)
  const ev = eventFor(t.year, t.title, comp)
  const club = clubOf(state, t.year, t.title, comp)
  const recs = me.matches.filter((m) => !m.friendly && m.year === t.year && m.comp === t.title)
  const matches = recs.map(matchOf)
  const season = me.seasons.find((s) => s.year === t.year) ?? null
  const name = compCn(t.title)
  // The stage is only worth saying where it says something the event's own name does not. A 大师赛 is named for the
  // city that hosted it and its stage is named for it in turn (「伦敦大师赛」), 「2026 全球冠军赛」 sits in the
  // 冠军赛 stage, and 「中国联赛 · 第二赛段」 in 第二赛段 — each would print the same words twice.
  const st = ev?.stage ? stageNameIn(t.year, ev.stage, onTimeline(state)) : null
  const stage = st && !name.includes(st) && !st.includes(name) ? st : null
  return {
    key: `title:${t.year}:${t.title}`,
    year: t.year,
    comp: t.title,
    name,
    cls: compClass(t.title),
    tier: trophyTier(t.title),
    started: t.started,
    first: false,
    firstOfTier: false,
    club: club.name,
    clubId: club.id,
    clubs: club.clubs,
    stage,
    // the day of my own last match of it is the day it ended, and it is right whenever the record is still kept
    end: recs.length ? recs[recs.length - 1].day : comp?.circuit?.end ?? ev?.end ?? null,
    city: comp?.city ?? null,
    realChamp: titleRealChamp(state, {
      kind: 'title', key: '', year: t.year, day: 0, comp: t.title, ...(club.id ? { teamId: club.id } : {}),
    }),
    runnerUp: runnerUpOf(state, comp),
    season,
    run: (me.intlRuns ?? []).find((r) => r.year === t.year && r.comp === t.title) ?? null,
    rewrite: (season?.rewrites ?? []).find((r) => r.comp === t.title) ?? null,
    matches,
    starts: recs.filter((m) => m.started).length,
    final: matches.length ? matches[matches.length - 1] : null,
    ladderFirst: ladderFirstIn(me, t.year),
  }
}

/** The case's order (see the top of this file). */
export const trophyOrder = (a: Trophy, b: Trophy): number =>
  TROPHY_RANK[a.tier] - TROPHY_RANK[b.tier]
  || Number(b.started) - Number(a.started)
  || a.year - b.year
  // within a year, the one that ended first; a trophy whose day the save no longer holds goes after them
  || (a.end ?? Number.MAX_SAFE_INTEGER) - (b.end ?? Number.MAX_SAFE_INTEGER)
  || a.comp.localeCompare(b.comp)

/** This career's trophies, heaviest first. A qualifier won is 出线 and was never a trophy (me/compclass.ts). */
export function careerTrophies(state: GameState): Trophy[] {
  const me = state.me
  if (!me) return []
  const all = me.titles.map((t) => trophyOf(state, t))
  // the career's own firsts are read in the order they were won, not in the case's order
  const byTime = [...all].sort((a, b) => a.year - b.year)
  const seen = new Set<TrophyTier>()
  byTime.forEach((x, i) => {
    x.first = i === 0
    x.firstOfTier = !seen.has(x.tier)
    seen.add(x.tier)
  })
  return all.sort(trophyOrder)
}

/* ------------------------------------------------------------------ */
/*  the passage                                                        */
/* ------------------------------------------------------------------ */

/**
 * 那一晚, in words: a few sentences built out of the facts above and out of nothing else.
 *
 * Every sentence has to be true of this trophy on this save. No crowd that was not counted, no quote nobody said, no
 * 「全场起立」. What varies is which facts there are to say — a sweep reads differently from a decider, a title watched
 * from the bench differently from one started, a first trophy differently from a fifth, and a title this world took
 * from the side history gave it to says so. Where two trophies would otherwise read alike, the opening clause is
 * picked from a few true wordings by the trophy's own key, so the case never reads as one paragraph repeated.
 */
export function trophyProse(t: Trophy): string[] {
  const out: string[] = []
  const pick = (xs: string[][]): string[] => xs[hash(t.key) % xs.length]
  // a club I was on the roster of is 你的俱乐部 whether or not the save can still name it
  const club = t.club ?? '你的俱乐部'

  // 1. what this trophy is to this career
  if (t.first) {
    out.push(t.tier === 'champions'
      ? say('生涯第一座奖杯，就是', t.name, '。这一行绝大多数人一辈子都走不到这张桌子前面。')
      : say('这是你的第一座奖杯。', String(t.year), ' 年，', club, '拿下', t.name, '。'))
  } else if (t.tier === 'champions') {
    out.push(t.firstOfTier
      ? say(String(t.year), ' 年，', club, '站上了冠军赛的最后一级台阶。一年只有一支队能走到这里。')
      : say(...pick([
        ['又一座冠军赛的奖杯，', String(t.year), ' 年这一座是', club, '的。'],
        [String(t.year), ' 年，', club, '再一次把冠军赛的奖杯搬回了训练室。'],
      ])))
  } else if (t.tier === 'masters') {
    out.push(t.firstOfTier
      ? say(String(t.year), ' 年的', t.name, '，你第一次在赛区之外捧杯。')
      : say(...pick([
        [String(t.year), ' 年的', t.name, '，', club, '又一次从国际赛场上把奖杯带了回去。'],
        [String(t.year), ' 年，', club, '在', t.name, '上再拿一座。'],
      ])))
  } else {
    out.push(say(...pick([
      [String(t.year), ' 年，', club, '拿下', t.name, '。'],
      [t.name, '的奖杯，', String(t.year), ' 年归了', club, '。'],
    ])))
  }

  // 2. how the last match went
  // the maps are on the card's own 怎么结束的 row: the passage says how it went, not what the row already lists
  const f = t.final
  if (f) {
    const lost = Number(f.score.split('-')[1])
    out.push(f.comeback
      ? say(f.label, '开局先丢一张图，最后还是 ', f.score, ' 拿下', f.opp, '。')
      : lost === 0
        ? say(f.label, '对', f.opp, '，', f.score, '，一张图都没让。')
        : say(...pick([
          [f.label, ' ', f.score, ' 击败', f.opp, '。'],
          [f.label, '和', f.opp, '打到 ', f.score, '，赢的是这边。'],
        ])))
  }

  // 3. my part in it
  if (!t.started) {
    out.push(say(...pick([
      ['整届比赛你都在替补席上，一场没上。奖杯上有你的名字，场上没有。'],
      ['这一届你一场没上。名单上有你，场上没有，奖杯还是你的一份。'],
      ['从头到尾你都坐在替补席上。奖杯是真的，赢下它的是场上那五个人。'],
    ])))
  } else if (f?.started && f.line) {
    out.push(f.line.mvp ? '那一场的 MVP 是你。'
      : f.line.rank === 1 ? '那一场你是队里评分最高的一个。'
        : t.starts > 1 ? `那一场你在首发名单上，整届首发了 ${t.starts} 场。`
          : '那一场你在首发名单上，这一届你只首发了这一场。')
  } else if (f && !f.started) {
    out.push(t.starts ? `最后一场你没进名单，这一届你首发了 ${t.starts} 场。` : '最后一场你没进名单。')
  } else if (t.starts) {
    out.push(`这一届你首发了 ${t.starts} 场。`)
  }

  // 4. nothing but the trophy left: say that, rather than dressing the gap (me/detail.ts keeps the last year)
  if (!t.matches.length && !t.run) {
    out.push(pick([
      [`${t.year} 赛季的比赛明细已经不在生涯记录里了，留下来的就是这座奖杯本身。`],
      [`生涯明细只留最近一年，${t.year} 年的场次早翻过去了。剩下的就是这座奖杯。`],
    ])[0])
  }

  // 5. the world line closes it — the one fact the game already states about a trophy history gave to somebody else
  if (t.realChamp) {
    out.push(say('真实历史里，这座奖杯属于', t.realChamp, '。这条世界线把它交到了', club, '手里。'))
  }
  return out
}

/**
 * A sentence, put together piece by piece: a club or an event whose name is Latin gets air where it touches Chinese
 * — 「这座奖杯属于 Acend。」, never 「属于Acend。」 or 「属于 Acend 。」 — the same spacing the season's ledger gives
 * its names (me/rewrites.ts dot, me/worldline.ts glue).
 */
function say(...parts: string[]): string {
  // a Chinese character; the full stops and brackets that sit below the CJK block take no air before them
  const han = (c: string): boolean => c.charCodeAt(0) >= 0x4e00 && c.charCodeAt(0) <= 0x9fff
  const latin = (c: string): boolean => /[0-9A-Za-z]/.test(c)
  let out = ''
  for (const p of parts) {
    if (!p) continue
    const a = out.slice(-1)
    const b = p[0]
    if (out && ((latin(a) && han(b)) || (han(a) && latin(b)))) out += ' '
    out += p
  }
  return out
}

/** A small, stable number off a trophy's key: the same trophy always reads the same way. */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/* ------------------------------------------------------------------ */
/*  the one line a card says                                           */
/* ------------------------------------------------------------------ */

/** 「你首发出场」 / 「你在名单上，没有上场」 — the career's own two words for it (me/rewrites.ts partLine). */
export const trophyPart = (t: Trophy): string => (t.started ? '你首发出场' : '你在名单上，没有上场')

/** The event with its year in front, where the name does not carry one already (「2029 全球冠军赛」 does). */
export const trophyTitleLine = (t: Trophy): string =>
  (t.name.includes(String(t.year)) ? t.name : `${t.year} ${t.name}`)

/** The case with nothing in it. 一冠未得 is a career, not a missing value: one plain line, never 「暂无」. */
export const trophyNone = (me: MeState): string =>
  me.phase === 'retired' ? '没有冠军。' : '还没有冠军。第一座拿到的那一周，它会出现在这里。'
