/**
 * Test the Veggie Drama script writer — generate a full 12-15 scene script
 * from Topic 1 (Baingan Babu + Anguri Devi forbidden love).
 *
 * Run from dashboard/: node scripts/test-veggie-script-writer.mjs
 */

import { google } from 'googleapis'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

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

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON)
const projectId = process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603'
const region = 'us-central1'
const model = 'gemini-2.5-flash'

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

const today = new Date().toISOString().split('T')[0]
const OUT = join('..', 'audit-output', today)
mkdirSync(OUT, { recursive: true })

// ─── Topic to script ────────────────────────────────────────────────────────
const TOPIC = {
  topic: "एक गरीब किसान बैंगन बाबू और अमीर टमाटर सेठ की बेटी अंगूरी देवी का प्यार, जिसे टमाटर सेठ का घमंड तोड़ने की कोशिश करता है, पर सच्चा प्यार और मेहनत रंग लाती है।",
  trope: "अमीर VS गरीब प्यार (class divide love)",
  main_characters: [
    { name: "Baingan Babu", species: "brinjal", role: "hardworking poor farmer, in love" },
    { name: "Anguri Devi", species: "grapes", role: "rich and pampered daughter, in love" },
    { name: "Tamatar Seth", species: "tomato", role: "rich, proud, disapproving father" },
    { name: "Adrak Baba", species: "ginger", role: "wise old advisor" }
  ],
  hook_idea: "Tamatar Seth publicly humiliates Baingan Babu in the crowded sabzi mandi, throwing his humble brinjal produce on the ground, forbidding him from even looking at his daughter, Anguri Devi, who watches tearfully from a distance.",
  format: "single",
  estimated_duration_sec: 135,
}

const STYLE_SUFFIX = "Pixar-inspired stylized 3D cartoon animation, warm cinematic Indian village lighting, vibrant saturated colors, soft rounded character design, expressive cartoon faces with large eyes and big emotions, magical-realism Indian melodrama aesthetic, no character voices or dialogue audio, ambient environmental sounds only (village sounds, market crowd, wind, soft music)."

