/**
 * Resume veggie-v2 generation — script already saved, just do audio (chunked) + clips.
 *
 * Run from dashboard/: node scripts/resume-veggie-v2.mjs
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

const STORY_ID = 'story_2026_06_07_veggie_v2_762'
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

// ─── Chunked TTS ──────────────────────────────────────────────────────────────
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

async function generateAudioChunked(scenes) {
  // Build SSML pieces per scene
  const pieces = scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1
    const isTwist = scene.beat === 'reversal' || scene.beat === 'payoff'
    const isHook = i === 0
    const breakTag = isLast ? '' : isTwist ? '<break time="900ms"/>' : isHook ? '<break time="500ms"/>' : '<break time="400ms"/>'
    const text = isTwist ? `<emphasis level="strong">${scene.tts_text}</emphasis>` : scene.tts_text
    return text + breakTag
  })

  // Greedy bin-pack into <4500 byte chunks
  const chunks = []
  let current = []
  let currentBytes = 0
  const HEADER_BYTES = 20 // <speak></speak> overhead
  const LIMIT = 4500 - HEADER_BYTES

  for (const piece of pieces) {
    const pieceBytes = Buffer.byteLength(piece + ' ', 'utf-8')
    if (currentBytes + pieceBytes > LIMIT && current.length > 0) {
      chunks.push(current.join(' '))
      current = []
      currentBytes = 0
    }
    current.push(piece)
    currentBytes += pieceBytes
  }
  if (current.length) chunks.push(current.join(' '))

  log(`Audio split into ${chunks.length} chunks (limit 4500 bytes each)`)

  // Synthesize each chunk
  const buffers = []
  for (let i = 0; i < chunks.length; i++) {
    const ssml = `<speak>${chunks[i]}</speak>`
    const bytes = Buffer.byteLength(ssml, 'utf-8')
    log(`  Chunk ${i + 1}/${chunks.length}: ${bytes} bytes`)
    const buf = await ttsCall(ssml)
    buffers.push(buf)
  }

  // Concat MP3 buffers
  return Buffer.concat(buffers)
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
  const script = JSON.parse(readFileSync(join('..', 'audit-output', '2026-06-07', 'veggie-v2-script.json'), 'utf-8'))
  log(`Resuming ${STORY_ID}`)
  log(`Title: ${script.title_hindi}`)
  log(`${script.scenes.length} scenes`)

  // 1. Audio (chunked)
  const audioPath = `stories/${STORY_ID}/audio/full_narration.mp3`
  const [audioExists] = await bucketRef.file(audioPath).exists()
  if (!audioExists) {
    log('Generating audio (chunked)...')
    const buf = await generateAudioChunked(script.scenes)
    await bucketRef.file(audioPath).save(buf, { contentType: 'audio/mpeg' })
    log(`  ✓ Audio uploaded: ${(buf.length / 1024).toFixed(0)} KB`)
    await sql`UPDATE stories SET audio_url = ${PUBLIC_BASE + '/' + audioPath} WHERE story_id = ${STORY_ID}`
  } else {
    log('Audio already exists, skipping')
  }

  // 2. Clips (skip already done)
  const existing = await sql`SELECT scene_num FROM scene_jobs WHERE story_id = ${STORY_ID} AND status = 'done'`
  const doneSet = new Set(existing.map(r => r.scene_num))
  const todo = script.scenes.filter(s => !doneSet.has(String(s.scene_num).padStart(2, '0')))
  log(`Need to generate ${todo.length}/${script.scenes.length} clips (${doneSet.size} already done)`)

  if (todo.length > 0) {
    const MAX_CONCURRENT = 2
    let active = 0
    const queue = []
    const acquire = () => new Promise(resolve => {
      if (active < MAX_CONCURRENT) { active++; resolve() } else queue.push(() => { active++; resolve() })
    })
    const release = () => { active--; const n = queue.shift(); if (n) n() }

    for (const scene of todo) {
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
      todo.map(async (scene) => {
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
    log(`Done: ${done}/${todo.length} | Failed: ${failed}`)
  }

  const totalDone = (await sql`SELECT COUNT(*) as c FROM scene_jobs WHERE story_id = ${STORY_ID} AND status = 'done'`)[0].c
  await sql`UPDATE stories SET status = ${'clips_ready'}, clips_generated_at = NOW(), scenes_count = ${parseInt(totalDone)} WHERE story_id = ${STORY_ID}`

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`DONE — ${totalDone}/${script.scenes.length} clips in GCS`)
  log(`Story: ${STORY_ID}`)
  log(`Audio: ${PUBLIC_BASE}/stories/${STORY_ID}/audio/full_narration.mp3`)
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
