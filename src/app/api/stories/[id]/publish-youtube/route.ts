import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { google } from 'googleapis'
import { youtube } from '@/lib/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10 min

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const sheetsAuth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const colLetter = (i: number) => String.fromCharCode(65 + i)

// Bypass middleware for large video body (auth checked manually)
function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('auth_token')?.value
  const expected = Buffer.from(`${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`).toString('base64')
  return token === expected
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: storyId } = await params

  if (!req.body) return NextResponse.json({ error: 'No video body' }, { status: 400 })

  // Read title/desc/tags from headers (sent by XHR)
  const title = decodeURIComponent(req.headers.get('x-title') || storyId.replace(/_/g, ' '))
  const description = decodeURIComponent(req.headers.get('x-description') || '')
  const tagsRaw = decodeURIComponent(req.headers.get('x-tags') || 'shorts,hindi story,kathakar')
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)

  try {
    // Stream video directly from request body to YouTube
    const readable = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])

    const result = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.slice(0, 100),
          description,
          tags,
          categoryId: '22',
          defaultLanguage: 'hi',
          defaultAudioLanguage: 'hi',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: { mimeType: 'video/mp4', body: readable },
    }, { timeout: 600_000 })

    const videoId = result.data.id
    if (!videoId) throw new Error('YouTube returned no video ID')
    const youtubeUrl = `https://youtube.com/shorts/${videoId}`

    // Update sheet: youtube_link + status = published
    await updateSheet(storyId, youtubeUrl)

    return NextResponse.json({ success: true, youtubeUrl, videoId })

  } catch (e: unknown) {
    console.error('YouTube upload error:', e)
    const err = e as { response?: { data?: { error?: { message?: string; code?: number } } }; message?: string }
    const apiMsg = err?.response?.data?.error?.message
    const code = err?.response?.data?.error?.code
    const message = apiMsg || err?.message || 'Upload failed'

    if (code === 401 || message.includes('invalid_grant') || message.includes('Token')) {
      return NextResponse.json({ error: 'YouTube token expired. Reconnect YouTube in settings.' }, { status: 401 })
    }
    if (message.includes('quota')) {
      return NextResponse.json({ error: 'YouTube quota exceeded. Try again tomorrow.' }, { status: 429 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function updateSheet(storyId: string, youtubeUrl: string) {
  try {
    const sheets = google.sheets({ version: 'v4', auth: sheetsAuth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:Z`,
    })
    const rows = res.data.values || []
    if (rows.length < 2) return

    const headers = rows[0] as string[]
    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === storyId)
    if (rowIdx === -1) return

    const sheetRow = rowIdx + 1
    const updateData: { range: string; values: string[][] }[] = []

    const ytLinkIdx = headers.indexOf('youtube_link')
    const statusIdx = headers.indexOf('status')
    const publishedAtIdx = headers.indexOf('clips_generated_at') // reuse or use another column

    if (ytLinkIdx !== -1) updateData.push({ range: `${process.env.SHEET_TAB}!${colLetter(ytLinkIdx)}${sheetRow}`, values: [[youtubeUrl]] })
    if (statusIdx !== -1) updateData.push({ range: `${process.env.SHEET_TAB}!${colLetter(statusIdx)}${sheetRow}`, values: [['published']] })

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      })
    }
  } catch (e) {
    console.error('Sheet update failed (non-fatal):', e)
  }
}
