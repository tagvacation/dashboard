/**
 * Generate AI Ad (Talking Product) end-to-end from product details.
 *
 * Hardcoded sample for now — easy to convert to take CLI args or to wire to UI.
 * Uses the ai_ad_talking_product category prompts from DB.
 *
 * Run from dashboard/: node scripts/generate-ai-ad.mjs
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

// ─── SAMPLE PRODUCT (Sundri Hair Oil) ───────────────────────────────────────
// Easy to swap for different products.
// Pass --image=/path/to/product.png to use image-to-video (recommended for ads).
const PRODUCT = {
  name: 'Sundri Hair Oil',
  category: 'Haircare',
  price: 349,
  benefits: [
    'Stops hair fall in 4 weeks',
    'Adds natural shine',
    '100% ayurvedic herbs',
    'No harsh chemicals',
  ],
  target_audience: 'Women 25-45',
  tone: 'emotional',
  duration_sec: 30,
}

// CLI: --image=/absolute/path/to/product.png  (optional but recommended)
const imageArg = process.argv.find(a => a.startsWith('--image='))?.slice(8)

const STORY_ID = `ad_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}_${PRODUCT.name.toLowerCase().replace(/\s+/g, '_').slice(0, 20)}_${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const CATEGORY_ID = 'ai_ad_talking_product'

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
  const c = await auth.getClient()
  const t = await c.getAccessToken()
  return t.token
}

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

const OUT = join('..', 'audit-output', new Date().toISOString().split('T')[0])
mkdirSync(OUT, { recursive: true })

// ─── Gemini ──────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt, temperature = 0.85, maxOutputTokens = 8192) {
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')
  return JSON.parse(text)
}

// ─── TTS (chunked) ───────────────────────────────────────────────────────────
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

async function generateAudio(scenes, audioPath) {
  const pieces = scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1
    const isCTA = scene.beat === 'cta'
    const breakTag = isLast ? '' : isCTA ? '<break time="500ms"/>' : '<break time="350ms"/>'
    // Ads = energetic emphasis on every line
    const text = `<emphasis level="moderate">${scene.tts_text}</emphasis>`
    return text + breakTag
  })

  const chunks = []
  let current = [], currentBytes = 0
  const LIMIT = 4500 - 20
  for (const piece of pieces) {
    const pBytes = Buffer.byteLength(piece + ' ', 'utf-8')
    if (currentBytes + pBytes > LIMIT && current.length > 0) {
      chunks.push(current.join(' '))
      current = []; currentBytes = 0
    }
    current.push(piece); currentBytes += pBytes
  }
  if (current.length) chunks.push(current.join(' '))

  log(`  Audio: ${chunks.length} TTS chunk(s)`)
  const buffers = []
  for (let i = 0; i < chunks.length; i++) {
    const ssml = `<speak>${chunks[i]}</speak>`
    buffers.push(await ttsCall(ssml))
  }
  const buf = Buffer.concat(buffers)
  await bucketRef.file(audioPath).save(buf, { contentType: 'audio/mpeg' })
  return buf.length
}

// ─── Veo ─────────────────────────────────────────────────────────────────────
const VEO_MODEL = 'veo-3.1-lite-generate-001'

async function submitVeo(prompt, imageGcsUri) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${VEO_MODEL}:predictLongRunning`

  // Build instance: text-to-video, or image-to-video if imageGcsUri provided
  const instance = { prompt }
  if (imageGcsUri) {
    instance.image = {
      gcsUri: imageGcsUri,
      mimeType: imageGcsUri.toLowerCase().endsWith('.jpg') || imageGcsUri.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
    }
  }

  for (let a = 0; a < 3; a++) {
    if (a > 0) await sleep(a * 30_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: '9:16', sampleCount: 1, durationSeconds: 8, resolution: '1080p', personGeneration: 'allow_all', generateAudio: false },
      }),
    })
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Veo submit ${res.status}: ${await res.text()}`)
    return (await res.json()).name
  }
  throw new Error('Veo quota')
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

async function submitAndPoll(prompt, sceneNum, imageGcsUri) {
  const opId = await submitVeo(prompt, imageGcsUri)
  log(`  Scene ${sceneNum} submitted${imageGcsUri ? ' (with reference image)' : ''}`)
  for (let i = 0; i < 20; i++) {
    await sleep(60_000)
    const r = await pollVeo(opId)
    if (!r.done) continue
    if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
    return r.base64
  }
  throw new Error('Veo timeout')
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`Generating AI Ad → ${STORY_ID}`)
  log(`Product: ${PRODUCT.name} (${PRODUCT.category})`)
  if (imageArg) log(`Reference image: ${imageArg}`)

  // Get admin user_id (we still need to attribute the story to a user)
  const [admin] = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`
  const adminUserId = admin.id

  // 1. Upload reference image to GCS (if provided) — used for Veo image-to-video
  let imageGcsUri = null
  if (imageArg) {
    const { statSync, createReadStream } = await import('fs')
    if (!statSync(imageArg).isFile()) throw new Error(`Image not found: ${imageArg}`)
    const imageExt = imageArg.split('.').pop().toLowerCase()
    const imagePath = `stories/${STORY_ID}/reference/product.${imageExt}`
    log(`Uploading reference image → gs://${bucket}/${imagePath}`)
    await new Promise((resolve, reject) => {
      createReadStream(imageArg)
        .pipe(bucketRef.file(imagePath).createWriteStream({
          contentType: imageExt === 'jpg' || imageExt === 'jpeg' ? 'image/jpeg' : 'image/png',
          resumable: false,
        }))
        .on('finish', resolve)
        .on('error', reject)
    })
    imageGcsUri = `gs://${bucket}/${imagePath}`
    log(`  ✓ Image at ${imageGcsUri}`)
  }

  // 2. Load category prompts
  const [cat] = await sql`SELECT * FROM content_categories WHERE id = ${CATEGORY_ID}`
  if (!cat) throw new Error('AI Ad category not found in DB')
  log(`Category loaded (topic_picker: ${cat.prompt_topic_picker.length} chars, script_writer: ${cat.prompt_script_writer.length} chars)`)

  // 2. Topic picker — turn product details into ad concept
  log('Generating ad concept via topic_picker...')
  const concept = await callGemini(cat.prompt_topic_picker, `Product details:
${JSON.stringify(PRODUCT, null, 2)}

Generate the ad concept. Return JSON only.`, 0.95)

  log(`✓ Concept: ${concept.ad_concept?.slice(0, 100)}`)
  log(`  Tagline: ${concept.tagline_hindi}`)
  log(`  Voice: ${concept.voice_personality}`)
  log(`  Scenes: ${concept.scenes_count}`)

  // 3. Script writer — full scene-by-scene
  log('Generating ad script...')
  const script = await callGemini(cat.prompt_script_writer, `Ad concept input:
${JSON.stringify({
  product_name: PRODUCT.name,
  category: PRODUCT.category,
  benefits: PRODUCT.benefits,
  target_audience: PRODUCT.target_audience,
  tone: PRODUCT.tone,
  duration_sec: PRODUCT.duration_sec,
  product_anchor_en: concept.product_anchor_en,
  tagline_hindi: concept.tagline_hindi,
  voice_personality: concept.voice_personality,
  scenes_count: concept.scenes_count,
}, null, 2)}

Generate the complete script with EXACTLY ${concept.scenes_count} scenes. Each video_prompt must START with product_anchor_en VERBATIM. Last scene MUST include tagline_hindi verbatim. Return JSON only.`, 0.85)

  log(`✓ Script: "${script.ad_title_hindi}" (${script.scenes.length} scenes)`)
  writeFileSync(join(OUT, `${STORY_ID}-script.json`), JSON.stringify({ concept, script, product: PRODUCT }, null, 2))

  // 4. DB records
  await sql`
    INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, channel_id, user_id)
    VALUES (${STORY_ID}, ${`${PRODUCT.name} — AI Ad`}, ${'ai_ad'}, ${'generating'}, ${`stories/${STORY_ID}/`}, ${CATEGORY_ID}, ${'kissopedia'}, ${adminUserId})
    ON CONFLICT (story_id) DO UPDATE SET status = ${'generating'}
  `
  await sql`
    INSERT INTO pipeline_runs (story_id, status, topic, theme, script_json, user_id, created_at, updated_at)
    VALUES (${STORY_ID}, ${'audio'}, ${`${PRODUCT.name} — AI Ad`}, ${'ai_ad'}, ${JSON.stringify(script)}, ${adminUserId}, NOW(), NOW())
    ON CONFLICT (story_id) DO UPDATE SET script_json = EXCLUDED.script_json
  `
  log('✓ DB records created')

  // 5. Audio
  log('Generating audio...')
  await generateAudio(script.scenes, `stories/${STORY_ID}/audio/full_narration.mp3`)
  log(`✓ Audio uploaded`)

  // 6. Clips (parallel max 2)
  log(`Generating ${script.scenes.length} Veo clips...`)
  let active = 0
  const queue = []
  const acquire = () => new Promise(resolve => {
    if (active < 2) { active++; resolve() } else queue.push(() => { active++; resolve() })
  })
  const release = () => { active--; const n = queue.shift(); if (n) n() }

  for (const scene of script.scenes) {
    const sn = String(scene.scene_num).padStart(2, '0')
    await sql`
      INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt, status)
      VALUES (${STORY_ID}, ${sn}, ${scene.beat}, ${scene.video_prompt}, ${scene.tts_text}, ${script.product_anchor_en || concept.product_anchor_en}, ${''}, 1, 'pending')
      ON CONFLICT (story_id, scene_num, attempt) DO NOTHING
    `
  }

  const results = await Promise.allSettled(script.scenes.map(async (scene) => {
    await acquire()
    const sn = String(scene.scene_num).padStart(2, '0')
    const clipPath = `stories/${STORY_ID}/clips/scene_${sn}.mp4`
    try {
      await sql`UPDATE scene_jobs SET status='submitted' WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      const b64 = await submitAndPoll(scene.video_prompt, sn, imageGcsUri)
      const buf = Buffer.from(b64, 'base64')
      await bucketRef.file(clipPath).save(buf, { contentType: 'video/mp4' })
      await sql`UPDATE scene_jobs SET status='done' WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      log(`  ✓ Scene ${sn}: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
      release()
      return { sn, ok: true }
    } catch (e) {
      const isFilter = e.message.startsWith('CONTENT_FILTER:')
      await sql`UPDATE scene_jobs SET status=${isFilter ? 'filtered' : 'failed'}, error_message=${e.message} WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      log(`  ✗ Scene ${sn}: ${e.message.slice(0, 100)}`)
      release()
      return { sn, ok: false }
    }
  }))

  const done = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
  const failed = results.length - done
  await sql`UPDATE stories SET status=${'clips_ready'}, clips_generated_at=NOW(), scenes_count=${done}, notes=${failed > 0 ? `${failed} scene(s) failed` : ''} WHERE story_id=${STORY_ID}`

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`DONE — ${done}/${script.scenes.length} clips in GCS`)
  log(`Story: ${STORY_ID}`)
  log(`Title: ${script.ad_title_hindi}`)
  log(`Tagline: ${concept.tagline_hindi}`)
  log(`Audio: ${PUBLIC_BASE}/stories/${STORY_ID}/audio/full_narration.mp3`)
  log(`Clips: ${PUBLIC_BASE}/stories/${STORY_ID}/clips/scene_NN.mp4`)
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
