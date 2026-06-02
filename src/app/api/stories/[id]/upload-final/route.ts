import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import { google } from 'googleapis'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — large video uploads need time

function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get('auth_token')?.value
  const expected = Buffer.from(`${process.env.DASHBOARD_PASSWORD}:${process.env.JWT_SECRET}`).toString('base64')
  return token === expected
}

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

const colLetter = (i: number) => String.fromCharCode(65 + i)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: storyId } = await params

  try {
    const gcsPath = `stories/${storyId}/final/reel.mp4`
    const gcsFile = bucket.file(gcsPath)

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      // Fallback: FormData (small files only)
      const formData = await req.formData()
      const file = formData.get('file') as File
      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
      const buffer = Buffer.from(await file.arrayBuffer())
      await gcsFile.save(buffer, { contentType: 'video/mp4', resumable: buffer.length > 5_000_000 })
    } else {
      // Raw binary stream — preferred for large files (frontend sends file directly as body)
      if (!req.body) return NextResponse.json({ error: 'No body' }, { status: 400 })
      const writeStream = gcsFile.createWriteStream({ resumable: true, contentType: 'video/mp4' })
      await pipeline(
        Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
        writeStream
      )
    }

    const finalUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${gcsPath}`

    // Update sheet
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB}!A:Z`,
    })
    const rows = res.data.values || []
    if (rows.length >= 2) {
      const headers = rows[0]
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === storyId)
      if (rowIdx !== -1) {
        const sheetRow = rowIdx + 1
        const fieldMap: Record<string, string> = {
          status: 'post_produced',
          final_url: finalUrl,
          merged_at: new Date().toISOString(),
        }
        const updateData = Object.entries(fieldMap)
          .map(([field, value]) => {
            const colIdx = headers.indexOf(field)
            return colIdx !== -1 ? { range: `${process.env.SHEET_TAB}!${colLetter(colIdx)}${sheetRow}`, values: [[value]] } : null
          })
          .filter(Boolean) as { range: string; values: string[][] }[]

        if (updateData.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: updateData },
          })
        }
      }
    }

    return NextResponse.json({ success: true, finalUrl })
  } catch (e: unknown) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
