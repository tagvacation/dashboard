/**
 * End-to-end test: take the pre-generated veggie drama script and run it
 * through TTS + Veo + GCS, also register the new category in the dashboard DB.
 *
 * Run from dashboard/: node scripts/veggie-drama-generate.mjs
 */

import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import postgres from 'postgres'
import { readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ─── Env ──────────────────────────────────────────────────────────────────────
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

const STORY_ID = 'story_2026_06_06_veggie_test_001'
const CATEGORY_ID = 'veggie_drama'

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

async function uploadBuffer(path, buf, mimeType) {
  await bucketRef.file(path).save(buf, { contentType: mimeType })
  return `${PUBLIC_BASE}/${path}`
}

async function gcsExists(path) {
  const [exists] = await bucketRef.file(path).exists()
  return exists
}

// ─── DB ───────────────────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  onnotice: () => {},
})

// Prompt pack — written as constants here, also stored in DB for future runs
const VEGGIE_TOPIC_PICKER_PROMPT = readFileSync('../prompts/veggie-drama-pack.md', 'utf-8')
  .split('## Gemini system prompt — TOPIC PICKER')[1]
  .split('```text')[1]
  .split('```')[0]
  .trim()

const VEGGIE_SCRIPT_WRITER_PROMPT = readFileSync('../prompts/veggie-drama-pack.md', 'utf-8')
  .split('## Gemini system prompt — SCRIPT WRITER')[1]
  .split('```text')[1]
  .split('```')[0]
  .trim()

const VEGGIE_STYLE_SUFFIX = 'Pixar-inspired stylized 3D cartoon animation, warm cinematic Indian village lighting, vibrant saturated colors, soft rounded character design, expressive cartoon faces with large eyes and big emotions, magical-realism Indian melodrama aesthetic, no character voices or dialogue audio, ambient environmental sounds only (village sounds, market crowd, wind, soft music).'

async function registerCategory() {
  log(`Registering category '${CATEGORY_ID}' in dashboard DB...`)
  await sql`
    INSERT INTO content_categories (
      id, name, emoji, description, perspective,
      prompt_topic_picker, prompt_script_writer, veo_style_suffix,
      scene_count_min, scene_count_max, is_active, is_default
    ) VALUES (
      ${CATEGORY_ID},
      ${'Veggie Drama'},
      ${'🍆'},
      ${'Hindi micro-drama tropes with vegetable/fruit characters. Based on Ai pixeltales viral formula (5M views Jun 2026).'},
      ${'third_person'},
      ${VEGGIE_TOPIC_PICKER_PROMPT},
      ${VEGGIE_SCRIPT_WRITER_PROMPT},
      ${VEGGIE_STYLE_SUFFIX},
      ${12},
      ${15},
      ${true},
      ${false}
    )
    ON CONFLICT (id) DO UPDATE SET
      prompt_topic_picker = EXCLUDED.prompt_topic_picker,
      prompt_script_writer = EXCLUDED.prompt_script_writer,
      veo_style_suffix = EXCLUDED.veo_style_suffix,
      scene_count_min = EXCLUDED.scene_count_min,
      scene_count_max = EXCLUDED.scene_count_max,
      description = EXCLUDED.description
  `
  log(`  ✓ Category '${CATEGORY_ID}' registered`)
}

async function createStoryRecords(script) {
  const topic = "एक गरीब किसान बैंगन बाबू और अमीर टमाटर सेठ की बेटी अंगूरी देवी का प्यार, जिसे टमाटर सेठ का घमंड तोड़ने की कोशिश करता है, पर सच्चा प्यार और मेहनत रंग लाती है।"
  const theme = "veggie_class_divide_love"

  log(`Creating story record for ${STORY_ID}...`)
  await sql`
    INSERT INTO stories (story_id, topic, theme, status, storage_path, category_id)
    VALUES (${STORY_ID}, ${topic}, ${theme}, ${'generating'}, ${`stories/${STORY_ID}/`}, ${CATEGORY_ID})
    ON CONFLICT (story_id) DO UPDATE SET
      topic = EXCLUDED.topic, theme = EXCLUDED.theme,
      status = ${'generating'}, category_id = EXCLUDED.category_id
  `

  await sql`
    INSERT INTO pipeline_runs (story_id, status, topic, theme, script_json, created_at, updated_at)
    VALUES (${STORY_ID}, ${'audio'}, ${topic}, ${theme}, ${JSON.stringify(script)}, NOW(), NOW())
    ON CONFLICT (story_id) DO UPDATE SET
      script_json = EXCLUDED.script_json,
      topic = EXCLUDED.topic, theme = EXCLUDED.theme,
      status = ${'audio'}, updated_at = NOW()
  `
  log(`  ✓ Story + pipeline_run created`)
}

