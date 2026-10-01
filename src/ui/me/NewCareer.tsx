import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import type { Attrs, Region, Role } from '../../engine/types'
// the screen's own numbers, apart from the world (me/talent.ts); what it reads off the world was worked out as the
// site was built (me/startSheet.ts), so the page a new player opens on fetches no roster book (reported 2026-09-18)
import { ceilingLines, ceilingPreview, startCnOf, TALENT_MAX, TALENT_POINTS, TALENT_PRESETS, ROLE_TALENT_PRESETS, TALENT_TEAM_HINT, talentShape, zeroTalents } from '../../engine/me/talent'
import type { StartPoint } from '../../engine/me/talent'
import type { CareerOpts } from '../../engine/me/career'
import START_SHEET from 'virtual:start-sheet'
import { ORIGINS, originName, originOf } from '../../engine/me/origins'
import { serverAt } from '../../engine/me/rank'
import { hallAchCount, hallTitle, lastCareerLine, readHall } from '../../engine/me/hall'
import type { AutosaveInfo } from '../../engine/me/saveInfo'
import type { Backup, BackupPreview } from '../../engine/me/backup'
import { HallView } from './HallScreen'
import { ConfirmCard, SaveCard, playedAt } from './SaveCard'
import { ExportBox, ImportView } from './Backup'
import ThemeToggle from './ThemeToggle'
import { ENTRY_CN, ENTRY_YEARS, regionIn } from '../../engine/era'
import type { EntryYear } from '../../engine/era'
import { Panel } from './common'
import { attrWord, useNumbers } from './words'
import { track } from '../../engine/me/telemetry'
import AvatarEditor from './AvatarEditor'
import OriginDetails from './OriginDetails'

const ROLES_PICK: Role[] = ['决斗者', '先锋', '控场', '哨卫']

/** From 2023 every place a career can start from is under one of the four leagues. */
const LEAGUE_ORDER: Region[] = ['Americas', 'EMEA', 'Pacific', 'China']

/**
 * Backgrounds on offer per visit (asked 2026-09-12: 「把选择都放进后台，每次随机抽取三个留给玩家选择」).
 * 破晓 deals its background cards the same way and deals again on 「换一批」, as often as asked
 * (its main.ts screenCreate / the reroll button); only cards the chosen start can take are dealt.
 */
const DEAL = 3
// Keep existing real-career saves loadable while this entry is held back from new careers.
const SHOW_REAL_CAREER_ENTRY = false
/** Real-player starts the 2024/2023 covers offer: only the public card the player picks from, nothing more. */
const REAL_CARDS = [
  { key: 'zmjjkk-2024', name: 'ZmjjKK', date: '2024-01-01', team: 'EDward Gaming', region: 'China', role: '决斗者', age: 19, year: 2024 },
  { key: 'demon1-2023', name: 'Demon1', date: '2023-01-19', team: 'Evil Geniuses', region: 'Americas', role: '决斗者', age: 20, year: 2023 },
  { key: 'boaster-2023', name: 'Boaster', date: '2023-01-01', team: 'FNATIC', region: 'EMEA', role: '控场', age: 27, year: 2023 },
] as const
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

