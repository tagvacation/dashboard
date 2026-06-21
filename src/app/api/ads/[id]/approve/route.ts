import { NextRequest, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth-server'
import { sql, pipelineDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ads/[id]/approve — approve a storyboard DRAFT → render it for real.
 *
 * Sets reuseScript so the mascot pipeline renders the EXACT previewed concept/script
 * (no re-rolling), then enqueues the Veo generation.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string
  try { userId = await requireUserId() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action === 'redraft' ? 'redraft' : 'approve'

  const [row] = await sql<{ user_id: string | null; status: string }[]>`
    SELECT user_id, status FROM stories WHERE story_id = ${id}`
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id && row.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const run = await pipelineDb.get(id)
  if (!run?.script_json) return NextResponse.json({ error: 'No draft to approve' }, { status: 400 })

  const { runOrEnqueue } = await import('@/lib/pipeline/queue')
  if (action === 'redraft') {
    // Re-roll the storyboard preview (cheap) — don't reuse the old concept.
    await runOrEnqueue(id, 'draft')
    return NextResponse.json({ success: true, action })
  }

  // Approve → render the EXACT previewed concept/script (no re-rolling), then queue Veo.
  const meta = { ...(run.operation_ids as Record<string, unknown>), reuseScript: true }
  await sql`UPDATE pipeline_runs SET operation_ids = ${sql.json(JSON.parse(JSON.stringify(meta)))} WHERE story_id = ${id}`
  await runOrEnqueue(id, 'ad')
  return NextResponse.json({ success: true, action })
}