// ─── TTS ──────────────────────────────────────────────────────────────────────
async function generateAudio(script) {
  const audioPath = `stories/${STORY_ID}/audio/full_narration.mp3`
  if (await gcsExists(audioPath)) {
    log(`Audio already exists, skipping TTS`)
    return `${PUBLIC_BASE}/${audioPath}`
  }

  log(`Generating Hindi narration via Cloud TTS Chirp3-HD-Algenib...`)

  const parts = script.scenes.map((scene, i) => {
    const isLast = i === script.scenes.length - 1
    const isTwist = scene.beat === 'reversal' || scene.beat === 'payoff'
    const isHook = i === 0
    const breakTag = isLast ? '' : isTwist ? '<break time="900ms"/>' : isHook ? '<break time="500ms"/>' : '<break time="400ms"/>'
    const text = isTwist ? `<emphasis level="strong">${scene.tts_text}</emphasis>` : scene.tts_text
    return text + breakTag
  }).join(' ')

  const ssml = `<speak>${parts}</speak>`
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

  if (!res.ok) throw new Error(`TTS error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const buf = Buffer.from(data.audioContent, 'base64')

  const url = await uploadBuffer(audioPath, buf, 'audio/mpeg')
  log(`  ✓ Audio uploaded: ${url} (${(buf.length / 1024).toFixed(0)} KB)`)

  await sql`UPDATE stories SET audio_url = ${url} WHERE story_id = ${STORY_ID}`
  return url
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
        parameters: {
          aspectRatio: '9:16',
          sampleCount: 1,
          durationSeconds: 8,
          resolution: '1080p',
          personGeneration: 'allow_all',
          generateAudio: false,
        },
      }),
    })
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Veo submit ${res.status}: ${await res.text()}`)
    const data = await res.json()
    if (!data.name) throw new Error('No operation name returned')
    return data.name
  }
  throw new Error('Veo submit: quota exceeded after retries')
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
  const base64 = data.response?.videos?.[0]?.bytesBase64Encoded
  if (!base64) return { done: true, filtered: true, error: 'No video in response' }
  return { done: true, filtered: false, base64 }
}

async function submitAndPoll(prompt, sceneNum) {
  const opId = await submitVeo(prompt)
  log(`  Scene ${sceneNum}: submitted, opId=${opId.split('/').pop().slice(0, 20)}...`)
  for (let i = 0; i < 20; i++) {
    await sleep(60_000)
    const r = await pollVeo(opId)
    if (!r.done) continue
    if (r.filtered) throw new Error(`CONTENT_FILTER: ${r.error}`)
    return r.base64
  }
  throw new Error('Veo poll timeout')
}

