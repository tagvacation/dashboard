import { settingsDb } from '../db'
import { defaultContext, getAccessToken } from './auth'
import type { Script, Scene } from './types'

// Vertex AI Gemini endpoint — uses service account auth (not API key)
// Same request/response format as Gemini Developer API; no quota issues with credits
const GEMINI_MODEL = 'gemini-2.5-flash'

function geminiUrl(): string {
  const ctx = defaultContext()
  return `https://${ctx.region}-aiplatform.googleapis.com/v1/projects/${ctx.projectId}/locations/${ctx.region}/publishers/google/models/${GEMINI_MODEL}:generateContent`
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function callGemini(systemPrompt: string, userPrompt: string, temperature = 0.8): Promise<string> {
  const ctx = defaultContext()
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature, maxOutputTokens: 65536, responseMimeType: 'application/json' },
  })

  const doFetch = async () => {
    const token = await getAccessToken(ctx)
    return fetch(geminiUrl(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
  }

  let res: Response = await doFetch()
  for (let attempt = 1; attempt < 4 && res.status === 429; attempt++) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') || '0')
    const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.pow(2, attempt) * 5_000
    console.warn(`Gemini 429 — waiting ${waitMs / 1000}s before retry ${attempt}`)
    await sleep(waitMs)
    res = await doFetch()
  }
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()

  // Check for finish reason — STOP = complete, MAX_TOKENS = truncated
  const candidate = data.candidates?.[0]
  const finishReason = candidate?.finishReason
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini response truncated (MAX_TOKENS hit). Response was cut at: ...${(candidate?.content?.parts?.[0]?.text || '').slice(-100)}`)
  }

  const text = candidate?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty response')
  return text
}

// ─── Default prompts (used if no custom prompt saved in DB) ──────────────────

const STYLE_SUFFIX = 'Pixar-inspired stylized 3D animation, warm soft lighting, expressive character faces, vibrant colors, smooth animation quality, Indian period village setting. No character voices or dialogue audio — ambient environmental sounds only (wind, birds, rain, market crowd, temple bells, nature sounds matching the scene). Vertical 9:16, no text or captions in frame, no logos or brand marks.'

// Shared safety block — verified against real Veo content-filter rejections
// (2026-06-06: Veo Lite tightened around female-coded characters, distress verbs, physical touch)
export const SAFETY_CORE = `VEO CONTENT SAFETY — CRITICAL (verified 2026-06-06 against real rejections):

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

// Shared craft block — proven across KathaKar (Blacksmith 12K views) + Veggie Drama
export const CRAFT_CORE = `TITLE FORMULA (proven viral patterns):

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

export const DEFAULT_PROMPTS = {
  topic_picker: `You are a creative director for a Hindi YouTube Shorts channel called KathaKar. Your job is to pick a compelling story topic for today's video.

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
}`,

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

${SAFETY_CORE}

KEY PRINCIPLE: Show EMOTION and BODY LANGUAGE, not physical action. Veo renders faces and expressions beautifully — use that strength.

FORBIDDEN (general):
- Real brand names, specific living celebrities or politicians
- Living religious leaders (generic sant/guru/sadhu is fine)
- Smartphones, cars, modern offices (unless story is explicitly modern)
- Any dialogue instruction in video_prompt (no 'says', 'shouts', 'whispers')

${CRAFT_CORE}

OUTPUT TITLE: include a "title_hindi" field following the title formula above. Distill the contrast/hook — do NOT paste the topic description as the title.`,

  scene_rewrite: `You rewrite a REJECTED Veo animation action description. Veo's content filter blocked the original.

Return ONLY 1-3 sentences describing a SAFE, PEACEFUL alternative ACTION. NO character descriptions. NO style words. NO animation instructions. Just what the character does and where.

${SAFETY_CORE}

REWRITE STRATEGY:
- Identify which banned element triggered the filter (distress verb, physical touch, female-coded + innocence pattern, etc.)
- Replace with the matching SAFE ALTERNATIVE from the list above
- Keep the story beat intact — the scene's purpose should still land
- Stay in Indian period setting (village/field/river/palace/kingdom) — NO modern settings, NO Western locations

Output: 1-3 sentences. Just the action. No preamble like "Here's the rewrite" or markdown blocks.`,
}

// ─── Veo prompt builder — ALWAYS programmatically correct ────────────────────
// Gemini often forgets to include anchors. This guarantees structure every time.

function buildVeoPrompt(
  rawPrompt: string,
  primaryAnchor: string,
  secondaryAnchor: string,
  hasSecondary: boolean
): string {
  // Extract the action part: strip any existing anchor and style suffix
  let action = rawPrompt

  // Strip primary anchor if Gemini included it (avoid duplication)
  if (primaryAnchor && action.startsWith(primaryAnchor)) {
    action = action.slice(primaryAnchor.length).trim()
  }

  // Strip "Wide two-shot framing." prefix if present
  if (action.startsWith('Wide two-shot framing.')) {
    action = action.replace('Wide two-shot framing.', '').trim()
  }

  // Strip secondary anchor if present
  if (hasSecondary && secondaryAnchor && action.startsWith(secondaryAnchor)) {
    action = action.slice(secondaryAnchor.length).trim()
  }

  // Strip ALL style/suffix content — find first style keyword and truncate
  const STYLE_MARKERS = [
    'Pixar-inspired', 'Warm glowing particle', 'Wide-angle cinematic lens',
    'No character voices', 'ambient sounds only', 'Vertical 9:16',
    'cinematic lens', 'Magical realism', 'Epic cinematic', 'Bright pop-art',
    'comic book style', 'animation quality', 'No character voices',
  ]
  for (const marker of STYLE_MARKERS) {
    const idx = action.indexOf(marker)
    if (idx !== -1) { action = action.slice(0, idx).trim(); break }
  }

  // Rebuild with guaranteed structure
  let prompt = primaryAnchor

  if (hasSecondary && secondaryAnchor) {
    prompt += ` Wide two-shot framing. ${secondaryAnchor}`
  }

  prompt += ` ${action} ${STYLE_SUFFIX} Vertical 9:16, no text or captions in frame, no logos or brand marks.`

  return prompt
}

