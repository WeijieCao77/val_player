import { useEffect, useState } from 'react'
import { useGame } from './ctx'
import { OvrBadge, Panel, Crest } from './common'
import Bracket from './Bracket'
import { groupTable, sortStandings } from '../../engine/league'
import { DRAW_KIND_CN, drawsOf } from '../../engine/draw'
import { PLAYOFF_CUT } from '../../engine/season'
import { formatOf, onTimeline, regionIn, regionsOf, stagesOf } from '../../engine/era'
import CircuitPanel, { circuitShows } from './CircuitPanel'
import { eventAnchor, letEventGo, wantedEvent } from './eventFocus'
import { circuitBonus, circuitPaid, eventOf, pointsTables } from '../../engine/circuit'
import type { PointsBasis, PointsRow, PointsTable } from '../../engine/circuit'
import { eventTables } from '../../engine/eventTable'
import { qualification } from '../../engine/qualify'
import { BOARD_RULE, BOARD_RULE_DETAIL, boardLine } from '../../engine/leaderboard'
import type { BoardLine } from '../../engine/leaderboard'
import { statLine } from '../../engine/player'
import { REGION_CN, REGIONS } from '../../engine/types'
import type { Competition, Player, Region } from '../../engine/types'
import TeamPeekButton from './TeamPeek'
import { attrWord, useNumbers } from './words'

/**
 * The leagues, the brackets and the season's player table. The career's own
 * copy of the manager game's standings page: no draw button, none of the
 * manager's notes on format and points, and the player table in the columns a
 * player reads.
 *
 * Laid out the way 破晓 lays out its standings: the table of the region on
 * screen first — here the year's points table where the year had one, under
 * 晋级形势 — then the events, what is being played now on top, and at the foot
 * 「其他赛区」, each region's current first, a click away.
 */

function ClubCell({ id, label, title }: { id: string; label?: string; title?: string }) {
  return (
    <>
      <span className="standings-clubclip" title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 'clamp(80px, 25vw, 180px)', maxWidth: '100%' }}>
        {id && <span style={{ flex: 'none' }}><Crest id={id} /></span>}
        <span style={{ minWidth: 0, flex: 1 }}>
          {id ? <TeamPeekButton id={id} label={label} /> : null}
        </span>
      </span>
    </>
  )
}

