/**
 * Generate Veggie Drama video #2 — wife-betrayal trope (Ai pixeltales viral format).
 * Uses the OPTIMIZED prompts now in DB (veggie_drama category).
 *
 * Run from dashboard/: node scripts/generate-veggie-v2.mjs
 */

import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import postgres from 'postgres'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
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
const bucket = process.env.GCS_BUCKET || 'ai_clip_007'

const STORY_ID = `story_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}_veggie_v2_${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const CATEGORY_ID = 'veggie_drama'
const CHANNEL_ID = 'kissopedia'

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

const storage = new Storage({ credentials })
const bucketRef = storage.bucket(bucket)
const PUBLIC_BASE = `https://storage.googleapis.com/${bucket}`

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getToken() {
  const client = await auth.getClient()
  const t = await client.getAccessToken()
  return t.token
}

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

const OUT = join('..', 'audit-output', new Date().toISOString().split('T')[0])
mkdirSync(OUT, { recursive: true })

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt, temperature = 0.85, maxOutputTokens = 16384) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini truncated. Tail: ...${(candidate?.content?.parts?.[0]?.text || '').slice(-200)}`)
  }
  const text = candidate?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response')
  return JSON.parse(text)
}

// ─── TTS (chunked for Hindi — 5KB byte limit per call) ───────────────────────
async function ttsCall(ssml) {
  const token = await getToken()
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Algenib' },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return Buffer.from(data.audioContent, 'base64')
}

async function generateAudio(scenes) {
  const audioPath = `stories/${STORY_ID}/audio/full_narration.mp3`
  const pieces = scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1
    const isTwist = scene.beat === 'reversal' || scene.beat === 'payoff'
    const isHook = i === 0
    const breakTag = isLast ? '' : isTwist ? '<break time="900ms"/>' : isHook ? '<break time="500ms"/>' : '<break time="400ms"/>'
    const text = isTwist ? `<emphasis level="strong">${scene.tts_text}</emphasis>` : scene.tts_text
    return text + breakTag
  })

  // Bin-pack pieces into <4500 byte chunks
  const chunks = []
  let current = [], currentBytes = 0
  const LIMIT = 4500 - 20 // header overhead for <speak></speak>
  for (const piece of pieces) {
    const pBytes = Buffer.byteLength(piece + ' ', 'utf-8')
    if (currentBytes + pBytes > LIMIT && current.length > 0) {
      chunks.push(current.join(' '))
      current = []; currentBytes = 0
    }
    current.push(piece); currentBytes += pBytes
  }
  if (current.length) chunks.push(current.join(' '))

  log(`  Audio split into ${chunks.length} TTS chunk(s)`)
  const buffers = []
  for (let i = 0; i < chunks.length; i++) {
    const ssml = `<speak>${chunks[i]}</speak>`
    log(`  Chunk ${i + 1}/${chunks.length}: ${Buffer.byteLength(ssml, 'utf-8')} bytes`)
    buffers.push(await ttsCall(ssml))
  }
  const buf = Buffer.concat(buffers)
  await bucketRef.file(audioPath).save(buf, { contentType: 'audio/mpeg' })
  return `${PUBLIC_BASE}/${audioPath}`
}

// ─── Veo ──────────────────────────────────────────────────────────────────────
const VEO_MODEL = 'veo-3.1-lite-generate-001'

async function submitVeo(prompt) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${VEO_MODEL}:predictLongRunning`
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 30_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: '9:16', sampleCount: 1, durationSeconds: 8, resolution: '1080p', personGeneration: 'allow_all', generateAudio: false },
      }),
    })
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Veo submit ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.name
  }
  throw new Error('Veo quota exhausted')
}

async function pollVeo(opName) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${VEO_MODEL}:fetchPredictOperation`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName: opName }),
  })
  if (!res.ok) throw new Error(`Veo poll ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.done) return { done: false }
  if (data.error) return { done: true, filtered: true, error: data.error.message }
  const b64 = data.response?.videos?.[0]?.bytesBase64Encoded
  if (!b64) return { done: true, filtered: true, error: 'No video in response' }
  return { done: true, filtered: false, base64: b64 }
}

