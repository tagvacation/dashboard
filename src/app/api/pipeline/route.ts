import { NextResponse } from 'next/server'
import { pipelineDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await pipelineDb.getRecent(20)
  return NextResponse.json({ runs: rows })
}
