/**
 * Every ladder tier's badge (src/ui/me/art/emblem.tsx) at the sizes the game draws it, on the three grounds.
 *
 *   npm run dev  →  /rank-preview.html
 *
 * Dev only; the build's only entry is index.html.
 */
import { createRoot } from 'react-dom/client'
import { RankBadge } from '../src/ui/me/art/emblem'
import '../src/ui/me/base.css'
import '../src/me.css'

const TIERS: [string, number][] = [
  ['黑铁', 1], ['青铜', 2], ['白银', 3], ['黄金', 1], ['铂金', 2], ['钻石', 3],
  ['超凡入圣', 2], ['神话', 0], ['神话', 3], ['辐能战魂', 0],
]
const SIZES = [20, 28, 40, 64, 108]
const GROUNDS: [string, string][] = [['dark', '深'], ['light', '浅'], ['cream', '米']]

function Ground({ theme, name }: { theme: string; name: string }) {
  return (
    <section data-theme={theme === 'dark' ? undefined : theme} style={{ background: 'var(--bg)', color: 'var(--text)', padding: '14px 18px' }}>
      <h3 style={{ margin: '0 0 10px' }}>{name}</h3>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {TIERS.map(([tier, div]) => (
            <tr key={`${tier}${div}`}>
              <td style={{ padding: '4px 14px 4px 0', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{div ? `${tier} ${div}` : tier}</td>
              {SIZES.map((s) => (
                <td key={s} style={{ padding: 4, verticalAlign: 'middle', background: s === 40 ? 'var(--bg-rail)' : s === 28 ? 'var(--panel)' : undefined }}>
                  <RankBadge tier={tier} div={div} size={s} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
    {GROUNDS.map(([t, n]) => <Ground key={t} theme={t} name={n} />)}
  </div>,
)
