import { NextResponse } from 'next/server'
import { storiesDb } from '@/lib/db'
import { Storage } from '@google-cloud/storage'

export const dynamic = 'force-dynamic'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

export async function GET() {
  try {
    const [stories, allFilesResult] = await Promise.all([
      storiesDb.getAll(),
      bucket.getFiles({ prefix: 'stories/' }).catch(() => [[]] as [unknown[]]),
    ])

    const allFiles = allFilesResult[0] as { name: string; metadata: { size?: string } }[]

    // Group GCS files by story_id
    const gcsMap: Record<string, { clips: { name: string; url: string; size: number }[]; hasAudio: boolean }> = {}
    for (const file of allFiles) {
      const parts = file.name.split('/')
      if (parts.length < 3) continue
      const storyId = parts[1]
      if (!gcsMap[storyId]) gcsMap[storyId] = { clips: [], hasAudio: false }
      if (file.name.includes('/clips/') && file.name.endsWith('.mp4')) {
        gcsMap[storyId].clips.push({ name: file.name, url: `${PUBLIC_BASE}/${file.name}`, size: parseInt(file.metadata.size || '0') })
      } else if (file.name.includes('/audio/') && file.name.endsWith('.mp3')) {
        gcsMap[storyId].hasAudio = true
      }
    }
    for (const id in gcsMap) gcsMap[id].clips.sort((a, b) => a.name.localeCompare(b.name))

    const enriched = stories.map(story => {
      const gcs = gcsMap[story.story_id] || { clips: [], hasAudio: false }
      return {
        ...story,
        clips: gcs.clips,
        hasAudio: gcs.hasAudio || !!story.audio_url,
        scenes_count: gcs.clips.length > 0 ? gcs.clips.length : story.scenes_count,
      }
    })

    return NextResponse.json({ stories: enriched })
  } catch (e: unknown) {
    console.error('Stories fetch error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
