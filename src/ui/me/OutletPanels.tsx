import type { ReactNode } from 'react'
import { useGame } from './ctx'
import { Panel, money, moneyFull } from './common'
import {
  BREAKS, CAFE_PRICE, FAMILY_TIERS, MEETS, STUDIO,
  breakLocked, breakPrice, buyStudio, cafeLocked, familyLocked, familyWeekly, fundScholar, holdMeet,
  meetLocked, openCafe, readOut, scholarLocked, scholarPrice, setFamily, studioLocked, takeBreak,
} from '../../engine/me/outlets'

/** Four columns on a phone: thousands as $12K, a smaller price to the dollar. */
const price = (x: number): string => (x >= 10_000 ? money(x) : moneyFull(x))
/** a button's label wraps inside a narrow card instead of pushing the page sideways, as .shop-row's do */
const wrapBtn = { whiteSpace: 'normal', textAlign: 'left' } as const

/**
 * One reason under a row of buttons: said once when every button is locked for
 * the same reason, otherwise each locked button's own. The reasons a row
 * already shows as its state (done this year, the tier I am on) are left out.
 */
function lockLine(items: { name: string; why: string | null }[], shown: string[] = []): string | null {
  const locked = items.filter((x) => x.why && !shown.includes(x.why))
  if (!locked.length) return null
  if (locked.length === items.length && locked.every((x) => x.why === locked[0].why)) return locked[0].why
  return locked.map((x) => `${x.name}：${x.why}`).join(' · ')
}

function Outlet({ name, note, lock, first, children }: { name: string; note: ReactNode; lock?: string | null; first?: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: '6px 0', borderTop: first ? undefined : '1px solid var(--line-soft)' }}>
      <div className="row wrap" style={{ gap: '2px 10px', alignItems: 'baseline' }}>
        <b className="small" style={{ minWidth: 72 }}>{name}</b>
        <span className="tiny muted" style={{ flex: '1 1 12em', minWidth: 0 }}>{note}</span>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>{children}</div>
      {lock && <p className="tiny faint" style={{ margin: '4px 0 0' }}>{lock}</p>}
    </div>
  )
}

/**
 * 钱的出口，第二批 (engine/me/outlets.ts): three things a year, and what goes
 * home every week or stays bought. Every button is on screen whether it can be
 * pressed or not, with the reason under it.
 */
export default function OutletPanels() {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const o = readOut(me)
  const act = (why: string | null) => { if (why) toast(why); commit() }
  const year = game.year

  const meet = o.meets.find((m) => m.year === year)
  const meetName = MEETS.find((m) => m.key === meet?.key)?.name
  const brk = o.breaks.find((b) => b.year === year)
  const brkName = BREAKS.find((b) => b.key === brk?.key)?.name
  const scholarWhy = scholarLocked(game)
  const studioWhy = studioLocked(game)
  const nextStudio = STUDIO[o.studio + 1]
  const cafeWhy = cafeLocked(game)
  const cafe = o.cafe

  return (
    <>
      <Panel title="一年一次" actions={<span className="tag">{year} 年</span>}>
        <Outlet
          first
          name="粉丝见面会"
          note={meet ? `今年：${meetName} · ${meet.ok ? '办成了' : '办砸了'}` : '自己掏钱办，热度和粉丝涨一截。体力 30 以下上台，一半会办砸。'}
          lock={lockLine(MEETS.map((m) => ({ name: m.name, why: meetLocked(game, m) })), ['今年办过了'])}
        >
          {MEETS.map((m) => {
            const why = meetLocked(game, m)
            return <button key={m.key} className="sm" style={wrapBtn} disabled={!!why} title={why ?? m.blurb} onClick={() => act(holdMeet(game, m.key))}>{m.name} {price(m.price)}</button>
          })}
        </Outlet>
        <Outlet
          name="青训奖学金"
          note={`替打得好、家里供不起的孩子付一年训练营和路费。${o.scholar.includes(year) ? '今年资助过了。' : ''}${o.scholar.length ? `一共 ${o.scholar.length} 年。` : ''}`}
          lock={scholarWhy === '今年资助过了' ? null : scholarWhy}
        >
          <button className="sm" style={wrapBtn} disabled={!!scholarWhy} onClick={() => act(fundScholar(game))}>资助 {price(scholarPrice(game))}</button>
        </Outlet>
        <Outlet
          name="休赛期"
          note={brk ? `今年：${brkName}` : '冠军赛开打以后、队里两周内没比赛时放一次假。'}
          lock={lockLine(BREAKS.map((b) => ({ name: b.name, why: breakLocked(game, b) })), ['今年的假已经放过了'])}
        >
          {BREAKS.map((b) => {
            const why = breakLocked(game, b)
            const cost = breakPrice(game, b)
            return <button key={b.key} className="sm" style={wrapBtn} disabled={!!why} title={why ?? b.blurb} onClick={() => act(takeBreak(game, b.key))}>{b.name} {cost ? price(cost) : '免费'}</button>
          })}
        </Outlet>
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>都不改变能力和比赛。办过的事，退役时写进你的结局。</p>
      </Panel>
      <Panel title="家用与置办">
        <Outlet
          first
          name="往家里寄钱"
          note={`现在：${FAMILY_TIERS[o.family]?.name ?? '不寄'}${o.family ? (me.phase === 'pro' ? ` · 每周 ${moneyFull(familyWeekly(game))}` : ' · 没有工资，先停着') : ''}${o.familySent ? ` · 一共寄了 ${price(o.familySent)}` : ''}`}
          lock={lockLine(FAMILY_TIERS.map((t) => ({ name: t.name, why: familyLocked(game, t.tier) })), ['现在就是这一档'])}
        >
          {FAMILY_TIERS.map((t) => (
            <button key={t.tier} className={`sm${o.family === t.tier ? ' primary' : ''}`} style={wrapBtn} disabled={!!familyLocked(game, t.tier)} onClick={() => act(setFamily(game, t.tier))}>
              {t.name}{t.share ? ` ${Math.round(t.share * 100)}%` : ''}
            </button>
          ))}
        </Outlet>
        <Outlet
          name="直播间"
          note={`现在：${STUDIO[o.studio]?.name}。直播额度 +15% / +30%，只在直播挣到顶时有用。`}
          lock={studioWhy === '已经是最好的了' ? null : studioWhy}
        >
          {nextStudio ? <button className="sm" style={wrapBtn} disabled={!!studioWhy} onClick={() => act(buyStudio(game))}>换成{nextStudio.name} {price(nextStudio.price)}</button> : <span className="tag win">已是最好</span>}
        </Outlet>
        <Outlet
          name="合伙开网咖"
          note={cafe?.open ? `${cafe.opened} 年开的 · 分红一共 ${price(cafe.paid)}` : `${cafe ? `上一家 ${cafe.closed} 年关了。` : ''}每年年底结账：多半有分红，也可能亏了要补钱，也可能关门。`}
          lock={cafeWhy === '已经开着一家了' ? null : cafeWhy}
        >
          {cafe?.open ? <span className="tag win">开着</span> : <button className="sm" style={wrapBtn} disabled={!!cafeWhy} onClick={() => act(openCafe(game))}>合伙开一家 {price(CAFE_PRICE)}</button>}
        </Outlet>
      </Panel>
    </>
  )
}
