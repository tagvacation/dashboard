import { getAccessToken, GCP_PROJECT, GCP_REGION } from './auth'
import { settingsDb } from '../db'
import type { Script, Scene } from './types'

const GEMINI_MODEL = 'gemini-2.0-flash-001'
const BASE = `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${GCP_REGION}/publishers/google/models`

async function callGemini(systemPrompt: string, userPrompt: string, temperature = 0.8): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty response')
  return text
}

// ─── Default prompts (used if no custom prompt saved in DB) ──────────────────

const STYLE_SUFFIX = 'Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only (wind, birds, rain, market crowd, temple bells, nature sounds matching the scene). Vertical 9:16, no text or captions in frame, no logos or brand marks.'

export const DEFAULT_PROMPTS = {
  topic_picker: `You are a creative director for a Hindi YouTube Shorts channel called KathaKar. Your job is to pick a compelling story topic for today's video.

NICHE DISTRIBUTION (follow strictly):
- 80% moral/karma stories: raja-garib, ameer-gareeb, karma twists, pride vs humility
- 15% spiritual/dharmic: sant ki seekh, devotion rewarded, dharma prevails
- 5% family/emotional: father-son, mother sacrifice, generational wisdom

TOPIC RULES:
- Must be a story that fits in 60-90 seconds (8-10 scenes)
- Must have a clear TWIST — unexpected reversal of fortune or revelation
- Must end with a moral lesson (seekh)
- Protagonist must be a human (king, poor man, merchant, farmer, sant, mother, son etc.)
- No modern settings (no smartphones, cars, offices) — village/kingdom/nature settings preferred
- Topic must feel fresh — not a generic cliché but a specific scenario

Return ONLY a JSON object, no other text.`,

  script_writer: `You are a master Hindi storyteller who writes short-form moral stories for YouTube Reels.

Your output must be STRICT JSON only — no prose, no markdown fences, no explanation.

STORY STRUCTURE:
- Scene 1: HOOK — establishes character + conflict in <10 seconds. Algorithm-critical.
- Scenes 2 to 8: Build conflict and emotional tension progressively.
- Scene 9 (penultimate): TWIST — unexpected reversal. Must feel earned.
- Scene 10 (final): MORAL PAYOFF — lesson stated clearly in Hindi narration.

TONE: BBC documentary meets Dadi-Nani ki kahani. Curious, emotional, never preachy.

CHARACTER ANCHOR RULES (CRITICAL — character consistency across ALL clips):

PRIMARY character_anchor.description_en:
- 30-60 words: age range, body build, SPECIFIC clothing with exact colors and items, facial features (beard/clean-shaven, hair), expression baseline
- Used VERBATIM at the START of every scene featuring the primary character

SECONDARY secondary_character_anchor.description_en (required if story has a second recurring character):
- Same format: 30-60 words, specific age/build/clothing/face details
- Used VERBATIM in every scene featuring the secondary character
- If no secondary character, set to empty string

VEO VIDEO PROMPT RULES — follow EXACTLY:
- Scene with ONLY primary character: [primary anchor VERBATIM] + scene action + setting + ANIMATION STYLE
- Scene with ONLY secondary character: [secondary anchor VERBATIM] + scene action + setting + ANIMATION STYLE
- Scene with BOTH characters: [primary anchor VERBATIM] Wide two-shot framing. [secondary anchor VERBATIM] + scene action + setting + ANIMATION STYLE
- ANIMATION STYLE (add to EVERY prompt, word for word): ${STYLE_SUFFIX}
- End EVERY prompt with: Vertical 9:16, no text or captions in frame, no logos or brand marks.
- Total length: 80-150 words
- ENGLISH ONLY in video_prompt — no Hindi, no Devanagari in video prompts

STORY DEPTH RULE (masala — make stories specific and emotionally rich):
- Avoid generic conflict. Use SPECIFIC emotional moments:
  BAD: 'a rich man was greedy'
  GOOD: 'a merchant counted gold coins while a child cried from hunger outside his gate'
- Every story needs a DETAIL that makes it unforgettable — a specific object, gesture, or reversal
- The twist must create genuine surprise — not telegraphed from scene 1
- The moral must feel EARNED by what happened, not pasted at the end

TIME OF DAY — choose based on the EMOTIONAL CORE of this specific story (not just theme):
- Pride/arrogance stories: Harsh bright noon (arrogance thrives in harshness, no shadows to hide)
- Deception/betrayal: Evening or dusk (shadows, things hidden in fading light)
- Devotion/kindness rewarded: Dawn, first light (purity of morning, before the world corrupts)
- Hard labor/struggle: Blazing midday (sweat and effort under the sun)
- Mystery/unexpected twist: Evening to night transition (world shifts as darkness comes)
- Greed/punishment: Noon into dusk (the greedy man's day turns to dust)
- Family/sacrifice: Afternoon into evening (warmth before the family gathers)
- Choose FREELY based on what fits THIS story's emotional arc — not a formula
- Add time_of_day field to output JSON with your chosen time

SCENE 1 (HOOK) — CINEMATIC OPENING with character introduction:
- Scene 1 MUST feel like the BEGINNING of a significant day in this character's life
- Include: specific time-of-day atmosphere + character's DAILY ROUTINE (what they're doing)
- The character should be shown in their NATURAL HABITAT first — before conflict begins
- Video prompt Scene 1: Start with the character doing something SPECIFIC and ordinary
  e.g., 'watering crops at dawn', 'counting coins in morning light', 'walking to the river at dusk'
- The time atmosphere in Scene 1 must be SPECIFIC, not generic:
  NOT: 'morning light'
  YES: 'Warm golden dawn light through neem leaves, distant birds beginning to call, dew on the grass'
- Scene N (final): Include complementary closing atmosphere — changed light, changed world

TTS TEXT: Hindi Devanagari, 12-18 words per scene (fits 6-9 seconds at natural storyteller pace). Punchy, emotional lines. Third-person narrator. No filler words. Each line should feel like a chapter opening.

VEO CONTENT SAFETY RULES — CRITICAL (violating these wastes real money by triggering Veo content filter):

NEVER use these words or actions in video_prompt:
- Physical violence: hit, beat, strike, punch, slap, kick, push, attack, grab, drag, throw, assault
- Injury or pain: wound, blood, bruise, hurt, injured, collapsed, writhing, in pain
- Death or dying: dead, dying, died, corpse, burial, funeral, lifeless, perishes
- Extreme distress: screaming, wailing, crying uncontrollably, in agony, panicking
- Crowd danger: angry mob, panicking crowd, fleeing villagers, rampaging, rioting
- Threats: raised fist, brandishing weapon, menacing approach, threatening gesture, sword raised to strike
- Intense confrontation: grabbing collar, pushing down, forcing to kneel, restraining

SAFE VISUAL ALTERNATIVES — use these instead:
- Confrontation: "stands facing [character], arms crossed, expression hard and dismissive"
- Anger: "face tightening with frustration, jaw clenched, eyes narrowed"
- Defeat: "head bowed low, shoulders drooping, staring at the ground"
- Humiliation: "kneels on the ground, hands clasped together, looking up quietly"
- Grief: "sits alone under a tree, hands in lap, expression of deep sadness"
- Shock/twist: "steps back slightly, eyes wide, mouth slightly open in disbelief"
- Dismissal: "waves hand away slowly, turns back, walks away"
- Punishment/consequence: "sits alone in a bare courtyard, empty hands, fading afternoon light"
- Tense crowd: "villagers stand watching in silence, faces showing concern"
- Character conflict: "two characters stand at distance facing each other, a long tense silence"
- Sadness without crying: "eyes glistening, lower lip trembling slightly, looking into the distance"

KEY PRINCIPLE: Show EMOTION and BODY LANGUAGE, not physical action. Veo renders faces and expressions beautifully — use that strength.

FORBIDDEN (general):
- Real brand names, specific living celebrities or politicians
- Living religious leaders (generic sant/guru/sadhu is fine)
- Smartphones, cars, modern offices (unless story is explicitly modern)
- Any dialogue instruction in video_prompt (no 'says', 'shouts', 'whispers')`,

  scene_rewrite: `You are rewriting a Veo video prompt for a Hindi moral story animation. The prompt was REJECTED by Veo's content filter.

STRICT RULES:
1. Keep the character description at the START exactly word-for-word — do not change even one character
2. Keep the style suffix at the END exactly unchanged
3. Rewrite ONLY the action/scene in the middle
4. Use the story context (narrator line + beat) to understand what should be visually shown
5. MUST stay in Indian period setting (village/field/river/palace/kingdom) — NO rooms, kitchens, fantasy worlds, modern settings
6. Show Indian human characters in traditional clothing — NOT robots, monsters, creatures, or animals
7. The new action must be peaceful but story-relevant
8. Return ONLY the complete rewritten prompt text. No conversational introductions, explanations, or markdown blocks.`,
}

