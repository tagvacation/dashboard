import { google } from 'googleapis'

export interface GcpContext {
  credentials: Record<string, unknown>
  projectId: string
  bucket: string
  region: string
}

// Default context from env vars (Account B)
export function defaultContext(): GcpContext {
  return {
    credentials: JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!),
    projectId: process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603',
    bucket: process.env.GCS_BUCKET || 'ai_clip_007',
    region: 'us-central1',
  }
}

export async function getAccessToken(ctx: GcpContext): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: ctx.credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token.token) throw new Error('Failed to get access token from service account')
  return token.token
}

// Keep these for backward compat (used by veo.ts directly)
export const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603'
export const GCP_REGION = 'us-central1'

/**
 * Load a GcpContext by credential id. Falls back to env default if id is
 * missing, 'default', or the credential isn't found.
 *
 * Used by both story runner and ad runner so account selection is one
 * code path instead of two.
 */
export async function loadGcpContext(credentialId?: string | null): Promise<GcpContext> {
  if (!credentialId || credentialId === 'default') return defaultContext()

  // Dynamic import to avoid circular dep with lib/db.ts (which doesn't import from auth.ts today,
  // but keeping this safe for future schema changes)
  const { gcpCredentialsDb } = await import('../db')
  const cred = await gcpCredentialsDb.get(credentialId)
  if (!cred) {
    console.warn(`[loadGcpContext] credential '${credentialId}' not found — falling back to env default`)
    return defaultContext()
  }
  return {
    credentials: JSON.parse(cred.sa_json),
    projectId: cred.project_id,
    bucket: cred.bucket || process.env.GCS_BUCKET || 'ai_clip_007',
    region: GCP_REGION,
  }
}
