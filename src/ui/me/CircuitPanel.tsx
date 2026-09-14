import { useGame } from './ctx'
import { Crest, Panel, fmtDay } from './common'
import { eventOf, realPlacesOf, realResultOf } from '../../engine/circuit'
import { eventTables, roundCn } from '../../engine/eventTable'
import type { EventTable, GroupTable, PlaceTable } from '../../engine/eventTable'
import { REGION_CN } from '../../engine/types'
import type { Competition, Region } from '../../engine/types'

/**
 * One real event on the standings page. The career's own copy of the
 * manager game's circuit panel.
 *
 * The world-line rule is only worth having if the player can see it working,
 * so the panel says which of the two things the event is: played (and why —
 * my club is in it, it is my region's, or a result upstream changed who got
 * in) or replayed as it really went. A played event quotes history beside
 * every result and under its final placings; a replayed one says plainly that
 * it is out of reach.
 *
 * Its body is the event's standings, the way vlr.gg and the broadcast show
 * one: a table for each group, Swiss stage or regular season, placings for a
 * knockout bracket (engine/eventTable.ts). It used to be every fixture, one row
 * each — 「为什么积分榜里放的是所有队伍的比赛记录而不是积分」 — and the matches
 * are still there, folded into 比赛记录.
 */

/**
 * Which region tabs an event shows under: its region, the regions its layer draws on, or every tab.
 * From 2023 the tabs are the leagues, and a league's own events draw on its club regions: the EMEA
 * tab showed none of EMEA's Stage 1 and Stage 2, though 「其他赛区」 sends a player there.
 */
export function circuitShows(comp: Competition, region: string): boolean {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  if (!ev) return false
  if (ev.layer) return ev.layer.includes(region) || ev.region === region
  return !ev.region || ev.region === region
}

const WHY: Record<string, string> = { mine: '你们在打', home: '本赛区 · 模拟', ripple: '名额被改写 · 模拟', ahead: '还没有发生 · 模拟' }

