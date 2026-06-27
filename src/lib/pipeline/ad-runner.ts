/**
 * AI Ad Pipeline Runner.
 *
 * Flow: Gemini concept → script → chunked TTS → Veo clips (image-to-video) → ffmpeg merge → final.mp4
 */
import { Storage } from '@google-cloud/storage'
import { sql, pipelineDb, sceneJobsDb, storiesDb } from '../db'
import { loadGcpContext, getAccessToken } from './auth'
import type { GcpContext } from './auth'
import { submitVeoClip, pollVeoOperation } from './veo'
import { generateFullNarration } from './tts'
import { composeAd, type ComposeScene } from './ad-composite'
import { downloadGsUri } from '../gcs'
import { fetchWithRetry } from './fetch-retry'

// Hybrid ads: Veo only makes product-free b-roll, so the heavy Full model isn't required.
// Default to Full for realism; set AD_VEO_MODEL to a cheaper tier (e.g. veo-3.1-lite-generate-001)
// to cut cost — the product is composited in post regardless of clip fidelity.
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
  cutoutGcsUri?: string | null   // transparent product cutout (composited in post)
  ad_style?: 'emotional' | 'mascot' | 'model' | 'broll' | 'auto'  // 'auto' = let the AI director decide
  voice?: string | null
  music?: string | null
  credentialId?: string | null   // which Cloud Account to use (null = env default)
}

interface AdSceneOverlay {
  product?: boolean                              // composite the product cutout this scene?
  product_motion?: 'rise' | 'zoom' | 'center'
  caption_hi?: string                            // short on-screen Hindi caption
}

interface AdScene {
  scene_num: number
  beat: string
  video_prompt: string       // Veo b-roll ONLY — no product, no text
  tts_text: string
  overlay?: AdSceneOverlay
}

interface AdScript {
  ad_title_hindi: string
  tagline_hindi: string
  voice_personality: string
  headline_hi?: string       // end-card headline
  price_text?: string        // end-card price line
  cta_hi?: string            // end-card CTA
  scenes: AdScene[]
  total_scenes: number
  total_duration_sec: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeStorage(ctx: GcpContext) {
  const storage = new Storage({ credentials: ctx.storageCredentials })
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

export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  ctx: GcpContext,
  temperature = 0.85,
  image?: { data: string; mimeType: string },   // inline product image for grounding
): Promise<Record<string, unknown>> {
  // Route Gemini through Vertex on the DEDICATED Gemini service account (GEMINI_SA_JSON) when set,
  // so cheap text doesn't burn the user's or the platform's main credits. Falls back to the caller's ctx.
  const { geminiContext } = await import('./auth')
  const gctx = geminiContext() || ctx
  const token = await getAccessToken(gctx)
  const url = `https://${gctx.region}-aiplatform.googleapis.com/v1/projects/${gctx.projectId}/locations/${gctx.region}/publishers/google/models/${GEMINI_MODEL}:generateContent`
  const parts: Record<string, unknown>[] = []
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  parts.push({ text: userPrompt })
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
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

    // AI Creative Director: when the merchant chose "Smart" (ad_style 'auto' / unset), decide
    // the format + voice + music from the product (vision), persist, then dispatch. The merchant
    // never has to pick — the director makes the calls a non-expert can't.
    if (!meta.ad_style || meta.ad_style === 'auto') {
      await pipelineDb.setStep(storyId, 'topic')
      await log('AI director analysing the product...')
      const ctxD = await loadGcpContext(meta.credentialId)
      let dImg: { data: string; mimeType: string } | undefined
      if (meta.imageGcsUri) {
        try {
          const b = await downloadGsUri(meta.imageGcsUri, ctxD)
          const mt = meta.imageGcsUri.endsWith('.jpg') || meta.imageGcsUri.endsWith('.jpeg') ? 'image/jpeg' : meta.imageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
          dImg = { data: b.toString('base64'), mimeType: mt }
        } catch { /* director still works from text */ }
      }
      const { runDirector } = await import('./director')
      const brief = await runDirector(meta.product, ctxD, dImg)
      // Smart mode: the merchant delegated these — the director's calls win.
      meta.ad_style = brief.ad_format
      if (brief.voice) meta.voice = brief.voice
      meta.music = brief.music_mood
      await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id = ${storyId}`
      await log(`Director → ${brief.ad_format} · voice: ${brief.voice || '(silent)'} · music: ${brief.music_mood}${brief.rationale ? ' — ' + brief.rationale : ''}`)
    }

    // Dispatch: mascot-drama + live-model + b-roll formats run entirely different pipelines.
    if (meta.ad_style === 'mascot') {
      const { runMascotAdPipeline } = await import('./mascot-runner')
      return runMascotAdPipeline(storyId)
    }
    if (meta.ad_style === 'model') {
      const { runModelVideoPipeline } = await import('./model-runner')
      return runModelVideoPipeline(storyId)
    }
    if (meta.ad_style === 'broll') {
      const { runBrollAdPipeline } = await import('./broll-runner')
      return runBrollAdPipeline(storyId)
    }

    const product = meta.product
    const imageGcsUri = meta.imageGcsUri
    const cutoutGcsUri = meta.cutoutGcsUri || null
    const credentialId = meta.credentialId

    // Resolve which Cloud Account to bill compute against
    const ctx = await loadGcpContext(credentialId)
    await log(`Cloud Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)
    await log(`Product: ${product.name} (${product.category})${imageGcsUri ? ' [grounded on real image]' : ''}`)

    // Download the real packshot once → pass inline to Gemini so concept + copy match
    // the actual product (avoids the "invented bottle" problem). Non-fatal if missing.
    let productImage: { data: string; mimeType: string } | undefined
    if (imageGcsUri) {
      try {
        const imgBuf = await downloadGsUri(imageGcsUri, ctx)
        const mimeType = imageGcsUri.endsWith('.jpg') || imageGcsUri.endsWith('.jpeg') ? 'image/jpeg'
          : imageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
        productImage = { data: imgBuf.toString('base64'), mimeType }
      } catch (e) {
        await log(`(image grounding unavailable: ${e instanceof Error ? e.message : e})`)
      }
    }

    // 2. Load AI Ad category prompts from DB
    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_talking_product'
    `
    if (!cat) throw new Error('ai_ad_talking_product category not found')

    // 3. Topic picker — product (+ image) → human-centric ad concept
    await pipelineDb.setStep(storyId, 'topic')
    await log(`Generating concept...`)
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image is the REAL product — ground all copy in it. Return JSON only.`,
      ctx, 0.95, productImage,
    )
    await log(`Tagline: ${concept.tagline_hindi}`)
    await log(`Voice: ${(concept.voice_personality as string)?.slice(0, 80)}`)

