import { getAccessToken, GCP_REGION } from './auth'
import type { GcpContext } from './auth'
import type { Scene } from './types'

const VEO_MODEL = 'veo-3.1-lite-generate-001'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function veoBase(ctx: GcpContext) {
  return `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${VEO_MODEL}`
}

export async function submitVeoClip(prompt: string, ctx: GcpContext, model?: string): Promise<string> {
  const veoModel = model || VEO_MODEL
  const base = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${veoModel}`

  // Retry up to 3 times on 429 with backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitMs = attempt * 30_000 // 30s, 60s backoff
      console.log(`Veo 429 backoff: waiting ${waitMs / 1000}s before retry ${attempt + 1}`)
      await sleep(waitMs)
    }

    const token = await getAccessToken(ctx)
    const res = await fetch(`${base}:predictLongRunning`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio: '9:16',
          sampleCount: 1,
          durationSeconds: 8,
          resolution: '1080p',
          personGeneration: 'allow_all',
          generateAudio: false,
        },
      }),
    })

    if (res.status === 429) {
      if (attempt === 2) throw new Error(`Veo submit error 429: quota exceeded after retries`)
      continue
    }

    if (!res.ok) throw new Error(`Veo submit error ${res.status}: ${await res.text()}`)
    const data = await res.json()
    if (!data.name) throw new Error('Veo submit returned no operation name')
    return data.name as string
  }

  throw new Error('Veo submit failed after retries')
}

interface PollResult {
  done: boolean
  base64?: string
  filtered: boolean
  error?: string
}

export async function pollVeoOperation(operationName: string, ctx: GcpContext): Promise<PollResult> {
  const token = await getAccessToken(ctx)
  const res = await fetch(`${veoBase(ctx)}:fetchPredictOperation`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName }),
  })
  if (!res.ok) throw new Error(`Veo poll error ${res.status}: ${await res.text()}`)
  const data = await res.json()

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
