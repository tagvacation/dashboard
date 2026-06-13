'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Clip { name: string; url: string; size: number }
interface Story {
  story_id: string; topic: string; theme: string; status: string
  created_at: string; clips_generated_at: string; scenes_count: string
  audio_url: string; notes: string; youtube_link: string
  clips: Clip[]; hasAudio: boolean; hasFinal: boolean
}
interface PipelineRun {
  story_id: string; status: string; topic: string; theme: string
  log: string[]; completed_clips: string[]; filtered_clips: string[]
  operation_ids: Record<string, string>; error: string
  created_at: string; updated_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  clips_ready:   { label: 'Ready',      dot: 'bg-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  post_produced: { label: 'Edited',     dot: 'bg-blue-400',    bg: 'bg-blue-50',    text: 'text-blue-700'    },
  published:     { label: 'Published',  dot: 'bg-purple-400',  bg: 'bg-purple-50',  text: 'text-purple-700'  },
  generating:    { label: 'Generating', dot: 'bg-amber-400',   bg: 'bg-amber-50',   text: 'text-amber-700'   },
  failed:        { label: 'Failed',     dot: 'bg-red-400',     bg: 'bg-red-50',     text: 'text-red-700'     },
}

const STEP_LABELS: Record<string, { label: string; emoji: string }> = {
  init:       { label: 'Starting up',         emoji: '⏳' },
  topic:      { label: 'Picking story topic',  emoji: '🎯' },
  script:     { label: 'Writing script',       emoji: '✍️' },
  audio:      { label: 'Recording narration',  emoji: '🎙️' },
  sheet_meta: { label: 'Updating log',         emoji: '📋' },
  veo_submit: { label: 'Submitting to Veo',    emoji: '🚀' },
  veo_poll:   { label: 'Generating clips',     emoji: '🎬' },
  complete:   { label: 'Done!',                emoji: '✅' },
  failed:     { label: 'Failed',               emoji: '❌' },
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ open, title, message, onConfirm, onCancel, danger = true }:
  { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <p className="text-base font-bold text-gray-900 mb-1">{title}</p>
        <p className="text-sm text-gray-500 mb-5">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors text-white ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#111111] hover:bg-black'}`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Root ──────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
  clips_ready:   { bar: 'bg-emerald-400', badge: 'bg-emerald-100 text-emerald-700', text: 'Ready to merge' },
  post_produced: { bar: 'bg-blue-400',    badge: 'bg-blue-100 text-blue-700',       text: 'Ready to publish' },
  published:     { bar: 'bg-violet-400',  badge: 'bg-violet-100 text-violet-700',   text: 'Live' },
  generating:    { bar: 'bg-amber-400',   badge: 'bg-amber-100 text-amber-700',     text: 'Generating' },
  failed:        { bar: 'bg-red-400',     badge: 'bg-red-100 text-red-600',         text: 'Failed' },
}

const NEXT_ACTION: Record<string, { title: string; body: string; cta: string; ctaTab?: string; bg: string }> = {
  clips_ready:   { title: '⬇ Step 1: Download assets',  body: 'Download the ZIP, merge clips with the audio in CapCut/DaVinci, then upload the final reel back.', cta: 'Download ZIP', ctaTab: 'clips',   bg: 'bg-emerald-50 border-emerald-200' },
  post_produced: { title: '▶ Ready to publish',          body: 'Final reel is ready. Publish directly to YouTube with one click.',                                cta: 'Open YouTube tab', ctaTab: 'publish', bg: 'bg-blue-50 border-blue-200' },
  published:     { title: '✓ Live on YouTube',           body: 'Watch performance — analytics will show CTR, retention, and views in the Analytics tab.',         cta: 'Open on YouTube',  ctaTab: 'publish', bg: 'bg-violet-50 border-violet-200' },
  generating:    { title: '⏳ Generating',                body: 'AI is producing scripts, audio, and clips. Stay on this page or check back in ~12 minutes.',      cta: 'View progress',    ctaTab: 'history', bg: 'bg-amber-50 border-amber-200' },
  failed:        { title: '✗ Something went wrong',      body: 'See Scene History for which step or scenes failed. You can retry filtered scenes from there.',    cta: 'See history',      ctaTab: 'history', bg: 'bg-red-50 border-red-200' },
}

const NAV = [
  { key: 'generate',  icon: '✦',  label: 'Generate'  },
  { key: 'stories',   icon: '▤',  label: 'Stories'   },
  { key: 'analytics', icon: '◎',  label: 'Analytics' },
  { key: 'settings',  icon: '◈',  label: 'Settings'  },
] as const

interface Channel {
  id: string; name: string; emoji: string
  sheet_id?: string; sheet_tab?: string; gcs_bucket?: string
  yt_refresh_token?: string; yt_client_id?: string
  yt_client_secret?: string; yt_redirect_uri?: string
  is_default?: boolean
}

function DashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL-driven state — back/forward button works correctly
  const tab = (searchParams.get('tab') || 'generate') as 'stories' | 'generate' | 'analytics' | 'settings'
  const selectedId = searchParams.get('story')
  const channelParam = searchParams.get('channel') || ''

  const [stories, setStories] = useState<Story[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)

  // Determine current channel — URL param wins, else first available
  const currentChannel = channels.find(c => c.id === channelParam) || channels[0] || null

  const selected = stories.find(s => s.story_id === selectedId) || null

  // Load channels once
  useEffect(() => {
    fetch('/api/channels').then(r => r.json())
      .then(d => setChannels(d.channels || []))
      .catch(() => {})
  }, [])

