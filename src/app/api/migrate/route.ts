import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { storiesDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// POST /api/migrate — import existing sheet data into PostgreSQL (one-time)
export async function POST() {
  if (!process.env.SHEET_ID) {
    return NextResponse.json({ error: 'SHEET_ID not configured' }, { status: 400 })
  }

  try {
    const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
    const sheets = google.sheets({ version: 'v4', auth })

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB || 'Sheet2'}!A:Z`,
    })

    const rows = res.data.values || []
    if (rows.length < 2) return NextResponse.json({ imported: 0, message: 'Sheet is empty' })

    const headers = rows[0] as string[]
    const dataRows = rows.slice(1).filter(r => r[0]) // skip empty rows

    let imported = 0
    let skipped = 0

    for (const row of dataRows) {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = row[i] || '' })

      const storyId = obj.story_id
      if (!storyId) continue

      // Check if already exists
      const existing = await storiesDb.get(storyId)
      if (existing) { skipped++; continue }

      // Insert into postgres
      await storiesDb.create({ story_id: storyId, topic: obj.topic || '', theme: obj.theme || '' })
      await storiesDb.update(storyId, {
        status: obj.status || 'clips_ready',
        scenes_count: parseInt(obj.scenes_count || '0') || 0,
        audio_url: obj.audio_url || '',
        youtube_link: obj.youtube_link || obj.published_to || '',
        notes: obj.notes || '',
        storage_path: obj.storage_path || `stories/${storyId}/`,
        ...(obj.clips_generated_at ? { clips_generated_at: obj.clips_generated_at } : {}),
      })
      imported++
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: dataRows.length,
      message: `Migrated ${imported} stories (${skipped} already existed)`,
    })

  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
