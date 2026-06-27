import { google } from 'googleapis'
import type { GcpCredential } from '../db'

export interface GcpContext {
  credentials: Record<string, unknown>         // COMPUTE account (Vertex: Veo / Imagen / Gemini) — the SELECTED account
  projectId: string                            // COMPUTE account project
  region: string
  bucket: string                               // STORAGE bucket — ALWAYS the main account's bucket
  storageCredentials: Record<string, unknown>  // STORAGE account creds — ALWAYS the main account
}

export const GCP_REGION = 'us-central1'

/** The main account's storage parts (creds + bucket) from env — storage always lives here. */
function mainStorage(): { creds: Record<string, unknown>; bucket: string } | null {
  const sa = process.env.GCS_SERVICE_ACCOUNT_JSON
  const bucket = process.env.GCS_BUCKET
  if (!sa || !bucket) return null
  try { return { creds: JSON.parse(sa), bucket } } catch { return null }
}

/**
 * Build a GcpContext from a stored (decrypted) credential row.
 * Directive split: COMPUTE (Vertex) runs on THIS selected account; STORAGE always on the main
 * account (so all assets land in the one shared bucket regardless of which account generated them).
 */
export function contextFromCredential(cred: GcpCredential): GcpContext {
  const computeCreds = JSON.parse(cred.sa_json)
  const main = mainStorage()
  return {
    credentials: computeCreds,
    projectId: cred.project_id,
    region: GCP_REGION,
    bucket: main?.bucket || cred.bucket,            // main bucket (fallback to the cred's own if no env)
    storageCredentials: main?.creds || computeCreds, // main creds for GCS (fallback to compute creds)
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
  try { const creds = JSON.parse(sa); return { credentials: creds, projectId, bucket, region: GCP_REGION, storageCredentials: creds } }
  catch { return null }
}

/**
 * Resolve a USER's GcpContext. COMPUTE (Vertex) runs on the explicitly SELECTED account so quota
 * spreads across accounts; STORAGE is always the main account (handled in contextFromCredential).
 * When no account is explicitly selected, COMPUTE falls back to the main account too. We do NOT
 * auto-pick the user's "default" account (the active ones here are misconfigured & broke generation).
 */
export async function getUserGcpContext(_userId: string, credentialId?: string | null): Promise<GcpContext> {
  if (credentialId && credentialId !== 'default') {
    const { gcpCredentialsDb } = await import('../db')
    const cred = await gcpCredentialsDb.get(credentialId)
    if (cred) return contextFromCredential(cred)  // compute=selected, storage=main
  }
  const env = envContext()
  if (env) return env                              // nothing selected → compute=storage=main
  throw new Error('NO_GCP_ACCOUNT')
}

/**
 * Load a GcpContext by credential id. COMPUTE on the selected account (the id stored on the story),
 * STORAGE always on main. Falls back to the main account for compute when the id is missing/unknown.
 */
export async function loadGcpContext(credentialId?: string | null): Promise<GcpContext> {
  if (credentialId && credentialId !== 'default') {
    const { gcpCredentialsDb } = await import('../db')
    const cred = await gcpCredentialsDb.get(credentialId)
    if (cred) return contextFromCredential(cred)  // compute=selected, storage=main
  }
  const env = envContext()
  if (env) return env                              // no selection → compute=storage=main
  throw new Error('NO_GCP_ACCOUNT')
}
