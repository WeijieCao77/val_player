import { useGame } from './ctx'
import { compClass } from '../../engine/me/compclass'
import { compCn } from '../../engine/me/compname'
import { takeMoment } from '../../engine/me/moments'
import type { MomentItem } from '../../engine/me/types'
import type { GameState } from '../../engine/types'
import Moment, { type MomentChip } from './Moment'
import { crestUrl } from '../../engine/dossier'
import { FaceRow } from './Face'
import { Medal, PromoBadge, TrophyChampions, TrophyLeague, TrophyMasters } from './art/fx'
import { RankEmblem } from './art/emblem'

/**
 * The big moments the engine queued (me/moments.ts), one full-screen card at a
 * time: a title I started in, a signing, an award, the ladder's first 超凡入圣 /
 * 神话 / 辐能战魂 — the tiers the author settled on 2026-09-14. They come before
 * the achievements they unlock and before any card the clock stopped on
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
    case 'award':
      return {
        tone: 'gold',
        art: <Medal />,
        eyebrow: `${m.year} · 年度颁奖夜${m.league ? ` · ${m.league}` : ''}`,
        title: m.award ?? '年度奖项',
        body: m.nominees?.length ? `入围：${m.nominees.join('、')}。` : undefined,
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
