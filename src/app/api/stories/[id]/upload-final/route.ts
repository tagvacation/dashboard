import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import { google } from 'googleapis'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

const colLetter = (i: number) => String.fromCharCode(65 + i)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const gcsPath = `stories/${storyId}/final/reel.mp4`
    const gcsFile = bucket.file(gcsPath)

    await gcsFile.save(buffer, { contentType: 'video/mp4', resumable: false })
    // No makePublic() — bucket has uniform public access enabled

    const finalUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${gcsPath}`

    // Update sheet using header-based column lookup
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
        const updateData: any[] = []

        const fieldMap: Record<string, string> = {
          status: 'post_produced',
          final_url: finalUrl,
          merged_at: new Date().toISOString(),
        }

        for (const [field, value] of Object.entries(fieldMap)) {
          const colIdx = headers.indexOf(field)
          if (colIdx !== -1) {
            updateData.push({ range: `${process.env.SHEET_TAB}!${colLetter(colIdx)}${sheetRow}`, values: [[value]] })
          }
        }

        if (updateData.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: updateData },
          })
        }
      }
    }

    return NextResponse.json({ success: true, finalUrl })
  } catch (e: any) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
