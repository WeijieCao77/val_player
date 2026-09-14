import { useRef } from 'react'
import { useGame } from './ctx'
import { ACH_ROUTES, rewardText, unseenAch, type AchDef, type AchRoute } from '../../engine/me/achievements'
import { peekCareerId, readHall } from '../../engine/me/hall'
import type { GameState } from '../../engine/types'
import Moment, { type MomentChip } from './Moment'
import { RouteGlyph } from './art/glyphs'

/**
 * The moment an achievement unlocks, full screen (asked 2026-09-14: 「成就弹窗不好看而且太小了，
 * 完全不是完成了一件大事情的感觉」). One card an unlock, as 破晓 queues them; a run that
 * unlocked more than SINGLE shows the first ones on their own and the rest on one list.
 *
 * It reads the save's own place (achState.seen, known keys only — unseenAch), so a run of
 * weeks shows everything unlocked on the way, once. PlayerGame holds the cards the clock
 * stopped on until these are taken, and the tour waits too.
 */

/** unlocks in one go that each get their own card; the rest share one (decided 2026-09-14) */
const SINGLE = 3

const ROUTE_CN = Object.fromEntries(ACH_ROUTES.map((r) => [r.key, r.name])) as Record<AchRoute, string>

/** Whether the hall has this one from another career already, as 破晓's card says 殿堂首次 / 殿堂里已有 (me/hall.ts). */
function hallMark(state: GameState, key: string): string {
  try {
    const r = readHall()?.ach[key]
    if (!r) return ''
    return r.first.id === peekCareerId(state) ? '殿堂首次' : '殿堂里已有'
  } catch {
    return ''
  }
}

const chipsOf = (a: AchDef): MomentChip[] =>
  rewardText(a.reward).split(' · ').filter(Boolean).map((text) => ({ text, kind: text.startsWith('称号') ? 'gold' : 'up' }))

export default function AchPop() {
  const { game, commit, go } = useGame()
  // how many were waiting when this run of cards began: it only grows while the run lasts
  const run = useRef(0)
  const me = game.me
  const fresh = me ? unseenAch(me) : []
  if (!me || !me.achState || !fresh.length) {
    run.current = 0
    return null
  }
  const book = me.achState
  run.current = Math.max(run.current, fresh.length)
  const shown = run.current - fresh.length

  const seeAll = () => { book.seen = me.achievements.length; commit() }
  const toPage = () => { seeAll(); go('awards') }

  if (run.current > SINGLE && shown >= SINGLE) {
    return (
      <Moment
        art={<RouteGlyph route={fresh[0].route} />}
        eyebrow="成就解锁"
        title={`还有 ${fresh.length} 项`}
        body="这一趟解锁得多，剩下的放在一起。奖励都已经发了。"
        primary={{ label: '全部收下', onClick: seeAll }}
        secondary={{ label: '去成就页', onClick: toPage }}
      >
        <ul className="mo-list">
          {fresh.map((a) => (
            <li key={a.key}>
              <RouteGlyph route={a.route} />
              <span><b>{a.name}</b><small>{a.desc}</small></span>
              {a.reward && <em>{rewardText(a.reward)}</em>}
            </li>
          ))}
        </ul>
      </Moment>
    )
  }

  const a = fresh[0]
  const more = fresh.length - 1
  // past the one on screen, as far as the save's place: a key it no longer knows is stepped over with it
  const seeOne = () => {
    const at = me.achievements.indexOf(a.key, book.seen)
    book.seen = at >= 0 ? at + 1 : me.achievements.length
    commit()
  }
  return (
    <Moment
      tone={a.secret ? 'gold' : 'accent'}
      art={<RouteGlyph route={a.route} />}
      eyebrow={[a.secret ? '隐藏成就' : '成就解锁', ROUTE_CN[a.route], hallMark(game, a.key)].filter(Boolean).join(' · ')}
      title={a.name}
      body={a.desc}
      chips={chipsOf(a)}
      primary={{ label: more ? '下一个 →' : '收下', onClick: seeOne }}
      secondary={{ label: '去成就页', onClick: toPage }}
      next={more ? `还有 ${more} 项` : undefined}
    />
  )
}