export default function NewCareer({
  onStart, save, onContinue, onSeedHall, onWarm, onReadBackup,
}: {
  /**
   * make the career these choices describe and open it (App.tsx: the career and the world come with it); false when
   * the game's files did not arrive, which App says itself
   */
  onStart: (opts: CareerOpts) => Promise<boolean>
  /** the career to continue, drawn from its summary without reading it; null when there is none */
  save: AutosaveInfo | null
  /** read the save and open it; false when it cannot be read, null when the game's files did not arrive (App says so) */
  onContinue: () => Promise<boolean | null>
  /** a save from before the summary: what it unlocked goes into the hall before a new career overwrites it */
  onSeedHall: () => Promise<void>
  /** a press on its way — the pointer on 继续 or 开始生涯: the career can start arriving */
  onWarm?: () => void
  /**
   * 导入存档: decode a backup and say what career it holds, with a way to take it in and open it (App.tsx, with the
   * career's files); null when those files did not arrive, which App says itself
   */
  onReadBackup: (b: Backup) => Promise<BackupPreview | null>
}) {
  // with a save the page opens on its card; without one, straight into making a career
  const [view, setView] = useState<'home' | 'form' | 'hall' | 'import'>(save ? 'home' : 'form')
  // where 成就殿堂 and 导入存档 go back to
  const [from, setFrom] = useState<'home' | 'form'>('home')
  // 导出存档 open under the save card (ui/me/Backup.tsx)
  const [exporting, setExporting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState(false)
  // 自创 or 真人: which entry the form shows (real cards have no talent/origin pick; the engine will overwrite)
  const [mode, setMode] = useState<'自创' | '真人'>('自创')
  // 开始生涯 pressed: the career and the world it is made in are on their way
  const [starting, setStarting] = useState(false)
  const [realKey, setRealKey] = useState<(typeof REAL_CARDS)[number]['key']>(REAL_CARDS[0].key)
  const [year, setYear] = useState<EntryYear>(2026)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string>()
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [region, setRegion] = useState<Region>('China')
  const [role, setRole] = useState<Role>('决斗者')
  const [start, setStart] = useState<StartPoint>('pre')
  // no background picked for you, as 破晓's 建档 picks none: the start button says it is missing
  const [originKey, setOriginKey] = useState('')
  // dealt once a visit, so a change of role or talents does not deal again
  const [offer, setOffer] = useState<string[]>(() => dealOrigins('pre'))
  // nothing spent: the player spends all twenty (asked 2026-09-14); a build to start from is one press away (TALENT_PRESETS)
  const [talents, setTalents] = useState(zeroTalents())
  // the 成就殿堂, read once a visit: it opens from here, and its newest 称号 rides on the button
  const [hall] = useState(() => readHall())
  const hallName = hallTitle(hall)
  const used = ATTR_KEYS.reduce((s, k) => s + talents[k], 0)
  const left = TALENT_POINTS - used
  // what the year's world says, as the site was built (me/startSheet.ts): the regions it has clubs in, the list
  // createCareer opens from (career.ts careerRegions); per place and door, what createCareer would refuse, ladder start
  // included, in the button's words (career.ts startBlocked), and how many clubs a club start is placed among — the
  // game picks one once the career starts (career.ts startPool, pickClub) — and whether they are second teams
  const sheet = START_SHEET[year]
  const regions = sheet.regions
  const door = sheet.doors[region]?.[start]
  const pool = door?.pool ?? 0
  // a place the table has no row for is one the year has no club in (career.ts startBlocked says the same)
  const gate = door ? door.gate || null : `${year} 年开季时${REGION_CN[region] ?? region}没有俱乐部`
  const academies = !!door?.academies
  // the last career that ended, in one line: how it began, what its world line rewrote, and the other doors to try —
  // only those that open for the year and place picked here, so it never points at a door the button would refuse
  // (me/hall.ts lastCareerLine; asked 2026-09-18). Words only: nothing a career counts reads the hall.
  const again = lastCareerLine(hall, year, (k) => !!sheet.doors[region] && !sheet.doors[region]![k].gate)
  // the talent panel's ceiling and the starters beside it, from the engine and the entry year's data (me/talent.ts ceilingLines)
  const [capNums] = useNumbers()
  const capLine = useMemo(() => ceilingLines(ceilingPreview(role, talents, originKey, sheet.bands), year, capNums ? undefined : attrWord), [role, talents, originKey, sheet, year, capNums])
  const starts = startCnOf(year)
  // where a career grinds from, under the league it feeds; 2021 had no leagues to group by
  const groups = useMemo<{ league: Region | null; list: Region[] }[]>(() => (year >= 2023
    ? LEAGUE_ORDER.map((league) => ({ league, list: regions.filter((r) => regionIn(r, year) === league) })).filter((g) => g.list.length)
    : [{ league: null, list: regions }]), [regions, year])
  useEffect(() => { window.scrollTo(0, 0) }, [view])

  const openFrom = (to: 'hall' | 'import', back: 'home' | 'form') => { setFrom(back); setView(to) }
  if (view === 'hall') return <div className="newcareer"><HallView onBack={() => setView(from)} /></div>
  if (view === 'import') {
    return (
      <div className="newcareer">
        <ImportView save={save} onBack={() => setView(from)} onRead={onReadBackup} onSeedHall={onSeedHall} />
      </div>
    )
  }
  const hallButton = (back: 'home' | 'form') => (
    <button className="sm" onClick={() => openFrom('hall', back)}>成就殿堂{hallName ? ` · ${hallName}` : ''} →</button>
  )
  const cover = (
    <>
      {/* the cover carries the title; the heading stays for screen readers */}
      <img className="nc-cover" src={`${import.meta.env.BASE_URL}cover.svg`} alt="" width={1200} height={630} />
      <h1 className="sr-only">无畏契约 · 选手生涯</h1>
    </>
  )
  const intro = '世界里的每一支队、每一个人都是真实的 VCT 选手。你是一个虚构的新人——从哪一年、哪里开始，由你定。'

  const cont = () => {
    setBusy(true)
    setBad(false)
    // a frame for 「读取中…」 to show: reading the save holds the page for a moment (a packed one is unzipped first, engine/me/save.ts)
    const failed = () => { setBusy(false); setBad(true) }
    // null: the game's files did not arrive, which is not the save's fault (App.tsx says what to do)
    window.setTimeout(() => { onContinue().then((ok) => { if (ok === false) failed(); else if (ok === null) setBusy(false) }, failed) }, 30)
  }
  const askNew = () => (confirmed ? setView('form') : setAsking(true))
  const confirmNew = async () => {
    // a save from before the summary may never have been opened by a build with the hall: what it unlocked goes in
    // before a new career overwrites it (破晓 seeds its hall from the save on its cover, save.ts hallSeedFrom)
    if (save && !save.meta) await onSeedHall()
    setAsking(false)
    setConfirmed(true)
    setView('form')
  }

  if (view === 'home' && save) {
    const meta = save.meta
    return (
      <div className="newcareer nc-home">
        {cover}
        <SaveCard
          label="上次的存档"
          at={meta ? playedAt(meta.at) : null}
          info={save}
          hallNow={meta ? (hall ? hallAchCount(hall) : meta.hall) : null}
          go={(
            <>
              {bad && <p className="save-bad" role="alert">这个存档读不了：可能是旧版本写的，或者已经损坏。开新生涯不受它影响。</p>}
              <div className="row">
                <button className="primary" onClick={cont} onPointerEnter={onWarm} onFocus={onWarm} disabled={busy || bad}>{busy ? '读取中…' : '继续'}</button>
                <button onClick={askNew} disabled={busy}>开新生涯</button>
              </div>
              <p className="tiny faint">开新生涯会覆盖这个存档。</p>
              {/* the save lives in this browser alone: a copy to keep, and one brought in (ui/me/Backup.tsx) */}
              <div className="row save-backup">
                <button className="sm ghost" aria-expanded={exporting} onClick={() => setExporting(!exporting)} disabled={busy}>导出存档</button>
                <button className="sm ghost" onClick={() => openFrom('import', 'home')} disabled={busy}>导入存档</button>
              </div>
            </>
          )}
        />
        {exporting && <ExportBox onClose={() => setExporting(false)} />}
        {/* 配色开关在生涯壳的侧栏底部，而开局页在壳外面：一个觉得黑底看着晕的人，
            本来得先开一局生涯才够得着米色。这里放一颗同样的（安静地靠右） */}
        <div className="row nc-tools">{hallButton('home')}<div className="right row"><ThemeToggle compact /></div></div>
        <p className="muted small nc-intro">{intro}</p>
        {asking && (
          <ConfirmCard
            title="开新生涯"
            body={`${save.meta?.ign ? `${save.meta.ign} 的存档` : '上次的存档'}会在新生涯开始时被覆盖，回不来了。`}
            ok="开新生涯"
            onOk={confirmNew}
            onCancel={() => setAsking(false)}
          />
        )}
      </div>
    )
  }

  const clubWord = start === 't1' ? '一线' : year <= 2021 ? '二线' : ' Challengers '
  const homeHint = (year >= 2023
    ? '职业联赛只有这四大赛区，赛区下面的 Challengers 按国家和地区分。'
    : '2021 年还没有联赛，每个赛区各打各的 Challengers。')
    + (start === 'pre'
      ? '天梯开局没有队伍：你在这里的服务器打排位，试训邀请由俱乐部发来，本地俱乐部最先注意到你。'
      : !pool ? `${year} 年开季时这里没有${start === 't1' ? '一线' : '二线'}俱乐部。`
        : academies ? `这里有 ${pool} 支一线队的二队，开局进其中一支。`
          : `这里有 ${pool} 支${clubWord}俱乐部，开局进其中一支，弱队更愿意赌新人。`)
  // what is still missing, said on the button, in the order the page asks (破晓's 建档 button, main.ts viewCreate)
  const blocked = mode === '真人' ? '' : avatarBusy ? '等待头像处理完成'
    : gate ? gate
    : !originKey ? '先选一个出身'
      : left !== 0 ? `还需分配 ${left} 点天赋`
        : ''

  const pickYear = (y: EntryYear) => {
    setYear(y)
    if (!START_SHEET[y].regions.includes(region)) setRegion('China')
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
  // 破晓's 一键随机分配: all twenty, scattered, none over the cap
  const scatter = () => {
    const t = zeroTalents()
    for (let n = TALENT_POINTS; n > 0; n--) {
      const room = ATTR_KEYS.filter((k) => t[k] < TALENT_MAX)
      if (!room.length) break
      t[room[Math.floor(Math.random() * room.length)]]++
    }
    setTalents(t)
  }
  const shape = talentShape(talents)
  const presets = [ROLE_TALENT_PRESETS[role], ...Object.entries(ROLE_TALENT_PRESETS)
    .filter(([r]) => r !== role).map(([, preset]) => preset), ...TALENT_PRESETS]
  const presetOn = presets.find((x) => ATTR_KEYS.every((k) => x.t[k] === talents[k]))?.key
  const go = () => {
    if (blocked || starting) return
    const card = REAL_CARDS.find((c) => c.key === realKey)
    const ign = name.trim() || 'Rookie'
    setStarting(true)
    // a frame for 「载入中…」 to show: the career, and the world it is made in, arrive with this press (App.tsx)
    window.setTimeout(() => {
      onStart(mode === '真人'
        ? { name: card!.name, region: card!.region, role: card!.role, talents: zeroTalents(), originKey: 'real', start: 't1', year: card!.year, scenario: card!.key }
        : { name: ign, region, role, talents, originKey, start, year, avatar }).then((ok) => {
        if (!ok) { setStarting(false); return }
        // What was chosen on this screen, and nothing that was typed into it: the
        // IGN is the one free-text field in the whole game and it never leaves
        // (engine/me/telemetry.ts). The talent goes out as its shape — the most on
        // any one attribute, and how many got any — which is what 「天赋怎么点的」
        // asks and carries no text at all. Said once the career has opened.
        if (mode === '真人') {
          // The real card's own opening year, and nothing that identifies the player beyond the public card.
          track('career_start', {
            year: card!.year,
            region: card!.region,
            role: card!.role,
            start: 't1',
            origin: 'real',
            talent_max: 0,
            talent_spread: 0,
            talent_points: 0,
          })
        } else {
          track('career_start', {
            year,
            region,
            role,
            start,
            origin: originKey,
            talent_max: ATTR_KEYS.reduce((m, k) => Math.max(m, talents[k]), 0),
            talent_spread: ATTR_KEYS.filter((k) => talents[k] > 0).length,
            talent_points: TALENT_POINTS - left,
          })
        }
      }, () => setStarting(false))
    }, 30)
  }

  return (
    <div className="newcareer">
      {cover}
      <p className="muted" style={{ marginTop: 0 }}>{mode === '真人' ? '接管一位真实选手，从核查过的起点改写未来。此后的比赛、合同与生涯故事均为本局模拟。' : intro}</p>
      {again && <p className="nc-again">{again}</p>}
      <div className="row wrap nc-tools">
        {save && <button className="sm ghost" onClick={() => setView('home')}>← 回到存档</button>}
        {hallButton('form')}
        {/* a career brought from another device or browser: with no save here, this is the page it lands on */}
        {!save && <button className="sm" onClick={() => openFrom('import', 'form')}>导入存档</button>}
        <div className="right row"><ThemeToggle compact /></div>
      </div>

      {SHOW_REAL_CAREER_ENTRY && <Panel title="生涯剧本" actions={<span className="tiny faint">选择你的起点</span>}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={mode === '自创' ? 'on' : ''} onClick={() => setMode('自创')}>自创</button>
          <button className={mode === '真人' ? 'on' : ''} onClick={() => setMode('真人')}>真人</button>
        </div>
        {mode === '真人' && (
          <div className="start-grid" style={{ '--cols': 3 } as CSSProperties}>
            {REAL_CARDS.map((c) => (
              <button key={c.key} className={`start-card${realKey === c.key ? ' on' : ''}`} onClick={() => setRealKey(c.key)}>
                <b>{c.name}</b>
                <span>{c.date} · {c.team} · {c.role}{c.key === 'boaster-2023' ? '/指挥' : ''} · {c.age}岁</span>
              </button>
            ))}
          </div>
        )}
        {mode === '真人' && (
          <p className="tiny faint" style={{ marginTop: 8 }}>
            接管后为本局模拟；能力与合同使用游戏估算。起点前荣誉尚未完整收录，与本局分开统计。
          </p>
        )}
      </Panel>}

      {mode === '自创' && (
      <>
      <Panel title="从哪一年开始">
        {/* as many columns as there are years: two cards in the doors' three columns left a blank third (me.css --cols) */}
        <div className="start-grid" style={{ '--cols': ENTRY_YEARS.length } as CSSProperties}>
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
              {/* one word for how hard this door is (career.ts START_CN tag), in the tag colours the game
                  already uses: 挑战 warns, 轻松 is the easy one. What it means is in 帮助「开局怎么选」 */}
              <span className="start-head">
                <b>{starts[k].name}</b>
                <span className={`tag${k === 'pre' ? ' warn' : k === 't1' ? ' win' : ''}`}>{starts[k].tag}</span>
              </span>
              <span>{starts[k].blurb}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="你是谁">
        <AvatarEditor value={avatar} onChange={setAvatar} disabled={starting} onBusyChange={setAvatarBusy} />
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
              <div key={k} className="nc-origin-card" data-origin={o.key} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <button className={`origin-pick${originKey === k ? ' on' : ''}`} aria-pressed={originKey === k} onClick={() => setOriginKey(k)} style={{ width: '100%', flex: 1 }}>
                  {/* the card is the story; what it does to the numbers stays in
                      origins.ts — a wall of +5 · −6 · $1,500 is not a background */}
                  {/* named on the server 「来自」 queues on, the year it opens: 韩服高分路人王, 2021's China on 亚服 */}
                  <b>{originName(o, serverAt(region, year, 0))}</b>
                  <span>{o.blurb}</span>
                </button>
                <OriginDetails origin={o} nums={capNums} />
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title={`天赋 · 还剩 ${left} 点`} actions={<span className="tag">{capLine.tag}</span>}>
        <p className="tiny faint" style={{ marginTop: 0 }}>{capLine.hint}</p>
        <p className="tiny faint">首项是当前职位的20点参考构建，点击才会应用，之后可逐点微调。切换位置不会覆盖已有加点；旧的风格预设仍可选。</p>
        {/* a build to start from, then tuned point by point (破晓's 天赋预设) */}
        <div className="talent-presets">
          {presets.map((x) => (
            <button key={x.key} className={`start-card${presetOn === x.key ? ' on' : ''}`} aria-pressed={presetOn === x.key} onClick={() => setTalents({ ...x.t })}>
              <b>{x.name}{x.key === ROLE_TALENT_PRESETS[role].key ? ' · 本位置参考' : ''}</b>
              <span>{x.blurb}</span>
            </button>
          ))}
        </div>
        <div className="talent-tools">
          <button className="sm ghost" onClick={scatter}>一键随机分配</button>
          <button className="sm ghost" onClick={() => setTalents(zeroTalents())} disabled={used === 0}>清空</button>
        </div>
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
        {/* what this spread means, in the engine's own terms (career.ts talentShape) — 破晓's 「当前加点路线」 */}
        {shape && <p className="talent-verdict"><b>{shape.label}</b>{shape.line}</p>}
        {/* the three 综合 hardly counts, in what the engine does with them (career.ts TALENT_TEAM_HINT) */}
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>{TALENT_TEAM_HINT}</p>
      </Panel>

      </>
      )}

      <div className="row nc-go" style={{ gap: 10, justifyContent: 'flex-end' }}>
        {mode === '真人' && <span className="tiny faint">能力仅用开档前样本映射，Demon1 的入队前小样本按较低置信度处理，不预支后来赛果。到 2034 赛季结束最多 {2035 - REAL_CARDS.find(c => c.key === realKey)!.year} 个赛季；本局角色也可能提前退役。</span>}
        {save && confirmed && <span className="tiny faint">开始后覆盖上次的存档</span>}
        <button className="primary" onClick={go} onPointerEnter={onWarm} onFocus={onWarm} disabled={!!blocked || starting}>{starting ? '载入中…' : blocked || '开始生涯'}</button>
      </div>
    </div>
  )
}
