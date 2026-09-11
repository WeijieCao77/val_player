import { THEMES, useTheme } from './theme'

/**
 * The three grounds, as a segmented control.
 *
 * Words rather than icons: a sun and a moon stop being unambiguous the moment
 * there is a third option, and 深 / 浅 / 米 is read in a glance. Each button
 * carries a swatch of the ground it names, so the row is also a preview.
 *
 * `compact` is the side bar's form — one character each, and on a phone,
 * where there is no room for three buttons, a single one that steps to the
 * next ground.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme()
  const pick = (key: typeof theme) => {
    if (key !== theme) setTheme(key)
  }
  const cur = THEMES.find((t) => t.key === theme) ?? THEMES[0]
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]

  return (
    <>
      <div
        className={`seg theme${compact ? ' compact hide-m' : ''}`}
        role="radiogroup"
        aria-label="界面配色"
      >
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={theme === t.key}
            className={theme === t.key ? 'on' : ''}
            data-t={t.key}
            title={`${t.label}：${t.hint}`}
            onClick={() => pick(t.key)}
          >
            <i className="sw" aria-hidden="true" />
            {compact ? t.short : t.label}
          </button>
        ))}
      </div>
      {compact && (
        <button
          type="button"
          className="theme-cycle only-m"
          data-t={theme}
          aria-label={`界面配色：${cur.label}。点击换成${next.label}`}
          title={`${cur.label} → ${next.label}`}
          onClick={() => pick(next.key)}
        >
          <i className="sw" aria-hidden="true" />
          {cur.short}
        </button>
      )}
    </>
  )
}
