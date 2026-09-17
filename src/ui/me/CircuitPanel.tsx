import { useGame } from './ctx'
import { Crest, Panel, fmtDay } from './common'
import { eventOf, realPlacesOf, realResultOf } from '../../engine/circuit'
import { eventTables, onwardSets, roundCn } from '../../engine/eventTable'
import type { Band, EventTable, GroupTable, Line, OnwardSet, PlaceRow, PlaceTable } from '../../engine/eventTable'
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
 * it is out of reach, and still counts each real match the day it is played.
 *
 * Its body is the event's standings, the way vlr.gg and the broadcast show
 * one: a table for each group, Swiss stage or regular season, placings and
 * series for a knockout bracket (engine/eventTable.ts) — and, the way 破晓
 * shows its league table, a line where the places going on end and one line
 * under the table saying what the lines mean. It used to be every fixture, one
 * row each — 「为什么积分榜里放的是所有队伍的比赛记录而不是积分」 — and the matches
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
const cls = (...xs: (string | false | null | undefined)[]): string => xs.filter(Boolean).join(' ')

/** 前 3 名, 第 2 名, 第 3–8 名 */
const rangeText = (lo: number, hi: number): string => (lo === hi ? `第 ${lo} 名` : lo === 1 ? `前 ${hi} 名` : `第 ${lo}–${hi} 名`)
const bandText = (b: Band): string => `${rangeText(b.from, b.to)}进${b.dest}`
const onwardText = (s: OnwardSet): string => {
  const r = rangeText(s.places[0], s.places[s.places.length - 1])
  if (s.kind === 'points') return `${r}拿积分`
  return s.league ? `${REGION_CN[s.league as Region] ?? s.league}的队伍里${r}去${s.name}` : `${r}去${s.name}`
}
/** the class of the row a line is drawn under */
const lineAt = (lines: Line[]) => (i: number): string => {
  const l = lines.find((x) => x.after === i + 1)
  return l ? (l.solid ? 'cut-solid' : 'cut-dash') : ''
}

