/**
 * Pipeline Runner — Robust Implementation
 *
 * Flow mirrors n8n but uses proper async/await:
 * 1. pickTopic → 2. writeScript → 3. generateAudio →
 * 4. submitAllScenes (parallel) → 5. pollAllScenes (concurrent async) →
 * 6. retry filtered scenes once → 7. mark remaining as manual_pending
 *
 * Every scene has a row in scene_jobs table — full audit trail.
 * Failed/filtered scenes are saved with full prompt for manual retry.
 */

import { Storage } from '@google-cloud/storage'
import { pipelineDb, sceneJobsDb, storiesDb, categoriesDb, gcpCredentialsDb } from '../db'
import { pickTopic, writeScript, rewriteFilteredPrompt } from './gemini'
import { generateFullNarration } from './tts'
import { defaultContext } from './auth'
import type { GcpContext } from './auth'
import type { PipelineStep, Scene } from './types'

// Suppress unused import warning - Storage used inside makeStorage
void Storage

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Load GCP context (env default or from DB) ────────────────────────────────

async function loadGcpContext(credentialId?: string): Promise<GcpContext> {
  // Bucket is ALWAYS the default env bucket — multiple accounts share same GCS
  const defaultBucket = process.env.GCS_BUCKET || 'ai_clip_007'

  if (!credentialId || credentialId === 'default') return defaultContext()
  const cred = await gcpCredentialsDb.get(credentialId)
  if (!cred) {
    console.warn(`Credential ${credentialId} not found — using default`)
    return defaultContext()
  }
  return {
    credentials: JSON.parse(cred.sa_json),
    projectId: cred.project_id,
    bucket: defaultBucket,          // always same bucket regardless of account
    region: 'us-central1',
  }
}

// ─── GCS (ctx-aware) ─────────────────────────────────────────────────────────

function makeStorage(ctx: GcpContext) {
  const storage = new Storage({ credentials: ctx.credentials })
  const bucket = storage.bucket(ctx.bucket)
  const PUBLIC_BASE = `https://storage.googleapis.com/${ctx.bucket}`
  return { bucket, PUBLIC_BASE }
}

