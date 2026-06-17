import { getAccessToken, GCP_REGION } from './auth'
import type { GcpContext } from './auth'
import type { Scene } from './types'
import { fetchWithRetry } from './fetch-retry'

const VEO_MODEL = 'veo-3.1-lite-generate-001'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Submit + poll a Veo clip with auto-retry. Re-submits on failure (timeout, the
 * transient "No video in response" glitch, or a content filter) up to `attempts`
 * times — the same prompt often succeeds on a re-roll. Returns base64 mp4 or throws.
 */
export async function generateVeoClip(
  prompt: string,
  ctx: GcpContext,
  opts: { model?: string; imageRef?: VeoImageRef; generateAudio?: boolean; attempts?: number; pollIntervalMs?: number; maxPolls?: number } = {},
): Promise<string> {
  const attempts = opts.attempts ?? 3
  const pollMs = opts.pollIntervalMs ?? 30_000
  const maxPolls = opts.maxPolls ?? 20
  let lastErr: unknown = new Error('Veo failed')
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const opId = await submitVeoClip(prompt, ctx, opts.model, opts.imageRef, opts.generateAudio ?? false)
      for (let i = 0; i < maxPolls; i++) {
        await sleep(pollMs)
        const r = await pollVeoOperation(opId, ctx)
        if (!r.done) continue
        if (r.base64) return r.base64
        // done but no video → transient glitch OR content filter; throw to trigger retry
        throw new Error(r.error?.includes('No video') ? 'No video in response (transient)' : `CONTENT_FILTER: ${r.error || 'filtered'}`)
      }
      throw new Error('Veo timeout')
    } catch (e) {
      lastErr = e
      if (attempt < attempts) await sleep(5_000) // brief backoff before re-roll
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function veoBase(ctx: GcpContext) {
  return `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${VEO_MODEL}`
}

/** Optional reference image for image-to-video conditioning. */
export interface VeoImageRef {
  gcsUri?: string                // gs://bucket/path.png
  bytesBase64Encoded?: string    // alternative to gcsUri
  mimeType?: string              // image/png or image/jpeg
}

export async function submitVeoClip(
  prompt: string,
  ctx: GcpContext,
  model?: string,
  imageRef?: VeoImageRef,
  generateAudio: boolean = false,
): Promise<string> {
  const veoModel = model || VEO_MODEL
  const base = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${veoModel}`

  // Build instance — add image if provided (image-to-video mode)
  const instance: Record<string, unknown> = { prompt }
  if (imageRef && (imageRef.gcsUri || imageRef.bytesBase64Encoded)) {
    instance.image = {
      ...(imageRef.gcsUri ? { gcsUri: imageRef.gcsUri } : {}),
      ...(imageRef.bytesBase64Encoded ? { bytesBase64Encoded: imageRef.bytesBase64Encoded } : {}),
      mimeType: imageRef.mimeType || 'image/png',
    }
  }

  const token = await getAccessToken(ctx)
  const res = await fetchWithRetry(`${base}:predictLongRunning`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: '9:16',
        sampleCount: 1,
        durationSeconds: 8,
        resolution: '1080p',
        personGeneration: 'allow_all',
        generateAudio,
      },
    }),
  }, { label: 'veo-submit', timeoutMs: 90_000, backoffMs: 30_000 })

  if (!res.ok) throw new Error(`Veo submit error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.name) throw new Error('Veo submit returned no operation name')
  return data.name as string
}

interface PollResult {
  done: boolean
  base64?: string
  filtered: boolean
  error?: string
}

