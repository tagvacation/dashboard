/**
 * Generate Kissopedia YouTube profile pic + banner via Imagen 3 (Vertex AI).
 *
 * Outputs:
 *   ../audit-output/kissopedia-profile.png  (1:1, ~1024px — YouTube needs 800x800 min)
 *   ../audit-output/kissopedia-banner.png   (16:9, ~1920x1080 — YouTube banner needs 2048x1152)
 *
 * Run from dashboard/: node scripts/generate-kissopedia-art.mjs
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

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

const OUT = join('..', 'audit-output')
mkdirSync(OUT, { recursive: true })

async function getToken() {
  const client = await auth.getClient()
  const t = await client.getAccessToken()
  return t.token
}

async function imagenGenerate({ prompt, aspectRatio, model = 'imagen-3.0-generate-002', count = 1 }) {
  const token = await getToken()
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:predict`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: count,
        aspectRatio,
        safetyFilterLevel: 'block_only_high',
        personGeneration: 'allow_adult',
        addWatermark: false,
      },
    }),
  })

  if (!res.ok) throw new Error(`Imagen ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const predictions = data.predictions || []
  if (!predictions.length) throw new Error('No predictions in response')
  return predictions.map(p => Buffer.from(p.bytesBase64Encoded, 'base64'))
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

// ─── Prompts ─────────────────────────────────────────────────────────────────
const PROFILE_PROMPT = `A vibrant modern logo mark for a Hindi AI storytelling YouTube channel called Kissopedia. A glowing magical open book floating in the center, golden warm light radiating from its pages, tiny sparkling stars and magical particles swirling around it. Deep purple-to-magenta gradient background. 3D rendered, premium animation studio quality, vibrant saturated colors, high contrast, soft warm cinematic lighting, clean centered composition with breathing room around the book, suitable for circular profile picture. No text, no letters, no words. Polished commercial illustration style.`

const BANNER_PROMPT = `Wide cinematic horizontal banner for a Hindi AI storytelling YouTube channel. A magical universe scene at golden dusk: a giant glowing magical book at center-left of the frame emits warm golden light beams across the scene. Floating around the book are stylized cute cartoon characters - a smiling round purple brinjal in a kurta, a bright red tomato character, a cluster of green grapes, a wise old ginger character with white beard. Behind them, silhouettes of traditional Indian village rooftops and a distant palace, twinkling stars in a deep purple-to-magenta sky. The right two-thirds of the banner has a softer dreamy gradient sky with lots of negative space for channel branding text overlay. Premium 3D animation movie quality, warm cinematic lighting, vibrant saturated storybook colors, high detail. No text, no letters, no logos, no words in the image. Wide aspect ratio composition.`

async function main() {
  log('Generating Kissopedia profile picture (1:1)...')
  try {
    const [profileBuf] = await imagenGenerate({ prompt: PROFILE_PROMPT, aspectRatio: '1:1' })
    const profilePath = join(OUT, 'kissopedia-profile.png')
    writeFileSync(profilePath, profileBuf)
    log(`  ✓ Saved: ${profilePath} (${(profileBuf.length / 1024).toFixed(0)} KB)`)
  } catch (e) {
    log(`  ✗ Profile failed: ${e.message}`)
  }

  log('Generating Kissopedia banner (16:9)...')
  try {
    const [bannerBuf] = await imagenGenerate({ prompt: BANNER_PROMPT, aspectRatio: '16:9' })
    const bannerPath = join(OUT, 'kissopedia-banner.png')
    writeFileSync(bannerPath, bannerBuf)
    log(`  ✓ Saved: ${bannerPath} (${(bannerBuf.length / 1024).toFixed(0)} KB)`)
  } catch (e) {
    log(`  ✗ Banner failed: ${e.message}`)
  }

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log('Open in Finder to preview:')
  log(`  open ${OUT}/kissopedia-profile.png`)
  log(`  open ${OUT}/kissopedia-banner.png`)
  log('')
  log('Upload to YouTube Studio:')
  log('  Profile: youtube.com → Studio → Customization → Branding → Picture (800x800+)')
  log('  Banner: same page → Banner image (2048x1152+)')
  log('')
  log('Note: YouTube will auto-crop banner. The "safe area" visible on all devices is the center 1546x423.')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
