'use client'

import { useEffect, useState } from 'react'

interface Clip { name: string; url: string; size: number }
interface Story {
  story_id: string
  topic: string
  theme: string
  status: string
  created_at: string
  clips_generated_at: string
  scenes_count: string
  audio_url: string
  notes: string
  clips: Clip[]
  hasAudio: boolean
}

export default function Dashboard() {
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Story | null>(null)

  useEffect(() => {
    fetch('/api/stories')
      .then(r => r.json())
      .then(d => { setStories(d.stories || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const statusColor = (s: string) => ({
    clips_ready: 'bg-green-100 text-green-800',
    generating: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
  }[s] || 'bg-gray-100 text-gray-700')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🎬 Akhri Mod Dashboard</h1>
          <p className="text-sm text-gray-400">{stories.length} stories · {stories.filter(s => s.status === 'clips_ready').length} ready</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetch('/api/stories').then(r => r.json()).then(d => { setStories(d.stories || []); setLoading(false) }) }}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm"
        >
          Refresh
        </button>
      </div>

      <div className="flex h-[calc(100vh-65px)]">
        {/* Story List */}
        <div className="w-96 border-r border-gray-800 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-gray-400 text-sm">Loading stories...</div>
          ) : stories.map(story => (
            <div
              key={story.story_id}
              onClick={() => setSelected(story)}
              className={`p-4 border-b border-gray-800 cursor-pointer hover:bg-gray-900 ${selected?.story_id === story.story_id ? 'bg-gray-900 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{story.topic}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor(story.status)}`}>
                  {story.status === 'clips_ready' ? '✓ Ready' : story.status}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-xs text-gray-500">
                <span>{story.scenes_count} scenes</span>
                <span>{story.clips?.length || 0} clips</span>
                {story.hasAudio && <span>🎵 Audio</span>}
                {story.notes && <span className="text-yellow-600">⚠ {story.notes.includes('FILTERED') ? 'Some filtered' : story.notes}</span>}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {story.created_at ? new Date(story.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Story Detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              Select a story to view details
            </div>
          ) : (
            <StoryDetail story={selected} onDelete={() => { setSelected(null); setStories(s => s.filter(x => x.story_id !== selected.story_id)) }} />
          )}
        </div>
      </div>
    </div>
  )
}

function StoryDetail({ story, onDelete }: { story: Story; onDelete: () => void }) {
  const [activeClip, setActiveClip] = useState<string | null>(story.clips[0]?.url || null)
  const [downloading, setDownloading] = useState(false)

  const downloadZip = async () => {
    setDownloading(true)
    const res = await fetch(`/api/stories/${story.story_id}/download`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${story.story_id}.zip`
    a.click()
    URL.revokeObjectURL(url)
    setDownloading(false)
  }

  const deleteStory = async () => {
    if (!confirm(`Delete "${story.story_id}" and all its files?`)) return
    await fetch(`/api/stories/${story.story_id}`, { method: 'DELETE' })
    onDelete()
  }

  return (
    <div className="max-w-4xl">
      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <button onClick={downloadZip} disabled={downloading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium">
          {downloading ? 'Preparing...' : '⬇ Download ZIP'}
        </button>
        <button onClick={deleteStory} className="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-600/30 rounded-lg text-sm text-red-400">
          🗑 Delete Story
        </button>
      </div>

      {/* Topic */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4">
        <p className="text-xs text-gray-500 mb-1">Story Topic</p>
        <p className="text-sm leading-relaxed">{story.topic}</p>
      </div>

      {/* Audio */}
      {story.audio_url && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-500 mb-2">🎵 Full Narration Audio</p>
          <audio controls className="w-full" src={story.audio_url} />
          <a href={story.audio_url} download className="mt-2 inline-block text-xs text-blue-400 hover:underline">⬇ Download MP3</a>
        </div>
      )}

      {/* Video Clips */}
      <div className="bg-gray-900 rounded-xl p-4">
        <p className="text-xs text-gray-500 mb-3">📹 Video Clips ({story.clips.length})</p>
        <div className="flex gap-4">
          {/* Clip list */}
          <div className="flex flex-col gap-1 w-36 shrink-0">
            {story.clips.map(clip => {
              const num = clip.name.match(/scene_(\d+)/)?.[1]
              return (
                <button
                  key={clip.name}
                  onClick={() => setActiveClip(clip.url)}
                  className={`text-left px-3 py-2 rounded-lg text-xs ${activeClip === clip.url ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                >
                  Scene {num} <span className="text-gray-400">({Math.round(clip.size / 1024 / 1024)}MB)</span>
                </button>
              )
            })}
          </div>
          {/* Video player */}
          {activeClip && (
            <div className="flex-1">
              <video key={activeClip} controls className="w-full max-h-[500px] bg-black rounded-lg" src={activeClip} />
              <a href={activeClip} download className="mt-1 inline-block text-xs text-blue-400 hover:underline">⬇ Download this clip</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
