import { useMemo, useState } from 'react'
import { ATTR_CN, ATTR_KEYS, REGION_CN, REGIONS } from '../../engine/types'
import type { Attrs, GameState, Region, Role } from '../../engine/types'
import { recomputeOverall } from '../../engine/player'
import { buildAttrs, candidateClubs, createCareer, emptyTalents, START_CN, TALENT_MAX, TALENT_POINTS } from '../../engine/me/career'
import type { StartPoint } from '../../engine/me/career'
import { ORIGINS } from '../../engine/me/origins'
import { Crest, Panel } from '../common'

const ROLES_PICK: Role[] = ['决斗者', '先锋', '控场', '哨卫']

export default function NewCareer({
  onStart, canContinue, onContinue,
}: { onStart: (g: GameState) => void; canContinue: boolean; onContinue: () => void }) {
  const [name, setName] = useState('')
  const [region, setRegion] = useState<Region>('China')
  const [role, setRole] = useState<Role>('决斗者')
  const [start, setStart] = useState<StartPoint>('pre')
  const [originKey, setOriginKey] = useState('netcafe')
  const [teamId, setTeamId] = useState('')
  const [talents, setTalents] = useState(emptyTalents())
  const used = ATTR_KEYS.reduce((s, k) => s + talents[k], 0)
  const left = TALENT_POINTS - used
  const clubs = useMemo(() => (start === 'pre' ? [] : candidateClubs(region, start === 't1' ? 1 : 2)), [region, start])
  const ovr = useMemo(() => recomputeOverall({ role, attrs: buildAttrs(role, talents, originKey), stageBonus: 0 } as never), [role, talents, originKey])
  const origin = ORIGINS.find((o) => o.key === originKey)!

  const bump = (k: keyof Attrs, d: 1 | -1) => {
    const v = talents[k] + d
    if (v < 0 || v > TALENT_MAX) return
    if (d > 0 && left <= 0) return
    setTalents({ ...talents, [k]: v })
  }
  const go = () => {
    const ign = name.trim() || 'Rookie'
    onStart(createCareer({ name: ign, region, role, talents, originKey, start, teamId: teamId || undefined }))
  }

  return (
    <div className="newcareer">
      <h1>无畏契约 · 选手生涯 <span className="tag t1">demo</span></h1>
      <p className="muted" style={{ marginTop: 0 }}>
        世界里的每一支队、每一个人都是真实的 VCT 选手。你是一个虚构的新人——从哪里开始，由你定。
      </p>
      {canContinue && <p><button className="primary" onClick={onContinue}>继续上次的生涯</button></p>}

      <Panel title="从哪里开始">
        <div className="start-grid">
          {(Object.keys(START_CN) as StartPoint[]).map((k) => (
            <button key={k} className={`start-card${start === k ? ' on' : ''}`} onClick={() => { setStart(k); setTeamId('') }}>
              <b>{START_CN[k].name}</b>
              <span>{START_CN[k].blurb}</span>
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
            <span className="muted">赛区</span>
            <div className="seg">
              {REGIONS.map((r) => <button key={r} className={region === r ? 'on' : ''} onClick={() => { setRegion(r); setTeamId('') }}>{REGION_CN[r]}</button>)}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted">位置</span>
            <div className="seg">
              {ROLES_PICK.map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r}</button>)}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="出身" actions={<span className="tiny faint">刻意不等值，差的是形状</span>}>
        <div className="origin-grid">
          {ORIGINS.map((o) => (
            <button key={o.key} className={`origin-pick${originKey === o.key ? ' on' : ''}`} onClick={() => setOriginKey(o.key)}>
              {/* the card is the story; what it does to the numbers stays in
                  origins.ts — a wall of +5 · −6 · $1,500 is not a background */}
              <b>{o.name}</b>
              <span>{o.blurb}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={`天赋 · 还剩 ${left} 点`} actions={<span className="tag">起始综合约 {ovr}，上限约 {ovr + (origin.flags?.late ? 12 : 16)}</span>}>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          每点 +3。一级联赛首发的中位数是 80，Challengers 首发约 66——差距要在天梯、杯赛、训练赛里补。
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
        <Panel title="签哪家" actions={<span className="tiny faint">不选就随机，弱队更愿意赌新人</span>}>
          <div className="club-list">
            {clubs.map((c) => (
              <button key={c.id} className={teamId === c.id ? 'on' : ''} onClick={() => setTeamId(teamId === c.id ? '' : c.id)}>
                <Crest id={c.id} size={22} /><span>{c.tag}</span><span className="r">实力 {c.rating} · {c.roster} 人</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={go} disabled={left !== 0} title={left !== 0 ? '把天赋点分完' : ''}>开始生涯</button>
      </div>
    </div>
  )
}
