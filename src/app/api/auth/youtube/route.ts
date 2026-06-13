import { NextRequest, NextResponse } from 'next/server'
import { channelsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') || ''

  // Per-channel OAuth — pull the right client credentials from that channel's row
  let clientId = process.env.YOUTUBE_CLIENT_ID!
  let redirectUri = process.env.YOUTUBE_REDIRECT_URI!

  if (channelId) {
    const ch = await channelsDb.getById(channelId)
    if (ch?.yt_client_id) clientId = ch.yt_client_id
    if (ch?.yt_redirect_uri) redirectUri = ch.yt_redirect_uri
  }

  // Pass channelId through state param so callback can save token to right channel
  const state = channelId ? Buffer.from(JSON.stringify({ channelId })).toString('base64url') : ''

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',  // full read/write — needed to edit existing video metadata
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent', // force refresh_token
    ...(state ? { state } : {}),
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  return NextResponse.redirect(authUrl)
}
