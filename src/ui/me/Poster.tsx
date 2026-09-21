import type { ReactNode } from 'react'
import { useGame } from './ctx'
import { fansCn, fanTier } from '../../engine/me/fans'
import { traitOf } from '../../engine/me/traits'
import { bondCardLines } from '../../engine/me/bond'
import { compCn } from '../../engine/me/compname'
import { compClass } from '../../engine/me/compclass'
import { hallLine } from '../../engine/me/hall'
import { rankAt, rankShort } from '../../engine/me/rank'
import { TROPHY_RANK, trophyTier } from '../../engine/me/trophies'
import type { TrophyTier } from '../../engine/me/trophies'
import type { MeSeason, MeState } from '../../engine/me/types'
import type { GameState } from '../../engine/types'
import { TrophyChampions, TrophyLeague, TrophyMasters } from './art/fx'
import { attrWord, useNumbers } from './words'
import { CareerRewrites } from './Worldline'
import { useLook } from './looks'
import type { LookKey } from '../../engine/me/hall'

/**
 * The career on one card: the last thing a save ever shows.
 *
 * Rebuilt 2026-09-16 after 破晓's 生涯名片 (作者:「把重点冠军标清楚」). What it
 * borrows is the hierarchy, not the look: the verdict is the thesis and is set
 * four times the size of anything else; the trophies are tiles ranked in three
 * tiers rather than one undifferentiated chip row; a career with nothing on the
 * shelf gets a tile of its own that says how far it actually got, instead of a
 * grey 「没有奖杯」 that reads like a blank.
 *
 * The three tiers are the engine's own (me/compclass.ts), which matters: this
 * card used to rank the wall with `/Champions/` and `/Masters/` regexes, and the
 * timeline books a competition under its Chinese name (engine/circuit.ts:
 * `${year} 全球冠军赛`). Every trophy on every modern save therefore fell to the
 * bottom tier — a world title was drawn exactly like a Challengers stage.
 *
 * 首发 is not decoration either. Each title carries `started`, and a title won
 * from the bench is a whole ending (me/endings.ts `ring` 「板凳上的冠军」), so a
 * bench trophy keeps its tile and its border but loses the metal, and a shelf
 * with no started title says so in words underneath.
 */
