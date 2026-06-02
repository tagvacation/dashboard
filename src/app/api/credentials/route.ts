import { NextRequest, NextResponse } from 'next/server'
import { gcpCredentialsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const creds = await gcpCredentialsDb.getAll()
  // Always include the default from env (Account B)
  const defaultCred = {
    id: 'default',
    name: `Default (${process.env.GCP_PROJECT_ID || 'gen-lang-client'})`,
    project_id: process.env.GCP_PROJECT_ID || '',
    bucket: process.env.GCS_BUCKET || '',
    is_active: true,
    created_at: '',
    is_default: true,
  }
  return NextResponse.json({ credentials: [defaultCred, ...creds] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, name, project_id, bucket, sa_json } = body

  if (!id || !name || !project_id || !bucket || !sa_json) {
    return NextResponse.json({ error: 'id, name, project_id, bucket, sa_json all required' }, { status: 400 })
  }

  // Validate SA JSON format
  try {
    const parsed = JSON.parse(sa_json)
    if (!parsed.type || parsed.type !== 'service_account') {
      return NextResponse.json({ error: 'sa_json must be a valid Google service account key' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'sa_json is not valid JSON' }, { status: 400 })
  }

  await gcpCredentialsDb.create({ id: id.toLowerCase().replace(/\s+/g, '_'), name, project_id, bucket, sa_json })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (id === 'default') return NextResponse.json({ error: 'Cannot delete default credential' }, { status: 400 })
  await gcpCredentialsDb.delete(id)
  return NextResponse.json({ success: true })
}
