import { NextResponse } from 'next/server'
import { getAllStories } from '@/lib/sheets'
import { listStoryFiles, PUBLIC_BASE } from '@/lib/gcs'

export async function GET() {
  try {
    const stories = await getAllStories()

    // Enrich with GCS file info for clips_ready stories
    const enriched = await Promise.all(
      stories.map(async (story) => {
        if (story.status !== 'clips_ready') return { ...story, clips: [], hasAudio: false }

        try {
          const files = await listStoryFiles(story.story_id)
          const clips = files
            .filter(f => f.type === 'video')
            .sort((a, b) => a.name.localeCompare(b.name))
          const hasAudio = files.some(f => f.type === 'audio')

          return { ...story, clips, hasAudio }
        } catch {
          return { ...story, clips: [], hasAudio: false }
        }
      })
    )

    return NextResponse.json({ stories: enriched })
  } catch (error) {
    console.error('Error fetching stories:', error)
    return NextResponse.json({ error: 'Failed to fetch stories' }, { status: 500 })
  }
}
