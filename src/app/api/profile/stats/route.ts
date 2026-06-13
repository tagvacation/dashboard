import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireUserId } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userId = await requireUserId()
    const [counts] = await sql<{ total_stories: string; total_ads: string; total_published: string; joined_at: Date }[]>`
      SELECT
        (SELECT COUNT(*) FROM stories WHERE user_id = ${userId} AND theme != 'ai_ad') AS total_stories,
        (SELECT COUNT(*) FROM stories WHERE user_id = ${userId} AND theme = 'ai_ad') AS total_ads,
        (SELECT COUNT(*) FROM stories WHERE user_id = ${userId} AND status = 'published') AS total_published,
        (SELECT created_at FROM users WHERE id = ${userId}) AS joined_at
    `
    const joinedDays = Math.floor((Date.now() - new Date(counts.joined_at).getTime()) / 86400000)
    return NextResponse.json({
      totalStories: parseInt(counts.total_stories),
      totalAds: parseInt(counts.total_ads),
      totalPublished: parseInt(counts.total_published),
      joinedDays,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
