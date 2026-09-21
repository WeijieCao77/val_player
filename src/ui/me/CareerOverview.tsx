import { useState } from 'react'
import { useGame } from './ctx'
import { Panel, Stat } from './common'
import { compCn } from '../../engine/me/compname'
import { careerOverview } from './careerOverviewRead'

export default function CareerOverview() {
  const { game, go } = useGame()
  const [scope, setScope] = useState<'season' | 'career'>('career')
  const view = careerOverview(game, scope)
  return (
    <section className="career-overview" aria-label="实时生涯总览">
      <Panel title="实时生涯" actions={<button className="sm" onClick={() => document.getElementById('my-abilities')?.scrollIntoView({ block: 'start' })}>查看能力 ↓</button>}>
        <div className="career-overview-tabs" role="group" aria-label="数据统计范围">
          <button className={scope === 'career' ? 'active' : ''} aria-pressed={scope === 'career'} onClick={() => setScope('career')}>生涯累计</button>
          <button className={scope === 'season' ? 'active' : ''} aria-pressed={scope === 'season'} onClick={() => setScope('season')}>{game.year} 当季</button>
        </div>
        <p className="career-overview-note">比赛结算后更新，不用等年底。当前显示：{scope === 'career' ? '整个生涯' : `${game.year} 赛季`}。</p>
        <div className="career-overview-stats" aria-label={scope === 'career' ? '生涯累计数据' : '当季数据'}>
          <Stat k="出场地图" v={view.maps} />
          <Stat k="正式赛出场" v={`${view.starts} 场`} />
          <Stat k="贡献评分" v={view.rating} />
          <Stat k="ACS" v={view.acs} />
          <Stat k="K/D" v={view.kd} />
          <Stat k="击杀 / 死亡 / 助攻" v={view.kda} small />
          <Stat k="出场胜率" v={view.winRate} />
          <Stat k="比赛 MVP（整场）" v={view.mvps} />
          <Stat k="决赛 MVP（FMVP）" v={view.fmvps.confirmed} />
        </div>
        <p className="career-overview-note">首杀差 {view.firstKillDiff} · 正式赛出场获胜 {view.wins} 场</p>
        {!!view.fmvps.unknown && <p className="career-overview-note">另有 {view.fmvps.unknown} 座奖杯未留存足够的决赛 MVP 记录，未计入已确认数量。</p>}
        {!view.hasMaps && <p className="career-overview-empty">{scope === 'career' ? '还没有正式赛出场数据。' : '本赛季尚无正式赛出场数据。'}替补未上场不会产生个人地图数据。</p>}
        {view.zeroDeaths && <p className="career-overview-note">目前死亡数为 0，K/D 暂不计算；击杀与助攻照常记录。</p>}
        <details className="career-overview-rules">
          <summary>统计口径</summary>
          <p>只读本人已结算的职业正式赛记录，不计训练赛、业余杯赛与表演赛。地图数按实际出场地图累计，场数按整场比赛；出场胜率为出场获胜场数 ÷ 正式赛出场场数。</p>
          <p>比赛 MVP 每场记一次，不是把 BO3 / BO5 各图的 MVP 相加。生涯累计不会随最近一年比赛明细清理而减少；没有比赛或分母为 0 时显示“—”。</p>
          <p>FMVP 指本游戏中夺冠总决赛的整场 MVP，不是整届赛事 MVP；只统计有证据确认的本人奖项，不把半决赛、胜败者组决赛或无决赛赛事的最后一场算进去。</p>
          <p>累计贡献评分按已有击杀、助攻、死亡、首杀差和残局计算，ACS 仍表示伤害表现。已结算的历史比赛评分和奖项保留原样；旧档缺失的数据不补造。</p>
        </details>
        <div className="career-current-honors" aria-label="当季荣誉">
          <h3>{game.year} 当季荣誉</h3>
          {view.currentTitles.length ? (
            <>
              <p className="career-overview-note">有出场夺冠 {view.playedTitles} 座 · 未出场随队 {view.benchTitles} 座</p>
              <ul>{view.currentTitles.map((t, i) => <li key={`${t.title}:${i}`}><span>{compCn(t.title)}</span><span className={`tag${t.started ? ' win' : ''}`}>{t.started ? '赛事中有出场' : '未出场 · 随队'}</span></li>)}</ul>
            </>
          ) : <p className="career-overview-empty">本赛季还没有冠军记录。奖杯入账后显示在这里，无需等待赛季结算。</p>}
          <p className="career-overview-note">只列本人生涯已记下的冠军。未出场随队荣誉单列，不算个人出场夺冠；资格赛出线不是冠军。</p>
          <button className="sm" onClick={() => go('awards')}>查看全部奖杯与成就 →</button>
        </div>
      </Panel>
    </section>
  )
}
