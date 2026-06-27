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
import { generateImage, editImageNano } from './imagen'
import { downloadGsUri } from '../gcs'
import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'

/** Force any image to true 9:16 (1080x1920) — nano-banana inherits the product's square shape,
 *  which Veo then boxes inside the vertical frame. Cover-crop keeps the centered mascot, no bars. */
const to916 = (buf: Buffer): Promise<Buffer> =>
  sharp(buf).resize(1080, 1920, { fit: 'cover', position: 'centre' }).png().toBuffer()

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

    // 1. Concept — the RESEARCHER produces an engagement-optimized, (Search-grounded) brief.
    await pipelineDb.setStep(storyId, 'topic')
    await log('Researching product + engagement angle...')
    const { researchBrief } = await import('./researcher')
    const concept = await researchBrief(product as unknown as Record<string, unknown>, ctx, productImage)
    if (concept.hook) await log(`Hook: ${String(concept.hook).slice(0, 90)}`)

    // 2. Script
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(8, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} scenes...`)
    const script = await callGemini(cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({ ...product, scenes_count: scenesWanted, ...concept }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} scenes that FOLLOW the ad_archetype + structure above (do NOT force a villain fight), each with a Hinglish spoken line. Return JSON.`,
      ctx, 0.85, productImage) as unknown as Record<string, unknown>
    const scenes = (script.scenes as { scene_num: number; beat?: string; action?: string; dialogue?: string }[]) || []
    await log(`Script: "${script.ad_title_hindi}" (${scenes.length} scenes)`)

    // 3. Storyboard stills — the preview the merchant approves (these become the video's keyframes).
    await pipelineDb.setStep(storyId, 'audio') // reuse label for "asset prep"
    const world = (script.world_description_en as string) || (concept.world_description_en as string) || ''
    const fullMascotPrompt = String(script.mascot_image_prompt || concept.mascot_image_prompt || '')
    const bucket = new Storage({ credentials: ctx.storageCredentials }).bucket(ctx.bucket)
    const stamp = Date.now()  // cache-bust: regenerate overwrites the same paths, so vary the URL

    // Build ONE product-faithful mascot first (nano-banana from the real product photo), then
    // EDIT that same mascot into each scene → consistent character + true to the product (fixes
    // the "3 different non-product mascots" problem of independent per-scene Imagen).
    let mascotBuf: Buffer | null = null
    if (productImage) {
      const editPrompt = `Turn this product into a LOVABLE cute mascot character (think M&M's, Cup Noodles, Mr. Clean-bottle) by adding personality DIRECTLY onto the product object: big expressive Pixar-style eyes with eyebrows, a warm charming smile, and tiny cute stub arms — full of charm and emotion. CRITICAL: the mascot IS this exact product — keep its real shape, proportions, colours and label 100% UNCHANGED, and add NO human body (no legs, no torso, no standing humanoid figure, no superhero). It is the product object brought to life with a face + tiny arms. Premium glossy 3D, expressive and adorable, soft clean studio background, whole product centered, vertical 9:16.`
      try {
        await log('Designing the product mascot (nano-banana)...')
        mascotBuf = await to916(await editImageNano(Buffer.from(productImage.data, 'base64'), productImage.mimeType, editPrompt, ctx))
        await bucket.file(`stories/${storyId}/mascot.png`).save(mascotBuf, { contentType: 'image/png', resumable: false })
      } catch (e) { await log(`mascot sheet failed (${e instanceof Error ? e.message : e}); using text stills`) }
    }

    await log(`Rendering ${scenes.length} preview stills (no Veo)...`)
    const stills: { scene_num: number; url: string; action?: string; dialogue?: string; beat?: string }[] = []
    for (const s of scenes) {
      const sn = String(s.scene_num).padStart(2, '0')
      try {
        let buf: Buffer
        if (mascotBuf) {
          // Place the SAME mascot into this scene. CRITICAL: lock the product's identity AND its
          // scale/framing. Wide "in this landscape" prompts make nano SHRINK the bottle + add legs
          // (the #1 cause of the character changing between clips — e.g. a tiny bottle with legs in
          // a wide field). And ban text — nano paints sign/placard words otherwise. On failure
          // REUSE the base mascot (never an independent Imagen render → that's a different character).
          const scenePrompt = `Place THIS exact mascot (the product object with a cute face) onto a new background: ${world}.
ABSOLUTE CONSISTENCY: keep the mascot 100% IDENTICAL to the input image — same product shape, silhouette, proportions, SIZE, colours, label and face. Do NOT redesign it, do NOT shrink it, do NOT add arms, legs, a body, or turn it into a person/superhero. It stays the product object with a cute face.
FRAMING (identical in EVERY scene): the mascot is the HERO — centered and large, filling ~70-80% of the vertical 9:16 frame (medium/close shot). NEVER tiny or far away in a wide landscape; the world is only a soft backdrop BEHIND it.
NO text, words, letters, numbers, signs, placards, speech bubbles or writing anywhere in the image. Premium Pixar-style 3D, cinematic lighting, vertical 9:16.`
          buf = await editImageNano(mascotBuf, 'image/png', scenePrompt, ctx).catch(() => mascotBuf!)
        } else {
          buf = await generateImage(`${world}. ${s.action || s.beat || ''}. The product mascot: ${fullMascotPrompt}. Premium Pixar-style 3D, cinematic lighting, vertical 9:16, no text or letters.`, ctx)
        }
        const path = `stories/${storyId}/storyboard/scene_${sn}.png`
        await bucket.file(path).save(await to916(buf), { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'public, max-age=60' } })
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
