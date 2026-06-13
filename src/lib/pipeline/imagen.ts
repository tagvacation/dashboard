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
  const storage = new Storage({ credentials: ctx.credentials })
  const path = `stories/${storyId}/mascot.png`
  await storage.bucket(ctx.bucket).file(path).save(buf, { contentType: 'image/png', resumable: false })
  return {
    gcsUri: `gs://${ctx.bucket}/${path}`,
    publicUrl: `https://storage.googleapis.com/${ctx.bucket}/${path}`,
  }
}
