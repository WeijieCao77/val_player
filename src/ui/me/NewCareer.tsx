import { useEffect, useMemo, useState } from 'react'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import type { Attrs, GameState, Region, Role } from '../../engine/types'
import { recomputeOverall } from '../../engine/player'
import { buildAttrs, candidateClubs, careerRegions, createCareer, emptyTalents, isAcademy, startCnOf, startPool, TALENT_MAX, TALENT_POINTS } from '../../engine/me/career'
import type { StartPoint } from '../../engine/me/career'
import { ORIGINS, originOf } from '../../engine/me/origins'
import { hallAchCount, hallTitle, noteHall, readHall } from '../../engine/me/hall'
import { ACHIEVEMENTS } from '../../engine/me/achievements'
import { loadAutosave } from '../../engine/me/save'
import type { AutosaveInfo } from '../../engine/me/save'
import type { SaveMeta } from '../../engine/me/saveMeta'
import { fanTier, fansCn } from '../../engine/me/fans'
import { compCn } from '../../engine/me/compname'
import { HallView } from './HallScreen'
import { ENTRY_CN, ENTRY_YEARS, formatOf, regionIn, regionsOf } from '../../engine/era'
import type { EntryYear } from '../../engine/era'
import { Crest, Panel, money } from './common'
import { attrWord, useNumbers } from './words'

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

/**
 * Backgrounds on offer per visit (asked 2026-09-12: 「把选择都放进后台，每次随机抽取三个留给玩家选择」).
 * 破晓 deals its background cards the same way and deals again on 「换一批」, as often as asked
 * (its main.ts screenCreate / the reroll button); only cards the chosen start can take are dealt.
 */