function Table({ comp, members, cut: cutOverride }: { comp: Competition; members?: string[]; cut?: number }) {
  const { game } = useGame()
  const concluded = !!comp.champion && comp.finished.length > 0
  // a drawn group is its own table: the competition's rows, its members only
  const order = members
    ? (concluded ? comp.finished.filter((id) => members.includes(id)) : groupTable(comp, members))
    : concluded ? comp.finished : sortStandings(comp)
  const hasPlayed = Object.values(comp.standings).some((r) => r.w + r.l > 0)

  // where each club went out, so a strong regular season that ended early reads
  // as what it was rather than looking like a sorting bug
  const exitAt: Record<string, string> = {}
  for (const f of game.fixtures) {
    if (f.comp !== comp.key || !f.label.startsWith('KO:') || !f.result) continue
    const round = f.label.split(':')[2] ?? ''
    const loser = f.result.mapsWonA > f.result.mapsWonB ? f.teamB : f.teamA
    exitAt[loser] = round
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">{concluded ? '名次' : '#'}</th><th>战队</th>
            <th className="num">常规赛</th>
            <th className="num">小局</th><th className="num">净胜局</th><th className="num">回合差</th>
            {concluded && <th>季后赛</th>}
          </tr>
        </thead>
        <tbody>
          {order.map((id, i) => {
            const r = comp.standings[id]
            if (!r) return null
            const cut = Math.min(cutOverride ?? PLAYOFF_CUT[comp.stage] ?? 8, order.length)
            return (
              <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                <td className="num muted">
                  {i + 1}
                  {comp.champion === id && ' 🏆'}
                  {!comp.champion && i + 1 === cut && ''}
                </td>
                <td style={{ borderLeft: !comp.champion && i < cut ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <ClubCell id={id} label={game.teams[id]?.tag} title={game.teams[id]?.name} />
                </td>
                <td className="num mono">{r.w}-{r.l}</td>
                <td className="num muted">{r.mapW}-{r.mapL}</td>
                <td className={`num mono ${r.mapW - r.mapL >= 0 ? 'pos' : 'neg'}`}>
                  {r.mapW - r.mapL > 0 ? '+' : ''}{r.mapW - r.mapL}
                </td>
                <td className="num muted mono">{r.roundW - r.roundL > 0 ? '+' : ''}{r.roundW - r.roundL}</td>
                {concluded && (
                  <td className="small muted">
                    {comp.champion === id ? '冠军' : exitAt[id] ? `止步${exitAt[id]}` : '未进季后赛'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!hasPlayed && <div className="empty">尚未开赛。</div>}
      {concluded && (
        <p className="tiny faint" style={{ padding: '9px 13px', margin: 0 }}>
          本赛段已结束，按最终名次排列。
        </p>
      )}
    </div>
  )
}

/** A points pool by the name a Chinese broadcast gives the circuit or league. */
const POOL_CN: Record<string, string> = {
  NA: '北美', EMEA: '欧非中东', BR: '巴西', LATAM: '拉美', KR: '韩国', JP: '日本', SEA: '东南亚', APAC: '亚太',
  Americas: '美洲', Pacific: '太平洋', China: '中国',
}

const BASIS_CN: Record<PointsBasis, string> = { drawn: '名单已出', settled: '积分已定', standing: '按目前积分', history: '照真实历史' }

const BASIS_NOTE: Record<PointsBasis, string> = {
  standing: '还有给积分的比赛没打完，标出来的名额会跟着积分动。',
  settled: '能改变名额的比赛都打完了，抽签就照这张表给名额。',
  drawn: '冠军赛名单已经出来，标出的就是真正拿到名额的队。',
  history: '你的世界还没碰到这个赛区的积分，名额照真实历史给，抽签那天标出来。',
}

/** An event's name without its region: 「EMEA · 第三赛段 挑战者决赛」 is 第三赛段 挑战者决赛 in the region's own table. */
const shortName = (name: string): string => name.split(' · ').pop() ?? name

/**
 * The year's points table for the region on screen — 2021 and 2022's circuit
 * points, the Championship Points from 2024 — as vlr.gg lists one, team and
 * points, with the places it gives marked the way the draw gives them
 * (engine/circuit.ts pointsTables): the Champions places, the Last Chance
 * Qualifier places, and a side already through by another road marked as
 * through. The club is lit wherever it stands, and the table is there whichever
 * tier the club plays in.
 *
 * No line is drawn across it (作者：「积分表上的线不画了，只列出积分，但是如果有其他队伍在
 * 其他渠道进入冠军赛了，那就标一下」). A line under the last Champions place promised that
 * the rows above it are the ones that go, and they are not: the draw passes over a club
 * already at Champions by another road and the place falls to the next one down
 * (engine/circuit.ts seedsFor, `direct`). The marks say who goes, row by row, and
 * 已晋级 says why a row above is not one of them.
 */
export function PointsPanel({ table }: { table: PointsTable }) {
  const { game } = useGame()
  const [all, setAll] = useState(false)
  const open = game.year <= 2022
  // where a side's points came from: what each event this year has paid out
  const from = new Map<string, { name: string; v: number }[]>()
  for (const c of Object.values(game.comps)) {
    if (c.format !== 'circuit' || !c.awarded) continue
    for (const [t, v] of circuitPaid(game, c)) from.set(t, [...(from.get(t) ?? []), { name: shortName(c.name), v }])
  }
  // what an event still being played has already earned a side — 2024 and 2025's point a match win — paid when it ends
  const running = new Map<string, number>()
  for (const c of Object.values(game.comps)) {
    if (c.format !== 'circuit' || c.awarded || c.champion || !c.circuit?.mode || c.circuit.done) continue
    for (const [t, v] of circuitBonus(game, c, game.day)) running.set(t, (running.get(t) ?? 0) + v)
  }
  const live = table.rows.some((r) => (running.get(r.team) ?? 0) > 0)
  const rows = table.rows
  const marks = rows.map((r) => r.mark)
  const lastDirect = marks.lastIndexOf('direct')
  const lastLcq = marks.lastIndexOf('lcq')
  // 破晓's one line under the table: what its marks mean — there is no line to explain
  const legend = [
    lastDirect >= 0 || lastLcq >= 0
      ? `${[lastDirect >= 0 ? `标「冠军赛」的队${open ? '直接' : '靠积分'}去冠军赛` : '', lastLcq >= 0 ? '标「最后机会资格赛」的队去最后机会资格赛' : ''].filter(Boolean).join('，')}；标「已晋级」的队不占积分名额，名额往下顺延`
      : '',
    live ? '「本赛事已得」是还在打的赛事里赢下比赛拿到的分，赛事结束才加进积分' : '',
  ].filter(Boolean).join('。')
  const cap = Math.max(8, Math.max(lastDirect, lastLcq, marks.lastIndexOf('through')) + 3)
  const mine = rows.findIndex((r) => r.team === game.myTeam)
  const rule = open
    ? `还没拿到冠军赛名额的队里，积分最高的 ${table.direct} 队直接去冠军赛${table.lcq ? `，再往下 ${table.lcq} 队去最后机会资格赛` : ''}。已经靠别的途径拿到名额的队不占积分名额，名额往下顺延。`
    : `第二赛段季后赛前 ${table.stage2} 名直接去冠军赛；另外 ${table.direct} 个名额给其余队里冠军积分最高的队。`
  const row = (r: PointsRow, i: number) => {
    const src = (from.get(r.team) ?? []).slice().sort((a, b) => b.v - a.v).slice(0, 2)
    return (
      <tr key={r.team} className={r.team === game.myTeam ? 'me' : ''} data-team={r.team} data-mark={r.mark ?? ''}>
        <td className="num muted">{i + 1}</td>
        <td>
          <ClubCell id={r.team} title={game.teams[r.team]?.name} />
        </td>
        <td className="num mono"><b>{r.points}</b></td>
        {live && <td className="num mono muted">{running.get(r.team) ? `+${running.get(r.team)}` : ''}</td>}
        <td className="small">
          {r.mark === 'direct' ? <span className="tag t1">冠军赛</span>
            : r.mark === 'lcq' ? <span className="tag">最后机会资格赛</span>
              : r.mark === 'through' ? <span className="tag win">已晋级</span> : ''}
          {r.mark === 'through' && r.via && <div className="tiny faint">{r.via}</div>}
        </td>
        <td className="tiny faint">{src.map((x) => `${x.name} ${x.v}`).join(' · ')}</td>
      </tr>
    )
  }
  return (
    <Panel
      tut="points"
      title={`${open ? '赛区积分榜' : '冠军积分榜'} · ${POOL_CN[table.pool] ?? table.pool}`}
      actions={<span className={`tag${table.basis === 'drawn' || table.basis === 'settled' ? ' t1' : ''}`}>{BASIS_CN[table.basis]}</span>}
      flush
    >
      <p className="tiny muted" style={{ margin: 0, padding: '9px 13px' }}>{rule}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th><th>战队</th><th className="num">积分</th>
              {live && <th className="num">本赛事已得</th>}
              <th>名额</th><th>积分主要来自</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, all ? rows.length : cap).map(row)}
            {!all && mine >= cap && <tr><td colSpan={live ? 6 : 5} className="tiny faint center">⋯</td></tr>}
            {!all && mine >= cap && row(rows[mine], mine)}
          </tbody>
        </table>
      </div>
      {legend && <p className="tiny faint table-legend">{legend}。</p>}
      <div className="row wrap" style={{ padding: '8px 13px', gap: 10 }}>
        <span className="tiny faint" style={{ flex: '1 1 220px' }}>
          {BASIS_NOTE[table.basis]}{table.lcqBasis === 'drawn' && table.basis !== 'drawn' ? '最后机会资格赛的名单已经出来。' : ''}
        </span>
        {rows.length > cap && (
          <button className="small" onClick={() => setAll(!all)}>{all ? '收起' : `展开全部 ${rows.length} 队`}</button>
        )}
      </div>
    </Panel>
  )
}

interface Other { key: string; label: string; go: Region; leader: string; value: string }

/** 破晓's 「其他赛区」: each region's current first, one row each; a row opens that region. */
function OtherRegions({ rows, onPick }: { rows: Other[]; onPick: (r: Region) => void }) {
  if (!rows.length) return null
  return (
    <Panel title="其他赛区" flush>
      <div className="table-wrap">
        <table>
          <thead><tr><th>赛区</th><th>当前第一</th><th>战绩 / 积分</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="clickable" onClick={() => onPick(r.go)}>
                <td>{r.label}</td>
                <td><b title={r.leader} style={{ display: 'block', maxWidth: 'clamp(80px, 20vw, 160px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.leader}</b></td>
                <td className="small muted">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny faint" style={{ margin: 0, padding: '8px 13px' }}>点一行，切到那个赛区。</p>
    </Panel>
  )
}

/**
 * The tab a place's clubs play under: its own where the year has one (2021's circuits), else the league
 * it is folded into that year. From 2023 the tabs are the four leagues and every place is under one. In 2022
 * the Southeast Asian circuits are under 东南亚; Turkey and CIS, which the book folds into EMEA only from 2023,
 * have none.
 */
export function tabOf(place: Region, tabs: Region[], year: number): Region | undefined {
  if (tabs.includes(place)) return place
  const league = regionIn(place, year)
  return tabs.includes(league) ? league : undefined
}

export default function Standings() {
  const { game, openPlayer } = useGame()
  const [tab, setTab] = useState<'leagues' | 'players'>('leagues')
  const [q, setQ] = useState('')
  const [nums] = useNumbers()
  // 2021 ran a dozen circuits; a tab for every one that has a club in it. 2022 folded the Southeast Asian
  // circuits into VCT APAC's Challengers, 东南亚 — and no club's own place is 'SEA', so that tab never showed and
  // a club from Malaysia & Singapore, Indonesia, Thailand, the Philippines, Vietnam or Hong Kong & Taiwan opened
  // the page on no tab at all
  const tabs: Region[] = formatOf(game.year) === 'open'
    ? regionsOf(game.year).filter((r) => Object.values(game.teams).some((t) => t.region === r || regionIn(t.region, game.year) === r))
    : REGIONS
  // The page opens on the tab my club plays under — its VCT league, or the league over its Challengers
  // circuit — and with no club, on the one over where I am from (「来自」). From 2023 a club's place
  // (Europe, Turkey) is no tab, and the page opened with no tab lit. A place with no tab that year opens
  // on itself, as it did.
  const home: Region | undefined = game.teams[game.myTeam]?.region ?? game.me?.region
  const start: Region = (home && tabOf(home, tabs, game.year)) ?? home ?? 'China'
  // an event the week page asked for (ui/me/eventFocus.ts): opened on a tab that shows it, then brought into view
  const [focus] = useState(wantedEvent)
  const [picked, setRegion] = useState<Region | null>(() => {
    const c = focus ? game.comps[focus] : undefined
    if (!c) return null
    const on = (r: string): boolean => (c.format === 'circuit' ? circuitShows(c, r) : !c.region || c.region === r)
    return on(start) || (!!home && on(home)) ? null : tabs.find(on) ?? null
  })
  useEffect(() => {
    if (!focus) return
    letEventGo()
    document.getElementById(eventAnchor(focus))?.scrollIntoView({ block: 'start' })
  }, [focus])
  const region: Region = picked && tabs.includes(picked) ? picked : start
  // the home tab still shows what my own place plays: a Challengers circuit is filed under its place, not its league
  const here: Region = region === start && home ? home : region

  // What is being played now sits on top; what is over sinks (「当时正在打的比赛应该提到最上面」).
  const rank = (c: Competition): number => {
    if (c.stage === game.stage) return 0
    const played = game.fixtures.some((f) => f.comp === c.key && f.played)
    if (played && !c.champion) return 1
    return c.champion ? 3 : 2
  }
  // calendar position; the two Challengers splits straddle Stage 1 and Stage 2
  const order = (c: Competition): number => {
    const i = stagesOf(game.year, onTimeline(game)).findIndex((s) => s.key === c.stage)
    if (i >= 0) return i
    return c.stage === 'challengers1' ? 3.5 : c.stage === 'challengers2' ? 5.5 : 9
  }
  const eventsFor = (...rs: string[]): Competition[] => Object.values(game.comps)
    .filter((c) => rs.some((r) => (c.format === 'circuit' ? circuitShows(c, r) : !c.region || c.region === r)))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? order(b) - order(a) : order(a) - order(b)))
  const shown = here === region ? eventsFor(region) : eventsFor(region, here)

  // the rating first, the season's titles and MVPs on top (engine/leaderboard.ts)
  const board = new Map<string, BoardLine>()
  const lineOf = (p: Player): BoardLine => {
    let l = board.get(p.id)
    if (!l) board.set(p.id, l = boardLine(game, p))
    return l
  }
  const leaders = Object.values(game.players)
    .filter((p) => p.season.maps >= 8 && p.teamId)
    .sort((a, b) => lineOf(b).score - lineOf(a).score || lineOf(b).rating - lineOf(a).rating)
    .slice(0, 40)
  const query = q.normalize('NFKC').trim().toLowerCase()
  const searching = query !== ''
  const allPlayers = Object.values(game.players)
  const matched = searching ? allPlayers.filter((p) => [p.ign, p.realName].some((name) => name?.normalize('NFKC').trim().toLowerCase().includes(query))) : leaders
  const shownPlayers = searching ? matched.slice(0, 20) : leaders
  const total = matched.length
  // where this stage leads, on my club's own tab only
  const qual = region === start ? qualification(game) : null

  // the year's points tables, and the one the region on screen counts toward
  const tables = tab === 'leagues' ? pointsTables(game) : []
  const tableFor = (r: Region): PointsTable | undefined => tables.find((t) =>
    t.regions.includes(r) || t.league === r || (!!t.league && regionIn(r, game.year) === t.league))
  const points = tableFor(region) ?? (here !== region ? tableFor(here) : undefined)

  /** A region's current first: the top of its live table, or its latest champion — its own events, not the internationals every tab shows. */
  const leaderOf = (r: Region): { leader: string; value: string } | null => {
    for (const c of eventsFor(r)) {
      if (c.format === 'circuit') {
        const ev = c.circuit && eventOf(c.circuit.id)
        if (!ev || (!ev.region && !ev.layer)) continue
        if (c.champion) return { leader: game.teams[c.champion]?.name ?? '—', value: `${shortName(c.name)} 冠军` }
        const t = eventTables(game, c)[0]
        if (t?.kind === 'table' && t.rows.some((x) => x.w + x.l + x.d > 0)) {
          return { leader: game.teams[t.rows[0].team]?.name ?? '—', value: `${t.rows[0].w}-${t.rows[0].l} · ${shortName(c.name)}` }
        }
        if (t?.kind === 'bracket' && t.rows[0]) return { leader: game.teams[t.rows[0].team]?.name ?? '—', value: `还在赛 · ${shortName(c.name)}` }
      } else if (c.region === r) {
        if (c.champion) return { leader: game.teams[c.champion]?.name ?? '—', value: `${c.name} 冠军` }
        const top = sortStandings(c)[0]
        const row = top ? c.standings[top] : undefined
        if (row && row.w + row.l > 0) return { leader: game.teams[top]?.name ?? '—', value: `${row.w}-${row.l} · ${c.name}` }
      }
    }
    return null
  }
  const others: Other[] = []
  if (tab === 'leagues') {
    const seen = new Set<string>()
    for (const r of tabs) {
      const t = tableFor(r)
      if (t) {
        if (t === points || seen.has(t.pool)) continue
        seen.add(t.pool)
        const top = t.rows[0]
        const any = !!top && top.points > 0
        others.push({ key: `pool:${t.pool}`, label: POOL_CN[t.pool] ?? t.pool, go: r, leader: any ? game.teams[top.team]?.name ?? '—' : '—', value: any ? `${top.points} 分` : '还没有积分' })
      } else if (r !== region && regionIn(region, game.year) !== r) {
        const l = leaderOf(r)
        others.push({ key: r, label: REGION_CN[r] ?? r, go: r, leader: l?.leader ?? '—', value: l?.value ?? '还没开打' })
      }
    }
  }

  return (
    <>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'leagues' ? 'on' : ''} onClick={() => setTab('leagues')}>联赛</button>
          <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>选手榜</button>
        </div>
        {tab === 'leagues' && (
          <div className="seg">
            {tabs.map((r) => (
              <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>
                {REGION_CN[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'leagues' ? (
        <>
          {qual && (
            <Panel tut="qualify" title={`晋级形势 · ${qual.event}`} className={qual.tone === 'good' ? 'good' : qual.tone === 'warn' ? 'alert' : ''}>
              <div className={`qual ${qual.tone}`}>
                <div className="lead">{qual.headline}</div>
                {qual.lines.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            </Panel>
          )}
          {points && <PointsPanel key={points.pool} table={points} />}
          {shown.length === 0 && <div className="empty">该赛区本阶段没有进行中的赛事。</div>}
          {shown.map((c) => c.format === 'circuit' ? <CircuitPanel key={c.key} comp={c} /> : c.region ? (
            <Panel
              key={c.key}
              id={eventAnchor(c.key)}
              title={`${c.name}${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}
              flush
            >
              {c.format === 'triple' ? (
                <p className="tiny faint" style={{ padding: '9px 13px', margin: 0 }}>
                  三败淘汰；三个组的冠军去 Masters。{!c.seeds?.length && '签表还没抽。'}
                </p>
              ) : c.grouped && c.groups ? (
                <div className="grid c2" style={{ gap: 0 }}>
                  {c.groups.map((g, i) => (
                    <div key={i}>
                      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>{c.groupNames?.[i] ?? ['Alpha', 'Omega'][i]} 组 · 前 4 进季后赛</div>
                      <Table comp={c} members={g} cut={4} />
                    </div>
                  ))}
                </div>
              ) : c.grouped ? (
                <div className="empty">分组要等 {c.stage === 'stage1' ? 'Kickoff' : 'Stage 1'} 打完抽签才定。</div>
              ) : (
                <Table comp={c} />
              )}
              {c.bracketStarted && (
                <div style={{ padding: '12px 13px', borderTop: '1px solid var(--line)' }}>
                  <div className="nav-group" style={{ padding: '0 0 8px' }}>
                    {c.format === 'triple' ? '签表 · 三败淘汰' : `季后赛对阵${c.format === 'double' ? ' · 双败淘汰' : ''}`}
                  </div>
                  <Bracket comp={c} />
                </div>
              )}
              <DrawHistory comp={c} />
            </Panel>
          ) : (
            <Panel key={c.key} id={eventAnchor(c.key)} title={`${c.name}（国际赛事${c.city ? ` · ${c.city}` : ''}）${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}>
              <Bracket comp={c} />
              <DrawHistory comp={c} />
              {!!c.champion && c.finished.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>最终排名</summary>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table>
                      <thead>
                        <tr><th className="num">#</th><th>战队</th><th>赛区</th></tr>
                      </thead>
                      <tbody>
                        {c.finished.map((id, i) => (
                          <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                            <td className="num muted">{i + 1}{c.champion === id && ' 🏆'}</td>
                            <td><ClubCell id={id} label={game.teams[id]?.tag} title={game.teams[id]?.name} /></td>
                            <td className="small muted">{REGION_CN[game.teams[id]?.region]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Panel>
          ))}
          <OtherRegions rows={others} onPick={setRegion} />
        </>
      ) : (
        <Panel title={searching ? `搜索结果${total ? `（${total} 人）` : ''}` : '赛季选手排行（至少 8 张图）'} flush>
          <div style={{ padding: '8px 13px' }}>
            <input type="search" aria-label="搜索选手" maxLength={80} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索选手 IGN 或姓名" style={{ width: '100%', boxSizing: 'border-box' }} />
            {searching
              ? <p className="tiny faint" style={{ margin: '6px 0 0' }}>匹配 {total} 人，显示前 {shownPlayers.length} 人</p>
              : <p className="tiny faint" style={{ margin: '6px 0 0' }} title={BOARD_RULE_DETAIL}>排名：{BOARD_RULE}。</p>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>选手</th><th>战队</th><th className="num">能力</th>
                  <th className="num" title={BOARD_RULE_DETAIL}>排名分</th><th className="num">评分</th>
                  <th className="num">ACS</th><th className="num">K/D</th>
                  <th className="num">首杀差</th><th title={BOARD_RULE_DETAIL}>荣誉</th><th className="num">场次</th>
                </tr>
              </thead>
              <tbody>
                {shownPlayers.map((p, i) => {
                  const s = statLine(p.season)
                  const hasMaps = p.season.maps > 0
                  const b = lineOf(p)
                  const honours = [b.titles ? `${b.titles} 冠` : '', b.mvps ? `MVP ${b.mvps}` : ''].filter(Boolean).join(' · ')
                  return (
                    <tr
                      key={p.id}
                      className={`clickable ${p.teamId === game.myTeam ? 'me' : ''}`}
                      onClick={() => openPlayer(p.id)}
                    >
                      <td className="num muted">{searching ? '-' : i + 1}</td>
                      <td><b title={p.ign} style={{ display: 'block', maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.ign}</b></td>
                      <td className="small muted">{p.teamId ? <ClubCell id={p.teamId} title={game.teams[p.teamId]?.name} /> : <span>自由选手</span>}</td>
                      <td className="num">{nums ? <OvrBadge value={p.overall} /> : attrWord(p.overall)}</td>
                      <td className="num"><b>{hasMaps ? b.score.toFixed(2) : '—'}</b></td>
                      <td className="num mono">{hasMaps ? b.rating.toFixed(2) : '—'}</td>
                      <td className="num mono">{hasMaps ? s.acs.toFixed(0) : '—'}</td>
                      <td className="num mono">{hasMaps ? s.kd.toFixed(2) : '—'}</td>
                      <td className={`num mono ${s.fkDiff >= 0 ? 'pos' : 'neg'}`}>
                        {hasMaps ? `${s.fkDiff > 0 ? '+' : ''}${s.fkDiff}` : '—'}
                      </td>
                      {/* no honours is not a missing number: the cell stays empty rather than a dash */}
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}
                        title={b.titleBonus + b.mvpBonus > 0 ? `荣誉加分 +${(b.titleBonus + b.mvpBonus).toFixed(3)}（冠军 +${b.titleBonus.toFixed(3)}，MVP +${b.mvpBonus.toFixed(3)}）` : undefined}>
                        {honours}
                      </td>
                      <td className="num muted">{p.season.maps}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {searching && total === 0 && <div className="empty">没有找到匹配的选手。</div>}
          </div>
        </Panel>
      )}
    </>
  )
}

/**
 * The draws a competition ran, kept where the bracket is: the pots, every
 * ball in order with any forced placement's reason, and who chose whom. The
 * career has no draw screen to open: this log is the draw.
 */
function DrawHistory({ comp }: { comp: Competition }) {
  const { game } = useGame()
  const draws = drawsOf(game, comp.key)
  if (!draws.length) return null
  return (
    <details style={{ margin: '10px 13px 12px' }}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>抽签记录（{draws.length}）</summary>
      {draws.map((d) => {
        const n = d.phase?.match(/swiss-r(\d)/)?.[1]
        return (
          <div key={d.id} style={{ margin: '8px 0 0', paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <b className="small">{DRAW_KIND_CN[d.kind]}{n ? ` 第 ${n} 轮` : ''}</b>
              <span className="tiny faint">{d.status === 'complete' ? '已完成' : d.status === 'awaiting-choice' ? '等待选择' : '未看完'}</span>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0' }}>{d.rule}</p>
            <ul className="tiny muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {d.log.map((l, i) => <li key={i}>{l}</li>)}
              {d.steps.filter((st) => st.note).map((st, i) => (
                <li key={`n${i}`}>{game.teams[st.team]?.tag} → {st.slot}：{st.note}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </details>
  )
}
