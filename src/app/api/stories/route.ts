import { NextResponse } from 'next/server'
import { getAllStories } from '@/lib/sheets'
import { Storage } from '@google-cloud/storage'

const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON!)
const storage = new Storage({ credentials })
const bucket = storage.bucket(process.env.GCS_BUCKET!)
const PUBLIC_BASE = `https://storage.googleapis.com/${process.env.GCS_BUCKET}`

export async function GET() {
  try {
    const stories = await getAllStories()

    // ONE GCS call: list all files under stories/ prefix
    const [allFiles] = await bucket.getFiles({ prefix: 'stories/' })

    // Group files by story_id
    const filesByStory: Record<string, { clips: any[]; hasAudio: boolean; hasFinal: boolean }> = {}

    for (const file of allFiles) {
      // stories/{story_id}/clips/scene_01.mp4
      const parts = file.name.split('/')
      if (parts.length < 3) continue
      const storyId = parts[1]

      if (!filesByStory[storyId]) {
        filesByStory[storyId] = { clips: [], hasAudio: false, hasFinal: false }
      }

      const size = parseInt(file.metadata.size as string) || 0
      const url = `${PUBLIC_BASE}/${file.name}`

      if (file.name.includes('/clips/') && file.name.endsWith('.mp4')) {
        filesByStory[storyId].clips.push({ name: file.name, url, size })
      } else if (file.name.includes('/audio/') && file.name.endsWith('.mp3')) {
        filesByStory[storyId].hasAudio = true
      } else if (file.name.includes('/final/')) {
        filesByStory[storyId].hasFinal = true
      }
    }

    // Sort clips by scene number
    for (const storyId in filesByStory) {
      filesByStory[storyId].clips.sort((a, b) => a.name.localeCompare(b.name))
    }

    // Merge GCS data with sheet data
    const enriched = stories.map(story => {
      const gcs = filesByStory[story.story_id] || { clips: [], hasAudio: false, hasFinal: false }
      return {
        ...story,
        clips: gcs.clips,
        hasAudio: gcs.hasAudio,
        hasFinal: gcs.hasFinal,
        // Override scenes_count with actual GCS clip count if sheet data is wrong
        scenes_count: gcs.clips.length > 0 ? String(gcs.clips.length) : story.scenes_count,
      }
    })

    return NextResponse.json({ stories: enriched })
  } catch (error) {
    console.error('Error fetching stories:', error)
    return NextResponse.json({ error: 'Failed to fetch stories' }, { status: 500 })
  }
}
