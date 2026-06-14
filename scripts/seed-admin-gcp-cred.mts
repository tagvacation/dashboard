/**
 * One-time migration: move the admin's GCP service account from env into the
 * gcp_credentials table (encrypted, is_default) so existing stories/library keep
 * working after env defaults are removed. Backfills stories.gcp_credential_id.
 *
 * PREREQS: set APP_ENCRYPTION_KEY and put the FRESHLY-ROTATED SA JSON in
 * GCS_SERVICE_ACCOUNT_JSON (+ GCS_BUCKET) in .env, THEN run:
 *   npx tsx scripts/seed-admin-gcp-cred.mts
 */
import { readFileSync } from 'fs'
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).replace(/^["']|["']$/g, '')
}
const ADMIN_EMAIL = 'rajaman.ar3@gmail.com'

if (!process.env.APP_ENCRYPTION_KEY) { console.error('Set APP_ENCRYPTION_KEY first (openssl rand -base64 32)'); process.exit(1) }
const saJson = process.env.GCS_SERVICE_ACCOUNT_JSON
if (!saJson) { console.error('Put the rotated SA JSON in GCS_SERVICE_ACCOUNT_JSON in .env first'); process.exit(1) }
const bucket = process.env.GCS_BUCKET
if (!bucket) { console.error('Set GCS_BUCKET in .env'); process.exit(1) }

let projectId = process.env.GCP_PROJECT_ID || ''
try { projectId = projectId || JSON.parse(saJson).project_id } catch { console.error('GCS_SERVICE_ACCOUNT_JSON is not valid JSON'); process.exit(1) }

const { sql, gcpCredentialsDb } = await import('../src/lib/db.ts')

const [admin] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${ADMIN_EMAIL} OR role = 'admin' ORDER BY (email = ${ADMIN_EMAIL}) DESC LIMIT 1`
if (!admin) { console.error('Admin user not found — sign in once first.'); process.exit(1) }

const credId = `gcp_admin_${admin.id.slice(0, 8)}`
await gcpCredentialsDb.create({ id: credId, name: 'Default (migrated)', project_id: projectId, bucket, sa_json: saJson, user_id: admin.id, is_default: true })
await gcpCredentialsDb.setDefault(admin.id, credId)

const res = await sql`
  UPDATE stories SET gcp_credential_id = ${credId}
  WHERE user_id = ${admin.id} AND (gcp_credential_id IS NULL OR gcp_credential_id = '')
  RETURNING story_id
`
console.log(`✓ Seeded admin credential '${credId}' (encrypted, default) for ${ADMIN_EMAIL}`)
console.log(`✓ Backfilled gcp_credential_id on ${res.length} existing stories`)
console.log('You can now remove GCS_SERVICE_ACCOUNT_JSON/GCS_BUCKET from RUNTIME env (still needed at build).')
await sql.end()
process.exit(0)
