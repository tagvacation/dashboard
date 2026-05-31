import { NextRequest, NextResponse } from 'next/server'
import { deleteStory } from '@/lib/gcs'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteStory(params.id)
    // TODO: update sheet status to 'deleted'
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
