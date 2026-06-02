// One-time: configure CORS on GCS bucket to allow browser direct uploads
// Run: node setup-gcs-cors.mjs

import { readFileSync } from 'fs'
import { Storage } from '@google-cloud/storage'

const envFile = readFileSync('.env', 'utf8')
const env = {}
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const storage = new Storage({ credentials: JSON.parse(env.GCS_SERVICE_ACCOUNT_JSON) })
const bucket = storage.bucket(env.GCS_BUCKET)

await bucket.setCorsConfiguration([
  {
    origin: ['*'],           // allow all origins (dashboard + localhost)
    method: ['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS'],
    responseHeader: ['Content-Type', 'Content-Length', 'Authorization'],
    maxAgeSeconds: 3600,
  },
])

const [metadata] = await bucket.getMetadata()
console.log('✓ CORS configured on bucket:', env.GCS_BUCKET)
console.log('  CORS config:', JSON.stringify(metadata.cors, null, 2))
