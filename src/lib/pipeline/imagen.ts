/**
 * Imagen (Vertex AI) image generation — used to create the mascot character sheet
 * that keeps the product-hero consistent across Veo scenes (image-to-video).
 */
import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'
import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { fetchWithRetry } from './fetch-retry'

const MASCOT_W = 1080, MASCOT_H = 1920  // 9:16 — Veo image-to-video expects this aspect

/**
 * Force any mascot image to a clean 9:16 frame. nano-banana inherits the product photo's
 * aspect (often square), and Veo then boxes a square reference inside 9:16 → the framing
 * defect. We fit the mascot fully (no crop) over a soft blurred fill of itself (no hard bars).
 */
async function normalizeTo916(buf: Buffer): Promise<Buffer> {
  const m = await sharp(buf).metadata()
  if (m.width && m.height && Math.abs(m.width / m.height - MASCOT_W / MASCOT_H) < 0.02) {
    return sharp(buf).resize(MASCOT_W, MASCOT_H, { fit: 'cover' }).png().toBuffer()
  }
  const bg = await sharp(buf).resize(MASCOT_W, MASCOT_H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.9 }).toBuffer()
  const fg = await sharp(buf).resize(MASCOT_W, MASCOT_H, { fit: 'inside' }).toBuffer()
  return sharp(bg).composite([{ input: fg, gravity: 'center' }]).png().toBuffer()
}

/** Pad a product photo onto a 9:16 white canvas so nano-banana composes a vertical scene. */
async function padInputTo916(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(MASCOT_W, MASCOT_H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png().toBuffer()
}

// Try newest → oldest; availability varies by project.
const IMAGEN_MODELS = ['imagen-4.0-generate-001', 'imagen-3.0-generate-002', 'imagegeneration@006']

export async function generateImage(prompt: string, ctx: GcpContext, aspectRatio = '9:16'): Promise<Buffer> {
  const token = await getAccessToken(ctx)
  let lastErr = 'unknown'
  for (const model of IMAGEN_MODELS) {
    const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${model}:predict`
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }),
    }, { label: 'imagen', timeoutMs: 120_000 })
    if (res.ok) {
      const d = await res.json()
      const b64 = d.predictions?.[0]?.bytesBase64Encoded
      if (b64) return Buffer.from(b64, 'base64')
      lastErr = `${model}: ok but no image`
    } else {
      lastErr = `${model}: ${res.status} ${(await res.text()).slice(0, 160)}`
    }
  }
  throw new Error(`Imagen failed — ${lastErr}`)
}

/** Generate a mascot image and upload to stories/{id}/mascot.png. Returns gs:// + public URL. */
export async function generateMascotToGcs(
  prompt: string, ctx: GcpContext, storyId: string,
): Promise<{ gcsUri: string; publicUrl: string }> {
  const buf = await generateImage(prompt, ctx)
  return uploadMascot(buf, ctx, storyId)
}

async function uploadMascot(buf: Buffer, ctx: GcpContext, storyId: string) {
  const storage = new Storage({ credentials: ctx.credentials })
  const path = `stories/${storyId}/mascot.png`
  await storage.bucket(ctx.bucket).file(path).save(buf, { contentType: 'image/png', resumable: false })
  return { gcsUri: `gs://${ctx.bucket}/${path}`, publicUrl: `https://storage.googleapis.com/${ctx.bucket}/${path}` }
}

/**
 * Image-CONDITIONED mascot: feed the REAL product photo to Gemini 2.5 Flash Image
 * ("nano-banana") so the mascot keeps the product's exact shape, colours and label —
 * just made cute. Far more product-faithful than text-only Imagen. Falls back to
 * text Imagen (via the caller) if this throws.
 */
export async function generateMascotFromImage(
  productImage: Buffer, mimeType: string, prompt: string, ctx: GcpContext, storyId: string,
): Promise<{ gcsUri: string; publicUrl: string }> {
  const token = await getAccessToken(ctx)
  const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/gemini-2.5-flash-image:generateContent`
  // Pad the product onto a 9:16 canvas so nano-banana composes a VERTICAL scene (it tends to
  // match the input aspect — a square product photo otherwise yields a square mascot).
  const paddedInput = await padInputTo916(productImage).catch(() => productImage)
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: paddedInput.toString('base64') } }, { text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  }, { label: 'nano-mascot', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`gemini-image ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts || []
  const imgPart = parts.find((p: { inlineData?: { data: string } }) => p.inlineData?.data)
  if (!imgPart) throw new Error('gemini-image returned no image')
  // Guarantee a clean 9:16 reference for Veo regardless of what nano-banana returned.
  const normalized = await normalizeTo916(Buffer.from(imgPart.inlineData.data, 'base64'))
  return uploadMascot(normalized, ctx, storyId)
}
