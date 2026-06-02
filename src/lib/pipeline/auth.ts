import { google } from 'googleapis'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)

// Single auth client reused across pipeline (includes Vertex AI + TTS + GCS + Sheets)
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

export async function getAccessToken(): Promise<string> {
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token.token) throw new Error('Failed to get access token from service account')
  return token.token
}

export const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'gen-lang-client-0866402603'
export const GCP_REGION = 'us-central1'
