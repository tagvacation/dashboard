/**
 * AI Ad Pipeline Runner.
 *
 * Flow: Gemini concept → script → chunked TTS → Veo clips (image-to-video) → ffmpeg merge → final.mp4
 */
import { Storage } from '@google-cloud/storage'
import { sql, pipelineDb, sceneJobsDb, storiesDb } from '../db'
import { defaultContext, loadGcpContext, getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { submitVeoClip, pollVeoOperation } from './veo'
import { generateFullNarration } from './tts'
import { mergeClipsWithAudio } from './merge'
import { fetchWithRetry } from './fetch-retry'

// AI Ads use the Full model — much better image-to-video fidelity than Lite.
// Override via env var if quota/cost is an issue.
const AD_VEO_MODEL = process.env.AD_VEO_MODEL || 'veo-3.1-generate-001'

void Storage // imported for ctx-aware storage below

interface AdMeta {
  product: {
    name: string
    category: string
    price?: number
    benefits: string[]
    target_audience: string
    tone: string
    duration_sec: number
  }
  imageGcsUri: string | null
  credentialId?: string | null   // which Cloud Account to use (null = env default)
}

interface AdScene {
  scene_num: number
  beat: string
  video_prompt: string
  tts_text: string
  caption?: string
}

interface AdScript {
  ad_title_hindi: string
  tagline_hindi: string
  product_visual_description_en: string  // new name (was product_anchor_en in monologue format)
  product_anchor_en?: string             // legacy field — kept for back-compat with older runs
  voice_personality: string
  scenes: AdScene[]
  total_scenes: number
  total_duration_sec: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeStorage(ctx: GcpContext) {
  const storage = new Storage({ credentials: ctx.credentials })
  const bucket = storage.bucket(ctx.bucket)
  const PUBLIC_BASE = `https://storage.googleapis.com/${ctx.bucket}`
  return { bucket, PUBLIC_BASE }
}

async function uploadBuffer(ctx: GcpContext, path: string, buf: Buffer, mimeType: string): Promise<string> {
  const { bucket, PUBLIC_BASE } = makeStorage(ctx)
  await bucket.file(path).save(buf, { contentType: mimeType, resumable: false })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(ctx: GcpContext, path: string): Promise<boolean> {
  const { bucket } = makeStorage(ctx)
  const [exists] = await bucket.file(path).exists()
  return exists
}

// ─── Gemini call (Vertex AI) ─────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash'

async function callGemini(systemPrompt: string, userPrompt: string, ctx: GcpContext, temperature = 0.85): Promise<Record<string, unknown>> {
  const token = await getAccessToken(ctx)
  const url = `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${GEMINI_MODEL}:generateContent`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  }, { label: 'gemini', timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini empty response')
  return JSON.parse(text)
}

// ─── Main runner ─────────────────────────────────────────────────────────────
export async function runAdPipeline(storyId: string): Promise<void> {
  const log = async (msg: string) => {
    await pipelineDb.appendLog(storyId, msg)
    console.log(`[ad ${storyId}] ${msg}`)
  }

  try {
    await log(`Ad pipeline started`)

    // 1. Load product details + cloud account selection from pipeline_run metadata
    const run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found')
    const meta = run.operation_ids as unknown as AdMeta
    if (!meta?.product) throw new Error('Product details missing in pipeline_run')

    const product = meta.product
    const imageGcsUri = meta.imageGcsUri
    const credentialId = meta.credentialId

    // Resolve which Cloud Account to bill compute against
    const ctx = await loadGcpContext(credentialId)
    await log(`Cloud Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)
    await log(`Product: ${product.name} (${product.category})${imageGcsUri ? ' [with reference image]' : ''}`)

    // 2. Load AI Ad category prompts from DB
    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_talking_product'
    `
    if (!cat) throw new Error('ai_ad_talking_product category not found')

    // 3. Topic picker — product details → ad concept
    await pipelineDb.setStep(storyId, 'topic')
    await log(`Generating concept...`)
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nReturn JSON only.`,
      ctx, 0.95,
    )
    await log(`Tagline: ${concept.tagline_hindi}`)
    await log(`Voice: ${(concept.voice_personality as string)?.slice(0, 80)}`)

    // 4. Script writer
    await pipelineDb.setStep(storyId, 'script')
    await log(`Generating script...`)
    // Concept fields could be either format (back-compat with old monologue runs):
    const productVisual = (concept.product_visual_description_en as string) || (concept.product_anchor_en as string) || ''
    const adversaryViz = (concept.adversary_visualization_en as string) || ''
    const heroMoment = (concept.hero_moment_description_en as string) || ''

    const script = await callGemini(
      cat.prompt_script_writer,
      `Ad concept input:\n${JSON.stringify({
        product_name: product.name, category: product.category, benefits: product.benefits,
        target_audience: product.target_audience, tone: product.tone, duration_sec: product.duration_sec,
        product_visual_description_en: productVisual,
        adversary_visualization_en: adversaryViz,
        hero_moment_description_en: heroMoment,
        tagline_hindi: concept.tagline_hindi,
        voice_personality: concept.voice_personality, scenes_count: concept.scenes_count,
      }, null, 2)}\n\nEach video_prompt for scenes 2-4 MUST include product_visual_description_en VERBATIM. Scene 1 does NOT include the product. Last scene's tts_text MUST include tagline_hindi verbatim. Return JSON.`,
      ctx, 0.85,
    ) as unknown as AdScript

    await log(`Script: "${script.ad_title_hindi}" (${script.scenes.length} scenes)`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — AI Ad` })

    // 5. Audio (chunked)
    await pipelineDb.setStep(storyId, 'audio')
    const audioPath = `stories/${storyId}/audio/full_narration.mp3`
    if (!(await gcsExists(ctx, audioPath))) {
      await log(`Generating audio...`)
      const buf = await generateFullNarration(script.scenes as unknown as Parameters<typeof generateFullNarration>[0], ctx)
      const audioUrl = await uploadBuffer(ctx, audioPath, buf, 'audio/mpeg')
      await storiesDb.update(storyId, { audio_url: audioUrl, storage_path: `stories/${storyId}/` })
      await log(`Audio uploaded`)
    }

    // 6. Veo clips — semaphore 2 concurrent, with optional image conditioning
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} clips${imageGcsUri ? ' (image-conditioned)' : ''}...`)

    // Insert scene_jobs rows
    for (const scene of script.scenes) {
      const sn = String(scene.scene_num).padStart(2, '0')
      await sceneJobsDb.create({
        story_id: storyId,
        scene_num: sn,
        beat: scene.beat,
        video_prompt: scene.video_prompt,
        tts_text: scene.tts_text,
        primary_anchor: script.product_visual_description_en || script.product_anchor_en || productVisual || '',
        secondary_anchor: '',
        attempt: 1,
      })
    }

    const MAX_CONCURRENT = 2
    let active = 0
    const queue: (() => void)[] = []
    const acquire = () => new Promise<void>(resolve => {
      if (active < MAX_CONCURRENT) { active++; resolve() }
      else queue.push(() => { active++; resolve() })
    })
    const release = () => { active--; const next = queue.shift(); if (next) next() }

    const results = await Promise.allSettled(script.scenes.map(async (scene) => {
      await acquire()
      const sn = String(scene.scene_num).padStart(2, '0')
      const clipPath = `stories/${storyId}/clips/scene_${sn}.mp4`
      try {
        if (await gcsExists(ctx, clipPath)) {
          await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
          await log(`  Scene ${sn} already exists`)
          release(); return { sn, ok: true }
        }
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        const opId = await submitVeoClip(scene.video_prompt, ctx, AD_VEO_MODEL,
          imageGcsUri ? {
            gcsUri: imageGcsUri,
            mimeType:
              imageGcsUri.endsWith('.jpg') || imageGcsUri.endsWith('.jpeg') ? 'image/jpeg' :
              imageGcsUri.endsWith('.webp') ? 'image/webp' :
              'image/png',
          } : undefined,
          true,  // generateAudio: ON for narrative ads (action SFX + ambient mixed with Hindi TTS later)
        )
        // Poll
        let base64: string | undefined
        for (let i = 0; i < 20; i++) {
          await sleep(60_000)
          const r = await pollVeoOperation(opId, ctx)
          if (!r.done) continue
          if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
          base64 = r.base64
          break
        }
        if (!base64) throw new Error('Veo timeout')

        const buf = Buffer.from(base64, 'base64')
        await uploadBuffer(ctx, clipPath, buf, 'video/mp4')
        await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
        await log(`  ✓ Scene ${sn}: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
        release()
        return { sn, ok: true }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        const isFilter = err.startsWith('CONTENT_FILTER:')
        await sceneJobsDb.update(storyId, sn, 1, {
          status: isFilter ? 'filtered' : 'failed',
          error_message: err,
        })
        await log(`  ✗ Scene ${sn}: ${err.slice(0, 100)}`)
        release()
        return { sn, ok: false }
      }
    }))

    const done = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
    const failed = results.length - done

    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(),
      scenes_count: done,
      notes: failed > 0 ? `${failed} scene(s) failed` : '',
    })
    await log(`Veo: ${done}/${script.scenes.length} clips done`)

    // ── Step 7: ffmpeg merge clips + audio → final.mp4 ─────────────────────
    if (done > 0) {
      try {
        await log(`Merging ${done} clips with audio via ffmpeg...`)
        const finalUrl = await mergeClipsWithAudio({
          storyId,
          sceneCount: done,
          ctx,
        })
        await sql`UPDATE stories SET final_url = ${finalUrl}, status = 'post_produced' WHERE story_id = ${storyId}`
        await log(`✓ Final reel ready: ${finalUrl}`)
      } catch (mergeErr) {
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
        await log(`Merge failed (clips + audio still available separately): ${msg}`)
      }
    }

    await pipelineDb.setStep(storyId, done > 0 ? 'complete' : 'failed')
    await log(`Pipeline complete`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ad ${storyId}] FATAL:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}
