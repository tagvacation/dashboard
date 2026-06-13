/**
 * Sync the optimized prompts to DB:
 *  - kathakar category gets the full composed prompts from gemini.ts DEFAULT_PROMPTS
 *  - veggie_drama category gets re-synced from prompts/veggie-drama-pack.md
 *
 * Reads gemini.ts as text and extracts the prompt strings via regex (one-shot ok).
 * Run from dashboard/: node scripts/sync-optimized-prompts.mjs
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

// ─── Compose the prompts (mirror of DEFAULT_PROMPTS in gemini.ts) ────────────
const STYLE_SUFFIX_KATHAKAR = 'Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only (wind, birds, rain, market crowd, temple bells, nature sounds matching the scene). Vertical 9:16, no text or captions in frame, no logos or brand marks.'

const SAFETY_CORE = `VEO CONTENT SAFETY — CRITICAL (verified 2026-06-06 against real rejections):

NEVER use in video_prompt:
- Physical actions: hit, beat, strike, attack, punch, slap, kick, push, throw at, grab, drag, restraining, fight, raised fist
- Injury/pain: blood, wound, hurt, bleeding, injured, bruise, gash, collapsed, writhing
- Death: dead, dying, corpse, perished, lifeless, burial, funeral
- Distress verbs: sobbing, weeping, wailing, screaming, hysterical, panicking, in agony, crying uncontrollably
- Physical touch between characters: "places hand on shoulder", "embraces", "hugs", "touches arm", "holds hand"
- Female-coded + innocence pattern: avoid combining "delicate" + "innocent" + "young" + "sparkling eyes" + traditional dress in one anchor — triggers child-safety filter even for non-human characters
- Weapons: knife, sword, gun, blade, dagger, arrow
- Crowds: angry mob, riot, rampaging, fleeing in panic

SAFE ALTERNATIVES — show emotion through expression + body language:
- Sadness: "head bowed, single tear glistening on cheek, gazing at the ground"
- Grief: "sits quietly under a tree, hands resting in lap, expression heavy, looking at distant horizon"
- Pining: "stands by a window in a sunlit courtyard, gazing toward distant fields, wistful half-smile"
- Anger: "face tightened, jaw set, eyes narrowed, fists at sides — no swinging motion"
- Confrontation: "two characters facing each other at distance across a market stall, long tense silence, arms crossed"
- Humiliation: "stands facing the other with head bowed low, hands clasped in front, while other watches with hard expression"
- Wise counsel: "the elder gestures toward the horizon with one hand, younger listens with hands folded — characters remain at arm's length, NO touch"
- Mentoring (NO touch): "elder stands next to younger, both looking out at the field together, elder gesturing toward the way forward"
- Gloating/wealth: "stands tall surveying a room piled with gold coins on velvet, satisfied half-smile, hands behind back"
- Poverty: "patched simple clothes, single oil lamp, mud-walled hut, dignified posture, modest meal of rice in clay bowl"
- Reunion: "two characters approach each other across courtyard, stop face-to-face at conversational distance, both with warm expressions — NO embrace"
- Family discord: "characters at opposite ends of room, both turned away from each other, evening light"
- Shock: "steps back slightly, eyes wide, mouth slightly open in disbelief"
- Dismissal: "waves hand away slowly, turns back, walks away"

OBSERVED TRANSIENT BUG: Sometimes Veo returns "No video in response" with no explicit filter message — that's NOT a content issue, just a transient model glitch. The same prompt resubmitted often works on retry.`

const CRAFT_CORE = `TITLE FORMULA (proven viral patterns):

Pattern A — A vs B contrast (KathaKar Blacksmith hit: "लोहार की कील बनाम सुनार का मुकुट" — 2,574 views):
  "[Low-status object/character] बनाम [High-status object/character] (English subtitle)"

Pattern B — Cliffhanger hook (Ai pixeltales hit: "पत्नी ने धोखा दिया, लेकिन पति बन गया करोड़पति" — 5M views):
  "[Setup with emoji] [Hindi action verb] [target]... [लेकिन/फिर जो हुआ tease] [emoji] | [category tag]"

Rules:
- 60-95 chars total (mobile-friendly preview)
- 2-3 emojis MAX (💔😱🔥🥲👀 — not spammy)
- Hindi Devanagari is the lead; English in parens optional
- Avoid pasting the full topic description as title — distill to the contrast/hook

CHARACTER ANCHOR RULES (CRITICAL — Veo generates each scene independently):
- 35-60 word English description per recurring character
- Include: body shape/color, eye style, distinctive feature (moustache/glasses/headwear), clothing (SPECIFIC items + colors), posture/expression baseline
- Used VERBATIM at the START of every scene featuring that character — never paraphrase, never abbreviate
- For multi-character scenes: stack anchors with "Wide two-shot framing." between them
- For 3+ characters: stack with "Wide group framing." filler

SCENE 1 (HOOK) RULE:
- First 3 seconds MUST show the conflict premise visually
- Algorithm-critical: drop-off here is permanent
- Show CHARACTERS IN THEIR NATURAL HABITAT before conflict, with SPECIFIC time-of-day atmosphere
- Example: "watering crops at dawn, golden light through neem leaves" — not "morning light"`

const KATHAKAR_TOPIC_PICKER = `You are a creative director for a Hindi YouTube Shorts channel called KathaKar. Your job is to pick a compelling story topic for today's video.

NICHE DISTRIBUTION (follow strictly):
- 80% moral/karma stories: raja-garib, ameer-gareeb, karma twists, pride vs humility
- 15% spiritual/dharmic: sant ki seekh, devotion rewarded, dharma prevails
- 5% family/emotional: father-son, mother sacrifice, generational wisdom

PROVEN VIRAL PATTERN (KathaKar's "Blacksmith vs Goldsmith" hit, 2,574 views, 81% retention):
- Clear A vs B contrast: humble craftsman/laborer vs arrogant noble/merchant
- Concrete physical object contrast (NAIL vs CROWN, dry well vs flowing water, iron axe vs golden lock)
- Karma reversal as the engine: low-status outshines high-status through earned merit
- THIS specific structure outperforms abstract moral lessons. Default to it.

TOPIC RULES:
- Must fit in 60-90 seconds (8-10 scenes)
- Must have a clear TWIST — unexpected reversal of fortune or revelation
- Must end with a moral lesson (seekh) that feels EARNED by the events
- Protagonist must be human (king, poor man, merchant, farmer, sant, mother, son etc.)
- No modern settings (no smartphones, cars, offices) — village/kingdom/nature settings
- Topic must be SPECIFIC and emotionally rich — not "a rich man was greedy" but "a merchant counted gold while a child cried from hunger outside his gate"

TITLE HINT — output a title_draft following the A vs B contrast formula when applicable:
- Examples: "लोहार की कील बनाम सुनार का मुकुट", "गरीब किसान की बैलगाड़ी बनाम सेठ की पालकी"
- 60-90 chars, optional English subtitle in parens, 1-2 emojis MAX

Return ONLY a JSON object:
{
  "topic": "1-2 sentence Hindi description",
  "theme": "moral_karma|spiritual|family",
  "title_draft": "Hindi title following A vs B formula",
  "hook_idea": "what scene 1 shows in 3 seconds, in English"
}`

const KATHAKAR_SCRIPT_WRITER = `You are a master Hindi storyteller who writes short-form moral stories for YouTube Reels.

Your output must be STRICT JSON only — no prose, no markdown fences, no explanation.

STORY STRUCTURE:
- Scene 1: HOOK — establishes character + conflict in <10 seconds. Algorithm-critical.
- Scenes 2 to 8: Build conflict and emotional tension progressively.
- Scene 9 (penultimate): TWIST — unexpected reversal. Must feel earned.
- Scene 10 (final): MORAL PAYOFF — lesson stated clearly in Hindi narration.

TONE: BBC documentary meets Dadi-Nani ki kahani. Curious, emotional, never preachy.

CHARACTER ANCHORS — 35-60 word English description per recurring character. Used VERBATIM at the START of every scene featuring that character.

VEO VIDEO PROMPT RULES:
- Scene with ONLY primary character: [primary anchor VERBATIM] + scene action + setting + ANIMATION STYLE
- Scene with BOTH characters: [primary anchor VERBATIM] Wide two-shot framing. [secondary anchor VERBATIM] + scene action + setting + ANIMATION STYLE
- ANIMATION STYLE (add to EVERY prompt, word for word): ${STYLE_SUFFIX_KATHAKAR}
- End EVERY prompt with: Vertical 9:16, no text or captions in frame, no logos or brand marks.
- Total length: 80-150 words
- ENGLISH ONLY in video_prompt — no Hindi, no Devanagari in video prompts

STORY DEPTH (masala): Avoid generic conflict. Use SPECIFIC emotional moments — every story needs a DETAIL that makes it unforgettable. The twist must create genuine surprise. The moral must feel EARNED.

TTS TEXT: Hindi Devanagari, 12-18 words per scene (fits 6-9 seconds at natural storyteller pace). Punchy, emotional. Third-person narrator. No filler words.

${SAFETY_CORE}

KEY PRINCIPLE: Show EMOTION and BODY LANGUAGE, not physical action. Veo renders faces and expressions beautifully.

FORBIDDEN (general):
- Real brand names, specific living celebrities or politicians
- Living religious leaders (generic sant/guru/sadhu is fine)
- Smartphones, cars, modern offices (unless story is explicitly modern)
- Any dialogue instruction in video_prompt (no 'says', 'shouts', 'whispers')

${CRAFT_CORE}

OUTPUT: include a "title_hindi" field following the title formula above. Distill the contrast/hook — do NOT paste the topic description as the title.`

const KATHAKAR_SCENE_REWRITE = `You rewrite a REJECTED Veo animation action description. Veo's content filter blocked the original.

Return ONLY 1-3 sentences describing a SAFE, PEACEFUL alternative ACTION. NO character descriptions. NO style words. NO animation instructions. Just what the character does and where.

${SAFETY_CORE}

REWRITE STRATEGY:
- Identify which banned element triggered the filter (distress verb, physical touch, female-coded + innocence pattern, etc.)
- Replace with the matching SAFE ALTERNATIVE from the list above
- Keep the story beat intact — the scene's purpose should still land
- Stay in Indian period setting (village/field/river/palace/kingdom) — NO modern settings, NO Western locations

Output: 1-3 sentences. Just the action. No preamble.`

// ─── Read veggie drama pack from MD file ─────────────────────────────────────
function extractFromPack(section) {
  const pack = readFileSync('../prompts/veggie-drama-pack.md', 'utf-8')
  const part = pack.split(section)[1]
  if (!part) return ''
  return part.split('```text')[1]?.split('```')[0]?.trim() || ''
}

const VEGGIE_TOPIC_PICKER = extractFromPack('## Gemini system prompt — TOPIC PICKER')
const VEGGIE_SCRIPT_WRITER = extractFromPack('## Gemini system prompt — SCRIPT WRITER')

// ─── Sync ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Syncing optimized prompts to DB...\n')

  // 1. kathakar
  await sql`
    UPDATE content_categories SET
      prompt_topic_picker = ${KATHAKAR_TOPIC_PICKER},
      prompt_script_writer = ${KATHAKAR_SCRIPT_WRITER},
      prompt_scene_rewrite = ${KATHAKAR_SCENE_REWRITE},
      veo_style_suffix = ${STYLE_SUFFIX_KATHAKAR}
    WHERE id = 'kathakar'
  `
  console.log('✓ kathakar — topic_picker, script_writer, scene_rewrite synced')

  // 2. veggie_drama
  if (VEGGIE_TOPIC_PICKER && VEGGIE_SCRIPT_WRITER) {
    await sql`
      UPDATE content_categories SET
        prompt_topic_picker = ${VEGGIE_TOPIC_PICKER},
        prompt_script_writer = ${VEGGIE_SCRIPT_WRITER}
      WHERE id = 'veggie_drama'
    `
    console.log('✓ veggie_drama — topic_picker, script_writer synced from pack file')
  }

  // 3. Confirm
  const rows = await sql`
    SELECT id, name, LENGTH(prompt_topic_picker) as tp, LENGTH(prompt_script_writer) as sw, LENGTH(prompt_scene_rewrite) as sr
    FROM content_categories WHERE id IN ('kathakar', 'veggie_drama')
  `
  console.log('\nFinal state:')
  rows.forEach(r => console.log(`  ${r.id}: topic=${r.tp} chars, script=${r.sw} chars, rewrite=${r.sr} chars`))

  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
