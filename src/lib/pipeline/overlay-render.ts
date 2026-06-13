/**
 * Renders transparent/opaque PNG overlays for AI ads using @napi-rs/canvas (Skia —
 * correct Devanagari complex-script shaping) with bundled fonts.
 *
 * Two outputs:
 *  - renderCaption(): full-frame transparent PNG with a short Hindi caption in the lower
 *    third (over a soft gradient scrim for legibility). ffmpeg overlays it at 0,0.
 *  - renderEndcard(): full-frame opaque PNG — gradient bg + real product cutout + headline +
 *    price + CTA button. Becomes the final ~4s end-card segment.
 *
 * Emoji are intentionally avoided here (no emoji font bundled → tofu). Emoji live in the
 * upload title/TTS only, never in burned-in overlays.
 */
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'
import { join } from 'path'

const FONT_DIR = join(process.cwd(), 'src/assets/fonts')
let _fontsReady = false
function ensureFonts() {
  if (_fontsReady) return
  GlobalFonts.registerFromPath(join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf'), 'NotoDeva')
  GlobalFonts.registerFromPath(join(FONT_DIR, 'Inter-Bold.ttf'), 'Inter')
  _fontsReady = true
}

export const AD_W = 1080
export const AD_H = 1920
// Hindi first, Latin/₹ fall back to Inter.
const FAMILY = 'NotoDeva, Inter'

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Lower-third Hindi caption on a transparent frame. */
export function renderCaption(textHi: string): Buffer {
  ensureFonts()
  const canvas = createCanvas(AD_W, AD_H)
  const ctx = canvas.getContext('2d')

  const fontSize = 64
  ctx.font = `${fontSize}px ${FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const maxWidth = AD_W - 160
  const lines = wrapText(ctx, textHi, maxWidth)
  const lineH = fontSize * 1.25
  const blockH = lines.length * lineH
  const centerY = AD_H * 0.78

  // Soft dark scrim behind text for legibility on any footage.
  const grad = ctx.createLinearGradient(0, centerY - blockH, 0, centerY + blockH)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, centerY - blockH - 40, AD_W, blockH * 2 + 80)

  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 12
  lines.forEach((l, i) => {
    const y = centerY - blockH / 2 + i * lineH + lineH / 2
    ctx.fillText(l, AD_W / 2, y)
  })

  return canvas.toBuffer('image/png')
}

export interface EndcardSpec {
  headlineHi: string
  priceText?: string   // e.g. "₹779  (Pack of 2)"
  ctaHi: string        // e.g. "आज ही ऑर्डर करें"
  accent?: string      // brand accent hex, default plum to match Derma Co
}

/** Opaque end-card: gradient bg + (optional) product cutout + headline + price + CTA. */
export async function renderEndcard(spec: EndcardSpec, productCutout?: Buffer | null): Promise<Buffer> {
  ensureFonts()
  const accent = spec.accent || '#7b2d8e'
  const canvas = createCanvas(AD_W, AD_H)
  const ctx = canvas.getContext('2d')

  // Background: deep vertical gradient + radial glow behind product.
  const bg = ctx.createLinearGradient(0, 0, 0, AD_H)
  bg.addColorStop(0, '#1a1020')
  bg.addColorStop(1, '#0c0710')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, AD_W, AD_H)

  const glow = ctx.createRadialGradient(AD_W / 2, AD_H * 0.42, 60, AD_W / 2, AD_H * 0.42, 620)
  glow.addColorStop(0, `${accent}66`)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, AD_W, AD_H)

  // Product cutout — fit within a centered box in the upper-middle (optional).
  if (productCutout) {
    const img = await loadImage(productCutout)
    const boxW = AD_W * 0.7
    const boxH = AD_H * 0.42
    const scale = Math.min(boxW / img.width, boxH / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = (AD_W - dw) / 2
    const dy = AD_H * 0.12
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 50
    ctx.shadowOffsetY = 24
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Headline — lower when there's a product image, more centered when text-only.
  let y = productCutout ? AD_H * 0.62 : AD_H * 0.42
  const hSize = 72
  ctx.font = `${hSize}px ${FAMILY}`
  ctx.fillStyle = '#ffffff'
  const hLines = wrapText(ctx, spec.headlineHi, AD_W - 160)
  const hLineH = hSize * 1.2
  hLines.forEach((l, i) => ctx.fillText(l, AD_W / 2, y + i * hLineH))
  y += (hLines.length - 1) * hLineH + 120

  // Price
  if (spec.priceText) {
    ctx.font = `56px ${FAMILY}`
    ctx.fillStyle = '#f4d35e'
    ctx.fillText(spec.priceText, AD_W / 2, y)
    y += 110
  }

  // CTA pill
  ctx.font = `52px ${FAMILY}`
  const ctaW = Math.min(ctx.measureText(spec.ctaHi).width + 120, AD_W - 120)
  const ctaH = 120
  const ctaX = (AD_W - ctaW) / 2
  const ctaY = y
  ctx.fillStyle = accent
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(spec.ctaHi, AD_W / 2, ctaY + ctaH / 2)

  return canvas.toBuffer('image/png')
}
