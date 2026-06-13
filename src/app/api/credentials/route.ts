import { NextRequest, NextResponse } from 'next/server'
import { gcpCredentialsDb, sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const userCreds = await gcpCredentialsDb.getAll(userId)
  // Default from env is admin-only (shared infra). Hidden from regular users.
  return NextResponse.json({ credentials: userCreds })
}

export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await req.json()
  const { id, name, project_id, bucket, sa_json } = body

  if (!id || !name || !project_id || !bucket || !sa_json) {
    return NextResponse.json({ error: 'id, name, project_id, bucket, sa_json all required' }, { status: 400 })
  }

  // Validate SA JSON
  try {
    const parsed = JSON.parse(sa_json)
    if (parsed.type !== 'service_account') {
      return NextResponse.json({ error: 'sa_json must be a Google service account key' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'sa_json is not valid JSON' }, { status: 400 })
  }

  const cleanId = id.toLowerCase().replace(/\s+/g, '_')
  await sql`
    INSERT INTO gcp_credentials (id, name, project_id, bucket, sa_json, user_id)
    VALUES (${cleanId}, ${name}, ${project_id}, ${bucket}, ${sa_json}, ${userId})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, project_id = EXCLUDED.project_id,
      bucket = EXCLUDED.bucket, sa_json = EXCLUDED.sa_json
  `
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await req.json()
  if (id === 'default') return NextResponse.json({ error: 'Cannot delete default credential' }, { status: 400 })

  // Verify ownership before delete
  const [row] = await sql<{ user_id: string }[]>`SELECT user_id FROM gcp_credentials WHERE id = ${id}`
  if (!row || row.user_id !== userId) {
    return NextResponse.json({ error: 'Credential not found or not owned by you' }, { status: 404 })
  }
  await sql`UPDATE gcp_credentials SET is_active = false WHERE id = ${id}`
  return NextResponse.json({ success: true })
}
