import { useGame } from './ctx'
import { Panel, fmtDay } from './common'

export default function LogScreen() {
  const { game } = useGame()
  const me = game.me!
  const rows = me.log.slice().reverse()
  return (
    <Panel title="生涯日志">
      <ul className="diary">
        {rows.map((l, i) => (
          <li key={i} className={l.kind}>
            <span className="when">{l.year} {fmtDay(l.day, l.year)}</span>
            <span dangerouslySetInnerHTML={{ __html: l.text.replace(/</g, '&lt;') }} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}