const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`
const placeText = (p?: [number, number]): string => (!p ? '—' : p[0] === p[1] ? String(p[0]) : `${p[0]}–${p[1]}`)

function Club({ id }: { id: string }) {
  const { game } = useGame()
  return (
    <span className="club" title={game.teams[id]?.name}>
      <Crest id={id} /><span>{game.teams[id]?.name ?? id}</span>
    </span>
  )
}

export default function CircuitPanel({ comp }: { comp: Competition }) {
  const { game, openMatch } = useGame()
  const c = comp.circuit!
  const ev = eventOf(c.id)
  const fixtures = game.fixtures.filter((f) => f.comp === comp.key).sort((a, b) => a.day - b.day)
  const scope = ev?.layer
    ? ev.layer.map((r) => REGION_CN[r as Region] ?? r).join('、')
    : ev?.region ? REGION_CN[ev.region as Region] ?? ev.region : '国际赛事'
  // 2027 on: the format is Riot's, its unannounced parts 暂定 (engine/ahead.ts)
  const badge = !c.mode ? `${fmtDay(c.start, game.year)} 开打`
    : c.done && !comp.champion && ev?.plan ? '报名队伍不足 · 没有举行'
    : c.mode === 'history' ? '照真实历史'
    : ev?.plan && c.why !== 'mine' ? '还没有发生 · 模拟 · 赛制暂定'
    : WHY[c.why ?? 'home']
  const champName = comp.champion ? game.teams[comp.champion]?.name : undefined
  const realChamp = realPlacesOf(comp).find((r) => r.place === 1)?.name
  const tables = eventTables(game, comp)

  return (
    <Panel
      title={`${comp.name}${champName ? ` · 冠军 ${champName}` : ''}`}
      actions={<span className={`tag${c.why === 'mine' ? ' t1' : ''}`}>{badge}</span>}
      flush
    >
      <div className="small" style={{ padding: '9px 13px' }}>
        <div className="tiny muted">{fmtDay(c.start, game.year)} – {fmtDay(c.end, game.year)} · {scope}{ev ? ` · ${ev.name}` : ''}</div>
        {!c.mode && (
          <p className="muted" style={{ margin: '6px 0 0' }}>名单开打前一天才定：上游赛事的名次、谁报了海选，都会改变它。</p>
        )}
        {c.mode === 'history' && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            你够不着这里，这场照真实历史进行{comp.champion || c.done ? '。' : `，${fmtDay(c.end, game.year)} 出结果。`}
          </p>
        )}
        {c.done && (
          <p className="muted" style={{ margin: '6px 0 0' }}>参赛的都是这一年才成立的俱乐部，这个世界里还没有它们，所以没有名次可记。</p>
        )}
        {!!c.swaps?.length && (
          <p style={{ margin: '6px 0 0' }}>
            和真实历史不一样的名额：
            {c.swaps.map((s, i) => (
              <span key={i}>
                {i ? '；' : ''}<b>{game.teams[s.now ?? '']?.name ?? '空缺'}</b> 拿走了原本属于 {ev?.names[s.real] ?? s.real} 的位置
                （{s.from.startsWith('pool:') ? `${s.from.slice(5)} 赛区积分排名变了` : `${game.comps[s.from]?.name ?? '上一站'} 的名次变了`}）
              </span>
            ))}
          </p>
        )}
      </div>
      {tables.length > 0 && <EventBody comp={comp} tables={tables} />}
      {comp.champion && !tables.some((t) => t.kind === 'bracket') && <FinalPlaces comp={comp} />}
      {comp.champion && c.mode === 'sim' && realChamp && realChamp !== champName && (
        <p className="tiny faint" style={{ margin: 0, padding: '0 13px 9px' }}>真实历史里的冠军是 {realChamp}。在你的世界线里，是 {champName}。</p>
      )}
      {fixtures.length > 0 && (
        <details style={{ borderTop: '1px solid var(--line)' }}>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '9px 13px' }}>比赛记录（{fixtures.length} 场）</summary>
          <div className="table-wrap">
            <table>
              <tbody>
                {fixtures.map((f) => {
                  const r = f.result
                  const aWon = r && r.mapsWonA > r.mapsWonB
                  const line = f.played ? realResultOf(game, comp, f)?.line : undefined
                  const mine = f.teamA === game.myTeam || f.teamB === game.myTeam
                  return (
                    <tr key={f.id} className={`${mine ? 'me' : ''} ${f.played ? 'clickable' : ''}`} onClick={() => f.played && openMatch(f)}>
                      <td className="num muted mono">{fmtDay(f.day, game.year)}</td>
                      <td className="small muted">
                        {roundCn(f.label.replace(/^KO:-?\d+:/, ''))}
                        {line && <div className="tiny faint">{line}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }} className={r && aWon ? 'pos' : ''} title={game.teams[f.teamA]?.name}>
                        <span className="club" style={{ justifyContent: 'flex-end' }}><span>{game.teams[f.teamA]?.tag}</span><Crest id={f.teamA} /></span>
                      </td>
                      <td className="center mono">{r ? <b>{r.mapsWonA} : {r.mapsWonB}</b> : <span className="muted">BO{f.bo}</span>}</td>
                      <td className={r && !aWon && r.mapsWonA !== r.mapsWonB ? 'pos' : ''} title={game.teams[f.teamB]?.name}>
                        <span className="club"><Crest id={f.teamB} /><span>{game.teams[f.teamB]?.tag}</span></span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Panel>
  )
}

/** The event's tables, the latest phase first; a phase's groups side by side where there is room. */
function EventBody({ comp, tables }: { comp: Competition; tables: EventTable[] }) {
  const phases: { phase: string; list: EventTable[] }[] = []
  for (const t of tables) {
    const last = phases[phases.length - 1]
    if (last && last.phase === t.phase) last.list.push(t)
    else phases.push({ phase: t.phase, list: [t] })
  }
  return (
    <>
      {phases.map((p) => (
        <div key={`${p.phase}:${p.list[0].unit}`} style={{ borderTop: '1px solid var(--line)' }}>
          {p.list.length > 1 && <div className="small" style={{ padding: '9px 13px 0', fontWeight: 650 }}>{p.phase}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: p.list.length > 1 ? 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' : 'minmax(0, 1fr)' }}>
            {p.list.map((t) => {
              const title = p.list.length > 1 ? t.group || t.phase : [t.phase, t.group].filter(Boolean).join(' · ')
              return t.kind === 'table'
                ? <GroupTableView key={t.unit} t={t} title={title} />
                : <PlaceTableView key={t.unit} t={t} comp={comp} title={title} />
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/** A group, a Swiss stage, a regular season: record, maps, map difference, round difference — and where each place went. */
function GroupTableView({ t, title }: { t: GroupTable; title: string }) {
  const { game } = useGame()
  const draws = t.rows.some((r) => r.d > 0)
  const fate = t.rows.some((r) => r.next !== undefined)
  const note = t.done ? ''
    : t.cut != null && t.to ? `前 ${t.cut} 名进${t.to}`
      : t.dests.length > 1 ? `按名次去${t.dests.join('或')}`
        : t.advance && t.to ? `${t.advance} 队进${t.to}` : ''
  // the line under the last side going on: solid once the table is complete, dashed while it is not
  const line = (i: number) => (t.cut === i + 1 ? { borderBottom: `2px ${t.done ? 'solid' : 'dashed'} var(--accent)` } : undefined)
  return (
    <div style={{ minWidth: 0 }}>
      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>
        {title}{note && <span className="faint"> · {note}</span>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th><th>战队</th><th className="num">战绩</th>
              {draws && <th className="num">平</th>}
              <th className="num">小局</th><th className="num">净胜局</th><th className="num">回合差</th>
              {fate && <th>去向</th>}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={r.team} className={r.team === game.myTeam ? 'me' : ''}>
                <td className="num muted" style={line(i)}>{i + 1}</td>
                <td style={line(i)}><Club id={r.team} /></td>
                <td className="num mono" style={line(i)}>{r.w}-{r.l}</td>
                {draws && <td className="num mono muted" style={line(i)}>{r.d}</td>}
                <td className="num muted" style={line(i)}>{r.mapW}-{r.mapL}</td>
                <td className={`num mono ${r.mapW - r.mapL >= 0 ? 'pos' : 'neg'}`} style={line(i)}>{signed(r.mapW - r.mapL)}</td>
                <td className="num muted mono" style={line(i)}>{signed(r.roundW - r.roundL)}</td>
                {fate && (
                  <td className="small" style={line(i)}>
                    {r.next ? <span className="tag t1">→ {r.next}</span> : r.next === null ? <span className="faint">淘汰</span> : ''}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** A knockout bracket as placings: who is still in and what they play next, who went out where. */
function PlaceTableView({ t, comp, title }: { t: PlaceTable; comp: Competition; title: string }) {
  const { game } = useGame()
  const outText = (round: string, place?: [number, number]): string =>
    /总决赛/.test(round) ? '亚军' : /季军赛/.test(round) && place?.[0] === 3 ? '季军' : `止步${roundCn(round)}`
  return (
    <div style={{ minWidth: 0 }}>
      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>{title}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th className="num">名次</th><th>战队</th><th>状态</th></tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.team} className={r.team === game.myTeam ? 'me' : ''}>
                <td className="num mono">{placeText(r.place)}{comp.champion === r.team && ' 🏆'}</td>
                <td><Club id={r.team} /></td>
                <td className="small">
                  {r.state === 'won' ? <b>{comp.champion === r.team ? '冠军' : `${roundCn(r.round)}胜出`}</b>
                    : r.state === 'in' ? <span className="pos">还在赛{r.round ? ` · 下一轮 ${roundCn(r.round)}` : ''}</span>
                      : <span className="muted">{outText(r.round, r.place)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** An event over with no bracket of its own to read placings off: history's, or a played event that ended in groups. */
function FinalPlaces({ comp }: { comp: Competition }) {
  const { game } = useGame()
  const rows = comp.finished.map((id, i) => ({ id, p: comp.places?.[i] ?? i + 1 }))
  const joint = (p: number) => (comp.places ? comp.places.filter((x) => x === p).length : 1)
  const body = (list: typeof rows) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th className="num">名次</th><th>战队</th></tr></thead>
        <tbody>
          {list.map(({ id, p }) => (
            <tr key={id} className={id === game.myTeam ? 'me' : ''}>
              <td className="num mono">{placeText([p, p + joint(p) - 1])}{comp.champion === id && ' 🏆'}</td>
              <td><Club id={id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>最终名次</div>
      {body(rows.slice(0, 8))}
      {rows.length > 8 && (
        <details style={{ margin: '0 13px 8px' }}>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '6px 0' }}>其余 {rows.length - 8} 队</summary>
          {body(rows.slice(8))}
        </details>
      )}
    </div>
  )
}
