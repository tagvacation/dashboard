/**
 * Mascot-drama AI ad pipeline.
 *
 * Flow: Gemini invents the mascot + villain + story (with Hindi dialogue) → Imagen
 * generates the mascot character sheet → Veo image-to-video per scene (same mascot
 * image every scene = consistency) with native Hindi dialogue/lip-sync → composite
 * (captions + optional real-product end-card).
 */
import { sql, pipelineDb, sceneJobsDb, storiesDb } from '../db'
import { loadGcpContext } from './auth'
import { submitVeoClip, pollVeoOperation } from './veo'
import { callGemini } from './ad-runner'
import { generateMascotToGcs } from './imagen'
import { composeMascotAd, type ComposeMascotScene } from './ad-composite'
import { downloadGsUri } from '../gcs'

const MASCOT_VEO_MODEL = process.env.MASCOT_VEO_MODEL || 'veo-3.1-generate-001'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface MascotMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null
  cutoutGcsUri?: string | null
  credentialId?: string | null
}

interface MascotScene {
  scene_num: number
  beat: string
  action?: string           // one-line visual summary (storyboard)
  dialogue?: string         // Hinglish spoken line (storyboard)
  video_prompt: string      // image-to-video from mascot, includes the Hinglish dialogue
}

interface MascotScript {
  ad_title_hindi: string
  tagline_hinglish: string
  mascot_image_prompt: string      // for Imagen
  world_description_en?: string     // shared setting injected into every scene for continuity
  voice_persona?: string            // one consistent voice injected into every scene
  headline_en?: string              // ENGLISH end-card headline
  cta_en?: string                   // ENGLISH end-card button
  scenes: MascotScene[]
  total_scenes: number
}

