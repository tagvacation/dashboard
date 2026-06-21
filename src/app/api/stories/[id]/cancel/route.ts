import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { sql, pipelineDb, storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TERMINAL = new Set(['post_produced', 'published', 'failed'])

/**
 * POST /api/stories/[id]/cancel — stop an in-progress generation.
 *
 * Sets cancel_requested so the running pipeline aborts at its next safe checkpoint (it stops
 * submitting further Veo scenes), and optimistically marks the story stopped so the UI updates
 * immediately. Veo clips already submitted can't be un-billed, but remaining scenes are skipped.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params

  const [row] = await sql<{ user_id: string | null; status: string }[]>`SELECT user_id, status FROM stories WHERE story_id = ${id}`
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id && row.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (TERMINAL.has(row.status)) return NextResponse.json({ error: 'Already finished', status: row.status }, { status: 400 })

  await pipelineDb.requestCancel(id)
  await storiesDb.update(id, { status: 'failed', notes: 'Stopped by you' })
  await pipelineDb.setStep(id, 'failed').catch(() => {})
  return NextResponse.json({ success: true })
}
