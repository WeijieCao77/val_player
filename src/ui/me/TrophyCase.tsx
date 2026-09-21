import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { Modal, Panel } from './common'
import { TrophyChampions, TrophyLeague, TrophyMasters } from './art/fx'
import { careerTrophies, trophyNone, trophyPart, trophyProse, trophyTitleLine } from '../../engine/me/trophies'
import type { Trophy } from '../../engine/me/trophies'
import './trophy.css'
import './moment.css'

/**
 * 本局奖杯 — this career's trophy case, at the top of 成就.
 *
 * The author's brief of 2026-09-19: 「在成就栏目加一个当局的展示栏，专门放冠军详情，就是本局玩家拿的冠军，比如大师赛
 * 冠军，赛段冠军之类的。然后按照重要程度排好，还有有个点击按钮可以点进去查看当时夺冠的情况以及配一段文字描述」.
 *
 * One card a trophy, in the game's own order (engine/me/trophies.ts: 冠军赛 > 大师赛 / LOCK//IN > 赛区冠军, one I
 * started in above one I watched, then the earlier year — the career-end card's wall ranks the same way). The look is
 * the 转播红 the big moments and the history ledger wear (moment.css, worldline.css).
 *
 * Pressing a card opens the ordinary card in front of the page (common.tsx Modal, ui/me/layer.ts): when and where,
 * how the last match went, my part in it, the run itself, what history says about the trophy, and a passage about
 * that night. Everything on it is read off the save and nothing is filled in — an old trophy whose year has dropped
 * out of the detail window says less, in fewer blocks, rather than saying something that is not on the record.
 */

const ICON = { champions: <TrophyChampions />, masters: <TrophyMasters />, league: <TrophyLeague /> }

