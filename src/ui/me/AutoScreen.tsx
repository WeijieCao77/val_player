import { useGame } from '../ctx'
import { Panel } from '../common'

const DIALS: { key: 'buy' | 'biz' | 'daily' | 'career'; name: string; what: string; rules: string[] }[] = [
  { key: 'buy', name: '采购', what: '外设、课程、理疗', rules: ['先留 $3,000 的安全余额', '疲劳 ≥70 先买理疗', '外设换到职业级为止，旗舰不碰', '心态低于 50 报运动心理课；在外赛区报语言课'] },
  { key: 'biz', name: '商务', what: '直播独家、杯赛报名', rules: ['粉丝离天花板还远（<60%）不签独家，签了也只签俱乐部的合作平台，永远不签来抢人的那家', '杯赛：钱够、够资格就报，路人队友随机'] },
  { key: 'daily', name: '日常', what: '随机事件、特质通知', rules: ['每条事件按推荐项选；推荐项要花钱而余额不够，退到第一个不花钱的'] },
  { key: 'career', name: '生涯', what: '试训邀请、合同、转会、续约', rules: ['离对方要求 6 分以内就去试训，太远回绝', '试训每天选稳妥的', '第一份合同直接签，不还价', '转会：对方实力高 4 分以上，或你坐板凳而对方给首发，就接；从 Challengers 去 VCT 一定接', '续约一律接'] },
]

/** Four dials and a master switch. Every rule is written down here; nothing it does is a black box. */
export default function AutoScreen() {
  const { game, commit } = useGame()
  const me = game.me!
  const all = DIALS.every((d) => me.auto[d.key])
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
      <div>
        <Panel title="托管" actions={<button className={`sm${all ? ' primary' : ''}`} onClick={() => { for (const d of DIALS) me.auto[d.key] = !all; commit() }}>{all ? '全部关掉' : '一键全开'}</button>}>
          <p className="small" style={{ marginTop: 0 }}>把重复的事交出去。不收费；代价是它永远走稳健路线——精简版能打出不错的结果，完整版才有上限。</p>
          {DIALS.map((d) => (
            <div key={d.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <label className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={me.auto[d.key]} onChange={(e) => { me.auto[d.key] = e.target.checked; commit() }} />
                <b>{d.name}</b><span className="muted small">{d.what}</span>
                {d.key === 'career' && <span className="tag warn">这是主线，交出去等于看别人打</span>}
              </label>
              <ul className="tiny faint" style={{ margin: '4px 0 0 26px', paddingLeft: 14 }}>
                {d.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          ))}
          <p className="tiny faint" style={{ marginBottom: 0 }}>它不碰的东西：行动点怎么花、比赛里的决定、对位挑战。「按推荐安排」是另一个按钮，只管本周的行动点。</p>
        </Panel>
      </div>
      <Panel title="托管替你做过的事">
        {me.autoNotes.length === 0 ? <p className="muted small" style={{ margin: 0 }}>还没有。</p> : (
          <ul className="diary">{me.autoNotes.slice().reverse().slice(0, 30).map((n, i) => <li key={i}><span>{n}</span></li>)}</ul>
        )}
      </Panel>
    </div>
  )
}
