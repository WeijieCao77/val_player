import { useGame } from './ctx'
import { compClass } from '../../engine/me/compclass'
import { compCn } from '../../engine/me/compname'
import { takeMoment } from '../../engine/me/moments'
import type { MomentItem } from '../../engine/me/types'
import type { GameState } from '../../engine/types'
import { crestUrl } from '../../engine/dossier'
import Moment, { type MomentChip } from './Moment'
import { Modal } from './common'
import Face, { FaceRow } from './Face'
import { Medal, PromoBadge, TrophyChampions, TrophyLeague, TrophyMasters } from './art/fx'
import { RankEmblem } from './art/emblem'
import { Scene } from './art/scenes'

/**
 * The big moments the engine queued (me/moments.ts), one card at a time: a title,
 * a signing, an award, the ladder's first 超凡入圣 / 神话 / 辐能战魂 — the tiers
 * the author settled on 2026-09-14. A title I started in, a signing, an award and
 * a new tier take the full screen; a title won from the bench is the event tier,
 * the ordinary card with the stage along its top. They come before the
 * achievements they unlock and before any card the clock stopped on
 * (PlayerGame). Everything on a card is what was written the day it happened.
 */
export default function MomentQueue() {
  const { game, commit, go } = useGame()
  const me = game.me
  const m = me?.moments?.[0]
  if (!me || !m) return null
  const more = (me.moments?.length ?? 1) - 1
  const take = () => { takeMoment(game); commit() }
  const next = more ? `还有 ${more} 件` : undefined

  if (m.kind === 'title' && m.bench) {
    return (
      <Modal title="赛场" art={<Scene kind="stage" />} onClose={take} onBgClose={() => {}}>
        <p className="q ev-q">冠军：{compCn(m.comp ?? '')}</p>
        <p className="muted small" style={{ margin: '0 0 12px' }}>这一届你在替补席上，没有出场。奖杯有你一份，下一次要自己上场去拿。</p>
        <div className="row" style={{ justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button className="primary" onClick={take}>{more ? '下一件 →' : '知道了'}</button>
          {next && <span className="tiny faint">{next}</span>}
        </div>
      </Modal>
    )
  }

  const card = cardOf(game, m)
  return (
    <Moment
      tone={card.tone}
      band={card.band}
      wide={card.wide}
      art={card.art}
      eyebrow={card.eyebrow}
      title={card.title}
      body={card.body}
      chips={card.chips}
      primary={card.page
        ? { label: card.page.label, onClick: () => { take(); go(card.page!.screen) } }
        : { label: more ? '下一件 →' : '收下', onClick: take }}
      secondary={card.page && more ? { label: '下一件 →', onClick: take } : undefined}
      next={next}
    >
      {card.extra}
    </Moment>
  )
}

interface Card {
  tone?: 'accent' | 'gold'
  band?: boolean
  wide?: boolean
  art: React.ReactNode
  eyebrow: string
  title: string
  body?: string
  chips?: MomentChip[]
  extra?: React.ReactNode
  page?: { label: string; screen: string }
}

function cardOf(g: GameState, m: MomentItem): Card {
  switch (m.kind) {
    case 'title': {
      const comp = m.comp ?? ''
      const cls = compClass(comp)
      const five = g.teams[g.myTeam]?.starters ?? []
      return {
        art: cls === 'champions' ? <TrophyChampions /> : cls === 'masters' || cls === 'lockin' ? <TrophyMasters /> : cls === 'qual' ? <PromoBadge /> : <TrophyLeague />,
        // most events carry their year in the name (「2025 全球冠军赛」): the year goes in front only when it does not
        eyebrow: /20\d\d/.test(compCn(comp)) ? compCn(comp) : `${m.year} · ${compCn(comp)}`,
        title: cls === 'champions' ? '世界冠军' : cls === 'masters' ? '大师赛冠军' : cls === 'lockin' ? 'LOCK//IN 冠军' : cls === 'qual' ? '晋级成功' : '冠军',
        body: m.fmvp ? '决赛 MVP 是你。' : '你在首发名单上，一路打到了最后。',
        chips: m.fmvp ? [{ text: '决赛 MVP', kind: 'gold' }] : undefined,
        extra: five.length ? <div className="mo-people"><FaceRow ids={five} /></div> : undefined,
      }
    }
    case 'sign': {
      const to = m.teamId ? g.teams[m.teamId] : undefined
      return {
        wide: true,
        art: (
          <div className="mo-move">
            {m.fromId && <ClubMark g={g} id={m.fromId} size={44} />}
            {m.fromId && <span className="mo-arrow" aria-hidden="true">→</span>}
            <ClubMark g={g} id={m.teamId} size={96} />
          </div>
        ),
        eyebrow: `${m.first ? '第一份职业合同' : '转会'} · ${to?.tier === 1 ? 'VCT' : 'Challengers'}`,
        title: `加盟 ${to?.name ?? '新俱乐部'}`,
        body: `${m.years ?? 1} 年合同${m.role ? `，${m.role}` : ''}。`,
        chips: m.pay ? [{ text: `年薪 ${m.pay}` }] : undefined,
        page: { label: '去队伍页', screen: 'team' },
      }
    }
    case 'award': {
      const ids = m.nomineeIds ?? []
      return {
        tone: 'gold',
        art: <Medal />,
        eyebrow: `${m.year} · 年度颁奖夜${m.league ? ` · ${m.league}` : ''}`,
        title: m.award ?? '年度奖项',
        // a night from before the ids were kept says the names in a line
        body: !ids.length && m.nominees?.length ? `入围：${m.nominees.join('、')}。` : undefined,
        extra: ids.length ? (
          <ul className="mo-list">
            {ids.map((id, i) => (
              <li key={id} className={[i === 0 ? 'win' : '', g.me?.id === id ? 'me' : ''].filter(Boolean).join(' ')}>
                <Face id={id} name={m.nominees?.[i]} size={26} />
                <span><b>{m.nominees?.[i] ?? g.players[id]?.ign ?? ''}</b><small>{m.nomineeTeams?.[i] ?? ''}</small></span>
                {i === 0 && <em>得奖</em>}
              </li>
            ))}
          </ul>
        ) : undefined,
      }
    }
    case 'qualify': {
      const comp = m.comp ?? ''
      const cls = compClass(comp)
      const name = compCn(comp)
      return {
        wide: true,
        art: <div className="mo-move"><ClubMark g={g} id={m.teamId} size={96} /></div>,
        eyebrow: /20\d\d/.test(name) ? '国际赛' : `${m.year} · 国际赛`,
        title: cls === 'lockin' ? `出战 ${name}` : `晋级 ${name}`,
        body: cls === 'champions' ? '全球冠军赛的名额拿到了，一年里最大的舞台。'
          : cls === 'lockin' ? '所有合作俱乐部齐聚一地，新赛季从这里开打。'
            : '大师赛的名额拿到了，要去和别的赛区交手。',
        page: { label: '去赛程页', screen: 'schedule' },
      }
    }
    case 'rank': {
      const tier = m.tier ?? ''
      const place = m.pos ? `${m.server ?? ''}第 ${m.pos.toLocaleString('en-US')} 名。` : ''
      const up = tier === '超凡入圣' ? '再往上是神话，名字会挂上服务器排行榜。'
        : tier === '神话' ? '再往上是辐能战魂，只给服务器前 500 名。'
          : '服务器前 500 名，名字挂在排行榜最上面那一段。'
      return {
        // the red band would swallow 神话's red: the emblem stands on the card instead
        band: false,
        art: <RankEmblem tier={tier} div={m.div} />,
        eyebrow: '天梯 · 第一次到达',
        title: m.rank ?? tier,
        body: `${place}${up}`,
      }
    }
  }
}

/**
 * A club at the card's size: its crest, loaded at once rather than lazily (the card
 * is the whole screen), or — for a club with none, an academy mostly — its tag on
 * the crest's six-sided shape, so the arrow never points at nothing.
 */
function ClubMark({ g, id, size }: { g: GameState; id?: string; size: number }) {
  if (!id) return null
  const src = crestUrl(id, g.heirs)
  if (src) return <img className="crest" src={src} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size }} />
  const team = g.teams[id]
  const tag = team?.tag || (team?.name ?? '').split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3)
  return <span className="mo-tag" aria-hidden="true" style={{ width: size, height: Math.round(size * 1.1), fontSize: Math.round(size * 0.28) }}>{tag}</span>
}
