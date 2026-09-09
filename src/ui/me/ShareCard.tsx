import { useEffect, useState } from 'react'
import { useGame } from '../ctx'
import { CARD_FILE, canShareFile, careerCardUrl, dataUrlToFile } from './share'

/**
 * The card, on screen, with the two ways of keeping it.
 *
 * On a phone the reliable route is the system share sheet — that is the only
 * thing that offers 「存储到照片」 on iOS — so when `navigator.canShare` says
 * files are allowed, that button leads. Everywhere else it is a download, and
 * long-pressing the image always works too, which is what the tip says.
 */
export default function ShareCard({ onClose }: { onClose: () => void }) {
  const { game } = useGame()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // drawing 1080×1620 takes a beat; let the overlay paint first
    const t = setTimeout(() => {
      const u = careerCardUrl(game)
      if (u) setUrl(u)
      else setFailed(true)
    }, 30)
    return () => clearTimeout(t)
  }, [game])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = url ? dataUrlToFile(url, CARD_FILE) : null
  const shareable = !!file && canShareFile(file)

  return (
    <div className="modal-bg share-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="share-card" role="dialog" aria-modal="true" aria-label="生涯名片">
        <header className="share-head">
          <b>生涯名片</b>
          <button className="sm" onClick={onClose}>关闭 ×</button>
        </header>
        <div className="share-body">
          {url ? <img className="share-img" alt="生涯名片" src={url} />
            : failed ? <div className="share-loading">这台设备画不出图片，直接截图也一样能发。</div>
              : <div className="share-loading">正在生成…</div>}
        </div>
        <footer className="share-foot">
          <span className="share-tip">
            {!url ? '正在生成…'
              : shareable ? '点「存到相册」走系统菜单，也可以长按图片保存'
                : '长按图片保存到相册；「下载图片」存到的是下载目录'}
          </span>
          <span className="share-acts">
            {shareable && (
              <button className="sm primary" onClick={() => {
                try {
                  void navigator.share({ files: [file!], title: '无畏契约 · 生涯名片' }).catch(() => {})
                } catch { /* the sheet was dismissed */ }
              }}>存到相册</button>
            )}
            {url && <a className="share-dl" href={url} download={CARD_FILE}>下载图片</a>}
          </span>
        </footer>
      </section>
    </div>
  )
}
