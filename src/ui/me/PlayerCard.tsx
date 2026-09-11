import { natName } from '../../engine/nat'
import { AgentIcon, Bar, Modal, OvrBadge, Radar, Roles, Traits, money } from './common'
import { useGame } from './ctx'
import { callerOf } from '../../engine/roster'
import { ratingOf } from '../../engine/match'
import { statLine } from '../../engine/player'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import type { Stats } from '../../engine/types'
import { agentCn } from '../../engine/content'
import { StarTitleTag } from './Rivals'
import Face from './Face'

/**
 * Another player's card, as a player sees it: who he is and where he plays,
 * his eight, his season and his career, and what he is paid for how long.
 *
 * The career's own copy of the manager game's player modal (作者 2026-09-11),
 * with nothing that was the manager's to read or do: no scouted potential, no
 * diagnosis, no retirement talk, no market value, asking price, loyalty or
 * contract clauses, no renewal, listing or appointing a caller, and no vlr
 * source line. A rival's title and the faces stay.
 */
export default function PlayerCard({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { game } = useGame()
  const p = game.players[playerId]
  if (!p) return null
  const team = p.teamId ? game.teams[p.teamId] : null
  // the club's named caller, and the IGLs by trade who back him up
  const teamCaller = p.teamId ? callerOf(game, p.teamId) : undefined
  const isMain = p.isIgl && teamCaller?.id === p.id
  const isDeputy = p.isIgl && !!teamCaller && teamCaller.id !== p.id

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <span>{p.ign}</span>
          <Roles p={p} />
          <OvrBadge value={p.overall} />
          <StarTitleTag id={p.id} />
          {p.isIgl && (
            <span className="tag" title={p.iglSource === 'inferred' ? '真实指挥尚未确认，由系统临时代行'
              : isMain ? '主指挥：在场上就由他喊话' : isDeputy ? '副指挥：主指挥不在场上时由他喊话' : '已确认的队内指挥'}>
              {p.iglSource === 'inferred' ? '推定 IGL' : isMain ? '主指挥' : isDeputy ? '副指挥' : 'IGL'}
            </span>
          )}
        </span>
      }
      onClose={onClose}
    >
      <div className="grid c2" style={{ marginBottom: 14 }}>
        <div>
          <div className="row" style={{ gap: 10, marginBottom: 8 }}>
            <Face id={p.id} name={p.ign} size={56} />
            {(p.realName || p.nat) && (
              <div className="small muted">
                {p.realName}
                {p.realName && p.nat ? ' · ' : ''}
                {p.nat ? natName(p.nat) : ''}
              </div>
            )}
          </div>
          <div className="row wrap" style={{ gap: 7, marginBottom: 12 }}>
            <span className="tag">{team?.name ?? '自由人'}</span>
            <span className="tag">{REGION_CN[p.region]}</span>
            <span className="tag" title={p.birth ? `生日 ${p.birth}` : '未收录生日，年龄为推算值'}>
              {p.age} 岁{p.ageEstimated ? '（推算）' : ''}
            </span>
            {/* a career names no diagnosis for a real person's body: the lay-off, nothing more */}
            {p.injuredUntil > game.day && <span className="tag warn">⚕ 伤停</span>}
            {p.retiring && <span className="tag warn">📢 本赛季后退役</span>}
          </div>
          {p.traits?.length ? (
            <div style={{ marginBottom: 12 }}>
              <Traits traits={p.traits} />
            </div>
          ) : null}

          {ATTR_KEYS.map((k) => (
            <div key={k} className="row" style={{ gap: 10, marginBottom: 5 }}>
              <span className="small muted" style={{ width: 34 }}>{ATTR_CN[k]}</span>
              <Bar
                value={p.attrs[k]}
                color={p.attrs[k] >= 85 ? 'var(--accent)' : p.attrs[k] >= 72 ? 'var(--warn)' : 'var(--loss)'}
              />
              <span className="mono small" style={{ width: 22, textAlign: 'right' }}>{p.attrs[k]}</span>
            </div>
          ))}

          <div className="grid c3" style={{ marginTop: 14, gap: 10 }}>
            <Meter label="状态" v={p.form} />
            <Meter label="士气" v={p.morale} />
            <Meter label="体能" v={100 - p.fatigue} />
          </div>
        </div>

        <div className="radar-wrap" style={{ flexDirection: 'column', gap: 10 }}>
          <Radar
            values={ATTR_KEYS.map((k) => p.attrs[k])}
            labels={ATTR_KEYS.map((k) => ATTR_CN[k])}
            size={236}
          />
          {p.agentPool.length > 0 && (
            <div className="row wrap tiny muted" style={{ gap: 6, justifyContent: 'center', alignItems: 'center' }}>
              <span>常用特工：</span>
              {p.agentPool.map((a) => (
                <span key={a} className="row" style={{ gap: 3, alignItems: 'center' }}>
                  <AgentIcon name={a} size={18} />{agentCn(a)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid c2">
        <StatBlock title="本赛季" s={p.season} />
        <StatBlock title="生涯" s={p.career} />
      </div>

      <div className="panel">
        <div className="panel-head"><h2>合同</h2></div>
        <div className="panel-body">
          <div className="grid c4" style={{ gap: 12 }}>
            <div className="stat"><span className="k">年薪</span><span className="v sm">{money(p.salary)}</span></div>
            <div className="stat">
              <span className="k">剩余年限</span>
              <span className="v sm">{p.contractYears > 0 ? `${p.contractYears} 年` : '已到期'}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tiny muted">{label}</span>
        <span className="tiny mono">{Math.round(v)}</span>
      </div>
      <Bar value={v} />
    </div>
  )
}

function StatBlock({ title, s }: { title: string; s: Stats }) {
  const l = statLine(s)
  if (!s.maps) {
    return (
      <div className="panel">
        <div className="panel-head"><h2>{title}</h2></div>
        <div className="empty">暂无出场记录。</div>
      </div>
    )
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="panel-body">
        <div className="grid c4" style={{ gap: 10 }}>
          <div className="stat"><span className="k">评分</span><span className="v sm">{ratingOf(s).toFixed(2)}</span></div>
          <div className="stat"><span className="k">ACS</span><span className="v sm">{l.acs.toFixed(0)}</span></div>
          <div className="stat"><span className="k">K/D</span><span className="v sm">{l.kd.toFixed(2)}</span></div>
          <div className="stat"><span className="k">ADR</span><span className="v sm">{l.adr.toFixed(0)}</span></div>
        </div>
        <div className="row wrap tiny muted" style={{ gap: 12, marginTop: 12 }}>
          <span>场次 {s.maps}</span>
          <span>击杀 {s.kills}</span>
          <span>死亡 {s.deaths}</span>
          <span>助攻 {s.assists}</span>
          <span>首杀差 {s.firstKills - s.firstDeaths > 0 ? '+' : ''}{s.firstKills - s.firstDeaths}</span>
          <span>残局 {s.clutches}</span>
          <span>MVP {s.mvps}</span>
        </div>
      </div>
    </div>
  )
}
