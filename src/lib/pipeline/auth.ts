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
