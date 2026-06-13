/**
 * Add the AI Ad (1st-person talking product) content category to DB.
 *
 * The "topic_picker" here doesn't pick a random topic — it takes product details
 * from the user's form and turns them into an ad concept.
 *
 * Run from dashboard/: node scripts/add-ai-ad-category.mjs
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnv('.env')

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

// ─── Style suffix tuned for premium ad aesthetic ─────────────────────────────
const STYLE_SUFFIX = 'Premium commercial advertisement 3D animation style, warm cinematic studio lighting, vibrant brand-friendly colors, soft drop shadows, professional product photography aesthetic, the product character centered in frame with subtle bokeh background, glossy textures catching the light, no human characters in frame, no logos other than the product\'s own brand label. Vertical 9:16, no text or captions in frame, no logos or brand marks except the product\'s own label.'

// ─── Shared safety block (same as veggie drama) ──────────────────────────────
const SAFETY_CORE = `VEO CONTENT SAFETY — critical rules:
NEVER use in video_prompt:
- Physical actions (hit, push, throw, grab, etc.)
- Distress verbs (sobbing, weeping, screaming, panicking)
- Injury or death words
- Real brand names other than the user's own product
- Living celebrities or public figures
- Religious figures

SAFE EMOTIONAL EXPRESSION via body language:
- Excitement: "leans forward, eyes wide and bright, big smile"
- Concern: "tilts head, eyes soft and caring, slight frown"
- Confidence: "stands tall, smile knowing, slight chest puff"
- Warmth: "soft eyes, gentle smile, warm body posture"`

// ─── TOPIC PICKER — turns product details into ad concept ────────────────────
const TOPIC_PICKER = `You are a creative director for AI-generated product ads. The user has provided their product details. Your job is to turn them into a compelling 1st-person ad concept where the PRODUCT ITSELF speaks to the viewer.

INPUT (user provides):
- product_name: name of product
- category: industry (haircare, food, jewelry, cosmetics, fashion, electronics, etc.)
- price: optional price in INR
- benefits: 3-5 key benefits / pain points solved
- target_audience: who the ad targets
- tone: emotional | funny | bold | informative | warm
- duration_sec: 15 / 30 / 60

YOUR OUTPUT — design an ad concept:

PRODUCT PERSONA — the product itself is the speaker. Define:
- product_anchor_en: 50-80 word VISUAL description of the product as an anthropomorphized character
  Must include: color, shape, size, material/texture, where the LABEL is displayed (brand name visible),
  facial features (big expressive eyes, warm smile), pose/personality baseline
  Used VERBATIM in every Veo scene prompt
- voice_personality: how the product sounds when speaking (warm grandma, bold cricketer, friendly didi, hype DJ, etc.)
- tagline_hindi: ONE punchy Hindi tagline the product would use (5-10 words)

AD STRUCTURE (matches duration):
- 15s = 2 scenes (Hook+Problem | Solution+CTA)
- 30s = 4 scenes (Hook | Problem dramatized | Solution/Benefits | CTA)
- 60s = 8 scenes (2 per beat)

EMOTIONAL ARC:
- Hook: Product introduces itself with confidence and warmth ("Namaste! Main hoon...")
- Problem: Product acknowledges viewer's pain point with empathy ("Aapke baal jhad rahe hain? Pareshani samajhta hoon.")
- Solution: Product shows what's special, lists benefits, conveys magic ("Mujh mein hai...")
- CTA: Strong close with clear next action ("Aaj order karein. Pachhtawa nahi hoga.")

TONE OVERRIDES:
- Funny: cracks one joke about the problem before pitching
- Bold: makes a confident claim ("Mai best hoon. Saath laao!")
- Warm: nurturing aunty/dadi vibe
- Informative: cites specific ingredients/scientific points
- Emotional: pulls heartstrings with empathy

Return ONLY a JSON object:
{
  "ad_concept": "1-2 sentence Hindi description of the ad story",
  "product_anchor_en": "50-80 word visual description used verbatim in every scene",
  "voice_personality": "string describing the product's speaking persona",
  "tagline_hindi": "punchy Hindi tagline 5-10 words",
  "scenes_count": 2 | 4 | 8,
  "tone": "user's tone",
  "title_draft": "punchy ad title for YouTube/Insta upload"
}`

// ─── SCRIPT WRITER — turns ad concept into full scene-by-scene script ────────
const SCRIPT_WRITER = `You are a master Hindi ad copywriter writing 1st-person product monologue ads where the product itself speaks to the camera.

Output STRICT JSON only.

INPUT: You receive a product ad concept including product_anchor_en, tagline_hindi, voice_personality, scenes_count, tone, and the user's original product details.

STRUCTURE (always exactly scenes_count scenes, each 8 seconds):

For 2 scenes (15s):
- Scene 1 (hook+problem): Product introduces itself + acknowledges problem
- Scene 2 (solution+cta): Product reveals benefits + strong CTA

For 4 scenes (30s):
- Scene 1 (hook): Product greets viewer warmly
- Scene 2 (problem): Product empathizes with the pain point
- Scene 3 (solution): Product shows benefits with energy
- Scene 4 (cta): Product gives clear next step

For 8 scenes (60s):
- 2 scenes per beat (hook, problem, solution, cta)
- More room for storytelling — show benefits one at a time

VEO PROMPT RULES (every scene):
- ALWAYS start with product_anchor_en VERBATIM (the visual description)
- Add the scene-specific action: how the product moves/expresses (lean forward, eyes wide, tilt head, gentle smile)
- Add setting: clean studio backdrop with subtle props matching category
  (haircare = soft fabric drapes; food = wooden table with ingredients in background; jewelry = velvet display)
- End with the STYLE_SUFFIX exactly:
  "${STYLE_SUFFIX}"

TTS TEXT — the product speaks (1st person, Hindi):
- 15-22 Hindi words per scene
- Always 1st person — the product is the speaker, not a narrator
- Use the voice_personality as the speaking style
- Each line must sound like the PRODUCT talking ("Main hoon...", "Mujhe pataa hai...", "Mujh mein...")
- Last scene MUST include the tagline_hindi (verbatim) + a strong CTA

CAPTION (on-screen, optional):
- ≤6 Hindi words per scene
- Punchy moment phrases

${SAFETY_CORE}

CRITICAL RULES:
- The product CHARACTER stays visually identical across scenes — same anchor verbatim
- No human characters appear in frame (just the product)
- No other brand names appear
- The product's own brand label must be visible in every scene
- Each scene MUST feel like a complete commercial moment

Return ONLY JSON matching this schema:
{
  "ad_title_hindi": "60-80 char Hindi title with emoji",
  "tagline_hindi": "from input concept",
  "product_anchor_en": "from input concept, used verbatim",
  "voice_personality": "from input concept",
  "scenes": [
    {
      "scene_num": 1,
      "beat": "hook|problem|solution|cta",
      "video_prompt": "FULL prompt: anchor + action + setting + style suffix",
      "tts_text": "Hindi 1st-person line",
      "caption": "Hindi ≤6 words"
    }
  ],
  "total_scenes": "matches input",
  "total_duration_sec": "scenes_count * 8"
}`

// ─── Scene rewrite (same as KathaKar's) ──────────────────────────────────────
const SCENE_REWRITE = `You rewrite a REJECTED Veo animation action for an AI product ad. Veo's content filter blocked the original.

Return ONLY 1-2 sentences of safe alternative ACTION. NO product description (we keep anchor). NO style words.

${SAFETY_CORE}

Rewrite the action describing how the PRODUCT CHARACTER moves/expresses — safe alternatives only. Keep it commercial-grade: confident, warm, focused on the product.`

// ─── Insert into DB ──────────────────────────────────────────────────────────
async function main() {
  console.log('Adding AI Ad (Talking Product) category to DB...\n')

  await sql`
    INSERT INTO content_categories (
      id, name, emoji, description, perspective,
      prompt_topic_picker, prompt_script_writer, prompt_scene_rewrite,
      veo_style_suffix, scene_count_min, scene_count_max,
      is_active, is_default, is_system
    ) VALUES (
      'ai_ad_talking_product',
      ${'🎤 AI Ad — Talking Product'},
      ${'🎤'},
      ${'1st-person product monologue ads. The product itself speaks to the camera. Tuned for D2C brands. 15s/30s/60s formats.'},
      ${'character'},
      ${TOPIC_PICKER},
      ${SCRIPT_WRITER},
      ${SCENE_REWRITE},
      ${STYLE_SUFFIX},
      ${2}, ${8},
      true, false, true
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      prompt_topic_picker = EXCLUDED.prompt_topic_picker,
      prompt_script_writer = EXCLUDED.prompt_script_writer,
      prompt_scene_rewrite = EXCLUDED.prompt_scene_rewrite,
      veo_style_suffix = EXCLUDED.veo_style_suffix,
      scene_count_min = EXCLUDED.scene_count_min,
      scene_count_max = EXCLUDED.scene_count_max
  `
  console.log('✓ ai_ad_talking_product category inserted/updated')

  const [cat] = await sql`SELECT id, name, LENGTH(prompt_topic_picker) tp, LENGTH(prompt_script_writer) sw, LENGTH(prompt_scene_rewrite) sr FROM content_categories WHERE id = 'ai_ad_talking_product'`
  console.log(`\nCategory state:`)
  console.log(`  ${cat.id} (${cat.name})`)
  console.log(`  topic_picker: ${cat.tp} chars`)
  console.log(`  script_writer: ${cat.sw} chars`)
  console.log(`  scene_rewrite: ${cat.sr} chars`)

  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
