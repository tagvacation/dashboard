'use client'

import { useEffect, useRef, useState } from 'react'

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

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab] = useState<'stories' | 'generate' | 'analytics' | 'settings'>('generate')
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
            { key: 'settings',  label: '⚙️ Settings'  },
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
            <GenerateView onStoryReady={() => { loadStories(); setTab('stories') }} stories={stories} />
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

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="h-full overflow-y-auto p-4 md:p-6">
            <SettingsView />
          </div>
        )}
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="md:hidden shrink-0 bg-white border-t border-gray-200 flex">
        {[
          { key: 'generate',  label: 'Generate',  icon: '✨' },
          { key: 'stories',   label: 'Stories',   icon: '📚' },
          { key: 'analytics', label: 'Analytics', icon: '📊' },
          { key: 'settings',  label: 'Settings',  icon: '⚙️' },
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
      body: JSON.stringify({ category_id: selectedCat }),
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
  const [activeClip, setActiveClip] = useState<string | null>(story.clips[0]?.url || null)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingClip, setDeletingClip] = useState('')

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

  const deleteStory = async () => {
    if (!confirm('Delete this story and ALL files from GCS + sheet? This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/stories/${story.story_id}`, { method: 'DELETE' })
    if (res.ok) { onDelete() } else {
      const d = await res.json(); alert(`Delete failed: ${d.error}`)
      setDeleting(false)
    }
  }

  const deleteClip = async (clipName: string, clipUrl: string) => {
    if (!confirm('Delete this clip from GCS?')) return
    setDeletingClip(clipName)
    const res = await fetch(`/api/stories/${story.story_id}/clip?path=${encodeURIComponent(clipName)}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok && data.remainingClips) {
      // Use server-confirmed remaining list
      setClips(data.remainingClips)
      onUpdate({ ...story, clips: data.remainingClips, scenes_count: String(data.remainingClips.length) })
      if (activeClip === clipUrl) setActiveClip(data.remainingClips[0]?.url || null)
    } else if (res.ok) {
      const remaining = clips.filter(c => c.name !== clipName)
      setClips(remaining)
      if (activeClip === clipUrl) setActiveClip(remaining[0]?.url || null)
    }
    setDeletingClip('')
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 pb-6">

      {/* Story header */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900 leading-relaxed">{story.topic}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs text-gray-400">{story.story_id}</span>
              {story.theme && <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full">{story.theme}</span>}
              {story.notes && <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full truncate max-w-[180px]" title={story.notes}>⚠ {story.notes.slice(0, 30)}</span>}
            </div>
          </div>
          {/* Refresh button */}
          <button onClick={refreshStory} title="Refresh from server"
            className="shrink-0 p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadZip} disabled={downloading}
            className="flex-1 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50">
            {downloading ? '⏳ Preparing...' : '⬇ Download ZIP'}
          </button>
          <button onClick={deleteStory} disabled={deleting}
            className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50">
            {deleting ? '⏳' : '🗑'}
          </button>
        </div>
      </div>

      {/* YouTube Upload — simplified: file → YouTube → store URL */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">▶ YouTube Shorts</h3>
        <YoutubeUpload story={story} clips={clips} hasAudio={story.hasAudio} onUpdate={onUpdate} />
      </div>

      {/* Audio */}
      {story.audio_url && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">🎵 Narration</h3>
          <audio controls className="w-full" src={story.audio_url} />
          <a href={story.audio_url} download className="mt-2 inline-block text-xs text-indigo-500 hover:underline">⬇ Download MP3</a>
        </div>
      )}

      {/* Clips */}
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
                    <button onClick={() => setActiveClip(clip.url)} className={`px-3 py-2 text-xs font-medium ${isActive ? 'text-white' : 'text-gray-600'}`}>S{num}</button>
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

  // Step 1: GCS upload state
  const [gcsUploading, setGcsUploading] = useState(false)
  const [gcsProgress, setGcsProgress] = useState(0)
  const [gcsReady, setGcsReady] = useState(false)

  // Step 2: YouTube publish state
  const [ytUploading, setYtUploading] = useState(false)

  // Schedule state
  const [scheduledPost, setScheduledPost] = useState<{ id: number; scheduled_at: string; status: string } | null>(null)
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('23:00')
  const [scheduling, setScheduling] = useState(false)

  const [error, setError] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualUrl, setManualUrl] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Load existing schedule for this story
  useEffect(() => {
    fetch(`/api/schedule`).then(r => r.json()).then(d => {
      const post = (d.posts || []).find((p: { story_id: string }) => p.story_id === story.story_id)
      if (post) setScheduledPost(post)
    })
    // Default date = today
    setScheduleDate(new Date().toISOString().split('T')[0])
  }, [story.story_id])

  const scheduleUpload = async () => {
    if (!scheduleDate || !scheduleTime) return
    setScheduling(true); setError('')

    // Combine date + time in IST, convert to UTC
    const dtStr = `${scheduleDate}T${scheduleTime}:00+05:30`
    const scheduledAt = new Date(dtStr).toISOString()

    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_id: story.story_id, platform: 'youtube', scheduled_at: scheduledAt }),
    })
    const data = await res.json()
    if (res.ok) {
      setScheduledPost(data.post)
      setShowScheduler(false)
    } else {
      setError(data.error || 'Failed to schedule')
    }
    setScheduling(false)
  }

  const cancelSchedule = async () => {
    if (!scheduledPost) return
    await fetch('/api/schedule', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: scheduledPost.id }) })
    setScheduledPost(null)
  }

  // IST preset times
  const IST_PRESETS = [
    { label: '11 PM', time: '23:00' },
    { label: '8 PM',  time: '20:00' },
    { label: '7 PM',  time: '19:00' },
    { label: '6 PM',  time: '18:00' },
    { label: '9 AM',  time: '09:00' },
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
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">{gcsReady ? '✅' : '1️⃣'}</span>
          <p className="text-xs font-semibold text-gray-700">
            {gcsReady ? 'Video saved — ready to publish' : 'Step 1: Save video to cloud'}
          </p>
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
          <label className="block text-center py-1.5 text-xs text-emerald-600 hover:text-emerald-800 cursor-pointer transition-colors">
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

      {/* ── STEP 2: Publish now OR Schedule ── */}
      <div className={`rounded-xl border transition-all ${!gcsReady ? 'opacity-40 pointer-events-none border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'}`}>
        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <span className="text-base">2️⃣</span>
          <p className="text-xs font-semibold text-gray-700">Step 2: Publish to YouTube</p>
          {!gcsReady && <span className="text-xs text-gray-400">(complete step 1 first)</span>}
        </div>

        {/* If already scheduled */}
        {scheduledPost && scheduledPost.status === 'pending' ? (
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <span className="text-lg">⏰</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-800">Scheduled</p>
                <p className="text-xs text-amber-700">
                  {new Date(scheduledPost.scheduled_at).toLocaleString('en-IN', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
                  })} IST
                </p>
              </div>
              <button onClick={cancelSchedule} className="text-xs text-red-400 hover:text-red-600 font-medium shrink-0">Cancel</button>
            </div>
            <p className="text-xs text-gray-400 text-center">Server will auto-upload at scheduled time</p>
          </div>
        ) : scheduledPost && scheduledPost.status === 'posted' ? (
          <div className="p-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <span className="text-lg">✅</span>
              <p className="text-xs text-emerald-700 font-medium">Auto-published successfully!</p>
            </div>
          </div>
        ) : ytUploading ? (
          <div className="p-3 text-center">
            <svg className="animate-spin w-5 h-5 text-red-500 mx-auto mb-1" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p className="text-xs text-red-600 font-medium">Uploading to YouTube...</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {/* Publish now */}
            <button onClick={publishToYoutube} disabled={!gcsReady}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors">
              ▶ Publish Now
            </button>

            {/* Schedule divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Schedule button */}
            {!showScheduler ? (
              <button onClick={() => setShowScheduler(true)}
                className="w-full py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                <span>⏰</span> Schedule for Later
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-amber-800">📅 Schedule Upload (IST)</p>

                {/* Quick IST presets */}
                <div className="flex gap-1.5 flex-wrap">
                  {IST_PRESETS.map(p => (
                    <button key={p.time} onClick={() => setScheduleTime(p.time)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                        ${scheduleTime === p.time ? 'bg-amber-500 text-white' : 'bg-white border border-amber-200 text-amber-700 hover:bg-amber-50'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-amber-700 mb-1">Date</p>
                    <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 text-xs bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 mb-1">Time (IST)</p>
                    <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-amber-400" />
                  </div>
                </div>

                {scheduleDate && scheduleTime && (
                  <p className="text-xs text-amber-600 text-center">
                    Will upload: {new Date(`${scheduleDate}T${scheduleTime}:00+05:30`).toLocaleString('en-IN', {
                      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
                    })} IST
                  </p>
                )}

                {error && <p className="text-xs text-red-600">{error}</p>}

                <div className="flex gap-2">
                  <button onClick={scheduleUpload} disabled={scheduling || !scheduleDate || !scheduleTime}
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold">
                    {scheduling ? '⏳ Scheduling...' : '⏰ Confirm Schedule'}
                  </button>
                  <button onClick={() => { setShowScheduler(false); setError('') }}
                    className="px-4 py-2 bg-white border border-amber-200 text-amber-600 rounded-xl text-xs">
                    Cancel
                  </button>
                </div>
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
  const [sub, setSub] = useState<'categories' | 'credentials' | 'prompts' | 'schedule'>('categories')

  const TABS = [
    { key: 'categories',  label: '🎬 Content Types' },
    { key: 'credentials', label: '🔑 GCP Credentials' },
    { key: 'prompts',     label: '🎯 Default Prompts' },
    { key: 'schedule',    label: '📅 Schedule' },
  ] as const

  return (
    <div className="max-w-3xl mx-auto w-full pb-8 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">⚙️ Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Manage content types, GCP accounts, AI prompts, and post scheduling</p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key as typeof sub)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${sub === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'categories'  && <CategoriesSettings />}
      {sub === 'credentials' && <CredentialsSettings />}
      {sub === 'prompts'     && <PromptsSettings />}
      {sub === 'schedule'    && <ScheduleSettings />}
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

function CredentialsSettings() {
  const [creds, setCreds] = useState<{ id: string; name: string; project_id: string; bucket: string; is_active: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', project_id: '', bucket: '', sa_json: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const d = await fetch('/api/credentials').then(r => r.json())
    setCreds(d.credentials || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string)
        setForm(f => ({
          ...f,
          sa_json: ev.target?.result as string,
          project_id: json.project_id || f.project_id,
          id: f.id || `account_${Date.now()}`,
          name: f.name || `${json.project_id || 'GCP Account'}`,
        }))
        setError('')
      } catch { setError('Invalid JSON file') }
    }
    reader.readAsText(file)
  }

  const save = async () => {
    setSaving(true); setError('')
    const res = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    await load(); setShowForm(false); setSaving(false)
    setForm({ id: '', name: '', project_id: '', bucket: '', sa_json: '' })
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">Multiple Vertex AI accounts for Veo video generation and TTS.</p>
        <button onClick={() => setShowForm(s => !s)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold">
          + Add Account
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Add GCP Account</p>

          {/* SA JSON file upload */}
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Upload Service Account JSON key file:</p>
            <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-xl cursor-pointer transition-colors">
              <span className="text-2xl">📂</span>
              <div>
                <p className="text-xs font-medium text-gray-700">Click to upload SA JSON</p>
                <p className="text-xs text-gray-400">{form.sa_json ? '✅ File loaded — fields auto-filled below' : 'credentials.json from GCP Console'}</p>
              </div>
              <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="grid grid-cols-2 gap-2">
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Account name *"
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400" />
            <input value={form.id} onChange={e => setForm(f => ({...f, id: e.target.value}))} placeholder="ID (e.g. account_b)"
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.project_id} onChange={e => setForm(f => ({...f, project_id: e.target.value}))} placeholder="GCP Project ID *"
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
            <input value={form.bucket} onChange={e => setForm(f => ({...f, bucket: e.target.value}))} placeholder="GCS Bucket name *"
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 font-mono" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.name || !form.project_id || !form.bucket || !form.sa_json}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold">
              {saving ? 'Saving...' : 'Add Credential'}
            </button>
            <button onClick={() => { setShowForm(false); setError('') }} className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs">Cancel</button>
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
              <p className="text-xs text-gray-400 font-mono">{cred.project_id} · {cred.bucket}</p>
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
  const [posts, setPosts] = useState<{ id: number; story_id: string; platform: string; scheduled_at: string; status: string; result_url: string; error: string; topic?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/schedule').then(r => r.json()).then(d => { setPosts(d.posts || []); setLoading(false) })
  }, [])

  const remove = async (id: number) => {
    setDeleting(id)
    await fetch('/api/schedule', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setPosts(p => p.filter(x => x.id !== id))
    setDeleting(null)
  }

  const PLATFORM_ICON: Record<string, string> = { youtube: '▶', instagram: '📸', facebook: '👥' }
  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700', posted: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-red-50 text-red-700', processing: 'bg-blue-50 text-blue-700',
  }

  if (loading) return <div className="text-center py-8 text-gray-400 animate-pulse">Loading schedule...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">Scheduled posts. Cron runs every 5 min: <code className="bg-gray-100 px-1 rounded">POST /api/cron</code></p>
        <a href="/api/cron" target="_blank" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs font-medium">▶ Run now</a>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📅</p>
          <p className="text-sm">No scheduled posts</p>
          <p className="text-xs mt-1">Schedule from any story's detail page</p>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map(post => (
            <div key={post.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${post.platform === 'youtube' ? 'bg-red-50' : post.platform === 'instagram' ? 'bg-pink-50' : 'bg-blue-50'}`}>
                {PLATFORM_ICON[post.platform] || '📤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 font-medium truncate">{post.topic || post.story_id}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">
                    {new Date(post.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[post.status] || 'bg-gray-50 text-gray-500'}`}>
                    {post.status}
                  </span>
                </div>
                {post.result_url && <a href={post.result_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline">{post.result_url}</a>}
                {post.error && <p className="text-xs text-red-500 mt-0.5">{post.error}</p>}
              </div>
              {post.status === 'pending' && (
                <button onClick={() => remove(post.id)} disabled={deleting === post.id}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50">
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

function AnalyticsView() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/analytics')
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
  }, [])

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
            <p className="font-semibold text-gray-900 text-sm">{String(channel.name || 'KathaKar')}</p>
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
