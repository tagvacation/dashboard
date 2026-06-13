/**
 * Retry the 4 content-filtered scenes (03, 07, 08, 09) using Gemini rewrite.
 * Pattern mirrors lib/pipeline/gemini.ts rewriteFilteredPrompt — only the
 * ACTION gets rewritten; character anchor + style suffix stay verbatim.
 *
 * Run from dashboard/: node scripts/veggie-drama-retry-filtered.mjs
 */

import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import postgres from 'postgres'
import { readFileSync } from 'fs'
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

const STORY_ID = 'story_2026_06_06_veggie_test_001'
const FAILED_SCENES = [8, 9]

const STYLE_SUFFIX = 'Pixar-inspired stylized 3D cartoon animation, warm cinematic Indian village lighting, vibrant saturated colors, soft rounded character design, expressive cartoon faces with large eyes and big emotions, magical-realism Indian melodrama aesthetic, no character voices or dialogue audio, ambient environmental sounds only (village sounds, market crowd, wind, soft music).'

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

const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  onnotice: () => {},
})

// ─── Gemini rewrite (stricter banlist than original pack) ────────────────────
async function rewriteAction(scene, characters, topic) {
  // Strip anchors + style from original to get action-only
  let actionPart = scene.video_prompt
  for (const c of characters) {
    if (actionPart.includes(c.anchor_description_en)) {
      actionPart = actionPart.split(c.anchor_description_en).join('').trim()
    }
  }
  // Strip "Wide two-shot framing." and "Wide group framing." filler
  actionPart = actionPart.replace(/Wide (two-shot|group) framing\./g, '').trim()
  // Strip style suffix
  const styleIdx = actionPart.indexOf('Pixar-inspired')
  if (styleIdx !== -1) actionPart = actionPart.slice(0, styleIdx).trim()

  const system = `You rewrite a REJECTED Veo animation action description for a Hindi micro-drama with vegetable/fruit characters.

Return ONLY 1-3 sentences describing a SAFE, PEACEFUL alternative action. NO character descriptions. NO style words.

STRICT BANNED words (cause Veo content filter rejection):
- sobbing, weeping, wailing, crying, tears streaming, hysterical
- despairing, devastated, broken, shattered
- innocence (especially paired with female characters)
- physical touch verbs: places hand on, embraces, hugs, touches, grabs, holds
- hit, beat, strike, attack, push, throw at
- young girl, child, minor (even when describing fruit/vegetable characters)

SAFE alternatives to use instead:
- Sadness: "head bowed, single tear glistening on the cheek, gazing into the distance"
- Loneliness: "sits quietly under a tree at dusk, looking at the empty horizon, hands clasped in lap"
- Wise counsel: "the wise elder gestures toward the horizon, pointing the way forward, while [character] listens intently with hands folded"
- Pining: "stands in a sunlit courtyard, gazing toward distant fields, a wistful smile playing on the lips"
- Anger/gloating: "stands tall with arms crossed, a self-satisfied half-smile, surveying the room"
- Distress: "leans against a wall, eyes closed, taking a deep breath, hand on heart"

Keep it story-relevant. Stay in Indian village/period setting. NO Western settings. Vegetables/fruits should behave like cartoon characters with stylized stubby arms/legs.`

  const user = `Story context: ${topic}

Scene ${scene.scene_num} — beat: ${scene.beat}
Characters in scene: ${scene.characters_in_scene.join(', ')}
Narrator line (Hindi): "${scene.tts_text}"

Original REJECTED action description:
${actionPart}

Rewrite the action: peaceful, story-relevant, 1-3 sentences. No character descriptions, no style words.`

  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini rewrite error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const newAction = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!newAction) throw new Error('Empty rewrite')
  return newAction
}

// ─── Reconstruct prompt programmatically ─────────────────────────────────────
function reconstructPrompt(scene, characters, newAction) {
  const charsInScene = scene.characters_in_scene || []
  const anchors = charsInScene
    .map(name => characters.find(c => c.name === name)?.anchor_description_en)
    .filter(Boolean)

  let prefix = anchors[0] || ''
  if (anchors.length === 2) prefix += ` Wide two-shot framing. ${anchors[1]}`
  else if (anchors.length > 2) {
    prefix += ' Wide group framing. ' + anchors.slice(1).join(' ')
  }

  return `${prefix} ${newAction} ${STYLE_SUFFIX} Vertical 9:16, no text or captions in frame, no logos or brand marks.`
}

// ─── Veo ──────────────────────────────────────────────────────────────────────
const VEO_MODEL = 'veo-3.1-lite-generate-001'

