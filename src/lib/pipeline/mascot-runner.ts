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
import { generateVeoClip } from './veo'
import { callGemini } from './ad-runner'
import { generateMascotToGcs, generateMascotFromImage } from './imagen'
import { composeMascotAd, type ComposeMascotScene } from './ad-composite'
import { downloadGsUri } from '../gcs'
import { loadRecentForbidden, CLICHE_FORBIDDEN } from './critics'
import { runScriptLoop } from './script-loop'

const MASCOT_VEO_MODEL = process.env.MASCOT_VEO_MODEL || 'veo-3.1-generate-001'

interface MascotMeta {
  product: { name: string; category: string; price?: number; benefits: string[]; ingredients?: string | null; target_audience: string; tone: string; duration_sec: number }
  imageGcsUri: string | null
  cutoutGcsUri?: string | null
  voice?: string | null            // user-picked voice override ('auto' stored as null)
  music?: string | null            // background-music mood ('none' | mood | null=auto)
  reuseScript?: boolean            // approved draft → render the stored concept/script verbatim
  draftConcept?: Record<string, unknown>  // concept captured at draft time (villain, voice, etc.)
  draftStills?: { scene_num: number }[]   // approved storyboard stills → used as per-scene Veo first frames
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
        const buf = await downloadGsUri(meta.imageGcsUri, ctx)
        const mimeType = meta.imageGcsUri.endsWith('.jpg') || meta.imageGcsUri.endsWith('.jpeg') ? 'image/jpeg'
          : meta.imageGcsUri.endsWith('.webp') ? 'image/webp' : 'image/png'
        productImage = { data: buf.toString('base64'), mimeType }
      } catch (e) { await log(`(image grounding unavailable: ${e instanceof Error ? e.message : e})`) }
    }

    const [cat] = await sql<{ prompt_topic_picker: string; prompt_script_writer: string }[]>`
      SELECT prompt_topic_picker, prompt_script_writer FROM content_categories WHERE id = 'ai_ad_mascot_drama'
    `
    if (!cat) throw new Error('ai_ad_mascot_drama category not found — run scripts/update-ad-prompts-mascot.mjs')

    // Approved draft → render the EXACT previewed concept/script (skip regeneration).
    let concept: Record<string, unknown>
    let script: MascotScript
    if (meta.reuseScript && run.script_json && meta.draftConcept) {
      await pipelineDb.setStep(storyId, 'script')
      await log('Approved draft — rendering the previewed story (skipping concept/script regeneration)')
      concept = meta.draftConcept
      script = JSON.parse(run.script_json) as MascotScript
      await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Mascot Ad` })
    } else {
    // 1. Concept
    await pipelineDb.setStep(storyId, 'topic')
    await log('Designing mascot + villain + story...')
    concept = await callGemini(
      cat.prompt_topic_picker,
      `Product details:\n${JSON.stringify(product, null, 2)}\n\nThe attached image (if any) is the REAL product. Invent the mascot hero + villain + story. Return JSON only.`,
      ctx, 0.95, productImage,
    )
    await log(`Mascot: ${(concept.mascot_image_prompt as string)?.slice(0, 80)}`)

    // 2. Script + multi-critic loop — scene count scales with requested duration (8s per scene)
    await pipelineDb.setStep(storyId, 'script')
    const scenesWanted = Math.min(8, Math.max(3, Math.round((product.duration_sec || 32) / 8)))
    await log(`Writing ${scenesWanted} action scenes + dialogue...`)

    // Build the "do not reuse" lists: hardcoded clichés + this user's past 5 runs
    const userId = (run as unknown as { user_id?: string }).user_id || null
    const recent = userId
      ? await loadRecentForbidden(userId).catch(() => ({ settings: [] as string[], villains: [] as string[], mascots: [] as string[] }))
      : { settings: [], villains: [], mascots: [] }
    const forbidden = {
      settings: [...recent.settings, ...CLICHE_FORBIDDEN.settings],
      villains: recent.villains,
      mascots: recent.mascots,
    }
    if (recent.settings.length) await log(`Diversity: avoiding ${recent.settings.length} setting(s) from your last 5 runs`)

    const baseInput = {
      product_name: product.name, category: product.category, benefits: product.benefits,
      ingredients: product.ingredients || undefined,
      target_audience: product.target_audience, tone: product.tone, duration_sec: product.duration_sec, price: product.price,
      scenes_count: scenesWanted,
      ...concept,
    }
    const baseTask = `Produce EXACTLY ${scenesWanted} action scenes. Every video_prompt is high-action, animates the SAME mascot (image-to-video) in the SAME world, and includes one short Hinglish dialogue line in the consistent voice. When the villain appears, VARY where it enters each scene (never always from directly behind the mascot).${product.ingredients ? ' In ONE scene the mascot must name its key ingredients and the problem they fight.' : ''} Never render a human.

FRAMING PER SCENE (mandatory — bad framing makes the ad look cheap):
- Each video_prompt MUST specify: shot type (close-up | medium | wide), camera angle (low-hero | high | OTS | dutch), camera move (push-in | pan | tilt | static | handheld), and subject scale ("mascot fills 60-80% of vertical frame", never "centered alone with empty space").
- VARY framing across scenes — don't repeat the same shot type twice in a row.

FORBIDDEN SETTINGS (do not use these — recently overused by this merchant + globally banned):
${forbidden.settings.length ? forbidden.settings.map(s => '  - ' + s).join('\n') : '  (none)'}
FORBIDDEN VERBS/PHRASES:
${CLICHE_FORBIDDEN.verbs_and_phrases.map(s => '  - ' + s).join('\n')}
FORBIDDEN STRUCTURE: villain-enters → mascot-defends → villain-intensifies → mascot-counters. Invent a different beat sequence.`

    const initialUser = `Concept input:\n${JSON.stringify(baseInput, null, 2)}\n\n${baseTask}\n\nReturn JSON.`

    const loopResult = await runScriptLoop<MascotScript>({
      initialGenerate: async () => await callGemini(cat.prompt_script_writer, initialUser, ctx, 0.85, productImage) as unknown as MascotScript,
      reviseGenerate: async (notes, prev) => {
        const revUser = `Concept input:\n${JSON.stringify(baseInput, null, 2)}\n\n${baseTask}\n\nPREVIOUS DRAFT (revise this, don't start from scratch):\n${JSON.stringify(prev, null, 2)}\n\n${notes}\n\nReturn the FULL revised JSON.`
        return await callGemini(cat.prompt_script_writer, revUser, ctx, 0.7, productImage) as unknown as MascotScript
      },
      product: baseInput as unknown as Record<string, unknown>,
      forbidden,
      ctx,
      log,
    })
    script = loopResult.script
    await log(`Script: "${script.ad_title_hindi}" (${script.scenes.length} scenes, ${loopResult.passes} pass${loopResult.passes > 1 ? 'es' : ''})`)
    await pipelineDb.setStep(storyId, 'script', { script_json: JSON.stringify(script) })
    await storiesDb.update(storyId, { scenes_count: script.scenes.length, topic: `${product.name} — Mascot Ad` })
    }

    // 3. Mascot character sheet.
    await pipelineDb.setStep(storyId, 'audio')  // reuse step label for "asset prep"
    const mascotPrompt = script.mascot_image_prompt || (concept.mascot_image_prompt as string) || ''
    let mascotGcs: string
    // Prefer IMAGE-CONDITIONED generation from the real product photo (keeps the
    // product's shape, colours + label; just makes it a cute mascot). Falls back to
    // text Imagen if no product photo or the image model fails.
    if (meta.imageGcsUri) {
      const personality = (concept.mascot_personality as string) || 'cheerful and friendly'
      const editPrompt = `Turn THIS exact product into an adorable 3D cartoon mascot character. KEEP the product's real shape, proportions, colours and label text/branding intact — the mascot IS this product, just given big friendly eyes, a cute face and tiny little arms & legs. Do NOT give it a tall human body; keep the product's own silhouette and size ratio. Personality: ${personality}.

FRAMING (critical — fills the 9:16 frame, no cheap empty space):
- LOW HERO ANGLE looking slightly up at the mascot
- Mascot occupies 70-80% of the vertical frame height — from approx 10% top to 90% bottom
- Slight perspective foreshortening to feel imposing
- NO large empty space above the head; NO large empty floor below the feet
- Tight composition: the mascot dominates the frame

Premium Pixar-style, very cute, soft glossy 3D rendering with cinematic key light + rim light, shallow depth of field, vibrant product-brand colours as the dominant palette, clean soft studio gradient background. Vertical 9:16.`
      try {
        await log('Generating mascot from product photo (image-conditioned)...')
        const r = await generateMascotFromImage(productImage ? Buffer.from(productImage.data, 'base64') : await downloadGsUri(meta.imageGcsUri, ctx), productImage?.mimeType || 'image/png', editPrompt, ctx, storyId)
        mascotGcs = r.gcsUri
      } catch (e) {
        await log(`Image-conditioned mascot failed (${e instanceof Error ? e.message : e}); falling back to text Imagen`)
        mascotGcs = (await generateMascotToGcs(mascotPrompt || editPrompt, ctx, storyId)).gcsUri
      }
    } else {
      await log('Generating mascot character sheet (Imagen, text)...')
      if (!mascotPrompt) throw new Error('No mascot_image_prompt from Gemini')
      mascotGcs = (await generateMascotToGcs(mascotPrompt, ctx, storyId)).gcsUri
    }
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

    // Approved-draft scenes that have a storyboard still → animate FROM that exact still (so the
    // video matches the preview the merchant approved + the still is 9:16). Else use the mascot sheet.
    const draftStillScenes = new Set((meta.draftStills || []).map(s => String(s.scene_num).padStart(2, '0')))

    const results = await Promise.allSettled(script.scenes.map(async (scene) => {
      await acquire()
      const sn = String(scene.scene_num).padStart(2, '0')
      if (await pipelineDb.isCancelled(storyId)) { release(); return { sn, ok: false } }  // stopped → skip remaining scenes
      try {
        await sceneJobsDb.update(storyId, sn, 1, { status: 'submitted' })
        const useStill = meta.reuseScript && draftStillScenes.has(sn)
        const firstFrame = useStill ? `gs://${ctx.bucket}/stories/${storyId}/storyboard/scene_${sn}.png` : mascotGcs
        // Enforce the shared world + ONE consistent voice in every clip (continuity +
        // fixes the male/female voice flip across independent Veo clips).
        const voice = meta.voice || script.voice_persona
        const villain = concept.villain_description_en as string | undefined
        let vp: string
        if (useStill) {
          // Animate the approved still with PRODUCT-TRUE motion only. We DON'T feed the morphy
          // "hero action" script — that's what turns the mascot humanoid on the action/climax beats.
          const line = scene.dialogue ? `The mascot says, in ${voice || 'one consistent voice'}: "${scene.dialogue}"` : ''
          vp = [
            'Animate THIS exact image. CRITICAL: the product-mascot stays the EXACT same object in every single frame — it NEVER transforms, morphs, grows arms or legs, becomes a robot/human/superhero, or changes its shape or size.',
            'The ONLY motion allowed: a gentle bob or tilt of the product, an expressive talking face, glowing energy and sparkles emanating FROM the product, and a smooth cinematic camera move (slow push-in or orbit) with dramatic lighting.',
            script.world_description_en ? `Setting: ${script.world_description_en}` : '',
            villain ? `Any villain is a SEPARATE creature, never the mascot: ${villain}` : '',
            line,
          ].filter(Boolean).join('\n')
        } else {
          const prefix: string[] = []
          if (script.world_description_en) prefix.push(`Setting (identical every scene for continuity): ${script.world_description_en}`)
          if (voice) prefix.push(`The mascot speaks in the SAME voice every scene: ${voice}.`)
          if (villain) prefix.push(`Villain (render identically whenever it appears): ${villain}`)
          vp = prefix.length ? `${prefix.join('\n')}\n\n${scene.video_prompt}` : scene.video_prompt
        }
        // Auto-retry (handles the transient "No video in response" glitch).
        const base64 = await generateVeoClip(vp, ctx, {
          model: MASCOT_VEO_MODEL, imageRef: { gcsUri: firstFrame, mimeType: 'image/png' },
          generateAudio: true, attempts: 3,
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

    const successful: ComposeMascotScene[] = []
    script.scenes.forEach((scene, i) => {
      const r = results[i]
      // No burned-in captions (subtitles removed per feedback).
      if (r.status === 'fulfilled' && r.value.ok) successful.push({ sceneNum: String(scene.scene_num).padStart(2, '0') })
    })
    const done = successful.length
    // Stopped by the user → finalize as stopped, skip the (costly) composite.
    if (await pipelineDb.isCancelled(storyId)) {
      await log('Generation stopped by user')
      await storiesDb.update(storyId, { status: 'failed', notes: 'Stopped by you', scenes_count: done })
      await pipelineDb.setStep(storyId, 'failed')
      return
    }
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
          music: meta.music || null,
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
