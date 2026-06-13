/**
 * Add performance indexes to speed up common queries.
 * Idempotent — safe to re-run.
 */
import postgres from 'postgres'
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

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

async function main() {
  console.log('Adding performance indexes...\n')

  // Composite index for the common "stories by user filtered by channel" query
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user_channel ON stories (user_id, channel_id, created_at DESC)`
  console.log('  ✓ idx_stories_user_channel')

  // Status filter (used in story list "needs action" sort)
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user_status ON stories (user_id, status, created_at DESC)`
  console.log('  ✓ idx_stories_user_status')

  // scene_jobs by story for the fast clip lookup
  await sql`CREATE INDEX IF NOT EXISTS idx_scene_jobs_story_status ON scene_jobs (story_id, status)`
  console.log('  ✓ idx_scene_jobs_story_status')

  // pipeline_runs by user for activity feed
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_created ON pipeline_runs (user_id, created_at DESC)`
  console.log('  ✓ idx_pipeline_runs_user_created')

  // Categories — system + active filter
  await sql`CREATE INDEX IF NOT EXISTS idx_categories_active ON content_categories (is_active, is_system, created_at)`
  console.log('  ✓ idx_categories_active')

  // Scheduled posts due-for-cron filter
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts (status, scheduled_at) WHERE status = 'pending'`
  console.log('  ✓ idx_scheduled_posts_due')

  // Channels by user
  await sql`CREATE INDEX IF NOT EXISTS idx_channels_user_active ON channels (user_id, is_active)`
  console.log('  ✓ idx_channels_user_active')

  console.log('\nDone.')
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
