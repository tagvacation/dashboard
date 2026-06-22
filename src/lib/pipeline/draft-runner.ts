/**
 * DRAFT runner — the cheap "see it before you pay for Veo" step.
 *
 * Generates the mascot CONCEPT + SCRIPT + one Imagen STILL per scene (no Veo), stores them on
 * the story as status='draft', and saves the script so that — once the merchant APPROVES —
 * the real pipeline renders the EXACT story they previewed (no re-rolling the concept).
 *
 * Cost: a few Imagen stills (~₹5 each) vs ~₹500 for a full Veo render — so concepts are
 * reviewed (and rejected) cheaply.
 */
import { sql, pipelineDb, storiesDb } from '../db'
import { loadGcpContext } from './auth'
import { callGemini } from './ad-runner'
import { generateImage } from './imagen'
import { downloadGsUri } from '../gcs'
import { Storage } from '@google-cloud/storage'

interface DraftMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; ingredients?: string | null; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null
  credentialId?: string | null
}

export async function runMascotDraft(storyId: string): Promise<void> {
  const log = async (msg: string) => { await pipelineDb.appendLog(storyId, msg); console.log(`[draft ${storyId}] ${msg}`) }
  try {
    await log('Draft (storyboard preview) started')
    const run = await pipelineDb.get(storyId)
    if (!run) throw new Error('Pipeline run not found')
    const meta = run.operation_ids as unknown as DraftMeta
    if (!meta?.product) throw new Error('Product details missing')
    const product = meta.product

    const ctx = await loadGcpContext(meta.credentialId)
    await log(`Cloud Account: ${ctx.projectId}`)

    let productImage: { data: string; mimeType: string } | undefined
    if (meta.imageGcsUri) {
      try {
        const buf = await downloadGsUri(meta.imageGcsUri, ctx)
        const mt = meta.imageGcsUri.endsWith('.jpg') || meta.imageGcsUri.endsWith('.jpeg') ? 'image/jpeg' : meta.imageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
        productImage = { data: buf.toString('base64'), mimeType: mt }
      } catch { /* draft from text */ }
    }

    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_mascot_drama'`
    if (!cat) throw new Error('ai_ad_mascot_drama category not found')

    // 1. Concept
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing concept...')
    const concept = await callGemini(cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product. Invent the mascot hero + villain + story. Return JSON only.`,
      ctx, 0.95, productImage)

    // 2. Script
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(8, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} scenes...`)
    const script = await callGemini(cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({ ...product, scenes_count: scenesWanted, ...concept }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} action scenes with Hinglish dialogue. Return JSON.`,
      ctx, 0.85, productImage) as unknown as Record<string, unknown>
    const scenes = (script.scenes as { scene_num: number; beat?: string; action?: string; dialogue?: string }[]) || []
    await log(`Script: "${script.ad_title_hindi}" (${scenes.length} scenes)`)

    // 3. Cheap Imagen stills (one per scene) — the preview the merchant approves.
    await pipelineDb.setStep(storyId, 'audio') // reuse label for "asset prep"
    await log(`Rendering ${scenes.length} preview stills (Imagen, no Veo)...`)
    const world = (script.world_description_en as string) || (concept.world_description_en as string) || ''
    const mascotBrief = String(script.mascot_image_prompt || concept.mascot_image_prompt || '').split(/[.,]/).slice(0, 2).join(', ')
    const bucket = new Storage({ credentials: ctx.credentials }).bucket(ctx.bucket)
    const stamp = Date.now()  // cache-bust: regenerate overwrites the same paths, so vary the URL
    const stills: { scene_num: number; url: string; action?: string; dialogue?: string; beat?: string }[] = []
    for (const s of scenes) {
      const sn = String(s.scene_num).padStart(2, '0')
      const prompt = `${world}. ${s.action || s.beat || ''}. Featuring the product mascot (${mascotBrief}). Premium Pixar-style 3D, dynamic, cinematic lighting, vertical 9:16, no text or letters.`
      try {
        const buf = await generateImage(prompt, ctx)
        const path = `stories/${storyId}/storyboard/scene_${sn}.png`
        await bucket.file(path).save(buf, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'public, max-age=60' } })
        stills.push({ scene_num: s.scene_num, url: `https://storage.googleapis.com/${ctx.bucket}/${path}?v=${stamp}`, action: s.action, dialogue: s.dialogue, beat: s.beat })
        await log(`  still ${sn} ✓`)
      } catch (e) { await log(`  still ${sn} failed: ${e instanceof Error ? e.message : e}`) }
    }

    // 4. Persist the draft: store the EXACT concept + script so approve renders THIS story.
    const newMeta = { ...meta, draftConcept: concept, draftStills: stills }
    await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(newMeta)))}, script_json = ${JSON.stringify(script)} WHERE story_id = ${storyId}`
    await storiesDb.update(storyId, { status: 'draft', scenes_count: scenes.length, topic: `${product.name} — Mascot Ad` })
    await pipelineDb.setStep(storyId, 'draft')
    await log(`Draft ready: ${stills.length} stills`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[draft ${storyId}] FATAL:`, msg)
    await pipelineDb.appendLog(storyId, `ERROR: ${msg}`)
    await pipelineDb.setStep(storyId, 'failed', { error: msg })
    await storiesDb.update(storyId, { status: 'failed', notes: `Draft error: ${msg}` }).catch(() => {})
  }
}
