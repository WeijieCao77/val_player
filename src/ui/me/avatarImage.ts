import { avatarData, AVATAR_SIZE, jpegDimensions } from '../../engine/me/avatar'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_EDGE = 4096
const MAX_PIXELS = 16_000_000
export class AvatarConversionError extends Error {}
const bad = (message = '图片损坏或格式不受支持，请换一张 PNG、JPEG 或 WebP 图片。'): never => { throw new AvatarConversionError(message) }
const bounded = (w: number, h: number): void => {
  if (!w || !h || w > MAX_EDGE || h > MAX_EDGE || w * h > MAX_PIXELS) bad('图片尺寸过大或无效：最长边不超过 4096 像素，总像素不超过 1600 万。')
}

/** Inspect headers BEFORE allocating decoded pixels. Files are already byte-bounded. */
function inspect(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  let dims: { width: number; height: number } | undefined
  if (mime === 'image/jpeg') dims = jpegDimensions(bytes)
  else if (mime === 'image/png') {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    if (!sig.every((v, i) => bytes[i] === v)) bad()
    let at = 8, ended = false
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at), type = word(at + 4)
      if (at + 12 + length > bytes.length) bad()
      if (at === 8 && (type !== 'IHDR' || length !== 13)) bad()
      if (type === 'IHDR') {
        if (dims || length !== 13) bad()
        dims = { width: view.getUint32(at + 8), height: view.getUint32(at + 12) }
      }
      if (type === 'acTL') bad('暂不支持动画图片，请选择一张静态图片。')
      at += length + 12
      if (type === 'IEND') { if (length || at !== bytes.length) bad(); ended = true; break }
    }
    if (!ended) bad()
  } else if (mime === 'image/webp') {
    if (bytes.length < 20 || word(0) !== 'RIFF' || word(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) bad()
    let at = 12, canvas: { width: number; height: number } | undefined
    while (at + 8 <= bytes.length) {
      const type = word(at), length = view.getUint32(at + 4, true), start = at + 8
      if (start + length > bytes.length) bad()
      if (type === 'ANIM' || type === 'ANMF') bad('暂不支持动画图片，请选择一张静态图片。')
      if (type === 'VP8X') {
        if (length !== 10 || canvas || bytes[start] & 2) bad('暂不支持动画或异常 WebP 图片。')
        canvas = { width: 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536,
          height: 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536 }
        bounded(canvas.width, canvas.height)
      } else if (type === 'VP8L') {
        if (dims || length < 5 || bytes[start] !== 47) bad()
        const bits = view.getUint32(start + 1, true)
        dims = { width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383) }
      } else if (type === 'VP8 ') {
        if (dims || length < 10 || bytes[start] & 1 || bytes[start + 3] !== 157 || bytes[start + 4] !== 1 || bytes[start + 5] !== 42) bad()
        dims = { width: view.getUint16(start + 6, true) & 16383, height: view.getUint16(start + 8, true) & 16383 }
      }
      at = start + length + (length & 1)
    }
    if (at !== bytes.length || (canvas && (!dims || canvas.width !== dims.width || canvas.height !== dims.height))) bad()
  }
  if (!dims) return bad()
  bounded(dims.width, dims.height)
  return dims
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file), img = new Image()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new AvatarConversionError('图片无法读取，可能已损坏。请换一张图片。'))
      timer = setTimeout(() => reject(new AvatarConversionError('图片读取超时，请换一张更小的图片。')), 15000)
      img.src = url
    })
    return img
  } finally {
    clearTimeout(timer)
    img.onload = null; img.onerror = null
    URL.revokeObjectURL(url)
  }
}

/** All work remains on this device; only the normalized JPEG is returned. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.size || file.size > MAX_BYTES) return bad('请选择不超过 8 MiB 的图片，文件不能为空。')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return bad('仅支持静态 PNG、JPEG、WebP；暂不支持 SVG、GIF、HEIC。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = inspect(bytes, file.type)
  const img = await loadImage(file)
  const w = img.naturalWidth, h = img.naturalHeight
  bounded(w, h)
  // EXIF orientation can swap width and height when a camera photo decodes.
  if (!((w === header.width && h === header.height) || (w === header.height && h === header.width))) return bad()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return bad('当前浏览器无法处理图片，请换一个浏览器重试。')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  const side = Math.min(w, h)
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  for (const quality of [0.8, 0.6, 0.4]) {
    const normalized = avatarData(canvas.toDataURL('image/jpeg', quality))
    if (normalized) return normalized
  }
  return bad('图片压缩失败，请换一张更简单的图片。')
}
