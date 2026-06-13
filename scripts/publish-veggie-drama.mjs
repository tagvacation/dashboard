/**
 * Upload final merged reel to GCS + publish to YouTube (Kissopedia channel).
 *
 * Usage:
 *   node scripts/publish-veggie-drama.mjs /path/to/final-reel.mp4
 *
 * Optional second arg = channel id (default 'kissopedia')
 */

import { google } from 'googleapis'
import { Storage } from '@google-cloud/storage'
import postgres from 'postgres'
import { readFileSync, statSync, createReadStream } from 'fs'

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

const STORY_ID = 'story_2026_06_06_veggie_test_001'
const VIDEO_PATH = process.argv[2]
const CHANNEL_ID = process.argv[3] || 'kissopedia'

if (!VIDEO_PATH) {
  console.error('Usage: node scripts/publish-veggie-drama.mjs <video-file-path> [channel-id]')
  process.exit(1)
}

if (!statSync(VIDEO_PATH).isFile()) {
  console.error(`File not found: ${VIDEO_PATH}`)
  process.exit(1)
}

const fileSize = statSync(VIDEO_PATH).size
console.log(`Video: ${VIDEO_PATH} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`)
console.log(`Story ID: ${STORY_ID}`)
console.log(`Target channel: ${CHANNEL_ID}`)

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

// ─── DB ───────────────────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  onnotice: () => {},
})

async function getChannel(channelId) {
  const [ch] = await sql`SELECT * FROM channels WHERE id = ${channelId} AND is_active = true`
  if (!ch) throw new Error(`Channel '${channelId}' not found in DB`)
  if (!ch.yt_refresh_token) throw new Error(`Channel '${channelId}' has no refresh token`)
  return ch
}

// ─── GCS ──────────────────────────────────────────────────────────────────────
const gcsCreds = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON)
const storage = new Storage({ credentials: gcsCreds })
const bucket = storage.bucket(process.env.GCS_BUCKET || 'ai_clip_007')
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET || 'ai_clip_007'}`

async function uploadToGCS(localPath, gcsPath) {
  log(`Uploading to GCS: ${gcsPath}`)
  await new Promise((resolve, reject) => {
    createReadStream(localPath)
      .pipe(bucket.file(gcsPath).createWriteStream({ contentType: 'video/mp4', resumable: false }))
      .on('finish', resolve)
      .on('error', reject)
  })
  const url = `${PUBLIC_BASE}/${gcsPath}`
  log(`  ✓ Uploaded: ${url}`)
  return url
}

// ─── YouTube ──────────────────────────────────────────────────────────────────
async function publishToYouTube(channel, videoUrl, title, description, tags) {
  log(`Publishing to YouTube channel: ${channel.name}`)

  const oauth = new google.auth.OAuth2(
    channel.yt_client_id,
    channel.yt_client_secret,
    channel.yt_redirect_uri,
  )
  oauth.setCredentials({ refresh_token: channel.yt_refresh_token })

  const yt = google.youtube({ version: 'v3', auth: oauth })

  // Verify which channel we're authed for
  const me = await yt.channels.list({ mine: true, part: ['snippet'] })
  const authedChannel = me.data.items?.[0]?.snippet?.title
  log(`  OAuth verified — uploading as: ${authedChannel}`)

  // Stream from GCS to YouTube
  const res = await fetch(videoUrl, { headers: { Accept: 'video/mp4' } })
  if (!res.ok || !res.body) throw new Error(`Failed to fetch from GCS: ${res.status}`)

  const { Readable } = await import('stream')
  const readable = Readable.fromWeb(res.body)

  log(`  Streaming ${title.slice(0, 60)}...`)

  const response = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description,
        tags,
        categoryId: '24', // Entertainment (better than 22 "People & Blogs" for this content)
        defaultLanguage: 'hi',
        defaultAudioLanguage: 'hi',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: readable,
    },
  }, {
    timeout: 600_000, // 10 min
  })

  return response.data
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const TITLE = 'अमीर बेटी ने गरीब बैंगन से प्यार किया 💔 पिता ने जो किया वो हैरान कर देगा 😱 | Vegetable Story'

const DESCRIPTION = `एक गरीब किसान बैंगन बाबू और अमीर टमाटर सेठ की बेटी अंगूरी देवी की प्रेम कहानी।
टमाटर सेठ का घमंड टूटा या नहीं? पूरी कहानी देखें।

A class-divide love story told through vegetable characters.

Cast: बैंगन बाबू · अंगूरी देवी · टमाटर सेठ · अदरक बाबा

#VegetableStory #HindiStory #SabziDrama #shorts #AIstory #moralstory #hindiAIstory #hindistorytelling`

const TAGS = ['vegetable story', 'hindi story', 'ai story', 'shorts', 'hindi cartoon', 'moral story', 'vegetable drama', 'sabzi kahani', 'hindi animation', 'ai cartoon hindi']

async function main() {
  // 1. Load channel from DB
  const channel = await getChannel(CHANNEL_ID)
  log(`Channel loaded: ${channel.emoji} ${channel.name}`)

  // 2. Upload to GCS
  const gcsPath = `stories/${STORY_ID}/final/reel.mp4`
  const gcsUrl = await uploadToGCS(VIDEO_PATH, gcsPath)

  // 3. Publish to YouTube
  const ytResponse = await publishToYouTube(channel, gcsUrl, TITLE, DESCRIPTION, TAGS)
  const videoId = ytResponse.id
  const youtubeUrl = `https://youtube.com/shorts/${videoId}`

  // 4. Update story in DB
  await sql`
    UPDATE stories SET
      youtube_link = ${youtubeUrl},
      status = ${'published'},
      channel_id = ${CHANNEL_ID}
    WHERE story_id = ${STORY_ID}
  `

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log(`✅ PUBLISHED to ${channel.name}`)
  log(`Video ID: ${videoId}`)
  log(`URL: ${youtubeUrl}`)
  log(`GCS backup: ${gcsUrl}`)
  log(`Watch in: ~30-60 sec (YouTube processing time)`)

  await sql.end()
}

main().catch(async e => {
  console.error('FATAL:', e?.response?.data || e.message || e)
  await sql.end()
  process.exit(1)
})
