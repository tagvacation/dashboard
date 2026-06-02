import { getAccessToken, GCP_PROJECT, GCP_REGION } from './auth'
import type { Scene } from './types'

const VEO_MODEL = 'veo-3.1-lite-generate-001'
const BASE = `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${GCP_REGION}/publishers/google/models/${VEO_MODEL}`

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function submitVeoClip(prompt: string): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}:predictLongRunning`, {
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

export async function pollVeoOperation(operationName: string): Promise<PollResult> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}:fetchPredictOperation`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName }),
  })
  if (!res.ok) throw new Error(`Veo poll error ${res.status}: ${await res.text()}`)
  const data = await res.json()

  if (!data.done) return { done: false, filtered: false }

  // Content filtered
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

// Submit all scenes in parallel, return operation IDs
export async function submitAllScenes(
  scenes: Scene[],
  onLog: (msg: string) => void,
): Promise<Record<string, string>> {
  onLog(`Submitting ${scenes.length} scenes to Veo in parallel...`)

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      onLog(`  Submitting scene ${scene.scene_num} (${scene.beat})`)
      const opId = await submitVeoClip(scene.video_prompt)
      onLog(`  Scene ${scene.scene_num} submitted → ${opId.split('/').pop()?.slice(0, 8)}...`)
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

// Poll all pending operations until done. Returns base64 per sceneNum.
export async function pollAllScenes(
  operationIds: Record<string, string>,
  onProgress: (sceneNum: string, status: 'done' | 'filtered' | 'polling') => void,
  onLog: (msg: string) => void,
  maxAttempts = 20,
): Promise<{ completed: Record<string, string>; filtered: string[] }> {

  const pending = { ...operationIds }
  const completed: Record<string, string> = {}
  const filtered: string[] = []
  let attempt = 0

  while (Object.keys(pending).length > 0 && attempt < maxAttempts) {
    attempt++
    onLog(`Poll attempt ${attempt}/${maxAttempts} — waiting 60s (${Object.keys(pending).length} scenes pending)`)
    await sleep(60_000)

    await Promise.all(
      Object.entries(pending).map(async ([sceneNum, opId]) => {
        try {
          const result = await pollVeoOperation(opId)
          if (!result.done) {
            onProgress(sceneNum, 'polling')
            return
          }
          if (result.filtered) {
            onLog(`  Scene ${sceneNum} filtered: ${result.error}`)
            onProgress(sceneNum, 'filtered')
            filtered.push(sceneNum)
            delete pending[sceneNum]
          } else {
            onLog(`  Scene ${sceneNum} done ✓`)
            onProgress(sceneNum, 'done')
            completed[sceneNum] = result.base64!
            delete pending[sceneNum]
          }
        } catch (e) {
          onLog(`  Scene ${sceneNum} poll error: ${e}`)
        }
      })
    )
  }

  if (Object.keys(pending).length > 0) {
    onLog(`⚠ Max polls reached. ${Object.keys(pending).length} scenes timed out.`)
    Object.keys(pending).forEach(s => filtered.push(s))
  }

  return { completed, filtered }
}
