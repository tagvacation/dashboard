/**
 * Live-Model video pipeline — realistic shoppable clips of a model wearing/using the product.
 *
 * Flow: Gemini concept + scenes → base model image (the user-picked model photo, else an
 * Imagen-generated model) → Veo image-to-video per scene (SAME model, subtle realistic motion,
 * SILENT) → composite (crossfades + background music) → reel + lightweight preview.
 */
import { sql, pipelineDb, sceneJobsDb, storiesDb } from '../db'
import { loadGcpContext } from './auth'
import { generateVeoClip } from './veo'
import { callGemini } from './ad-runner'
import { generateMascotToGcs } from './imagen'
import { composeModelVideo } from './ad-composite'
import { downloadGsUri } from '../gcs'

const MODEL_VEO_MODEL = process.env.MODEL_VEO_MODEL || 'veo-3.1-generate-001'

interface ModelMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null       // picked model/product photo → animated directly if present
  modelImages?: string[] | null    // multiple angles (front/back/side) → distributed across scenes
  music?: string | null
  credentialId?: string | null
}

interface ModelScene { scene_num: number; shot?: string; video_prompt: string }
interface ModelScript { title?: string; model_image_prompt?: string; setting_en?: string; scenes: ModelScene[]; total_scenes: number }

function mimeFor(uri: string): string {
  return uri.endsWith('.jpg') || uri.endsWith('.jpeg') ? 'image/jpeg' : uri.endsWith('.webp') ? 'image/webp' : 'image/png'
}

export async function runModelVideoPipeline(storyId: string): Promise<void> {
  const log = async (msg: string) => { await pipelineDb.appendLog(storyId, msg); console.log(`[model ${storyId}] ${msg}`) }

  try {
    await log('Live-model pipeline started')
    const run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found')
    const meta = run.operation_ids as unknown as ModelMeta
    if (!meta?.product) throw new Error('Product details missing')
    const product = meta.product

    const ctx = await loadGcpContext(meta.credentialId)
    await log(`Cloud Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)

    // Ground concept on the provided image if any.
    let productImage
    if (meta.imageGcsUri) {
      try {
        const buf = await downloadGsUri(meta.imageGcsUri, ctx)
        productImage = { data: buf.toString('base64'), mimeType: mimeFor(meta.imageGcsUri) }
      } catch (e) { await log(`(image grounding unavailable: ${e instanceof Error ? e.message : e})`) }
    }

    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_model_video'
    `
    if (!cat) throw new Error('ai_ad_model_video category not found — run scripts/update-ad-prompts-model.mjs')

    // 1. Concept
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing model concept...')
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product/model. Return JSON only.`,
      ctx, 0.9, productImage,
    )

    // 2. Script (silent scenes)
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(6, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} model scenes...`)
    const multiAngle = (meta.modelImages?.length || 0) > 1
    const script = await callGemini(
      cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({ ...product, ...concept, scenes_count: scenesWanted }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} SILENT scenes; the SAME model, subtle realistic motion, product clearly visible.${multiAngle ? ' Multiple reference angles (e.g. front AND back) are available — include at least one scene that clearly shows the BACK/side of the product.' : ''} Return JSON.`,
      ctx, 0.8, productImage,
    ) as unknown as ModelScript
    await log(`Script: "${script.title || product.name}" (${script.scenes.length} scenes)`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Live Model` })

    // 3. Base model image(s): animate the picked photo(s), else generate a model via Imagen.
    let baseImages: string[] = (meta.modelImages && meta.modelImages.length)
      ? meta.modelImages
      : (meta.imageGcsUri ? [meta.imageGcsUri] : [])
    if (baseImages.length === 0) {
      await pipelineDb.setStep(storyId, 'audio')  // reuse step label for asset prep
      await log('No model photo — generating a model (Imagen)...')
      const prompt = script.model_image_prompt || (concept.model_image_prompt as string)
      if (!prompt) throw new Error('No model_image_prompt from Gemini')
      const { gcsUri } = await generateMascotToGcs(prompt, ctx, storyId)
      baseImages = [gcsUri]
    }
    await log(`Base model image(s): ${baseImages.length} → ${baseImages.map(u => u.split('/').pop()).join(', ')}`)

    // 4. Veo per scene — image-to-video from the SAME base image, SILENT
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} model scenes...`)
    for (const scene of script.scenes) {
      await sceneJobsDb.create({
        story_id: storyId, scene_num: String(scene.scene_num).padStart(2, '0'),
        beat: scene.shot || 'model', video_prompt: scene.video_prompt, tts_text: '',
        primary_anchor: 'model', secondary_anchor: '', attempt: 1,
      })
    }

    const MAX = 2
    let active = 0
    const queue: (() => void)[] = []
    const acquire = () => new Promise<void>(res => { if (active < MAX) { active++; res() } else queue.push(() => { active++; res() }) })
    const release = () => { active--; const n = queue.shift(); if (n) n() }

    const results = await Promise.allSettled(script.scenes.map(async (scene, idx) => {
      await acquire()
      const sn = String(scene.scene_num).padStart(2, '0')
      // Rotate through the provided angles so e.g. the back image drives a back-showing scene.
      const baseImg = baseImages[idx % baseImages.length]
      try {
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        // Auto-retry (handles the transient "No video in response" glitch). Silent clip.
        const base64 = await generateVeoClip(scene.video_prompt, ctx, {
          model: MODEL_VEO_MODEL, imageRef: { gcsUri: baseImg, mimeType: mimeFor(baseImg) },
          generateAudio: false, attempts: 3,
        })
        const { Storage } = await import('@google-cloud/storage')
        await new Storage({ credentials: ctx.credentials }).bucket(ctx.bucket)
          .file(`stories/${storyId}/clips/scene_${sn}.mp4`).save(Buffer.from(base64, 'base64'), { contentType: 'video/mp4', resumable: false })
        await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
        await log(`  ✓ Scene ${sn}`)
        release(); return { sn, ok: true }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        await sceneJobsDb.update(storyId, sn, 1, { status: err.startsWith('CONTENT_FILTER:') ? 'filtered' : 'failed', error_message: err })
        await log(`  ✗ Scene ${sn}: ${err.slice(0, 100)}`)
        release(); return { sn, ok: false }
      }
    }))

    const sceneNums: string[] = []
    script.scenes.forEach((scene, i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.ok) sceneNums.push(String(scene.scene_num).padStart(2, '0'))
    })
    const done = sceneNums.length
    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(), scenes_count: done,
      notes: results.length - done > 0 ? `${results.length - done} scene(s) failed` : '',
    })
    await log(`Veo: ${done}/${script.scenes.length} scenes done`)

    // 5. Composite (silent + music)
    if (done > 0) {
      try {
        await log('Compositing slider + music...')
        const finalUrl = await composeModelVideo({ storyId, sceneNums, music: meta.music || null, ctx })
        await sql`UPDATE stories SET final_url = ${finalUrl}, status = 'post_produced' WHERE story_id = ${storyId}`
        await log(`✓ Final model video ready: ${finalUrl}`)
      } catch (e) {
        await log(`Composite failed (clips still available): ${e instanceof Error ? e.message : e}`)
      }
    }

    await pipelineDb.setStep(storyId, done > 0 ? 'complete' : 'failed')
    await log('Pipeline complete')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[model ${storyId}] FATAL:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}
