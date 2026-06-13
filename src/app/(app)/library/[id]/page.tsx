'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { use } from 'react'

interface Clip { name: string; url: string }
interface Story {
  story_id: string
  topic: string
  status: string
  theme: string
  notes: string
  created_at: string
  audio_url: string
  youtube_link: string
  final_url?: string
  clips: Clip[]
  hasAudio: boolean
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  clips_ready:   { label: 'Clips ready',       color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  post_produced: { label: 'Reel ready',        color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  published:     { label: 'Live on YouTube',   color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  generating:    { label: 'Generating',        color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  failed:        { label: 'Failed',            color: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

const POLL_STATUSES = new Set(['init','topic','script','audio','veo_submit','veo_poll','generating'])

export default function StoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [story, setStory] = useState<Story | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      try {
        const r = await fetch('/api/stories').then(r => r.json())
        if (cancelled) return
        const s = (r.stories || []).find((x: Story) => x.story_id === id)
        setStory(s || null)
        setLoading(false)
        if (s && POLL_STATUSES.has(s.status)) timer = setTimeout(tick, 5000)
      } catch { if (!cancelled) setLoading(false) }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [id])

  if (loading) return (
    <div className="px-4 md:px-8 py-8 max-w-5xl mx-auto">
      <div className="h-8 w-1/3 bg-white/[0.05] rounded animate-pulse mb-3" />
      <div className="h-4 w-1/2 bg-white/[0.05] rounded animate-pulse mb-8" />
      <div className="aspect-[9/16] max-w-sm bg-white/[0.03] border border-white/10 rounded-2xl animate-pulse" />
    </div>
  )

  if (!story) return (
    <div className="px-4 md:px-8 py-8 max-w-3xl mx-auto text-center py-20">
      <p className="text-lg font-semibold">Story not found</p>
      <p className="text-sm text-white/40 mt-1">It may have been deleted or you don&apos;t have access</p>
      <Link href="/library" className="inline-block mt-6 px-4 py-2 bg-white text-black rounded-xl text-sm font-semibold">← Back to library</Link>
    </div>
  )

  const status = STATUS_LABEL[story.status]
  const audioUrl = story.audio_url || (story.hasAudio ? `https://storage.googleapis.com/ai_clip_007/stories/${story.story_id}/audio/full_narration.mp3` : '')
  const isAd = story.theme === 'ai_ad'

  return (
    <div className="px-4 md:px-8 py-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <Link href="/library" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors mb-4">
        ← Library
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {status && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${status.color}`}>
                {status.label}
              </span>
            )}
            {isAd && (
              <span className="text-xs px-2 py-0.5 bg-pink-500/20 text-pink-300 border border-pink-500/30 rounded-full font-medium">🎤 AI Ad</span>
            )}
            {story.youtube_link && (
              <a href={story.youtube_link} target="_blank" rel="noreferrer"
                className="text-xs px-2 py-0.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-full font-medium hover:bg-red-500/30 transition-colors">
                ▶ Live on YouTube
              </a>
            )}
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-snug">{story.topic}</h1>
          <p className="text-xs text-white/30 font-mono mt-2">{story.story_id}</p>
        </div>
      </div>

      {story.notes && (
        <div className="my-4 px-3.5 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">
          ⚠ {story.notes}
        </div>
      )}

      {/* Final reel section — primary CTA when available */}
      {story.final_url ? (
        <div className="mt-6 mb-8 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-purple-500/20 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-purple-200">✨ Final reel (clips + audio merged)</p>
              <p className="text-xs text-white/50 mt-0.5">Ready to publish or share</p>
            </div>
            <div className="flex gap-2">
              <a href={story.final_url} download
                className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-white/90 transition-colors">
                ⬇ Download MP4
              </a>
              <Link href={`/legacy-dashboard?tab=stories&story=${story.story_id}`}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors">
                ▶ Publish to YT
              </Link>
            </div>
          </div>
          <div className="p-5 flex justify-center bg-black/40">
            <video src={story.final_url} controls
              className="rounded-xl max-h-[70vh] aspect-[9/16] bg-black" />
          </div>
        </div>
      ) : (
        <div className="mt-6 mb-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-sm">
          <p className="font-semibold text-amber-300 mb-1">Final reel still being merged</p>
          <p className="text-amber-300/70">
            Clips and audio are ready but ffmpeg merge is in progress. The final video with audio will appear here when done — auto-refreshes every 5s.
          </p>
        </div>
      )}

      {/* Audio player */}
      {audioUrl && (
        <div className="mb-8 bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">🎙 Narration audio</p>
            <a href={audioUrl} download className="text-xs text-white/50 hover:text-white transition-colors">⬇ Download</a>
          </div>
          <audio src={audioUrl} controls className="w-full" />
        </div>
      )}

      {/* Clips grid */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-white/70 mb-3">Individual clips ({story.clips.length})</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {story.clips.map((clip, i) => (
            <div key={clip.url} className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <video src={clip.url} controls
                className="w-full aspect-[9/16] bg-black object-cover" />
              <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-white/60 font-medium">Scene {String(i + 1).padStart(2, '0')}</span>
                <a href={clip.url} download className="text-white/40 hover:text-white transition-colors">⬇</a>
              </div>
            </div>
          ))}
        </div>
        {story.clips.length === 0 && (
          <div className="text-center py-12 text-white/30 text-sm">
            No clips generated yet
          </div>
        )}
      </div>

      {/* Advanced actions footer */}
      <div className="mt-12 pt-6 border-t border-white/5 flex flex-wrap gap-3 items-center justify-between">
        <p className="text-xs text-white/30">Need scene history, publish UI, or scheduled posting?</p>
        <Link href={`/legacy-dashboard?tab=stories&story=${story.story_id}`}
          className="text-xs text-white/50 hover:text-white transition-colors">
          ↗ Open in advanced view
        </Link>
      </div>
    </div>
  )
}
