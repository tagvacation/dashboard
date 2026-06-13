/**
 * Set channel_id on existing stories.
 * All pre-existing stories belong to KathaKar (it was the only channel before).
 * The veggie drama test story belongs to Kissopedia.
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

async function main() {
  // 1. Move the veggie test story to Kissopedia
  const v = await sql`
    UPDATE stories SET channel_id = 'kissopedia'
    WHERE story_id = 'story_2026_06_06_veggie_test_001'
    RETURNING story_id
  `
  console.log(`Kissopedia: ${v.length} story tagged`)

  // 2. Everything else → KathaKar (single-channel era)
  const k = await sql`
    UPDATE stories SET channel_id = 'kathakar'
    WHERE (channel_id = 'default' OR channel_id IS NULL OR channel_id = '')
      AND story_id != 'story_2026_06_06_veggie_test_001'
    RETURNING story_id
  `
  console.log(`KathaKar: ${k.length} stories tagged`)

  // Summary
  const summary = await sql`
    SELECT channel_id, COUNT(*) as count
    FROM stories GROUP BY channel_id ORDER BY count DESC
  `
  console.log('\nStories per channel:')
  summary.forEach(s => console.log(`  ${s.channel_id || '(null)'}: ${s.count}`))

  await sql.end()
}

main().catch(async e => { console.error(e); await sql.end(); process.exit(1) })
