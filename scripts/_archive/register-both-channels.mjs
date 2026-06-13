/**
 * Register both KathaKar + Kissopedia as channels in the dashboard DB.
 * Each gets its own OAuth credentials so we can publish to either.
 *
 * Run from dashboard/: node scripts/register-both-channels.mjs
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'

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

const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  onnotice: () => {},
})

const KATHAKAR = {
  id: 'kathakar',
  name: 'KathaKar',
  emoji: '🪔',
  sheet_id: '11m9qc_j43JtIN1EnRrCw1nK6AZ9y4Snn6DoWWUiNkMw',
  sheet_tab: 'Sheet2',
  gcs_bucket: 'ai_clip_007',
  yt_client_id: process.env.KATHAKAR_YT_CLIENT_ID,
  yt_client_secret: process.env.KATHAKAR_YT_CLIENT_SECRET,
  yt_refresh_token: process.env.KATHAKAR_YT_REFRESH_TOKEN,
  yt_redirect_uri: 'https://9fef-119-82-120-35.ngrok-free.app/api/auth/youtube/callback',
}

const KISSOPEDIA = {
  id: 'kissopedia',
  name: 'Kissopedia',
  emoji: '📚',
  sheet_id: '11m9qc_j43JtIN1EnRrCw1nK6AZ9y4Snn6DoWWUiNkMw', // same sheet for now, can split later
  sheet_tab: 'Sheet2',
  gcs_bucket: 'ai_clip_007',
  yt_client_id: process.env.KISSOPEDIA_YT_CLIENT_ID,
  yt_client_secret: process.env.KISSOPEDIA_YT_CLIENT_SECRET,
  yt_refresh_token: process.env.KISSOPEDIA_YT_REFRESH_TOKEN,
  yt_redirect_uri: 'https://9fef-119-82-120-35.ngrok-free.app/api/auth/youtube/callback',
}

async function upsertChannel(ch) {
  await sql`
    INSERT INTO channels (
      id, name, emoji, sheet_id, sheet_tab, gcs_bucket,
      yt_client_id, yt_client_secret, yt_refresh_token, yt_redirect_uri, is_active
    ) VALUES (
      ${ch.id}, ${ch.name}, ${ch.emoji}, ${ch.sheet_id}, ${ch.sheet_tab}, ${ch.gcs_bucket},
      ${ch.yt_client_id}, ${ch.yt_client_secret}, ${ch.yt_refresh_token}, ${ch.yt_redirect_uri}, true
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      emoji = EXCLUDED.emoji,
      sheet_id = EXCLUDED.sheet_id,
      sheet_tab = EXCLUDED.sheet_tab,
      gcs_bucket = EXCLUDED.gcs_bucket,
      yt_client_id = EXCLUDED.yt_client_id,
      yt_client_secret = EXCLUDED.yt_client_secret,
      yt_refresh_token = EXCLUDED.yt_refresh_token,
      yt_redirect_uri = EXCLUDED.yt_redirect_uri,
      is_active = true
  `
  console.log(`✓ ${ch.emoji} ${ch.name} (${ch.id})`)
}

async function main() {
  console.log('Registering channels in dashboard DB...\n')
  await upsertChannel(KATHAKAR)
  await upsertChannel(KISSOPEDIA)

  // Verify
  const rows = await sql`SELECT id, name, emoji, yt_refresh_token IS NOT NULL as has_token FROM channels WHERE is_active = true ORDER BY created_at`
  console.log('\n=== Active channels ===')
  rows.forEach(r => {
    console.log(`  ${r.emoji} ${r.name} (${r.id}) — yt: ${r.has_token ? '✓' : '✗'}`)
  })

  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