// ─── Process scenes ───────────────────────────────────────────────────────────
async function processAllScenes(script) {
  const MAX_CONCURRENT = 2
  let active = 0
  const queue = []
  const acquire = () => new Promise(resolve => {
    if (active < MAX_CONCURRENT) { active++; resolve() } else queue.push(() => { active++; resolve() })
  })
  const release = () => { active--; const n = queue.shift(); if (n) n() }

  log(`Submitting ${script.scenes.length} scenes to Veo (max ${MAX_CONCURRENT} concurrent)...`)

  // Track scene_jobs in DB
  for (const scene of script.scenes) {
    const sceneNum = String(scene.scene_num).padStart(2, '0')
    const charsInScene = scene.characters_in_scene || []
    const primaryAnchor = script.characters.find(c => c.name === charsInScene[0])?.anchor_description_en || ''
    const secondaryAnchor = script.characters.find(c => c.name === charsInScene[1])?.anchor_description_en || ''
    await sql`
      INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt, status)
      VALUES (${STORY_ID}, ${sceneNum}, ${scene.beat}, ${scene.video_prompt}, ${scene.tts_text}, ${primaryAnchor}, ${secondaryAnchor}, 1, 'pending')
      ON CONFLICT (story_id, scene_num, attempt) DO UPDATE SET
        video_prompt = EXCLUDED.video_prompt, status = 'pending'
    `
  }

  const results = await Promise.allSettled(
    script.scenes.map(async (scene) => {
      await acquire()
      const sceneNum = String(scene.scene_num).padStart(2, '0')
      const clipPath = `stories/${STORY_ID}/clips/scene_${sceneNum}.mp4`

      try {
        if (await gcsExists(clipPath)) {
          log(`  Scene ${sceneNum}: already in GCS, skipping`)
          release()
          return { sceneNum, status: 'cached' }
        }

        await sql`UPDATE scene_jobs SET status = 'submitted' WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1`

        const base64 = await submitAndPoll(scene.video_prompt, sceneNum)
        const buf = Buffer.from(base64, 'base64')
        await uploadBuffer(clipPath, buf, 'video/mp4')

        await sql`UPDATE scene_jobs SET status = 'done' WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1`
        log(`  ✓ Scene ${sceneNum}: ${(buf.length / 1024 / 1024).toFixed(1)} MB uploaded`)
        release()
        return { sceneNum, status: 'done' }
      } catch (e) {
        const isFilter = e.message.startsWith('CONTENT_FILTER:')
        await sql`
          UPDATE scene_jobs SET status = ${isFilter ? 'filtered' : 'failed'},
            error_message = ${e.message}
          WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 1
        `
        log(`  ✗ Scene ${sceneNum}: ${e.message.slice(0, 100)}`)
        release()
        return { sceneNum, status: 'failed', error: e.message }
      }
    })
  )

  const completed = results.filter(r => r.status === 'fulfilled' && r.value.status !== 'failed')
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'failed')
  log(`Scenes complete: ${completed.length} done, ${failed.length} failed`)
  return { completed: completed.length, failed: failed.length, results }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const scriptPath = join('..', 'audit-output', new Date().toISOString().split('T')[0], 'veggie-script-test.json')
  const script = JSON.parse(readFileSync(scriptPath, 'utf-8'))

  // Override the auto-generated title with our punchier one
  script.title_hindi = 'अमीर बेटी ने गरीब बैंगन से प्यार किया 💔 पिता ने जो किया वो हैरान कर देगा 😱 | Vegetable Story'

  log(`Story: "${script.title_hindi}"`)
  log(`Scenes: ${script.scenes.length} | Characters: ${script.characters.length}`)

  await registerCategory()
  await createStoryRecords(script)
  await generateAudio(script)
  const result = await processAllScenes(script)

  // Update story status
  const finalStatus = result.failed === 0 ? 'clips_ready' : (result.completed > 0 ? 'clips_ready' : 'failed')
  await sql`
    UPDATE stories SET
      status = ${finalStatus},
      clips_generated_at = NOW(),
      scenes_count = ${result.completed},
      notes = ${result.failed > 0 ? `${result.failed} scene(s) failed` : ''}
    WHERE story_id = ${STORY_ID}
  `
  await sql`
    UPDATE pipeline_runs SET status = ${finalStatus === 'clips_ready' ? 'complete' : 'failed'},
      updated_at = NOW()
    WHERE story_id = ${STORY_ID}
  `

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`DONE — Story: ${STORY_ID}`)
  log(`Status: ${finalStatus}`)
  log(`Audio: ${PUBLIC_BASE}/stories/${STORY_ID}/audio/full_narration.mp3`)
  log(`Clips: ${PUBLIC_BASE}/stories/${STORY_ID}/clips/scene_NN.mp4 (NN = 01..15)`)
  log(`Dashboard: visit /story/${STORY_ID} to download and merge`)

  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
