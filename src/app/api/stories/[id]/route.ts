import { NextRequest, NextResponse } from 'next/server'
import { deleteStory } from '@/lib/gcs'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'


const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Delete GCS files
    await deleteStory(id)

    // Delete row from Sheet2
    const sheets = google.sheets({ version: 'v4', auth })

    // Get spreadsheet metadata to find Sheet2's sheetId
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID })
    const sheet = meta.data.sheets?.find(s => s.properties?.title === process.env.SHEET_TAB)
    const sheetId = sheet?.properties?.sheetId

    if (sheetId !== undefined) {
      // Find the row with this story_id
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: `${process.env.SHEET_TAB}!A:A`,
      })
      const rows = res.data.values || []
      const rowIdx = rows.findIndex(r => r[0] === id)

      if (rowIdx > 0) {
        // Delete the row (rowIdx is 0-based, sheet rows are 0-based in batchUpdate)
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: process.env.SHEET_ID,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIdx,
                  endIndex: rowIdx + 1,
                },
              },
            }],
          },
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: error.message || 'Delete failed' }, { status: 500 })
  }
}
