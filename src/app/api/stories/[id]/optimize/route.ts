import { NextRequest, NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'
import ffmpeg from 'fluent-ffmpeg'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink, readFile } from 'fs/promises'
import { google } from 'googleapis'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params
  const srcPath = `stories/${storyId}/final/reel.mp4`
  const outPath = `stories/${storyId}/final/reel_optimized.mp4`

  try {
    // Download final reel from GCS
    const tmpIn = join(tmpdir(), `${storyId}_in.mp4`)
    const tmpOut = join(tmpdir(), `${storyId}_out.mp4`)

    await bucket.file(srcPath).download({ destination: tmpIn })

    // FFMPEG: compress for social media (Instagram/YouTube Shorts optimized)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        .outputOptions([
          '-c:v libx264',      // H.264 codec
          '-preset fast',       // fast encoding
          '-crf 23',           // quality (18=high, 28=low) - 23 is good balance
          '-c:a aac',          // audio codec
          '-b:a 128k',         // audio bitrate
          '-movflags +faststart', // web optimized
          '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2', // 9:16 1080p
        ])
        .output(tmpOut)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })

    // Upload optimized to GCS
    const optimizedBuffer = await readFile(tmpOut)
    await bucket.file(outPath).save(optimizedBuffer, { contentType: 'video/mp4', resumable: false })
    // No makePublic() — bucket has uniform public access

    // Cleanup temp files
    await unlink(tmpIn).catch(() => {})
    await unlink(tmpOut).catch(() => {})

    const optimizedUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${outPath}`

    return NextResponse.json({ success: true, optimizedUrl })
  } catch (e: any) {
    console.error('FFMPEG error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