// ─── Load prompt from DB (with fallback to default) ──────────────────────────

async function getPrompt(key: keyof typeof DEFAULT_PROMPTS): Promise<string> {
  const saved = await settingsDb.get(`prompt_${key}`, '')
  return saved || DEFAULT_PROMPTS[key]
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function pickTopic(storyId: string, promptOverride?: string): Promise<{ topic: string; theme: string; hook_idea: string }> {
  const system = promptOverride || await getPrompt('topic_picker')
  const user = `Generate a fresh story topic. story_id: ${storyId}
Return JSON: { "topic": "...", "theme": "string", "hook_idea": "..." }`

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

export async function writeScript(storyId: string, topic: string, theme: string, promptOverride?: string): Promise<Script> {
  const system = promptOverride || await getPrompt('script_writer')
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

  const hasSecondary = secondaryAnchor.length > 10

  const scenes: Scene[] = (parsed.scenes as Record<string, unknown>[]).map(s => {
    const rawPrompt = String(s.video_prompt || '')

    // PROGRAMMATICALLY guarantee anchor is at start — never trust Gemini to include it
    const builtPrompt = buildVeoPrompt(rawPrompt, primaryAnchor, secondaryAnchor, hasSecondary)

    return {
      scene_num: String(s.scene_num).padStart(2, '0'),
      beat: String(s.beat || ''),
      video_prompt: builtPrompt,
      tts_text: String(s.tts_text || ''),
      caption: String(s.caption || ''),
      primary_anchor: primaryAnchor,
      secondary_anchor: secondaryAnchor,
      has_secondary: hasSecondary,
    }
  })

  // Validate each scene
  for (const scene of scenes) {
    if (!scene.video_prompt || scene.video_prompt.length < 80) {
      throw new Error(`Scene ${scene.scene_num} video_prompt too short after reconstruction`)
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

/**
 * Rewrites a content-filtered Veo prompt SAFELY:
 * 1. Gemini rewrites ONLY the action (middle part) — 1-2 sentences
 * 2. We PROGRAMMATICALLY reconstruct: anchor + new_action + style_suffix
 * This guarantees character anchor and style NEVER change between attempts.
 */
export async function rewriteFilteredPrompt(topic: string, scene: Scene): Promise<string> {
  const ctx = defaultContext()

  // Extract the action-only part from original prompt
  // Format: [anchor] [action] [style_suffix]
  const styleSuffix = STYLE_SUFFIX
  let actionPart = String(scene.video_prompt || '')

  // Strip primary anchor from start
  if (scene.primary_anchor && actionPart.startsWith(scene.primary_anchor)) {
    actionPart = actionPart.slice(scene.primary_anchor.length).trim()
  }
  // Strip "Wide two-shot. [secondary anchor]" if present
  if (actionPart.startsWith('Wide two-shot framing.')) {
    actionPart = actionPart.replace('Wide two-shot framing.', '').trim()
    if (scene.secondary_anchor && actionPart.startsWith(scene.secondary_anchor)) {
      actionPart = actionPart.slice(scene.secondary_anchor.length).trim()
    }
  }
  // Strip style suffix
  const styleIdx = actionPart.indexOf('Pixar-inspired')
  if (styleIdx !== -1) actionPart = actionPart.slice(0, styleIdx).trim()

  // Ask Gemini to rewrite ONLY the action part (NOT the full prompt)
  const system = `You rewrite a REJECTED Veo animation action description.
Return ONLY 1-2 sentences describing a safe, peaceful alternative action.
DO NOT include character descriptions. DO NOT include style/animation instructions.
Just the action: what the character is doing, where, with what expression.
Keep it story-relevant and in Indian village/period setting.`

  const user = `Story: ${topic}
Scene ${scene.scene_num} — Beat: ${scene.beat}
Narrator line: "${scene.tts_text}"

Original REJECTED action:
${actionPart}

Rewrite: peaceful story-relevant alternative (1-2 sentences only). No character descriptions, no style words.`

  const rewriteBody = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
  })
  const doRewriteFetch = async () => {
    const token = await getAccessToken(ctx)
    return fetch(geminiUrl(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: rewriteBody,
    })
  }
  let res = await doRewriteFetch()
  for (let attempt = 1; attempt < 4 && res.status === 429; attempt++) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') || '0')
    const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.pow(2, attempt) * 5_000
    await sleep(waitMs)
    res = await doRewriteFetch()
  }
  if (!res.ok) throw new Error(`Gemini rewrite error ${res.status}`)
  const data = await res.json()
  const newAction = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

  if (!newAction) return scene.video_prompt // fallback to original if Gemini fails

  // PROGRAMMATICALLY reconstruct — anchor and style NEVER change
  let reconstructed = scene.primary_anchor

  if (scene.has_secondary && scene.secondary_anchor) {
    reconstructed += ` Wide two-shot framing. ${scene.secondary_anchor}`
  }

  reconstructed += ` ${newAction} ${styleSuffix} Vertical 9:16, no text or captions in frame, no logos or brand marks.`

  return reconstructed
}
