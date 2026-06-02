import { NextRequest, NextResponse } from 'next/server'
import { channelsDb } from '@/lib/db'

export const dynamic = 'force-dynamic'


export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  channelsDb.update(id, body)
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  channelsDb.delete(id)
  return NextResponse.json({ success: true })
}