async function submitAndPoll(prompt, sceneNum) {
  const opId = await submitVeo(prompt)
  log(`  Scene ${sceneNum}: submitted`)
  for (let i = 0; i < 20; i++) {
    await sleep(60_000)
    const r = await pollVeo(opId)
    if (!r.done) continue
    if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
    return r.base64
  }
  throw new Error('Veo poll timeout')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`Generating veggie drama v2 → ${STORY_ID}`)

  // 1. Load category from DB
  const [cat] = await sql`SELECT * FROM content_categories WHERE id = ${CATEGORY_ID}`
  if (!cat) throw new Error('veggie_drama category missing')
  log(`Category: ${cat.name} (prompts: ${cat.prompt_topic_picker.length} + ${cat.prompt_script_writer.length} chars)`)

  // 2. Force the wife-betrayal trope (proven viral)
  log('Generating topic with FORCED wife-betrayal trope...')
  const topicUserPrompt = `Generate a story using the WIFE BETRAYAL trope (पत्नी ने धोखा दिया, लेकिन पति बन गया करोड़पति).

This is the proven viral pattern from Ai pixeltales (5M views in 2 days, 2026-06-04).

Cast: include Aaloo Singh (potato husband — patient, humble) as protagonist, Mirchi Devi (fiery chilli wife) as betrayer, Pyaaz Lal (cunning onion villain — the "other man") as antagonist.

Make the story emotionally rich with a specific betrayal detail (a secret meeting witnessed, a stolen gift, etc.) and a SATISFYING reversal where the husband rises through honest hard work.

Format: single (not part 1 of 2 — full payoff video).

Return JSON only.`

  const topicResult = await callGemini(cat.prompt_topic_picker, topicUserPrompt, 1.0)
  log(`✓ Topic: ${topicResult.title_draft || topicResult.topic.slice(0, 80)}`)
  log(`  Trope: ${topicResult.trope}`)
  log(`  Cast: ${topicResult.main_characters?.map(c => c.name).join(', ')}`)

  // 3. Generate full script
  log('Generating script via optimized veggie_drama script_writer prompt...')
  const scriptUserPrompt = `story_id: ${STORY_ID}
topic: ${topicResult.topic}
trope: ${topicResult.trope}
main_characters: ${JSON.stringify(topicResult.main_characters)}
hook_idea: ${topicResult.hook_idea}
format: single
target_duration_sec: 120

Generate the COMPLETE script as a single JSON object. 12-15 scenes total, 8 sec each.

CRITICAL — title_hindi must follow the Pattern B cliffhanger formula:
- Lead with emoji + setup
- Hindi action verb
- "लेकिन..." or "...फिर जो हुआ" tease
- End with "| Vegetable Story"
- Example: "🥔 पत्नी ने आलू को धोखा दिया... फिर जो हुआ वो हैरान कर देगा 😱 | Vegetable Story"

Apply ALL safety rules in the system prompt. Apply ALL craft rules. Return ONLY JSON.`

  let script
  for (let i = 1; i <= 3; i++) {
    try {
      script = await callGemini(cat.prompt_script_writer, scriptUserPrompt, 0.85)
      break
    } catch (e) {
      log(`  Script attempt ${i} failed: ${e.message.slice(0, 150)}`)
      if (i === 3) throw e
      await sleep(2000)
    }
  }
  log(`✓ Script: "${script.title_hindi}" (${script.scenes.length} scenes)`)

  // Save script for review
  writeFileSync(join(OUT, `veggie-v2-script.json`), JSON.stringify(script, null, 2))
  log(`  Saved to: ${join(OUT, `veggie-v2-script.json`)}`)

  // 4. Create DB records
  await sql`
    INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, channel_id)
    VALUES (${STORY_ID}, ${topicResult.topic}, ${topicResult.trope || 'veggie_betrayal'}, ${'generating'}, ${`stories/${STORY_ID}/`}, ${CATEGORY_ID}, ${CHANNEL_ID})
    ON CONFLICT (story_id) DO UPDATE SET topic = EXCLUDED.topic, status = ${'generating'}, category_id = EXCLUDED.category_id, channel_id = EXCLUDED.channel_id
  `
  await sql`
    INSERT INTO pipeline_runs (story_id, status, topic, theme, script_json, created_at, updated_at)
    VALUES (${STORY_ID}, ${'audio'}, ${topicResult.topic}, ${topicResult.trope || ''}, ${JSON.stringify(script)}, NOW(), NOW())
    ON CONFLICT (story_id) DO UPDATE SET script_json = EXCLUDED.script_json, status = ${'audio'}, updated_at = NOW()
  `
  log('✓ DB records created')

  // 5. Audio
  log('Generating audio...')
  const audioUrl = await generateAudio(script.scenes)
  log(`✓ Audio uploaded: ${(script.scenes.reduce((s, sc) => s + sc.tts_text.split(/\s+/).length, 0) / 120 * 60).toFixed(0)}s estimated`)
  await sql`UPDATE stories SET audio_url = ${audioUrl} WHERE story_id = ${STORY_ID}`

  // 6. Clips
  log(`Generating ${script.scenes.length} Veo Lite clips (max 2 concurrent)...`)
  const MAX_CONCURRENT = 2
  let active = 0
  const queue = []
  const acquire = () => new Promise(resolve => {
    if (active < MAX_CONCURRENT) { active++; resolve() } else queue.push(() => { active++; resolve() })
  })
  const release = () => { active--; const n = queue.shift(); if (n) n() }

  for (const scene of script.scenes) {
    const sceneNum = String(scene.scene_num).padStart(2, '0')
    const chars = scene.characters_in_scene || []
    const primary = script.characters?.find(c => c.name === chars[0])?.anchor_description_en || ''
    const secondary = script.characters?.find(c => c.name === chars[1])?.anchor_description_en || ''
    await sql`
      INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt, status)
      VALUES (${STORY_ID}, ${sceneNum}, ${scene.beat}, ${scene.video_prompt}, ${scene.tts_text}, ${primary}, ${secondary}, 1, 'pending')
      ON CONFLICT (story_id, scene_num, attempt) DO NOTHING
    `
  }

  const results = await Promise.allSettled(
    script.scenes.map(async (scene) => {
      await acquire()
      const sceneNum = String(scene.scene_num).padStart(2, '0')
      const clipPath = `stories/${STORY_ID}/clips/scene_${sceneNum}.mp4`
      try {
        await sql`UPDATE scene_jobs SET status = ${'submitted'} WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1`
        const base64 = await submitAndPoll(scene.video_prompt, sceneNum)
        const buf = Buffer.from(base64, 'base64')
        await bucketRef.file(clipPath).save(buf, { contentType: 'video/mp4' })
        await sql`UPDATE scene_jobs SET status = ${'done'} WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1`
        log(`  ✓ Scene ${sceneNum}: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
        release()
        return { sceneNum, status: 'done' }
      } catch (e) {
        const isFilter = e.message.startsWith('CONTENT_FILTER:')
        await sql`UPDATE scene_jobs SET status = ${isFilter ? 'filtered' : 'failed'}, error_message = ${e.message} WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1`
        log(`  ✗ Scene ${sceneNum}: ${e.message.slice(0, 100)}`)
        release()
        return { sceneNum, status: 'failed' }
      }
    })
  )

  const done = results.filter(r => r.status === 'fulfilled' && r.value.status === 'done').length
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'failed').length
  await sql`UPDATE stories SET status = ${'clips_ready'}, clips_generated_at = NOW(), scenes_count = ${done}, notes = ${failed > 0 ? `${failed} scene(s) failed` : ''} WHERE story_id = ${STORY_ID}`
  await sql`UPDATE pipeline_runs SET status = ${failed === 0 ? 'complete' : 'failed'}, updated_at = NOW() WHERE story_id = ${STORY_ID}`

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`DONE: ${done}/${script.scenes.length} clips, ${failed} failed`)
  log(`Story: ${STORY_ID}`)
  log(`Title: ${script.title_hindi}`)
  log(`Audio: ${PUBLIC_BASE}/stories/${STORY_ID}/audio/full_narration.mp3`)
  log(`Clips: ${PUBLIC_BASE}/stories/${STORY_ID}/clips/scene_NN.mp4`)
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