export async function pollVeoOperation(operationName: string, ctx: GcpContext): Promise<PollResult> {
  // Wrap the fetch in retry for transient errors (undici "terminated", reset, etc.)
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getAccessToken(ctx)
      const res = await fetch(`${veoBase(ctx)}:fetchPredictOperation`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationName }),
        signal: AbortSignal.timeout(60_000),  // 60s per-attempt timeout
      })
      if (!res.ok) throw new Error(`Veo poll error ${res.status}: ${await res.text()}`)
      return await processPollResponse(await res.json())
    } catch (e: unknown) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      // Transient: terminated, fetch failed, network errors, abort
      const isTransient =
        msg.includes('terminated') ||
        msg.includes('fetch failed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('aborted')
      if (!isTransient || attempt === 3) throw e
      console.warn(`Veo poll attempt ${attempt} transient error: ${msg.slice(0, 100)}. Retrying in ${attempt * 5}s...`)
      await sleep(attempt * 5000)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function processPollResponse(data: { done?: boolean; error?: { message?: string }; response?: { videos?: { bytesBase64Encoded?: string }[] } }): Promise<PollResult> {

  if (!data.done) return { done: false, filtered: false }
  if (data.error) return { done: true, filtered: true, error: data.error?.message || 'Content filtered' }

  const base64 = data.response?.videos?.[0]?.bytesBase64Encoded
  if (!base64) return { done: true, filtered: true, error: 'No video in response' }

  return { done: true, filtered: false, base64 }
}

export interface VeoSceneResult {
  sceneNum: string
  base64?: string
  filtered: boolean
  operationId: string
}

export async function submitAllScenes(
  scenes: Scene[],
  ctx: GcpContext,
  onLog: (msg: string) => void,
): Promise<Record<string, string>> {
  onLog(`Submitting ${scenes.length} scenes to Veo (project: ${ctx.projectId})...`)

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      onLog(`  Submitting scene ${scene.scene_num}`)
      const opId = await submitVeoClip(scene.video_prompt, ctx)
      onLog(`  Scene ${scene.scene_num} submitted`)
      return { sceneNum: scene.scene_num, opId }
    })
  )

  const operationIds: Record<string, string> = {}
  results.forEach((r) => {
    if (r.status === 'fulfilled') operationIds[r.value.sceneNum] = r.value.opId
    else onLog(`  ⚠ Submit failed: ${r.reason}`)
  })

  onLog(`Submitted ${Object.keys(operationIds).length}/${scenes.length} scenes`)
  return operationIds
}

export async function pollAllScenes(
  operationIds: Record<string, string>,
  ctx: GcpContext,
  onProgress: (sceneNum: string, status: 'done' | 'filtered' | 'polling') => void | Promise<void>,
  onLog: (msg: string) => void,
  maxAttempts = 20,
): Promise<{ completed: Record<string, string>; filtered: string[] }> {

  const pending = { ...operationIds }
  const completed: Record<string, string> = {}
  const filtered: string[] = []
  let attempt = 0

  while (Object.keys(pending).length > 0 && attempt < maxAttempts) {
    attempt++
    onLog(`Poll attempt ${attempt}/${maxAttempts} — waiting 60s (${Object.keys(pending).length} pending)`)
    await sleep(60_000)

    await Promise.all(
      Object.entries(pending).map(async ([sceneNum, opId]) => {
        try {
          const result = await pollVeoOperation(opId, ctx)
          if (!result.done) { await onProgress(sceneNum, 'polling'); return }
          if (result.filtered) {
            onLog(`  Scene ${sceneNum} filtered: ${result.error}`)
            await onProgress(sceneNum, 'filtered')
            filtered.push(sceneNum)
            delete pending[sceneNum]
          } else {
            onLog(`  Scene ${sceneNum} done ✓`)
            await onProgress(sceneNum, 'done')
            completed[sceneNum] = result.base64!
            delete pending[sceneNum]
          }
        } catch (e) { onLog(`  Scene ${sceneNum} poll error: ${e}`) }
      })
    )
  }

  if (Object.keys(pending).length > 0) {
    onLog(`⚠ Max polls reached. ${Object.keys(pending).length} scenes timed out.`)
    Object.keys(pending).forEach(s => filtered.push(s))
  }

  return { completed, filtered }
}