async function submitVeo(prompt) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${VEO_MODEL}:predictLongRunning`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: '9:16', sampleCount: 1, durationSeconds: 8, resolution: '1080p', personGeneration: 'allow_all', generateAudio: false },
    }),
  })
  if (!res.ok) throw new Error(`Veo submit ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.name) throw new Error('No operation name')
  return data.name
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
  log(`  Scene ${sceneNum} (attempt 2): submitted`)
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
  const scriptPath = join('..', 'audit-output', '2026-06-06', 'veggie-script-test.json')
  const script = JSON.parse(readFileSync(scriptPath, 'utf-8'))
  const topic = "एक गरीब किसान बैंगन बाबू और अमीर टमाटर सेठ की बेटी अंगूरी देवी का प्यार"

  log(`Retrying ${FAILED_SCENES.length} filtered scenes for ${STORY_ID}...`)

  // Process all in parallel with semaphore (max 2)
  let active = 0
  const queue = []
  const acquire = () => new Promise(resolve => {
    if (active < 2) { active++; resolve() } else queue.push(() => { active++; resolve() })
  })
  const release = () => { active--; const n = queue.shift(); if (n) n() }

  const results = await Promise.allSettled(
    FAILED_SCENES.map(async (sceneNumInt) => {
      await acquire()
      const sceneNum = String(sceneNumInt).padStart(2, '0')
      const scene = script.scenes.find(s => s.scene_num === sceneNumInt)
      const clipPath = `stories/${STORY_ID}/clips/scene_${sceneNum}.mp4`

      try {
        // Generate new action via Gemini
        const newAction = await rewriteAction(scene, script.characters, topic)
        const newPrompt = reconstructPrompt(scene, script.characters, newAction)
        log(`  Scene ${sceneNum}: new action: ${newAction.slice(0, 120)}${newAction.length > 120 ? '...' : ''}`)

        // Insert attempt 2 row in scene_jobs
        const charsInScene = scene.characters_in_scene || []
        const primary = script.characters.find(c => c.name === charsInScene[0])?.anchor_description_en || ''
        const secondary = script.characters.find(c => c.name === charsInScene[1])?.anchor_description_en || ''
        await sql`
          INSERT INTO scene_jobs (story_id, scene_num, beat, video_prompt, tts_text, primary_anchor, secondary_anchor, attempt, status)
          VALUES (${STORY_ID}, ${sceneNum}, ${scene.beat}, ${newPrompt}, ${scene.tts_text}, ${primary}, ${secondary}, 2, ${'submitted'})
          ON CONFLICT (story_id, scene_num, attempt) DO UPDATE SET video_prompt = EXCLUDED.video_prompt, status = ${'submitted'}
        `

        // Submit + poll
        const base64 = await submitAndPoll(newPrompt, sceneNum)
        const buf = Buffer.from(base64, 'base64')
        await bucketRef.file(clipPath).save(buf, { contentType: 'video/mp4' })

        await sql`UPDATE scene_jobs SET status = ${'done'} WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 2`
        log(`  ✓ Scene ${sceneNum}: ${(buf.length / 1024 / 1024).toFixed(1)} MB uploaded`)
        release()
        return { sceneNum, status: 'done' }
      } catch (e) {
        const isFilter = e.message.startsWith('CONTENT_FILTER:')
        await sql`UPDATE scene_jobs SET status = ${isFilter ? 'filtered' : 'failed'}, error_message = ${e.message} WHERE story_id = ${STORY_ID} AND scene_num = ${sceneNum} AND attempt = 2`
        log(`  ✗ Scene ${sceneNum} retry: ${e.message.slice(0, 150)}`)
        release()
        return { sceneNum, status: 'failed', error: e.message }
      }
    })
  )

  const done = results.filter(r => r.status === 'fulfilled' && r.value.status === 'done').map(r => r.value.sceneNum)
  const stillFailing = results.filter(r => r.status === 'fulfilled' && r.value.status === 'failed').map(r => r.value.sceneNum)

  // Update story
  const totalDone = await sql`SELECT COUNT(*) as count FROM scene_jobs WHERE story_id = ${STORY_ID} AND status = 'done'`
  const doneCount = parseInt(totalDone[0].count)
  await sql`
    UPDATE stories SET scenes_count = ${doneCount},
      notes = ${stillFailing.length > 0 ? `${stillFailing.join(',')} still filtered after retry` : ''}
    WHERE story_id = ${STORY_ID}
  `

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`Retry done: ${done.length}/${FAILED_SCENES.length} recovered`)
  if (done.length) log(`  Recovered: ${done.join(', ')}`)
  if (stillFailing.length) log(`  Still failing: ${stillFailing.join(', ')}`)
  log(`Total clips in GCS: ${doneCount}/15`)
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
