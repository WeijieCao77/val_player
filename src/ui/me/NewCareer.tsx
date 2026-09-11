import { useMemo, useState } from 'react'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import type { Attrs, GameState, Region, Role } from '../../engine/types'
import { recomputeOverall } from '../../engine/player'
import { buildAttrs, candidateClubs, careerRegions, createCareer, emptyTalents, startCnOf, startOffers, TALENT_MAX, TALENT_POINTS } from '../../engine/me/career'
import type { StartPoint } from '../../engine/me/career'
import { ORIGINS, originOf } from '../../engine/me/origins'
import { hallTitle, readHall } from '../../engine/me/hall'
import { HallView } from './HallScreen'
import { ENTRY_CN, ENTRY_YEARS, regionIn, regionsOf } from '../../engine/era'
import type { EntryYear } from '../../engine/era'
import { Crest, Panel } from '../common'

const ROLES_PICK: Role[] = ['决斗者', '先锋', '控场', '哨卫']

/** From 2023 every place a career can start from is under one of the four leagues. */
const LEAGUE_ORDER: Region[] = ['Americas', 'EMEA', 'Pacific', 'China']

/**
 * The regions a career can open in that year: the ones that year's world has
 * clubs in. 2021's SEA is a stage its sub-regions played up to, not a place a
 * club was based, so it is not offered. 2026 is the one timeline's 2026: its
 * clubs are based where they really are, not in the four leagues' names.
 */
const regionsFor = (year: EntryYear): Region[] => (year >= 2026
  ? careerRegions(year)
  : regionsOf(year).filter((r) => candidateClubs(r, 1, year).length + candidateClubs(r, 2, year).length > 0))

