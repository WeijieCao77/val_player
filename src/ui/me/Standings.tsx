import { useState } from 'react'
import { useGame } from './ctx'
import { OvrBadge, Panel, Crest } from './common'
import Bracket from './Bracket'
import { groupTable, sortStandings } from '../../engine/league'
import { DRAW_KIND_CN, drawsOf } from '../../engine/draw'
import { PLAYOFF_CUT } from '../../engine/season'
import { formatOf, onTimeline, regionIn, regionsOf, stagesOf } from '../../engine/era'
import CircuitPanel, { circuitShows } from './CircuitPanel'
import { circuitPaid, eventOf, pointsTables } from '../../engine/circuit'
import type { PointsBasis, PointsRow, PointsTable } from '../../engine/circuit'
import { eventTables } from '../../engine/eventTable'
import { qualification } from '../../engine/qualify'
import { ratingOf } from '../../engine/match'
import { statLine } from '../../engine/player'
import { REGION_CN, REGIONS } from '../../engine/types'
import type { Competition, Region } from '../../engine/types'

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
                  <span className="club" title={game.teams[id]?.name}>
                    <Crest id={id} /><span>{game.teams[id]?.tag}</span>
                  </span>
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
  standing: '还有给积分的比赛没打完，这条线会跟着积分动。',
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
 * (engine/circuit.ts pointsTables): a line under the last Champions place, a
 * dashed line under the last Last Chance Qualifier place, and a side already
 * through by another road marked as through. The club is lit wherever it
 * stands, and the table is there whichever tier the club plays in.
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
  const rows = table.rows
  const marks = rows.map((r) => r.mark)
  const lastDirect = marks.lastIndexOf('direct')
  const lastLcq = marks.lastIndexOf('lcq')
  const cap = Math.max(8, Math.max(lastDirect, lastLcq, marks.lastIndexOf('through')) + 3)
  const mine = rows.findIndex((r) => r.team === game.myTeam)
  const rule = open
    ? `还没拿到冠军赛名额的队里，积分最高的 ${table.direct} 队直接去冠军赛${table.lcq ? `，再往下 ${table.lcq} 队去最后机会资格赛` : ''}。已经靠别的途径拿到名额的队不占积分名额，名额往下顺延。`
    : `第二赛段季后赛前 ${table.stage2} 名直接去冠军赛；另外 ${table.direct} 个名额给其余队里冠军积分最高的队。`
  const line = (i: number) => (i === lastDirect ? { borderBottom: '2px solid var(--accent)' }
    : i === lastLcq ? { borderBottom: '2px dashed var(--muted)' } : undefined)
  const row = (r: PointsRow, i: number) => {
    const src = (from.get(r.team) ?? []).slice().sort((a, b) => b.v - a.v).slice(0, 2)
    return (
      <tr key={r.team} className={r.team === game.myTeam ? 'me' : ''} data-team={r.team} data-mark={r.mark ?? ''}>
        <td className="num muted" style={line(i)}>{i + 1}</td>
        <td style={line(i)}>
          <span className="club" title={game.teams[r.team]?.name}><Crest id={r.team} /><span>{game.teams[r.team]?.name}</span></span>
        </td>
        <td className="num mono" style={line(i)}><b>{r.points}</b></td>
        <td className="small" style={line(i)}>
          {r.mark === 'direct' ? <span className="tag t1">冠军赛</span>
            : r.mark === 'lcq' ? <span className="tag">最后机会资格赛</span>
              : r.mark === 'through' ? <span className="tag win">已晋级</span> : ''}
          {r.mark === 'through' && r.via && <div className="tiny faint">{r.via}</div>}
        </td>
        <td className="tiny faint" style={line(i)}>{src.map((x) => `${x.name} ${x.v}`).join(' · ')}</td>
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
            <tr><th className="num">#</th><th>战队</th><th className="num">积分</th><th>名额</th><th>积分主要来自</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, all ? rows.length : cap).map(row)}
            {!all && mine >= cap && <tr><td colSpan={5} className="tiny faint center">⋯</td></tr>}
            {!all && mine >= cap && row(rows[mine], mine)}
          </tbody>
        </table>
      </div>
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
                <td><b>{r.leader}</b></td>
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

export default function Standings() {
  const { game, openPlayer } = useGame()
  const [tab, setTab] = useState<'leagues' | 'players'>('leagues')
  const myRegion = game.teams[game.myTeam]?.region
  const [region, setRegion] = useState(myRegion ?? 'China')

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
  const eventsFor = (r: string): Competition[] => Object.values(game.comps)
    .filter((c) => (c.format === 'circuit' ? circuitShows(c, r) : !c.region || c.region === r))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? order(b) - order(a) : order(a) - order(b)))
  const shown = eventsFor(region)

  const leaders = Object.values(game.players)
    .filter((p) => p.season.maps >= 8 && p.teamId)
    .sort((a, b) => ratingOf(b.season) - ratingOf(a.season))
    .slice(0, 40)
  // where this stage leads, for the club's own region only
  const qual = region === myRegion ? qualification(game) : null
  // 2021 ran a dozen circuits; a tab for every one that has a club in it
  const tabs: Region[] = formatOf(game.year) === 'open'
    ? regionsOf(game.year).filter((r) => Object.values(game.teams).some((t) => t.region === r))
    : REGIONS

  // the year's points tables, and the one the region on screen counts toward
  const tables = tab === 'leagues' ? pointsTables(game) : []
  const tableFor = (r: Region): PointsTable | undefined => tables.find((t) =>
    t.regions.includes(r) || t.league === r || (!!t.league && regionIn(r, game.year) === t.league))
  const points = tableFor(region)

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
            <Panel key={c.key} title={`${c.name}（国际赛事${c.city ? ` · ${c.city}` : ''}）${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}>
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
                            <td><span className="club" title={game.teams[id]?.name}>
                              <Crest id={id} /><span>{game.teams[id]?.tag}</span>
                            </span></td>
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
        <Panel title="赛季选手排行（至少 8 张图）" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>选手</th><th>战队</th><th className="num">能力</th>
                  <th className="num">评分</th><th className="num">ACS</th><th className="num">K/D</th>
                  <th className="num">首杀差</th><th className="num">场次</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((p, i) => {
                  const s = statLine(p.season)
                  return (
                    <tr
                      key={p.id}
                      className={`clickable ${p.teamId === game.myTeam ? 'me' : ''}`}
                      onClick={() => openPlayer(p.id)}
                    >
                      <td className="num muted">{i + 1}</td>
                      <td><b>{p.ign}</b></td>
                      <td className="small muted">{game.teams[p.teamId ?? '']?.name}</td>
                      <td className="num"><OvrBadge value={p.overall} /></td>
                      <td className="num"><b>{ratingOf(p.season).toFixed(2)}</b></td>
                      <td className="num mono">{s.acs.toFixed(0)}</td>
                      <td className="num mono">{s.kd.toFixed(2)}</td>
                      <td className={`num mono ${s.fkDiff >= 0 ? 'pos' : 'neg'}`}>
                        {s.fkDiff > 0 ? '+' : ''}{s.fkDiff}
                      </td>
                      <td className="num muted">{p.season.maps}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
