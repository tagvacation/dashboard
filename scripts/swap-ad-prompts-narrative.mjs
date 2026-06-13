/**
 * Replace AI Ad prompts: Monologue → Narrative Drama.
 * Run from dashboard/: node scripts/swap-ad-prompts-narrative.mjs
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    process.env[key] = val
  }
}
loadEnv('.env')

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

const STYLE_SUFFIX = `Cinematic 3D advertisement animation, dramatic warm key lighting with cool rim lights, particle effects appropriate to the scene (sparkles, glow, foam bursts, water droplets, light beams, dust motes), slow-motion sequences for hero/action moments, dynamic camera angles (low-angle hero shots, dramatic zooms, slow dolly), premium movie-poster aesthetic, high contrast, bold saturated colors with strong shadows, depth of field. No text or letters in frame, no logos other than the product's own brand label visible on its packaging.`

const TOPIC_PICKER = `You are a creative director for cinematic Hindi product ads in the NARRATIVE DRAMA format. The product is the HERO of a 30-second story that visually DEFEATS the problem it solves.

INPUT (user provides):
- product_name, category, price?, benefits[], target_audience, tone, duration_sec

YOUR JOB: Turn product details into a 4-scene dramatic narrative concept.

THE FORMULA:
1. PROBLEM is VISUALIZED as cute cartoon adversary characters (NOT abstract concept)
2. PRODUCT arrives dramatically as the hero
3. PRODUCT defeats the adversary with cinematic action + particle effects
4. World is RESTORED, victory pose, tagline

ADVERSARY VISUALIZATION EXAMPLES:
- Hair fall → tiny falling hair-strand characters with sad droopy faces
- Dust on skin → small grumpy dust-monster characters (grey-black blobs with arms and angry expressions)
- Stains on clothes → ink-blob villains with mischievous smirks
- Cavities → cartoon bacteria with menacing grins (cute, not scary)
- Bland food → grey depressed-looking food competitors
- Frizzy hair → wild tangled hair strands with chaotic expressions
- Pimples → angry red dot characters with arms
- Dryness → cracked cartoon earth characters

HERO MOMENT EXAMPLES:
- Face wash → erupts torrent of glowing white foam that washes adversaries away in slow-motion
- Hair oil → rains golden glowing droplets that revive falling hair-strand characters
- Detergent → releases sparkling cyan bubbles that gently dissolve stain villains
- Toothpaste → shoots minty fresh beam that gently disperses bacteria
- Skincare → emits warm pink glow that turns angry pimples into happy peaceful smiles
- Snack → releases swirl of colorful flavor particles that energize boring competitors

TONE OVERRIDES:
- Funny: adversaries are extra goofy, comedic reactions, slapstick
- Bold: dramatic music swell vibes, intense slow-motion, hero pose more pronounced
- Warm: softer particle effects, gentle defeat (no harsh effects), nurturing mood
- Emotional: focus on the "victim" being saved (face, hair) with empathic shots
- Informative: cleaner sci-fi aesthetic, transparent diagrams overlaid

Return ONLY a JSON object:
{
  "ad_concept": "1-2 sentence Hindi description of the dramatic arc",
  "product_visual_description_en": "30-50 words English visual description of the product (specific color, shape, material, label placement, packaging details). This is used VERBATIM in every Veo scene prompt where the product appears.",
  "adversary_visualization_en": "30-50 words English description of the cartoon adversary characters — visual details, expressions, colors, behavior",
  "hero_moment_description_en": "20-40 words description of the heroic action the product performs (what bursts out of it, how it interacts with adversaries, particle effects)",
  "voice_personality": "how the Hindi narrator sounds (e.g., bold cricket commentator, warm dadi, hype DJ, dramatic film narrator)",
  "tagline_hindi": "punchy Hindi tagline 5-10 words used VERBATIM in scene 4",
  "scenes_count": 4,
  "title_draft": "ad title for upload, in Hindi with 1-2 emojis"
}

CRITICAL: This is NOT a monologue. The product DOES NOT speak in 1st person. The format is cinematic narrative with 3rd-person Hindi narrator over the action.`

const SCRIPT_WRITER = `You write cinematic Hindi product ads in NARRATIVE DRAMA format. Each ad is a 4-scene visual story where the product DEFEATS a visualized problem.

Output STRICT JSON only.

INPUT: you receive an ad concept including product_visual_description_en, adversary_visualization_en, hero_moment_description_en, voice_personality, tagline_hindi, scenes_count, and the user's product details.

═══════════════════════════════════════════════════════════
SCENE STRUCTURE (always exactly scenes_count scenes, each 8 seconds)
═══════════════════════════════════════════════════════════

For 4 scenes (30s):
- S1 PROBLEM WORLD: NO PRODUCT VISIBLE. Show the adversary characters terrorizing a victim (a cartoon face, hair, clothes, food, teeth, etc.). Gloomy/dramatic mood. Camera close-up or dramatic angle.
- S2 HERO ARRIVAL: Product enters scene cinematically — beam of light from above, slow-motion descent, packaging glowing, camera dramatic zoom or low-angle hero shot. The product is now revealed.
- S3 HEROIC ACTION: Product performs the hero moment — particle effects burst out, slow-motion as adversaries get washed/dispersed/dissolved away. Dynamic camera. Triumph music vibes.
- S4 VICTORY + CTA: World restored, victim glowing happy. Product in hero pose center frame. Brand label clearly visible. Warm golden lighting. Subtle sparkles.

For 2 scenes (15s):
- S1: Problem + Hero arrival combined
- S2: Action + Victory combined

For 8 scenes (60s): 2 scenes per beat, more elaborate action sequence

═══════════════════════════════════════════════════════════
VEO VIDEO_PROMPT FORMAT
═══════════════════════════════════════════════════════════

EVERY prompt must describe: ACTION + CAMERA + EFFECTS + LIGHTING + MOOD

PRODUCT VISIBILITY RULES (CRITICAL):
- S1: NO product. Start prompt with adversary + victim character description.
- S2: Product is the FOCUS. Start prompt with product_visual_description_en VERBATIM, then arrival action.
- S3: Product + adversary both visible. Start with product_visual_description_en VERBATIM, then describe action.
- S4: Product in heroic pose. Start with product_visual_description_en VERBATIM, then victorious composition.

For 2-scene format: S1 is combined hook (problem→arrival), include product_visual_description_en. S2 is action+victory.

ALWAYS end every prompt with the STYLE_SUFFIX exactly:
"${STYLE_SUFFIX}"

Then end with: "Vertical 9:16, no text or captions in frame, no logos or brand marks except the product's own label."

═══════════════════════════════════════════════════════════
TTS_TEXT (Hindi narrator over the action — NOT the product speaking)
═══════════════════════════════════════════════════════════

THIRD-PERSON narrator. Voice personality from concept input. Tone: cinematic, dramatic, energetic.

- S1 (Problem): Acknowledge the problem dramatically (12-18 words). e.g., "हर रोज़ आपकी त्वचा पर अनगिनत प्रदूषण कण हमला करते हैं, चमक चुराकर ले जाते हैं।"
- S2 (Hero arrival): Introduce the product as hero (12-18 words). e.g., "लेकिन अब, मिलिए {product_name} से — आपकी त्वचा का असली रक्षक।"
- S3 (Action): Describe the heroic action (12-18 words). e.g., "{benefits} | एक झटके में, हर कण साफ! त्वचा पाए नया जीवन।"
- S4 (Victory + CTA): Tagline + buy now (12-18 words). MUST include tagline_hindi VERBATIM. e.g., "{tagline_hindi} | आज ही पाएं {product_name}।"

═══════════════════════════════════════════════════════════
CONTENT SAFETY — CRITICAL (Veo content filter)
═══════════════════════════════════════════════════════════

NEVER use these words in video_prompt:
- Violent action: hit, beat, strike, attack, blast, smash, destroy, explode, kill, fight, punch, break
- Sharp/weapons: blade, knife, sword, gun, weapon, dagger
- Distress: screaming, dying, blood, wound, hurt, crying uncontrollably

USE THESE NARRATIVE-SAFE ALTERNATIVES instead:
- Defeat → "washed away in slow motion", "dispersed", "dissolved with sparkles", "gently scattered with light"
- Adversaries getting beaten → "launched into the air with comical surprise faces", "spinning away with confused expressions", "shrinking until they pop into sparkles"
- Hero action → "erupts a glowing torrent of foam", "rains golden particles", "releases a soft beam of light"
- Slow motion + particles + light = the visual replacement for "violence"

═══════════════════════════════════════════════════════════
OUTPUT JSON SCHEMA
═══════════════════════════════════════════════════════════

{
  "ad_title_hindi": "60-95 char Hindi title with 1-2 emojis (e.g., 'धूल से लड़ता है यह फेस वॉश ✨')",
  "tagline_hindi": "from concept input",
  "product_visual_description_en": "from concept input (used verbatim in scenes)",
  "voice_personality": "from concept input",
  "scenes": [
    {
      "scene_num": 1,
      "beat": "problem|arrival|action|victory",
      "video_prompt": "FULL Veo prompt: scene action description + product_visual_description_en where applicable + camera + effects + STYLE_SUFFIX + 'Vertical 9:16, no text or captions in frame, no logos or brand marks except the product\\'s own label.'",
      "tts_text": "Hindi narrator line 12-18 words",
      "caption": "optional Hindi caption ≤6 words"
    }
  ],
  "total_scenes": "from input scenes_count",
  "total_duration_sec": "scenes_count * 8"
}

CRITICAL FINAL CHECKLIST:
- S1 has NO product visible — only adversary + victim setup
- S2-S4 always START video_prompt with product_visual_description_en verbatim
- Each scene's prompt feels CINEMATICALLY DIFFERENT (different action, different camera)
- TTS is 3rd-person narrator NOT the product speaking
- S4 tts_text includes tagline_hindi VERBATIM
- No banned violence words anywhere`

const SCENE_REWRITE = `You rewrite a REJECTED Veo action description for a cinematic narrative ad. Veo's content filter blocked the original.

Return ONLY 1-2 sentences of safe alternative ACTION. NO product description (keep anchor). NO style words.

Veo content filter blocks: hit, beat, strike, attack, blast, smash, destroy, explode, kill, fight, weapons, blood, screaming, dying.

Use these NARRATIVE-SAFE alternatives instead:
- "washes adversaries away in slow motion with glowing foam"
- "disperses adversaries with bursts of sparkling light"
- "dissolves them gently with shimmering particles"
- "launches them into the air with comical surprise expressions, slow motion"
- "scatters them as they shrink into peaceful sparkles"

Rewrite to keep the ad NARRATIVE/CINEMATIC: action is gentle particle-based defeat, not violent.

Output: 1-2 sentences. Just the action. No preamble.`

async function main() {
  console.log('Swapping AI Ad prompts: Monologue → Narrative Drama...\n')

  await sql`
    UPDATE content_categories SET
      name = ${'🎬 AI Ad — Narrative Drama'},
      description = ${'Cinematic Hindi ad: product as hero defeating visualized problem. Action + particle effects + Hindi narrator. Veo native audio mixed with TTS overlay.'},
      prompt_topic_picker = ${TOPIC_PICKER},
      prompt_script_writer = ${SCRIPT_WRITER},
      prompt_scene_rewrite = ${SCENE_REWRITE},
      veo_style_suffix = ${STYLE_SUFFIX}
    WHERE id = 'ai_ad_talking_product'
  `

  const [cat] = await sql`SELECT id, name, LENGTH(prompt_topic_picker) tp, LENGTH(prompt_script_writer) sw, LENGTH(prompt_scene_rewrite) sr FROM content_categories WHERE id = 'ai_ad_talking_product'`
  console.log('✓ Prompts swapped')
  console.log(`  ${cat.id} (${cat.name})`)
  console.log(`  topic_picker: ${cat.tp} chars`)
  console.log(`  script_writer: ${cat.sw} chars`)
  console.log(`  scene_rewrite: ${cat.sr} chars`)
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
