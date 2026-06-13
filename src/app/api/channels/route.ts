import { NextRequest, NextResponse } from 'next/server'
import { channelsDb, sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'


export async function GET() {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const dbChannels = await channelsDb.getAll(userId)
  return NextResponse.json({ channels: dbChannels })
}

export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await req.json()
  const { id, name, emoji, sheet_id, sheet_tab, gcs_bucket, yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri } = body

  if (!id || !name || !sheet_id || !gcs_bucket) {
    return NextResponse.json({ error: 'id, name, sheet_id, gcs_bucket required' }, { status: 400 })
  }

  try {
    const cleanId = id.toLowerCase().replace(/\s+/g, '_')
    // Insert with user_id directly via SQL to set tenant ownership
    await sql`
      INSERT INTO channels (id, name, emoji, sheet_id, sheet_tab, gcs_bucket, yt_refresh_token, yt_client_id, yt_client_secret, yt_redirect_uri, user_id)
      VALUES (${cleanId}, ${name}, ${emoji || '📺'}, ${sheet_id}, ${sheet_tab || 'Sheet2'}, ${gcs_bucket},
              ${yt_refresh_token ?? null}, ${yt_client_id ?? null}, ${yt_client_secret ?? null}, ${yt_redirect_uri ?? null}, ${userId})
    `
    const [channel] = await sql`SELECT * FROM channels WHERE id = ${cleanId} AND user_id = ${userId}`
    return NextResponse.json({ channel })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