const DEAL = 3
const fits = (key: string, start: StartPoint): boolean => !originOf(key).needsClub || start !== 'pre'
const shuffled = <T,>(xs: T[]): T[] => {
  const out = xs.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
/** Three that fit the start; a new deal avoids the three on the table while there are enough others. */
function dealOrigins(start: StartPoint, table: string[] = []): string[] {
  const pool = ORIGINS.map((o) => o.key).filter((k) => fits(k, start))
  const fresh = pool.filter((k) => !table.includes(k))
  return shuffled(fresh.length >= DEAL ? fresh : pool).slice(0, DEAL)
}

const pad = (n: number) => String(n).padStart(2, '0')
/** When the save was last written, on this device's clock: how long ago, and the day and time. */
function playedAt(at: number): { ago: string; when: string } {
  const d = new Date(at)
  const now = new Date()
  const m = Math.max(0, Math.round((now.getTime() - at) / 60000))
  const ago = m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`
  const day = `${d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日`
  return { ago, when: `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
/** A season day as the game writes the date (engine/season.ts dateLabel), for a save known only by its day. */
const dayLabel = (year: number, day: number): string => {
  const d = new Date(Date.UTC(year, 0, 1))
  d.setUTCDate(d.getUTCDate() + day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}
/** the hero's words for a tier (PlayerGame): 一线 / 二线 before the leagues, VCT / 挑战者联赛 after */
const tierCn = (year: number, tier: 1 | 2): string =>
  (formatOf(year) === 'open' ? (tier === 1 ? '一线' : '二线') : tier === 1 ? 'VCT' : '挑战者联赛')
const SEAT_CN = { starter: '首发', bench: '替补', trial: '试用中' } as const
const RESULT_CN = { W: '胜', L: '负', D: '平' } as const
/** the summary already names the crest to draw; nothing to look up on a page with no game */
const NO_HEIRS: Record<string, string> = {}

function SaveWho({ meta }: { meta: SaveMeta }) {
  const c = meta.club
  return (
    <div className="save-id">
      <div className="save-who"><b>{meta.ign}</b><span className="muted">{meta.role} · {meta.age} 岁</span></div>
      <div className="save-club">
        {c ? (
          <>
            <Crest id={c.crest} size={20} heirs={NO_HEIRS} />
            <b>{c.name}</b>
            <span className={`tag${c.tier === 1 ? ' t1' : ''}`}>{c.league || tierCn(meta.year, c.tier)}</span>
            <span className="muted">{SEAT_CN[c.seat]}</span>
          </>
        ) : (
          <b>{meta.phase === 'retired' ? `已退役${meta.ending ? ` · ${meta.ending}` : ''}` : meta.phase === 'free' ? '自由人' : `天梯 · ${meta.ladder || '没有队伍'}`}</b>
        )}
      </div>
      <div className="save-when"><b>{meta.stage}</b><span className="muted">{meta.date}</span></div>
    </div>
  )
}

/**
 * The career to continue, laid out like 破晓's cover card (its save.ts continueCard,
 * theme.css .savecont): who and where on the left with the two buttons, the
 * numbers on the right; on a phone the essentials first, the buttons, then the rest.
 */
function SaveCard({ info, busy, bad, onContinue, onNew }: {
  info: AutosaveInfo; busy: boolean; bad: boolean; onContinue: () => void; onNew: () => void
}) {
  const [nums] = useNumbers()
  const meta = info.meta
  const hallNow = useMemo(() => { const h = readHall(); return h ? hallAchCount(h) : null }, [])
  const at = meta ? playedAt(meta.at) : null
  const last = meta?.last
  return (
    <section className="save-card" aria-label="上次的存档">
      <div className="save-head">
        <h2>上次的存档</h2>
        {at && <span className="save-at">{at.ago} · {at.when}</span>}
      </div>
      <div className="save-grid">
        {meta ? <SaveWho meta={meta} /> : (
          <div className="save-id">
            <div className="save-who"><b>上次的生涯</b></div>
            <div className="save-when">
              {info.year !== null && info.day !== null && <b>{dayLabel(info.year, info.day)}</b>}
              <span className="muted">旧版本存下的档，继续一次之后这里会写出详细数据。</span>
            </div>
          </div>
        )}
        {meta && (
          <div className="save-key save-tiles">
            <div className="save-tile"><small>综合</small><b>{nums ? meta.overall : attrWord(meta.overall)}</b></div>
            <div className="save-tile wide">
              <small>上一场</small>
              {last ? (
                <>
                  <b><span className={last.result === 'W' ? 'w' : last.result === 'L' ? 'l' : ''}>{RESULT_CN[last.result]} {last.score}</span> vs {last.oppTag || last.opp}</b>
                  <em>{compCn(last.event)}{last.started ? '' : ' · 没出场'}</em>
                </>
              ) : <b className="muted">还没打过比赛</b>}
            </div>
          </div>
        )}
        <div className="save-go">
          {bad && <p className="save-bad" role="alert">这个存档读不了：可能是旧版本写的，或者已经损坏。开新生涯不受它影响。</p>}
          <div className="row">
            <button className="primary" onClick={onContinue} disabled={busy || bad}>{busy ? '读取中…' : '继续'}</button>
            <button onClick={onNew} disabled={busy}>开新生涯</button>
          </div>
          <p className="tiny faint">开新生涯会覆盖这个存档。</p>
        </div>
        {meta && (
          <div className="save-more save-tiles">
            <div className="save-tile"><small>冠军</small><b>{meta.titles}</b>{meta.intl > 0 && <em>国际赛 {meta.intl}</em>}</div>
            <div className="save-tile"><small>粉丝</small><b>{fanTier(meta.fans).name}</b><em>{fansCn(meta.fans)}</em></div>
            <div className="save-tile"><small>资金</small><b>{money(meta.money)}</b></div>
            <div className="save-tile"><small>成就</small><b>本局 {meta.ach}</b><em>殿堂 {hallNow ?? meta.hall}/{ACHIEVEMENTS.length}</em></div>
          </div>
        )}
      </div>
    </section>
  )
}

/** 破晓 asks before 重新开一局 overwrites the save (its main.ts askConfirm on #savenew); so does this, once. */
function ConfirmNew({ who, onOk, onCancel }: { who?: string; onOk: () => void; onCancel: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onCancel])
  return (
    <div className="modal-bg nc-confirm" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="nc-confirm-t" aria-describedby="nc-confirm-d" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <div className="nc-confirm-eyebrow">请确认</div>
          <h3 id="nc-confirm-t">开新生涯</h3>
          <p id="nc-confirm-d">{who ? `${who} 的存档` : '上次的存档'}会在新生涯开始时被覆盖，回不来了。</p>
          <div className="row">
            <button className="primary" onClick={onOk}>开新生涯</button>
            <button autoFocus onClick={onCancel}>取消</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewCareer({
  onStart, save, onContinue,
}: {
  onStart: (g: GameState) => void
  /** the career to continue, drawn from its summary without reading it; null when there is none */
  save: AutosaveInfo | null
  /** read the save and open it; false when it cannot be read */
  onContinue: () => boolean
}) {
  // with a save the page opens on its card; without one, straight into making a career
  const [view, setView] = useState<'home' | 'form' | 'hall'>(save ? 'home' : 'form')
  const [hallFrom, setHallFrom] = useState<'home' | 'form'>('home')
  const [asking, setAsking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState(false)
  const [year, setYear] = useState<EntryYear>(2026)
  const [name, setName] = useState('')
  const [region, setRegion] = useState<Region>('China')
  const [role, setRole] = useState<Role>('决斗者')
  const [start, setStart] = useState<StartPoint>('pre')
  // no background picked for you, as 破晓's 建档 picks none: the start button says it is missing
  const [originKey, setOriginKey] = useState('')
  // dealt once a visit, so a change of role or talents does not deal again
  const [offer, setOffer] = useState<string[]>(() => dealOrigins('pre'))
  const [talents, setTalents] = useState(emptyTalents())
  // the 成就殿堂 opens from here, and its newest 称号 rides on the button
  const [hallName] = useState(() => hallTitle(readHall()))
  const used = ATTR_KEYS.reduce((s, k) => s + talents[k], 0)
  const left = TALENT_POINTS - used
  const regions = useMemo(() => regionsFor(year), [year])
  // where a club start is placed: the game picks from these once the career starts (career.ts pickClub)
  const pool = useMemo(() => startPool(region, start, year), [region, start, year])
  const academies = useMemo(() => start === 'chal' && pool.some((c) => isAcademy(c, year)), [pool, start, year])
  const ovr = useMemo(() => recomputeOverall({ role, attrs: buildAttrs(role, talents, originKey), stageBonus: 0 } as never), [role, talents, originKey])
  const origin = originOf(originKey)
  const starts = startCnOf(year)
  // where a career grinds from, under the league it feeds; 2021 had no leagues to group by
  const groups = useMemo<{ league: Region | null; list: Region[] }[]>(() => (year >= 2023
    ? LEAGUE_ORDER.map((league) => ({ league, list: regions.filter((r) => regionIn(r, year) === league) })).filter((g) => g.list.length)
    : [{ league: null, list: regions }]), [regions, year])
  useEffect(() => { window.scrollTo(0, 0) }, [view])

  const openHall = (from: 'home' | 'form') => { setHallFrom(from); setView('hall') }
  if (view === 'hall') return <div className="newcareer"><HallView onBack={() => setView(hallFrom)} /></div>
  const hallButton = (from: 'home' | 'form') => (
    <button className="sm" onClick={() => openHall(from)}>成就殿堂{hallName ? ` · ${hallName}` : ''} →</button>
  )
  const cover = (
    <>
      {/* the cover carries the title; the heading stays for screen readers */}
      <img className="nc-cover" src="/cover.svg" alt="" width={1200} height={630} />
      <h1 className="sr-only">无畏契约 · 选手生涯 demo</h1>
    </>
  )
  const intro = '世界里的每一支队、每一个人都是真实的 VCT 选手。你是一个虚构的新人——从哪一年、哪里开始，由你定。'

  const cont = () => {
    setBusy(true)
    setBad(false)
    // a frame for 「读取中…」 to show: reading the save holds the page for a moment
    window.setTimeout(() => { if (!onContinue()) { setBusy(false); setBad(true) } }, 30)
  }
  const askNew = () => (confirmed ? setView('form') : setAsking(true))
  const confirmNew = () => {
    // a save from before the summary may never have been opened by a build with the hall: what it unlocked goes in
    // before a new career overwrites it (破晓 seeds its hall from the save on its cover, save.ts hallSeedFrom)
    if (save && !save.meta) {
      try { const g = loadAutosave(); if (g?.me) noteHall(g, true) } catch { /* unreadable: nothing to note */ }
    }
    setAsking(false)
    setConfirmed(true)
    setView('form')
  }

  if (view === 'home' && save) {
    return (
      <div className="newcareer nc-home">
        {cover}
        <SaveCard info={save} busy={busy} bad={bad} onContinue={cont} onNew={askNew} />
        <div className="row nc-tools">{hallButton('home')}</div>
        <p className="muted small nc-intro">{intro}</p>
        {asking && <ConfirmNew who={save.meta?.ign} onOk={confirmNew} onCancel={() => setAsking(false)} />}
      </div>
    )
  }

  const clubWord = start === 't1' ? '一线' : year <= 2021 ? '二线' : ' Challengers '
  const homeHint = (year >= 2023
    ? '职业联赛只有这四大赛区，赛区下面的 Challengers 按国家和地区分。'
    : '2021 年还没有联赛，每个赛区各打各的 Challengers。')
    + (start === 'pre'
      ? '天梯开局没有队伍：你在这里的服务器打排位，试训邀请由俱乐部发来，本地俱乐部最先注意到你。'
      : !pool.length ? `${year} 年开季时这里没有${start === 't1' ? '一线' : '二线'}俱乐部。`
        : academies ? `这里有 ${pool.length} 支一线队的二队，开局进其中一支。`
          : `这里有 ${pool.length} 支${clubWord}俱乐部，开局进其中一支，弱队更愿意赌新人。`)
  // what is still missing, said on the button, in the order the page asks (破晓's 建档 button, main.ts viewCreate)
  const blocked = start !== 'pre' && !pool.length ? `${year} 年开季时${REGION_CN[region]}没有${start === 't1' ? '一线' : '二线'}俱乐部`
    : !originKey ? '先选一个出身'
      : left !== 0 ? `还需分配 ${left} 点天赋`
        : ''

  const pickYear = (y: EntryYear) => {
    setYear(y)
    if (!regionsFor(y).includes(region)) setRegion('China')
  }
  const pickStart = (k: StartPoint) => {
    setStart(k)
    // a card this start cannot take is swapped for one it can; the other two stay where they are
    if (offer.every((key) => fits(key, k))) return
    const spare = shuffled(ORIGINS.map((o) => o.key).filter((x) => fits(x, k) && !offer.includes(x)))
    setOffer(offer.map((key) => (fits(key, k) ? key : spare.shift() ?? key)))
    if (originKey && !fits(originKey, k)) setOriginKey('')
  }
  const reroll = () => {
    setOffer(dealOrigins(start, offer))
    setOriginKey('')
  }
  const bump = (k: keyof Attrs, d: 1 | -1) => {
    const v = talents[k] + d
    if (v < 0 || v > TALENT_MAX) return
    if (d > 0 && left <= 0) return
    setTalents({ ...talents, [k]: v })
  }
  const go = () => {
    if (blocked) return
    const ign = name.trim() || 'Rookie'
    // a club start is placed by the game, off the career's seed (career.ts pickClub)
    onStart(createCareer({ name: ign, region, role, talents, originKey, start, year }))
  }

  return (
    <div className="newcareer">
      {cover}
      <p className="muted" style={{ marginTop: 0 }}>{intro}</p>
      <div className="row wrap nc-tools">
        {save && <button className="sm ghost" onClick={() => setView('home')}>← 回到存档</button>}
        {hallButton('form')}
      </div>

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
            <button key={k} className={`start-card${start === k ? ' on' : ''}`} onClick={() => pickStart(k)}>
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
                {list.map((r) => <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{REGION_CN[r]}</button>)}
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

      <Panel title="出身" actions={<button className="sm ghost" onClick={reroll}>换一批</button>}>
        <div className="origin-grid">
          {offer.map((k) => {
            const o = originOf(k)
            return (
              <button key={k} className={`origin-pick${originKey === k ? ' on' : ''}`} aria-pressed={originKey === k} onClick={() => setOriginKey(k)}>
                {/* the card is the story; what it does to the numbers stays in
                    origins.ts — a wall of +5 · −6 · $1,500 is not a background */}
                <b>{o.name}</b>
                <span>{o.blurb}</span>
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

      <div className="row nc-go" style={{ gap: 10, justifyContent: 'flex-end' }}>
        {save && confirmed && <span className="tiny faint">开始后覆盖上次的存档</span>}
        <button className="primary" onClick={go} disabled={!!blocked}>{blocked || '开始生涯'}</button>
      </div>
    </div>
  )
}