    // 4. Script writer — product-free Veo b-roll + per-scene overlay spec + end-card
    await pipelineDb.setStep(storyId, 'script')
    await log(`Generating script...`)
    const script = await callGemini(
      cat.prompt_script_writer,
      `Ad concept input:\n${JSON.stringify({
        product_name: product.name, category: product.category, benefits: product.benefits,
        target_audience: product.target_audience, tone: product.tone, duration_sec: product.duration_sec,
        price: product.price,
        ad_concept: concept.ad_concept, persona: concept.persona, emotional_arc: concept.emotional_arc,
        tagline_hindi: concept.tagline_hindi, headline_hi: concept.headline_hi, cta_hi: concept.cta_hi,
        voice_personality: concept.voice_personality, scenes_count: concept.scenes_count,
      }, null, 2)}\n\nEvery video_prompt is product-free b-roll (NO product, NO packaging, NO text, NO logos). Mark which scenes composite the product via overlay.product. Last scene's tts_text MUST include tagline_hindi verbatim. Return JSON.`,
      ctx, 0.85, productImage,
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

    // 6. Veo clips — product-free b-roll, semaphore 2 concurrent
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} b-roll clips (product composited in post)...`)

    // Insert scene_jobs rows (no product anchor — product is overlaid later)
    for (const scene of script.scenes) {
      const sn = String(scene.scene_num).padStart(2, '0')
      await sceneJobsDb.create({
        story_id: storyId,
        scene_num: sn,
        beat: scene.beat,
        video_prompt: scene.video_prompt,
        tts_text: scene.tts_text,
        primary_anchor: '',
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
      if (await pipelineDb.isCancelled(storyId)) { release(); return { sn, ok: false } }  // stopped → skip remaining
      try {
        if (await gcsExists(ctx, clipPath)) {
          await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
          await log(`  Scene ${sn} already exists`)
          release(); return { sn, ok: true }
        }
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        // No image conditioning — b-roll must NOT contain the product (composited later).
        const opId = await submitVeoClip(scene.video_prompt, ctx, AD_VEO_MODEL,
          undefined,
          true,  // generateAudio: ambient/SFX, mixed low under Hindi TTS in compositor
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

    // Map results back to scenes (allSettled preserves input order) → ordered successes.
    const successfulScenes: ComposeScene[] = []
    script.scenes.forEach((scene, i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.ok) {
        const ov = scene.overlay || {}
        successfulScenes.push({
          sceneNum: String(scene.scene_num).padStart(2, '0'),
          showProduct: ov.product ?? false,
          productMotion: ov.product_motion ?? 'center',
          captionHi: ov.caption_hi,
        })
      }
    })
    const done = successfulScenes.length
    const failed = results.length - done

    if (await pipelineDb.isCancelled(storyId)) {
      await log('Generation stopped by user')
      await storiesDb.update(storyId, { status: 'failed', notes: 'Stopped by you', scenes_count: done })
      await pipelineDb.setStep(storyId, 'failed')
      return
    }
    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(),
      scenes_count: done,
      notes: failed > 0 ? `${failed} scene(s) failed` : '',
    })
    await log(`Veo: ${done}/${script.scenes.length} b-roll clips done`)

    // ── Step 7: composite real product + text overlays + end-card → final.mp4 ──
    if (done > 0) {
      try {
        await log(`Compositing product + overlays via ffmpeg...`)
        const finalUrl = await composeAd({
          storyId,
          scenes: successfulScenes,
          endcard: {
            headlineHi: script.headline_hi || (concept.headline_hi as string) || script.tagline_hindi,
            priceText: script.price_text || (product.price ? `₹${product.price}` : undefined),
            ctaHi: script.cta_hi || (concept.cta_hi as string) || 'अभी ऑर्डर करें',
          },
          productCutoutGcsUri: cutoutGcsUri || imageGcsUri,  // prefer transparent cutout
          ctx,
        })
        await sql`UPDATE stories SET final_url = ${finalUrl}, status = 'post_produced' WHERE story_id = ${storyId}`
        await log(`✓ Final ad ready: ${finalUrl}`)
      } catch (mergeErr) {
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
        await log(`Composite failed (clips + audio still available separately): ${msg}`)
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
