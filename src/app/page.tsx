'use client'

import { useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Clip { name: string; url: string; size: number }
interface Story {
  story_id: string; topic: string; theme: string; status: string
  created_at: string; clips_generated_at: string; scenes_count: string
  audio_url: string; notes: string; final_url: string
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

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab] = useState<'stories' | 'generate' | 'analytics'>('stories')
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Story | null>(null)
  const [search, setSearch] = useState('')
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  const loadStories = () => {
    setLoading(true)
    fetch('/api/stories').then(r => r.json())
      .then(d => { setStories(d.stories || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { loadStories() }, [])

  const filtered = stories.filter(s =>
    !search || s.topic.toLowerCase().includes(search.toLowerCase()) || s.story_id.includes(search)
  )

  const stats = {
    total: stories.length,
    ready: stories.filter(s => s.status === 'clips_ready').length,
    published: stories.filter(s => s.status === 'published').length,
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">

      {/* ── Header ── */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        {mobileView === 'detail' && selected && tab === 'stories' ? (
          <button onClick={() => setMobileView('list')} className="md:hidden p-1.5 -ml-1 text-gray-500 hover:text-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : null}

        <div className="flex items-center gap-2 shrink-0">
          <img src="/logo_jpg.jpg" className="w-7 h-7 rounded-lg object-cover" alt="KathaKar" />
          <span className="font-bold text-gray-900 text-sm tracking-tight">KathaKar</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-0.5 bg-gray-100 rounded-lg p-1 ml-2">
          {[
            { key: 'generate',  label: '✨ Generate' },
            { key: 'stories',   label: '📚 Stories'  },
            { key: 'analytics', label: '📊 Analytics' },
          ].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key as typeof tab); setMobileView('list') }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Stats */}
        <div className="hidden md:flex gap-1.5 text-xs ml-1">
          <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full">{stats.total} total</span>
          <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">{stats.ready} ready</span>
          <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-full">{stats.published} live</span>
        </div>

        <div className="ml-auto flex gap-2">
          <a href="/api/auth/youtube" className="hidden md:flex px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors">▶ Connect YT</a>
          <button onClick={loadStories}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login' }}
            className="hidden md:block px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            Logout
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden">

        {/* Generate Tab */}
        {tab === 'generate' && (
          <div className="h-full overflow-y-auto p-4 md:p-6">
            <GenerateView onStoryReady={() => { loadStories(); setTab('stories') }} />
          </div>
        )}

        {/* Stories Tab */}
        {tab === 'stories' && (
          <div className="h-full flex">
            {/* Sidebar */}
            <aside className={`${mobileView === 'detail' ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 lg:w-80 shrink-0 bg-white md:border-r border-gray-200`}>
              <div className="p-3 border-b border-gray-100 shrink-0">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stories..."
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 transition-colors" />
              </div>
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex flex-col gap-3 p-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-xl" />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-gray-400 text-sm mb-4">No stories yet</p>
                    <button onClick={() => setTab('generate')}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      ✨ Generate First Story
                    </button>
                  </div>
                ) : filtered.map(story => {
                  const cfg = STATUS_CONFIG[story.status] || { label: story.status, dot: 'bg-gray-300', bg: 'bg-gray-50', text: 'text-gray-500' }
                  return (
                    <button key={story.story_id} onClick={() => { setSelected(story); setMobileView('detail') }}
                      className={`w-full text-left px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 active:bg-gray-100 transition-colors ${selected?.story_id === story.story_id ? 'bg-indigo-50 md:border-l-2 md:border-l-indigo-500' : ''}`}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-medium text-gray-800 leading-snug line-clamp-2 flex-1">{story.topic}</p>
                        <span className={`shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{story.clips.length || story.scenes_count || 0} clips</span>
                        {story.hasAudio && <><span>·</span><span>🎵</span></>}
                        {story.hasFinal && <><span>·</span><span>🎬</span></>}
                        <span className="ml-auto">
                          {story.created_at ? new Date(story.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                        <svg className="w-3.5 h-3.5 text-gray-300 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>

            {/* Detail */}
            <main className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1 flex-col overflow-y-auto bg-gray-50 p-4 md:p-6`}>
              {!selected ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
                  <span className="text-5xl">📚</span>
                  <p className="text-sm">Select a story from the list</p>
                  <button onClick={() => setTab('generate')}
                    className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors">
                    ✨ Generate New
                  </button>
                </div>
              ) : (
                <StoryDetail
                  key={selected.story_id}
                  story={selected}
                  onDelete={() => { setSelected(null); setMobileView('list'); setStories(s => s.filter(x => x.story_id !== selected.story_id)) }}
                  onUpdate={u => setStories(s => s.map(x => x.story_id === u.story_id ? u : x))}
                />
              )}
            </main>
          </div>
        )}

        {/* Analytics Tab */}
        {tab === 'analytics' && (
          <div className="h-full overflow-y-auto p-4 md:p-6">
            <AnalyticsView />
          </div>
        )}
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="md:hidden shrink-0 bg-white border-t border-gray-200 flex">
        {[
          { key: 'generate',  label: 'Generate',  icon: '✨' },
          { key: 'stories',   label: 'Stories',   icon: '📚' },
          { key: 'analytics', label: 'Analytics', icon: '📊' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key as typeof tab); setMobileView('list') }}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors ${tab === t.key ? 'text-indigo-600' : 'text-gray-400'}`}>
            <span className="text-lg leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

    </div>
  )
}

// ─── Generate View ─────────────────────────────────────────────────────────────

function GenerateView({ onStoryReady }: { onStoryReady: () => void }) {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [expandedLog, setExpandedLog] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const loadRuns = async () => {
    const res = await fetch('/api/pipeline')
    const data = await res.json()
    const list: PipelineRun[] = data.runs || []
    setRuns(list)
    // Find active run
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

  useEffect(() => {
    loadRuns()
    return () => stopPoll()
  }, [])

  useEffect(() => {
    if (activeRun && !['complete', 'failed'].includes(activeRun.status)) {
      startPoll(activeRun.story_id)
    }
    // Auto-scroll log
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeRun?.status, activeRun?.log?.length])

  const startGeneration = async () => {
    setStarting(true)
    const res = await fetch('/api/pipeline/run', { method: 'POST' })
    const data = await res.json()
    setStarting(false)
    await fetchRunDetail(data.story_id)
    startPoll(data.story_id)
    await loadRuns()
  }

  const isRunning = activeRun && !['complete', 'failed'].includes(activeRun.status)
  const totalOps = activeRun ? Object.keys(activeRun.operation_ids || {}).length : 0
  const doneCLips = activeRun?.completed_clips?.length ?? 0
  const filteredCount = activeRun?.filtered_clips?.length ?? 0

  const STEPS = ['init', 'topic', 'script', 'audio', 'sheet_meta', 'veo_submit', 'veo_poll', 'complete']
  const currentStepIdx = activeRun ? STEPS.indexOf(activeRun.status) : -1

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">✨ Generate Story</h1>
          <p className="text-xs text-gray-400 mt-0.5">AI pipeline: topic → script → audio → 10 video clips</p>
        </div>
        <button onClick={startGeneration} disabled={starting || !!isRunning}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm
            ${starting || isRunning
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-indigo-200'
            }`}>
          {starting ? '⏳ Starting...' : isRunning ? '🎬 Running...' : '+ New Story'}
        </button>
      </div>

      {/* Active Run Card */}
      {activeRun && (
        <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${activeRun.status === 'failed' ? 'border-red-200' : activeRun.status === 'complete' ? 'border-emerald-200' : 'border-indigo-100'}`}>

          {/* Status bar */}
          <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${activeRun.status === 'failed' ? 'bg-red-50 border-red-100' : activeRun.status === 'complete' ? 'bg-emerald-50 border-emerald-100' : 'bg-indigo-50 border-indigo-100'}`}>
            <div className="flex items-center gap-2">
              <span className="text-xl">{STEP_LABELS[activeRun.status]?.emoji || '⏳'}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">{STEP_LABELS[activeRun.status]?.label || activeRun.status}</p>
                {activeRun.topic && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{activeRun.topic}</p>}
              </div>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{activeRun.story_id.slice(-6)}</span>
          </div>

          {/* Step progress */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-1">
              {STEPS.filter(s => s !== 'init').map((step, i) => {
                const stepIdx = STEPS.indexOf(step)
                const done = currentStepIdx > stepIdx || activeRun.status === 'complete'
                const active = currentStepIdx === stepIdx
                const info = STEP_LABELS[step]
                return (
                  <div key={step} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`w-full h-1.5 rounded-full transition-all ${done ? 'bg-indigo-500' : active ? 'bg-indigo-300 animate-pulse' : 'bg-gray-200'}`} />
                    <span className="text-xs text-gray-400 hidden md:block truncate w-full text-center" style={{ fontSize: '9px' }}>
                      {info?.label.split(' ').slice(0, 2).join(' ')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Clip progress (when in veo_poll or complete) */}
          {(activeRun.status === 'veo_poll' || activeRun.status === 'complete' || totalOps > 0) && (
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>Video clips</span>
                <span className="font-medium">{doneCLips}/{totalOps || '?'} done {filteredCount > 0 ? `· ${filteredCount} filtered` : ''}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {totalOps > 0 ? (
                  Array.from({ length: totalOps }, (_, i) => {
                    const num = String(i + 1).padStart(2, '0')
                    const isDone = activeRun.completed_clips?.includes(num)
                    const isFiltered = activeRun.filtered_clips?.includes(num)
                    return (
                      <div key={num}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all
                          ${isDone ? 'bg-emerald-100 text-emerald-700' : isFiltered ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-400 animate-pulse'}`}>
                        {isDone ? '✓' : isFiltered ? '✕' : num}
                      </div>
                    )
                  })
                ) : (
                  <span className="text-xs text-gray-400 italic">Waiting for submissions...</span>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {activeRun.status === 'failed' && activeRun.error && (
            <div className="mx-4 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-xs text-red-700 font-medium">Error</p>
              <p className="text-xs text-red-600 mt-0.5">{activeRun.error}</p>
            </div>
          )}

          {/* Log */}
          <div className="border-t border-gray-100">
            <button onClick={() => setExpandedLog(e => !e)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
              <span>🪵 Pipeline log ({activeRun.log?.length || 0} entries)</span>
              <span>{expandedLog ? '▲' : '▼'}</span>
            </button>
            {expandedLog && (
              <div className="px-4 pb-3 max-h-48 overflow-y-auto bg-gray-50">
                <div className="font-mono text-xs text-gray-500 space-y-0.5">
                  {(activeRun.log || []).slice(-30).map((line, i) => (
                    <p key={i} className={`leading-relaxed ${line.includes('ERROR') ? 'text-red-600' : line.includes('✓') || line.includes('done') ? 'text-emerald-600' : ''}`}>
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

      {/* Empty state — no active run, no history */}
      {!activeRun && runs.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-5xl mb-3">✨</div>
          <p className="text-sm font-medium text-gray-600 mb-1">Ready to create</p>
          <p className="text-xs">Hit "New Story" to generate your first KathaKar reel</p>
        </div>
      )}

      {/* Recent runs */}
      {runs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Generations</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {runs.map(run => {
              const isActive = !['complete', 'failed'].includes(run.status)
              const stepInfo = STEP_LABELS[run.status]
              return (
                <button key={run.story_id} onClick={() => fetchRunDetail(run.story_id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${activeRun?.story_id === run.story_id ? 'bg-indigo-50' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{run.topic || run.story_id}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {run.story_id.slice(-6)} · {new Date(run.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {run.status === 'complete' ? (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700">✅ Done</span>
                      ) : run.status === 'failed' ? (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700">❌ Failed</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 animate-pulse">
                          {stepInfo?.emoji} {stepInfo?.label}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
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
  const [activeClip, setActiveClip] = useState<string | null>(story.clips[0]?.url || null)
  const [finalUrl, setFinalUrl] = useState(story.final_url || '')
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deletingClip, setDeletingClip] = useState('')
  const [distLinks, setDistLinks] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState('')

  const downloadZip = async () => {
    setDownloading(true)
    const res = await fetch(`/api/stories/${story.story_id}/download`)
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${story.story_id}.zip`; a.click()
    setDownloading(false)
  }

  const uploadFinal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    // Send raw binary — avoids 10MB Next.js FormData limit, enables GCS streaming
    const res = await fetch(`/api/stories/${story.story_id}/upload-final`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'video/mp4', 'X-Filename': file.name },
    })
    const data = await res.json()
    if (data.finalUrl) { setFinalUrl(data.finalUrl); onUpdate({ ...story, final_url: data.finalUrl, hasFinal: true }) }
    setUploading(false)
  }

  const deleteClip = async (clipName: string, clipUrl: string) => {
    if (!confirm('Delete this clip?')) return
    setDeletingClip(clipName)
    await fetch(`/api/stories/${story.story_id}/clip?path=${encodeURIComponent(clipName)}`, { method: 'DELETE' })
    const remaining = clips.filter(c => c.name !== clipName)
    setClips(remaining)
    if (activeClip === clipUrl) setActiveClip(remaining[0]?.url || null)
    setDeletingClip('')
  }

  const markPublished = async (platform: string) => {
    setSaving(platform)
    await fetch(`/api/stories/${story.story_id}/distribution`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, url: distLinks[platform] || '', status: 'published' }),
    })
    setSaving('')
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 pb-6">

      {/* Story header */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900 leading-relaxed">{story.topic}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-gray-400">{story.story_id}</span>
              {story.theme && <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full">{story.theme}</span>}
              {story.notes && <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full truncate max-w-[180px]" title={story.notes}>⚠ {story.notes.slice(0, 30)}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadZip} disabled={downloading}
            className="flex-1 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50">
            {downloading ? '⏳ Preparing...' : '⬇ Download ZIP'}
          </button>
          <button onClick={() => { if (confirm('Delete story and all files?')) { fetch(`/api/stories/${story.story_id}`, { method: 'DELETE' }); onDelete() } }}
            className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-semibold transition-colors">
            🗑
          </button>
        </div>
      </div>

      {/* Final Reel upload */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">🎬 Final Reel</h3>
        {finalUrl ? (
          <div>
            <video controls className="w-full bg-gray-900 rounded-xl mb-2" style={{ maxHeight: '300px' }} src={finalUrl} />
            <label className="text-xs text-gray-400 cursor-pointer hover:text-indigo-500 transition-colors">
              🔄 Replace reel
              <input type="file" accept="video/mp4" className="hidden" onChange={uploadFinal} />
            </label>
          </div>
        ) : (
          <label className={`flex flex-col items-center py-10 border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-xl cursor-pointer transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-3xl mb-2">📤</span>
            <span className="text-sm font-medium text-gray-600">{uploading ? 'Uploading...' : 'Upload Final Reel'}</span>
            <span className="text-xs text-gray-400 mt-1">MP4 from CapCut / DaVinci / any editor</span>
            <input type="file" accept="video/mp4" className="hidden" onChange={uploadFinal} disabled={uploading} />
          </label>
        )}
      </div>

      {/* YouTube */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">▶ YouTube Shorts</h3>
        <YouTubePublish story={story} finalUrl={finalUrl} />
      </div>

      {/* Audio */}
      {story.audio_url && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">🎵 Narration</h3>
          <audio controls className="w-full" src={story.audio_url} />
          <a href={story.audio_url} download className="mt-2 inline-block text-xs text-indigo-500 hover:underline">⬇ Download MP3</a>
        </div>
      )}

      {/* Clips grid */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">📹 Raw Clips ({clips.length})</h3>
        {clips.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No clips yet</p>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
              {clips.map(clip => {
                const num = clip.name.match(/scene_(\d+)/)?.[1]
                const isActive = activeClip === clip.url
                return (
                  <div key={clip.name} className={`flex items-center shrink-0 rounded-xl overflow-hidden transition-colors ${isActive ? 'bg-indigo-500' : 'bg-gray-100'}`}>
                    <button onClick={() => setActiveClip(clip.url)} className={`px-3 py-2 text-xs font-medium ${isActive ? 'text-white' : 'text-gray-600'}`}>
                      S{num}
                    </button>
                    <button onClick={() => deleteClip(clip.name, clip.url)} disabled={!!deletingClip}
                      className={`pr-2 text-xs transition-colors ${isActive ? 'text-indigo-200' : 'text-gray-400'} hover:text-red-500`}>
                      {deletingClip === clip.name ? '·' : '✕'}
                    </button>
                  </div>
                )
              })}
            </div>
            {activeClip && (
              <>
                <video key={activeClip} controls className="w-full bg-gray-900 rounded-xl" src={activeClip} />
                <a href={activeClip} download className="mt-2 inline-block text-xs text-indigo-500 hover:underline">⬇ Download clip</a>
              </>
            )}
          </>
        )}
      </div>

      {/* Other platforms */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">🌐 Other Platforms</h3>
        {[
          { key: 'instagram', label: 'Instagram', color: 'bg-gradient-to-r from-pink-500 to-orange-400' },
          { key: 'tiktok',    label: 'TikTok',    color: 'bg-gray-900' },
        ].map(p => (
          <div key={p.key} className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2.5 py-1.5 rounded-lg ${p.color} text-white w-20 text-center font-medium shrink-0`}>{p.label}</span>
            <input type="url" placeholder="Paste URL after posting" value={distLinks[p.key] || ''}
              onChange={e => setDistLinks(prev => ({ ...prev, [p.key]: e.target.value }))}
              className="flex-1 min-w-0 px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 transition-colors" />
            <button onClick={() => markPublished(p.key)} disabled={saving === p.key}
              className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-medium shrink-0">
              {saving === p.key ? '...' : '✓ Mark'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── YouTube Publish ───────────────────────────────────────────────────────────

function YouTubePublish({ story, finalUrl }: { story: Story; finalUrl: string }) {
  const [title, setTitle] = useState(story.topic.slice(0, 90))
  const [description, setDescription] = useState(`${story.topic}\n\n#shorts #hindistory #moralstory #kathakar`)
  const [tags, setTags] = useState('shorts,hindi story,moral story,kathakar')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ url: string } | null>(null)
  const [error, setError] = useState('')

  const publish = async () => {
    if (!finalUrl) { setError('Upload final reel first'); return }
    setUploading(true); setError('')
    const res = await fetch(`/api/stories/${story.story_id}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'youtube', videoUrl: finalUrl, title, description, tags: tags.split(',').map(t => t.trim()) }),
    })
    const data = await res.json()
    if (data.youtubeUrl) setResult({ url: data.youtubeUrl })
    else setError(data.error || 'Upload failed')
    setUploading(false)
  }

  if (result) return (
    <div className="text-center py-4">
      <div className="text-4xl mb-2">✅</div>
      <p className="text-sm font-semibold text-gray-800 mb-2">Published to YouTube!</p>
      <a href={result.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline break-all">{result.url}</a>
    </div>
  )

  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between mb-1"><label className="text-xs text-gray-500">Title</label><span className="text-xs text-gray-400">{title.length}/100</span></div>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
          className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors" />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors resize-none" />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Tags (comma separated)</label>
        <input value={tags} onChange={e => setTags(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-red-400 transition-colors" />
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
      {!finalUrl && <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">⚠ Upload final reel first</p>}
      <button onClick={publish} disabled={uploading || !finalUrl}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors">
        {uploading ? '⟳ Uploading...' : '▶ Publish to YouTube Shorts'}
      </button>
    </div>
  )
}

// ─── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsView() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/analytics').then(r => r.json()).then(d => {
      if (d.error) setError(d.error); else setData(d); setLoading(false)
    }).catch(() => { setError('Failed to load'); setLoading(false) })
  }, [])

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm animate-pulse">Loading analytics...</div>

  if (error) return (
    <div className="max-w-sm mx-auto text-center py-12">
      <span className="text-5xl block mb-4">📊</span>
      <p className="text-gray-700 font-semibold mb-2">Analytics not connected</p>
      <p className="text-xs text-gray-400 mb-5">{error}</p>
      <a href="/api/auth/youtube" className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold">Connect YouTube →</a>
    </div>
  )

  if (!data) return null
  const channel = data.channel as Record<string, unknown>
  const metrics = data.metrics as Record<string, number>
  const topVideos = data.topVideos as Record<string, unknown>[]
  const period = data.period as Record<string, unknown>
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n || 0)

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4 pb-6">
      {channel && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
          {channel.thumbnail ? <img src={String(channel.thumbnail)} className="w-12 h-12 rounded-full" alt="" /> : null}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm">{String(channel.name)}</p>
            <p className="text-xs text-gray-500">{fmt(Number(channel.subscribers))} subscribers · {String(channel.videoCount)} videos</p>
          </div>
          <span className="text-xs text-gray-400 shrink-0">Last {String(period?.days)}d</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Views',       value: fmt(metrics.views),            color: 'bg-blue-50 text-blue-700'    },
          { label: 'Watch Time',  value: `${fmt(metrics.watchMinutes)}m`, color: 'bg-purple-50 text-purple-700' },
          { label: 'Subscribers', value: `+${metrics.subscribersGained}`, color: 'bg-emerald-50 text-emerald-700' },
          { label: 'Likes',       value: fmt(metrics.likes),            color: 'bg-pink-50 text-pink-700'    },
          { label: 'Comments',    value: fmt(metrics.comments),         color: 'bg-amber-50 text-amber-700 col-span-2 md:col-span-1' },
        ].map(m => (
          <div key={m.label} className={`${m.color} rounded-2xl p-4 text-center`}>
            <div className="text-2xl font-bold">{m.value}</div>
            <div className="text-xs opacity-70 mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      {topVideos?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top Videos</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {topVideos.map((v, i) => (
              <a key={String(v.videoId)} href={String(v.url)} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group">
                <span className="text-xs font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>
                {v.thumbnail ? <img src={String(v.thumbnail)} className="w-10 h-7 rounded-lg object-cover shrink-0" alt="" /> : null}
                <p className="flex-1 min-w-0 text-xs text-gray-700 truncate group-hover:text-indigo-600 transition-colors">{String(v.title)}</p>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-gray-800">{fmt(Number(v.views))}</p>
                  <p className="text-xs text-gray-400">views</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