export default function Poster() {
  const { game } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const starts = me.seasons.reduce((s, x) => s + x.starts, 0)
  const matches = me.seasons.reduce((s, x) => s + x.matches, 0)
  const pro = me.seasons.filter((s) => s.tier > 0)
  const clubs = Array.from(new Set((p.clubHist ?? []).map((h) => game.teams[h.team]?.tag ?? h.team)))
  const first = me.seasons[0]?.year ?? game.year
  const last = me.seasons[me.seasons.length - 1]?.year ?? game.year

  const trophies = me.titles
    .map((t) => ({ ...t, tier: tierOf(t.title) }))
    .sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.year - b.year)
  const startedN = trophies.filter((t) => t.started).length
  const benchN = trophies.length - startedN
  // every trophy on the shelf was watched from the bench — the 「板凳上的冠军」 ending
  const benchOnly = trophies.length > 0 && startedN === 0
  const runs = deepRuns(me)
  // 卡面 (me/hall.ts LOOKS): how the card is dressed, never what it says
  const { look } = useLook()
  const kick = kickOf(look, me)

  // 奖杯室: the heaviest trophy started for stands on the plinth, lit from above; an empty plinth where there is none
  const cup = trophies.find((t) => t.started) ?? trophies[0]

  return (
    <div className={`poster-me look-${look}`}>
      {look !== 'studio' && <div className="pm-deco" aria-hidden="true" />}
      {/* the head — brand, verdict, who — one block, so a look can set it apart (对开版 puts it on the dark half) */}
      <div className="pm-head">
        <div className="pm-top">
          <span className="pm-mark">无畏契约 · 选手生涯</span>
          <span className="pm-span">{first}–{last}</span>
        </div>

        {/* the verdict (me/endings.ts): the card's thesis, not its footnote */}
        <div className="pm-hero">
          {look === 'vault' && (
            <i className={`pm-cup${cup ? '' : ' none'}`} aria-hidden="true">{cup ? ICON[cup.tier] : <Plinth />}</i>
          )}
          {kick && <span className="pm-kick">{kick}</span>}
          <h1 className="pm-verdict">{me.ending?.title ?? '生涯'}</h1>
          {me.ending?.text && <p className="pm-story">{me.ending.text}</p>}
          {me.ending?.marks?.map((mark) => <p key={mark.id} className="pm-story" style={{ overflowWrap: 'anywhere' }}><b>生涯印记 · {mark.title}</b><br />{mark.text}</p>)}
        </div>

        <p className="pm-id">
          <b>{p.ign}</b> · {p.role}
          {clubs.length ? ` · ${clubs[clubs.length - 1]}` : ''} · {p.age} 岁
        </p>
      </div>
      {/* 对开版: the red band down the cut between the dark half and the light */}
      {look === 'split' && <div className="pm-cut" aria-hidden="true" />}
      {/* 另一条世界线: real history as a grey line, this career's as a red one off it */}
      {look === 'redline' && <WorldLines me={me} />}

      <div className="pm-wall">
        {trophies.length ? trophies.map((t, i) => {
          const cn = compCn(t.title)
          // 「2029 全球冠军赛」 carries its year already; the tile shows it once, underneath
          const name = short(cn.replace(new RegExp(`^${t.year}\\s*`), ''))
          return (
            <span key={i} className={`pm-t ${t.tier}${t.started ? '' : ' ring'}`}>
              <i className="pm-t-ic">{ICON[t.tier]}</i>
              <b className="pm-t-n">{name}</b>
              <em className="pm-t-y">{t.year}{t.started ? '' : ' · 随队'}</em>
            </span>
          )
        }) : (
          <span className="pm-t none">
            <i className="pm-t-ic" aria-hidden="true">—</i>
            <b className="pm-t-n">没有冠军</b>
            <em className="pm-t-y">{howFar(game, me, runs, pro)}</em>
          </span>
        )}
      </div>

      {benchOnly && (
        <p className="pm-note">这些奖杯你都在替补席上。名单上有你的名字，场上没有。</p>
      )}

      {/* 大师赛 / 冠军赛 the club played and did not win — a deep run is the record too */}
      {runs.length > 0 && (
        <div className="pm-runs">
          <span className="pm-runs-k">打进过的大师赛 / 冠军赛</span>
          {runs.slice(0, 4).map((l, i) => <span key={i} className="pm-run">{l}</span>)}
          {runs.length > 4 && <span className="pm-run faint">另有 {runs.length - 4} 次</span>}
        </div>
      )}

      {/* 你的世界线 (engine/me/rewrites.ts): the trophies it took from their real owners, and the heaviest rewrite I started in */}
      <CareerRewrites seasons={me.seasons} />


      <div className="pm-years">
        {me.seasons.map((s) => {
          const won = me.titles.some((t) => t.year === s.year && t.started)
          return (
            <div key={s.year} className={`pm-yr${won ? ' won' : ''}`}>
              <b>{s.year}</b>
              <span className="pm-yr-t">{s.team}</span>
              <span className="pm-yr-r">{seasonLine(game, me, s, nums)}</span>
            </div>
          )
        })}
      </div>

      {/* five, and two of them are words: the card says it rather than parading it */}
      <div className="pm-nums">
        <div>
          <small>冠军</small>
          <b>{startedN}{benchN ? <em className="pm-sub"> +{benchN} 随队</em> : null}</b>
        </div>
        <div><small>首发 / 出场</small><b>{starts}/{matches}</b></div>
        <div><small>职业赛季</small><b>{pro.length}</b></div>
        <div><small>最终综合</small><b className={nums ? '' : 'w'}>{nums ? p.overall : attrWord(p.overall)}</b></div>
        <div><small>粉丝</small><b className="w">{fansCn(me.fans)} · {fanTier(me.fans).name}</b></div>
      </div>

      {/* the people, by name — the ledger exists so this line is not "your teammates" */}
      {(() => {
        const lines = bondCardLines(game)
        return lines.length ? <div className="mates">{lines.map((l, i) => <p key={i}>{l}</p>)}</div> : null
      })()}
      <div className="sig">
        {me.traits.map((k) => traitOf(k)?.name).filter(Boolean).join(' · ') || '没有形成特质'}
        {clubs.length ? ` · ${clubs.join(' ')}` : ''} · 成就 {me.achievements.length}
      </div>
      {/* the 成就殿堂's line: what this career completed there, or the hall's 称号 (me/hall.ts) */}
      {(() => { const l = hallLine(game); return l ? <div className="hall-sig">{l}</div> : null })()}
    </div>
  )
}

