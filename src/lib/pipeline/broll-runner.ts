/**
 * Product B-roll pipeline — cinematic atmosphere footage that sells the FEELING of a product
 * (ingredient splashes, swirling textures, falling petals, macro droplets, molecular reveals,
 * mood shots). Gemini designs ONE cohesive theme + N distinct cinematic shots per product.
 *
 * Flow: Gemini concept (theme + hero elements) → Gemini script (silent B-roll shots) →
 * Veo TEXT-to-video per scene (no human, no product-label problem), SILENT → composite
 * (crossfades + background music) — reuses composeModelVideo. Same web→queue→worker path.
 */
import { sql, pipelineDb, sceneJobsDb, storiesDb } from '../db'
import { loadGcpContext } from './auth'
import { generateVeoClip } from './veo'
import { callGemini } from './ad-runner'
import { composeModelVideo } from './ad-composite'
import { downloadGsUri } from '../gcs'

const BROLL_VEO_MODEL = process.env.BROLL_VEO_MODEL || 'veo-3.1-generate-001'

interface BrollMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; ingredients?: string | null; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null
  music?: string | null
  credentialId?: string | null
}

interface BrollScene { scene_num: number; shot?: string; video_prompt: string }
interface BrollScript { title?: string; theme_en?: string; scenes: BrollScene[]; total_scenes: number }

function mimeFor(uri: string): string {
  return uri.endsWith('.jpg') || uri.endsWith('.jpeg') ? 'image/jpeg' : uri.endsWith('.webp') ? 'image/webp' : 'image/png'
}

export async function runBrollAdPipeline(storyId: string): Promise<void> {
  const log = async (msg: string) => { await pipelineDb.appendLog(storyId, msg); console.log(`[broll ${storyId}] ${msg}`) }

  try {
    await log('Product B-roll pipeline started')
    const run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found')
    const meta = run.operation_ids as unknown as BrollMeta
    if (!meta?.product) throw new Error('Product details missing')
    const product = meta.product

    const ctx = await loadGcpContext(meta.credentialId)
    await log(`Cloud Account: ${ctx.projectId} (bucket: ${ctx.bucket})`)

    // Ground the concept on the real product photo if provided (colours/ingredients/mood).
    let productImage: { data: string; mimeType: string } | undefined
    if (meta.imageGcsUri) {
      try {
        const buf = await downloadGsUri(meta.imageGcsUri, ctx)
        productImage = { data: buf.toString('base64'), mimeType: mimeFor(meta.imageGcsUri) }
      } catch (e) { await log(`(image grounding unavailable: ${e instanceof Error ? e.message : e})`) }
    }

    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_broll'
    `
    if (!cat) throw new Error('ai_ad_broll category not found — run scripts/update-ad-prompts-broll.mjs')

    // 1. Concept (theme + hero elements)
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing B-roll theme...')
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product. Return JSON only.`,
      ctx, 0.9, productImage,
    )

    // 2. Script (silent cinematic shots)
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(6, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} cinematic B-roll shots...`)
    const script = await callGemini(
      cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({ ...product, ...concept, scenes_count: scenesWanted }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} DISTINCT silent cinematic B-roll shots within ONE cohesive theme; no people, no text, no readable product label.${product.ingredients ? ' Dedicate ONE shot to the key ingredients (real ingredients in water, or a molecular visualization).' : ''} Return JSON.`,
      ctx, 0.85, productImage,
    ) as unknown as BrollScript
    await log(`Script: "${script.title || product.name}" (${script.scenes.length} shots)`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Product B-roll` })

    // 3. Veo per scene — TEXT-to-video, SILENT
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} B-roll shots...`)
    for (const scene of script.scenes) {
      await sceneJobsDb.create({
        story_id: storyId, scene_num: String(scene.scene_num).padStart(2, '0'),
        beat: scene.shot || 'broll', video_prompt: scene.video_prompt, tts_text: '',
        primary_anchor: 'broll', secondary_anchor: '', attempt: 1,
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
      if (await pipelineDb.isCancelled(storyId)) { release(); return { sn, ok: false } }  // stopped → skip remaining
      try {
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        // Text-to-video (no image), silent. Auto-retry the transient "No video" glitch.
        const base64 = await generateVeoClip(scene.video_prompt, ctx, {
          model: BROLL_VEO_MODEL, generateAudio: false, attempts: 3,
        })
        const { Storage } = await import('@google-cloud/storage')
        await new Storage({ credentials: ctx.storageCredentials }).bucket(ctx.bucket)
          .file(`stories/${storyId}/clips/scene_${sn}.mp4`).save(Buffer.from(base64, 'base64'), { contentType: 'video/mp4', resumable: false })
        await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
        await log(`  ✓ Shot ${sn}`)
        release(); return { sn, ok: true }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        await sceneJobsDb.update(storyId, sn, 1, { status: err.startsWith('CONTENT_FILTER:') ? 'filtered' : 'failed', error_message: err })
        await log(`  ✗ Shot ${sn}: ${err.slice(0, 100)}`)
        release(); return { sn, ok: false }
      }
    }))

    const sceneNums: string[] = []
    script.scenes.forEach((scene, i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.ok) sceneNums.push(String(scene.scene_num).padStart(2, '0'))
    })
    const done = sceneNums.length
    if (await pipelineDb.isCancelled(storyId)) {
      await log('Generation stopped by user')
      await storiesDb.update(storyId, { status: 'failed', notes: 'Stopped by you', scenes_count: done })
      await pipelineDb.setStep(storyId, 'failed')
      return
    }
    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(), scenes_count: done,
      notes: results.length - done > 0 ? `${results.length - done} shot(s) failed` : '',
    })
    await log(`Veo: ${done}/${script.scenes.length} shots done`)

    // 4. Composite (silent + music) — same compositor as the model video.
    if (done > 0) {
      try {
        await log('Compositing B-roll + music...')
        const finalUrl = await composeModelVideo({ storyId, sceneNums, music: meta.music || null, ctx })
        await sql`UPDATE stories SET final_url = ${finalUrl}, status = 'post_produced' WHERE story_id = ${storyId}`
        await log(`✓ Final B-roll ready: ${finalUrl}`)
      } catch (e) {
        await log(`Composite failed (clips still available): ${e instanceof Error ? e.message : e}`)
      }
    }

    await pipelineDb.setStep(storyId, done > 0 ? 'complete' : 'failed')
    await log('Pipeline complete')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[broll ${storyId}] FATAL:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Error: ${msg}` }).catch(() => {})
  }
}