function Club({ id, name }: { id: string; name?: string }) {
  const { game } = useGame()
  const team = game.teams[id]
  const label = team?.name ?? name ?? id
  return (
    <span className="club" title={label}>
      {team && <Crest id={id} />}<span>{label}</span>
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
            你够不着这里，这场照真实历史进行{comp.champion || c.done ? '。' : `：真实赛程打完一场，榜上记一场，${fmtDay(c.end, game.year)} 结束。`}
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
                ? <GroupTableView key={`${t.unit}:${t.group}`} t={t} title={title} />
                : <PlaceTableView key={t.unit} t={t} comp={comp} title={title} />
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/** The one line under a group's table, 破晓's 「粗线以上进季后赛」. */
function groupLegend(t: GroupTable): string {
  const bits: string[] = []
  const single = t.bands.length === 1 && t.bands[0].from === 1 ? t.bands[0] : null
  if (t.lines.length) {
    const solid = t.lines.every((l) => l.solid)
    const word = solid ? '实线' : '虚线'
    bits.push(single ? `${word}以上晋级${single.dest}` : `${word}分开去向不同的名次`)
    if (!solid) bits.push('比赛还没打完，线会跟着名次动')
  } else if (t.bands.length && !t.ordered) {
    bits.push('这一组是淘汰赛制：打完才排出名次、画线，现在按战绩排')
  } else if (t.bands.length && t.done) {
    bits.push('名次和真正晋级的队有出入，以「去向」为准')
  }
  if (t.history) bits.push('照真实比分记，没有回合数')
  return bits.length ? `${bits.join('；')}。` : ''
}

/** A group, a Swiss stage, a regular season: record, maps, map difference, round difference — and where each place goes. */
function GroupTableView({ t, title }: { t: GroupTable; title: string }) {
  const { game } = useGame()
  const draws = t.rows.some((r) => r.d > 0)
  const fate = t.rows.some((r) => r.next !== undefined)
  const note = t.bands.map(bandText).join(' · ')
  const line = lineAt(t.lines)
  const legend = groupLegend(t)
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
              <tr key={r.team} className={cls(r.team === game.myTeam && 'me', line(i))} data-team={r.team}>
                <td className="num muted">{t.ordered ? i + 1 : '—'}</td>
                <td><Club id={r.team} name={r.name} /></td>
                <td className="num mono">{r.w}-{r.l}</td>
                {draws && <td className="num mono muted">{r.d}</td>}
                <td className="num muted">{r.mapW}-{r.mapL}</td>
                <td className={`num mono ${r.mapW - r.mapL >= 0 ? 'pos' : 'neg'}`}>{signed(r.mapW - r.mapL)}</td>
                <td className="num muted mono">{t.history ? '—' : signed(r.roundW - r.roundL)}</td>
                {fate && (
                  <td className="small">
                    {r.next ? <span className="tag t1">→ {r.next}</span> : r.next === null ? <span className="faint">淘汰</span> : ''}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {legend && <p className="tiny faint table-legend">{legend}</p>}
    </div>
  )
}

/**
 * What the marks that pass a place down mean, where a final order carries any: one sentence for both — a side
 * already in by another road, a side let go before the draw — rather than one line each.
 */
const cascadeNote = (other: boolean, gone: boolean): string | null => (other || gone
  ? `标${[other ? '「已从别的途径进入」' : '', gone ? '「已解散」' : ''].filter(Boolean).join('或')}的队不占这里的名额，名额往下顺延`
  : null)

/** The one line under a bracket. */
function placeLegend(t: PlaceTable, over: boolean): string {
  const bits: string[] = []
  if (t.lives > 1) bits.push(`输满 ${t.lives} 场淘汰`)
  if (!over) bits.push('名次按已经打完的比赛算')
  if (t.onward.length) {
    // no line above a run of places: a side already in by another road, or let go by the draw, takes none of
    // them (engine/eventTable.ts markOnward)
    bits.push(cascadeNote(t.rows.some((r) => r.marks.includes('other')), t.rows.some((r) => r.marks.includes('gone')))
      ?? '名额以每一行标的为准')
    if (t.onward.some((_, k) => t.rows.some((r) => r.marks[k] === 'open'))) bits.push('还没定的写「还在赛」「待定」「等抽签」')
    if (t.onward.some((s) => s.kind === 'points')) bits.push('积分在赛事结束时入账')
  }
  if (t.history) bits.push('照真实比分记，没有回合数')
  return `${bits.join('；')}。`
}

function outText(r: PlaceRow, over: boolean): string {
  if (!r.place) return `止步${roundCn(r.round)}`
  if (over && (/总决赛/.test(r.round) || (r.place[0] === 2 && r.place[1] === 2))) return '亚军'
  if (over && r.place[0] === 3 && r.place[1] === 3 && roundCn(r.round).endsWith('季军赛')) return '季军'
  return over ? `第 ${placeText(r.place)} 名` : `淘汰（第 ${placeText(r.place)} 名）`
}

/**
 * A side's marks against the places the event gives on: 已拿到 or 无缘 each, 已从别的途径进入 for a side that is in
 * that field already and so takes none of these places, 已解散，名额顺延 for a side the draw passed over because
 * history had let it go before it, and where a later event's places are still open to it,
 * 还在赛 — 待定 for a side already out on a joint place, 等抽签 for a league's places once over.
 */
function Marks({ r, sets, over }: { r: PlaceRow; sets: OnwardSet[]; over: boolean }) {
  const open = sets.some((s, k) => s.kind === 'event' && r.marks[k] === 'open')
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {sets.map((s, k) => {
        const m = r.marks[k]
        if (s.kind === 'points') {
          const v = over && r.place ? s.pays?.[r.place[0] - 1] : undefined
          return m === 'yes' ? <span key={k} className="tag win">{v ? `+${v} 积分` : '拿积分'}</span>
            : m === 'no' ? <span key={k} className="faint">没有积分</span> : null
        }
        return m === 'yes' ? <span key={k} className="tag t1">已拿到{s.name} 名额</span>
          : m === 'other' ? <span key={k} className="tag">已从别的途径进入{s.name}</span>
            : m === 'gone' ? <span key={k} className="tag">已解散，名额顺延</span>
              : m === 'no' ? <span key={k} className="faint">无缘{s.name}</span> : null
      })}
      {open && <span className="muted">{over ? '等抽签' : r.state === 'out' ? '待定' : '还在赛'}</span>}
    </span>
  )
}

/** A knockout bracket: each side's series, maps and rounds; who is still in, who went out in what place — and the places it gives on. */
function PlaceTableView({ t, comp, title }: { t: PlaceTable; comp: Competition; title: string }) {
  const { game } = useGame()
  const over = !!comp.champion
  const note = t.onward.map(onwardText).join(' · ')
  const marks = t.onward.length > 0
  return (
    <div style={{ minWidth: 0 }}>
      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>
        {title}{note && <span className="faint"> · {note}</span>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">名次</th><th>战队</th><th className="num">战绩</th><th className="num">小局</th><th className="num">回合差</th>
              {t.lives > 1 && <th className="num">败场</th>}
              <th>状态</th>
              {marks && <th>名额</th>}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.team} className={cls(r.team === game.myTeam && 'me')} data-team={r.team}>
                <td className="num mono">{r.state === 'in' ? '—' : placeText(r.place)}{comp.champion === r.team && ' 🏆'}</td>
                <td><Club id={r.team} name={r.name} /></td>
                <td className="num mono">{r.w}-{r.l}</td>
                <td className="num muted">{r.mapW}-{r.mapL}</td>
                <td className="num muted mono">{t.history ? '—' : signed(r.roundW - r.roundL)}</td>
                {t.lives > 1 && <td className="num mono muted">{r.l}/{t.lives}</td>}
                <td className="small">
                  {r.state === 'won' ? <b>{comp.champion === r.team ? '冠军' : `${roundCn(r.round)}胜出`}</b>
                    : r.state === 'in' ? <span className="pos">还在赛{r.round ? ` · 下一轮 ${roundCn(r.round)}` : ''}</span>
                      : <span className="muted">{outText(r, over)}</span>}
                </td>
                {marks && <td className="small"><Marks r={r} sets={t.onward} over={over} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny faint table-legend">{placeLegend(t, over)}</p>
    </div>
  )
}

/** An event over with no bracket of its own to read placings off: history's, or a played event that ended in groups. */
function FinalPlaces({ comp }: { comp: Competition }) {
  const { game } = useGame()
  const rows = comp.finished.map((id, i) => ({ id, p: comp.places?.[i] ?? i + 1 }))
  const joint = (p: number) => (comp.places ? comp.places.filter((x) => x === p).length : 1)
  const sets = onwardSets(game, comp).filter((s) => !s.league)
  // No line under a run of places: a side already in a later event's field by another road takes none of that
  // event's places here, and nor does a club history let go before the draw, so which rows go on is not a run
  // (engine/eventTable.ts markOnward). Each row says what it got — the points its place pays, the seat it took,
  // the field it was in already, or that it was let go and its place passed down.
  const marks = sets.length > 0
  const cell = (id: string, p: number) => sets.map((s, k) => {
    if (s.kind === 'points') {
      const v = s.pays?.[p - 1]
      return v ? <span key={k} className="tag win">+{v} 积分</span> : null
    }
    if (s.elsewhere?.includes(id)) return <span key={k} className="tag">已从别的途径进入{s.name}</span>
    if (s.gone?.includes(id)) return <span key={k} className="tag">已解散，名额顺延</span>
    if (s.seated?.includes(id)) return <span key={k} className="tag t1">已拿到{s.name} 名额</span>
    return null
  })
  const listed = (ids: string[] | null) => !!ids?.some((t) => rows.some((r) => r.id === t))
  const cascaded = cascadeNote(sets.some((s) => listed(s.elsewhere)), sets.some((s) => listed(s.gone)))
  const body = (list: typeof rows) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th className="num">名次</th><th>战队</th>{marks && <th>名额</th>}</tr></thead>
        <tbody>
          {list.map(({ id, p }) => (
            <tr key={id} className={cls(id === game.myTeam && 'me')}>
              <td className="num mono">{placeText([p, p + joint(p) - 1])}{comp.champion === id && ' 🏆'}</td>
              <td><Club id={id} /></td>
              {marks && <td className="small"><span className="row wrap" style={{ gap: 4 }}>{cell(id, p)}</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const note = sets.map(onwardText).join(' · ')
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>最终名次{note && <span className="faint"> · {note}</span>}</div>
      {body(rows.slice(0, 8))}
      {cascaded && <p className="tiny faint table-legend">{cascaded}。</p>}
      {rows.length > 8 && (
        <details style={{ margin: '0 13px 8px' }}>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '6px 0' }}>其余 {rows.length - 8} 队</summary>
          {body(rows.slice(8))}
        </details>
      )}
    </div>
  )
}
