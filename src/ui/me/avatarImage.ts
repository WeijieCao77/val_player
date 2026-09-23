import { avatarData, AVATAR_SIZE, jpegDimensions } from '../../engine/me/avatar'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_EDGE = 8192
const MAX_PIXELS = 40_000_000
/** Phone decoders may give up well below the header bound; name what to shrink when they do. */
const SAFE_PIXELS = 16_000_000
type Kind = 'image/png' | 'image/jpeg' | 'image/webp'
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
export class AvatarConversionError extends Error {}
const bad = (message = '图片损坏或格式不受支持，请换一张 PNG、JPEG 或 WebP 图片。'): never => { throw new AvatarConversionError(message) }
const bounded = (w: number, h: number): void => {
  if (!w || !h || w > MAX_EDGE || h > MAX_EDGE || w * h > MAX_PIXELS) bad('图片尺寸过大或无效：最长边不超过 8192 像素，总像素不超过 4000 万。请先缩小再上传。')
}

/** Trust the bytes, not the declared type: Windows and chat apps label PNG or WebP files .jpg,
 * leave the type empty, or send image/jpg. Unsupported formats get told what they are. */
function sniff(bytes: Uint8Array, file: File): Kind {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n))
  if (bytes.length >= 8 && PNG_SIG.every((v, i) => bytes[i] === v)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  const name = file.name.toLowerCase(), type = file.type.toLowerCase()
  const brand = bytes.length >= 12 && ascii(4, 4) === 'ftyp' ? ascii(8, 4).trim().toLowerCase() : ''
  if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avif|avis)$/.test(brand) || /\.(heic|heif|avif)$/.test(name) || /heic|heif|avif/.test(type))
    return bad('暂不支持 HEIC/HEIF/AVIF 照片。iPhone 可在「设置 › 相机 › 格式」选「兼容性最佳」，或先把照片转成 JPEG 再上传。')
  if (ascii(0, 4) === 'GIF8' || name.endsWith('.gif') || type === 'image/gif') return bad('暂不支持 GIF，请换一张静态 PNG、JPEG 或 WebP 图片。')
  const head = ascii(0, Math.min(bytes.length, 64))
  if (/^\s*(<\?xml|<svg|<!doctype svg)/i.test(head) || name.endsWith('.svg') || type.includes('svg')) return bad('暂不支持 SVG，请换一张 PNG、JPEG 或 WebP 图片。')
  if (ascii(0, 2) === 'BM' || ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') return bad('暂不支持 BMP/TIFF，请先转成 PNG 或 JPEG。')
  return bad('无法识别这张图片的格式，仅支持静态 PNG、JPEG、WebP。')
}

/** Inspect headers BEFORE allocating decoded pixels. Files are already byte-bounded.
 * Data after the main image (Ultra HDR gain maps, camera trailers, chat-app appendices) is
 * ignored rather than rejected: only the browser's decode of the main image reaches the canvas. */
function inspect(bytes: Uint8Array, mime: Kind): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  let dims: { width: number; height: number } | undefined
  if (mime === 'image/jpeg') dims = jpegDimensions(bytes, false)
  else if (mime === 'image/png') {
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
      if (type === 'IEND') { if (length) bad(); ended = true; break }
    }
    if (!ended) bad()
  } else {
    if (bytes.length < 20) bad()
    const end = view.getUint32(4, true) + 8
    if (end < 20 || end > bytes.length) bad()
    let at = 12, canvas: { width: number; height: number } | undefined
    while (at + 8 <= end) {
      const type = word(at), length = view.getUint32(at + 4, true), start = at + 8
      if (start + length > end) bad()
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
    if (at !== end || (canvas && (!dims || canvas.width !== dims.width || canvas.height !== dims.height))) bad()
  }
  if (!dims) return bad()
  bounded(dims.width, dims.height)
  return dims
}

/** Older browsers have no File.arrayBuffer; FileReader reads the same bytes. */
function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new AvatarConversionError('图片无法读取，请换一张图片。'))
    reader.readAsArrayBuffer(file)
  })
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
  const bytes = new Uint8Array(await readBytes(file))
  const kind = sniff(bytes, file)
  const header = inspect(bytes, kind)
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch (e) {
    if (header.width * header.height > SAFE_PIXELS) return bad('这张图片像素太多，当前设备解码失败；请先缩小到 4096 像素以内再上传。')
    throw e
  }
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
