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
 * Resolve a USER's GcpContext (multi-tenant — no env default):
 *   explicit credentialId → the user's default account → throw NO_GCP_ACCOUNT.
 * Callers should map NO_GCP_ACCOUNT to an "add a Cloud account" prompt.
 */
export async function getUserGcpContext(userId: string, credentialId?: string | null): Promise<GcpContext> {
  const { gcpCredentialsDb } = await import('../db')
  let cred: GcpCredential | null = null
  if (credentialId && credentialId !== 'default') cred = await gcpCredentialsDb.get(credentialId)
  if (!cred) cred = await gcpCredentialsDb.getDefaultForUser(userId)
  if (!cred) throw new Error('NO_GCP_ACCOUNT')
  return contextFromCredential(cred)
}

/**
 * Load a GcpContext by credential id (pipeline runs store a real credential id).
 * Throws NO_GCP_ACCOUNT if the id is missing or not found — there is no env default.
 */
export async function loadGcpContext(credentialId?: string | null): Promise<GcpContext> {
  if (!credentialId || credentialId === 'default') throw new Error('NO_GCP_ACCOUNT')
  const { gcpCredentialsDb } = await import('../db')
  const cred = await gcpCredentialsDb.get(credentialId)
  if (!cred) throw new Error('NO_GCP_ACCOUNT')
  return contextFromCredential(cred)
}