/** 「2026年3月8日」: the day of the year the save keeps, on the in-fiction calendar (engine/calendar.ts dateLabel). */
function dayLabel(year: number, day: number): string {
  const d = new Date(Date.UTC(year, 0, 1))
  d.setUTCDate(d.getUTCDate() + day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

export default function TrophyCase() {
  const { game } = useGame()
  const me = game.me!
  const list = useMemo(() => careerTrophies(game), [game])
  const [open, setOpen] = useState<string | null>(null)
  const shown = list.find((t) => t.key === open)
  return (
    <Panel title={list.length ? `本局奖杯 · ${list.length} 座` : '本局奖杯'}>
      {!list.length ? (
        // 一冠未得 is a career, not a missing value: one plain line, the way the career-end card puts it
        <p className="trc-none">{trophyNone(me)}</p>
      ) : (
        <>
          <p className="trc-tag">按分量排</p>
          <div className="trc-list">
            {list.map((t) => (
              <button key={t.key} className={`trc${t.started ? '' : ' ring'}`} onClick={() => setOpen(t.key)}>
                <span className="trc-ic">{ICON[t.tier]}</span>
                <span className="trc-txt">
                  <span className="trc-n">{trophyTitleLine(t)}</span>
                  <span className="trc-m">{[t.club, t.stage].filter(Boolean).join(' · ') || '生涯记录只剩下这座奖杯'}</span>
                  <span className="trc-p">{trophyPart(t)}</span>
                  {t.fmvp === true && <span className="trc-p">★ 决赛 MVP（FMVP）</span>}
                </span>
                <span className="trc-go" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </>
      )}
      {shown && <TrophyDetail t={shown} onClose={() => setOpen(null)} />}
    </Panel>
  )
}

function TrophyDetail({ t, onClose }: { t: Trophy; onClose: () => void }) {
  const f = t.final
  const s = t.season
  return (
    <Modal title="奖杯" onClose={onClose} onBgClose={onClose}>
      <h3 className="trd-head">{trophyTitleLine(t)}</h3>
      {t.fmvp === true ? <p><b>★ 决赛 MVP（FMVP）是你 · 已记入永久生涯荣誉</b></p>
        : t.started && t.fmvp === undefined ? <p className="tiny muted">决赛 MVP 记录不足，未计入已确认数量。</p> : null}
      <p className="trd-when">
        {t.end != null ? dayLabel(t.year, t.end) : `${t.year} 赛季`}
        {t.stage ? ` · ${t.stage}` : ''}{t.city ? ` · ${t.city}` : ''}
        {t.club ? ` · ${t.club}` : ''}
      </p>

      {/* 在哪拿的 — only what the save still knows; a club it cannot pin to one club says so */}
      {!t.club && (
        <div className="trd-sec">
          <h4>俱乐部</h4>
          <p>{t.clubs.length > 1
            ? `那一年你在 ${t.clubs.join('、')} 都效力过，生涯记录没有写明这座奖杯是在哪一家拿的。`
            : '生涯记录没有留下这座奖杯是在哪家俱乐部拿的。'}</p>
        </div>
      )}

      {/* 怎么结束的 — my own record of the last match of it */}
      {f && (
        <div className="trd-sec">
          <h4>怎么结束的</h4>
          <p><b>{f.label}</b> {f.score} {f.won ? '胜' : '负'} {f.opp}</p>
          {f.maps.length > 0 && <p>地图：{f.maps.join('、')}</p>}
          {t.runnerUp && t.runnerUp !== f.opp && <p>亚军：{t.runnerUp}</p>}
        </div>
      )}
      {!f && t.runnerUp && (
        <div className="trd-sec"><h4>怎么结束的</h4><p>亚军：{t.runnerUp}</p></div>
      )}

      {/* 你的那一份 */}
      <div className="trd-sec">
        <h4>你的那一份</h4>
        <p>{trophyPart(t)}{t.matches.length
          ? t.starts
            ? ` · 这一届首发 ${t.starts} 场，共 ${t.matches.length} 场在名单上`
            : ` · 这一届 ${t.matches.length} 场都在名单上，一场没有首发`
          : ''}</p>
        {f?.line && (
          <>
            <div className="trd-line">
              <span>K/D/A<b>{f.line.k}/{f.line.d}/{f.line.a}</b></span>
              <span>ACS<b>{f.line.acs}</b></span>
              <span>评分<b>{f.line.rating.toFixed(2)}</b></span>
              <span>队内<b>第 {f.line.rank}</b></span>
            </div>
            {/* the last match of the event is the one it was lifted in — the game reads it the same way
                (me/bottleneck.ts finalMvp), and it is named as the fixture named it */}
            {f.line.mvp && <p><b>{f.label} MVP 是你。</b></p>}
          </>
        )}
        {t.run && <p>{t.run.line}</p>}
        {s && <p>{s.year} 赛季 · {s.team} · 出场 {s.starts}/{s.matches} · 综合 {s.overallFrom} → {s.overallTo}</p>}
        {t.ladderFirst && <p>天梯：那一年你第一次打到{t.ladderFirst}。</p>}
      </div>

      {/* 夺冠之路 — the matches of the event my own record still holds */}
      {t.matches.length > 0 && (
        <div className="trd-sec">
          <h4>夺冠之路</h4>
          <div className="trd-run">
            {t.matches.map((m, i) => (
              <div key={i} className={`trd-m${i === t.matches.length - 1 ? ' last' : ''}`}>
                <span className="lab">{m.label}</span>
                <span className={`sc ${m.won ? 'w' : 'l'}`}>{m.score}</span>
                <span>{m.opp}</span>
                {m.line
                  ? <span className="me">{m.line.k}/{m.line.d}/{m.line.a} · ACS {m.line.acs} · 评分 {m.line.rating.toFixed(2)}</span>
                  : <span>没有上场</span>}
                {m.highlights.slice(0, 2).map((h, j) => <span key={j} className="hi">{h}</span>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 你的世界线 — the one line the game already writes about a trophy history gave elsewhere (me/worldline.ts) */}
      {t.realChamp && <p className="mo-real">真实历史里，这座奖杯属于 <b>{t.realChamp}</b></p>}
      {!t.realChamp && t.rewrite && t.rewrite.lines.length > 0 && (
        <div className="trd-sec">
          <h4>你的世界线</h4>
          {t.rewrite.lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}

      {/* 那一晚 — built out of the facts above and nothing else (me/trophies.ts trophyProse) */}
      <p className="trc-tag">那一晚</p>
      <div className="trd-prose">
        {trophyProse(t).map((l, i) => <p key={i}>{l}</p>)}
      </div>

      <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
        <button className="primary" onClick={onClose}>收起</button>
      </div>
    </Modal>
  )
}