const SCRIPT_WRITER_PROMPT = `You are a master Hindi storyteller writing scripts for "Veggie Drama" — micro-drama YouTube videos where vegetable/fruit characters play out melodrama tropes.

Output STRICT JSON only. No prose, no markdown, no explanation.

STORY STRUCTURE (12-15 scenes, each 8 seconds):
1. HOOK (Scene 1) — show conflict premise visually. Strong emotional image. Algorithm-critical: first 3 sec must show the conflict.
2. SETUP (2-3) — characters in their normal world before conflict
3. INCITING INCIDENT (4-5) — the betrayal/loss/twist starts. Audience hooked.
4. FALL (6-8) — protagonist hits low point. Maximum sympathy.
5. TURNING POINT (9-10) — small kindness / clever idea / lucky break / wise mentor
6. REVERSAL (11-13) — protagonist rises. The "लेकिन…" moment.
7. PAYOFF (14-15) — confrontation. Moral OR cliffhanger.

CHARACTER ANCHORS — CRITICAL FOR VISUAL CONSISTENCY:
For each main character, write a 35-55 word ENGLISH visual description that will appear VERBATIM at the start of every scene featuring that character.

Anchor format example:
"A round chubby potato character with friendly brown skin, two black expressive eyes, a small black moustache, wearing a white dhoti and faded saffron kurta, stubby arms and legs, gentle weary expression"

The anchor must include:
- Body shape + color (the vegetable form)
- Eye style (size, expression baseline)
- Distinctive feature (moustache, glasses, headwear, accessory)
- Clothing (specific items and colors)
- Posture / expression baseline

VEO VIDEO PROMPT STRUCTURE — follow EXACTLY:
- Scene with 1 character: [anchor VERBATIM] + scene action + setting + STYLE_SUFFIX
- Scene with 2 characters: [primary anchor VERBATIM] Wide two-shot framing. [secondary anchor VERBATIM] + scene action + setting + STYLE_SUFFIX
- Scene with 3+ characters: list all anchors at start, then "Wide group framing." + scene action + setting + STYLE_SUFFIX
- ALWAYS end with: "Vertical 9:16, no text or captions in frame, no logos or brand marks."
- Total prompt length: 120-200 words

STYLE_SUFFIX (use word-for-word in every prompt):
"${STYLE_SUFFIX}"

TTS_TEXT (Hindi narration per scene):
- Hindi Devanagari only
- 15-22 words per scene (fits 6-9 sec at storyteller pace)
- Third-person narrator (NOT character dialogue)
- Dramatic, emotional, evocative
- Use specific emotional words (बेचारे, अहंकार, धोखा, आँसू, हिम्मत, बदला, सच्चा प्यार)
- Each line should feel like a chapter opening

CAPTION (on-screen burn-in):
- Hindi, ≤6 words
- Punchy, emotional

CONTENT SAFETY — Veo content filter will reject these words. AVOID in video_prompt:
- Physical action verbs: hit, beat, strike, attack, punch, throw at, push, grab, drag, kick
- Injury words: blood, wound, hurt, bleeding, injured
- Death words: dead, dying, corpse, perished
- Extreme distress: screaming, wailing, in agony, hysterical
- Weapons: knife, sword, gun, blade
- Crowd violence: angry mob, rioting, rampaging, fleeing in panic

SAFE ALTERNATIVES — use these instead:
- Humiliation: "stands facing the other with arms crossed, eyes hard and dismissive, while the other character bows head low in shame"
- Anger/confrontation: "two characters facing each other across a market stall, tense silence, one with fists at sides"
- Rejection: "waves hand dismissively, turns back, walks away into the crowd"
- Sadness: "head bowed, single tear glistening on cheek, looking at the ground, hands clasped"
- Defeat: "sits alone under a tree at sunset, empty bowl beside, shoulders slumped"
- Confrontation with father: "stands before the elder in a courtyard, hands folded respectfully, pleading expression"
- Throwing produce: "gestures sweepingly toward a basket of brinjals, basket tips, brinjals roll across the ground"
- Wealth display: "gold coins shimmering on velvet cloth, ornate brass scales, silk-clad merchant"
- Poverty: "patched simple clothes, single oil lamp, mud-walled hut, dignified posture"

Return ONLY JSON matching this EXACT schema:
{
  "story_id": "string — same as topic story_id",
  "title_hindi": "string — Hindi title 60-95 chars with 2-3 emojis, formula: [emoji] [Veggie A] [Hindi action] [Veggie B] [emoji] [cliffhanger] | Vegetable Story",
  "hook_caption": "string — ≤6 Hindi words for thumbnail overlay",
  "moral": "string — 1 Hindi line lesson",
  "format": "single",
  "characters": [
    {
      "name": "Baingan Babu",
      "species": "brinjal",
      "anchor_description_en": "string — 35-55 word visual description used VERBATIM in every scene featuring this character"
    }
  ],
  "scenes": [
    {
      "scene_num": 1,
      "beat": "hook|setup|inciting|fall|turning_point|reversal|payoff",
      "characters_in_scene": ["Baingan Babu", "Tamatar Seth"],
      "video_prompt": "string — full Veo prompt: anchor(s) + action + setting + STYLE_SUFFIX + 'Vertical 9:16, no text or captions in frame, no logos or brand marks.'",
      "tts_text": "string — Hindi narration 15-22 words",
      "caption": "string — Hindi ≤6 words"
    }
  ],
  "total_scenes": "int (12-15)",
  "total_duration_sec": "int"
}`

