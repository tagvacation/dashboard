import { getAccessToken, GCP_PROJECT, GCP_REGION } from './auth'
import { settingsDb } from '../db'
import type { Script, Scene } from './types'

const GEMINI_MODEL = 'gemini-2.0-flash'
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
  topic_picker: `You are a creative director for a Hindi YouTube Shorts channel called KathaKar.
Pick a compelling story topic for today's video.

NICHE DISTRIBUTION (follow strictly):
- 80% moral/karma: raja-garib, ameer-gareeb, karma twists, pride vs humility
- 15% spiritual/dharmic: sant ki seekh, devotion rewarded, dharma prevails
- 5% family/emotional: father-son, mother sacrifice

RULES:
- Story fits in 60-90 seconds (8-10 scenes)
- Must have a clear TWIST — unexpected reversal
- Must end with a moral lesson
- Protagonist is human (king, farmer, merchant, sant, mother, son etc.)
- No modern settings — village/kingdom/nature preferred
- Topic must feel fresh, not a generic cliché

Return ONLY a valid JSON object.`,

  script_writer: `You are a master Hindi storyteller writing short-form moral stories for YouTube Reels.
Output STRICT JSON only — no prose, no markdown fences.

STORY STRUCTURE:
- Scene 1: HOOK — establishes character + conflict in <10 seconds
- Scenes 2-8: Build conflict and emotional tension
- Scene N-1: TWIST — unexpected reversal
- Scene N: MORAL PAYOFF — lesson stated clearly

CHARACTER ANCHOR RULES (CRITICAL for Veo consistency):
- primary character_anchor.description_en: 30-60 words, specific age/build/clothing/facial features
- secondary_character_anchor.description_en: same format, empty string if no secondary character
- VERBATIM at START of every scene video_prompt

VEO PROMPT RULES:
- Single character: [primary anchor] + action + setting + STYLE
- Secondary only: [secondary anchor] + action + setting + STYLE
- Both characters: [primary anchor] Wide two-shot framing. [secondary anchor] + action + setting + STYLE
- STYLE to append EVERY prompt word-for-word: "${STYLE_SUFFIX}"
- End EVERY prompt: Vertical 9:16, no text or captions in frame, no logos or brand marks.
- Length: 80-150 words
- ENGLISH ONLY in video_prompt

VEO CONTENT SAFETY (violating wastes credits):
NEVER use: hit, beat, strike, punch, attack, grab, wound, blood, dead, dying, screaming, wailing, panicking crowd, angry mob, raised fist, grabbing collar
INSTEAD use: stands facing with arms crossed, head bowed low, shoulders drooping, face showing sadness, eyes glistening, steps back in disbelief, waves hand dismissively, sits alone quietly

TTS TEXT: Hindi Devanagari, 12-18 words per scene. Punchy. Third-person narrator. No filler.

FORBIDDEN: Real brands, living politicians/celebrities, living religious leaders, smartphones/cars/modern offices, dialogue in video_prompt`,

  scene_rewrite: `You rewrite a Veo video prompt for a Hindi moral story animation. The prompt was REJECTED by Veo's content filter.
RULES:
1. Keep character description at the START exactly word-for-word
2. Keep the style suffix at the END exactly unchanged
3. Rewrite ONLY the action/scene in the middle
4. Stay in Indian period setting (village/field/river/palace/kingdom)
5. Show Indian human characters — NOT robots, monsters, or animals
6. Replace filtered action with peaceful story-appropriate alternative
7. Return ONLY the complete rewritten prompt text`,
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

export async function writeScript(storyId: string, topic: string, theme: string): Promise<Script> {
  const system = await getPrompt('script_writer')
  const user = `story_id: ${storyId}
theme: ${theme}
topic: ${topic}

Generate 8-10 scenes (8 seconds each, 64-80 seconds total). Return ONLY the JSON object matching this schema exactly:
{
  "story_id": "${storyId}",
  "title_hindi": "string (8-15 chars)",
  "hook_caption": "string (Hindi ≤6 words)",
  "moral": "string (Hindi 1 line)",
  "character_anchor": { "description_en": "string", "description_hi": "string" },
  "secondary_character_anchor": { "description_en": "string or empty", "description_hi": "string or empty" },
  "scenes": [{ "scene_num": 1, "beat": "setup|conflict|rising_action|twist|resolution", "video_prompt": "English", "tts_text": "Hindi Devanagari", "caption": "Hindi ≤8 words" }],
  "total_scenes": number
}`

  const raw = await callGemini(system, user)
  const parsed = JSON.parse(raw)

  const primaryAnchor = parsed.character_anchor?.description_en || ''
  const secondaryAnchor = parsed.secondary_character_anchor?.description_en || ''

  const scenes: Scene[] = (parsed.scenes || []).map((s: Record<string, unknown>) => ({
    scene_num: String(s.scene_num).padStart(2, '0'),
    beat: String(s.beat || ''),
    video_prompt: String(s.video_prompt || ''),
    tts_text: String(s.tts_text || ''),
    caption: String(s.caption || ''),
    primary_anchor: primaryAnchor,
    secondary_anchor: secondaryAnchor,
    has_secondary: secondaryAnchor.length > 10,
  }))

  if (scenes.length < 8) throw new Error(`Script only has ${scenes.length} scenes, need at least 8`)
  return { ...parsed, scenes, total_scenes: scenes.length }
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
