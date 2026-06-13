/**
 * One-off: rename a story/ad story_id that contains URL-unsafe characters (e.g. '%').
 * Moves GCS objects from the old prefix to the new one, then updates every DB table
 * that keys on story_id and rewrites the embedded paths/URLs.
 *
 * Usage: node scripts/rename-ad-id.mjs "<old_id>" "<new_id>"
 * Refuses to run unless the pipeline_run is in a terminal state (complete/failed/
 * post_produced), so it never clobbers an in-flight run.
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'
import { Storage } from '@google-cloud/storage'

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}

const OLD = process.argv[2]
const NEW = process.argv[3]
if (!OLD || !NEW) { console.error('Usage: node scripts/rename-ad-id.mjs "<old>" "<new>"'); process.exit(1) }
if (!/^[a-z0-9_]+$/i.test(NEW)) { console.error('New id must be URL-safe ([a-z0-9_]).'); process.exit(1) }

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } })
const storage = new Storage({ credentials: JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON) })
const bucket = storage.bucket(process.env.GCS_BUCKET)

const TERMINAL = ['complete', 'failed', 'post_produced']

try {
  const [run] = await sql`SELECT status FROM pipeline_runs WHERE story_id = ${OLD}`
  if (!run) { console.error(`No pipeline_run for "${OLD}"`); process.exit(1) }
  if (!TERMINAL.includes(run.status)) {
    console.error(`Refusing: run is "${run.status}" (not terminal). Wait for it to finish.`)
    process.exit(2)
  }
  const [exists] = await sql`SELECT 1 FROM stories WHERE story_id = ${NEW}`
  if (exists) { console.error(`Target id "${NEW}" already exists.`); process.exit(1) }

  // 1. Move GCS objects: stories/<old>/...  ->  stories/<new>/...
  const [files] = await bucket.getFiles({ prefix: `stories/${OLD}/` })
  console.log(`Moving ${files.length} GCS object(s)...`)
  for (const f of files) {
    const dest = f.name.replace(`stories/${OLD}/`, `stories/${NEW}/`)
    await f.copy(bucket.file(dest))
    await f.delete()
    console.log(`  ${f.name} -> ${dest}`)
  }

  // 2. Rewrite DB. Update child tables first, then the stories/pipeline PKs.
  const replace = (s) => (s == null ? s : String(s).split(OLD).join(NEW))
  const [st] = await sql`SELECT storage_path, audio_url, final_url FROM stories WHERE story_id = ${OLD}`

  await sql`UPDATE scene_jobs       SET story_id = ${NEW} WHERE story_id = ${OLD}`
  await sql`UPDATE scheduled_posts  SET story_id = ${NEW} WHERE story_id = ${OLD}`
  await sql`UPDATE pipeline_runs    SET story_id = ${NEW} WHERE story_id = ${OLD}`
  await sql`
    UPDATE stories SET
      story_id     = ${NEW},
      storage_path = ${replace(st?.storage_path)},
      audio_url    = ${replace(st?.audio_url)},
      final_url    = ${replace(st?.final_url)}
    WHERE story_id = ${OLD}
  `

  console.log(`\n✓ Renamed "${OLD}"\n        -> "${NEW}"`)
  await sql.end()
} catch (e) {
  console.error('FAILED:', e.message)
  await sql.end().catch(() => {})
  process.exit(1)
}
