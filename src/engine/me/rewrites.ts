import { isQualifier } from './compclass'
import type { MeRewrite, MeSeason } from './types'

/**
 * 「我改写了历史」 across a career: what the seasons' rows kept of their ledgers (me/worldline.ts seasonLedger),
 * read back for the pages that look at the whole career — the ending's card, the hall's card, the share card —
 * and for the season's own card.
 *
 * Its own module with nothing heavier than the competition's class to import: the hall (me/hall.ts) reads it, and
 * the hall is read from the front door before any world exists. Only what the rows kept: a season written before
 * 2026-09-18 has nothing and says nothing — never 「暂无」.
 *
 * The words say two things and nothing else: 「真实历史里是 X，这个世界里是 Y」 and my part in it — 你首发, 你在名单上.
 * 「因为你」 is said of one thing only: a title that went to my club instead of the side history gave it to, with me
 * starting there (becauseOfMe). Whatever else the world did, it did; the pages say so as the world's.
 */

/** What an entry is about, heaviest first: an international's title, a qualification place, a regional title, and only my club's placing. */
export type RewriteKind = MeRewrite['kind']
export const REWRITE_WEIGHT: Record<RewriteKind, number> = { intl: 3, qual: 2, region: 1, place: 0 }

/** entries a season's row keeps, and entries the season's card shows */
export const KEEP = 5
export const SHOWN = 3

/** 「因为你」: the title went to my club instead of the side history gave it to, and I started there. Never otherwise. */
export const becauseOfMe = (r: MeRewrite): boolean => !!r.title && !!r.ours && r.there === 'started'

/** The season card's words for my part in an entry; null where I was not on the roster there. */
export function partLine(r: MeRewrite): string | null {
  if (!r.there) return null
  const part = r.there === 'started' ? '你首发出场' : '你在名单上，没有上场'
  // a qualifier's winner goes through, it lifts no trophy (me/compclass.ts isQualifier)
  return becauseOfMe(r) ? `${part} · 因为你，${isQualifier(r.comp) ? '这一站的冠军换了人' : '这座奖杯换了主人'}` : part
}

/** A kept entry and the season it is from. */
export interface KeptRewrite extends MeRewrite { year: number }

export interface CareerRewrites {
  /** trophies whose real owner is another side, over the seasons that kept their ledger */
  retitled: number
  /** the first season that kept its ledger, where the career has seasons from before (a save older than 2026-09-18) */
  from?: number
  /** the heaviest entry I started in (因为你 first, keptOrder); where there is none, the heaviest I was on the roster for */
  top: KeptRewrite | null
  /** the share card's: the heaviest I started in or whose title went to my club — never one I was not part of */
  share: KeptRewrite | null
}

/**
 * The career's order. A title my club took from the side history gave it to, with me starting (因为你), comes before
 * everything else: 「在你的世界线里，2021 韩国 · 第三赛段 挑战者赛的冠军是 TUBEPLE Gaming（真实历史：Vision Strikers）
 * · 你首发」 is the rewrite that is mine, where the same season's 柏林大师赛, won by KRÜ Esports while my club finished
 * fifth, is the world's with me in it (2021 Korea, seed 7). Then the kind, heaviest first; then a title of my club's,
 * starting over the bench, the earlier season.
 */
const partRank = (r: MeRewrite): number => (r.there === 'started' ? 2 : r.there === 'bench' ? 1 : 0)
export const keptOrder = (a: KeptRewrite, b: KeptRewrite): number =>
  Number(becauseOfMe(b)) - Number(becauseOfMe(a))
  || REWRITE_WEIGHT[b.kind] - REWRITE_WEIGHT[a.kind]
  || Number(!!b.ours) - Number(!!a.ours)
  || partRank(b) - partRank(a)
  || a.year - b.year

/** A season whose row kept its ledger — from 2026-09-18 every season's does, a season with nothing to say included. */
const keptIn = (s: MeSeason): boolean => s.retitled != null || !!s.rewrites?.length

/** The career's ledger, off the seasons' rows; null where no season kept one, or none had anything to say. */
export function careerRewrites(me: { seasons: MeSeason[] }): CareerRewrites | null {
  const kept = me.seasons.filter(keptIn)
  if (!kept.length) return null
  const retitled = kept.reduce((n, s) => n + (s.retitled ?? 0), 0)
  const all = kept.flatMap((s) => (s.rewrites ?? []).map((r) => ({ ...r, year: s.year }))).sort(keptOrder)
  const top = all.find((r) => r.there === 'started') ?? all.find((r) => r.there === 'bench') ?? null
  const share = all.find((r) => r.there === 'started' || (!!r.ours && !!r.there)) ?? null
  if (!retitled && !top && !share) return null
  const from = kept.length < me.seasons.length ? kept[0].year : undefined
  return { retitled, ...(from != null ? { from } : {}), top, share }
}

/**
 * 「你的世界线改写了 N 座奖杯的归属」 — from the first season that kept its ledger, where the career is older than that.
 * `under`: said under a 「你的世界线」 label already, so the sentence starts at 「改写了」.
 */
export function retitledLine(c: Pick<CareerRewrites, 'retitled' | 'from'>, under = false): string {
  if (!c.retitled) return ''
  return `${c.from != null ? `从 ${c.from} 赛季起，` : ''}${under ? '' : '你的世界线'}改写了 ${c.retitled} 座奖杯的归属`
}

/** 「……（真实历史：X）· 你首发」: no space between a closing bracket and the dot */
const dot = (s: string): string => (s.endsWith('）') ? `${s}· ` : `${s} · `)

/** The career's pages (the ending's card, the hall's card): the entry in one line, and my part in it. */
export const careerLine = (r: MeRewrite): string =>
  `${becauseOfMe(r) ? '因为你，' : ''}${dot(r.one)}${r.there === 'started' ? '你首发' : '你在名单上，没有上场'}`

/** The share card's strip: something I started in, or a title my club took. */
export const shareLine = (r: MeRewrite): string =>
  `在你的世界线里，${dot(r.one)}${r.there === 'started' ? '你首发' : '你在名单上'}`
