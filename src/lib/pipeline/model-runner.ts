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
import { generateMascotToGcs, composeImageNano } from './imagen'
import { composeModelVideo } from './ad-composite'
import { downloadGsUri } from '../gcs'
import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'

/** Force any image to TRUE 9:16 (1080x1920) — nano-banana returns ~3:4, which Veo then boxes
 *  (model looks small). Cover-crop centre keeps full height (head→feet) and fills the frame. */
const to916 = (buf: Buffer): Promise<Buffer> =>
  sharp(buf).resize(1080, 1920, { fit: 'cover', position: 'centre' }).png().toBuffer()

const MODEL_VEO_MODEL = process.env.MODEL_VEO_MODEL || 'veo-3.1-generate-001'

type ViewKey = 'front' | 'back' | 'side' | 'closeup'
interface ModelViews { face?: string | null; front?: string | null; back?: string | null; side?: string | null; closeup?: string | null }

interface ModelMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null       // picked model/product photo → animated directly if present
  modelImages?: string[] | null    // LEGACY: multiple angles, distributed across scenes (no labels)
  modelViews?: ModelViews | null   // labeled views (face/front/back/side/closeup) → ANCHORED path
  music?: string | null
  credentialId?: string | null
}

interface ModelScene { scene_num: number; shot?: string; view?: ViewKey; motion?: string; video_prompt: string }
interface ModelScript { title?: string; model_image_prompt?: string; setting_en?: string; scenes: ModelScene[]; total_scenes: number }

function mimeFor(uri: string): string {
  return uri.endsWith('.jpg') || uri.endsWith('.jpeg') ? 'image/jpeg' : uri.endsWith('.webp') ? 'image/webp' : 'image/png'
}

const VIEW_DESC: Record<ViewKey, string> = {
  front: 'from the FRONT (the model faces the camera)',
  back: 'from BEHIND (the back of the outfit/product faces the camera; the face is turned away / not visible)',
  side: 'from the SIDE (a natural 3/4 side profile)',
  closeup: 'as a CLOSE-UP detail of the product/fabric',
}

/** Compose prompt: SAME person (image 1) wearing the EXACT outfit (image 2) in a given view + setting. */
function composePrompt(view: ViewKey, shot: string | undefined, setting: string): string {
  const closeup = view === 'closeup' || shot === 'closeup'
  const framing = closeup
    ? 'Tight, crisp CLOSE-UP on the product/fabric detail, premium and sharp.'
    : 'Full-body fashion shot; the model fills ~75% of a vertical 9:16 frame, standing naturally; a slightly WIDE lens so the model is prominent — never tiny or far away.'
  return `You are given TWO photos. The FIRST is the MODEL'S FACE/identity. The SECOND shows the OUTFIT/PRODUCT ${VIEW_DESC[view]}.
Create ONE photorealistic image of the SAME person from the first photo, wearing/using the EXACT outfit/product from the second photo, ${VIEW_DESC[view]}.
ABSOLUTE FIDELITY: keep the face & identity 100% from the first photo (same face, hair, skin tone); keep the ENTIRE outfit/product 100% from the second photo — top AND bottom, colours, pattern, cut, fabric, footwear, every detail. Do NOT invent, restyle, or change anything.
SETTING (identical in every scene for continuity): ${setting || 'a clean, stylish, softly-lit studio'}.
${framing}
Photorealistic, natural skin, professional fashion photography, vertical 9:16. No text, no watermark, no logos.`
}

/** Lively, view-appropriate motion for each view — keeps the side but makes the model actually move. */
const MOTION_HINT: Record<ViewKey, string> = {
  front: 'walks a step or two toward the camera with natural arm and hand gestures, a soft confident smile, hair and fabric flowing, weight shifting',
  back: 'walks a few graceful steps away with hair and fabric swaying, then a soft glance back over the shoulder (without fully turning around)',
  side: 'a graceful step in profile while turning only the head toward the camera, fabric and hair moving naturally',
  closeup: 'fingertips gently gliding over the fabric, the fabric and texture shifting softly, with a slow macro push-in',
}

