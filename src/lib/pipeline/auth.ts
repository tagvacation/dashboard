import { google } from 'googleapis'
import type { GcpCredential } from '../db'

export interface GcpContext {
  credentials: Record<string, unknown>
  projectId: string
  bucket: string
  region: string
}

export const GCP_REGION = 'us-central1'

/** Build a GcpContext from a stored (decrypted) credential row. */
export function contextFromCredential(cred: GcpCredential): GcpContext {
  return {
    credentials: JSON.parse(cred.sa_json),
    projectId: cred.project_id,
    bucket: cred.bucket,
    region: GCP_REGION,
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

/**
 * The shared "main" Cloud account from env (GCS_SERVICE_ACCOUNT_JSON + GCS_BUCKET + GCP_PROJECT_ID).
 * This is the default everything falls back to — so a merchant doesn't need their own account.
 */
export function envContext(): GcpContext | null {
  const sa = process.env.GCS_SERVICE_ACCOUNT_JSON
  const bucket = process.env.GCS_BUCKET
  const projectId = process.env.GCP_PROJECT_ID
  if (!sa || !bucket || !projectId) return null
  try { return { credentials: JSON.parse(sa), projectId, bucket, region: GCP_REGION } }
  catch { return null }
}

/**
 * Resolve a USER's GcpContext for compute + storage.
 * Directive: everything runs on the MAIN account — so env (main) is preferred ALWAYS. We do NOT
 * auto-pick a user's "default" account, because the only active per-user accounts here are
 * misconfigured (billing disabled / bucket "no-name") and were silently breaking generation.
 * (When a real 2nd working account is added for compute-quota spreading, opt in explicitly then.)
 */
export async function getUserGcpContext(_userId: string, credentialId?: string | null): Promise<GcpContext> {
  const env = envContext()
  if (env) return env
  // Only if the main account env is unset: honor an explicit credential.
  if (credentialId && credentialId !== 'default') {
    const { gcpCredentialsDb } = await import('../db')
    const cred = await gcpCredentialsDb.get(credentialId)
    if (cred) return contextFromCredential(cred)
  }
  throw new Error('NO_GCP_ACCOUNT')
}

/**
 * Load a GcpContext by credential id. Same directive: prefer the MAIN env account always, so
 * stories tagged to a broken per-account credential still run on main.
 */
export async function loadGcpContext(credentialId?: string | null): Promise<GcpContext> {
  const env = envContext()
  if (env) return env
  if (credentialId && credentialId !== 'default') {
    const { gcpCredentialsDb } = await import('../db')
    const cred = await gcpCredentialsDb.get(credentialId)
    if (cred) return contextFromCredential(cred)
  }
  throw new Error('NO_GCP_ACCOUNT')
}