async function callGemini(systemPrompt, userPrompt, temperature = 0.85, maxOutputTokens = 8192) {
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini hit MAX_TOKENS. Last 200 chars: ${(candidate?.content?.parts?.[0]?.text || '').slice(-200)}`)
  }
  const text = candidate?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response')
  return JSON.parse(text)
}

async function main() {
  console.log('Generating full script for Topic 1 (Baingan Babu + Anguri Devi forbidden love)...\n')
  const storyId = `story_2026_06_06_veggie_test_001`

  const userPrompt = `story_id: ${storyId}
topic: ${TOPIC.topic}
trope: ${TOPIC.trope}
main_characters: ${JSON.stringify(TOPIC.main_characters)}
hook_idea: ${TOPIC.hook_idea}
format: ${TOPIC.format}
target_duration_sec: ${TOPIC.estimated_duration_sec}

Generate the COMPLETE script as a single JSON object. 12-15 scenes total. Each scene 8 seconds.
Use the proven 7-beat story structure (hook → setup → inciting → fall → turning_point → reversal → payoff).
Make character anchors SPECIFIC and 35-55 words each.
Every video_prompt must START with the character anchor(s) used VERBATIM.

Return ONLY the JSON object.`

  let script
  let attempts = 0
  let lastErr
  for (attempts = 1; attempts <= 3; attempts++) {
    try {
      script = await callGemini(SCRIPT_WRITER_PROMPT, userPrompt, 0.85, 16384)
      break
    } catch (e) {
      lastErr = e
      console.log(`  Attempt ${attempts} failed: ${e.message.slice(0, 200)}`)
      if (attempts < 3) await new Promise(r => setTimeout(r, 2000))
    }
  }
  if (!script) throw lastErr

  // Validate
  console.log(`✓ Script generated in ${attempts} attempt(s)\n`)
  console.log('━━━━━━━━ STORY OVERVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Title:    ${script.title_hindi}`)
  console.log(`Caption:  ${script.hook_caption}`)
  console.log(`Moral:    ${script.moral}`)
  console.log(`Scenes:   ${script.scenes?.length} | Duration: ${script.total_duration_sec}s`)
  console.log('')
  console.log('━━━━━━━━ CHARACTER ANCHORS ━━━━━━━━━━━━━━━━━━━━━━')
  for (const c of script.characters || []) {
    console.log(`\n👤 ${c.name} (${c.species})`)
    console.log(`   ${c.anchor_description_en}`)
  }
  console.log('')
  console.log('━━━━━━━━ SCENES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  for (const s of script.scenes || []) {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`SCENE ${s.scene_num} [${s.beat}] — ${s.characters_in_scene?.join(', ')}`)
    console.log(`Caption: ${s.caption}`)
    console.log(`TTS:     ${s.tts_text}`)
    console.log(`Prompt:  ${s.video_prompt.slice(0, 300)}${s.video_prompt.length > 300 ? '...' : ''}`)
  }

  // Validation checks
  console.log('\n\n━━━━━━━━ VALIDATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const issues = []
  if (!script.scenes || script.scenes.length < 12) issues.push(`Scene count ${script.scenes?.length} < 12`)
  if (script.scenes.length > 15) issues.push(`Scene count ${script.scenes.length} > 15`)
  for (const c of script.characters || []) {
    const wordCount = c.anchor_description_en?.split(' ').length || 0
    if (wordCount < 30 || wordCount > 60) issues.push(`Anchor '${c.name}' is ${wordCount} words (target 35-55)`)
  }
  for (const s of script.scenes || []) {
    if (!s.tts_text?.match(/[ऀ-ॿ]/)) issues.push(`Scene ${s.scene_num} TTS not in Hindi`)
    if (s.video_prompt && !s.video_prompt.includes('Vertical 9:16')) issues.push(`Scene ${s.scene_num} prompt missing aspect`)
    if (s.video_prompt && !s.video_prompt.includes('Pixar-inspired')) issues.push(`Scene ${s.scene_num} prompt missing style suffix`)
    // Check anchor presence
    for (const charName of s.characters_in_scene || []) {
      const charAnchor = script.characters?.find(c => c.name === charName)?.anchor_description_en
      if (charAnchor && !s.video_prompt.includes(charAnchor.slice(0, 50))) {
        issues.push(`Scene ${s.scene_num} doesn't include anchor for ${charName}`)
      }
    }
  }
  if (issues.length === 0) {
    console.log('✓ ALL CHECKS PASSED')
  } else {
    console.log(`✗ ${issues.length} issue(s):`)
    issues.forEach(i => console.log(`  • ${i}`))
  }

  writeFileSync(join(OUT, 'veggie-script-test.json'), JSON.stringify(script, null, 2))
  console.log(`\n✓ Saved to ${join(OUT, 'veggie-script-test.json')}`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
