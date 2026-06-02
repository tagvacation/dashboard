import { NextRequest, NextResponse } from 'next/server'
import { uploadToYouTube } from '@/lib/youtube'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'


const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

// Convert column index (0-based) to letter: 0=A, 1=B, etc.
const colLetter = (i: number) => String.fromCharCode(65 + i)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { platform, title, description, tags, videoUrl } = await req.json()

  if (platform !== 'youtube') {
    return NextResponse.json({ error: 'Only YouTube supported currently' }, { status: 400 })
  }
  if (!videoUrl) {
    return NextResponse.json({ error: 'No video URL. Upload final reel first.' }, { status: 400 })
  }

  try {
    const result = await uploadToYouTube({ videoPath: videoUrl, title, description, tags: tags || [], isShort: true })
    const videoId = result.id
    const youtubeUrl = `https://youtube.com/shorts/${videoId}`

    // Update sheet
    const sheets = google.sheets({ version: 'v4', auth })

    // Read header row + all data
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:Z`,
    })
    const rows = res.data.values || []
    if (rows.length < 2) return NextResponse.json({ success: true, videoId, youtubeUrl })

    const headers = rows[0]
    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id)
    if (rowIdx === -1) return NextResponse.json({ success: true, videoId, youtubeUrl })

    // Find correct columns by header name
    const statusCol = colLetter(headers.indexOf('status'))
    const publishedToCol = colLetter(headers.indexOf('published_to'))
    const sheetRow = rowIdx + 1 // 1-indexed

    const updateData: any[] = []

    if (headers.includes('status')) {
      updateData.push({ range: `${process.env.SHEET_TAB}!${statusCol}${sheetRow}`, values: [['published']] })
    }
    if (headers.includes('published_to')) {
      // Store as readable: "youtube: https://youtube.com/shorts/xxx"
      const existing = rows[rowIdx][headers.indexOf('published_to')] || ''
      let pubData: Record<string, string> = {}
      try { pubData = existing ? JSON.parse(existing) : {} } catch { }
      pubData.youtube = youtubeUrl
      updateData.push({ range: `${process.env.SHEET_TAB}!${publishedToCol}${sheetRow}`, values: [[JSON.stringify(pubData)]] })
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      })
    }

    return NextResponse.json({ success: true, videoId, youtubeUrl })
  } catch (e: any) {
    console.error('YouTube publish error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
