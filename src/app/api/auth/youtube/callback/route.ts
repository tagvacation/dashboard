import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2>❌ Auth Failed</h2>
        <p>${error || 'No code received'}</p>
        <a href="/">← Back to Dashboard</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  try {
    // Exchange code for tokens
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.YOUTUBE_CLIENT_ID!,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
        redirect_uri: process.env.YOUTUBE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await res.json()

    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error)
    }

    const refreshToken = tokens.refresh_token

    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:700px">
        <h2>✅ YouTube Connected!</h2>
        <p>Add this to your <code>.env</code> file and Railway environment variables:</p>
        <pre style="background:#f0f0f0;padding:16px;border-radius:8px;word-break:break-all;font-size:13px">YOUTUBE_REFRESH_TOKEN=${refreshToken}</pre>
        <p style="color:#666;font-size:14px">⚠️ Save this token — you won't see it again without re-authorizing.</p>
        <p style="color:#666;font-size:14px">After adding to .env, restart the dev server.</p>
        <br/>
        <a href="/" style="background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none">← Back to Dashboard</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })

  } catch (e: any) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2>❌ Token Exchange Failed</h2>
        <p>${e.message}</p>
        <a href="/">← Back to Dashboard</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }
}
