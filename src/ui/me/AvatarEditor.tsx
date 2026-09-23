import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { avatarData } from '../../engine/me/avatar'
import { fileToAvatarDataUrl } from './avatarImage'
import './media.css'

interface Props { value?: string; onChange: (value?: string) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }

export default function AvatarEditor({ value, onChange, disabled, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null), seq = useRef(0), disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [failed, setFailed] = useState<string>()
  const avatar = useMemo(() => avatarData(value), [value])
  useEffect(() => () => { seq.current++ }, [])
  useEffect(() => { if (disabled) { seq.current++; setBusy(false) } }, [disabled])
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || disabledRef.current) return
    const operation = ++seq.current
    setBusy(true); setError('')
    try {
      const next = await fileToAvatarDataUrl(file)
      if (operation === seq.current && !disabledRef.current) { setFailed(undefined); onChange(next) }
    } catch (e) {
      if (operation === seq.current) setError(e instanceof Error ? e.message : '图片处理失败，请换一张重试。')
    } finally { if (operation === seq.current) setBusy(false) }
  }
  return <div role="group" aria-label="头像编辑" style={{ margin: '8px 0 16px', minWidth: 0 }}>
    <div className="row wrap" style={{ gap: 12 }}>
      {avatar && avatar !== failed ? <img src={avatar} alt="当前头像" width={64} height={64}
        style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={() => setFailed(avatar)} />
        : <span className="face face-me" style={{ width: 64, height: 64 }} aria-label="默认头像" role="img">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.4" /><path d="M3 24c.6-5.4 4.3-8.6 9-8.6s8.4 3.2 9 8.6z" /></svg>
        </span>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.jfif,.webp" aria-label="选择头像图片"
        hidden disabled={disabled || busy} onChange={upload} />
      <button type="button" className="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? '处理图片中…' : avatar ? '更换头像' : '上传头像'}
      </button>
      {(value || busy) && <button type="button" className="sm ghost" disabled={disabled} onClick={() => {
        seq.current++; setBusy(false); setError(''); setFailed(undefined); onChange(undefined)
      }}>{busy ? '取消并恢复默认' : '恢复默认'}</button>}
    </div>
    {error && <p role="alert" className="tiny" style={{ color: 'var(--loss)', overflowWrap: 'anywhere' }}>{error}</p>}
    <p className="tiny faint" style={{ marginBottom: 0 }}>本地图片居中裁剪为 128 × 128；支持静态 PNG、JPEG、WebP，最长边 ≤8192 像素、文件 ≤8 MiB。仅保存压缩头像，不上传服务器。</p>
    <p className="tiny faint" style={{ marginTop: 4 }}>仅保存在当前生涯，随存档导入导出；分享卡和成就殿堂不包含头像。</p>
  </div>
}
