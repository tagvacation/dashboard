import { NextRequest, NextResponse } from 'next/server'
import { channelsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'


export async function GET() {
  // Default channel always from env
  const defaultChannel = {
    id: 'default',
    name: process.env.CHANNEL_NAME || 'KathaKar',
    emoji: '🪔',
    sheet_id: process.env.SHEET_ID || '',
    sheet_tab: process.env.SHEET_TAB || 'Sheet2',
    gcs_bucket: process.env.GCS_BUCKET || '',
    yt_refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    is_default: true,
  }

  // Additional channels from DB
  const dbChannels = channelsDb.getAll()

  return NextResponse.json({ channels: [defaultChannel, ...dbChannels] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, name, emoji, sheet_id, sheet_tab, gcs_bucket, yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri } = body

  if (!id || !name || !sheet_id || !gcs_bucket) {
    return NextResponse.json({ error: 'id, name, sheet_id, gcs_bucket required' }, { status: 400 })
  }

  try {
    const channel = channelsDb.create({
      id: id.toLowerCase().replace(/\s+/g, '_'),
      name, emoji: emoji || '📺',
      sheet_id, sheet_tab: sheet_tab || 'Sheet2',
      gcs_bucket,
      yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri,
    })
    return NextResponse.json({ channel })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
