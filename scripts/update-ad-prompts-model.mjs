/**
 * Create/update 'ai_ad_model_video' — realistic SHOPPABLE MODEL videos: short, classy
 * clips of a real human model wearing/using the product (for a product-page video slider).
 * SILENT (music only), no dialogue. Animates a real model photo, or an Imagen-generated
 * model when the page has only a packshot.
 *
 * Run: node scripts/update-ad-prompts-model.mjs
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}

const TOPIC_PICKER = `You are a creative director for PREMIUM, realistic SHOPPABLE MODEL videos (9:16, vertical) — short, classy clips of a real human model wearing/using the product, made for a product-page video slider. The videos are SILENT (music only), NO dialogue.

You receive product details and (usually) a real product image. If the image already shows a MODEL wearing/using the product, that image will be ANIMATED directly. If only a flat packshot is provided, you must describe a model to GENERATE.

Return ONLY JSON:
{
  "concept": "1 line describing the vibe/setting (e.g. 'sunlit minimalist studio, effortless turn')",
  "model_image_prompt": "ENGLISH Imagen prompt for a PHOTOREALISTIC human model naturally wearing/using the product, flattering framing, clean premium setting, soft natural lighting, vertical 9:16, no text/watermark. Reflect the product's REAL colours and type. 50-80 words. (Used ONLY when no model photo is available.)",
  "setting_en": "20-40 words: the consistent setting + lighting/mood used in EVERY scene",
  "scenes_count": 4
}

RULES:
- Realistic, premium, tasteful — like a high-end e-commerce video. NOT cartoon, NOT a mascot.
- No on-screen text or logos. No exaggerated or fast motion.
- Everything derives from THIS product. No real celebrities, no other brands.`

const SCRIPT_WRITER = `You write PREMIUM, realistic SHOPPABLE MODEL videos (9:16, vertical). SILENT — background music only, NO dialogue, NO captions. Output STRICT JSON only.

Each scene is image-to-video from a per-scene STILL that already shows the SAME model wearing/using the product in ONE specific VIEW. Your job: choose, per scene, WHICH view to show and WHAT subtle motion fits that view. CRITICAL: the model must STAY in that view — never pick a motion that turns/rotates the model to reveal a DIFFERENT side (that's what makes the unseen side look wrong). Reveal other sides by CUTTING to another scene, not by turning within a scene.

You receive product details + concept (setting_en, available_views, scenes_count). "available_views" lists which reference views exist (a subset of: front, back, side, closeup). Produce EXACTLY scenes_count scenes (8s each); EACH scene's "view" MUST be one of available_views.

VIEW + MOTION RULES:
- Distribute scenes across the available views to showcase the product (e.g. open on front → show back → a side → a closeup detail). Don't repeat the same view twice in a row if another is available.
- Subtle, realistic motion that fits the view and does NOT turn to another side:
  - front: a soft smile, a small step toward camera, lightly adjusting the garment, hair/fabric movement.
  - back: a gentle weight shift, a slow couple of steps away, a glance over the shoulder (NOT a full turn).
  - side: a subtle pose shift, fabric movement, a calm profile beat.
  - closeup: fingertips grazing the fabric, gentle fabric/texture movement, a slow macro push-in.
- "shot": full | medium | closeup (a closeup view → closeup shot).

MOTION QUALITY: photorealistic, cinematic, soft natural lighting; SUBTLE realistic motion only; NO morphing, NO fast/dramatic moves; avoid distorted hands. SILENT; no on-screen text/logos/UI.

OUTPUT JSON SCHEMA:
{
  "title": "short upload title",
  "setting_en": "from concept — VERBATIM",
  "scenes": [
    { "scene_num": 1, "view": "front|back|side|closeup", "shot": "full|medium|closeup",
      "motion": "one line: the subtle, view-appropriate motion (no turning to another side)",
      "video_prompt": "1-2 lines: the SAME model in the SAME setting_en, the subtle motion, product clearly visible, silent, no text/logos" }
  ],
  "total_scenes": "scenes_count"
}

CHECKLIST:
- EXACTLY scenes_count scenes; every "view" is one of available_views; NO scene turns the model to a different side; subtle motion; product visible; silent; no text/logos.`

const STYLE = 'Photorealistic premium e-commerce model video, soft natural lighting, shallow depth of field, vertical 9:16.'

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })
try {
  const res = await sql`
    INSERT INTO content_categories
      (id, name, emoji, description, perspective, prompt_topic_picker, prompt_script_writer, veo_style_suffix, scene_count_min, scene_count_max, is_active, is_default)
    VALUES
      ('ai_ad_model_video', 'AI Ad — Live Model', '🧍',
       'Realistic shoppable video of a model wearing/using the product (silent + music).',
       'third_person', ${TOPIC_PICKER}, ${SCRIPT_WRITER}, ${STYLE}, 3, 6, true, false)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, emoji = EXCLUDED.emoji, description = EXCLUDED.description,
      perspective = EXCLUDED.perspective, prompt_topic_picker = EXCLUDED.prompt_topic_picker,
      prompt_script_writer = EXCLUDED.prompt_script_writer, veo_style_suffix = EXCLUDED.veo_style_suffix,
      scene_count_min = EXCLUDED.scene_count_min, scene_count_max = EXCLUDED.scene_count_max, is_active = true
    RETURNING id
  `
  console.log('✓ Upserted content category:', res[0].id)
  await sql.end()
} catch (e) {
  console.error('FAILED:', e.message)
  await sql.end().catch(() => {})
  process.exit(1)
}