// ─── Load prompt from DB (with fallback to default) ──────────────────────────

async function getPrompt(key: keyof typeof DEFAULT_PROMPTS): Promise<string> {
  const saved = await settingsDb.get(`prompt_${key}`, '')
  return saved || DEFAULT_PROMPTS[key]
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function pickTopic(storyId: string): Promise<{ topic: string; theme: string; hook_idea: string }> {
  const system = await getPrompt('topic_picker')
  const user = `Generate a fresh Hindi moral story topic. story_id: ${storyId}
Return JSON: { "topic": "...", "theme": "moral_karma|spiritual|family", "hook_idea": "..." }`

  const raw = await callGemini(system, user)
  const parsed = JSON.parse(raw)
  return { topic: parsed.topic, theme: parsed.theme, hook_idea: parsed.hook_idea }
}

const SCRIPT_JSON_EXAMPLE = `{
  "story_id": "story_2026_06_02_123",
  "title_hindi": "लालची सेठ की सीख",
  "hook_caption": "सेठ का अहंकार टूटा",
  "moral": "दूसरों की मदद करने से अपना भला होता है",
  "time_of_day": "harsh bright noon",
  "character_anchor": {
    "description_en": "A portly merchant in his 50s wearing a bright saffron dhoti with gold border, crisp white kurta, thick black moustache, calculating dark eyes, heavy gold chain around neck, always counting coins",
    "description_hi": "पचास साल का मोटा सेठ, केसरिया धोती में, सोने की चेन के साथ"
  },
  "secondary_character_anchor": {
    "description_en": "A frail elderly woman in her 70s wearing a faded grey saree with white border, silver hair tied in a bun, kind wrinkled face, carrying a small earthen pot",
    "description_hi": "सत्तर साल की दुबली बुढ़िया, धुंधली साड़ी में, मिट्टी का घड़ा लिए"
  },
  "scenes": [
    {
      "scene_num": 1,
      "beat": "setup",
      "video_prompt": "A portly merchant in his 50s wearing a bright saffron dhoti with gold border, crisp white kurta, thick black moustache, calculating dark eyes, heavy gold chain around neck, always counting coins. He sits cross-legged on a wooden platform outside his grain shop under harsh noon sun, counting gold coins into a brass bowl, expression smug and satisfied. Bright midday light casts sharp shadows, dust motes in the hot air, distant bazaar sounds. Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only. Vertical 9:16, no text or captions in frame, no logos or brand marks.",
      "tts_text": "गाँव के सबसे अमीर सेठ रोज दोपहर को अपनी दुकान पर बैठकर सोने के सिक्के गिनते थे।",
      "caption": "सेठ का घमंड"
    },
    {
      "scene_num": 2,
      "beat": "conflict",
      "video_prompt": "A portly merchant in his 50s wearing a bright saffron dhoti with gold border, crisp white kurta, thick black moustache, calculating dark eyes, heavy gold chain around neck, always counting coins. Wide two-shot framing. A frail elderly woman in her 70s wearing a faded grey saree with white border, silver hair tied in a bun, kind wrinkled face, carrying a small earthen pot. The old woman stands at the shop entrance with hands folded, the merchant waves her away dismissively without looking up from his coins. Harsh noon light, dry dusty street behind them. Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only. Vertical 9:16, no text or captions in frame, no logos or brand marks.",
      "tts_text": "एक गरीब बुढ़िया ने थोड़ा अनाज माँगा — सेठ ने हाथ के इशारे से भगा दिया।",
      "caption": "निर्दयी सेठ"
    }
  ],
  "total_scenes": 10
}`

export async function writeScript(storyId: string, topic: string, theme: string): Promise<Script> {
  const system = await getPrompt('script_writer')
  const user = `story_id: ${storyId}
theme: ${theme}
topic: ${topic}

Generate 8-10 scenes (8 seconds each, 64-80 seconds total).

CRITICAL: Return ONLY valid JSON matching EXACTLY the structure below. No extra fields, no markdown, no explanation.

REQUIRED OUTPUT STRUCTURE (follow this example):
${SCRIPT_JSON_EXAMPLE}

Your output must be a SINGLE JSON object with these exact keys:
- story_id (string, use: "${storyId}")
- title_hindi (string, 8-15 Hindi chars)
- hook_caption (string, ≤6 Hindi words)
- moral (string, 1 Hindi line)
- time_of_day (string, emotional time choice)
- character_anchor.description_en (30-60 words English, VERY specific clothing/face/age)
- character_anchor.description_hi (Hindi version)
- secondary_character_anchor.description_en (30-60 words or empty string)
- secondary_character_anchor.description_hi (Hindi version or empty string)
- scenes (array of 8-10 objects, each with: scene_num INTEGER, beat, video_prompt, tts_text, caption)
- total_scenes (integer)`

  const raw = await callGemini(system, user)

  // Parse with validation
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Gemini returned invalid JSON. Raw response: ${raw.slice(0, 200)}`)
  }

  // Validate required fields
  if (!Array.isArray(parsed.scenes) || (parsed.scenes as unknown[]).length < 8) {
    throw new Error(`Script needs 8-10 scenes, got ${Array.isArray(parsed.scenes) ? (parsed.scenes as unknown[]).length : 0}`)
  }
  if (!parsed.character_anchor || !(parsed.character_anchor as Record<string, unknown>).description_en) {
    throw new Error('character_anchor.description_en is missing — script invalid')
  }

  const primaryAnchor = String((parsed.character_anchor as Record<string, string>).description_en || '')
  const secondaryAnchor = String((parsed.secondary_character_anchor as Record<string, string>)?.description_en || '')

  if (primaryAnchor.split(' ').length < 20) {
    throw new Error(`character_anchor too short (${primaryAnchor.split(' ').length} words) — needs 30-60 words for Veo consistency`)
  }

  const scenes: Scene[] = (parsed.scenes as Record<string, unknown>[]).map(s => ({
    scene_num: String(s.scene_num).padStart(2, '0'),
    beat: String(s.beat || ''),
    video_prompt: String(s.video_prompt || ''),
    tts_text: String(s.tts_text || ''),
    caption: String(s.caption || ''),
    primary_anchor: primaryAnchor,
    secondary_anchor: secondaryAnchor,
    has_secondary: secondaryAnchor.length > 10,
  }))

  // Validate each scene has required fields
  for (const scene of scenes) {
    if (!scene.video_prompt || scene.video_prompt.length < 50) {
      throw new Error(`Scene ${scene.scene_num} video_prompt too short or missing`)
    }
    if (!scene.tts_text || !scene.tts_text.match(/[ऀ-ॿ]/)) {
      throw new Error(`Scene ${scene.scene_num} tts_text missing or not in Hindi Devanagari`)
    }
  }

  if (scenes.length < 8) throw new Error(`Script only has ${scenes.length} scenes, need at least 8`)

  return {
    story_id: String(parsed.story_id || storyId),
    title_hindi: String(parsed.title_hindi || ''),
    hook_caption: String(parsed.hook_caption || ''),
    moral: String(parsed.moral || ''),
    character_anchor: parsed.character_anchor as Script['character_anchor'],
    secondary_character_anchor: (parsed.secondary_character_anchor || { description_en: '', description_hi: '' }) as Script['secondary_character_anchor'],
    scenes,
    total_scenes: scenes.length,
  }
}

export async function rewriteFilteredPrompt(topic: string, scene: Scene): Promise<string> {
  const system = await getPrompt('scene_rewrite')
  const token = await getAccessToken()
  const res = await fetch(`${BASE}/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: `Story: ${topic}\nScene ${scene.scene_num} — Beat: ${scene.beat}\nNarrator: "${scene.tts_text}"\n\nOriginal rejected prompt:\n${scene.video_prompt}\n\nRewrite: keep character anchors verbatim, keep Indian period setting, replace only the filtered action.` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 450 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini rewrite error ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || scene.video_prompt
}
