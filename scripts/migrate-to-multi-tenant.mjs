/**
 * Migrate existing single-tenant DB to multi-tenant.
 *
 * 1. Create users table
 * 2. Create admin user (Aman) with all existing data
 * 3. Add user_id columns to: channels, stories, gcp_credentials, scheduled_posts
 * 4. Migrate existing rows to admin user
 * 5. Mark content_categories as SYSTEM (shared across users)
 *
 * IDEMPOTENT — safe to re-run.
 *
 * Run from dashboard/: node scripts/migrate-to-multi-tenant.mjs
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

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false }, onnotice: () => {} })

const ADMIN_EMAIL = 'rajaman.ar3@gmail.com'  // your Google account
const ADMIN_NAME = 'Aman Thakur'

async function main() {
  console.log('═══ Multi-tenant migration ═══\n')

  // 1. Create users table
  console.log('1. Creating users table...')
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      image_url TEXT,
      plan TEXT DEFAULT 'free',           -- free | hobby | pro | agency
      role TEXT DEFAULT 'user',           -- user | admin
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `
  console.log('   ✓ users table ready')

  // 2. Upsert admin user
  console.log(`2. Creating admin user (${ADMIN_EMAIL})...`)
  const [admin] = await sql`
    INSERT INTO users (email, name, plan, role)
    VALUES (${ADMIN_EMAIL}, ${ADMIN_NAME}, 'agency', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin', is_active = true
    RETURNING id, email
  `
  const adminId = admin.id
  console.log(`   ✓ Admin user_id: ${adminId}`)

  // 3. Add user_id columns
  console.log('3. Adding user_id columns to existing tables...')
  await sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE gcp_credentials ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  console.log('   ✓ user_id columns added')

  // 4. Backfill all existing data → admin
  console.log('4. Backfilling existing rows to admin user...')
  const chRes = await sql`UPDATE channels SET user_id = ${adminId} WHERE user_id IS NULL RETURNING id`
  const stRes = await sql`UPDATE stories SET user_id = ${adminId} WHERE user_id IS NULL RETURNING story_id`
  const gcpRes = await sql`UPDATE gcp_credentials SET user_id = ${adminId} WHERE user_id IS NULL RETURNING id`
  const spRes = await sql`UPDATE scheduled_posts SET user_id = ${adminId} WHERE user_id IS NULL RETURNING id`
  const prRes = await sql`UPDATE pipeline_runs SET user_id = ${adminId} WHERE user_id IS NULL RETURNING story_id`
  console.log(`   ✓ ${chRes.length} channels`)
  console.log(`   ✓ ${stRes.length} stories`)
  console.log(`   ✓ ${gcpRes.length} GCP credentials`)
  console.log(`   ✓ ${spRes.length} scheduled posts`)
  console.log(`   ✓ ${prRes.length} pipeline runs`)

  // 5. Content categories: mark existing as SYSTEM (no user_id = shared)
  console.log('5. Adding is_system flag to content_categories...')
  await sql`ALTER TABLE content_categories ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false`
  await sql`ALTER TABLE content_categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
  await sql`UPDATE content_categories SET is_system = true WHERE is_system IS NULL OR is_system = false`
  console.log('   ✓ all existing categories marked as SYSTEM (shared)')

  // 6. Indexes for fast filtering
  console.log('6. Adding indexes for tenant filtering...')
  await sql`CREATE INDEX IF NOT EXISTS idx_channels_user ON channels (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_user ON stories (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_gcp_credentials_user ON gcp_credentials (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user ON scheduled_posts (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON pipeline_runs (user_id)`
  console.log('   ✓ indexes created')

  // 7. Sessions table for NextAuth (needed for the auth refactor next)
  console.log('7. Creating NextAuth tables (accounts, sessions)...')
  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      UNIQUE (provider, provider_account_id)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      expires TIMESTAMPTZ NOT NULL
    )
  `
  console.log('   ✓ accounts + sessions tables ready')

  // Summary
  console.log('\n═══ Migration Summary ═══')
  const users = await sql`SELECT id, email, name, role, plan FROM users`
  console.log(`Users (${users.length}):`)
  users.forEach(u => console.log(`  ${u.email} | ${u.name} | ${u.role}/${u.plan}`))

  const counts = {
    channels: await sql`SELECT COUNT(*) FROM channels WHERE user_id = ${adminId}`,
    stories: await sql`SELECT COUNT(*) FROM stories WHERE user_id = ${adminId}`,
    gcp: await sql`SELECT COUNT(*) FROM gcp_credentials WHERE user_id = ${adminId}`,
    cats: await sql`SELECT COUNT(*) FROM content_categories WHERE is_system = true`,
  }
  console.log(`\nAdmin user owns:`)
  console.log(`  ${counts.channels[0].count} channels`)
  console.log(`  ${counts.stories[0].count} stories`)
  console.log(`  ${counts.gcp[0].count} GCP credentials`)
  console.log(`  ${counts.cats[0].count} system content categories (shared)`)

  console.log('\n✅ Migration complete. Existing dashboard still works (user_id filtering not enforced yet).')
  console.log('Next: install NextAuth.js + Google OAuth, then enforce user_id in queries.')
  await sql.end()
}

main().catch(async e => { console.error('FATAL:', e); await sql.end(); process.exit(1) })
