import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { storesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json({ stores: await storesDb.getAll(userId) })
}

export async function POST(req: NextRequest) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { name, domain, platform } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Store name required' }, { status: 400 })
  const id = `store_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)}_${Math.floor(Math.random() * 1000)}`
  await storesDb.create({ id, user_id: userId, name: name.trim(), domain: (domain || '').trim(), platform: platform || 'shopify' })
  return NextResponse.json({ id })
}
