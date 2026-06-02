import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const colLetter = (i: number) => String.fromCharCode(65 + i)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { platform, url, status } = await req.json()

  try {
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:Z`,
    })
    const rows = res.data.values || []
    if (rows.length < 2) return NextResponse.json({ error: 'Sheet empty' }, { status: 404 })

    const headers = rows[0] as string[]
    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id)
    if (rowIdx === -1) return NextResponse.json({ error: 'Story not found' }, { status: 404 })

    const sheetRow = rowIdx + 1
    const pubToIdx = headers.indexOf('published_to')
    const statusIdx = headers.indexOf('status')

    // Merge into published_to JSON
    const currentVal = pubToIdx !== -1 ? (rows[rowIdx][pubToIdx] || '') : ''
    let existing: Record<string, unknown> = {}
    try { if (currentVal) existing = JSON.parse(currentVal) } catch { /* ignore */ }
    existing[platform] = { status, url: url || '', updatedAt: new Date().toISOString() }

    const updateData: { range: string; values: string[][] }[] = []
    if (pubToIdx !== -1) {
      updateData.push({ range: `${process.env.SHEET_TAB}!${colLetter(pubToIdx)}${sheetRow}`, values: [[JSON.stringify(existing)]] })
    }
    if (status === 'published' && statusIdx !== -1) {
      updateData.push({ range: `${process.env.SHEET_TAB}!${colLetter(statusIdx)}${sheetRow}`, values: [['published']] })
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      })
    }

    return NextResponse.json({ success: true, distribution: existing })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
