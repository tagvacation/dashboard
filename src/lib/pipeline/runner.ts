import { Storage } from '@google-cloud/storage'
import { pipelineDb, storiesDb } from '../db'
import { pickTopic, writeScript } from './gemini'
import { submitAllScenes, pollAllScenes } from './veo'
import { generateFullNarration } from './tts'
import type { PipelineStep, Script } from './types'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

// ─── GCS helpers ─────────────────────────────────────────────────────────────

async function uploadBuffer(path: string, buf: Buffer, mimeType: string): Promise<string> {
  await bucket.file(path).save(buf, { contentType: mimeType })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(path: string): Promise<boolean> {
  const [exists] = await bucket.file(path).exists()
  return exists
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runPipeline(storyId: string) {
  const log = async (msg: string) => {
    await pipelineDb.appendLog(storyId, msg)
    console.log(`[${storyId}] ${msg}`)
  }

  const setStep = async (step: PipelineStep, extra?: Parameters<typeof pipelineDb.setStep>[2]) => {
    await pipelineDb.setStep(storyId, step, extra)
  }

  try {
    let run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found in DB')

    // ── Step 1: Pick Topic ──────────────────────────────────────────────────
    let topic = run.topic
    let theme = run.theme

    if (!topic) {
      await log('Picking topic...')
      await setStep('topic')
      const result = await pickTopic(storyId)
      topic = result.topic
      theme = result.theme
      await setStep('topic', { topic, theme })
      await log(`Topic: ${topic}`)

      // Create story in PostgreSQL
      await storiesDb.create({ story_id: storyId, topic, theme })
    }

    // ── Step 2: Write Script ────────────────────────────────────────────────
    let script: Script
    if (run.script_json) {
      script = JSON.parse(run.script_json)
      await log(`Script loaded (${script.total_scenes} scenes)`)
    } else {
      await log('Writing script...')
      await setStep('script')
      script = await writeScript(storyId, topic, theme)
      await setStep('script', { script_json: JSON.stringify(script) })
      await log(`Script ready: "${script.title_hindi}" — ${script.total_scenes} scenes`)
      await storiesDb.update(storyId, { scenes_count: script.total_scenes })
    }

    // ── Step 3: Generate Audio ──────────────────────────────────────────────
    const audioPath = `stories/${storyId}/audio/full_narration.mp3`
    if (!(await gcsExists(audioPath))) {
      await log('Generating TTS audio...')
      await setStep('audio')
      const audioBuffer = await generateFullNarration(script.scenes)
      const audioUrl = await uploadBuffer(audioPath, audioBuffer, 'audio/mpeg')
      await log('Audio uploaded')
      await storiesDb.update(storyId, {
        audio_url: audioUrl,
        storage_path: `stories/${storyId}/`,
      })
    } else {
      await log('Audio exists, skipping TTS')
    }

    // ── Step 4: Submit scenes to Veo ────────────────────────────────────────
    let operationIds: Record<string, string> = run.operation_ids || {}
    const completedClips: string[] = run.completed_clips || []
    const filteredClips: string[] = run.filtered_clips || []

    const doneScenes = new Set([...completedClips, ...filteredClips, ...Object.keys(operationIds)])
    const scenesToSubmit = script.scenes.filter(s => !doneScenes.has(s.scene_num))

    if (scenesToSubmit.length > 0) {
      await log(`Submitting ${scenesToSubmit.length} scenes to Veo...`)
      await setStep('veo_submit')
      const newOps = await submitAllScenes(scenesToSubmit, (msg) => { log(msg).catch(console.error) })
      Object.assign(operationIds, newOps)
      await setStep('veo_submit', { operation_ids: operationIds })
    } else {
      await log('All scenes already submitted')
    }

    // ── Step 5: Poll Veo + Upload clips ─────────────────────────────────────
    const pendingOps = Object.fromEntries(
      Object.entries(operationIds).filter(([sceneNum]) => !completedClips.includes(sceneNum))
    )

    if (Object.keys(pendingOps).length > 0) {
      await log(`Polling ${Object.keys(pendingOps).length} scenes...`)
      await setStep('veo_poll')

      const { completed, filtered } = await pollAllScenes(
        pendingOps,
        async (sceneNum, status) => {
          const latest = await pipelineDb.get(storyId)
          const clips: string[] = latest?.completed_clips || []
          const filtd: string[] = latest?.filtered_clips || []
          if (status === 'done' && !clips.includes(sceneNum)) {
            await pipelineDb.setStep(storyId, 'veo_poll', { completed_clips: [...clips, sceneNum] })
          }
          if (status === 'filtered' && !filtd.includes(sceneNum)) {
            await pipelineDb.setStep(storyId, 'veo_poll', { filtered_clips: [...filtd, sceneNum] })
          }
        },
        (msg) => { log(msg).catch(console.error) },
      )

      await log(`Uploading ${Object.keys(completed).length} clips...`)
      await Promise.all(
        Object.entries(completed).map(async ([sceneNum, base64]) => {
          const clipPath = `stories/${storyId}/clips/scene_${sceneNum}.mp4`
          if (!(await gcsExists(clipPath))) {
            await uploadBuffer(clipPath, Buffer.from(base64, 'base64'), 'video/mp4')
            await log(`  Uploaded scene_${sceneNum}.mp4`)
          }
        })
      )
      filteredClips.push(...filtered)
    } else {
      await log('All clips already uploaded')
    }

    // ── Step 6: Complete ────────────────────────────────────────────────────
    await log('Pipeline complete!')
    await setStep('complete')

    const finalSceneCount = completedClips.length + Object.keys(completed ?? {}).length
    await storiesDb.update(storyId, {
      status: 'clips_ready',
      clips_generated_at: new Date().toISOString(),
      scenes_count: finalSceneCount || script.total_scenes,
      ...(filteredClips.length > 0 ? { notes: `${filteredClips.length} scene(s) blocked by Veo content filter` } : {}),
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${storyId}] Pipeline failed:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}

// re-export for type safety
const completed = {}
export { completed }
