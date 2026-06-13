/**
 * Generate 2 more AI Ad samples for portfolio (Snack + Jewelry).
 * Sequential to respect Veo quota (max 2 concurrent within each ad).
 *
 * Run from dashboard/: node scripts/generate-ad-samples.mjs
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

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const storage = new Storage({ credentials })
const bucketRef = storage.bucket(bucket)
const PUBLIC_BASE = `https://storage.googleapis.com/${bucket}`
const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })
const OUT = join('..', 'audit-output', new Date().toISOString().split('T')[0])
mkdirSync(OUT, { recursive: true })

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getToken() {
  const c = await auth.getClient()
  const t = await c.getAccessToken()
  return t.token
}

// ─── 2 NEW PRODUCT SAMPLES ─────────────────────────────────────────────────
const PRODUCTS = [
  {
    name: 'Crispy Crunch Namkeen',
    category: 'Snack / Food',
    price: 99,
    benefits: [
      'Crunchy in every bite',
      'Made with desi ghee',
      'No palm oil',
      'Festival-ready flavor',
    ],
    target_audience: 'Indian families, 18-50',
    tone: 'funny',
    duration_sec: 30,
  },
  {
    name: 'Lakshmi Gold Earrings',
    category: 'Jewelry',
    price: 4999,
    benefits: [
      'Hallmark 22K gold',
      'Traditional kundan design',
      'Lifetime polish guarantee',
      'Perfect for weddings & festivals',
    ],
    target_audience: 'Women 25-55, gifting + occasion',
    tone: 'emotional',
    duration_sec: 30,
  },
]

// ─── Gemini ──────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt, temperature = 0.85) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const text = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text
  return JSON.parse(text)
}

// ─── TTS chunked ─────────────────────────────────────────────────────────────
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
  return Buffer.from((await res.json()).audioContent, 'base64')
}

async function generateAudio(scenes, audioPath) {
  const pieces = scenes.map((sc, i) => {
    const isLast = i === scenes.length - 1
    const breakTag = isLast ? '' : '<break time="350ms"/>'
    return `<emphasis level="moderate">${sc.tts_text}</emphasis>${breakTag}`
  })
  const chunks = []
  let current = [], currentBytes = 0
  for (const p of pieces) {
    const b = Buffer.byteLength(p + ' ', 'utf-8')
    if (currentBytes + b > 4480 && current.length) {
      chunks.push(current.join(' ')); current = []; currentBytes = 0
    }
    current.push(p); currentBytes += b
  }
  if (current.length) chunks.push(current.join(' '))
  const buffers = []
  for (const c of chunks) buffers.push(await ttsCall(`<speak>${c}</speak>`))
  const buf = Buffer.concat(buffers)
  await bucketRef.file(audioPath).save(buf, { contentType: 'audio/mpeg' })
  return buf.length
}

// ─── Veo ─────────────────────────────────────────────────────────────────────
const VEO_MODEL = 'veo-3.1-lite-generate-001'

async function submitVeo(prompt) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${VEO_MODEL}:predictLongRunning`
  for (let a = 0; a < 3; a++) {
    if (a > 0) await sleep(a * 30_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: '9:16', sampleCount: 1, durationSeconds: 8, resolution: '1080p', personGeneration: 'allow_all', generateAudio: false },
      }),
    })
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Veo ${res.status}: ${await res.text()}`)
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
  if (!res.ok) throw new Error(`Veo poll ${res.status}`)
  const data = await res.json()
  if (!data.done) return { done: false }
  if (data.error) return { done: true, filtered: true, error: data.error.message }
  const b64 = data.response?.videos?.[0]?.bytesBase64Encoded
  if (!b64) return { done: true, filtered: true, error: 'No video' }
  return { done: true, filtered: false, base64: b64 }
}

async function submitAndPoll(prompt) {
  const opId = await submitVeo(prompt)
  for (let i = 0; i < 20; i++) {
    await sleep(60_000)
    const r = await pollVeo(opId)
    if (!r.done) continue
    if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
    return r.base64
  }
  throw new Error('Veo timeout')
}

// ─── Per-product generator ───────────────────────────────────────────────────
async function generateForProduct(product, adminUserId, cat) {
  const slug = product.name.toLowerCase().replace(/\s+/g, '_').slice(0, 25)
  const STORY_ID = `ad_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}_${slug}_${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
  log(`\n━━━━━━ ${product.name} → ${STORY_ID} ━━━━━━`)

  // Topic
  log('Concept...')
  const concept = await callGemini(cat.prompt_topic_picker, `Product details:\n${JSON.stringify(product, null, 2)}\n\nReturn JSON only.`, 0.95)
  log(`  Tagline: ${concept.tagline_hindi}`)
  log(`  Voice: ${concept.voice_personality?.slice(0, 80)}`)

  // Script
  log('Script...')
  const script = await callGemini(cat.prompt_script_writer, `Ad concept input:
${JSON.stringify({
  product_name: product.name, category: product.category, benefits: product.benefits,
  target_audience: product.target_audience, tone: product.tone, duration_sec: product.duration_sec,
  product_anchor_en: concept.product_anchor_en, tagline_hindi: concept.tagline_hindi,
  voice_personality: concept.voice_personality, scenes_count: concept.scenes_count,
}, null, 2)}

Each video_prompt must START with product_anchor_en VERBATIM. Last scene MUST include tagline_hindi verbatim. Return JSON.`, 0.85)
  log(`  Title: ${script.ad_title_hindi}`)
  writeFileSync(join(OUT, `${STORY_ID}-script.json`), JSON.stringify({ product, concept, script }, null, 2))

  // DB
  await sql`
    INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id, channel_id, user_id)
    VALUES (${STORY_ID}, ${`${product.name} — AI Ad`}, ${'ai_ad'}, ${'generating'}, ${`stories/${STORY_ID}/`}, ${'ai_ad_talking_product'}, ${'kissopedia'}, ${adminUserId})
    ON CONFLICT (story_id) DO UPDATE SET status = ${'generating'}
  `
  await sql`
    INSERT INTO pipeline_runs (story_id, status, topic, theme, script_json, user_id, created_at, updated_at)
    VALUES (${STORY_ID}, ${'audio'}, ${`${product.name} — AI Ad`}, ${'ai_ad'}, ${JSON.stringify(script)}, ${adminUserId}, NOW(), NOW())
    ON CONFLICT (story_id) DO UPDATE SET script_json = EXCLUDED.script_json
  `

  // Audio
  log('Audio...')
  await generateAudio(script.scenes, `stories/${STORY_ID}/audio/full_narration.mp3`)

  // Clips (max 2 concurrent)
  log(`Clips (${script.scenes.length})...`)
  let active = 0; const queue = []
  const acquire = () => new Promise(r => { if (active < 2) { active++; r() } else queue.push(() => { active++; r() }) })
  const release = () => { active--; const n = queue.shift(); if (n) n() }

  for (const sc of script.scenes) {
    const sn = String(sc.scene_num).padStart(2, '0')
    await sql`
      INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt, status)
      VALUES (${STORY_ID}, ${sn}, ${sc.beat}, ${sc.video_prompt}, ${sc.tts_text}, ${concept.product_anchor_en}, ${''}, 1, 'pending')
      ON CONFLICT (story_id, scene_num, attempt) DO NOTHING
    `
  }

  const results = await Promise.allSettled(script.scenes.map(async sc => {
    await acquire()
    const sn = String(sc.scene_num).padStart(2, '0')
    const path = `stories/${STORY_ID}/clips/scene_${sn}.mp4`
    try {
      await sql`UPDATE scene_jobs SET status='submitted' WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      const b64 = await submitAndPoll(sc.video_prompt)
      const buf = Buffer.from(b64, 'base64')
      await bucketRef.file(path).save(buf, { contentType: 'video/mp4' })
      await sql`UPDATE scene_jobs SET status='done' WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      log(`  ✓ Scene ${sn}: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
      release(); return { sn, ok: true }
    } catch (e) {
      const isFilter = e.message.startsWith('CONTENT_FILTER:')
      await sql`UPDATE scene_jobs SET status=${isFilter ? 'filtered' : 'failed'}, error_message=${e.message} WHERE story_id=${STORY_ID} AND scene_num=${sn} AND attempt=1`
      log(`  ✗ Scene ${sn}: ${e.message.slice(0, 100)}`)
      release(); return { sn, ok: false }
    }
  }))

  const done = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
  const failed = results.length - done
  await sql`UPDATE stories SET status=${'clips_ready'}, clips_generated_at=NOW(), scenes_count=${done}, notes=${failed > 0 ? `${failed} failed` : ''} WHERE story_id=${STORY_ID}`

  log(`✓ ${product.name}: ${done}/${script.scenes.length} clips`)
  return { storyId: STORY_ID, title: script.ad_title_hindi, tagline: concept.tagline_hindi, done, failed }
}

async function main() {
  const [admin] = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`
  const [cat] = await sql`SELECT * FROM content_categories WHERE id = 'ai_ad_talking_product'`

  const results = []
  for (const product of PRODUCTS) {
    const result = await generateForProduct(product, admin.id, cat)
    results.push(result)
  }

  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log('All 2 sample ads complete')
  results.forEach(r => {
    log(`  ${r.title}`)
    log(`    ${r.done} clips done, ${r.failed} failed`)
    log(`    ${PUBLIC_BASE}/stories/${r.storyId}/clips/scene_01.mp4 (etc.)`)
  })
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
