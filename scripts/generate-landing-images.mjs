/**
 * Generate beautiful AI hero images for the landing page via Imagen 3.
 * Stores them to GCS for the website to use.
 *
 * Run from dashboard/: node scripts/generate-landing-images.mjs
 */

import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import { readFileSync } from 'fs'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    process.env[key] = val
  }
}
loadEnv('.env')

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON)
const projectId = process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603'
const region = 'us-central1'
const bucket = process.env.GCS_BUCKET || 'ai_clip_007'

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})
const storage = new Storage({ credentials })
const bucketRef = storage.bucket(bucket)
const PUBLIC_BASE = `https://storage.googleapis.com/${bucket}`

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

async function getToken() {
  const c = await auth.getClient()
  const t = await c.getAccessToken()
  return t.token
}

async function imagenGenerate({ prompt, aspectRatio, model = 'imagen-3.0-generate-002' }) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:predict`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        safetyFilterLevel: 'block_only_high',
        personGeneration: 'allow_adult',
        addWatermark: false,
      },
    }),
  })
  if (!res.ok) throw new Error(`Imagen ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('No image in response')
  return Buffer.from(b64, 'base64')
}

// ─── Image specs ─────────────────────────────────────────────────────────────
const IMAGES = [
  {
    name: 'landing/hero.png',
    aspectRatio: '16:9',
    prompt: `A stunning hero image for an AI video generation SaaS platform website.
Composition: A vibrant scene showing multiple stylized 3D cartoon characters floating in mid-air —
a smiling brinjal character in a kurta, a red tomato character, a glowing magical book,
a stylized shampoo bottle character with eyes and smile, all radiating warm magical light.
Background: dreamy purple-to-pink gradient sky with subtle stars and floating geometric shapes,
soft glowing particles. The mood: magical, premium, modern AI aesthetic. Centered composition
with breathing room. Cinema-quality 3D animation style, vibrant saturated colors, smooth
rendered surfaces, premium commercial advertising quality. Aspect 16:9 widescreen.
No text, no letters, no logos.`,
  },
  {
    name: 'landing/feature-templates.png',
    aspectRatio: '1:1',
    prompt: `Beautiful square illustration: a magical translucent grid of floating template cards,
each showing a different AI video character — vegetables, a wise old grandpa, a glowing product
bottle, a Hindi storyteller. Cards radiate soft purple-pink light. Dark elegant background.
Premium SaaS marketing illustration. 3D rendered, vibrant, cinematic. No text or letters.`,
  },
  {
    name: 'landing/feature-pipeline.png',
    aspectRatio: '1:1',
    prompt: `Beautiful square illustration: floating 3D blocks showing the AI video pipeline —
a microphone (audio), a film clapper (script), a film strip (clips), all connected by glowing
purple-pink energy beams in a flowing arc. Modern AI tech aesthetic, dark elegant background
with subtle stars. Premium SaaS marketing visual. No text or letters.`,
  },
  {
    name: 'landing/feature-publish.png',
    aspectRatio: '1:1',
    prompt: `Beautiful square illustration: a glowing smartphone showing a vertical 9:16 Hindi video
playing, surrounded by floating social media icons (YouTube, Instagram). Warm purple-pink glow,
modern minimal design, premium SaaS aesthetic. Dark elegant background. No text or letters.`,
  },
]

async function main() {
  log(`Generating ${IMAGES.length} landing page images...`)

  const results = []
  for (const img of IMAGES) {
    try {
      log(`  → ${img.name} (${img.aspectRatio})...`)
      const buf = await imagenGenerate({ prompt: img.prompt, aspectRatio: img.aspectRatio })
      await bucketRef.file(img.name).save(buf, {
        contentType: 'image/png',
        resumable: false,
        metadata: { cacheControl: 'public, max-age=86400' },
      })
      const url = `${PUBLIC_BASE}/${img.name}`
      log(`    ✓ ${(buf.length / 1024).toFixed(0)} KB → ${url}`)
      results.push({ name: img.name, url, size: buf.length })
    } catch (e) {
      log(`    ✗ ${e.message}`)
      results.push({ name: img.name, error: e.message })
    }
  }

  log('\nDone. Image URLs:')
  results.forEach(r => log(`  ${r.url || r.error}`))
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