/**
 * The line a look sets over the verdict: a broadcast's slate, an archive's reel count, a front page's flag, the
 * board's name, the showcase's count, the fold, the line's name.
 */
function kickOf(look: LookKey, me: MeState): string {
  if (look === 'night') return '生涯重播'
  if (look === 'film') return `生涯档案 · 共 ${me.seasons.length} 卷`
  if (look === 'paper') return '头条'
  if (look === 'led') return '现场大屏'
  if (look === 'vault') return me.titles.length ? `奖杯室 · ${me.titles.length} 座` : '奖杯室 · 展位空着'
  if (look === 'split') return '对开'
  if (look === 'redline') return '另一条世界线'
  return ''
}

/** 奖杯室 with nothing on the shelf: the three steps a cup would stand on (art/fx.tsx TrophyChampions' base). */
function Plinth() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M24 44h16v4H24zM20 48h24v4H20zM16 52h32v6H16z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/**
 * 另一条世界线: every season on one axis. The grey line is real history; the red one leaves it the year the
 * career began and runs above it — a dot for each season, a bigger one where the ledger kept trophies whose owner
 * this world changed (MeSeason.retitled, me/worldline.ts), a white cup where I started for a title. Only what the
 * save holds: a season from before the ledger is a plain dot.
 */
function WorldLines({ me }: { me: MeState }) {
  const n = Math.max(1, me.seasons.length)
  const x = (i: number) => ((i + 0.5) / n) * 100
  const x0 = x(0)
  const RED = 34
  const GREY = 68
  return (
    <div className="pm-wl">
      <div className="pm-wl-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="real" d={`M0 ${GREY}H100`} />
          <path className="mine" d={`M0 ${GREY}H${Math.max(0, x0 - 5)}C${x0 - 1} ${GREY} ${x0 - 1} ${RED} ${x0 + 3} ${RED}H100`} />
        </svg>
        {me.seasons.map((s, i) => {
          const won = me.titles.filter((t) => t.year === s.year && t.started)
          return (
            <span key={s.year} className="pm-wl-at" style={{ left: `${x(i)}%` }}>
              {won.length > 0 && (
                <i className="pm-wl-cup" title={won.map((t) => compCn(t.title)).join('、')}>
                  {ICON[tierOf(won[0].title)]}{won.length > 1 ? <em>×{won.length}</em> : null}
                </i>
              )}
              <i className={`pm-wl-n${s.retitled ? ' rw' : ''}`} title={s.retitled ? `这一季改写了 ${s.retitled} 座奖杯的归属` : undefined} />
              {/* the century is dropped on a phone (looks.css), so a dozen seasons' years fit at the scale's small step */}
              <em className="pm-wl-y" title={String(s.year)}><span className="c">{String(s.year).slice(0, 2)}</span>{String(s.year).slice(2)}</em>
            </span>
          )
        })}
      </div>
      <p className="pm-wl-key"><i className="real" />真实历史<i className="mine" />你的世界线<span>大点：这一季有奖杯换了主人</span></p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  the three tiers                                                     */
/* ------------------------------------------------------------------ */

/**
 * 冠军赛 > 大师赛 > 赛区冠军, read off what the event is rather than off an
 * English word in its name — the same call me/endings.ts judges the ending by.
 * LOCK//IN is an international, so it sits with the 大师赛. The call itself now
 * lives beside the trophy case that shares this wall's order
 * (engine/me/trophies.ts), so there is one ranking of a trophy and not three.
 */
const RANK = TROPHY_RANK
const tierOf = trophyTier

const ICON: Record<TrophyTier, ReactNode> = {
  champions: <TrophyChampions />,
  masters: <TrophyMasters />,
  league: <TrophyLeague />,
}

/** A tile has room for the event, not its whole path: 「挑战者联赛 · 北欧与东欧 · 第一赛段」 says which trophy it is in its last two parts. */
function short(cn: string): string {
  const parts = cn.split(' · ')
  return parts.length > 2 ? parts.slice(-2).join(' · ') : cn
}

/** One 大师赛 / 冠军赛 campaign, as me/intl.ts writes it down. */
interface IntlRunLike {
  year: number
  comp: string
  /** the sentence the season card and this block show */
  line: string
  /** compClass()'s own call — the same rule the wall above ranks by, so the two cannot drift */
  cls?: string
  /** final placing, 夺冠 recorded as 1. Genuinely absent for a side outside the placing order — the group exit. */
  place?: number
}

const CLS_RANK: Record<string, number> = { champions: 0, masters: 1, lockin: 2 }
/** a side that never placed sits below every side that did, rather than above them or hidden */
const placeKey = (r: IntlRunLike): number => r.place ?? Number.MAX_SAFE_INTEGER

/**
 * The 大师赛 / 冠军赛 campaigns that ended without the trophy, hardest first.
 *
 * From the season-end work on `seasonend-a1506a2` (engine/me/intl.ts), which
 * writes down every international the club played — 11 of 13 used to leave no
 * trace anywhere. `me.intlRuns` is the structured record and the thing to sort
 * on; `MeSeason.intl` is display prose and is never parsed.
 *
 * Read structurally so the card compiles and renders on both sides of that
 * merge, and so a save from before the structured fields still renders from
 * `line` — its class is derived with the same compClass() the wall uses, and
 * with no placing to go on it falls back to year order.
 *
 * Ranked 冠军赛 > 大师赛 > LOCK//IN, then by placing, so a 3–4 at the 冠军赛
 * stands above a group exit at a 大师赛. The ones that ended 夺冠 are already
 * tiles on the wall.
 */
function deepRuns(me: MeState): string[] {
  const runs = (me as MeState & { intlRuns?: IntlRunLike[] }).intlRuns ?? []
  return runs
    .filter((r) => (r.place !== undefined ? r.place !== 1 : !r.line.includes('夺冠')))
    .slice()
    .sort((a, b) =>
      ((CLS_RANK[a.cls ?? compClass(a.comp)] ?? 3) - (CLS_RANK[b.cls ?? compClass(b.comp)] ?? 3))
      || (placeKey(a) - placeKey(b))
      || (a.year - b.year))
    .map((r) => r.line)
}

/** A career with an empty shelf still got somewhere. Say where, best fact first. */
function howFar(game: GameState, me: MeState, runs: string[], pro: MeSeason[]): string {
  if (me.flags.champFinalLost) return '打进过冠军赛决赛，输掉了那一场'
  if (runs.length) return `打进过 ${runs.length} 次大师赛 / 冠军赛`
  const best = pro.slice().sort((a, b) => b.starts - a.starts)[0]
  if (best) return `最好的一季是 ${best.year}，${best.team}`
  if (me.pre.ladderPeak) return `天梯最高打到 ${rankShort(rankAt(game, me.pre.ladderPeak))}`
  return '那扇门没有为你开'
}

/** One season's right-hand line. ACS and 综合 are figures, so they wait for the 「数值」 switch. */
function seasonLine(game: GameState, me: MeState, s: MeSeason, nums: boolean): string {
  if (!s.tier) return `天梯 ${rankShort(rankAt(game, me.pre.ladderPeak))}`
  const head = s.starts ? `首发 ${s.starts}/${s.matches}` : '没有出场'
  return nums ? `${head}${s.acs ? ` · ACS ${s.acs}` : ''} · ${s.overallTo}` : head
}