/** Veo prompt: the model MOVES naturally but stays in its view (never spins to an unseen side). */
function veoViewPrompt(view: ViewKey, motion: string | undefined, setting: string): string {
  return [
    'Animate this image into a LIVELY, natural fashion video — the model MOVES visibly and naturally (this is video, not a still).',
    `Keep the model facing roughly the same ${view} direction — do NOT spin around to reveal the opposite side — but bring it to life: ${motion || MOTION_HINT[view]}.`,
    'Keep the FACE and the ENTIRE outfit 100% identical to the image (same person, same colours, pattern, cut, fabric).',
    setting ? `Setting: ${setting}` : '',
    'Smooth cinematic camera movement (a slow push-in, gentle dolly or subtle orbit). Photorealistic, soft natural lighting, full vertical 9:16 frame. Silent. No new people, no text, no logos, avoid distorted hands.',
  ].filter(Boolean).join('\n')
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

    // Labeled views (face/front/back/side/closeup) → ANCHORED path; else legacy round-robin.
    const views = meta.modelViews || null
    const availableViews: ViewKey[] = (['front', 'back', 'side', 'closeup'] as ViewKey[]).filter(v => views?.[v])
    const anchored = availableViews.length > 0
    if (anchored) await log(`Anchored model views: ${availableViews.join(', ')}${views?.face ? ' (+face identity)' : ''}`)

    // 1. Concept
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing model concept...')
    const concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product/model.${anchored ? ` Reference views available: ${availableViews.join(', ')}.` : ''} Return JSON only.`,
      ctx, 0.9, productImage,
    )

    // 2. Script (silent scenes)
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(6, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} model scenes...`)
    const scriptViews = anchored ? availableViews : ((meta.modelImages?.length || 0) > 1 ? ['front', 'back'] : ['front'])
    const script = await callGemini(
      cat.prompt_script_writer,
      `Concept input:\n${JSON.stringify({ ...product, ...concept, available_views: scriptViews, scenes_count: scenesWanted }, null, 2)}\n\nProduce EXACTLY ${scenesWanted} SILENT scenes. Each scene's "view" MUST be one of available_views (${scriptViews.join(', ')}); the model STAYS in that view (never turns to a different side); subtle realistic motion; product clearly visible. Return JSON.`,
      ctx, 0.8, productImage,
    ) as unknown as ModelScript
    await log(`Script: "${script.title || product.name}" (${script.scenes.length} scenes)`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Live Model` })

    // 3. Scene jobs (view-agnostic) + shared helpers.
    await pipelineDb.setStep(storyId, 'veo_submit')
    await log(`Generating ${script.scenes.length} model scenes${anchored ? ' (view-anchored)' : ''}...`)
    for (const scene of script.scenes) {
      await sceneJobsDb.create({
        story_id: storyId, scene_num: String(scene.scene_num).padStart(2, '0'),
        beat: scene.view || scene.shot || 'model', video_prompt: scene.video_prompt, tts_text: '',
        primary_anchor: 'model', secondary_anchor: '', attempt: 1,
      })
    }
    const setting = (script.setting_en as string) || (concept.setting_en as string) || ''
    const bucket = () => new Storage({ credentials: ctx.storageCredentials }).bucket(ctx.bucket)
    const saveClip = (sn: string, base64: string) =>
      bucket().file(`stories/${storyId}/clips/scene_${sn}.mp4`).save(Buffer.from(base64, 'base64'), { contentType: 'video/mp4', resumable: false })

    type SceneRes = { sn: string; ok: boolean; filtered: boolean }
    const MAX = 2
    const pool = () => {
      let active = 0; const q: (() => void)[] = []
      return {
        acquire: () => new Promise<void>(r => { if (active < MAX) { active++; r() } else q.push(() => { active++; r() }) }),
        release: () => { active--; const n = q.shift(); if (n) n() },
      }
    }
    const settleRes = (rs: PromiseSettledResult<SceneRes>[]): SceneRes[] =>
      rs.map(r => r.status === 'fulfilled' ? r.value : { sn: '??', ok: false, filtered: false })

    // ANCHORED: per scene, compose [face + the MATCHING view] → still → Veo with motion LOCKED to
    // that view (never turns to reveal an unseen side). Face = identity anchor across all scenes.
    const runAnchored = async (): Promise<SceneRes[]> => {
      const faceUri = views!.face || views![availableViews[0]]!
      let faceImg: { data: Buffer; mimeType: string } | null = null
      try { faceImg = { data: await downloadGsUri(faceUri, ctx), mimeType: mimeFor(faceUri) } } catch { /* no identity → raw view */ }
      const viewCache: Partial<Record<ViewKey, { data: Buffer; mimeType: string }>> = {}
      const getView = async (vk: ViewKey) => viewCache[vk] || (viewCache[vk] = { data: await downloadGsUri(views![vk]!, ctx), mimeType: mimeFor(views![vk]!) })
      const { acquire, release } = pool()
      const settled = await Promise.allSettled(script.scenes.map(async (scene): Promise<SceneRes> => {
        await acquire()
        const sn = String(scene.scene_num).padStart(2, '0')
        const vk: ViewKey = (scene.view && availableViews.includes(scene.view)) ? scene.view : availableViews[0]
        if (await pipelineDb.isCancelled(storyId)) { release(); return { sn, ok: false, filtered: false } }
        try {
          await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
          // Per-scene still: SAME face + EXACT outfit in this view. Falls back to the raw view
          // photo if compose fails, so we still get a clip.
          const stillPath = `stories/${storyId}/storyboard/scene_${sn}.png`
          let firstFrame: string
          try {
            if (!faceImg) throw new Error('no face image')
            // Compose [face + view] then force TRUE 9:16 so Veo fills the frame (no boxing/shrink).
            const still = await to916(await composeImageNano([faceImg, await getView(vk)], composePrompt(vk, scene.shot, setting), ctx))
            await bucket().file(stillPath).save(still, { contentType: 'image/png', resumable: false })
            firstFrame = `gs://${ctx.bucket}/${stillPath}`
            await log(`  ✓ still ${sn} (${vk})`)
          } catch (e) {
            // Compose failed → normalize the raw view photo to 9:16 and use that.
            try {
              await bucket().file(stillPath).save(await to916((await getView(vk)).data), { contentType: 'image/png', resumable: false })
              firstFrame = `gs://${ctx.bucket}/${stillPath}`
            } catch { firstFrame = views![vk]! }
            await log(`  still ${sn} compose failed (${e instanceof Error ? e.message : e}) → using ${vk} photo`)
          }
          const base64 = await generateVeoClip(veoViewPrompt(vk, scene.motion, setting), ctx, {
            model: MODEL_VEO_MODEL, imageRef: { gcsUri: firstFrame, mimeType: mimeFor(firstFrame) }, generateAudio: false, attempts: 3,
          })
          await saveClip(sn, base64)
          await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
          await log(`  ✓ Scene ${sn} (${vk})`)
          release(); return { sn, ok: true, filtered: false }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          const filtered = err.startsWith('CONTENT_FILTER:')
          await sceneJobsDb.update(storyId, sn, 1, { status: filtered ? 'filtered' : 'failed', error_message: err })
          await log(`  ✗ Scene ${sn}: ${err.slice(0, 100)}`)
          release(); return { sn, ok: false, filtered }
        }
      }))
      return settleRes(settled)
    }

    // LEGACY: round-robin the provided/base image(s) as the Veo first frame (no face anchor).
    const runLegacy = async (imgs: string[]): Promise<SceneRes[]> => {
      const { acquire, release } = pool()
      const settled = await Promise.allSettled(script.scenes.map(async (scene, idx): Promise<SceneRes> => {
        await acquire()
        const sn = String(scene.scene_num).padStart(2, '0')
        const baseImg = imgs[idx % imgs.length]
        if (await pipelineDb.isCancelled(storyId)) { release(); return { sn, ok: false, filtered: false } }
        try {
          await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
          const base64 = await generateVeoClip(scene.video_prompt, ctx, {
            model: MODEL_VEO_MODEL, imageRef: { gcsUri: baseImg, mimeType: mimeFor(baseImg) }, generateAudio: false, attempts: 3,
          })
          await saveClip(sn, base64)
          await sceneJobsDb.update(storyId, sn, 1, { status: 'done' })
          await log(`  ✓ Scene ${sn}`)
          release(); return { sn, ok: true, filtered: false }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          const filtered = err.startsWith('CONTENT_FILTER:')
          await sceneJobsDb.update(storyId, sn, 1, { status: filtered ? 'filtered' : 'failed', error_message: err })
          await log(`  ✗ Scene ${sn}: ${err.slice(0, 100)}`)
          release(); return { sn, ok: false, filtered }
        }
      }))
      return settleRes(settled)
    }

    let results: SceneRes[]
    let usedAiFallback = false
    if (anchored) {
      results = await runAnchored()
    } else {
      // LEGACY path: animate the picked photo(s), else generate an AI model.
      let baseImages: string[] = (meta.modelImages && meta.modelImages.length) ? meta.modelImages : (meta.imageGcsUri ? [meta.imageGcsUri] : [])
      if (baseImages.length === 0) {
        await log('No model photo — generating a model (Imagen)...')
        const prompt = script.model_image_prompt || (concept.model_image_prompt as string)
        if (!prompt) throw new Error('No model_image_prompt from Gemini')
        baseImages = [(await generateMascotToGcs(prompt, ctx, storyId)).gcsUri]
      }
      await log(`Base model image(s): ${baseImages.length}`)
      results = await runLegacy(baseImages)
      // Recovery: a real photo that got 0 clips due to Veo face-safety → retry once with an AI model.
      if (results.filter(r => r.ok).length === 0 && (meta.modelImages?.length || meta.imageGcsUri) && results.some(r => r.filtered)) {
        const fbPrompt = script.model_image_prompt || (concept.model_image_prompt as string) || ''
        if (fbPrompt) {
          await log('Uploaded photo rejected by Veo (face safety) — generating an AI model and retrying...')
          try {
            const { gcsUri } = await generateMascotToGcs(fbPrompt, ctx, storyId)
            results = await runLegacy([gcsUri]); usedAiFallback = true
          } catch (e) { await log(`AI-model fallback failed: ${e instanceof Error ? e.message : e}`) }
        }
      }
    }
    const done = results.filter(r => r.ok).length

    const sceneNums = results.filter(r => r.ok).map(r => r.sn)
    if (await pipelineDb.isCancelled(storyId)) {
      await log('Generation stopped by user')
      await storiesDb.update(storyId, { status: 'failed', notes: 'Stopped by you', scenes_count: done })
      await pipelineDb.setStep(storyId, 'failed')
      return
    }
    await storiesDb.update(storyId, {
      status: done > 0 ? 'clips_ready' : 'failed',
      clips_generated_at: new Date().toISOString(), scenes_count: done,
      notes: results.length - done > 0 ? `${results.length - done} scene(s) failed` : (usedAiFallback ? 'Used an AI-generated model (uploaded photo was rejected by Veo).' : ''),
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
