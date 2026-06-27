/**
 * Imagen (Vertex AI) image generation — used to create the mascot character sheet
 * that keeps the product-hero consistent across Veo scenes (image-to-video).
 */
import { Storage } from '@google-cloud/storage'
import { getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { fetchWithRetry } from './fetch-retry'

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
  const storage = new Storage({ credentials: ctx.storageCredentials })
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
  const buf = await editImageNano(productImage, mimeType, prompt, ctx)
  return uploadMascot(buf, ctx, storyId)
}

/**
 * Low-level nano-banana (Gemini 2.5 Flash Image) edit: given a base image + instruction,
 * return the edited image bytes. Used to keep the SAME mascot identical across scenes
 * (generate it once, then "place this exact mascot into scene N") for consistency.
 */
export async function editImageNano(baseImage: Buffer, mimeType: string, prompt: string, ctx: GcpContext): Promise<Buffer> {
  return composeImageNano([{ data: baseImage, mimeType }], prompt, ctx)
}

/**
 * nano-banana with ONE OR MORE input images. gemini-2.5-flash-image composes across all the
 * provided images — the key to live-model anchoring: feed [face image, outfit-view image] and it
 * renders the SAME person wearing the EXACT outfit from that view (identity + view locked together).
 * Images are applied in order; reference them in the prompt as "the first/second image".
 */
export async function composeImageNano(
  images: { data: Buffer; mimeType: string }[], prompt: string, ctx: GcpContext,
): Promise<Buffer> {
  if (!images.length) throw new Error('composeImageNano: no images')
  const token = await getAccessToken(ctx)
  const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/gemini-2.5-flash-image:generateContent`
  const parts = [
    ...images.map(im => ({ inlineData: { mimeType: im.mimeType, data: im.data.toString('base64') } })),
    { text: prompt },
  ]
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  }, { label: 'nano-compose', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`gemini-image ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  const rparts = data.candidates?.[0]?.content?.parts || []
  const imgPart = rparts.find((p: { inlineData?: { data: string } }) => p.inlineData?.data)
  if (!imgPart) throw new Error('gemini-image returned no image')
  return Buffer.from(imgPart.inlineData.data, 'base64')
}