export async function runMascotAdPipeline(storyId: string): Promise<void> {
  const log = async (msg: string) => { await pipelineDb.appendLog(storyId, msg); console.log(`[mascot ${storyId}] ${msg}`) }

  try {
    await log('Mascot ad pipeline started')
    const run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found')
    const meta = run.operation_ids as unknown as MascotMeta
    if (!meta?.product) throw new Error('Product details missing')
    const product = meta.product

    const ctx = await loadGcpContext(meta.credentialId)
    await log(`Cloud Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)

    // Ground concept on the real product photo if provided.
    let productImage: { data: string; mimeType: string } | undefined
    if (meta.imageGcsUri) {
      try {
        const buf = await downloadGsUri(meta.imageGcsUri)
        const mimeType = meta.imageGcsUri.endsWith('.jpg') || meta.imageGcsUri.endsWith('.jpeg') ? 'image/jpeg'
          : meta.imageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
        productImage = { data: buf.toString('base64'), mimeType }
      } catch (e) { await log(`(image grounding unavailable: ${e instanceof Error ? e.message : e})`) }
    }

    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_mascot_drama'
    `
    if (!cat) throw new Error('ai_ad_mascot_drama category not found — run scripts/update-ad-prompts-mascot.mjs')

    // 1. Concept
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing mascot + villain + story...')
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product. Invent the mascot hero + villain + story. Return JSON only.`,
      ctx, 0.95, productImage,
    )
    await log(`Mascot: ${(concept.mascot_image_prompt as string)?.slice(0, 80)}`)

    // 2. Script — scene count scales with requested duration (8s per scene)
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(8, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} action scenes + dialogue...`)
    const script = await callGemini(
      cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({
        product_name: product.name, category: product.category, benefits: product.benefits,
        target_audience: product.target_audience, tone: product.tone, duration_sec: product.duration_sec, price: product.price,
        scenes_count: scenesWanted,
        ...concept,
      }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} action scenes. Every video_prompt is high-action, animates the SAME mascot (image-to-video) in the SAME world, and includes one short Hindi dialogue line in the consistent voice. Never render a human. Return JSON.`,
      ctx, 0.85, productImage,
    ) as unknown as MascotScript
    await log(`Script: "${script.ad_title_hindi}" (${script.scenes.length} scenes)`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Mascot Ad` })

    // 3. Imagen mascot character sheet
    await pipelineDb.setStep(storyId, 'audio')  // reuse step label for "asset prep"
    await log('Generating mascot character sheet (Imagen)...')
    const mascotPrompt = script.mascot_image_prompt || (concept.mascot_image_prompt as string)
    if (!mascotPrompt) throw new Error('No mascot_image_prompt from Gemini')
    const { gcsUri: mascotGcs } = await generateMascotToGcs(mascotPrompt, ctx, storyId)
    await log(`Mascot ready: ${mascotGcs}`)

    // 4. Veo per scene — image-to-video from the SAME mascot image, native dialogue
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} mascot scenes...`)
    for (const scene of script.scenes) {
      await sceneJobsDb.create({
        story_id: storyId, scene_num: String(scene.scene_num).padStart(2, '0'),
        beat: scene.beat, video_prompt: scene.video_prompt, tts_text: '',
        primary_anchor: 'mascot', secondary_anchor: '', attempt: 1,
      })
    }

    const MAX = 2
    let active = 0
    const queue: (() => void)[] = []
    const acquire = () => new Promise<void>(res => { if (active < MAX) { active++; res() } else queue.push(() => { active++; res() }) })
    const release = () => { active--; const n = queue.shift(); if (n) n() }

    const results = await Promise.allSettled(script.scenes.map(async (scene) => {
      await acquire()
      const sn = String(scene.scene_num).padStart(2, '0')
      try {
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        // Enforce the shared world + ONE consistent voice in every clip (continuity +
        // fixes the male/female voice flip across independent Veo clips).
        const prefix: string[] = []
        if (script.world_description_en) prefix.push(`Setting (identical every scene for continuity): ${script.world_description_en}`)
        if (script.voice_persona) prefix.push(`The mascot speaks in the SAME voice every scene: ${script.voice_persona}.`)
        const villain = concept.villain_description_en as string | undefined
        if (villain) prefix.push(`Villain (render identically whenever it appears): ${villain}`)
        const vp = prefix.length ? `${prefix.join('\n')}\n\n${scene.video_prompt}` : scene.video_prompt
        const opId = await submitVeoClip(vp, ctx, MASCOT_VEO_MODEL,
          { gcsUri: mascotGcs, mimeType: 'image/png' }, true)
        let base64: string | undefined
        for (let i = 0; i < 20; i++) {
          await sleep(30_000)
          const r = await pollVeoOperation(opId, ctx)
          if (!r.done) continue
          if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
          base64 = r.base64; break
        }
        if (!base64) throw new Error('Veo timeout')
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

    const successful: ComposeMascotScene[] = []
    script.scenes.forEach((scene, i) => {
      const r = results[i]
      // No burned-in captions (subtitles removed per feedback).
      if (r.status === 'fulfilled' && r.value.ok) successful.push({ sceneNum: String(scene.scene_num).padStart(2, '0') })
    })
    const done = successful.length
    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(), scenes_count: done,
      notes: results.length - done > 0 ? `${results.length - done} scene(s) failed` : '',
    })
    await log(`Veo: ${done}/${script.scenes.length} scenes done`)

    // 5. Composite
    if (done > 0) {
      try {
        await log('Compositing captions + end-card...')
        const finalUrl = await composeMascotAd({
          storyId, scenes: successful,
          endcard: {
            // English text on the end-card per feedback; no price line.
            headlineHi: script.headline_en || 'Radiant, Protected Skin',
            ctaHi: script.cta_en || 'Shop Now',
          },
          productCutoutGcsUri: meta.cutoutGcsUri || null,
          ctx,
        })
        await sql`UPDATE stories SET final_url = ${finalUrl}, status = 'post_produced' WHERE story_id = ${storyId}`
        await log(`✓ Final mascot ad ready: ${finalUrl}`)
      } catch (e) {
        await log(`Composite failed (clips still available): ${e instanceof Error ? e.message : e}`)
      }
    }

    await pipelineDb.setStep(storyId, done > 0 ? 'complete' : 'failed')
    await log('Pipeline complete')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[mascot ${storyId}] FATAL:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}
