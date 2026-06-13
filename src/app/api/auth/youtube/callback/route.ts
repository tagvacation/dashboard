import { NextRequest, NextResponse } from 'next/server'
import { channelsDb, sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

function htmlPage(title: string, body: string) {
  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;padding:40px;max-width:700px;color:#111">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')
  const stateRaw = req.nextUrl.searchParams.get('state')

  // Decode channelId from state
  let channelId = ''
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf-8'))
      channelId = parsed.channelId || ''
    } catch { /* ignore */ }
  }

  if (error || !code) {
    return htmlPage('Auth Failed', `
      <h2>❌ Auth Failed</h2>
      <p>${error || 'No code received'}</p>
      <a href="/?tab=settings">← Back to Dashboard</a>
    `)
  }

  try {
    // Resolve client credentials — per-channel if specified, else env default
    let clientId = process.env.YOUTUBE_CLIENT_ID!
    let clientSecret = process.env.YOUTUBE_CLIENT_SECRET!
    let redirectUri = process.env.YOUTUBE_REDIRECT_URI!

    if (channelId) {
      const ch = await channelsDb.getById(channelId)
      if (ch?.yt_client_id) clientId = ch.yt_client_id
      if (ch?.yt_client_secret) clientSecret = ch.yt_client_secret
      if (ch?.yt_redirect_uri) redirectUri = ch.yt_redirect_uri
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    })

    const tokens = await res.json()
    if (tokens.error) throw new Error(tokens.error_description || tokens.error)
    const refreshToken = tokens.refresh_token
    if (!refreshToken) throw new Error('No refresh_token in response (force re-consent)')

    // If we know which channel, save directly to DB
    if (channelId) {
      await sql`UPDATE channels SET yt_refresh_token = ${refreshToken} WHERE id = ${channelId}`
      return htmlPage('Connected', `
        <h2>✅ YouTube Connected</h2>
        <p>Refresh token saved to channel <code>${channelId}</code> in the database.</p>
        <p style="color:#666;font-size:14px">You can close this tab.</p>
        <a href="/?tab=settings" style="display:inline-block;background:#111;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:8px">← Back to Settings</a>
      `)
    }

    // Legacy / env-default flow: show token for manual .env paste
    return htmlPage('Connected', `
      <h2>✅ YouTube Connected</h2>
      <p>Add this to your <code>.env</code> file:</p>
      <pre style="background:#f0f0f0;padding:16px;border-radius:8px;word-break:break-all;font-size:13px">YOUTUBE_REFRESH_TOKEN=${refreshToken}</pre>
      <p style="color:#666;font-size:14px">⚠ Save this token — you won't see it again without re-authorizing.</p>
      <a href="/?tab=settings" style="display:inline-block;background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:8px">← Back to Dashboard</a>
    `)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return htmlPage('Token Exchange Failed', `
      <h2>❌ Token Exchange Failed</h2>
      <p>${msg}</p>
      <a href="/?tab=settings">← Back to Dashboard</a>
    `)
  }
}
