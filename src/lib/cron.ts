/**
 * Internal cron engine — runs every 60s, processes due scheduled posts.
 * Started once via src/instrumentation.ts on server boot.
 * Direct DB access (no HTTP round-trip).
 */

import { scheduledPostsDb, storiesDb } from './db'
import { uploadToYouTube } from './youtube'

let started = false

async function processScheduledPosts() {
  try {
    const due = await scheduledPostsDb.getPending()
    if (due.length === 0) return

    console.log(`[Cron] ${due.length} scheduled post(s) due`)

    for (const post of due) {
      await scheduledPostsDb.update(post.id, { status: 'processing' })

      try {
        const story = await storiesDb.get(post.story_id)
        if (!story) throw new Error(`Story ${post.story_id} not found`)

        if (post.platform === 'youtube') {
          // Verify final reel exists in GCS
          const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/stories/${post.story_id}/final/reel.mp4`
          const check = await fetch(gcsUrl, { method: 'HEAD' })
          if (!check.ok) throw new Error('Final reel not in GCS. Upload the edited video first.')

          console.log(`[Cron] Uploading ${post.story_id} to YouTube...`)
          // Use saved title/description/tags from scheduled post (user-edited)
          const ytTitle = post.title || story.topic.slice(0, 100)
          const ytDesc  = post.description || `${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`
          const ytTags  = post.tags ? post.tags.split(',').map(t => t.trim()).filter(Boolean) : ['shorts', 'hindi story', 'kathakar']

          const result = await uploadToYouTube({
            videoPath: gcsUrl,
            title: ytTitle,
            description: ytDesc,
            tags: ytTags,
            isShort: true,
            channelId: post.channel_id || story.channel_id,
          })

          const youtubeUrl = `https://youtube.com/shorts/${result.id}`
          await storiesDb.update(post.story_id, { youtube_link: youtubeUrl, status: 'published' })
          await scheduledPostsDb.update(post.id, { status: 'posted', result_url: youtubeUrl })
          console.log(`[Cron] ✓ ${post.story_id} published: ${youtubeUrl}`)
        } else {
          throw new Error(`${post.platform} auto-publish not yet supported. Do it manually.`)
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[Cron] ✗ Failed post ${post.id}:`, msg)
        await scheduledPostsDb.update(post.id, { status: 'failed', error: msg })
      }
    }
  } catch (e) {
    console.error('[Cron] Unexpected error:', e)
  }
}

export function startCron() {
  if (started || typeof window !== 'undefined') return  // server-side only
  started = true

  // Run immediately on startup (catch any due posts from downtime)
  processScheduledPosts()

  // Then every 60 seconds
  setInterval(processScheduledPosts, 60_000)
  console.log('[Cron] Scheduler started — checking every 60s')
}