  const loadStories = useCallback(() => {
    setLoading(true)
    const url = currentChannel?.id ? `/api/stories?channelId=${currentChannel.id}` : '/api/stories'
    fetch(url).then(r => r.json())
      .then(d => { setStories(d.stories || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [currentChannel?.id])

  useEffect(() => { loadStories() }, [loadStories])

  // Sort: needs-action statuses bubble to top; within group, newest first
  const STATUS_PRIORITY: Record<string, number> = {
    clips_ready: 0,    // user must merge + upload
    post_produced: 1,  // user can publish
    failed: 2,         // user might want to retry
    generating: 3,     // wait
    published: 4,      // done
  }
  const filtered = stories
    .filter(s => !search || s.topic.toLowerCase().includes(search.toLowerCase()) || s.story_id.includes(search))
    .slice()
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 5
      const pb = STATUS_PRIORITY[b.status] ?? 5
      if (pa !== pb) return pa - pb
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const navigate = useCallback((key: typeof tab, storyId?: string) => {
    const params = new URLSearchParams()
    params.set('tab', key)
    if (storyId) params.set('story', storyId)
    if (channelParam) params.set('channel', channelParam)
    router.push(`/?${params.toString()}`)
  }, [router, channelParam])

  const switchChannel = useCallback((channelId: string) => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    params.set('channel', channelId)
    // Drop story selection when switching channel — likely doesn't belong
    router.push(`/?${params.toString()}`)
    setChannelPickerOpen(false)
  }, [router, tab])

  const selectStory = useCallback((story: Story) => {
    navigate('stories', story.story_id)
  }, [navigate])

  const goBack = useCallback(() => {
    navigate('stories')
  }, [navigate])

  return (
    <div className="h-screen flex overflow-hidden bg-[#F5F5F7]">

      {/* ══════════ DARK SIDEBAR ══════════ */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-[#111111] text-white overflow-hidden">

        {/* Channel switcher */}
        <div className="relative px-3 pt-4 pb-3 border-b border-white/10">
          <button onClick={() => setChannelPickerOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/5 transition-colors group">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-base shrink-0">
              {currentChannel?.emoji || '📺'}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-bold tracking-tight truncate">
                {currentChannel?.name || 'Loading...'}
              </p>
              <p className="text-xs text-white/30">AI Studio</p>
            </div>
            <svg className={`w-4 h-4 text-white/40 shrink-0 transition-transform ${channelPickerOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {channelPickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setChannelPickerOpen(false)} />
              <div className="absolute left-3 right-3 top-full mt-1 z-20 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1 max-h-72 overflow-y-auto">
                {channels.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-white/40">No channels yet</div>
                ) : channels.map(ch => {
                  const isCurrent = currentChannel?.id === ch.id
                  return (
                    <button key={ch.id} onClick={() => switchChannel(ch.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/10 transition-colors
                        ${isCurrent ? 'bg-white/5' : ''}`}>
                      <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-base shrink-0">
                        {ch.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{ch.name}</p>
                        <p className="text-xs text-white/30 truncate">
                          {ch.yt_refresh_token ? '✓ YT connected' : 'No YT auth'}
                          {ch.is_default ? ' · env default' : ''}
                        </p>
                      </div>
                      {isCurrent && <span className="text-white/60 text-xs">●</span>}
                    </button>
                  )
                })}
                <button onClick={() => router.push('/?tab=settings')}
                  className="w-full px-3 py-2 text-left text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors border-t border-white/10 mt-1">
                  + Manage channels
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="px-2 py-3 space-y-0.5">
          {NAV.map(n => (
            <button key={n.key} onClick={() => navigate(n.key as typeof tab)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left
                ${tab === n.key
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}>
              <span className="text-base leading-none w-4 text-center">{n.icon}</span>
              {n.label}
            </button>
          ))}
          {/* Spotlight CTA — Create Ad wizard */}
          <Link href="/ads"
            className="mt-2 w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 text-white transition-all text-left border border-white/10">
            <span className="text-base leading-none w-4 text-center">🎤</span>
            Create AI Ad
            <span className="ml-auto text-xs px-1.5 py-0.5 bg-white/15 rounded-full font-semibold">NEW</span>
          </Link>
          {/* Profile / account settings */}
          <Link href="/profile"
            className="mt-1 w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all text-left">
            <span className="text-base leading-none w-4 text-center">◉</span>
            Profile & Accounts
          </Link>
        </nav>

        {/* Story list (always visible in sidebar) */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-white/10 mt-1">
          <div className="px-3 py-2 shrink-0 flex gap-1.5">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter stories..."
              className="flex-1 min-w-0 px-3 py-1.5 bg-white/10 text-white placeholder-white/30 text-xs rounded-lg focus:outline-none focus:bg-white/15" />
            {search && <button onClick={() => setSearch('')} className="text-white/40 hover:text-white/70 text-xs px-1">✕</button>}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {loading ? (
              [...Array(5)].map((_, i) => <div key={i} className="h-11 animate-pulse bg-white/5 rounded-xl" />)
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-white/30 text-xs">
                {search ? 'No results' : 'No stories yet'}
              </div>
            ) : filtered.map(story => {
              const sc = STATUS_COLORS[story.status] || STATUS_COLORS.failed
              const isActive = selectedId === story.story_id
              return (
                <button key={story.story_id} onClick={() => selectStory(story)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start gap-2.5 group
                    ${isActive ? 'bg-white/15' : 'hover:bg-white/8'}`}>
                  <div className={`w-1 min-h-[32px] rounded-full shrink-0 mt-0.5 ${sc.bar}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium line-clamp-2 leading-snug ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white/80'}`}>
                      {story.topic}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-white/25">{story.clips.length || story.scenes_count || 0} clips</span>
                      {story.youtube_link && <span className="text-red-400 text-xs">▶</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bottom: stats + actions */}
        <div className="shrink-0 border-t border-white/10 px-3 py-3 space-y-2">
          <div className="flex gap-1.5">
            <div className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-white">{stories.length}</p>
              <p className="text-xs text-white/30">Total</p>
            </div>
            <div className="flex-1 bg-emerald-500/10 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-emerald-400">{stories.filter(s => s.status === 'published').length}</p>
              <p className="text-xs text-emerald-400/60">Live</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button onClick={loadStories}
              className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 rounded-lg text-xs transition-colors">
              ↺ Refresh
            </button>
            <button onClick={async () => { (await import('next-auth/react')).signOut({ callbackUrl: '/welcome' }) }}
              className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 rounded-lg text-xs transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ══════════ MAIN CONTENT ══════════ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden shrink-0 bg-[#111111] px-4 py-3 flex items-center gap-3">
          {selected && tab === 'stories' ? (
            <button onClick={goBack} className="p-1.5 -ml-1 text-white/70 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <button onClick={() => setChannelPickerOpen(o => !o)} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center text-sm">
                {currentChannel?.emoji || '📺'}
              </div>
              <span className="font-bold text-white text-sm">{currentChannel?.name || 'Loading'}</span>
              <svg className="w-3 h-3 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          <span className="ml-auto text-xs text-white/40 capitalize">{tab}</span>
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">

          {tab === 'generate' && (
            <div className="h-full overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
              <GenerateView onStoryReady={() => { loadStories(); navigate('stories') }} stories={stories} />
            </div>
          )}

          {tab === 'stories' && (
            <div className="h-full flex">
              {/* Mobile: list OR detail (URL-driven) */}
              {!selected ? (
                /* Mobile story list */
                <div className="flex md:hidden flex-col w-full bg-[#F5F5F7]">
                  <div className="bg-white px-4 pt-3 pb-2 border-b border-gray-100">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stories..."
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-gray-300" />
                  </div>
                  <div className="flex-1 overflow-y-auto pb-20 divide-y divide-gray-100 bg-white">
                    {loading ? (
                      [...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-gray-50 mx-4 my-2 rounded-xl" />)
                    ) : filtered.map(story => {
                      const sc = STATUS_COLORS[story.status] || STATUS_COLORS.failed
                      return (
                        <button key={story.story_id} onClick={() => selectStory(story)}
                          className="w-full text-left px-4 py-3.5 active:bg-gray-50 flex items-start gap-3">
                          <div className={`w-1 self-stretch rounded-full shrink-0 ${sc.bar}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug">{story.topic}</p>
                            <div className="flex gap-2 mt-1.5 items-center flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.badge}`}>{sc.text}</span>
                              <span className="text-xs text-gray-400">{story.clips.length || story.scenes_count || 0} clips</span>
                              {story.youtube_link && <span className="text-xs text-red-500 font-medium">▶ Live</span>}
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                /* Mobile story detail */
                <div className="flex md:hidden flex-col w-full overflow-y-auto pb-20">
                  <StoryDetail
                    key={selected.story_id}
                    story={selected}
                    onDelete={() => { navigate('stories'); setStories(s => s.filter(x => x.story_id !== selected.story_id)) }}
                    onUpdate={u => setStories(s => s.map(x => x.story_id === u.story_id ? u : x))}
                  />
                </div>
              )}

              {/* Desktop story detail */}
              <main className="hidden md:flex flex-1 flex-col overflow-y-auto">
                {!selected ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-3xl">📚</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700">Select a story</p>
                      <p className="text-xs text-gray-400 mt-1">Pick from the sidebar or generate a new one</p>
                    </div>
                    <button onClick={() => navigate('generate')}
                      className="px-5 py-2.5 bg-[#111111] hover:bg-black text-white rounded-xl text-sm font-semibold">
                      ✦ Generate New Story
                    </button>
                  </div>
                ) : (
                  <StoryDetail
                    key={selected.story_id}
                    story={selected}
                    onDelete={() => { navigate('stories'); setStories(s => s.filter(x => x.story_id !== selected.story_id)) }}
                    onUpdate={u => setStories(s => s.map(x => x.story_id === u.story_id ? u : x))}
                  />
                )}
              </main>
            </div>
          )}

          {tab === 'analytics' && (
            <div className="h-full overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
              <AnalyticsView channelId={currentChannel?.id} />
            </div>
          )}

          {tab === 'settings' && (
            <div className="h-full overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
              <SettingsView />
            </div>
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#111111] border-t border-white/10 flex z-20">
        {NAV.map(n => (
          <button key={n.key} onClick={() => navigate(n.key as typeof tab)}
            className="flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors">
            <span className={`text-lg leading-none font-bold ${tab === n.key ? 'text-white' : 'text-white/30'}`}>{n.icon}</span>
            <span className={tab === n.key ? 'text-white' : 'text-white/30'}>{n.label}</span>
          </button>
        ))}
      </nav>

    </div>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#111111] flex items-center justify-center text-white/30 text-sm">Loading...</div>}>
      <DashboardInner />
    </Suspense>
  )
}

// ─── Generate View ─────────────────────────────────────────────────────────────

interface Category {
  id: string; name: string; emoji: string; description: string
  perspective: string; is_default: boolean
  scene_count_min: number; scene_count_max: number
}

function GenerateView({ onStoryReady, stories }: { onStoryReady: () => void; stories: Story[] }) {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [expandedLog, setExpandedLog] = useState(false)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCat, setSelectedCat] = useState<string>('kathakar')
  const [selectedCred, setSelectedCred] = useState<string>('default')
  const [credentials, setCredentials] = useState<{ id: string; name: string; project_id: string }[]>([])

  useEffect(() => {
    fetch('/api/credentials').then(r => r.json()).then(d => setCredentials(d.credentials || []))
  }, [])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(d => {
      setCategories(d.categories || [])
      const def = (d.categories || []).find((c: Category) => c.is_default)
      if (def) setSelectedCat(def.id)
    })
  }, [])

  const loadRuns = async () => {
    const res = await fetch('/api/pipeline')
    const data = await res.json()
    const list: PipelineRun[] = data.runs || []
    setRuns(list)
    const active = list.find(r => !['complete', 'failed'].includes(r.status))
    if (active?.story_id !== activeRun?.story_id) {
      if (active) fetchRunDetail(active.story_id)
      else setActiveRun(null)
    }
  }

  const fetchRunDetail = async (id: string) => {
    const res = await fetch(`/api/pipeline/${id}`)
    const data: PipelineRun = await res.json()
    setActiveRun(data)
    if (data.status === 'complete') { onStoryReady(); stopPoll() }
    if (data.status === 'failed') stopPoll()
  }

  const startPoll = (id: string) => {
    stopPoll()
    pollRef.current = setInterval(() => fetchRunDetail(id), 3000)
  }

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => { loadRuns(); return () => stopPoll() }, [])

  useEffect(() => {
    if (activeRun && !['complete', 'failed'].includes(activeRun.status)) startPoll(activeRun.story_id)
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeRun?.status, activeRun?.log?.length])

  const startGeneration = async () => {
    setStarting(true)
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: selectedCat, credential_id: selectedCred }),
    })
    const data = await res.json()
    setStarting(false)
    await fetchRunDetail(data.story_id)
    startPoll(data.story_id)
    await loadRuns()
  }

  const isRunning = activeRun && !['complete', 'failed'].includes(activeRun.status)
  const totalOps = activeRun ? Object.keys(activeRun.operation_ids || {}).length : 0
  const doneClips = activeRun?.completed_clips?.length ?? 0
  const filteredCount = activeRun?.filtered_clips?.length ?? 0
  const STEPS = ['init', 'topic', 'script', 'audio', 'veo_submit', 'veo_poll', 'complete']
  const currentStepIdx = activeRun ? STEPS.indexOf(activeRun.status) : -1

  // Stats from DB stories
  const statsTotal = stories.length
  const statsReady = stories.filter(s => s.status === 'clips_ready' || s.status === 'post_produced').length
  const statsPublished = stories.filter(s => s.status === 'published').length
  const statsThisWeek = stories.filter(s => {
    const d = new Date(s.created_at)
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000
  }).length

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 pb-8">

      {/* ── Header + CTA ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">✨ Generate</h1>
          <p className="text-xs text-gray-400 mt-0.5">AI pipeline: topic → script → audio → video clips</p>
        </div>
        <button onClick={startGeneration} disabled={starting || !!isRunning}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm
            ${starting || isRunning ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
          {starting ? (
            <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Starting...</>
          ) : isRunning ? '🎬 Running...' : `+ Generate ${categories.find(c => c.id === selectedCat)?.emoji || '✨'}`}
        </button>
      </div>

      {/* ── Category Picker ── */}
      {categories.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Content Type</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCat(cat.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${selectedCat === cat.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                <div className="text-xl mb-1">{cat.emoji}</div>
                <p className={`text-xs font-semibold ${selectedCat === cat.id ? 'text-indigo-700' : 'text-gray-700'}`}>{cat.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{cat.description}</p>
                <div className="mt-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
                    cat.perspective === 'first_person' ? 'bg-purple-50 text-purple-600' :
                    cat.perspective === 'character' ? 'bg-orange-50 text-orange-600' :
                    'bg-gray-50 text-gray-500'
                  }`}>
                    {cat.perspective === 'first_person' ? '1st person' : cat.perspective === 'character' ? 'character' : '3rd person'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── GCP Account selector ── */}
      {credentials.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">GCP Account (Veo Credits)</p>
          <div className="flex gap-2 flex-wrap">
            {credentials.map(cred => (
              <button key={cred.id} onClick={() => setSelectedCred(cred.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all
                  ${selectedCred === cred.id ? 'border-[#111111] bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {cred.name}
                <span className={`text-xs font-mono ${selectedCred === cred.id ? 'text-gray-400' : 'text-gray-400'}`}>
                  {cred.project_id.slice(0, 12)}...
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Stats ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Generated', value: statsTotal, color: 'bg-gray-50 text-gray-700', accent: 'text-gray-900' },
          { label: 'This Week',       value: statsThisWeek, color: 'bg-indigo-50 text-indigo-700', accent: 'text-indigo-900' },
          { label: 'Ready to Edit',  value: statsReady,   color: 'bg-emerald-50 text-emerald-700', accent: 'text-emerald-900' },
          { label: 'Published',      value: statsPublished, color: 'bg-purple-50 text-purple-700', accent: 'text-purple-900' },
        ].map(s => (
          <div key={s.label} className={`${s.color} rounded-2xl p-3 text-center`}>
            <div className={`text-2xl font-bold ${s.accent}`}>{s.value}</div>
            <div className="text-xs opacity-70 mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Active Run ── */}
      {activeRun && (
        <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden
          ${activeRun.status === 'failed' ? 'border-red-200' : activeRun.status === 'complete' ? 'border-emerald-200' : 'border-indigo-200'}`}>

          {/* Header */}
          <div className={`px-4 py-3 border-b flex items-center justify-between gap-3
            ${activeRun.status === 'failed' ? 'bg-red-50 border-red-100' : activeRun.status === 'complete' ? 'bg-emerald-50 border-emerald-100' : 'bg-indigo-50 border-indigo-100'}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-2xl shrink-0">{STEP_LABELS[activeRun.status]?.emoji || '⏳'}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{STEP_LABELS[activeRun.status]?.label || activeRun.status}</p>
                {activeRun.topic && <p className="text-xs text-gray-500 truncate">{activeRun.topic}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-mono text-gray-400">{activeRun.story_id.slice(-8)}</p>
              <p className="text-xs text-gray-400">{new Date(activeRun.updated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          {/* Step pipeline */}
          <div className="px-4 py-3">
            <div className="flex gap-1.5">
              {STEPS.filter(s => s !== 'init').map(step => {
                const stepIdx = STEPS.indexOf(step)
                const done = currentStepIdx > stepIdx || activeRun.status === 'complete'
                const active = currentStepIdx === stepIdx
                const info = STEP_LABELS[step]
                return (
                  <div key={step} className="flex-1 flex flex-col items-center gap-1.5" title={info?.label}>
                    <div className={`w-full h-2 rounded-full transition-all duration-500
                      ${done ? 'bg-indigo-500' : active ? 'bg-indigo-300 animate-pulse' : 'bg-gray-200'}`} />
                    <span className="text-gray-400 leading-none" style={{ fontSize: '10px' }}>{info?.emoji}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Clip grid */}
          {(totalOps > 0 || activeRun.status === 'veo_poll') && (
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-gray-500 font-medium">Video Clips</span>
                <span className="text-gray-500">
                  <span className="text-emerald-600 font-semibold">{doneClips}</span>
                  /{totalOps || '?'} done
                  {filteredCount > 0 && <span className="text-red-500 ml-1">· {filteredCount} filtered</span>}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {totalOps > 0 ? Array.from({ length: totalOps }, (_, i) => {
                  const num = String(i + 1).padStart(2, '0')
                  const isDone = activeRun.completed_clips?.includes(num)
                  const isFiltered = activeRun.filtered_clips?.includes(num)
                  return (
                    <div key={num} title={`Scene ${num}`}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold transition-all
                        ${isDone ? 'bg-emerald-100 text-emerald-700 shadow-sm' : isFiltered ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-300 animate-pulse'}`}>
                      {isDone ? '✓' : isFiltered ? '✕' : num}
                    </div>
                  )
                }) : <span className="text-xs text-gray-400 italic">Waiting for Veo submissions...</span>}
              </div>
            </div>
          )}

          {/* Error */}
          {activeRun.status === 'failed' && activeRun.error && (
            <div className="mx-4 mb-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-xs font-semibold text-red-700 mb-0.5">Error</p>
              <p className="text-xs text-red-600">{activeRun.error}</p>
            </div>
          )}

          {/* Log accordion */}
          <div className="border-t border-gray-100">
            <button onClick={() => setExpandedLog(e => !e)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-gray-400 hover:bg-gray-50 transition-colors">
              <span>🪵 Pipeline Log <span className="text-gray-300">({activeRun.log?.length || 0} lines)</span></span>
              <span className="text-gray-300">{expandedLog ? '▲' : '▼'}</span>
            </button>
            {expandedLog && (
              <div className="bg-gray-950 px-4 py-3 max-h-56 overflow-y-auto">
                <div className="font-mono text-xs space-y-0.5">
                  {(activeRun.log || []).slice(-40).map((line, i) => (
                    <p key={i} className={`leading-relaxed ${
                      line.includes('ERROR') ? 'text-red-400' :
                      line.includes('✓') || line.includes('complete') ? 'text-emerald-400' :
                      line.includes('Submitting') || line.includes('Polling') ? 'text-blue-400' :
                      'text-gray-400'}`}>
                      <span className="text-gray-600 mr-2">{line.match(/T(\d{2}:\d{2}:\d{2})/)?.[1]}</span>
                      {line.replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /, '')}
                    </p>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!activeRun && runs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-6xl mb-4">✨</div>
          <p className="text-sm font-semibold text-gray-600 mb-1">Ready to create</p>
          <p className="text-xs">Click "New Story" to start the AI pipeline</p>
        </div>
      )}

      {/* ── Run History ── */}
      {runs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Generation History</h3>
            <span className="text-xs text-gray-300">{runs.length} runs</span>
          </div>
          <div className="divide-y divide-gray-50">
            {runs.map(run => {
              const info = STEP_LABELS[run.status]
              const isSelected = expandedRun === run.story_id
              const ops = Object.keys(typeof run.operation_ids === 'object' ? run.operation_ids : {}).length
              const done = Array.isArray(run.completed_clips) ? run.completed_clips.length : 0
              return (
                <div key={run.story_id}>
                  <button onClick={() => {
                    setExpandedRun(isSelected ? null : run.story_id)
                    if (!isSelected && !activeRun) fetchRunDetail(run.story_id)
                  }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{info?.emoji || '⏳'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 font-medium truncate">{run.topic || run.story_id}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{new Date(run.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                          {ops > 0 && <span className="text-xs text-gray-300">· {done}/{ops} clips</span>}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {run.status === 'complete' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">✅ Done</span>
                        ) : run.status === 'failed' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">❌ Failed</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium animate-pulse">{info?.label}</span>
                        )}
                      </div>
                      <span className="text-gray-300 text-xs">{isSelected ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {isSelected && activeRun?.story_id === run.story_id && (
                    <div className="px-4 pb-3 bg-gray-50 border-t border-gray-100">
                      {/* Compact clip grid for history */}
                      {ops > 0 && (
                        <div className="flex gap-1 flex-wrap pt-3">
                          {Array.from({ length: ops }, (_, i) => {
                            const num = String(i + 1).padStart(2, '0')
                            const isDone = activeRun.completed_clips?.includes(num)
                            const isFiltered = activeRun.filtered_clips?.includes(num)
                            return (
                              <div key={num}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold
                                  ${isDone ? 'bg-emerald-100 text-emerald-700' : isFiltered ? 'bg-red-100 text-red-400' : 'bg-gray-200 text-gray-400'}`}>
                                {isDone ? '✓' : isFiltered ? '✕' : num}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {activeRun.error && (
                        <p className="text-xs text-red-600 mt-2 bg-red-50 px-2 py-1 rounded-lg">{activeRun.error}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Story Detail ──────────────────────────────────────────────────────────────

function StoryDetail({ story, onDelete, onUpdate }: { story: Story; onDelete: () => void; onUpdate: (s: Story) => void }) {
  const [clips, setClips] = useState(story.clips)
  const [storyTab, setStoryTab] = useState<'clips' | 'publish' | 'history'>('clips')
  const [selectedClip, setSelectedClip] = useState<{ url: string; name: string } | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingClip, setDeletingClip] = useState('')
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; message: string; action: () => void }>({ open: false, title: '', message: '', action: () => {} })

  const refreshStory = async () => {
    const res = await fetch(`/api/stories/${story.story_id}`)
    if (res.ok) {
      const data = await res.json()
      if (data.story) { setClips(data.story.clips || []); onUpdate(data.story) }
    }
  }

  const downloadZip = async () => {
    setDownloading(true)
    const res = await fetch(`/api/stories/${story.story_id}/download`)
    if (!res.ok) { setDownloading(false); return }
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${story.story_id}.zip`; a.click()
    setDownloading(false)
  }

  const deleteStory = () => {
    setConfirm({ open: true, title: 'Delete Story?', message: 'This will permanently delete all clips, audio, and files. This cannot be undone.', action: async () => {
      setDeleting(true)
    const res = await fetch(`/api/stories/${story.story_id}`, { method: 'DELETE' })
    if (res.ok) { onDelete() } else {
      const d = await res.json(); alert(`Delete failed: ${d.error}`)
      setDeleting(false)
    }
    }})
  }

  const deleteClip = (clipName: string, clipUrl: string) => {
    setConfirm({ open: true, title: 'Delete Clip?', message: `Delete scene_${clipName.match(/scene_(\d+)/)?.[1]}.mp4 from cloud storage?`, action: async () => {
      setDeletingClip(clipName)
      const res = await fetch(`/api/stories/${story.story_id}/clip?path=${encodeURIComponent(clipName)}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        const remaining = data.remainingClips || clips.filter(c => c.name !== clipName)
        setClips(remaining)
        onUpdate({ ...story, clips: remaining, scenes_count: String(remaining.length) })
        if (selectedClip?.url === clipUrl) { setSelectedClip(null); setIsPlaying(false) }
      }
      setDeletingClip('')
    }})
  }

  const selectClip = (clip: { url: string; name: string }) => {
    if (selectedClip?.url === clip.url) { setIsPlaying(true) }
    else { setSelectedClip(clip); setIsPlaying(false) }
  }

  const sc = STATUS_COLORS[story.status] || STATUS_COLORS.failed
  const selectedNum = selectedClip?.name.match(/scene_(\d+)/)?.[1]

  return (
    <div className="h-full flex flex-col bg-[#F5F5F7]">
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onConfirm={() => { setConfirm(c => ({...c, open: false})); confirm.action() }}
        onCancel={() => setConfirm(c => ({...c, open: false}))}
      />

      {/* ── Story Header ─────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        {/* Title row */}
        <div className="px-5 pt-4 pb-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${sc.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.bar}`} />
                {sc.text}
              </span>
              {story.theme && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">{story.theme}</span>}
              {story.youtube_link && (
                <a href={story.youtube_link} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full hover:bg-red-100">
                  ▶ Live
                </a>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{story.topic}</p>
            {story.notes && <p className="text-xs text-amber-600 mt-0.5">⚠ {story.notes}</p>}
          </div>
          <button onClick={refreshStory} title="Refresh"
            className="shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Next-action callout */}
        {NEXT_ACTION[story.status] && (
          <div className={`mx-5 mb-3 rounded-xl border p-3 ${NEXT_ACTION[story.status].bg}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{NEXT_ACTION[story.status].title}</p>
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{NEXT_ACTION[story.status].body}</p>
              </div>
              {NEXT_ACTION[story.status].ctaTab === 'clips' ? (
                <button onClick={downloadZip} disabled={downloading}
                  className="shrink-0 px-3 py-1.5 bg-[#111111] hover:bg-black text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
                  {downloading ? 'Zipping...' : NEXT_ACTION[story.status].cta}
                </button>
              ) : story.status === 'published' && story.youtube_link ? (
                <a href={story.youtube_link} target="_blank" rel="noreferrer"
                  className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap">
                  ▶ Open
                </a>
              ) : (
                <button onClick={() => setStoryTab((NEXT_ACTION[story.status].ctaTab || 'clips') as typeof storyTab)}
                  className="shrink-0 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap">
                  {NEXT_ACTION[story.status].cta}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Actions row */}
        <div className="px-5 pb-3 flex items-center gap-2">
          <button onClick={downloadZip} disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#111111] hover:bg-black text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
            ⬇ {downloading ? 'Zipping...' : 'Download ZIP'}
          </button>
          <span className="text-xs text-gray-400">{clips.length} clips · <span className="font-mono">{story.story_id.slice(-6)}</span></span>
          <button onClick={deleteStory} disabled={deleting}
            className="ml-auto text-xs text-gray-400 hover:text-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
            {deleting ? '...' : '🗑'}
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex border-t border-gray-100">
          {([
            { key: 'clips',   label: 'Clips & Audio', badge: clips.length > 0 ? String(clips.length) : undefined },
            { key: 'publish', label: 'YouTube',       badge: story.youtube_link ? '✓' : undefined },
            { key: 'history', label: 'Scene History', badge: undefined },
          ] as { key: typeof storyTab; label: string; badge?: string }[]).map(t => (
            <button key={t.key} onClick={() => setStoryTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all border-b-2 ${
                storyTab === t.key
                  ? 'border-[#111111] text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t.label}
              {t.badge && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  t.badge === '✓' ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'
                }`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4">

          {/* ── CLIPS & AUDIO ── */}
          {storyTab === 'clips' && (
            <div className="space-y-3">
              {clips.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200/60 p-12 text-center">
                  <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl">🎬</div>
                  <p className="text-sm font-semibold text-gray-700">No clips yet</p>
                  <p className="text-xs text-gray-400 mt-1">Generate a story to create video clips</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl overflow-hidden border border-gray-200/60">
                  <div className="p-4 border-b border-gray-100">
                    {/* Clip grid — improved tiles */}
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-3">
                      {clips.map(clip => {
                        const num = clip.name.match(/scene_(\d+)/)?.[1] || '?'
                        const isActive = selectedClip?.url === clip.url
                        return (
                          <div key={clip.name} className="relative group">
                            <button onClick={() => selectClip(clip)}
                              className={`w-full aspect-[9/16] rounded-2xl flex flex-col items-center justify-center transition-all relative overflow-hidden
                                ${isActive
                                  ? 'bg-[#111111] shadow-lg ring-2 ring-[#111111] ring-offset-2'
                                  : 'bg-gradient-to-b from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300'
                                }`}>
                              {isActive ? (
                                <div className="flex flex-col items-center gap-1">
                                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                                    <span className="text-white text-sm ml-0.5">▶</span>
                                  </div>
                                  <span className="text-white/60 text-xs">S{num}</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-lg font-black text-gray-600">{num}</span>
                                  <span className="text-xs text-gray-400 font-medium">Scene</span>
                                </div>
                              )}
                            </button>
                            {/* Delete button — tap/hover reveal */}
                            <button
                              onClick={() => deleteClip(clip.name, clip.url)}
                              disabled={!!deletingClip}
                              className="absolute top-1 right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs items-center justify-center opacity-0 group-hover:opacity-100 md:flex hidden shadow-sm disabled:opacity-30 transition-opacity">
                              ×
                            </button>
                            {/* Mobile: long press or tap corner */}
                            {!isActive && (
                              <button
                                onClick={() => deleteClip(clip.name, clip.url)}
                                disabled={!!deletingClip}
                                className="md:hidden absolute top-1 right-1 w-5 h-5 bg-white/80 text-red-500 rounded-full text-xs items-center justify-center flex shadow-sm">
                                ×
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Player */}
                    {selectedClip ? (
                      !isPlaying ? (
                        <button onClick={() => setIsPlaying(true)}
                          className="w-full aspect-video max-h-60 bg-[#111111] rounded-xl flex items-center justify-center group relative overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                          <div className="relative z-10 text-center">
                            <div className="w-12 h-12 bg-white/15 rounded-full flex items-center justify-center mb-2 group-hover:bg-white/25 transition-all">
                              <span className="text-white text-lg ml-0.5">▶</span>
                            </div>
                            <p className="text-white/70 text-xs">Scene {selectedNum}</p>
                          </div>
                        </button>
                      ) : (
                        <video key={selectedClip.url} controls autoPlay
                          className="w-full max-h-60 bg-black rounded-xl"
                          src={selectedClip.url} onEnded={() => setIsPlaying(false)} />
                      )
                    ) : (
                      <div className="py-5 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl">
                        Select a scene above to preview
                      </div>
                    )}
                  </div>

                  {selectedClip && (
                    <div className="px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
                      <span className="text-xs text-gray-400 font-mono">scene_{selectedNum}.mp4</span>
                      <div className="flex gap-3">
                        {isPlaying && <button onClick={() => setIsPlaying(false)} className="text-xs text-gray-400 hover:text-gray-600">⏹</button>}
                        <a href={selectedClip.url} download className="text-xs text-gray-500 hover:text-black font-medium">⬇ Download</a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Audio */}
              {story.audio_url && (
                <div className="bg-white rounded-2xl overflow-hidden border border-gray-200/60 px-4 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-900">Hindi Narration</span>
                    <span className="text-xs text-emerald-500 font-medium">Ready ✓</span>
                  </div>
                  <audio controls className="w-full" preload="none" src={story.audio_url} />
                  <a href={story.audio_url} download className="mt-2 inline-block text-xs text-gray-400 hover:text-black">⬇ Download MP3</a>
                </div>
              )}
            </div>
          )}

          {/* ── PUBLISH ── */}
          {storyTab === 'publish' && (
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-200/60 p-4">
              <YoutubeUpload story={story} clips={clips} hasAudio={story.hasAudio} onUpdate={onUpdate} />
            </div>
          )}

          {/* ── SCENE HISTORY ── */}
          {storyTab === 'history' && (
            <SceneJobsPanel storyId={story.story_id} onClipGenerated={() => { refreshStory(); setStoryTab('clips') }} />
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Scene Jobs Panel ──────────────────────────────────────────────────────────

interface SceneJob {
  id: number; story_id: string; scene_num: string; beat: string
  video_prompt: string; tts_text: string; primary_anchor: string
  secondary_anchor: string; operation_id: string; status: string
  attempt: number; error_type: string; error_message: string
}

function SceneJobsPanel({ storyId, onClipGenerated }: { storyId: string; onClipGenerated: () => void }) {
  const [jobs, setJobs] = useState<SceneJob[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<{ key: string; value: string } | null>(null)
  const [retryCred, setRetryCred] = useState<string>('default')
  const [retryModel, setRetryModel] = useState<string>('veo-3.1-lite-generate-001')
  const [credList, setCredList] = useState<{ id: string; name: string }[]>([])
  const [fixingPrompt, setFixingPrompt] = useState<string | null>(null)

  const VEO_MODELS = [
    { id: 'veo-3.1-lite-generate-001', label: 'Veo 3.1 Lite', cost: '₹15/clip' },
    { id: 'veo-3.1-generate-001',      label: 'Veo 3.1 Full', cost: '₹100/clip' },
    { id: 'veo-3.0-generate-001',      label: 'Veo 3.0',      cost: 'Higher' },
  ]

  const load = async () => {
    setLoading(true)
    const [scenesRes, credsRes] = await Promise.all([
      fetch(`/api/stories/${storyId}/scenes`),
      fetch('/api/credentials'),
    ])
    if (scenesRes.ok) setJobs((await scenesRes.json()).scenes || [])
    if (credsRes.ok) setCredList((await credsRes.json()).credentials || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [storyId])

  const retry = async (job: SceneJob) => {
    const promptToUse = editingPrompt?.key === `${job.scene_num}-${job.attempt}` ? editingPrompt.value : job.video_prompt
    setRetrying(`${job.scene_num}-${job.attempt}`)
    const res = await fetch(`/api/stories/${storyId}/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_num: job.scene_num, video_prompt: promptToUse, credential_id: retryCred, model: retryModel }),
    })
    const data = await res.json()
    if (res.ok) { onClipGenerated(); await load() }
    else alert(`Retry failed: ${data.error}`)
    setRetrying(null); setEditingPrompt(null)
  }

  // AI fix prompt — passes anchors separately so they're never rewritten
  const fixWithAI = async (key: string, job: SceneJob, errorHint?: string) => {
    const currentPrompt = editingPrompt?.key === key ? (editingPrompt.value || job.video_prompt) : job.video_prompt
    setFixingPrompt(key)
    const res = await fetch('/api/prompt-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: currentPrompt,
        primary_anchor: job.primary_anchor,
        secondary_anchor: job.secondary_anchor,
        has_secondary: job.secondary_anchor && job.secondary_anchor.length > 10,
        issue: errorHint || job.error_message || 'content filter rejection',
      }),
    })
    const data = await res.json()
    if (res.ok && data.fixed) {
      setEditingPrompt({ key, value: data.fixed })
    } else {
      alert(`AI fix failed: ${data.error}`)
    }
    setFixingPrompt(null)
  }

  // Group by scene_num, show all attempts
  const byScene = jobs.reduce<Record<string, SceneJob[]>>((acc, j) => {
    acc[j.scene_num] = acc[j.scene_num] || []
    acc[j.scene_num].push(j)
    return acc
  }, {})

  const statusColors: Record<string, string> = {
    done: 'bg-emerald-100 text-emerald-700',
    filtered: 'bg-red-100 text-red-600',
    manual_pending: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-600',
    submitted: 'bg-blue-100 text-blue-600',
    polling: 'bg-blue-100 text-blue-600',
    pending: 'bg-gray-100 text-gray-500',
  }

  const needsRetry = jobs.filter(j => j.status === 'manual_pending' || j.status === 'filtered').length
  const latestByScene = Object.values(byScene).map(attempts => attempts.sort((a, b) => b.attempt - a.attempt)[0])
  const pendingJobs = latestByScene.filter(j => j.status === 'manual_pending' || j.status === 'filtered')

  // Retry ALL pending scenes sequentially (saves credits — uses saved prompts)
  const retryAll = async () => {
    setRetrying('all')
    for (const job of pendingJobs) {
      const res = await fetch(`/api/stories/${storyId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_num: job.scene_num, video_prompt: job.video_prompt, credential_id: retryCred, model: retryModel }),
      })
      if (res.ok) await load()
      else console.error(`Retry failed for scene ${job.scene_num}`)
    }
    setRetrying(null); onClipGenerated()
  }

  if (loading) return (
    <div className="py-12 text-center text-gray-400 text-sm animate-pulse">Loading scene history...</div>
  )

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-700">{Object.keys(byScene).length} scenes</span>
          {needsRetry > 0 ? (
            <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">
              ⚠ {needsRetry} need retry
            </span>
          ) : jobs.length > 0 ? (
            <span className="text-xs text-emerald-500 font-medium">All scenes OK ✓</span>
          ) : null}
          <button onClick={load} className="ml-auto text-xs text-gray-400 hover:text-gray-600">↺ Refresh</button>
        </div>

        {/* Account + Model selector + retry all */}
        {needsRetry > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 space-y-2">
            {/* Account picker */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium w-14 shrink-0">Account</span>
              <div className="flex gap-1.5 flex-wrap">
                {credList.map(cred => (
                  <button key={cred.id} onClick={() => setRetryCred(cred.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${retryCred === cred.id ? 'bg-[#111111] text-white border-[#111111]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                    {cred.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Model picker */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium w-14 shrink-0">Model</span>
              <div className="flex gap-1.5 flex-wrap">
                {VEO_MODELS.map(m => (
                  <button key={m.id} onClick={() => setRetryModel(m.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${retryModel === m.id ? 'bg-[#111111] text-white border-[#111111]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                    {m.label} <span className="opacity-50">{m.cost}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={retryAll} disabled={retrying === 'all'}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#111111] hover:bg-black disabled:opacity-50 text-white rounded-xl text-xs font-semibold">
                {retrying === 'all' ? (
                  <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Retrying...</>
                ) : `↺ Retry All ${needsRetry}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/60 py-12 text-center">
          <p className="text-gray-400 text-sm">No scene data yet</p>
          <p className="text-xs text-gray-300 mt-1">Generate a story first</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-200/60 divide-y divide-gray-50">
              {latestByScene.sort((a, b) => a.scene_num.localeCompare(b.scene_num)).map(job => {
                const sc = statusColors[job.status] || 'bg-gray-100 text-gray-500'
                const allAttempts = byScene[job.scene_num] || []
                const isExpanded = expanded === job.scene_num
                const editKey = `${job.scene_num}-${job.attempt}`
                const isEditing = editingPrompt?.key === editKey
                const needsAction = job.status === 'manual_pending' || job.status === 'filtered'

                return (
                  <div key={job.scene_num}>
                    <button onClick={() => setExpanded(isExpanded ? null : job.scene_num)}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors ${needsAction ? 'bg-red-50/30' : ''}`}>
                      <span className="w-8 h-8 shrink-0 bg-gray-100 rounded-lg flex items-center justify-center text-xs font-bold text-gray-600">
                        {job.scene_num}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${sc}`}>{job.status}</span>
                          <span className="text-xs text-gray-400">{job.beat}</span>
                          {allAttempts.length > 1 && <span className="text-xs text-gray-300">attempt {job.attempt}/{allAttempts.length}</span>}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{job.tts_text}</p>
                        {job.error_message && <p className="text-xs text-red-500 truncate mt-0.5">⚠ {job.error_message}</p>}
                      </div>
                      {needsAction && (
                        <button
                          onClick={e => { e.stopPropagation(); retry(job) }}
                          disabled={retrying === editKey}
                          className="shrink-0 px-3 py-1.5 bg-[#111111] hover:bg-black text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                          {retrying === editKey ? '⏳' : '↺ Retry'}
                        </button>
                      )}
                      <span className="text-gray-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 bg-gray-50/50 border-t border-gray-100 space-y-3">
                        {/* Hindi narration */}
                        <div className="pt-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1">Hindi Narration (TTS)</p>
                          <p className="text-sm text-gray-800 bg-white rounded-xl px-3 py-2 border border-gray-200">{job.tts_text}</p>
                        </div>

                        {/* Video prompt — editable with AI fix */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-semibold text-gray-500">Video Prompt (Veo)</p>
                            <div className="flex gap-2">
                              {/* AI Fix button */}
                              <button
                                onClick={() => fixWithAI(editKey, job, job.error_message)}
                                disabled={fixingPrompt === editKey}
                                className="flex items-center gap-1 text-xs text-purple-500 hover:text-purple-700 font-medium disabled:opacity-50">
                                {fixingPrompt === editKey ? (
                                  <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> AI fixing...</>
                                ) : '✦ Fix with AI'}
                              </button>
                              <button onClick={() => setEditingPrompt(isEditing ? null : { key: editKey, value: job.video_prompt })}
                                className="text-xs text-gray-400 hover:text-gray-700">
                                {isEditing ? '✕ Cancel' : '✏️ Edit'}
                              </button>
                            </div>
                          </div>
                          {isEditing ? (
                            <textarea
                              value={editingPrompt?.value || ''}
                              onChange={e => setEditingPrompt({ key: editKey, value: e.target.value })}
                              rows={8}
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-gray-300 rounded-xl focus:outline-none focus:border-indigo-400 resize-y leading-relaxed"
                              placeholder="Edit the prompt or use ✦ Fix with AI above..."
                            />
                          ) : (
                            <p className="text-xs font-mono text-gray-600 bg-white rounded-xl px-3 py-2 border border-gray-200 leading-relaxed whitespace-pre-wrap line-clamp-4">
                              {job.video_prompt}
                            </p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => retry(job)}
                            disabled={!!retrying}
                            className="flex-1 py-2 bg-[#111111] hover:bg-black disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors">
                            {retrying === editKey ? '⏳ Generating...' : isEditing ? '↺ Retry with edited prompt' : '↺ Retry this scene'}
                          </button>
                          {job.operation_id && (
                            <button
                              onClick={() => navigator.clipboard.writeText(job.operation_id)}
                              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl text-xs">
                              Copy op ID
                            </button>
                          )}
                        </div>

                        {/* All attempts history */}
                        {allAttempts.length > 1 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">All attempts ({allAttempts.length})</p>
                            <div className="space-y-1">
                              {allAttempts.map(a => (
                                <div key={a.attempt} className="flex items-center gap-2 text-xs">
                                  <span className="text-gray-400">#{a.attempt}</span>
                                  <span className={`px-1.5 py-0.5 rounded font-medium ${statusColors[a.status] || 'bg-gray-100 text-gray-500'}`}>{a.status}</span>
                                  {a.error_message && <span className="text-red-500 truncate">{a.error_message}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
        </div>
      )}
    </div>
  )
}

// ─── YouTube Upload ────────────────────────────────────────────────────────────

function YoutubeUpload({ story, clips, hasAudio, onUpdate }: {
  story: Story; clips: Clip[]; hasAudio: boolean; onUpdate: (s: Story) => void
}) {
  const [ytLink, setYtLink] = useState(story.youtube_link || '')
  const [title, setTitle] = useState(story.topic.slice(0, 90))
  const [description, setDescription] = useState(`${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`)
  const [tags, setTags] = useState('shorts,hindi story,moral story,kathakar')

  // Step 1: GCS upload state — initialize from story.hasFinal (file may already exist in GCS)
  const [gcsUploading, setGcsUploading] = useState(false)
  const [gcsProgress, setGcsProgress] = useState(0)
  const [gcsReady, setGcsReady] = useState(!!story.hasFinal)

  // Step 2: YouTube publish state
  const [ytUploading, setYtUploading] = useState(false)

  // Schedule state
  const [scheduledPost, setScheduledPost] = useState<{ id: number; scheduled_at: string; status: string; title: string; description: string; tags: string } | null>(null)
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('23:00')
  const [schedTitle, setSchedTitle] = useState(story.topic.slice(0, 90))
  const [schedDesc, setSchedDesc] = useState(`${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`)
  const [schedTags, setSchedTags] = useState('shorts,hindi story,moral story,kathakar')
  const [scheduling, setScheduling] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaSaved, setMetaSaved] = useState(false)

  const [error, setError] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualUrl, setManualUrl] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // On mount: verify GCS file existence + load schedule
  useEffect(() => {
    // Check GCS directly (HEAD request) — handles case where hasFinal is stale
    const gcsUrl = `https://storage.googleapis.com/${process.env.NEXT_PUBLIC_GCS_BUCKET || 'ai_clip_007'}/stories/${story.story_id}/final/reel.mp4`
    fetch(gcsUrl, { method: 'HEAD' }).then(r => {
      if (r.ok && !gcsReady) setGcsReady(true)
    }).catch(() => {}) // non-fatal

    // Load schedule
    fetch('/api/schedule').then(r => r.json()).then(d => {
      const post = (d.posts || []).find((p: { story_id: string }) => p.story_id === story.story_id)
      if (post) {
        setScheduledPost(post)
        if (post.title) setSchedTitle(post.title)
        if (post.description) setSchedDesc(post.description)
        if (post.tags) setSchedTags(post.tags)
      }
    })
    setScheduleDate(new Date().toISOString().split('T')[0])
  }, [story.story_id])

  const scheduleUpload = async () => {
    if (!scheduleDate || !scheduleTime) return
    setScheduling(true); setError('')
    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00+05:30`).toISOString()
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story_id: story.story_id, platform: 'youtube',
        scheduled_at: scheduledAt,
        title: schedTitle, description: schedDesc, tags: schedTags,
      }),
    })
    const data = await res.json()
    if (res.ok) { setScheduledPost(data.post); setShowScheduler(false) }
    else setError(data.error || 'Failed to schedule')
    setScheduling(false)
  }

  const cancelSchedule = async () => {
    if (!scheduledPost || !confirm('Cancel this scheduled post?')) return
    await fetch('/api/schedule', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: scheduledPost.id }) })
    setScheduledPost(null)
  }

  const saveMeta = async () => {
    if (!scheduledPost) return
    setSavingMeta(true)
    await fetch('/api/schedule', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: scheduledPost.id, title: schedTitle, description: schedDesc, tags: schedTags }),
    })
    setScheduledPost(p => p ? { ...p, title: schedTitle, description: schedDesc, tags: schedTags } : p)
    setSavingMeta(false); setMetaSaved(true); setTimeout(() => setMetaSaved(false), 2000)
  }

  const IST_PRESETS = [
    { label: '9 PM',  time: '21:00' },
    { label: '10 PM', time: '22:00' },
    { label: '11 PM', time: '23:00' },
    { label: '7 PM',  time: '19:00' },
    { label: '8 AM',  time: '08:00' },
  ]

  // ── Save manual URL ─────────────────────────────────────────────────────────
  const saveManualLink = async () => {
    if (!manualUrl.trim()) { setError('Enter a YouTube URL'); return }
    const isYT = manualUrl.includes('youtube.com') || manualUrl.includes('youtu.be')
    if (!isYT) { setError('Must be a YouTube URL (youtube.com or youtu.be)'); return }
    setSavingManual(true); setError('')
    const res = await fetch(`/api/stories/${story.story_id}/youtube-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: manualUrl.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setYtLink(data.youtube_link)
      setManualUrl(''); setShowManual(false)
      onUpdate({ ...story, youtube_link: data.youtube_link, status: 'published' })
    } else {
      setError(data.error || 'Failed to save')
    }
    setSavingManual(false)
  }

  // ── Delete link ─────────────────────────────────────────────────────────────
  const deleteLink = async () => {
    if (!confirm('Remove YouTube link? This will set status back to clips_ready.')) return
    setDeleting(true)
    const res = await fetch(`/api/stories/${story.story_id}/youtube-link`, { method: 'DELETE' })
    if (res.ok) {
      setYtLink('')
      onUpdate({ ...story, youtube_link: '', status: 'clips_ready' })
    }
    setDeleting(false)
  }

  // ── Step 1: Upload to GCS — tries signed URL first, falls back to chunked ──────
  const uploadToGcs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    if (!file.type.includes('video') && !file.name.endsWith('.mp4')) { setError('Only MP4 files supported'); return }
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > 1024) { setError(`File too large: ${sizeMB.toFixed(0)}MB (max 1GB)`); return }
    setGcsUploading(true); setError(''); setGcsProgress(0); setGcsReady(false)

    // Try signed URL first (fastest, no server load)
    const presignRes = await fetch(`/api/stories/${story.story_id}/presign`).catch(() => null)
    const presignData = presignRes?.ok ? await presignRes.json() : null

    if (presignData?.signedUrl) {
      // ── Direct GCS upload via signed URL ──
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', presignData.signedUrl)
        xhr.setRequestHeader('Content-Type', 'video/mp4')
        xhr.upload.onprogress = ev => { if (ev.lengthComputable) setGcsProgress(Math.round(ev.loaded / ev.total * 100)) }
        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const confirmRes = await fetch(`/api/stories/${story.story_id}/presign`, { method: 'POST' })
            if (confirmRes.ok) { setGcsReady(true); setGcsProgress(100); onUpdate({ ...story, status: 'post_produced' }) }
            else { const d = await confirmRes.json(); setError(d.error || 'Verify failed') }
          } else {
            // CORS blocked or other error — fallback to chunked
            setError('') // clear error, falling back to chunked
            await uploadChunked(file)
          }
          setGcsUploading(false); resolve()
        }
        xhr.onerror = async () => { await uploadChunked(file); setGcsUploading(false); resolve() }
        xhr.timeout = 20 * 60 * 1000
        xhr.ontimeout = () => { setError('Upload timed out — try again'); setGcsUploading(false); resolve() }
        xhr.send(file)
      })
    } else {
      // ── Chunked upload (always works, 8MB chunks under Next.js 10MB limit) ──
      await uploadChunked(file)
      setGcsUploading(false)
    }
  }

  const uploadChunked = async (file: File) => {
    const CHUNK = 8 * 1024 * 1024 // 8MB — safely under Next.js 10MB limit
    const total = Math.ceil(file.size / CHUNK)
    setError('')

    for (let i = 0; i < total; i++) {
      const chunk = file.slice(i * CHUNK, (i + 1) * CHUNK)
      setGcsProgress(Math.round((i / total) * 95)) // 0-95% during upload

      const res = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/stories/${story.story_id}/upload-chunk`)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('X-Chunk-Index', String(i))
        xhr.setRequestHeader('X-Total-Chunks', String(total))
        xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }))
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.timeout = 60_000
        xhr.ontimeout = () => reject(new Error('Chunk timed out'))
        xhr.send(chunk)
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Chunk ${i + 1}/${total} failed`)
        return
      }
    }

    setGcsProgress(100); setGcsReady(true)
    onUpdate({ ...story, status: 'post_produced' })
  }

  // ── Step 2: Publish to YouTube (server reads from GCS, no client body) ────────
  const publishToYoutube = async () => {
    setYtUploading(true); setError('')
    try {
      const res = await fetch(`/api/stories/${story.story_id}/publish-youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, tags: tags.split(',').map(t => t.trim()).filter(Boolean) }),
      })
      const data = await res.json()
      if (res.ok && data.youtubeUrl) {
        setYtLink(data.youtubeUrl)
        onUpdate({ ...story, youtube_link: data.youtubeUrl, status: 'published' })
      } else {
        setError(data.error || `YouTube upload failed (HTTP ${res.status})`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setYtUploading(false)
  }

  const missingClips = clips.length === 0

  // ── Published state ─────────────────────────────────────────────────────────
  if (ytLink) return (
    <div className="space-y-3">
      {/* Published card */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <div className="flex items-start gap-2 mb-2">
          <span className="text-lg shrink-0">✅</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-800">Published on YouTube</p>
            <a href={ytLink} target="_blank" rel="noreferrer"
              className="text-xs text-emerald-700 hover:underline break-all mt-0.5 block">{ytLink}</a>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <a href={ytLink} target="_blank" rel="noreferrer"
            className="flex-1 text-center py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors">
            ▶ Open on YouTube
          </a>
          <button onClick={deleteLink} disabled={deleting}
            className="px-3 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-500 rounded-xl text-xs font-medium transition-colors disabled:opacity-50">
            {deleting ? '...' : '🗑 Remove'}
          </button>
        </div>
      </div>

      {/* Edit URL inline */}
      {showManual ? (
        <div className="space-y-2">
          <input value={manualUrl} onChange={e => setManualUrl(e.target.value)}
            placeholder="Paste new YouTube URL to replace"
            className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={saveManualLink} disabled={savingManual}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
              {savingManual ? 'Saving...' : '✓ Update URL'}
            </button>
            <button onClick={() => { setShowManual(false); setError('') }}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowManual(true)}
          className="w-full py-2 text-xs text-gray-400 hover:text-indigo-500 transition-colors">
          ✏️ Change URL
        </button>
      )}
    </div>
  )

  // ── Upload state ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Checklist */}
      <div className="space-y-1.5">
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${!missingClips ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <span>{!missingClips ? '✅' : '⚠️'}</span>
          <span>{!missingClips ? `${clips.length} raw clips in GCS` : 'No clips yet — generate first'}</span>
        </div>
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${hasAudio ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-400'}`}>
          <span>{hasAudio ? '✅' : 'ℹ️'}</span>
          <span>{hasAudio ? 'Hindi narration audio ready' : 'No narration audio yet'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-blue-50 text-blue-600">
          <span>ℹ️</span>
          <span>Edit in CapCut/DaVinci → Export MP4 → Upload below → Directly to YouTube</span>
        </div>
      </div>

      {/* Title / Desc / Tags */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-gray-500 font-medium">Title</label>
          <span className={`text-xs ${title.length > 90 ? 'text-red-500' : 'text-gray-400'}`}>{title.length}/100</span>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
          className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors" />
      </div>
      <div>
        <label className="text-xs text-gray-500 font-medium block mb-1">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          className="w-full px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors resize-none" />
      </div>
      <div>
        <label className="text-xs text-gray-500 font-medium block mb-1">Tags</label>
        <input value={tags} onChange={e => setTags(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors" />
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
          <span className="shrink-0">❌</span><span>{error}</span>
        </div>
      )}

      {/* ── STEP 1: Upload to GCS ── */}
      <div className={`rounded-xl border p-3 transition-all ${gcsReady ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">{gcsReady ? '✅' : '1️⃣'}</span>
            <p className="text-xs font-semibold text-gray-700">
              {gcsReady ? 'Final video in cloud ✓' : 'Step 1: Upload edited video to cloud'}
            </p>
          </div>
          {gcsReady && !gcsUploading && (
            <a href={`https://storage.googleapis.com/${process.env.NEXT_PUBLIC_GCS_BUCKET || 'ai_clip_007'}/stories/${story.story_id}/final/reel.mp4`}
              target="_blank" rel="noreferrer"
              className="text-xs text-emerald-600 hover:underline shrink-0">↗ View</a>
          )}
        </div>
        {gcsUploading ? (
          <div>
            <div className="flex justify-between text-xs text-indigo-600 mb-1">
              <span>{gcsProgress < 100 ? `Uploading... ${gcsProgress}%` : 'Saving...'}</span>
              <span>{gcsProgress}%</span>
            </div>
            <div className="w-full bg-indigo-100 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${gcsProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">Do not close this tab</p>
          </div>
        ) : gcsReady ? (
          <label className="block text-center py-1.5 text-xs text-emerald-600 hover:text-emerald-800 cursor-pointer transition-colors border border-dashed border-emerald-200 rounded-lg hover:border-emerald-400">
            🔄 Replace with different file
            <input type="file" accept="video/mp4,video/*" className="hidden" onChange={uploadToGcs} />
          </label>
        ) : (
          <label className="block w-full text-center py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors">
            📤 Select & Upload MP4 to Cloud
            <input type="file" accept="video/mp4,video/*" className="hidden" onChange={uploadToGcs} />
          </label>
        )}
      </div>

      {/* ── STEP 2: YouTube Details + Publish / Schedule ── */}
      <div className={`rounded-2xl border transition-all overflow-hidden ${!gcsReady ? 'opacity-40 pointer-events-none border-gray-100' : 'border-gray-200'}`}>
        {/* Header */}
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <span className="text-red-600 text-lg">▶</span>
          <div>
            <p className="text-sm font-semibold text-gray-800">Step 2: YouTube Shorts</p>
            {!gcsReady && <p className="text-xs text-gray-400">Complete step 1 first</p>}
          </div>
          {scheduledPost?.status === 'pending' && (
            <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              ⏰ Scheduled
            </span>
          )}
          {scheduledPost?.status === 'posted' && (
            <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
              ✅ Published
            </span>
          )}
        </div>

        {ytUploading ? (
          <div className="p-6 text-center">
            <svg className="animate-spin w-8 h-8 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p className="text-sm font-medium text-gray-700">Uploading to YouTube...</p>
            <p className="text-xs text-gray-400 mt-1">This may take 2-5 minutes</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Video metadata editor — always visible, saved to DB */}
            <div className="space-y-3">
              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-600">Title</label>
                  <span className={`text-xs font-mono ${schedTitle.length > 90 ? 'text-red-500' : 'text-gray-300'}`}>
                    {schedTitle.length}/100
                  </span>
                </div>
                <input
                  value={schedTitle}
                  onChange={e => setSchedTitle(e.target.value)}
                  maxLength={100}
                  placeholder="YouTube video title..."
                  className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Description</label>
                <textarea
                  value={schedDesc}
                  onChange={e => setSchedDesc(e.target.value)}
                  rows={4}
                  placeholder="Video description..."
                  className="w-full px-3 py-2.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors resize-none leading-relaxed"
                />
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-600">Tags</label>
                  <span className="text-xs text-gray-300">{schedTags.split(',').filter(Boolean).length} tags</span>
                </div>
                <input
                  value={schedTags}
                  onChange={e => setSchedTags(e.target.value)}
                  placeholder="shorts, hindi story, moral story, kathakar"
                  className="w-full px-3 py-2.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors"
                />
                <p className="text-xs text-gray-400 mt-1">Comma separated</p>
              </div>
            </div>

            {error && (
              <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
                <span className="shrink-0">❌</span><span>{error}</span>
              </div>
            )}

            {/* ── If scheduled → show details + save + cancel ── */}
            {scheduledPost?.status === 'pending' ? (
              <div className="space-y-3">
                {/* Scheduled time card */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">⏰</span>
                      <div>
                        <p className="text-xs font-bold text-amber-800">Scheduled Upload</p>
                        <p className="text-sm font-semibold text-amber-900">
                          {new Date(scheduledPost.scheduled_at).toLocaleString('en-IN', {
                            weekday: 'long', day: 'numeric', month: 'short',
                            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                          })} IST
                        </p>
                      </div>
                    </div>
                    <button onClick={cancelSchedule} className="text-xs text-red-500 hover:text-red-700 font-medium border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Save updated metadata */}
                <button onClick={saveMeta} disabled={savingMeta}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all ${metaSaved ? 'bg-emerald-500 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50'}`}>
                  {savingMeta ? '⏳ Saving...' : metaSaved ? '✅ Details Saved!' : '💾 Update Title & Description'}
                </button>
                <p className="text-xs text-gray-400 text-center">Auto-uploads at scheduled time using saved details above</p>
              </div>

            ) : scheduledPost?.status === 'posted' ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-lg mb-1">✅</p>
                <p className="text-sm font-semibold text-emerald-800">Auto-published successfully!</p>
              </div>

            ) : (
              /* No schedule yet — show Publish Now + Schedule buttons */
              <div className="space-y-2">
                <button onClick={publishToYoutube}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
                  <span>▶</span> Publish Now
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium">or schedule</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                {!showScheduler ? (
                  <button onClick={() => setShowScheduler(true)}
                    className="w-full py-2.5 bg-white hover:bg-gray-50 border-2 border-dashed border-gray-200 hover:border-amber-300 text-gray-500 hover:text-amber-600 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2">
                    ⏰ Schedule for Later (IST)
                  </button>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-amber-900">📅 Set Schedule</p>
                      <button onClick={() => { setShowScheduler(false); setError('') }}
                        className="text-xs text-gray-400 hover:text-gray-600">✕ Close</button>
                    </div>

                    {/* IST quick presets */}
                    <div>
                      <p className="text-xs text-amber-700 mb-2 font-medium">Quick select (IST):</p>
                      <div className="flex gap-2 flex-wrap">
                        {IST_PRESETS.map(p => (
                          <button key={p.time} onClick={() => setScheduleTime(p.time)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                              scheduleTime === p.time
                                ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                                : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50'
                            }`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs font-medium text-amber-800 mb-1">Date</p>
                        <input type="date" value={scheduleDate}
                          onChange={e => setScheduleDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full px-3 py-2 text-sm bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-amber-800 mb-1">Time (IST)</p>
                        <input type="time" value={scheduleTime}
                          onChange={e => setScheduleTime(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                    </div>

                    {/* Preview */}
                    {scheduleDate && scheduleTime && (
                      <div className="bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-xs text-gray-500 mb-0.5">Will upload at:</p>
                        <p className="text-sm font-bold text-gray-800">
                          {new Date(`${scheduleDate}T${scheduleTime}:00+05:30`).toLocaleString('en-IN', {
                            weekday: 'long', day: 'numeric', month: 'long',
                            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                          })} IST
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-amber-600 text-center">Title, description & tags above will be used at upload time</p>

                    <button onClick={scheduleUpload} disabled={scheduling || !scheduleDate || !scheduleTime}
                      className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2">
                      {scheduling ? (
                        <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Scheduling...</>
                      ) : '⏰ Confirm Schedule'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual URL option */}
      {!showManual ? (
        <button onClick={() => { setShowManual(true); setError('') }}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors border border-dashed border-gray-200 rounded-xl">
          📎 Already uploaded to YouTube? Paste URL manually
        </button>
      ) : (
        <div className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
          <label className="text-xs text-gray-600 font-medium block">Paste YouTube Short URL</label>
          <input value={manualUrl} onChange={e => { setManualUrl(e.target.value); setError('') }}
            placeholder="https://youtube.com/shorts/..."
            onKeyDown={e => e.key === 'Enter' && saveManualLink()}
            className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-emerald-400" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={saveManualLink} disabled={savingManual || !manualUrl.trim()}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors">
              {savingManual ? '...' : '✓ Save Link'}
            </button>
            <button onClick={() => { setShowManual(false); setManualUrl(''); setError('') }}
              className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-xl text-xs transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Settings View ─────────────────────────────────────────────────────────────

function SettingsView() {
  const [sub, setSub] = useState<'channels' | 'categories' | 'credentials' | 'prompts' | 'schedule'>('channels')

  const TABS = [
    { key: 'channels',    label: '📺 Channels' },
    { key: 'categories',  label: '🎬 Content' },
    { key: 'credentials', label: '🔑 GCP' },
    { key: 'prompts',     label: '🎯 Prompts' },
    { key: 'schedule',    label: '📅 Schedule' },
  ] as const

  return (
    <div className="max-w-3xl mx-auto w-full pb-8 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">⚙️ Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Channels, content types, GCP accounts, AI prompts, scheduling</p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key as typeof sub)}
            className={`flex-1 min-w-fit py-2 px-3 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${sub === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'channels'    && <ChannelsSettings />}
      {sub === 'categories'  && <CategoriesSettings />}
      {sub === 'credentials' && <CredentialsSettings />}
      {sub === 'prompts'     && <PromptsSettings />}
      {sub === 'schedule'    && <ScheduleSettings />}
    </div>
  )
}

// ── Channels Settings ────────────────────────────────────────────────────────

function ChannelsSettings() {
  const [channels, setChannels] = useState<(Channel & { yt_refresh_token?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', emoji: '📺', sheet_id: '', sheet_tab: 'Sheet2', gcs_bucket: 'ai_clip_007' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const d = await fetch('/api/channels').then(r => r.json())
    setChannels(d.channels || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!form.id || !form.name || !form.sheet_id || !form.gcs_bucket) { setError('id, name, sheet_id, bucket required'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    await load(); setShowForm(false); setSaving(false)
    setForm({ id: '', name: '', emoji: '📺', sheet_id: '', sheet_tab: 'Sheet2', gcs_bucket: 'ai_clip_007' })
  }

  const deleteChannel = async (id: string, name: string) => {
    if (!confirm(`Deactivate channel "${name}"? Its stories stay but no longer sync.`)) return
    await fetch(`/api/channels/${id}`, { method: 'DELETE' })
    load()
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">YouTube channels managed by this dashboard. Each has its own OAuth + assets.</p>
        <button onClick={() => setShowForm(s => !s)}
          className="px-3 py-1.5 bg-[#111111] hover:bg-black text-white rounded-xl text-xs font-semibold whitespace-nowrap">
          + Add Channel
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">New Channel</p>
            <button onClick={() => { setShowForm(false); setError('') }}
              className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-gray-500 mb-1">ID *</p>
              <input value={form.id} onChange={e => setForm(f => ({...f, id: e.target.value.toLowerCase().replace(/\s+/g, '_')}))}
                placeholder="kissopedia"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Name *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder="Kissopedia"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Emoji</p>
              <input value={form.emoji} onChange={e => setForm(f => ({...f, emoji: e.target.value}))}
                placeholder="📺" maxLength={4}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 text-center" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-500 mb-1">Sheet ID *</p>
              <input value={form.sheet_id} onChange={e => setForm(f => ({...f, sheet_id: e.target.value}))}
                placeholder="1ABC...xyz"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">GCS Bucket *</p>
              <input value={form.gcs_bucket} onChange={e => setForm(f => ({...f, gcs_bucket: e.target.value}))}
                placeholder="ai_clip_007"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-600">
            ℹ After creating, click <strong>"Connect YouTube"</strong> on the channel card to OAuth its YT account.
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-[#111111] hover:bg-black disabled:opacity-40 text-white rounded-xl text-xs font-semibold">
            {saving ? 'Creating...' : '+ Create Channel'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {channels.length === 0 && !showForm && (
          <div className="text-center py-8 text-gray-400 text-sm">No channels yet. Click "+ Add Channel" to create one.</div>
        )}
        {channels.map(ch => {
          const ytConnected = !!ch.yt_refresh_token
          return (
            <div key={ch.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-xl shrink-0">
                {ch.emoji || '📺'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800">{ch.name}</p>
                  <span className="text-xs font-mono text-gray-400">{ch.id}</span>
                  {ytConnected ? (
                    <span className="text-xs px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-medium">✓ YT connected</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-medium">⚠ YT not connected</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  Bucket: <span className="font-mono">{ch.gcs_bucket}</span>
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <a href={`/api/auth/youtube?channelId=${ch.id}`}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${ytConnected ? 'bg-gray-50 hover:bg-gray-100 text-gray-600' : 'bg-red-50 hover:bg-red-100 text-red-700'}`}>
                  {ytConnected ? '↻ Re-OAuth' : 'Connect YT →'}
                </a>
                <button onClick={() => deleteChannel(ch.id, ch.name)}
                  className="text-xs text-gray-400 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Categories Settings ──────────────────────────────────────────────────────

function CategoriesSettings() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ id: '', name: '', emoji: '🎬', description: '', perspective: 'third_person', scene_count_min: 8, scene_count_max: 10, is_default: false })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const d = await fetch('/api/categories').then(r => r.json())
    setCategories(d.categories || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true)
    await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    await load(); setShowForm(false); setSaving(false)
    setForm({ id: '', name: '', emoji: '🎬', description: '', perspective: 'third_person', scene_count_min: 8, scene_count_max: 10, is_default: false })
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">Content types with their own prompts, perspective, and Veo style.</p>
        <button onClick={() => setShowForm(s => !s)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold">
          + New Type
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-indigo-800">New Content Type</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.emoji} onChange={e => setForm(f => ({...f, emoji: e.target.value}))} placeholder="Emoji" maxLength={4}
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 col-span-1" />
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Name *"
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400" />
          </div>
          <input value={form.id} onChange={e => setForm(f => ({...f, id: e.target.value}))} placeholder="ID (snake_case) *"
            className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
          <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Description"
            rows={2} className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 resize-none" />
          <div className="grid grid-cols-3 gap-2">
            <select value={form.perspective} onChange={e => setForm(f => ({...f, perspective: e.target.value}))}
              className="px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none col-span-1">
              <option value="third_person">3rd Person</option>
              <option value="first_person">1st Person</option>
              <option value="character">Character POV</option>
            </select>
            <input type="number" value={form.scene_count_min} onChange={e => setForm(f => ({...f, scene_count_min: +e.target.value}))} placeholder="Min scenes"
              className="px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none" />
            <input type="number" value={form.scene_count_max} onChange={e => setForm(f => ({...f, scene_count_max: +e.target.value}))} placeholder="Max scenes"
              className="px-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none" />
          </div>
          <p className="text-xs text-gray-400">💡 Leave prompts empty to use global defaults from Prompts tab. You can edit category-specific prompts after saving.</p>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.id || !form.name}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold">
              {saving ? 'Saving...' : 'Create Content Type'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Category cards */}
      <div className="grid grid-cols-2 gap-3">
        {categories.map(cat => (
          <div key={cat.id} className={`bg-white rounded-2xl border p-4 ${cat.is_default ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-100'}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{cat.emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{cat.name}</p>
                  {cat.is_default && <span className="text-xs text-indigo-600 font-medium">Default</span>}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2 line-clamp-2">{cat.description}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                cat.perspective === 'first_person' ? 'bg-purple-50 text-purple-600' :
                cat.perspective === 'character' ? 'bg-orange-50 text-orange-600' :
                'bg-gray-50 text-gray-500'}`}>
                {cat.perspective === 'first_person' ? '1st person' : cat.perspective === 'character' ? 'character' : '3rd person'}
              </span>
              <span className="text-xs text-gray-400">{cat.scene_count_min}–{cat.scene_count_max} scenes</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Credentials Settings ─────────────────────────────────────────────────────

const DEFAULT_BUCKET = 'ai_clip_007'

function CredentialsSettings() {
  const [creds, setCreds] = useState<{ id: string; name: string; project_id: string; bucket: string; is_active: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [form, setForm] = useState({ id: '', name: '', project_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const d = await fetch('/api/credentials').then(r => r.json())
    setCreds(d.credentials || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Auto-extract project_id when JSON is pasted
  const handleJsonChange = (text: string) => {
    setJsonText(text); setError('')
    try {
      const parsed = JSON.parse(text)
      setForm(f => ({
        ...f,
        project_id: parsed.project_id || f.project_id,
        id: f.id || `account_${(parsed.project_id || '').slice(0, 8)}`,
        name: f.name || parsed.project_id || '',
      }))
    } catch { /* not valid JSON yet, ignore */ }
  }

  const save = async () => {
    if (!jsonText.trim()) { setError('Paste the SA JSON first'); return }
    try { JSON.parse(jsonText) } catch { setError('Invalid JSON — check for missing quotes or commas'); return }
    setSaving(true); setError('')
    const payload = { ...form, bucket: DEFAULT_BUCKET, sa_json: jsonText }
    const res = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    await load(); setShowForm(false); setSaving(false)
    setForm({ id: '', name: '', project_id: '' }); setJsonText('')
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-500">Multiple GCP accounts for Veo/TTS. All use the same GCS bucket.</p>
          <p className="text-xs text-gray-400 mt-0.5">Bucket: <span className="font-mono text-gray-600">{DEFAULT_BUCKET}</span> (shared)</p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          className="px-3 py-1.5 bg-[#111111] hover:bg-black text-white rounded-xl text-xs font-semibold">
          + Add Account
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">Add GCP Account</p>
            <button onClick={() => { setShowForm(false); setError(''); setJsonText(''); setForm({ id: '', name: '', project_id: '' }) }}
              className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>

          {/* JSON paste area */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">
              Paste Service Account JSON <span className="text-gray-400">(from GCP Console → SA → Keys → JSON)</span>
            </p>
            <textarea
              value={jsonText}
              onChange={e => handleJsonChange(e.target.value)}
              placeholder={'{\n  "type": "service_account",\n  "project_id": "your-project",\n  ...\n}'}
              rows={6}
              spellCheck={false}
              className="w-full px-3 py-2.5 text-xs font-mono bg-white border border-gray-300 rounded-xl focus:outline-none focus:border-indigo-400 resize-none leading-relaxed"
            />
            {jsonText && (() => { try { JSON.parse(jsonText); return <p className="text-xs text-emerald-600 mt-1">✓ Valid JSON</p> } catch { return <p className="text-xs text-red-500 mt-1">Invalid JSON</p> } })()}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-500 mb-1">Account Name *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Account C"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Project ID (auto-filled)</p>
              <input value={form.project_id} onChange={e => setForm(f => ({...f, project_id: e.target.value}))} placeholder="level-hope-xxx"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-600">
            ℹ️ Bucket: <strong>{DEFAULT_BUCKET}</strong> — same for all accounts. Only Veo/TTS credits differ per account.
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.name || !form.project_id || !jsonText.trim()}
              className="flex-1 py-2.5 bg-[#111111] hover:bg-black disabled:opacity-40 text-white rounded-xl text-xs font-semibold">
              {saving ? 'Saving...' : '+ Add Account'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {creds.map(cred => (
          <div key={cred.id} className={`bg-white rounded-2xl border p-4 flex items-center gap-3 ${cred.id === 'default' ? 'border-emerald-200' : 'border-gray-100'}`}>
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-lg shrink-0">🔑</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-800">{cred.name}</p>
                {cred.id === 'default' && <span className="text-xs px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-medium">Active (env)</span>}
              </div>
              <p className="text-xs text-gray-400 font-mono">{cred.project_id}</p>
            </div>
            {cred.id !== 'default' && (
              <button onClick={async () => {
                if (!confirm(`Delete ${cred.name}?`)) return
                await fetch('/api/credentials', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cred.id }) })
                load()
              }} className="text-xs text-red-400 hover:text-red-600 transition-colors">Delete</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Prompts Settings ─────────────────────────────────────────────────────────

function PromptsSettings() {
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>('topic_picker')

  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(d => { setPrompts(d); setLoading(false) })
  }, [])

  const savePrompts = async () => {
    setSaving(true); setSaved(false)
    await fetch('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prompts) })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading prompts...</div>

  const PROMPT_META = [
    { key: 'topic_picker',  label: '🎯 Topic Picker',  desc: 'AI Agent 1 — picks daily story topic. Change niche, themes.' },
    { key: 'script_writer', label: '✍️ Script Writer',  desc: 'AI Agent 2 — writes full script: scenes, anchors, Veo prompts, TTS.' },
    { key: 'scene_rewrite', label: '🔄 Scene Rewrite',  desc: 'Rewrites Veo-rejected prompts to pass content filters.' },
  ] as const

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">Global default prompts. Content types can override these individually.</p>
        <div className="flex gap-2">
          <button onClick={async () => { if (!confirm('Reset to defaults?')) return; await fetch('/api/prompts', { method: 'DELETE' }); const d = await fetch('/api/prompts').then(r => r.json()); setPrompts(d) }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-xl">↺ Reset</button>
          <button onClick={savePrompts} disabled={saving}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold ${saved ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50'}`}>
            {saving ? '...' : saved ? '✓ Saved' : 'Save All'}
          </button>
        </div>
      </div>
      {PROMPT_META.map(({ key, label, desc }) => (
        <div key={key} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button onClick={() => setExpandedKey(expandedKey === key ? null : key)}
            className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-gray-50">
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-800">{label}</p>
              <p className="text-xs text-gray-400">{desc}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-gray-300">{(prompts[key] || '').length.toLocaleString()} chars</span>
              <span className="text-gray-300">{expandedKey === key ? '▲' : '▼'}</span>
            </div>
          </button>
          {expandedKey === key && (
            <div className="border-t border-gray-100">
              <textarea value={prompts[key] || ''} onChange={e => setPrompts(p => ({...p, [key]: e.target.value}))}
                rows={18} spellCheck={false}
                className="w-full px-4 py-3 text-xs font-mono bg-gray-950 text-gray-200 focus:outline-none resize-y leading-relaxed" />
              <div className="px-4 py-2 bg-gray-900 flex justify-between">
                <span className="text-xs text-gray-500 font-mono">{(prompts[key] || '').split('\n').length} lines</span>
                <button onClick={() => setPrompts(p => ({...p, [key]: ''}))} className="text-xs text-gray-600 hover:text-red-400">Clear</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Schedule Settings ────────────────────────────────────────────────────────

function ScheduleSettings() {
  const [posts, setPosts] = useState<{ id: number; story_id: string; platform: string; scheduled_at: string; status: string; result_url: string; error: string; title?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<{ processed: number; message?: string; results?: { status: string; url?: string; error?: string }[] } | null>(null)

  const loadPosts = () => {
    setLoading(true)
    fetch('/api/schedule').then(r => r.json()).then(d => { setPosts(d.posts || []); setLoading(false) })
  }

  useEffect(() => { loadPosts() }, [])

  const remove = async (id: number) => {
    setDeleting(id)
    await fetch('/api/schedule', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setPosts(p => p.filter(x => x.id !== id))
    setDeleting(null)
  }

  const runNow = async () => {
    setRunning(true); setRunResult(null)
    const res = await fetch('/api/cron/run', { method: 'POST' })
    const data = await res.json()
    setRunResult(data)
    setRunning(false)
    loadPosts() // refresh list
  }

  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    posted: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-600',
    processing: 'bg-blue-100 text-blue-600',
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading...</div>

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Scheduled Posts</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Auto-processes when Railway cron calls <code className="bg-gray-100 px-1 rounded font-mono">POST /api/cron</code>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadPosts} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs font-medium">↺</button>
          <button onClick={runNow} disabled={running}
            className="px-3 py-1.5 bg-[#111111] hover:bg-black disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5">
            {running ? (
              <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Running...</>
            ) : '▶ Run Now'}
          </button>
        </div>
      </div>

      {/* Run result */}
      {runResult && (
        <div className={`rounded-xl px-4 py-3 text-xs ${runResult.processed > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-200'}`}>
          {runResult.message ? (
            <p className="text-gray-600">{runResult.message}</p>
          ) : (
            <div>
              <p className="font-semibold text-gray-700 mb-2">Processed {runResult.processed} post(s):</p>
              {(runResult.results || []).map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${r.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {r.status}
                  </span>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline truncate">{r.url}</a>}
                  {r.error && <span className="text-red-600">{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Railway cron setup info */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs space-y-1">
        <p className="font-semibold text-amber-800">Railway Cron Setup Required</p>
        <p className="text-amber-700">Add these in Railway Dashboard → New Service → Cron Job:</p>
        <div className="bg-amber-100 rounded-lg px-3 py-2 font-mono text-amber-900 space-y-0.5">
          <p>Command: <span className="select-all">curl -X POST $&#123;RAILWAY_STATIC_URL&#125;/api/cron -H &quot;x-cron-secret: $&#123;CRON_SECRET&#125;&quot;</span></p>
          <p>Schedule: <span className="select-all">* * * * *</span></p>
        </div>
        <p className="text-amber-600">Also add <code className="bg-amber-100 px-1 rounded">CRON_SECRET</code> env var in both services with same value.</p>
      </div>

      {/* Posts list */}
      {posts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/60 py-10 text-center">
          <p className="text-3xl mb-2">📅</p>
          <p className="text-sm text-gray-500">No scheduled posts</p>
          <p className="text-xs text-gray-400 mt-1">Go to a story → YouTube tab → Schedule for Later</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/60 overflow-hidden divide-y divide-gray-50">
          {posts.map(post => (
            <div key={post.id} className="px-4 py-3.5 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                post.platform === 'youtube' ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400'
              }`}>
                {post.platform === 'youtube' ? '▶' : '📤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{post.title || post.story_id}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-400">
                    {new Date(post.scheduled_at).toLocaleString('en-IN', {
                      weekday: 'short', day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
                    })} IST
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[post.status] || 'bg-gray-100 text-gray-500'}`}>
                    {post.status}
                  </span>
                </div>
                {post.result_url && (
                  <a href={post.result_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline mt-0.5 block truncate">
                    ▶ {post.result_url}
                  </a>
                )}
                {post.error && <p className="text-xs text-red-500 mt-0.5">⚠ {post.error}</p>}
              </div>
              {post.status === 'pending' && (
                <button onClick={() => remove(post.id)} disabled={deleting === post.id}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
                  {deleting === post.id ? '...' : 'Cancel'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsView({ channelId }: { channelId?: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)
    const url = channelId ? `/api/analytics?channelId=${channelId}` : '/api/analytics'
    fetch(url)
      .then(async r => {
        const d = await r.json()
        if (!r.ok || d.error) {
          setError(d.error || `HTTP ${r.status}`)
        } else {
          setData(d)
        }
        setLoading(false)
      })
      .catch(e => { setError(`Network error: ${e.message}`); setLoading(false) })
  }, [channelId])

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return String(n || 0)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 gap-2 text-gray-400 text-sm">
      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      Loading analytics...
    </div>
  )

  if (error) {
    const needsReconnect = error.includes('expired') || error.includes('not connected') || error.includes('authorize')
    const needsApiEnable = error.includes('not enabled') || error.includes('PERMISSION_DENIED')
    return (
      <div className="max-w-md mx-auto py-12 space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-red-800 mb-1">
            {needsReconnect ? '🔗 YouTube not connected' : needsApiEnable ? '⚙️ API not enabled' : '❌ Analytics error'}
          </p>
          <p className="text-xs text-red-700">{error}</p>
        </div>
        {needsReconnect && (
          <a href="/api/auth/youtube"
            className="block w-full text-center py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors">
            ▶ Connect YouTube Account →
          </a>
        )}
        {needsApiEnable && (
          <a href="https://console.cloud.google.com/apis/library/youtubeAnalytics.googleapis.com"
            target="_blank" rel="noreferrer"
            className="block w-full text-center py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors">
            Enable YouTube Analytics API →
          </a>
        )}
      </div>
    )
  }

  if (!data) return null

  const channel = data.channel as Record<string, unknown>
  const metrics = data.metrics as Record<string, number>
  const topVideos = data.topVideos as Record<string, unknown>[]
  const analyticsError = data.analyticsError as string | null

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4 pb-6">
      {/* Channel card */}
      {channel && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
          {channel.thumbnail ? <img src={String(channel.thumbnail)} className="w-12 h-12 rounded-full object-cover" alt="" /> : (
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-xl shrink-0">▶</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm">{String(channel.name || 'YouTube Channel')}</p>
            <p className="text-xs text-gray-500">
              {fmt(Number(channel.subscribers))} subscribers · {String(channel.videoCount)} videos · {fmt(Number(channel.totalViews))} total views
            </p>
          </div>
          <a href="https://studio.youtube.com" target="_blank" rel="noreferrer"
            className="shrink-0 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-medium transition-colors">
            Studio →
          </a>
        </div>
      )}

      {/* Analytics metrics — last 28 days */}
      {analyticsError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
          ⚠️ {analyticsError}
        </div>
      ) : (
        <div>
          <p className="text-xs text-gray-400 mb-2 px-1">Last 28 days</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Views',        value: fmt(metrics.views),              color: 'bg-blue-50 text-blue-700'    },
              { label: 'Watch Time',   value: `${fmt(metrics.watchMinutes)}m`, color: 'bg-purple-50 text-purple-700' },
              { label: '+ Subscribers',value: `+${metrics.subscribersGained}`, color: 'bg-emerald-50 text-emerald-700' },
              { label: 'Likes',        value: fmt(metrics.likes),              color: 'bg-pink-50 text-pink-700'    },
              { label: 'Comments',     value: fmt(metrics.comments),           color: 'bg-amber-50 text-amber-700 col-span-2 md:col-span-1' },
            ].map(m => (
              <div key={m.label} className={`${m.color} rounded-2xl p-4 text-center`}>
                <div className="text-2xl font-bold">{m.value}</div>
                <div className="text-xs opacity-70 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent videos */}
      {topVideos?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Videos</h3>
            <span className="text-xs text-gray-400">{topVideos.length} videos</span>
          </div>
          <div className="divide-y divide-gray-50">
            {topVideos.map((v, i) => (
              <a key={String(v.videoId)} href={String(v.url)} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group">
                <span className="text-xs font-bold text-gray-300 w-5 shrink-0">{i + 1}</span>
                {v.thumbnail ? (
                  <img src={String(v.thumbnail)} className="w-12 h-8 rounded-lg object-cover shrink-0" alt="" />
                ) : (
                  <div className="w-12 h-8 rounded-lg bg-gray-100 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate group-hover:text-indigo-600 transition-colors font-medium">{String(v.title)}</p>
                  {v.publishedAt ? (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(String(v.publishedAt)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-gray-800">{fmt(Number(v.views))}</p>
                  <p className="text-xs text-gray-400">{fmt(Number(v.likes))} likes</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {topVideos?.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-4xl mb-2">📹</p>
          <p className="text-sm">No videos published yet</p>
        </div>
      )}
    </div>
  )
}