export default function NewCareer({
  onStart, canContinue, onContinue,
}: { onStart: (g: GameState) => void; canContinue: boolean; onContinue: () => void }) {
  const [year, setYear] = useState<EntryYear>(2026)
  const [name, setName] = useState('')
  const [region, setRegion] = useState<Region>('China')
  const [role, setRole] = useState<Role>('决斗者')
  const [start, setStart] = useState<StartPoint>('pre')
  const [originKey, setOriginKey] = useState('netcafe')
  const [teamId, setTeamId] = useState('')
  // who comes for me at a club start: drawn once per visit, so the offers only change with where and how I start
  const [offerSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const [talents, setTalents] = useState(emptyTalents())
  // the 成就殿堂 opens from here, over the form, and its newest 称号 rides on the button
  const [hall, setHall] = useState(false)
  const [hallName] = useState(() => hallTitle(readHall()))
  const used = ATTR_KEYS.reduce((s, k) => s + talents[k], 0)
  const left = TALENT_POINTS - used
  const regions = useMemo(() => regionsFor(year), [year])
  const clubs = useMemo(() => (start === 'pre' ? [] : startOffers(region, start === 't1' ? 1 : 2, year, offerSeed)), [region, start, year, offerSeed])
  const ovr = useMemo(() => recomputeOverall({ role, attrs: buildAttrs(role, talents, originKey), stageBonus: 0 } as never), [role, talents, originKey])
  const origin = originOf(originKey)
  const starts = startCnOf(year)
  // where a career grinds from, under the league it feeds; 2021 had no leagues to group by
  const groups = useMemo<{ league: Region | null; list: Region[] }[]>(() => (year >= 2023
    ? LEAGUE_ORDER.map((league) => ({ league, list: regions.filter((r) => regionIn(r, year) === league) })).filter((g) => g.list.length)
    : [{ league: null, list: regions }]), [regions, year])
  if (hall) return <div className="newcareer"><HallView onBack={() => setHall(false)} /></div>
  const homeHint = (year >= 2023
    ? '职业联赛只有这四大赛区，赛区下面的 Challengers 按国家和地区分。'
    : '2021 年还没有联赛，每个赛区各打各的 Challengers。')
    + (start === 'pre'
      ? '天梯开局没有队伍：你在这里的服务器打排位，试训邀请由俱乐部发来，本地俱乐部最先注意到你。'
      : '不是你挑俱乐部，是俱乐部挑你：下面是这里来找你的几家，从里面签一家。')

  const pickYear = (y: EntryYear) => {
    setYear(y)
    setTeamId('')
    if (!regionsFor(y).includes(region)) setRegion('China')
  }
  const bump = (k: keyof Attrs, d: 1 | -1) => {
    const v = talents[k] + d
    if (v < 0 || v > TALENT_MAX) return
    if (d > 0 && left <= 0) return
    setTalents({ ...talents, [k]: v })
  }
  const go = () => {
    const ign = name.trim() || 'Rookie'
    // nothing picked: one of the clubs that came, never any club in the region
    const signed = teamId || (clubs.length ? clubs[offerSeed % clubs.length].id : undefined)
    onStart(createCareer({ name: ign, region, role, talents, originKey, start, teamId: signed, year }))
  }

  return (
    <div className="newcareer">
      {/* the cover carries the title; the heading stays for screen readers */}
      <img className="nc-cover" src="/cover.svg" alt="" width={1200} height={630} />
      <h1 className="sr-only">无畏契约 · 选手生涯 demo</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        世界里的每一支队、每一个人都是真实的 VCT 选手。你是一个虚构的新人——从哪一年、哪里开始，由你定。
      </p>
      {canContinue && <p><button className="primary" onClick={onContinue}>继续上次的生涯</button></p>}
      <p><button className="sm" onClick={() => setHall(true)}>成就殿堂{hallName ? ` · ${hallName}` : ''} →</button></p>

      <Panel title="从哪一年开始" actions={<span className="tiny faint">同一条时间线，两个入口</span>}>
        <div className="start-grid">
          {ENTRY_YEARS.map((y) => (
            <button key={y} className={`start-card${year === y ? ' on' : ''}`} onClick={() => pickYear(y)}>
              <b>{ENTRY_CN[y].name}</b>
              <span>{ENTRY_CN[y].blurb}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="从哪里开始">
        <div className="start-grid">
          {(Object.keys(starts) as StartPoint[]).map((k) => (
            <button key={k} className={`start-card${start === k ? ' on' : ''}`} onClick={() => {
              setStart(k)
              setTeamId('')
              // a club background has no club to belong to on the ladder
              if (k === 'pre' && ORIGINS.find((x) => x.key === originKey)?.needsClub) setOriginKey('netcafe')
            }}>
              <b>{starts[k].name}</b>
              <span>{starts[k].blurb}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="你是谁">
        <div className="row wrap" style={{ gap: 14 }}>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted">游戏 ID</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rookie" maxLength={16} style={{ width: 160 }} />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted">位置</span>
            <div className="seg">
              {ROLES_PICK.map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r}</button>)}
            </div>
          </div>
        </div>
        {/* not a league to pick: the server he grinds ranked on, which decides whose clubs notice him first */}
        <div className="home-pick">
          <div className="home-head">
            <span className="muted">来自</span>
            <span className="tiny faint">{homeHint}</span>
          </div>
          {groups.map(({ league, list }) => (
            <div key={league ?? 'all'} className={`home-group${league ? '' : ' flat'}`}>
              {league && <span className="home-league">{REGION_CN[league]}赛区</span>}
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {list.map((r) => <button key={r} className={region === r ? 'on' : ''} onClick={() => { setRegion(r); setTeamId('') }}>{REGION_CN[r]}</button>)}
              </div>
            </div>
          ))}
        </div>
        {year <= 2021 && region === 'China' && (
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>
            2021 年的中国没有联赛，也没有通往国际赛的门：全年只有虎牙的两站杯赛和一场 FGC 邀请赛。第一张外卡要等到 2022 年。
          </p>
        )}
      </Panel>

      <Panel title="出身" actions={<span className="tiny faint">刻意不等值，差的是形状</span>}>
        <div className="origin-grid">
          {ORIGINS.map((o) => {
            // 青训营 is a club's: the card goes with a club start, and on the ladder it says so rather than disappearing
            const locked = !!o.needsClub && start === 'pre'
            return (
              <button key={o.key} className={`origin-pick${originKey === o.key ? ' on' : ''}${locked ? ' locked' : ''}`} disabled={locked} onClick={() => setOriginKey(o.key)}>
                {/* the card is the story; what it does to the numbers stays in
                    origins.ts — a wall of +5 · −6 · $1,500 is not a background */}
                <b>{o.name}</b>
                <span>{o.blurb}</span>
                {locked && <span className="why">要从俱乐部开局：选 Challengers 或 VCT 起点</span>}
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel title={`天赋 · 还剩 ${left} 点`} actions={<span className="tag">起始综合约 {ovr}，上限约 {ovr + (origin.flags?.late ? 12 : 16)}</span>}>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          {year <= 2021
            ? '每点 +3。打进过赛区决赛的俱乐部，首发中位数是 81；只打过海选的俱乐部约 68——差距要在天梯、杯赛、训练赛里补。'
            : '每点 +3。一级联赛首发大多在 80 上下，Challengers 首发多在六十几——差距要在天梯、杯赛、训练赛里补。'}
        </p>
        <div className="talent-grid">
          {ATTR_KEYS.map((k) => (
            <div key={k} className="talent-row">
              <span className="muted">{ATTR_CN[k]}</span>
              <div className="pips">{Array.from({ length: TALENT_MAX }, (_, i) => <i key={i} className={i < talents[k] ? 'on' : ''} />)}</div>
              <div className="row" style={{ gap: 4 }}>
                <button className="sm" onClick={() => bump(k, -1)} disabled={talents[k] <= 0}>−</button>
                <b style={{ minWidth: 18, textAlign: 'center' }}>{talents[k]}</b>
                <button className="sm" onClick={() => bump(k, 1)} disabled={left <= 0 || talents[k] >= TALENT_MAX}>+</button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {start !== 'pre' && (
        <Panel title="谁来找你" actions={<span className="tiny faint">弱队更愿意赌新人；不选就随便签一家</span>}>
          <div className="club-list">
            {clubs.map((c) => (
              <button key={c.id} className={teamId === c.id ? 'on' : ''} onClick={() => setTeamId(teamId === c.id ? '' : c.id)} title={c.name}>
                <Crest id={c.id} size={22} /><span>{c.tag}</span><span className="r">{c.standing}</span>
              </button>
            ))}
            {!clubs.length && <div className="empty">{year} 年开季时这里没有这一档的俱乐部。</div>}
          </div>
        </Panel>
      )}

      <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={go} disabled={left !== 0 || (start !== 'pre' && !clubs.length)} title={left !== 0 ? '把天赋点分完' : ''}>开始生涯</button>
      </div>
    </div>
  )
}