async function uploadBuffer(ctx: GcpContext, path: string, buf: Buffer, mimeType: string): Promise<string> {
  const { bucket, PUBLIC_BASE } = makeStorage(ctx)
  await bucket.file(path).save(buf, { contentType: mimeType })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(ctx: GcpContext, path: string): Promise<boolean> {
  const { bucket } = makeStorage(ctx)
  const [exists] = await bucket.file(path).exists()
  return exists
}

// ─── Per-scene pipeline ───────────────────────────────────────────────────────

interface SceneResult {
  sceneNum: string
  base64: string
}

/**
 * Submit one scene to Veo + poll until done.
 * Returns base64 on success, or throws with error details.
 * Caller handles retry logic and DB updates.
 */
async function submitAndPoll(prompt: string, ctx: GcpContext, maxPollAttempts = 20): Promise<string> {
  const { submitVeoClip: submit, pollVeoOperation: poll } = await import('./veo')
  const opId = await submit(prompt, ctx)

  for (let i = 0; i < maxPollAttempts; i++) {
    await sleep(60_000)
    const result = await poll(opId, ctx)
    if (!result.done) continue
    if (result.filtered) {
      const err = new Error(result.error || 'Content filter rejected')
      ;(err as NodeJS.ErrnoException).code = 'CONTENT_FILTER'
      throw err
    }
    if (!result.base64) {
      const err = new Error('Veo returned done=true but no video data')
      ;(err as NodeJS.ErrnoException).code = 'NO_VIDEO'
      throw err
    }
    return result.base64
  }
  const err = new Error(`Polling timeout after ${maxPollAttempts} attempts`)
  ;(err as NodeJS.ErrnoException).code = 'TIMEOUT'
  throw err
}

async function processAllScenes(
  scenes: Scene[],
  storyId: string,
  topic: string,
  ctx: GcpContext,
  log: (msg: string) => Promise<void>
): Promise<SceneResult[]> {

  // Insert all scene_jobs rows upfront
  await Promise.all(scenes.map(scene =>
    sceneJobsDb.create({
      story_id: storyId,
      scene_num: scene.scene_num,
      beat: scene.beat,
      video_prompt: scene.video_prompt,
      tts_text: scene.tts_text,
      primary_anchor: scene.primary_anchor,
      secondary_anchor: scene.secondary_anchor,
      attempt: 1,
    })
  ))

  // Semaphore: max 2 concurrent Veo requests to avoid 429 quota exceeded
  const MAX_CONCURRENT = 2
  let active = 0
  const queue: (() => void)[] = []
  const acquire = () => new Promise<void>(resolve => {
    if (active < MAX_CONCURRENT) { active++; resolve() }
    else queue.push(() => { active++; resolve() })
  })
  const release = () => {
    active--
    const next = queue.shift()
    if (next) next()
  }

  await log(`Submitting ${scenes.length} scenes to Veo (max ${MAX_CONCURRENT} concurrent)...`)

  const results = await Promise.allSettled(
    scenes.map(async (scene): Promise<SceneResult | null> => {
      await acquire() // wait for slot
      await sceneJobsDb.update(storyId, scene.scene_num, 1, { status: 'submitted' })

      try {
        // Attempt 1
        const base64 = await submitAndPoll(scene.video_prompt, ctx)
        await sceneJobsDb.update(storyId, scene.scene_num, 1, { status: 'done' })
        await log(`  ✓ Scene ${scene.scene_num} done`)
        release()
        return { sceneNum: scene.scene_num, base64 }

      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        const isFilter = e.code === 'CONTENT_FILTER'

        await sceneJobsDb.update(storyId, scene.scene_num, 1, {
          status: isFilter ? 'filtered' : 'failed',
          error_type: e.code || 'api_error',
          error_message: e.message,
        })

        if (!isFilter) {
          await log(`  ✗ Scene ${scene.scene_num} failed: ${e.message}`)
          await sceneJobsDb.update(storyId, scene.scene_num, 1, { status: 'manual_pending' })
          release()
          return null
        }

        // Content filtered — attempt 2 with Gemini rewrite
        await log(`  ⚠ Scene ${scene.scene_num} filtered → rewriting prompt...`)

        try {
          const rewrittenPrompt = await rewriteFilteredPrompt(topic, scene)

          // Create attempt 2 row
          await sceneJobsDb.create({
            story_id: storyId,
            scene_num: scene.scene_num,
            beat: scene.beat,
            video_prompt: rewrittenPrompt,
            tts_text: scene.tts_text,
            primary_anchor: scene.primary_anchor,
            secondary_anchor: scene.secondary_anchor,
            attempt: 2,
          })
          await sceneJobsDb.update(storyId, scene.scene_num, 2, { status: 'submitted' })

          const base64 = await submitAndPoll(rewrittenPrompt, ctx)
          await sceneJobsDb.update(storyId, scene.scene_num, 2, { status: 'done' })
          await log(`  ✓ Scene ${scene.scene_num} done (retry)`)
          return { sceneNum: scene.scene_num, base64 }

        } catch (retryErr: unknown) {
          const re = retryErr as NodeJS.ErrnoException
          await sceneJobsDb.update(storyId, scene.scene_num, 2, {
            status: 'manual_pending',
            error_type: re.code || 'api_error',
            error_message: re.message,
          })
          await log(`  ✗ Scene ${scene.scene_num} still filtered after retry — saved for manual generation`)
          release()
          return null
        }
      }
    })
  )

  // Collect successful results
  return results
    .filter((r): r is PromiseFulfilledResult<SceneResult | null> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value as SceneResult)
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runPipeline(storyId: string, categoryId?: string, credentialId?: string) {
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

    // Load GCP context (which account to use for Veo + TTS + GCS)
    const ctx = await loadGcpContext(credentialId)
    await log(`GCP Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)

    // Load category-specific prompts/config (falls back to global if empty)
    const category = categoryId ? await categoriesDb.get(categoryId) : await categoriesDb.getDefault()
    const categoryOverrides = category ? {
      topic_picker: category.prompt_topic_picker || undefined,
      script_writer: category.prompt_script_writer || undefined,
      scene_rewrite: category.prompt_scene_rewrite || undefined,
      veo_style: category.veo_style_suffix || undefined,
      scene_count_min: category.scene_count_min,
      scene_count_max: category.scene_count_max,
    } : {}

    await log(`Category: ${category?.name || 'KathaKar (default)'}`)

    // ── Step 1: Pick Topic ──────────────────────────────────────────────────
    let topic = run.topic
    let theme = run.theme

    if (!topic) {
      await log('Picking topic...')
      await setStep('topic')
      const result = await pickTopic(storyId, categoryOverrides.topic_picker)
      topic = result.topic
      theme = result.theme
      await setStep('topic', { topic, theme })
      await log(`Topic: ${topic}`)
      await storiesDb.create({ story_id: storyId, topic, theme })
      await storiesDb.update(storyId, { category_id: categoryId || category?.id || 'kathakar' })
    }

    // ── Step 2: Write Script ────────────────────────────────────────────────
    let script
    if (run.script_json) {
      script = JSON.parse(run.script_json)
      await log(`Script loaded from cache (${script.total_scenes} scenes)`)
    } else {
      await log('Writing script...')
      await setStep('script')

      // Retry script generation up to 3 times (Gemini can fail validation)
      let lastErr: Error | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          script = await writeScript(storyId, topic, theme, categoryOverrides.script_writer)
          break
        } catch (e) {
          lastErr = e as Error
          await log(`  Script attempt ${attempt} failed: ${lastErr.message}`)
          if (attempt < 3) await sleep(2000)
        }
      }
      if (!script) throw lastErr!

      await setStep('script', { script_json: JSON.stringify(script) })
      await log(`Script: "${script.title_hindi}" — ${script.total_scenes} scenes`)
      await storiesDb.update(storyId, { scenes_count: script.total_scenes })
    }

    // ── Step 3: Generate Audio ──────────────────────────────────────────────
    const audioPath = `stories/${storyId}/audio/full_narration.mp3`
    if (!(await gcsExists(ctx, audioPath))) {
      await log('Generating narration audio...')
      await setStep('audio')
      const buf = await generateFullNarration(script.scenes, ctx)
      const audioUrl = await uploadBuffer(ctx, audioPath, buf, 'audio/mpeg')
      await log('Audio uploaded')
      await storiesDb.update(storyId, { audio_url: audioUrl, storage_path: `stories/${storyId}/` })
    } else {
      await log('Audio cached — skipping TTS')
    }

    // ── Step 4 + 5: Submit all → Poll all (parallel) ────────────────────────
    // Skip scenes already done in a previous run
    const existingJobs = await sceneJobsDb.getByStory(storyId)
    const doneSceneNums = new Set(
      existingJobs.filter(j => j.status === 'done').map(j => j.scene_num)
    )
    const scenesToProcess = script.scenes.filter((s: Scene) => !doneSceneNums.has(s.scene_num))

    if (scenesToProcess.length > 0) {
      await log(`Processing ${scenesToProcess.length} scenes (${doneSceneNums.size} already done)`)
      await setStep('veo_submit')

      const completedScenes = await processAllScenes(scenesToProcess, storyId, topic, ctx, log)

      // Upload all completed clip buffers to GCS
      await setStep('veo_poll')
      await log(`Uploading ${completedScenes.length} clips to GCS...`)

      await Promise.all(completedScenes.map(async ({ sceneNum, base64 }) => {
        const clipPath = `stories/${storyId}/clips/scene_${sceneNum}.mp4`
        if (!(await gcsExists(ctx, clipPath))) {
          await uploadBuffer(ctx, clipPath, Buffer.from(base64, 'base64'), 'video/mp4')
          await log(`  GCS: scene_${sceneNum}.mp4`)
        }
      }))
    } else {
      await log('All scenes already generated — skipping Veo')
    }

    // ── Step 6: Complete ────────────────────────────────────────────────────
    const allJobs = await sceneJobsDb.getByStory(storyId)
    const doneCount = allJobs.filter(j => j.status === 'done').length
    const manualCount = allJobs.filter(j => j.status === 'manual_pending').length

    await log(`Pipeline complete — ${doneCount} clips done, ${manualCount} need manual generation`)
    await setStep('complete')
    await storiesDb.update(storyId, {
      status: 'clips_ready',
      clips_generated_at: new Date().toISOString(),
      scenes_count: doneCount,
      ...(manualCount > 0 ? { notes: `${manualCount} scene(s) need manual regeneration — check Stories tab` } : {}),
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${storyId}] Pipeline failed:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}
