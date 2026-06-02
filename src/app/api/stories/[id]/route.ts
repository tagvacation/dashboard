import { NextRequest, NextResponse } from 'next/server'
import { deleteStory, listStoryFiles } from '@/lib/gcs'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

// ─── GET: fetch single story with fresh GCS data ──────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const [files, sheetRow] = await Promise.all([
      listStoryFiles(id),
      getSheetRow(id),
    ])

    const clips = files
      .filter(f => f.name.includes('/clips/') && f.name.endsWith('.mp4'))
      .map(f => ({ name: f.name, url: `${PUBLIC_BASE}/${f.name}`, size: f.size }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const audioFile = files.find(f => f.name.includes('/audio/') && f.name.endsWith('.mp3'))
    const finalFile = files.find(f => f.name.includes('/final/') && f.name.endsWith('.mp4'))

    return NextResponse.json({
      story: {
        ...(sheetRow || {}),
        story_id: id,
        clips,
        hasAudio: !!audioFile,
        hasFinal: !!finalFile,
        audio_url: audioFile ? `${PUBLIC_BASE}/${audioFile.name}` : (sheetRow?.audio_url || ''),
        final_url: finalFile ? `${PUBLIC_BASE}/${finalFile.name}` : (sheetRow?.final_url || ''),
        scenes_count: clips.length > 0 ? String(clips.length) : (sheetRow?.scenes_count || '0'),
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// ─── DELETE: remove GCS files + sheet row ─────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await deleteStory(id).catch(err => console.warn('GCS delete warning:', err.message))

    const sheets = google.sheets({ version: 'v4', auth })
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID })
    const sheet = meta.data.sheets?.find(s => s.properties?.title === process.env.SHEET_TAB)
    const sheetId = sheet?.properties?.sheetId

    if (sheetId !== undefined) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: `${process.env.SHEET_TAB}!A:A`,
      })
      const rows = res.data.values || []
      const rowIdx = rows.findIndex(r => r[0] === id)
      if (rowIdx > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: process.env.SHEET_ID,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
              },
            }],
          },
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('Delete error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 500 })
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────
async function getSheetRow(storyId: string): Promise<Record<string, string> | null> {
  try {
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:Z`,
    })
    const rows = res.data.values || []
    if (rows.length < 2) return null
    const headers = rows[0] as string[]
    const row = rows.find((r, i) => i > 0 && r[0] === storyId)
    if (!row) return null
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] || '' })
    return obj
  } catch { return null }
}
