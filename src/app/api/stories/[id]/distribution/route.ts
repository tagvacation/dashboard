import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'


const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

// Save distribution info (published_to column)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { platform, url, status } = await req.json()
  // platform: 'youtube' | 'instagram' | 'tiktok'
  // status: 'published' | 'scheduled' | 'pending'

  try {
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:L`,
    })
    const rows = res.data.values || []
    const rowIdx = rows.findIndex(r => r[0] === id)
    if (rowIdx < 1) return NextResponse.json({ error: 'Story not found' }, { status: 404 })

    // published_to is col L (index 11)
    const currentVal = rows[rowIdx][11] || ''
    const existing = currentVal ? JSON.parse(currentVal) : {}
    existing[platform] = { status, url: url || '', updatedAt: new Date().toISOString() }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!L${rowIdx + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[JSON.stringify(existing)]] },
    })

    // If all posted → update status to published
    if (Object.values(existing).every((p: any) => p.status === 'published')) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range: `${process.env.SHEET_TAB}!E${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['published']] },
      })
    }

    return NextResponse.json({ success: true, distribution: existing })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
