import { useGame } from './ctx'
import { useNumbers } from './words'
import { nextCardDue, setNextHidden, useNextHidden } from './guide'
import { NEAR_CN, farLine, goalOf, roadsOf, weekLine } from '../../engine/me/goal'
import type { Line } from '../../engine/me/goal'
import './guide.css'

/** `pre` <b>`b`</b> `post`, as the week board's own recommendation line reads */
export const LineText = ({ line }: { line: Line }) => <>{line.pre}{line.b && <b>{line.b}</b>}{line.post}</>

/**
 * 下一步: the goal of this stretch of the career, the one thing this week is best spent on, and how
 * far off each road to it is — in words, the figures on the 数值 switch. The first thing on the week
 * page, the whole time without a club and through a professional career's first season (guide.ts
 * nextCardDue); 「收起」 puts it away for the phase, 帮助 brings it back.
 *
 * What it says is read off the rules the week will run (engine/me/goal.ts); nothing on it is new.
 */
export default function NextStep() {
  const { game, go } = useGame()
  const [nums] = useNumbers()
  const goal = goalOf(game)
  // subscribes to 收起 and 帮助's 恢复, so the card goes and comes back without a week passing
  useNextHidden(goal?.phase ?? 'pre')
  if (!goal || !nextCardDue(game)) return null
  const line = weekLine(game)
  const roads = goal.phase === 'pre' ? roadsOf(game) : []
  // at a club, where I stand with the coach is the distance: the team screen's own sentence
  const far = farLine(game)
  return (
    <section className="next-step" aria-labelledby="ns-goal">
      <div className="ns-head">
        <span className="ns-eyebrow">下一步</span>
        <h2 id="ns-goal" className="ns-goal">{goal.title}</h2>
        <button
          className="sm ghost ns-hide" onClick={() => setNextHidden(goal.phase, true)}
          title={goal.phase === 'pre' ? '签约以前不再显示；「帮助」里能恢复' : '这一段不再显示；「帮助」里能恢复'}
        >
          收起
        </button>
      </div>
      {line && <p className="ns-week"><span className="ns-k">这周</span><span><LineText line={line} /></span></p>}
      {far && <p className="ns-far">{far}</p>}
      {roads.length > 0 && (
        <ul className="ns-roads" aria-label="离合同还有多远">
          {roads.map((r) => (
            <li key={r.key} className={`near-${r.near}`}>
              <span className="ns-k" title={NEAR_CN[r.near]}>{r.label}<i aria-hidden="true" /></span>
              <span>
                {r.text}{nums && r.nums ? <span className="ns-num">（{r.nums}）</span> : null}
                {r.go && <button className="ns-go" onClick={() => go(r.go!.screen)}>{r.go.label} →</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
